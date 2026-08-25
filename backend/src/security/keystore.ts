/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const KEYRING_SERVICE = 'ai-agent-app';
const KEYRING_ACCOUNT = 'agent-api-key';

export interface KeyStore {
  /** 返回当前 key；若不存在则生成并持久化。created=true 表示本次为首次创建。 */
  getOrCreate(): { key: string; created: boolean };
  /** 读取已持久化的 key（无则返回 null）。 */
  get(): string | null;
}

/**
 * 文件持久化 keystore（默认，零依赖）。
 * - 跨重启稳定：首次生成后写入磁盘，后续启动复用，不再每次随机重建。
 * - 0600 权限：仅属主可读写。
 * - 路径可由 AGENT_KEY_FILE 覆盖（便于测试隔离）。
 */
export class FileKeyStore implements KeyStore {
  private keyFile(): string {
    return process.env.AGENT_KEY_FILE
      ? path.resolve(process.env.AGENT_KEY_FILE)
      : path.join(DATA_DIR, '.agent_key');
  }

  get(): string | null {
    try {
      return fs.readFileSync(this.keyFile(), 'utf-8').trim() || null;
    } catch {
      return null;
    }
  }

  getOrCreate(): { key: string; created: boolean } {
    const existing = this.get();
    if (existing) return { key: existing, created: false };

    const key = `agent-${randomBytes(24).toString('hex')}`;
    try {
      fs.mkdirSync(path.dirname(this.keyFile()), { recursive: true });
      fs.writeFileSync(this.keyFile(), key, { mode: 0o600 });
      // 显式再 chmod，规避 umask 影响
      fs.chmodSync(this.keyFile(), 0o600);
    } catch {
      // 写入失败（如只读文件系统）：仍返回内存 key 供本次进程使用，但不持久化
      return { key, created: true };
    }
    return { key, created: true };
  }
}

/**
 * OS 密钥库（可选后端）：若安装 @napi-rs/keyring 则使用系统钥匙串（macOS Keychain /
 * Windows Credential Manager / Linux libsecret），否则回退文件持久化。
 * 通过 createRequire 同步加载原生模块；缺失时静默回退。
 */
class OsKeyStore implements KeyStore {
  private fallback = new FileKeyStore();
  constructor(private kr: any) {}

  get(): string | null {
    try {
      return this.kr.getPassword(KEYRING_ACCOUNT) || null;
    } catch {
      return this.fallback.get();
    }
  }

  getOrCreate(): { key: string; created: boolean } {
    try {
      const existing = this.kr.getPassword(KEYRING_ACCOUNT);
      if (existing) return { key: existing, created: false };
      const key = `agent-${randomBytes(24).toString('hex')}`;
      this.kr.setPassword(KEYRING_ACCOUNT, key);
      return { key, created: true };
    } catch {
      return this.fallback.getOrCreate();
    }
  }
}

function loadKeyringModule(): any | null {
  try {
    const require = createRequire(import.meta.url);
    return require('@napi-rs/keyring');
  } catch {
    return null; // 未安装 → 使用文件 keystore
  }
}

let singleton: KeyStore | null = null;

/** 返回全局 keystore 单例（OS 钥匙串优先，缺失回退文件）。 */
export function getKeyStore(): KeyStore {
  if (singleton) return singleton;
  const kr = loadKeyringModule();
  singleton = kr ? new OsKeyStore(kr) : new FileKeyStore();
  return singleton;
}

/** 仅供测试：重置单例。 */
export function _resetKeyStoreForTest(): void {
  singleton = null;
}
