/**
 * Adaptive Context Compressor
 *
 * Three-layer strategy applied before each LLM call:
 *   Layer 1 (Sliding Window): keep the last N complete turns untouched.
 *   Layer 2 (Threshold-summarize): when usage > 70 %, summarize older turns
 *     into concise blocks that replace their full messages.
 *   Layer 3 (Layered eviction): when usage > 90 %, drop even older compressed
 *     blocks entirely, preserving only recent summaries.
 *
 * Layer ordering in the final prompt:
 *   [system prompt] → [compressed-blocks, oldest first] → [full recent turns]
 * This ensures the model sees the earliest high-level context first,
 * then the detailed recent conversation.
 */
import type { AgentMessage } from './types.js';
import type { AgentCore } from './core.js';

// ── Public thresholds (tunable) ──────────────────────────────────────────────
export const CONTEXT_THRESHOLDS = {
  /** When usage exceeds this %, start compressing older messages (layer 2). */
  summarizeAt: 0.70,
  /** When usage exceeds this %, also drop the oldest compressed blocks (layer 3). */
  evictAt: 0.90,
  /** Number of complete recent turns to always keep uncompressed (layer 1). */
  slidingWindowSize: 6,
  /** Max tokens reserved for the system prompt + tool schemas + buffer. */
  reservedTokens: 4096,
};

// ── Token estimation ─────────────────────────────────────────────────────────
/** Rough char→token ratio for common languages. */
const TOKEN_CHARS = 3.8;

export function estimateTokens(text: string): number {
  if (!text) return 0;
  // CJK chars are ~1 token each; Latin is ~4 chars/token
  const cjk = (text.match(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g) || []).length;
  const latin = text.length - cjk;
  return Math.ceil(cjk / 1 + latin / TOKEN_CHARS);
}

export function estimateMessagesTokens(msgs: AgentMessage[]): number {
  return msgs.reduce((sum, m) => sum + estimateTokens(m.content || ''), 0);
}

// ── Message categories ───────────────────────────────────────────────────────

export enum Layer {
  /** Recent complete turns kept fully intact. */
  Recent = 'recent',
  /** Older turns replaced by a single summary block. */
  Compressed = 'compressed',
  /** Discarded entirely (too old, beyond eviction threshold). */
  Discarded = 'discarded',
}

export interface LayeredMessage extends AgentMessage {
  _layer: Layer;
  _summary?: string; // populated when _layer === Layer.Compressed
}

// ── Core compression engine ──────────────────────────────────────────────────

/**
 * Categorises every non-system message into a layer based on position and
 * current context usage. Returns the categorisation without mutating state.
 */
export function categoriseMessages(
  messages: AgentMessage[],
  currentTokens: number,
  contextWindow: number | undefined,
): LayeredMessage[] {
  const nonSystem = messages.filter(m => m.role !== 'system');
  const totalNonSystem = nonSystem.length;
  // slidingWindowSize is measured in turns; each turn is 2 messages (user + assistant)
  const window = CONTEXT_THRESHOLDS.slidingWindowSize * 2;

  // Determine safe token budget after reserving space for system + tools
  const reserved = CONTEXT_THRESHOLDS.reservedTokens;
  const effectiveWindow = (contextWindow ?? 128000) - reserved;

  // Category assignment by position from the end
  const result: LayeredMessage[] = [];
  for (let i = 0; i < nonSystem.length; i++) {
    const m = nonSystem[i];
    const fromEnd = totalNonSystem - i; // 1 = most recent
    const layered: LayeredMessage = { ...m, _layer: Layer.Recent };

    if (fromEnd <= window) {
      // Layer 1: recent turns — always preserved intact
      layered._layer = Layer.Recent;
    } else if (currentTokens / effectiveWindow < CONTEXT_THRESHOLDS.summarizeAt) {
      // Under threshold: keep uncompressed even if outside window
      layered._layer = Layer.Recent;
    } else {
      // Over 70 % → mark for compression
      layered._layer = Layer.Compressed;
    }
    result.push(layered);
  }
  return result;
}

/**
 * Returns a compact textual summary of compressed messages, grouped by turn.
 * Each group becomes one synthetic "assistant reminder" message.
 */
export function buildCompressedBlock(compressed: AgentMessage[]): string {
  if (!compressed.length) return '';
  // Pair up user→assistant messages into turn summaries
  const turns: Array<{ user: string; assistant: string }> = [];
  for (let i = 0; i < compressed.length; i += 2) {
    const user = compressed[i]?.content || '';
    const assistant = compressed[i + 1]?.content || '';
    if (user) turns.push({ user, assistant: assistant || '(tool results)' });
  }
  if (!turns.length) return '';
  const lines = turns.map(t =>
    `Turn: "${t.user.slice(0, 120)}" → "${t.assistant.slice(0, 200)}"`
  );
  return `--- Earlier context (summarized) ---\n${lines.join('\n')}\n--- End summary ---`;
}

/**
 * Filters out messages that exceed the eviction threshold (layer 3).
 * Returns indices of discarded messages.
 */
