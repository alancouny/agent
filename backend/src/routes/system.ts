// ============================================================
// System monitoring — real-time CPU / memory / network stats.
//   GET /api/system/stats
//
// CPU 采用两次采样差值（跨平台：os.cpus() 空闲时间差）；
// 网络速率按平台读取累计字节（Linux: /proc/net/dev，macOS: netstat -ib）。
// 1 秒内重复请求返回缓存，避免高频采样抖动。
// ============================================================

import { Router } from 'express';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../utils/logger.js';
import { logError, safeErrorMessage } from '../utils/error-mask.js';

const execFileP = promisify(execFile);

export const systemRouter = Router();

interface CpuSample { idle: number; total: number; }
interface NetSample { rx: number; tx: number; }

let prevCpu: CpuSample | null = null;
let prevNet: NetSample | null = null;
let prevAt = 0;
let cached: SystemStats | null = null;
let cachedAt = 0;

export interface SystemStats {
  cpu: { usage: number | null; cores: number; model: string; loadAvg: number[] };
  memory: { total: number; free: number; used: number; percent: number };
  net: { rxRate: number; txRate: number; rxTotal: number; txTotal: number } | null;
  uptime: number;
  hostname: string;
  platform: string;
  timestamp: number;
}

function readCpuSample(): CpuSample {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const c of cpus) {
    for (const key of Object.keys(c.times) as (keyof typeof c.times)[]) {
      total += c.times[key];
    }
    idle += c.times.idle;
  }
  return { idle, total };
}

/** 平台相关：读取网络接口累计字节。失败返回 null（首次采样/不支持平台）。 */
async function readNetSample(): Promise<NetSample | null> {
  try {
    if (process.platform === 'linux') {
      const { stdout } = await execFileP('cat', ['/proc/net/dev']);
      let rx = 0;
      let tx = 0;
      for (const line of stdout.split('\n').slice(2)) {
        const m = line.match(/:\s*(\d+)\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+(\d+)/);
        if (m) {
          rx += Number(m[1]);
          tx += Number(m[2]);
        }
      }
      return { rx, tx };
    }
    if (process.platform === 'darwin') {
      // macOS: netstat -ib -n 输出含 Ibytes/Obytes 列
      const { stdout } = await execFileP('netstat', ['-ib', '-n']);
      let rx = 0;
      let tx = 0;
      for (const line of stdout.split('\n')) {
        const parts = line.trim().split(/\s+/);
        // lo0/utun 虚拟接口不计入物理流量
        if (parts.length >= 11 && !/^(lo0|utun|awdl|llw|en0[0-9])/.test(parts[0])) {
          const ib = Number(parts[6] ?? 0);
          const ob = Number(parts[9] ?? 0);
          if (Number.isFinite(ib) && Number.isFinite(ob)) {
            rx += ib;
            tx += ob;
          }
        }
      }
      return { rx, tx };
    }
  } catch { /* net stats unsupported */ }
  return null;
}

async function collect(): Promise<SystemStats> {
  const cpuSample = readCpuSample();
  const netSample = await readNetSample();
  const now = Date.now();

  let cpuUsage: number | null = null;
  if (prevCpu) {
    const dIdle = cpuSample.idle - prevCpu.idle;
    const dTotal = cpuSample.total - prevCpu.total;
    if (dTotal > 0) cpuUsage = Math.max(0, Math.min(100, 100 * (1 - dIdle / dTotal)));
  }
  prevCpu = cpuSample;

  let net: SystemStats['net'] = null;
  if (netSample && prevNet) {
    const dt = (now - prevAt) / 1000;
    if (dt > 0) {
      net = {
        rxRate: Math.max(0, (netSample.rx - prevNet.rx) / dt),
        txRate: Math.max(0, (netSample.tx - prevNet.tx) / dt),
        rxTotal: netSample.rx,
        txTotal: netSample.tx,
      };
    }
  }
  prevNet = netSample;
  prevAt = now;

  const mem = os.totalmem();
  const free = os.freemem();
  const stats: SystemStats = {
    cpu: {
      usage: cpuUsage,
      cores: os.cpus().length,
      model: os.cpus()[0]?.model || 'unknown',
      loadAvg: os.loadavg(),
    },
    memory: { total: mem, free, used: mem - free, percent: Math.round((100 * (mem - free)) / mem) },
    net,
    uptime: os.uptime(),
    hostname: os.hostname(),
    platform: `${process.platform} ${process.arch}`,
    timestamp: now,
  };
  return stats;
}

systemRouter.get('/stats', async (_req, res) => {
  try {
    const now = Date.now();
    // 1s 缓存：监控面板 2s 轮询 + 多个客户端时不重复采样
    if (cached && now - cachedAt < 1000) {
      return res.json({ ...cached, net: cached.net });
    }
    cached = await collect();
    cachedAt = now;
    res.json(cached);
  } catch (err: unknown) {
    logError(logger, 'system:stats', err);
    // 错误响应体脱敏（AC-R3-2）
    const message = safeErrorMessage(err instanceof Error ? err.message : 'Failed to collect system stats');
    res.status(500).json({ error: message });
  }
});
