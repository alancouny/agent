import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './i18n'
import App from './App.tsx'
import { initTheme } from './theme.ts'

// 应用持久化的主题（深色/浅色/跟随系统）+ 强调色，必须在首次渲染前执行以防闪烁。
initTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
