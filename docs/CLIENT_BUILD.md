# 客户端构建指南（Tauri v2 全平台）

本项目前端是 React + Vite，桌面与移动端统一通过 **Tauri v2** 打包为原生客户端，
复用同一套 `src/` 代码，无需为每个平台重写界面。

## 平台支持矩阵

| 平台 | 技术 | 状态 |
|------|------|------|
| Windows / macOS / Linux | Tauri 桌面壳（系统 WebView） | ✅ 可构建 |
| iOS / Android | Tauri 移动端（WKWebView / Android WebView） | ⚠️ 需工具链后构建 |
| Tablet（iPad / 安卓平板横屏） | 前端响应式布局 | ✅ 已适配（<768px 抽屉式导航） |

## 前置工具链

### 通用

- **Node.js ≥ 20**（前端构建）
- **Rust ≥ 1.85**（Tauri 编译，需支持 edition2024）：
  ```bash
  rustup update stable
  rustc --version   # 应 ≥ 1.85
  ```

### 桌面端（macOS 示例）

```bash
cargo install --locked tauri-cli   # 或用项目内 npx tauri
npx tauri build                     # 产出 dmg/app（macOS）、msi/exe（Windows）、AppImage/deb（Linux）
```

### 移动端

- **Android**：Android Studio + Android SDK（设置 `ANDROID_HOME`）+ JDK 17
- **iOS**：Xcode（macOS 专用）+ CocoaPods：
  ```bash
  sudo gem install cocoapods
  ```

初始化与构建（工具链就绪后执行一次）：

```bash
npx tauri android init      # 生成 android/ 工程
npx tauri ios init          # 生成 ios/ 工程（仅 macOS）
npx tauri android build     # 产出 APK/AAB
npx tauri ios build         # 产出 ipa
```

## 网络架构：双模式（本地 / 远程）

移动端系统沙盒**禁止运行本地 Node 进程**，因此：

- **桌面端**：默认连接本地 backend（`http://localhost:3001`，Tauri 环境自动检测）
- **移动端**：在 `设置 → 通用 → API 服务器地址` 填写远程服务器地址（如
  `https://api.your-server.com`），所有请求自动带该前缀

地址持久化于 `localStorage['api_base_url']`；切换后保存并刷新页面生效。

### 移动端网络权限

- **Android**：`android/app/src/main/AndroidManifest.xml` 需包含
  `<uses-permission android:name="android.permission.INTERNET" />`（tauri android init 默认已含）。
- **iOS**：远程地址必须为 HTTPS（ATS 要求）；如需 HTTP 调试，在
  `ios/App/Info.plist` 配置 `NSAppTransportSecurity → NSAllowsArbitraryLoads`。
- 语音/录音：Android `RECORD_AUDIO`、iOS `NSMicrophoneUsageDescription`（按需添加）。

## 开发调试

```bash
npm run dev        # Web 开发（vite :5173 → 代理 :3001）
npx tauri dev      # 桌面客户端开发（自动跑 beforeDevCommand）
```

前端 API 地址逻辑见 `src/apiConfig.ts`（`getApiBase` / `apiUrl`）；Tauri 环境
（`window.__TAURI_INTERNALS__`）默认返回 `http://localhost:3001`，Web 开发走相对路径代理。
