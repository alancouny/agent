/* eslint-disable @typescript-eslint/no-explicit-any */
// ============================================================
// isolated-vm 真沙箱 — run_code 的隔离执行环境。
//
// 为什么不用 node:vm：vm 沙箱可经原型链/构造函数逃逸到宿主进程。
// isolated-vm 是独立 V8 isolate：无 process/require 全局、
// 128MB 内存硬限制（超限自动 dispose）、原生 30s 执行超时。
// 沙箱自带标准全局（JSON/Math/Date/Object/Array/Error 等）。
//
// 执行模型（回调模式）：ivm 6.x 的 `result:{promise:true}` 顶层
// 集成在此环境解析为 undefined，因此改为——沙箱内 async 代码
// await 宿主工具桥（Reference.apply + promise:true，已验证可用），
// 最终通过 hostDone 回调把结果送回宿主 Promise。
// ============================================================

import ivm from 'isolated-vm';

export interface SandboxDeps {
  /** 工具桥：宿主的工具执行（async）。 */
  toolsCall: (name: string, args: Record<string, unknown>) => Promise<string>;
  /** 工具清单。 */
  toolsList: () => string[];
}

export interface SandboxResult {
  value: string;
  logs: string[];
  timedOut: boolean;
  memoryLimited: boolean;
}

const DEFAULT_MEMORY_LIMIT_MB = 128;
const DEFAULT_TIMEOUT_MS = 30_000;

/** 编译沙箱桥接脚本并注入依赖（一次执行一个 isolate）。 */
export async function runInIsolatedVm(
  userCode: string,
  deps: SandboxDeps,
  opts: { memoryLimitMb?: number; timeoutMs?: number } = {}
): Promise<SandboxResult> {
  const memoryLimitMb = opts.memoryLimitMb ?? DEFAULT_MEMORY_LIMIT_MB;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const logLines: string[] = [];
  let timedOut = false;
  let memoryLimited = false;

  const isolate = new ivm.Isolate({ memoryLimit: memoryLimitMb });
  try {
    const context = await isolate.createContext();
    const jail = context.global;

    await jail.set('hostLog', new ivm.Reference((...args: unknown[]) => {
      logLines.push(args.map((x) => (typeof x === 'string' ? x : safeStringify(x))).join(' '));
    }));
    await jail.set('hostCall', new ivm.Reference(deps.toolsCall));
    await jail.set('hostList', new ivm.Reference(() => deps.toolsList()));

    const result = await new Promise<string>((resolve, reject) => {
      const doneRef = new ivm.Reference((err: string | null, val: string | null) => {
        clearTimeout(timer);
        if (err) reject(new Error(err));
        else resolve(val ?? '');
      });

      // 执行超时：dispose isolate 杀停沙箱，按"空结果 + timedOut 标记"返回
      const timer = setTimeout(() => {
        timedOut = true;
        try { isolate.dispose(); } catch { /* already disposed */ }
        resolve('');
      }, timeoutMs);

      jail.set('hostDone', doneRef)
        .then(() => {
          const bridge = `
            const toStr = (x) => typeof x === 'string' ? x : (x === undefined ? 'undefined' : JSON.stringify(x));
            const console = {
              log: (...a) => hostLog.apply(undefined, a.map(toStr), { arguments: { copy: true } }),
              error: (...a) => hostLog.apply(undefined, a.map(x => 'ERR ' + toStr(x)), { arguments: { copy: true } }),
              warn: (...a) => hostLog.apply(undefined, a.map(x => 'WARN ' + toStr(x)), { arguments: { copy: true } }),
            };
            const tools = {
              call: (name, args) => hostCall.apply(undefined, [name, args || {}], { arguments: { copy: true }, result: { promise: true } }),
              list: () => hostList.applySync(undefined, [], { result: { copy: true } }),
            };
            (async () => {
              try {
                const result = await (async () => {
                  ${userCode}
                })();
                hostDone.apply(undefined, [null, typeof result === 'string' ? result : JSON.stringify(result)], { arguments: { copy: true } });
              } catch (e) {
                hostDone.apply(undefined, [String((e && e.message) || e), null], { arguments: { copy: true } });
              }
            })()
          `;
          return isolate.compileScript(bridge).then((script) => script.run(context));
        })
        .catch((e: unknown) => {
          clearTimeout(timer);
          // 内存超限时 ivm 自动 dispose isolate → 宿主引用调用抛 disposed 错误
          const msg = (e as any)?.message || '';
          if (/disposed|dispose/i.test(String(msg))) {
            memoryLimited = true;
            resolve('');
          } else {
            reject(new Error(msg || 'sandbox setup failed'));
          }
        });
    });

    return { value: result, logs: logLines, timedOut, memoryLimited };
  } finally {
    try {
      isolate.dispose();
    } catch { /* 内存超限时已自动 dispose */ }
  }
}

function safeStringify(x: unknown): string {
  try {
    return JSON.stringify(x) ?? String(x);
  } catch {
    return String(x);
  }
}
