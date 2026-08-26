/* eslint-disable @typescript-eslint/no-explicit-any */
import { toolRegistry } from './registry.js';
import { writeFileContent, readFileContent, resolveWorkspaceRoot, WorkspaceAccessError } from '../workspace/fs.js';

// ========== Calculator Tool ==========
/**
 * Safely evaluate a math expression without eval/Function.
 * Supports: +, -, *, /, **, %, parentheses, decimals, leading minus.
 */
function safeEvalExpr(expr: string): number {
  // Strip everything that isn't part of a valid numeric expression
  const cleaned = expr.replace(/[^0-9+\-*/%.()\s]/g, '').replace(/\s+/g, ' ').trim();
  if (!cleaned) throw new Error('Empty expression');

  // Tokenize into numbers and operators ('**' must match before '*')
  const tokens: (string | number)[] = [];
  const re = /(\d+\.?\d*|\*\*|[+\-*/%()])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) tokens.push(m[1]);

  if (tokens.length === 0) throw new Error('Invalid expression');

  // Recursive-descent parser: expr → term → factor(power)
  let pos = 0;
  function peek(): string | number | undefined { return tokens[pos]; }
  function consume(): string | number { return tokens[pos++]; }

  function parseExpr(): number {
    let left = parseTerm();
    while (peek() === '+' || peek() === '-') {
      const op = consume();
      const right = parseTerm();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }
  function parseTerm(): number {
    let left = parsePower();
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = consume();
      const right = parsePower();
      if (op === '*') left = left * right;
      else if (op === '/') {
        if (right === 0) throw new Error('Division by zero');
        left = left / right;
      } else left = left % right;
    }
    return left;
  }
  /** 幂运算：右结合（2**3**2 = 2**(3**2)），优先级高于乘除。 */
  function parsePower(): number {
    const base = parseFactor();
    if (peek() === '**') {
      consume();
      return Math.pow(base, parsePower());
    }
    return base;
  }
  function parseFactor(): number {
    if (peek() === '-') { consume(); return -parseFactor(); }
    if (peek() === '+') { consume(); return parseFactor(); }
    if (peek() === '(') {
      consume(); // '('
      const val = parseExpr();
      if (peek() !== ')') throw new Error('Mismatched parentheses');
      consume(); // ')'
      return val;
    }
    const tok = consume();
    if (typeof tok !== 'string' || isNaN(Number(tok))) throw new Error('Unexpected token');
    return Number(tok);
  }

  const result = parseExpr();
  if (pos !== tokens.length) throw new Error('Trailing tokens');
  return result;
}

toolRegistry.register('calculator', {
  schema: {
    name: 'calculator',
    description: 'Perform mathematical calculations (+, -, *, /, **, %)',
    parameters: {
      type: 'object',
      properties: {
        expression: { type: 'string', description: 'Math expression to evaluate, e.g. "2 + 3 * 4"' }
      },
      required: ['expression']
    }
  },
  handler: async ({ expression }) => {
    try {
      const result = safeEvalExpr(expression as string);
      return { success: true, output: `Result: ${result}`, data: { result } };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Invalid expression';
      return { success: false, output: `Invalid expression: ${msg}`, error: msg };
    }
  },
  category: 'utility',
  requiresApproval: false,
  readOnly: true,
  enabled: true,
});

// ========== Web Search Tool ==========
toolRegistry.register('web_search', {
  schema: {
    name: 'web_search',
    description: 'Search the web for current information. Returns up to 5 search results.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query string' }
      },
      required: ['query']
    }
  },
  handler: async ({ query }) => {
    try {
      const { default: axios } = await import('axios');
      const response = await axios.get('https://api.duckduckgo.com/', {
        params: { q: query, format: 'json', no_html: 1, skip_disambig: 1 },
        timeout: 8000, // 快速失败，避免工具挂死
      });
      const results = response.data?.AbstractText
        ? [{ title: 'Summary', snippet: response.data.AbstractText }]
        : [{ title: 'No results', snippet: 'No web search results found. Try a more specific query.' }];
      return { success: true, output: JSON.stringify(results, null, 2), data: results };
    } catch {
      // 不返回 mock 结果——如实上报失败，避免 Agent 把假结果当真实信息使用
      return { success: false, output: 'Web search unavailable (timeout or network error)', error: 'SEARCH_UNAVAILABLE' };
    }
  },
  category: 'search',
  requiresApproval: false,
  readOnly: true,
  enabled: true,
});

// ========== File Reader Tool ==========
toolRegistry.register('read_file', {
  schema: {
    name: 'read_file',
    description: 'Read the contents of a file from the configured workspace. Path must resolve inside the workspace root (WORKSPACE_ROOT or cwd).',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path inside the workspace (relative or absolute)' }
      },
      required: ['path']
    }
  },
  handler: async ({ path: filePath }: any) => {
    try {
      // 安全约束：读取必须落在配置的工作区（WORKSPACE_ROOT / cwd）内，禁止任意绝对路径
      const root = resolveWorkspaceRoot();
      const result = await readFileContent(root, filePath);
      const content = result.encoding === 'base64' ? `[base64, size=${result.size}]` : result.content;
      const maxLen = 10000;
      const truncated = content.length > maxLen ? content.slice(0, maxLen) + '\n... [truncated]' : content;
      return { success: true, output: truncated, data: { path: result.name, size: result.size } };
    } catch (e: unknown) {
      const msg = e instanceof WorkspaceAccessError ? e.message : ((e as Error).message || 'Read failed');
      return { success: false, output: `Read failed: ${msg}`, error: msg };
    }
  },
  category: 'filesystem',
  requiresApproval: true,
  enabled: true,
});

