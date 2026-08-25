import express from 'express';
import axios from 'axios';
import { logger } from '../utils/logger.js';
import { logError } from '../utils/error-mask.js';

export const imageRouter = express.Router();

const STABILITY_API_KEY = process.env.STABILITY_API_KEY;

imageRouter.post('/generate', async (req, res) => {
  const { prompt, negative_prompt, width = 1024, height = 1024, style = 'photorealistic' } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  try {
    const styles: Record<string, string> = {
      photorealistic: 'photorealistic, detailed, high quality',
      anime: 'anime style, vibrant colors, detailed',
      sketch: 'pencil sketch, black and white, detailed',
      abstract: 'abstract art, colorful, creative',
      oil: 'oil painting, classic art style',
    };

    // negative prompt first at runtime
    const finalPrompt = negative_prompt
      ? `${negative_prompt}, ${prompt}`
      : prompt;
    const enhancedPrompt = `${finalPrompt}, ${styles[style] || styles.photorealistic}`;

    if (STABILITY_API_KEY) {
      const response = await axios.post(
        'https://api.stability.ai/v2beta/stable-image/generate/core',
        {
          prompt: enhancedPrompt,
          width,
          height,
          output_format: 'png',
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${STABILITY_API_KEY}`,
          },
          responseType: 'arraybuffer',
        }
      );

      res.setHeader('Content-Type', 'image/png');
      res.status(200).send(response.data);
    } else {
      const mockImage = `data:image/svg+xml;base64,${Buffer.from(`
        <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
          <rect fill="#1e293b" width="${width}" height="${height}"/>
          <text x="${width/2}" y="${height/2}" fill="#6366f1" font-family="Arial" font-size="24" text-anchor="middle" alignment-baseline="middle">
            Image Generated: ${prompt.substring(0, 30)}...
          </text>
          <text x="${width/2}" y="${height/2 + 30}" fill="#94a3b8" font-family="Arial" font-size="14" text-anchor="middle" alignment-baseline="middle">
            Style: ${style}
          </text>
        </svg>
      `).toString('base64')}`;

      res.status(200).json({ image_url: mockImage, prompt: enhancedPrompt, style, negative_prompt });
    }
  } catch (error: unknown) {
    logError(logger, 'image:generate', error);
    // 真实生成失败：返回 5xx + 明确错误，不再用 mock 占位掩盖上游故障
    return res.status(503).json({ error: (error as { message?: string }).message || 'Image generation failed' });
  }
});

imageRouter.post('/variations', async (req, res) => {
  const { prompt, variations = 4 } = req.body;

  const mockImages = Array.from({ length: variations }, (_, i) => ({
    image_url: `data:image/svg+xml;base64,${Buffer.from(`
      <svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
        <rect fill="#1e293b" width="512" height="512"/>
        <text x="256" y="240" fill="#6366f1" font-family="Arial" font-size="20" text-anchor="middle" alignment-baseline="middle">
          Variation ${i + 1}
        </text>
        <text x="256" y="270" fill="#94a3b8" font-family="Arial" font-size="12" text-anchor="middle" alignment-baseline="middle">
          ${prompt?.substring(0, 20)}...
        </text>
      </svg>
    `).toString('base64')}`,
  }));

  res.status(200).json({ variations: mockImages });
});
