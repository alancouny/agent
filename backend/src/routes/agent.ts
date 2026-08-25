/* eslint-disable @typescript-eslint/no-explicit-any */
import { Router } from 'express';
import { chatRouter } from './agent/chat.js';
import { toolsRouter } from './agent/tools.js';
import { approvalRouter } from './agent/approval.js';
import { modelsRouter } from './agent/models.js';
import { sessionsRouter } from './agent/sessions.js';
import { contextRouter } from './agent/context.js';

export const agentRouter = Router();

// ── D1：routes/agent.ts 拆分 ──
// 单一巨型路由（498 行）按职责拆分为子路由，路径与行为完全保持一致：
//   /chat            → chatRouter        (SSE / 非流式对话，事件总线驱动)
//   /tools,/tools/*  → toolsRouter       (工具列表 / 执行 / 审批 / 状态)
//   /settings/*      → approvalRouter     (审批开关，二次确认)
//   /test-*,/compare → modelsRouter       (模型连通性测试 / 多模型对比)
//   /search,/fork,/tokens,/trajectory,/steer → sessionsRouter (会话级操作)
//   /context/*       → contextRouter      (上下文压缩)
agentRouter.use('/chat', chatRouter);
agentRouter.use('/tools', toolsRouter);
agentRouter.use('/settings', approvalRouter);
agentRouter.use('/', modelsRouter);
agentRouter.use('/', sessionsRouter);
agentRouter.use('/context', contextRouter);

export {
  chatRouter,
  toolsRouter,
  approvalRouter,
  modelsRouter,
  sessionsRouter,
  contextRouter,
};
