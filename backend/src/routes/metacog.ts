// Agent 元认知 API：
//   GET /api/metacog/estimates?sessionId=  — 最近预测记录 + 校准分桶
import { Router } from 'express';
import { listCostEstimates, calibrationBins } from '../telemetry/metacog.js';

export const metacogRouter = Router();

metacogRouter.get('/estimates', (req, res) => {
  const sessionId = typeof req.query.sessionId === 'string' && req.query.sessionId ? req.query.sessionId : undefined;
  const estimates = listCostEstimates(sessionId);
  res.json({
    estimates,
    count: estimates.length,
    calibration: calibrationBins(estimates),
  });
});
