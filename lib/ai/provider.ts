// Provider abstraction. Add a provider by returning another object with complete().
export interface LLM { name: string; complete(system: string, user: string): Promise<string> }

async function post(url: string, headers: Record<string, string>, body: unknown, retried = false): Promise<any> {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(90_000) });
  if (r.status === 429 && !retried) {
    // tokens-per-minute limit: wait as the server asks (max 20 s) and retry once
    const wait = Math.min(Math.max(Number(r.headers.get('retry-after')) || 5, 1), 20);
    await new Promise((res) => setTimeout(res, wait * 1000));
    return post(url, headers, body, true);
  }
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = j?.error?.message ?? j?.error?.status ?? j?.message ?? '';
    throw new Error(`HTTP ${r.status} ${String(msg).slice(0, 200)}`.trim());
  }
  return j;
}

export function getProvider(): LLM | null {
  const p = (process.env.AI_PROVIDER ?? '').toLowerCase().trim(), model = process.env.AI_MODEL;
  const e = process.env;
  // Low temperature = more deterministic = fewer hallucinations. Clamped to 0..1 (Anthropic max is 1).
  const t = Number(e.AI_TEMPERATURE);
  const T = e.AI_TEMPERATURE && Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0.1;

  if (p === 'anthropic' && e.ANTHROPIC_API_KEY) return { name: p, async complete(s, u) { const j = await post('https://api.anthropic.com/v1/messages', { 'x-api-key': e.ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01' }, { model: model || 'claude-sonnet-4-5', max_tokens: 4000, temperature: T, system: s, messages: [{ role: 'user', content: u }] }); return j.content?.[0]?.text ?? ''; } };

  if (p === 'openai' && e.OPENAI_API_KEY) return { name: p, async complete(s, u) { const j = await post(`${(e.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')}/chat/completions`, { authorization: `Bearer ${e.OPENAI_API_KEY}` }, { model: model || 'gpt-4o-mini', response_format: { type: 'json_object' }, temperature: T, messages: [{ role: 'system', content: s }, { role: 'user', content: u }] }); return j.choices?.[0]?.message?.content ?? ''; } };

  if (p === 'gemini' && e.GEMINI_API_KEY) return { name: p, async complete(s, u) { const j = await post(`https://generativelanguage.googleapis.com/v1beta/models/${model || 'gemini-2.5-flash'}:generateContent`, { 'x-goog-api-key': e.GEMINI_API_KEY! }, { systemInstruction: { parts: [{ text: s }] }, contents: [{ role: 'user', parts: [{ text: u }] }], generationConfig: { responseMimeType: 'application/json', temperature: T } }); return j.candidates?.[0]?.content?.parts?.[0]?.text ?? ''; } };

  if (p === 'ollama' && e.OLLAMA_BASE_URL) return { name: p, async complete(s, u) { const j = await post(`${e.OLLAMA_BASE_URL}/api/chat`, {}, { model: model || 'llama3.1', stream: false, format: 'json', options: { temperature: T }, messages: [{ role: 'system', content: s }, { role: 'user', content: u }] }); return j.message?.content ?? ''; } };

  return null;
}