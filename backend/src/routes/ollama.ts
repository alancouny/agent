import express from 'express';
import axios from 'axios';
import { logger } from '../utils/logger.js';
import { logError, safeErrorMessage } from '../utils/error-mask.js';

export const ollamaRouter = express.Router();

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';

ollamaRouter.get('/models', async (req, res) => {
  try {
    const response = await axios.get(`${OLLAMA_BASE_URL}/api/tags`);
    res.status(200).json(response.data);
  } catch (err: unknown) {
    logError(logger, 'ollama:models', err);
    res.status(503).json({
      error: 'Ollama service is unavailable',
      message: 'Please install Ollama from https://ollama.com/ and start it with `ollama serve`',
      available: false,
    });
  }
});

ollamaRouter.post('/chat', async (req, res) => {
  const { model, messages, stream = true } = req.body;
  
  try {
    const response = await axios.post(
      `${OLLAMA_BASE_URL}/api/chat`,
      { model, messages, stream },
      {
        responseType: stream ? 'stream' : 'json',
        headers: { 'Content-Type': 'application/json' },
      }
    );

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const streamData = response.data as NodeJS.ReadableStream;
      // 客户端断连时停止转发并取消上游请求，避免后台继续拉流
      const onClose = () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (streamData as any)?.destroy?.();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (response as any)?.request?.destroy?.();
      };
      req.on('close', onClose);

      streamData.on('data', (chunk: Buffer) => {
        if (!res.writableEnded) res.write(chunk);
      });

      streamData.on('end', () => {
        req.removeListener('close', onClose);
        res.end();
      });

      streamData.on('error', (err) => {
        req.removeListener('close', onClose);
        if (!res.writableEnded) res.status(500).json({ error: safeErrorMessage(err) });
      });
    } else {
      res.status(200).json(response.data);
    }
  } catch (err: unknown) {
    logError(logger, 'ollama:chat', err);
    res.status(503).json({
      error: 'Ollama service is unavailable',
      message: 'Please install Ollama from https://ollama.com/ and start it with `ollama serve`',
      available: false,
    });
  }
});

ollamaRouter.post('/generate', async (req, res) => {
  const { model, prompt, stream = true } = req.body;
  
  try {
    const response = await axios.post(
      `${OLLAMA_BASE_URL}/api/generate`,
      { model, prompt, stream },
      {
        responseType: stream ? 'stream' : 'json',
        headers: { 'Content-Type': 'application/json' },
      }
    );

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const streamData = response.data as NodeJS.ReadableStream;
      const onClose = () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (streamData as any)?.destroy?.();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (response as any)?.request?.destroy?.();
      };
      req.on('close', onClose);

      streamData.on('data', (chunk: Buffer) => {
        if (!res.writableEnded) res.write(chunk);
      });

      streamData.on('end', () => {
        req.removeListener('close', onClose);
        res.end();
      });

      streamData.on('error', (err) => {
        req.removeListener('close', onClose);
        if (!res.writableEnded) res.status(500).json({ error: safeErrorMessage(err) });
      });
    } else {
      res.status(200).json(response.data);
    }
  } catch (err: unknown) {
    logError(logger, 'ollama:generate', err);
    res.status(503).json({
      error: 'Ollama service is unavailable',
      message: 'Please install Ollama from https://ollama.com/ and start it with `ollama serve`',
      available: false,
    });
  }
});

ollamaRouter.post('/pull', async (req, res) => {
  const { model } = req.body;
  
  try {
    const response = await axios.post(
      `${OLLAMA_BASE_URL}/api/pull`,
      { name: model, stream: true },
      {
        responseType: 'stream',
        headers: { 'Content-Type': 'application/json' },
      }
    );

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const streamData = response.data as NodeJS.ReadableStream;
    const onClose = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (streamData as any)?.destroy?.();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (response as any)?.request?.destroy?.();
    };
    req.on('close', onClose);

    streamData.on('data', (chunk: Buffer) => {
      if (!res.writableEnded) res.write(chunk);
    });

    streamData.on('end', () => {
      req.removeListener('close', onClose);
      res.end();
    });

    streamData.on('error', (err) => {
      req.removeListener('close', onClose);
      if (!res.writableEnded) res.status(500).json({ error: safeErrorMessage(err) });
    });
  } catch (err: unknown) {
    logError(logger, 'ollama:pull', err);
    res.status(503).json({
      error: 'Ollama service is unavailable',
      message: 'Please install Ollama from https://ollama.com/ and start it with `ollama serve`',
      available: false,
    });
  }
});
