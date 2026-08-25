import { existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { atomicWriteJson, readJson } from '../shared/json-store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', '..', 'data');
const STORE_FILE = join(DATA_DIR, 'skills.json');

export interface Skill {
  id: string;
  name: string;
  description: string;
  when: string;
  steps: string[];
  createdAt: string;
  updatedAt: string;
}

const DEFAULT_SKILLS: Skill[] = [
  {
    id: 'skill-web-research',
    name: 'Web Research',
    description: 'Search the web, fetch pages, extract facts, and summarize findings.',
    when: 'Use when the user asks about current events, facts, or anything requiring live web data.',
    steps: [
      'Parse the user request into a search query.',
      'Call the web_search tool with the query.',
      'Extract relevant facts and cite source URLs.',
      'Return a structured summary with references.',
    ],
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  },
  {
    id: 'skill-code-debug',
    name: 'Code Debug',
    description: 'Systematically debug broken code by reading, analyzing, and testing.',
    when: 'Use when the user reports an error, unexpected behavior, or asks to fix code.',
    steps: [
      'Read the relevant source files with read_file.',
      'Read error output or logs.',
      'Form a hypothesis about the root cause.',
      'Make the minimal fix with write_file.',
      'Verify by re-reading or re-running.',
    ],
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  },
];

function ensureStore(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(STORE_FILE)) {
    atomicWriteJson(STORE_FILE, DEFAULT_SKILLS);
  }
}

// 内存缓存：skills 会在每个 agent turn 被 loadSkills 读取，避免反复读盘
let cache: Skill[] | null = null;

function readAll(): Skill[] {
  if (cache) return cache;
  ensureStore();
  cache = readJson<Skill[]>(STORE_FILE) ?? [];
  return cache;
}

function writeAll(list: Skill[]): void {
  ensureStore();
  atomicWriteJson(STORE_FILE, list);
  cache = list; // 写后同步缓存
}

export const skillStore = {
  list(): Skill[] {
    return readAll();
  },
  get(id: string): Skill | undefined {
    return readAll().find(s => s.id === id);
  },
  add(data: Omit<Skill, 'id' | 'createdAt' | 'updatedAt'>): Skill {
    const list = readAll();
    const now = new Date().toISOString().slice(0, 10);
    const entry: Skill = { ...data, id: `skill-${uuidv4().slice(0, 8)}`, createdAt: now, updatedAt: now };
    list.push(entry);
    writeAll(list);
    return entry;
  },
  update(id: string, patch: Partial<Skill>): Skill | undefined {
    const list = readAll();
    const idx = list.findIndex(s => s.id === id);
    if (idx === -1) return undefined;
    list[idx] = { ...list[idx], ...patch, updatedAt: new Date().toISOString().slice(0, 10) };
    writeAll(list);
    return list[idx];
  },
  remove(id: string): boolean {
    const list = readAll();
    const next = list.filter(s => s.id !== id);
    if (next.length === list.length) return false;
    writeAll(next);
    return true;
  },
};
