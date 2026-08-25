// Prompt library — JSON-file backed CRUD (mirrors skills/mcp stores).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicWriteJson, readJson } from '../shared/json-store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const FILE = path.join(DATA_DIR, 'prompts.json');

export interface PromptItem {
  id: string;
  name: string;
  content: string;
  variables: string[]; // e.g. ["topic"]
  version: number;
  updatedAt: string;
}

function ensure(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, '[]');
}

function read(): PromptItem[] {
  ensure();
  // 解析失败告警而非静默返回 []（避免"数据丢失"假象），并回退空表
  return readJson<PromptItem[]>(FILE) ?? [];
}

function write(items: PromptItem[]): void {
  ensure();
  atomicWriteJson(FILE, items);
}

function extractVars(content: string): string[] {
  const set = new Set<string>();
  for (const m of content.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)) set.add(m[1]);
  return [...set];
}

export const promptStore = {
  list: (): PromptItem[] => read().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  get: (id: string): PromptItem | undefined => read().find((p) => p.id === id),
  add: (name: string, content: string): PromptItem => {
    const items = read();
    const item: PromptItem = {
      id: `p_${Date.now()}`,
      name,
      content,
      variables: extractVars(content),
      version: 1,
      updatedAt: new Date().toISOString(),
    };
    items.push(item);
    write(items);
    return item;
  },
  update: (id: string, name: string, content: string): PromptItem | undefined => {
    const items = read();
    const item = items.find((p) => p.id === id);
    if (!item) return undefined;
    item.name = name;
    item.content = content;
    item.variables = extractVars(content);
    item.version += 1;
    item.updatedAt = new Date().toISOString();
    write(items);
    return item;
  },
  remove: (id: string): boolean => {
    const items = read();
    const next = items.filter((p) => p.id !== id);
    if (next.length === items.length) return false;
    write(next);
    return true;
  },
};
