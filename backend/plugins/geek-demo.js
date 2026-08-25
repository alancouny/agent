// 示例插件：演示标准插件接口（纯 JS，ESM）。
// 放入 backend/plugins/ 后由服务启动时自动加载，或在面板点 Reload。
// 可在此文件同目录新增更多 *.js 插件；每个文件一个插件。

export default {
  name: 'geek-demo',
  version: '1.0.0',
  description:
    'Geek toolbox demo plugin — try: fortune (随机极客格言), fib <n> (斐波那契), ascii <text> (文本转 ASCII 风格), cointoss (抛硬币)',
  commands: {
    /** 随机极客格言 */
    fortune: async () => {
      const quotes = [
        'There are only two hard things in CS: cache invalidation and naming things.',
        'Premature optimization is the root of all evil.',
        'Simplicity is the soul of efficiency.',
        'Debugging is twice as hard as writing the code in the first place.',
        'The best way to predict the future is to invent it.',
        'Code is like humor. When you have to explain it, it is bad.',
        'First, solve the problem. Then, write the code.',
      ];
      const pick = quotes[Math.floor(Math.random() * quotes.length)];
      return { ok: true, output: '  "' + pick + '"' };
    },

    /** 斐波那契数列 */
    fib: async (args) => {
      const n = Math.min(Number(args[0]) || 10, 80);
      const seq = [0, 1];
      while (seq.length < n) seq.push(seq[seq.length - 1] + seq[seq.length - 2]);
      return { ok: true, output: 'fib(' + n + ') = [' + seq.slice(0, n).join(', ') + ']' };
    },

    /** 文本转方块 ASCII banner */
    ascii: async (args) => {
      const text = (args.join(' ') || 'GEEK').toUpperCase();
      const block = text.split('').map((ch) => ch + ch + ch).join('');
      const bar = '─'.repeat(block.length);
      return { ok: true, output: '┌─' + bar + '─┐\n│ ' + block + ' │\n└─' + bar + '─┘' };
    },

    /** 抛硬币 */
    cointoss: async () => {
      const result = Math.random() < 0.5 ? 'HEADS' : 'TAILS';
      return { ok: true, output: '🪙  ' + result + (Math.random() < 0.05 ? ' (lucky!)' : '') };
    },
  },
};
