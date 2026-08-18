import type { Settings } from '../types/settings.ts';
import { cacheKey, readCache, writeCache, type AiTask } from './aiCache.ts';

// `import.meta.env` only exists under Vite. checks.ts imports this file in bare Node to
// assert the prompt shape, where the property is absent at runtime AND untyped (that
// project does not pull in vite/client), so it is read defensively rather than declared.
const BASE = (import.meta as { env?: Record<string, string> }).env?.VITE_API_URL
  ?? 'http://localhost:3000';

export type { AiTask };

export const TARGET_LANGS: { value: string; label: string }[] = [
  { value: 'fa', label: 'فارسی' },
  { value: 'en', label: 'انگلیسی' },
  { value: 'ar', label: 'عربی' },
  { value: 'de', label: 'آلمانی' },
  { value: 'fr', label: 'فرانسوی' },
  { value: 'es', label: 'اسپانیایی' },
  { value: 'tr', label: 'ترکی' },
  { value: 'ru', label: 'روسی' },
];

export type AiErrorKind =
  | 'unconfigured' | 'offline' | 'rate_limited' | 'provider' | 'unauthorized' | 'input';

export class AiError extends Error {
  kind: AiErrorKind;
  constructor(kind: AiErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

/**
 * One builder for both transports. If proxy and direct ever construct prompts
 * separately, the same cache key would map to two different outputs.
 *
 * The server has its own copy of this (`server/src/ai.ts`) because the proxy must not
 * accept a prompt from the client — a client-supplied system prompt is the whole
 * jailbreak surface. The two must stay in step; `checks.ts` pins the shape.
 */
export function buildMessages(task: AiTask, text: string, targetLang: string) {
  if (task === 'translate') {
    return [
      {
        role: 'system',
        content:
          `Translate the user's text into the language with ISO code "${targetLang}". ` +
          'Return only the translation, with no preamble, no quotes, and no explanation. ' +
          'Preserve the original markdown formatting and line breaks exactly.',
      },
      { role: 'user', content: text },
    ];
  }
  return [
    {
      role: 'system',
      content:
        "Rewrite the user's text as a clear, well-structured prompt for a large language model. " +
        'Keep the original intent and the original language. Make the goal, the context, and the ' +
        'expected output format explicit. Return only the rewritten prompt, with no preamble and ' +
        'no explanation.',
    },
    { role: 'user', content: text },
  ];
}

export const MAX_TEXT = 20_000;

async function viaProxy(task: AiTask, text: string, targetLang: string, token: string) {
  const res = await fetch(`${BASE}/ai/complete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ task, text, targetLang }),
  });
  if (res.status === 401) throw new AiError('unauthorized', 'نشست منقضی شده است');
  if (res.status === 429) throw new AiError('rate_limited', 'سقف درخواست‌ها پر شده است');
  if (res.status === 503) throw new AiError('unconfigured', 'سرور برای هوش مصنوعی تنظیم نشده است');
  if (!res.ok) throw new AiError('provider', `AI ${res.status}`);
  return ((await res.json()) as { result: string }).result;
}

async function viaDirect(task: AiTask, text: string, targetLang: string, settings: Settings) {
  const { baseUrl, model, apiKey } = settings.ai;
  if (!apiKey || !baseUrl || !model) {
    throw new AiError('unconfigured', 'اطلاعات اتصال کامل نیست');
  }
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages: buildMessages(task, text, targetLang) }),
  });
  if (res.status === 401) throw new AiError('unconfigured', 'کلید پذیرفته نشد');
  if (res.status === 429) throw new AiError('rate_limited', 'سقف درخواست‌ها پر شده است');
  if (!res.ok) throw new AiError('provider', `AI ${res.status}`);
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return body.choices?.[0]?.message?.content ?? '';
}

/**
 * The cache sits in front of BOTH transports, so a repeat costs nothing in either mode
 * and the request never leaves the device. `force` is the escape hatch behind
 * «دوباره تولید کن» — a cache the user cannot escape is a bug report waiting to happen.
 */
export async function callAi({
  task, text, settings, token, force = false,
}: {
  task: AiTask;
  text: string;
  settings: Settings;
  token: string | null;
  force?: boolean;
}): Promise<{ result: string; cached: boolean }> {
  const trimmed = text.trim();
  if (!trimmed) throw new AiError('input', 'متنی انتخاب نشده است');
  if (trimmed.length > MAX_TEXT) throw new AiError('input', 'متن انتخاب‌شده طولانی است');
  if (settings.ai.mode === 'proxy' && !token) {
    throw new AiError('unconfigured', 'برای این حالت باید وارد حساب شوید');
  }

  const key = await cacheKey({
    task,
    model: settings.ai.model,
    targetLang: settings.ai.targetLang,
    text: trimmed,
  });

  if (settings.ai.cache && !force) {
    const hit = readCache(key);
    if (hit !== null) return { result: hit, cached: true };
  }

  if (!navigator.onLine) throw new AiError('offline', 'اتصال اینترنت برقرار نیست');

  const result = settings.ai.mode === 'proxy'
    ? await viaProxy(task, trimmed, settings.ai.targetLang, token!)
    : await viaDirect(task, trimmed, settings.ai.targetLang, settings);

  // Failures throw before reaching here, so only successful, non-empty results are cached.
  if (settings.ai.cache) writeCache(key, result);
  return { result, cached: false };
}
