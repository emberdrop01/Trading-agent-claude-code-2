/**
 * Generic adapter for any provider that implements the OpenAI Chat Completions
 * schema (POST {baseUrl}/chat/completions with {model, messages}). This is the
 * majority of providers on the market, including Google's own OpenAI-compat
 * endpoint for Gemini — so one adapter covers almost every "other AI" you'd
 * plausibly switch to.
 *
 * Deliberately does NOT send response_format: {type:"json_object"} by default,
 * because not every compatible backend supports it and a 400 there would break
 * providers that don't. We rely on prompting for JSON (same as the original
 * app already did) plus lenient parsing downstream. Set jsonMode:true to opt
 * in for providers you've confirmed support it (OpenAI, Groq, most OpenRouter
 * models).
 */
export async function chatJSON({ baseUrl, apiKey, model, systemPrompt, userContent, temperature = 0.2, jsonMode = false }) {
  if (!baseUrl) throw new Error('AI_BASE_URL / provider base URL is not set.');
  if (!apiKey) throw new Error('AI_API_KEY is not set.');
  if (!model) throw new Error('AI_MODEL is not set — you must specify a model for this provider explicitly.');

  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;

  const body = {
    model,
    temperature,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
  };
  if (jsonMode) body.response_format = { type: 'json_object' };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} from ${baseUrl}: ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || '';
  if (!text) {
    throw new Error(`Empty response from ${baseUrl} (model ${model}). Raw: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return text;
}
