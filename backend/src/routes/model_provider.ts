/* eslint-disable @typescript-eslint/no-explicit-any */
import express from 'express';
import axios from 'axios';
import { logger } from '../utils/logger.js';
import { logError } from '../utils/error-mask.js';

export const modelProviderRouter = express.Router();

interface ModelProvider {
  id: string;
  name: string;
  description: string;
  type: 'local' | 'api';
  baseUrl?: string;
  apiKeyRequired: boolean;
  models: ModelInfo[];
  isCustom?: boolean;
  apiKeyHeader?: string;
  chatEndpoint?: string;
  modelsEndpoint?: string;
}

interface ModelInfo {
  id: string;
  name: string;
  description: string;
  capabilities: string[];
  maxTokens?: number;
  contextWindow?: number;
}

const modelProviders: ModelProvider[] = [
  {
    id: 'ollama',
    name: 'Ollama',
    description: '本地运行的LLM模型管理工具',
    type: 'local',
    baseUrl: 'http://localhost:11434',
    apiKeyRequired: false,
    models: [
      {
        id: 'llama3.2',
        name: 'Llama 3.2',
        description: 'Meta的最新开源大语言模型',
        capabilities: ['chat', 'code', 'reasoning'],
        maxTokens: 128000,
        contextWindow: 128000,
      },
      {
        id: 'qwen2.5',
        name: 'Qwen 2.5',
        description: '阿里云通义千问开源模型',
        capabilities: ['chat', 'code', 'multimodal'],
        maxTokens: 128000,
        contextWindow: 128000,
      },
      {
        id: 'phi3.5',
        name: 'Phi-3.5',
        description: '微软轻量级高性能模型',
        capabilities: ['chat', 'code'],
        maxTokens: 128000,
        contextWindow: 128000,
      },
      {
        id: 'mistral',
        name: 'Mistral',
        description: '法国Mistral AI开源模型',
        capabilities: ['chat', 'code'],
        maxTokens: 32000,
        contextWindow: 32000,
      },
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'OpenAI云端API服务',
    type: 'api',
    baseUrl: 'https://api.openai.com/v1',
    apiKeyRequired: true,
    models: [
      {
        id: 'gpt-5.4',
        name: 'GPT-5.4',
        description: 'OpenAI最新旗舰模型',
        capabilities: ['chat', 'code', 'multimodal', 'reasoning'],
        maxTokens: 128000,
        contextWindow: 128000,
      },
      {
        id: 'gpt-4o',
        name: 'GPT-4o',
        description: 'GPT-4 Omni，支持多模态',
        capabilities: ['chat', 'code', 'multimodal'],
        maxTokens: 128000,
        contextWindow: 128000,
      },
      {
        id: 'gpt-4-turbo',
        name: 'GPT-4 Turbo',
        description: '高性能GPT-4模型',
        capabilities: ['chat', 'code'],
        maxTokens: 128000,
        contextWindow: 128000,
      },
    ],
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    description: 'Anthropic Claude系列模型',
    type: 'api',
    baseUrl: 'https://api.anthropic.com/v1',
    apiKeyRequired: true,
    models: [
      {
        id: 'claude-3.5-sonnet',
        name: 'Claude 3.5 Sonnet',
        description: '平衡性能与成本的优选模型',
        capabilities: ['chat', 'code', 'reasoning', 'long_context'],
        maxTokens: 200000,
        contextWindow: 200000,
      },
      {
        id: 'claude-3-opus',
        name: 'Claude 3 Opus',
        description: 'Anthropic最强大的模型',
        capabilities: ['chat', 'code', 'multimodal', 'reasoning'],
        maxTokens: 200000,
        contextWindow: 200000,
      },
      {
        id: 'claude-3-haiku',
        name: 'Claude 3 Haiku',
        description: '超快速轻量级模型',
        capabilities: ['chat', 'code'],
        maxTokens: 200000,
        contextWindow: 200000,
      },
    ],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    description: '深度求索开源模型',
    type: 'api',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKeyRequired: true,
    models: [
      {
        id: 'deepseek-chat',
        name: 'DeepSeek Chat',
        description: '深度求索对话模型',
        capabilities: ['chat', 'code'],
        maxTokens: 128000,
        contextWindow: 128000,
      },
      {
        id: 'deepseek-coder',
        name: 'DeepSeek Coder',
        description: '专业代码生成模型',
        capabilities: ['code'],
        maxTokens: 128000,
        contextWindow: 128000,
      },
    ],
  },
  {
    id: 'google',
    name: 'Google Gemini',
    description: 'Google Gemini系列模型',
    type: 'api',
    baseUrl: 'https://generativelanguage.googleapis.com/v1',
    apiKeyRequired: true,
    models: [
      {
        id: 'gemini-1.5-pro',
        name: 'Gemini 1.5 Pro',
        description: 'Google最强模型，超长上下文',
        capabilities: ['chat', 'code', 'multimodal', 'reasoning'],
        maxTokens: 1000000,
        contextWindow: 1000000,
      },
      {
        id: 'gemini-1.5-flash',
        name: 'Gemini 1.5 Flash',
        description: '快速高效的轻量级模型',
        capabilities: ['chat', 'code', 'multimodal'],
        maxTokens: 1000000,
        contextWindow: 1000000,
      },
    ],
  },
];

let currentProvider = 'ollama';
const providerConfigs: Record<string, { apiKey?: string; baseUrl?: string; autoAppendChat?: boolean }> = {};
const customProviders: ModelProvider[] = [];

/** 按 provider + model 解析模型上下文窗口容量（tokens），供 usage 流事件与前端实时展示使用。 */
export function getModelContextWindow(providerId: string, modelId: string): number | undefined {
  const provider = [...modelProviders, ...customProviders].find((p) => p.id === providerId);
  const hit = provider?.models.find((m) => m.id === modelId || m.name === modelId);
  return hit?.contextWindow;
}

modelProviderRouter.get('/providers', (req, res) => {
  res.status(200).json({
    providers: [...modelProviders, ...customProviders],
    currentProvider,
  });
});

const getAllProviders = () => [...modelProviders, ...customProviders];

const findProvider = (id: string) => getAllProviders().find(p => p.id === id);

/** 密钥脱敏：只回传掩码（保留尾 4 位），前端据此判断"已配置"但拿不到明文。 */
function maskKey(key?: string): string | undefined {
  if (!key) return undefined;
  return key.length <= 8 ? '****' : `****${key.slice(-4)}`;
}

/** 出参配置：apiKey 一律掩码，避免 GET 接口泄露明文密钥。 */
function publicConfig(config: { apiKey?: string; baseUrl?: string; autoAppendChat?: boolean }): { apiKey?: string; baseUrl?: string; autoAppendChat?: boolean } {
  return { ...config, apiKey: maskKey(config.apiKey) };
}

modelProviderRouter.get('/providers/:id', (req, res) => {
  const provider = findProvider(req.params.id);
  
  if (!provider) {
    return res.status(404).json({ error: 'Provider not found' });
  }
  
  res.status(200).json({
    provider,
    config: publicConfig(providerConfigs[req.params.id] || {}),
  });
});

modelProviderRouter.get('/providers/:id/models', (req, res) => {
  const provider = findProvider(req.params.id);
  
  if (!provider) {
    return res.status(404).json({ error: 'Provider not found' });
  }
  
  res.status(200).json({
    provider: provider.name,
    models: provider.models,
  });
});

modelProviderRouter.post('/providers/:id/config', (req, res) => {
  const provider = findProvider(req.params.id);
  
  if (!provider) {
    return res.status(404).json({ error: 'Provider not found' });
  }
  
  const { apiKey, baseUrl, autoAppendChat } = req.body;
  // 前端回传的是掩码（****xxxx）时保留旧值，避免把掩码写回明文存储
  const incomingKey = typeof apiKey === 'string' && apiKey.startsWith('****') ? providerConfigs[req.params.id]?.apiKey : apiKey;
  
  providerConfigs[req.params.id] = {
    apiKey: incomingKey || providerConfigs[req.params.id]?.apiKey,
    baseUrl: baseUrl || provider.baseUrl,
    // false 需要显式保留（`||` 会把 false 吞掉）
    autoAppendChat: autoAppendChat !== undefined ? autoAppendChat : providerConfigs[req.params.id]?.autoAppendChat,
  };
  
  res.status(200).json({
    message: 'Configuration updated successfully',
    provider: req.params.id,
    config: publicConfig(providerConfigs[req.params.id]),
  });
});

modelProviderRouter.post('/current', (req, res) => {
  const { providerId } = req.body;
  
  const provider = findProvider(providerId);
  
  if (!provider) {
    return res.status(404).json({ error: 'Provider not found' });
  }
  
  if (provider.apiKeyRequired && !providerConfigs[providerId]?.apiKey) {
    return res.status(400).json({
      error: 'API key is required for this provider',
      provider: provider.name,
    });
  }
  
  currentProvider = providerId;
  
  res.status(200).json({
    message: 'Current provider updated successfully',
    currentProvider,
    providerInfo: provider,
  });
});

modelProviderRouter.get('/current', (req, res) => {
  const provider = findProvider(currentProvider);
  
  res.status(200).json({
    currentProvider,
    providerInfo: provider,
    config: publicConfig(providerConfigs[currentProvider] || {}),
  });
});

modelProviderRouter.get('/capabilities', (req, res) => {
  const allProviders = getAllProviders();
  const capabilities = [...new Set(
    allProviders.flatMap(p => 
      p.models.flatMap(m => m.capabilities)
    )
  )];
  
  res.status(200).json({
    capabilities,
    providersByCapability: capabilities.reduce((acc, cap) => {
      acc[cap] = allProviders.filter(p => 
        p.models.some(m => m.capabilities.includes(cap))
      ).map(p => p.name);
      return acc;
    }, {} as Record<string, string[]>),
  });
});

modelProviderRouter.post('/custom', (req, res) => {
  const { name, description, baseUrl, apiKeyRequired, apiKeyHeader, chatEndpoint, modelsEndpoint, models } = req.body;
  
  if (!name || !baseUrl) {
    return res.status(400).json({ error: 'Name and baseUrl are required' });
  }
  
  const existingProvider = getAllProviders().find(p => p.name === name);
  if (existingProvider) {
    return res.status(400).json({ error: 'Provider with this name already exists' });
  }
  
  const customId = `custom_${Date.now()}`;
  
  const newProvider: ModelProvider = {
    id: customId,
    name,
    description: description || 'Custom AI Provider',
    type: 'api',
    baseUrl,
    apiKeyRequired: apiKeyRequired || false,
    apiKeyHeader: apiKeyHeader || 'Authorization',
    chatEndpoint: chatEndpoint || '/chat/completions',
    modelsEndpoint: modelsEndpoint || '/v1/models',
    isCustom: true,
    models: models || [{
      id: 'default',
      name: 'Default Model',
      description: 'Default model for custom provider',
      capabilities: ['chat'],
    }],
  };
  
  customProviders.push(newProvider);
  
  res.status(201).json({
    message: 'Custom provider created successfully',
    provider: newProvider,
  });
});

modelProviderRouter.put('/custom/:id', (req, res) => {
  const { name, description, baseUrl, apiKeyRequired, apiKeyHeader, chatEndpoint, modelsEndpoint, models } = req.body;
  const index = customProviders.findIndex(p => p.id === req.params.id);
  
  if (index === -1) {
    return res.status(404).json({ error: 'Custom provider not found' });
  }
  
  const updatedProvider = {
    ...customProviders[index],
    name: name || customProviders[index].name,
    description: description || customProviders[index].description,
    baseUrl: baseUrl || customProviders[index].baseUrl,
    apiKeyRequired: apiKeyRequired !== undefined ? apiKeyRequired : customProviders[index].apiKeyRequired,
    apiKeyHeader: apiKeyHeader || customProviders[index].apiKeyHeader,
    chatEndpoint: chatEndpoint || customProviders[index].chatEndpoint,
    modelsEndpoint: modelsEndpoint || customProviders[index].modelsEndpoint,
    models: models || customProviders[index].models,
  };
  
  customProviders[index] = updatedProvider;
  
  res.status(200).json({
    message: 'Custom provider updated successfully',
    provider: updatedProvider,
  });
});

modelProviderRouter.delete('/custom/:id', (req, res) => {
  const index = customProviders.findIndex(p => p.id === req.params.id);
  
  if (index === -1) {
    return res.status(404).json({ error: 'Custom provider not found' });
  }
  
  if (currentProvider === req.params.id) {
    currentProvider = 'ollama';
  }
  
  const deleted = customProviders.splice(index, 1)[0];
  
  res.status(200).json({
    message: 'Custom provider deleted successfully',
    provider: deleted,
  });
});

modelProviderRouter.post('/custom/:id/discover-models', async (req, res) => {
  const provider = customProviders.find(p => p.id === req.params.id);
  
  if (!provider) {
    return res.status(404).json({ error: 'Custom provider not found' });
  }
  
  const config = providerConfigs[req.params.id] || {};
  const url = `${config.baseUrl || provider.baseUrl}${provider.modelsEndpoint}`;
  
  try {
    const headers: Record<string, string> = {};
    if (provider.apiKeyRequired && config.apiKey) {
      headers[provider.apiKeyHeader || 'Authorization'] = `Bearer ${config.apiKey}`;
    }
    
    const response = await axios.get(url, { headers });
    
    let discoveredModels: ModelInfo[] = [];
    
    if (Array.isArray(response.data)) {
      discoveredModels = response.data.map((m: any) => ({
        id: String(m.id || m.model || 'unknown'),
        name: String(m.name || m.id || m.model || 'Unknown'),
        description: String(m.description || `Model ${m.id || m.model}`),
        capabilities: ['chat'],
      }));
    } else if (response.data.data && Array.isArray(response.data.data)) {
      discoveredModels = response.data.data.map((m: any) => ({
        id: String(m.id || m.model || 'unknown'),
        name: String(m.name || m.id || m.model || 'Unknown'),
        description: String(m.description || `Model ${m.id || m.model}`),
        capabilities: ['chat'],
      }));
    } else {
      return res.status(200).json({
        message: 'Could not parse models from response',
        rawResponse: response.data,
      });
    }
    
    const providerIndex = customProviders.findIndex(p => p.id === req.params.id);
    if (providerIndex !== -1) {
      customProviders[providerIndex].models = discoveredModels;
    }
    
    res.status(200).json({
      message: `Discovered ${discoveredModels.length} models`,
      models: discoveredModels,
    });
  } catch (error: unknown) {
    logError(logger, 'model-provider:discover', error);
    res.status(200).json({
      message: 'Failed to discover models',
      error: (error as Error).message,
      suggestion: 'Please check your API key and base URL',
    });
  }
});

modelProviderRouter.post('/custom/:id/test', async (req, res) => {
  const provider = customProviders.find(p => p.id === req.params.id);
  
  if (!provider) {
    return res.status(404).json({ error: 'Custom provider not found' });
  }
  
  const config = providerConfigs[req.params.id] || {};
  // autoAppendChat=false：用户填的是完整 URL（含 /chat/completions），不再自动拼接
  const base = config.baseUrl || provider.baseUrl || '';
  const url = config.autoAppendChat === false
    ? base
    : `${base}${provider.chatEndpoint}`;
  
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (provider.apiKeyRequired && config.apiKey) {
      headers[provider.apiKeyHeader || 'Authorization'] = `Bearer ${config.apiKey}`;
    }
    
    const response = await axios.post(url, {
      model: provider.models[0]?.id || 'default',
      messages: [{ role: 'user', content: 'Hello' }],
      max_tokens: 10,
    }, { headers, timeout: 10000 });
    
    res.status(200).json({
      success: true,
      message: 'Connection test successful',
      response: {
        status: response.status,
        model: response.data?.model,
        content: response.data?.choices?.[0]?.message?.content || 'Success',
      },
    });
  } catch (error: unknown) {
    logError(logger, 'model-provider:test', error);
    res.status(200).json({
      success: false,
      message: 'Connection test failed',
      error: (error as Error).message,
      status: (error as { response?: { status?: number } }).response?.status,
      suggestion: 'Please check your API key, base URL, and endpoint configuration',
    });
  }
});