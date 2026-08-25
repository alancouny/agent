import '@testing-library/jest-dom/vitest';

// jsdom 不实现 matchMedia —— 主题模块（src/theme.ts）在模块顶层调用它。
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

// jsdom 不实现 scrollIntoView / scrollTo —— AgentChat 等组件会调用。
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn();
}
if (typeof HTMLElement !== 'undefined' && !HTMLElement.prototype.scrollTo) {
  HTMLElement.prototype.scrollTo = vi.fn();
}

// i18n 初始化是异步的：等它 ready，否则 useTranslation 会 suspend 或返回 key。
import i18n from '../i18n';
if (!i18n.isInitialized) {
  await new Promise<void>((resolve) => {
    if (i18n.isInitialized) return resolve();
    i18n.on('initialized', () => resolve());
  });
}

// 过滤 React Testing Library 的 act() 异步更新警告。
// 原因：组件 mount 时有 Promise-based useEffect（getTools/getMessages），
// setState 调度到 act() 之后的微任务，React 会报此警告但功能完全正常。
// 保留其他 console.error 以便暴露真实问题。
const _origError = console.error;
console.error = (...args: unknown[]) => {
  const msg = String(args[0] ?? '');
  if (msg.includes('not wrapped in act') || msg.includes('An update')) return;
  _origError(...args);
};
