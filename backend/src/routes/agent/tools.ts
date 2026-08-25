/* eslint-disable @typescript-eslint/no-explicit-any */
import { Router, Request, Response } from 'express';
import { toolRegistry, executeTool, getToolApprovals, setApprovalWithTTL } from '../../tools/registry.js';

export const toolsRouter = Router();

// List available tools (enabled only — disabled tools like the decommissioned
// execute_code are not exposed to the client or the LLM).
toolsRouter.get('/', (_req, res) => {
  const tools = toolRegistry
    .getAll()
    .filter(([, def]) => def.enabled)
    .map(([name, def]) => ({
      name,
      description: def.schema.description,
      category: def.category,
      requiresApproval: def.requiresApproval,
      enabled: def.enabled,
      schema: def.schema,
    }));
  res.json({ tools });
});

// Execute a single tool
toolsRouter.post('/execute', async (req, res) => {
  if (!req.body) return res.status(400).json({ error: 'Request body required' });
  const { toolName, args, sessionId, approvalToken } = req.body;
  if (!toolName) return res.status(400).json({ error: 'toolName is required' });
  const result = await executeTool(toolName, args || {}, {
    sessionId: sessionId || 'direct',
    approvalToken,
  });
  res.json(result);
});

// Approve or deny a pending tool execution
toolsRouter.post('/approve', (req, res) => {
  if (!req.body) return res.status(400).json({ error: 'Request body required' });
  const { approvalKey, action } = req.body;
  if (!approvalKey) return res.status(400).json({ error: 'approvalKey required' });
  if (!action || (action !== 'approve' && action !== 'deny')) {
    return res.status(400).json({ error: 'action must be "approve" or "deny"' });
  }

  if (action === 'deny') {
    setApprovalWithTTL(approvalKey, '__DENIED__');
    return res.json({ ok: true, action: 'denied' });
  }
  setApprovalWithTTL(approvalKey, approvalKey);
  return res.json({ ok: true, action: 'approved' });
});

// Debug: read approval state (denied/approved/pending) for a key
toolsRouter.get('/approval-state', (req, res) => {
  const { key } = req.query;
  if (!key) return res.status(400).json({ error: 'key is required' });
  const approvals = getToolApprovals();
  const state = approvals.get(key as string);
  if (!state) return res.json({ state: 'pending' });
  if (state === '__DENIED__') return res.json({ state: 'denied' });
  return res.json({ state: 'approved' });
});
