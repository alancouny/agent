/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 后端强制鉴权用的 Agent API Key（可选；未设置时回退 localStorage['agent_api_key']） */
  readonly VITE_AGENT_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
