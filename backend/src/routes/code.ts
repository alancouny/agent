import express from 'express';
import axios from 'axios';
import { logger } from '../utils/logger.js';
import { logError } from '../utils/error-mask.js';

export const codeRouter = express.Router();

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

codeRouter.post('/analyze', async (req, res) => {
  const { code, language } = req.body;

  if (!code) {
    return res.status(400).json({ error: 'Code is required' });
  }

  const analysisPrompt = `
    Analyze this ${language || 'code'} and provide:
    1. What this code does (summary)
    2. Key functions/methods explained
    3. Potential bugs or issues
    4. Performance optimizations
    5. Best practices recommendations

    Code:
    ${code}
  `;

  try {
    if (OPENAI_API_KEY) {
      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-4o',
          messages: [{ role: 'user', content: analysisPrompt }],
          temperature: 0.3,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
          },
        }
      );

      res.status(200).json({
        analysis: response.data.choices[0].message.content,
        code,
        language,
      });
    } else {
      const ollamaResponse = await axios.post(
        `${OLLAMA_BASE_URL}/api/generate`,
        {
          model: 'codellama',
          prompt: analysisPrompt,
          stream: false,
        }
      );

      res.status(200).json({
        analysis: ollamaResponse.data.response,
        code,
        language,
      });
    }
  } catch (err: unknown) {
    logError(logger, 'code:analyze', err);
    const mockAnalysis = `
## Code Analysis (Mock Output)

### Summary
This code appears to be written in ${language || 'unknown'} language. Without a connected AI service, I cannot provide detailed analysis.

### Key Functions
- Analysis requires AI service connection
- Please configure OpenAI API key or install Ollama

### Recommendations
1. Install Ollama: https://ollama.com/
2. Pull a code model: \`ollama pull codellama\`
3. Or configure OPENAI_API_KEY in .env file

**Code Preview:**
${code.substring(0, 200)}${code.length > 200 ? '...' : ''}
    `.trim();

    res.status(200).json({
      analysis: mockAnalysis,
      code,
      language,
      note: 'Using mock analysis - configure API keys for real analysis',
    });
  }
});

codeRouter.post('/generate', async (req, res) => {
  const { prompt, language, framework } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  const codePrompt = `
    Generate ${language || 'Python'} code using ${framework || 'standard library'} that:
    ${prompt}

    Requirements:
    - Clean, well-structured code
    - Include comments for clarity
    - Handle edge cases
    - Follow best practices
    - Return only the code with a brief explanation
  `;

  try {
    if (OPENAI_API_KEY) {
      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-4o',
          messages: [{ role: 'user', content: codePrompt }],
          temperature: 0.7,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
          },
        }
      );

      res.status(200).json({
        code: response.data.choices[0].message.content,
        prompt,
        language,
        framework,
      });
    } else {
      const ollamaResponse = await axios.post(
        `${OLLAMA_BASE_URL}/api/generate`,
        {
          model: 'codellama',
          prompt: codePrompt,
          stream: false,
        }
      );

      res.status(200).json({
        code: ollamaResponse.data.response,
        prompt,
        language,
        framework,
      });
    }
  } catch (err: unknown) {
    logError(logger, 'code:generate', err);
    const mockCode = `
# ${language || 'Python'} Code (Mock Output)
# Prompt: ${prompt.substring(0, 50)}${prompt.length > 50 ? '...' : ''}
# Framework: ${framework || 'standard'}

"""
Note: This is a mock response. 
To get real code generation:
1. Install Ollama: https://ollama.com/
2. Pull codellama: \`ollama pull codellama\`
3. Or configure OPENAI_API_KEY in .env
"""

def generated_function():
    """Generated function based on your prompt"""
    print("Code generation requires AI service connection")
    return None

if __name__ == "__main__":
    generated_function()
    `.trim();

    res.status(200).json({
      code: mockCode,
      prompt,
      language,
      framework,
      note: 'Using mock code - configure API keys for real generation',
    });
  }
});

codeRouter.post('/refactor', async (req, res) => {
  const { code, language, improvements } = req.body;

  if (!code) {
    return res.status(400).json({ error: 'Code is required' });
  }

  const refactorPrompt = `
    Refactor this ${language || 'code'} with the following improvements:
    ${improvements || 'improve readability, performance, and maintainability'}

    Original code:
    ${code}

    Provide:
    1. Refactored code
    2. Explanation of changes
    3. Before/after comparison
  `;

  try {
    if (OPENAI_API_KEY) {
      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-4o',
          messages: [{ role: 'user', content: refactorPrompt }],
          temperature: 0.3,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
          },
        }
      );

      res.status(200).json({
        refactored_code: response.data.choices[0].message.content,
        original_code: code,
        language,
      });
    } else {
      const ollamaResponse = await axios.post(
        `${OLLAMA_BASE_URL}/api/generate`,
        {
          model: 'codellama',
          prompt: refactorPrompt,
          stream: false,
        }
      );

      res.status(200).json({
        refactored_code: ollamaResponse.data.response,
        original_code: code,
        language,
      });
    }
  } catch (err: unknown) {
    logError(logger, 'code:refactor', err);
    const mockRefactored = `
# Refactored ${language || 'Code'} (Mock Output)

"""
Note: This is a mock response. 
To get real refactoring:
1. Install Ollama: https://ollama.com/
2. Pull codellama: \`ollama pull codellama\`
3. Or configure OPENAI_API_KEY in .env
"""

# Original code preview:
# ${code.substring(0, 100)}${code.length > 100 ? '...' : ''}

# Suggested improvements:
# - Use more descriptive variable names
# - Extract complex logic into functions
# - Add error handling
# - Improve code structure and readability
# - Optimize performance where possible
    `.trim();

    res.status(200).json({
      refactored_code: mockRefactored,
      original_code: code,
      language,
      note: 'Using mock refactoring - configure API keys for real refactoring',
    });
  }
});
