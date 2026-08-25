// ============================================================
// 会话漂移雷达 — 检测用户话题/难度的分布漂移。
//
// 实现：在线会话语义 centroid + 余弦漂移分数。
// 默认 hashing embedding（64 维 char-bigram 哈希 + L2 归一），
// 零依赖、无 API key 也可用；真实 embedding 可作为升级（预留点）。
// ============================================================

const DIM = 64;
const DRIFT_THRESHOLD = 0.6;
const MIN_SAMPLES = 3; // 少于 3 条消息不评漂移（centroid 未成形）

export interface DriftPoint {
  text: string;
  score: number;       // 0..1，越大越偏离历史分布
  isEvent: boolean;    // 超过阈值 → 漂移事件
  ts: number;
}

interface SessionState {
  centroid: number[];
  count: number;
  events: number;
  history: DriftPoint[];
}

const sessions = new Map<string, SessionState>();
const MAX_HISTORY = 200;
const MAX_SESSIONS = 200;

/** hashing char-bigram embedding（离线可用，无 embedding key 依赖）。 */
export function hashEmbed(text: string): number[] {
  const vec = new Array(DIM).fill(0);
  const s = text.toLowerCase();
  for (let i = 0; i < s.length - 1; i++) {
    const h = hashStr(s.slice(i, i + 2));
    vec[h % DIM] += 1;
  }
  for (const ch of s) {
    if (/[\u4e00-\u9fff]/.test(ch)) {
      vec[hashStr('c' + ch) % DIM] += 2; // 单字中文加权
    }
  }
  const norm = Math.sqrt(vec.reduce((a, b) => a + b * b, 0)) || 1;
  return vec.map((v) => v / norm);
}

function hashStr(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

function getState(sessionId: string): SessionState {
  let st = sessions.get(sessionId);
  if (!st) {
    st = { centroid: new Array(DIM).fill(0), count: 0, events: 0, history: [] };
    sessions.set(sessionId, st);
    if (sessions.size > MAX_SESSIONS) {
      const oldest = sessions.keys().next().value;
      if (oldest) sessions.delete(oldest);
    }
  }
  return st;
}

/** 摄入一条用户消息，返回漂移分数（0 = 未成形）。 */
export function ingestDrift(sessionId: string, text: string): number {
  const st = getState(sessionId);
  const vec = hashEmbed(text);

  let score = 0;
  if (st.count >= MIN_SAMPLES) {
    score = Math.max(0, 1 - cosine(vec, st.centroid));
  }

  const isEvent = score > DRIFT_THRESHOLD;
  if (isEvent) st.events += 1;
  st.history.push({ text: text.slice(0, 120), score, isEvent, ts: Date.now() });
  if (st.history.length > MAX_HISTORY) st.history.shift();

  // 更新 centroid（在线均值）
  st.count += 1;
  const w = 1 / st.count;
  for (let i = 0; i < DIM; i++) st.centroid[i] = st.centroid[i] * (1 - w) + vec[i] * w;
  return score;
}

export function driftState(sessionId?: string) {
  if (sessionId) {
    const st = sessions.get(sessionId);
    return st ? { sessionId, ...summarize(st) } : { sessionId, history: [], events: 0, count: 0, driftRate: 0 };
  }
  return [...sessions.entries()].map(([id, st]) => ({ sessionId: id, ...summarize(st) }));
}

function summarize(st: SessionState) {
  const driftRate = st.count >= MIN_SAMPLES ? st.events / st.history.length : 0;
  return {
    history: st.history,
    events: st.events,
    count: st.count,
    driftRate: Number(driftRate.toFixed(3)),
  };
}
