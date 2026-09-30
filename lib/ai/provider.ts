// Provider abstraction. Add a provider by returning another object with complete().
export interface LLM { name: string; complete(system: string, user: string): Promise<string> }

async function post(url: string, headers: Record<string, string>, body: unknown) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(90_000) });
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
  if (p === 'anthropic' && e.ANTHROPIC_API_KEY) return { name: p, async complete(s, u) { const j = await post('https://api.anthropic.com/v1/messages', { 'x-api-key': e.ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01' }, { model: model || 'claude-sonnet-4-5', max_tokens: 4000, system: s, messages: [{ role: 'user', content: u }] }); return j.content?.[0]?.text ?? ''; } };
  if (p === 'openai' && e.OPENAI_API_KEY) return { name: p, async complete(s, u) { const j = await post(`${(e.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')}/chat/completions`, { authorization: `Bearer ${e.OPENAI_API_KEY}` }, { model: model || 'gpt-4o-mini', response_format: { type: 'json_object' }, messages: [{ role: 'system', content: s }, { role: 'user', content: u }] }); return j.choices?.[0]?.message?.content ?? ''; } };
  if (p === 'gemini' && e.GEMINI_API_KEY) return { name: p, async complete(s, u) { const j = await post(`https://generativelanguage.googleapis.com/v1beta/models/${model || 'gemini-2.5-flash'}:generateContent`, { 'x-goog-api-key': e.GEMINI_API_KEY! }, { systemInstruction: { parts: [{ text: s }] }, contents: [{ role: 'user', parts: [{ text: u }] }], generationConfig: { responseMimeType: 'application/json' } }); return j.candidates?.[0]?.content?.parts?.[0]?.text ?? ''; } };
  if (p === 'ollama' && e.OLLAMA_BASE_URL) return { name: p, async complete(s, u) { const j = await post(`${e.OLLAMA_BASE_URL}/api/chat`, {}, { model: model || 'llama3.1', stream: false, format: 'json', messages: [{ role: 'system', content: s }, { role: 'user', content: u }] }); return j.message?.content ?? ''; } };
  return null;
}