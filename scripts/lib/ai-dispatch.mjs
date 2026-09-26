import { chatJSON as openaiCompatChat } from './ai-providers/openai-compatible.mjs';
import { chatJSON as anthropicChat } from './ai-providers/anthropic.mjs';

// Known OpenAI-compatible providers and their base URLs. Add a line here if
// your provider isn't listed but is OpenAI-compatible — that's the only code
// change ever needed for a NEW provider; switching between these requires none.
export const KNOWN_PROVIDERS = {
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
  openai: 'https://api.openai.com/v1',
  groq: 'https://api.groq.com/openai/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  together: 'https://api.together.xyz/v1',
  deepseek: 'https://api.deepseek.com',
  mistral: 'https://api.mistral.ai/v1',
  fireworks: 'https://api.fireworks.ai/inference/v1',
  // 'anthropic' is intentionally absent here - it's handled as a special case
  // below because it does not speak the OpenAI schema.
  // 'custom' is also a special case - it uses whatever AI_BASE_URL you set.
};

/**
 * Resolves an { provider, apiKey, model, baseUrl } config into an actual model
 * call. This is the ONLY function that needs to know provider differences.
 * Everything upstream (ai.mjs, research.mjs) just calls this and gets text back.
 */
export async function callAI({ provider, apiKey, model, baseUrl, systemPrompt, userContent, jsonMode }) {
  const p = (provider || 'gemini').toLowerCase();

  if (p === 'anthropic') {
    return anthropicChat({ apiKey, model, systemPrompt, userContent });
  }

  const resolvedBaseUrl = p === 'custom' ? baseUrl : baseUrl || KNOWN_PROVIDERS[p];

  if (!resolvedBaseUrl) {
    throw new Error(
      `Unknown AI_PROVIDER "${provider}". Known: ${Object.keys(KNOWN_PROVIDERS).join(', ')}, anthropic, custom (with AI_BASE_URL set).`
    );
  }

  return openaiCompatChat({ baseUrl: resolvedBaseUrl, apiKey, model, systemPrompt, userContent, jsonMode });
}