// ========== Write File Tool ==========
toolRegistry.register('write_file', {
  schema: {
    name: 'write_file',
    description: 'Write content to a file on the local filesystem. Will overwrite existing files.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to write to' },
        content: { type: 'string', description: 'Content to write to the file' }
      },
      required: ['path', 'content']
    }
  },
  handler: async ({ path: filePath, content }: any) => {
    try {
      const root = resolveWorkspaceRoot();
      await writeFileContent(root, filePath, content, 'utf-8');
      const bytes = Buffer.byteLength(String(content), 'utf-8');
      return { success: true, output: `File written: ${filePath} (${bytes} bytes)` };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Write failed';
      return { success: false, output: `Write failed: ${msg}`, error: msg };
    }
  },
  category: 'filesystem',
  requiresApproval: true,
  enabled: true,
});

// ========== Code Executor Tool ==========
// ⚠️ 安全说明：Node 内置 vm 不是真正的安全边界，恶意代码可通过原型链
// （如 this.constructor.constructor('return process')()）逃逸。
// 本工具已下线（enabled: false）：保留实现便于回滚，但不再注册为可用工具，
// getSchemas() / /api/agent/tools 均不暴露。唯一代码执行入口是 run_code
// （backend/src/tools/agent-meta-tools.ts，isolated-vm 真沙箱）。
toolRegistry.register('execute_code', {
  schema: {
    name: 'execute_code',
    description: 'Execute JavaScript/TypeScript code in a restricted environment (requires approval). Results are returned as text.',
    parameters: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'JavaScript code to execute' },
        language: { type: 'string', enum: ['javascript', 'typescript'], description: 'Language of the code' }
      },
      required: ['code']
    }
  },
  handler: async ({ code }: any) => {
    const MAX_OUTPUT = 10000;
    try {
      const vm = await import('vm');
      const outputs: string[] = [];
      const sandbox: Record<string, unknown> = {
        console: {
          log: (...args: unknown[]) => {
            const line = args.map(String).join(' ');
            if (outputs.join('\n').length + line.length > MAX_OUTPUT) return;
            outputs.push(line);
          },
          error: (...args: unknown[]) => {
            const line = args.map(String).join(' ');
            if (outputs.join('\n').length + line.length > MAX_OUTPUT) return;
            outputs.push(line);
          },
        },
        setTimeout: () => 0,
        clearTimeout: () => {},
        // 遮蔽常见逃逸入口（进程/模块/缓冲访问）
        process: undefined,
        require: undefined,
        Buffer: undefined,
        globalThis: undefined,
        global: undefined,
      };
      const context = vm.createContext(sandbox);
      const script = new vm.Script(code);
      const result = script.runInContext(context, { timeout: 5000 });
      const output = outputs.join('\n');
      return {
        success: true,
        output: output || (result !== undefined ? String(result).slice(0, MAX_OUTPUT) : 'Code executed (no output)'),
        data: { result: result !== undefined ? String(result).slice(0, MAX_OUTPUT) : undefined },
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Execution error';
      return { success: false, output: `Execution error: ${msg}`, error: msg };
    }
  },
  category: 'development',
  requiresApproval: true,
  // 下线：node:vm 非安全边界，可能原型链逃逸。统一使用 run_code（isolated-vm）。
  enabled: false,
});

// ========== Weather Tool ==========
toolRegistry.register('weather', {
  schema: {
    name: 'weather',
    description: 'Get current weather information for a city. Returns temperature, conditions, and humidity.',
    parameters: {
      type: 'object',
      properties: {
        city: { type: 'string', description: 'City name (e.g. "Beijing", "New York", "London")' }
      },
      required: ['city']
    }
  },
  handler: async ({ city }) => {
    try {
      const { default: axios } = await import('axios');
      const geo = await axios.get('https://geocoding-api.open-meteo.com/v1/search', {
        params: { name: city, count: 1, language: 'en', format: 'json' },
        timeout: 8000,
      });
      if (geo.data.results?.[0]) {
        const { latitude, longitude, name } = geo.data.results[0];
        const weather = await axios.get('https://api.open-meteo.com/v1/forecast', {
          params: { latitude, longitude, current_weather: true, temperature_unit: 'celsius' },
          timeout: 8000,
        });
        const w = weather.data.current_weather;
        return {
          success: true,
          output: `${name}: ${w.temperature}°C, ${w.weathercode === 0 ? 'Clear' : 'Cloudy'}, Wind ${w.windspeed} km/h`,
          data: { city: name, temperature: w.temperature, weatherCode: w.weathercode, windSpeed: w.windspeed }
        };
      }
      // 地理编码无结果：城市名无法识别（区别于服务不可用）
      return { success: false, output: `City not found: ${city}`, error: 'CITY_NOT_FOUND' };
    } catch {
      // 网络错误 / 超时：如实上报失败，不返回模拟数据
      return { success: false, output: `Weather lookup failed for ${city}: service unavailable`, error: 'WEATHER_API_UNAVAILABLE' };
    }
  },
  category: 'search',
  requiresApproval: false,
  readOnly: true,
  enabled: true,
});

// ========== Current Time Tool ==========
toolRegistry.register('current_time', {
  schema: {
    name: 'current_time',
    description: 'Get the current date and time in the local timezone.',
    parameters: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  handler: async () => {
    const now = new Date();
    return {
      success: true,
      output: `Current time: ${now.toLocaleString()}`,
      data: { iso: now.toISOString(), timestamp: now.getTime() }
    };
  },
  category: 'utility',
  requiresApproval: false,
  readOnly: true,
  enabled: true,
});

export function getBuiltinTools(): string[] {
  return toolRegistry.getAll().map(([name]) => name);
}