export function getDiscardedIndices(
  categorized: LayeredMessage[],
  currentTokens: number,
  contextWindow: number | undefined,
): number[] {
  const effectiveWindow = (contextWindow ?? 128000) - CONTEXT_THRESHOLDS.reservedTokens;
  if (currentTokens / effectiveWindow < CONTEXT_THRESHOLDS.evictAt) return [];

  // Drop oldest compressed blocks until we're under the eviction threshold
  const toDrop: number[] = [];
  const categorizedCopy = [...categorized];
  // Work from oldest first (beginning of array)
  for (let i = 0; i < categorizedCopy.length; i++) {
    if (categorizedCopy[i]._layer !== Layer.Compressed) continue;
    toDrop.push(i);
    categorizedCopy[i]._layer = Layer.Discarded;
    // Recalculate rough token count after drop
    const remaining = estimateMessagesTokens(
      categorizedCopy.filter(m => m._layer !== Layer.Discarded).map(m => ({
        role: m.role, content: m.content,
      }))
    );
    if (remaining / effectiveWindow < CONTEXT_THRESHOLDS.evictAt) break;
    // If we've dropped all compressed blocks and still above threshold,
    // stop — there are no more compressible messages to remove.
    if (toDrop.length >= categorizedCopy.filter(m => m._layer === Layer.Compressed || m._layer === Layer.Discarded).length) break;
  }
  return toDrop;
}

/**
 * Builds the final message list sent to the LLM.
 * Order: [system] → [compressed blocks, oldest first] → [recent full turns]
 */
export function buildCompressedMessages(
  originalMessages: AgentMessage[],
  categorized: LayeredMessage[],
): AgentMessage[] {
  const systemMsg = originalMessages.find(m => m.role === 'system');
  const nonSystem = categorized;

  const compressedGroup = nonSystem.filter(m => m._layer === Layer.Compressed);
  const recentGroup = nonSystem.filter(m => m._layer === Layer.Recent);

  // Keep compressed in original order (oldest first)
  const result: AgentMessage[] = [];

  // System prompt (layer 0, always first)
  if (systemMsg) result.push(systemMsg);

  // Compressed blocks (older context, summarized — oldest first)
  for (const m of compressedGroup) {
    result.push({
      role: m.role,
      content: m._summary || m.content || '',
    });
  }

  // Recent full turns (preserved intact)
  for (const m of recentGroup) {
    result.push({
      role: m.role,
      content: m.content,
      tool_calls: m.tool_calls,
      tool_call_id: m.tool_call_id,
      name: m.name,
    });
  }

  return result;
}

// ── Integration helpers ──────────────────────────────────────────────────────

/**
 * Main entry point: runs the three-layer strategy and returns compression metadata.
 * Mutates the agent's messages in-place (old compressed messages are removed).
 */
export async function maybeCompress(
  core: AgentCore,
  contextWindow: number | undefined,
  lastPromptTokens: number,
): Promise<{
  compressed: boolean;
  layerBreakdown: Record<string, number>;
  discardedCount: number;
  compressedTokenSavings: number;
}> {
  const messages = core.getMessages();
  if (messages.length <= 2) return { compressed: false, layerBreakdown: {}, discardedCount: 0, compressedTokenSavings: 0 };

  const currentTokens = lastPromptTokens || estimateMessagesTokens(messages);
  const effectiveWindow = (contextWindow ?? 128000) - CONTEXT_THRESHOLDS.reservedTokens;
  const ratio = currentTokens / effectiveWindow;

  if (ratio < CONTEXT_THRESHOLDS.summarizeAt) {
    return { compressed: false, layerBreakdown: {}, discardedCount: 0, compressedTokenSavings: 0 };
  }

  // Step 1: categorise
  const categorized = categoriseMessages(messages, currentTokens, contextWindow);

  // Step 2: layer 3 eviction
  const discardIndices = getDiscardedIndices(categorized, currentTokens, contextWindow);
  const discardedCount = discardIndices.length;

  // Step 3: build compressed block for layer 2
  const compressedMsgs = categorized.filter(m => m._layer === Layer.Compressed);
  const compressedBlock = buildCompressedBlock(compressedMsgs);
  const savings = estimateMessagesTokens(compressedMsgs) - estimateTokens(compressedBlock);

  // Step 4: mutate messages — replace compressed group with single summary block
  // categorized 与 messages 中非 system 子序列一一对应（categoriseMessages 内部按原序过滤 system）。
  // 直接用下标定位，避免"按内容相等回找"在重复内容消息时误删。
  const compressedSet = new Set<number>();
  {
    let nsIdx = 0;
    messages.forEach((m, i) => {
      if (m.role === 'system') return;
      if (categorized[nsIdx]?._layer === Layer.Compressed) compressedSet.add(i);
      nsIdx++;
    });
  }

  // Remove compressed messages from original, prepend summary
  const recentOnly = messages.filter((_, i) => !compressedSet.has(i));
  if (compressedBlock) {
    recentOnly.splice(1, 0, { role: 'system' as const, content: compressedBlock });
  }

  // Remove discarded messages (oldest)
  if (discardedCount > 0) {
    const toRemove = recentOnly.length - discardedCount;
    // Remove from the beginning (oldest first), skip system at index 0
    const keepFrom = Math.max(1, toRemove);
    const finalMessages = recentOnly.slice(keepFrom);
    core._replaceMessages(finalMessages);
  } else {
    core._replaceMessages(recentOnly);
  }

  const layerBreakdown = {
    recent: categorized.filter(m => m._layer === Layer.Recent).length,
    compressed: categorized.filter(m => m._layer === Layer.Compressed).length,
    discarded: discardedCount,
  };

  return {
    compressed: true,
    layerBreakdown,
    discardedCount,
    compressedTokenSavings: Math.max(0, savings),
  };
}
