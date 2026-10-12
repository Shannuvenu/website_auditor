import { getLlmTemperature } from '@/lib/config/env';
import { createMockProvider } from './mock';

// Provider abstraction (reused from the original app). Add a provider by returning another object with complete().
export interface LlmProvider {
  name: string;
  model: string;
  complete(system: string, user: string): Promise<string>;
}

type Json = Record<string, unknown>;

async function post(url: string, headers: Record<string, string>, body: unknown, retried = false): Promise<Json> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });
  if (res.status === 429 && !retried) {
    // tokens-per-minute limit: wait as the server asks (max 20 s) and retry once
    const wait = Math.min(Math.max(Number(res.headers.get('retry-after')) || 5, 1), 20);
    await new Promise((resolve) => setTimeout(resolve, wait * 1000));
    return post(url, headers, body, true);
  }
  const json = (await res.json().catch(() => ({}))) as Json;
  if (!res.ok) {
    const err = json.error as Json | undefined;
    const message = (err?.message ?? err?.status ?? json.message ?? '') as string;
    throw new Error(`HTTP ${res.status} ${String(message).slice(0, 200)}`.trim());
  }
  return json;
}

const first = <T>(value: unknown): T | undefined => (Array.isArray(value) ? (value[0] as T) : undefined);

export function getProvider(): LlmProvider | null {
  const env = process.env;
  const name = (env.AI_PROVIDER ?? '').toLowerCase().trim();
  const modelEnv = env.AI_MODEL?.trim();
  const temperature = getLlmTemperature();

  if (name === 'mock') return createMockProvider();

  if (name === 'anthropic' && env.ANTHROPIC_API_KEY) {
    const model = modelEnv || 'claude-sonnet-4-5';
    return {
      name,
      model,
      async complete(system, user) {
        const json = await post(
          'https://api.anthropic.com/v1/messages',
          { 'x-api-key': env.ANTHROPIC_API_KEY as string, 'anthropic-version': '2023-06-01' },
          { model, max_tokens: 4000, temperature, system, messages: [{ role: 'user', content: user }] },
        );
        return first<{ text?: string }>(json.content)?.text ?? '';
      },
    };
  }

  if (name === 'openai' && env.OPENAI_API_KEY) {
    const model = modelEnv || 'gpt-4o-mini';
    const base = (env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
    return {
      name,
      model,
      async complete(system, user) {
        const json = await post(
          `${base}/chat/completions`,
          { authorization: `Bearer ${env.OPENAI_API_KEY}` },
          {
            model,
            response_format: { type: 'json_object' },
            temperature,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user },
            ],
          },
        );
        return first<{ message?: { content?: string } }>(json.choices)?.message?.content ?? '';
      },
    };
  }

  if (name === 'gemini' && env.GEMINI_API_KEY) {
    const model = modelEnv || 'gemini-2.5-flash';
    return {
      name,
      model,
      async complete(system, user) {
        const json = await post(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
          { 'x-goog-api-key': env.GEMINI_API_KEY as string },
          {
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: 'user', parts: [{ text: user }] }],
            generationConfig: { responseMimeType: 'application/json', temperature },
          },
        );
        const content = first<{ content?: { parts?: { text?: string }[] } }>(json.candidates)?.content;
        return content?.parts?.[0]?.text ?? '';
      },
    };
  }

  if (name === 'ollama' && env.OLLAMA_BASE_URL) {
    const model = modelEnv || 'llama3.1';
    return {
      name,
      model,
      async complete(system, user) {
        const json = await post(
          `${env.OLLAMA_BASE_URL}/api/chat`,
          {},
          {
            model,
            stream: false,
            format: 'json',
            options: { temperature },
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user },
            ],
          },
        );
        return (json.message as { content?: string } | undefined)?.content ?? '';
      },
    };
  }

  return null;
}
