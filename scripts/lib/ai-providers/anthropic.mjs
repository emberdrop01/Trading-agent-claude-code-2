/**
 * Anthropic's Messages API does not follow the OpenAI schema (different auth
 * header, system prompt is a top-level field, no response_format flag), so it
 * needs its own adapter. Everything else about how the result is used
 * downstream (JSON parsing, fallback) is identical to the other provider.
 */
export async function chatJSON({ apiKey, model, systemPrompt, userContent, temperature = 0.2, maxTokens = 4000 }) {
  if (!apiKey) throw new Error('AI_API_KEY is not set.');
  if (!model) throw new Error('AI_MODEL is not set — specify an Anthropic model, e.g. a current Claude model name.');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} from Anthropic: ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = (data.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
  if (!text) {
    throw new Error(`Empty response from Anthropic (model ${model}). Raw: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return text;
}
