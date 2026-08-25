import express from 'express';
import { logger } from '../utils/logger.js';
import { logError } from '../utils/error-mask.js';

export const videoRouter = express.Router();

videoRouter.post('/generate', async (req, res) => {
  try {
    const { prompt, negative_prompt, duration = 5, style = 'realistic' } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    // negative prompt first at runtime
    const finalPrompt = negative_prompt
      ? `${negative_prompt}, ${prompt}`
      : prompt;

    const mockVideo = {
    video_url: `data:video/mp4;base64,`,
    thumbnail: `data:image/svg+xml;base64,${Buffer.from(`
      <svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
        <rect fill="#1e293b" width="640" height="360"/>
        <circle cx="320" cy="180" r="40" fill="#6366f1"/>
        <polygon points="320,160 335,180 320,200" fill="white"/>
        <text x="320" y="250" fill="#f8fafc" font-family="Arial" font-size="18" text-anchor="middle" alignment-baseline="middle">
          Video: ${finalPrompt.substring(0, 40)}...
        </text>
        <text x="320" y="275" fill="#94a3b8" font-family="Arial" font-size="14" text-anchor="middle" alignment-baseline="middle">
          Style: ${style} | Duration: ${duration}s
        </text>
        ${negative_prompt ? `<text x="320" y="300" fill="#ef4444" font-family="Arial" font-size="12" text-anchor="middle" alignment-baseline="middle">Neg: ${negative_prompt.substring(0, 30)}...</text>` : ''}
      </svg>
    `).toString('base64')}`,
    prompt: finalPrompt,
    negative_prompt,
    duration,
    style,
    status: 'processing',
  };

    res.status(200).json(mockVideo);
  } catch (err: unknown) {
    logError(logger, 'video:generate', err);
    res.status(500).json({ error: 'Failed to generate video' });
  }
});

videoRouter.get('/status/:id', async (req, res) => {
  try {
    const { id } = req.params;

    res.status(200).json({
    id,
    status: 'completed',
    progress: 100,
    video_url: `data:video/mp4;base64,`,
    thumbnail: `data:image/svg+xml;base64,${Buffer.from(`
      <svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
        <rect fill="#1e293b" width="640" height="360"/>
        <circle cx="320" cy="180" r="40" fill="#10b981"/>
        <polygon points="320,160 335,180 320,200" fill="white"/>
        <text x="320" y="250" fill="#f8fafc" font-family="Arial" font-size="18" text-anchor="middle" alignment-baseline="middle">
          Video Generation Complete
        </text>
        <text x="320" y="275" fill="#10b981" font-family="Arial" font-size="14" text-anchor="middle" alignment-baseline="middle">
          Ready to Download
        </text>
      </svg>
    `).toString('base64')}`,
    });
  } catch (err: unknown) {
    logError(logger, 'video:status', err);
    res.status(500).json({ error: 'Failed to fetch video status' });
  }
});
