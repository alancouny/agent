// ============================================================
// chat 子组件共享类型（AgentChat 容器 ↔ 子组件 的 props 契约）。
// ============================================================

/** 流式响应完成后的真实 usage 统计（后端随 text 事件的 usage 字段下发）。 */
export interface StreamUsage {
  totalTokens: number;
  completionTokens: number;
  promptTokens: number;
  tokensPerSecond: number;
  elapsedSeconds: number;
}

/** 待审批工具卡数据（approval_pending 事件）。 */
export interface PendingApproval {
  toolName: string;
  args: Record<string, unknown>;
  approvalKey: string;
  output: string;
}
