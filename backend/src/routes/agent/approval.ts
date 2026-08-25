/* eslint-disable @typescript-eslint/no-explicit-any */
import { Router, Request, Response } from 'express';
import { isApprovalRequired, setApprovalRequired, logApprovalToggle } from '../../tools/registry.js';
import { getRequestId } from '../../utils/request-context.js';

export const approvalRouter = Router();

// Toggle approval requirement（R4 安全加固）
// 鉴权由全局 auth 中间件覆盖（T01）；此处是第二道防线：关闭审批必须二次确认。
approvalRouter.get('/approval', (_req, res) => {
  res.json({ approvalRequired: isApprovalRequired() });
});

approvalRouter.post('/approval', (req, res) => {
  if (!req.body) return res.status(400).json({ error: 'Request body required' });
  const { enabled, confirm } = req.body;
  if (enabled === undefined || typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled must be a boolean' });
  }
  const prev = isApprovalRequired();
  const actor = `${getRequestId() ?? 'req-unknown'}|${req.ip ?? 'unknown'}`;
  // 关闭审批（enabled=false）必须带 confirm:true，缺省拒绝且开关不变（AC-R4-2）
  if (enabled === false && confirm !== true) {
    logApprovalToggle(prev, prev, actor, 'rejected', 'missing confirm', false);
    return res.status(400).json({ error: 'confirm: true is required to disable approval' });
  }
  setApprovalRequired(enabled);
  logApprovalToggle(prev, enabled, actor, 'ok', null, confirm === true);
  res.json({ approvalRequired: isApprovalRequired() });
});
