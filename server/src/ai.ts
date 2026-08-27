import type { FastifyInstance } from 'fastify';
import type { Db } from './db.ts';
import { userId } from './auth.ts';

const MAX_TEXT = 20_000;
const TASKS = ['improve', 'translate'];
/** Allowlisted, not free text: the value is interpolated into the system prompt. */
const LANGS = ['fa', 'en', 'ar', 'de', 'fr', 'es', 'tr', 'ru'];

export type Provider = (messages: { role: string; content: string }[]) => Promise<string>;

/**
 * Deliberately duplicated from `src/utils/ai.ts` rather than shared: the proxy must
 * build its own prompt. Accepting one from the client would mean the server signs
 * arbitrary instructions with its own key.
 */
function buildMessages(task: string, text: string, targetLang: string) {
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

/**
 * The provider is built from the server's OWN environment. The client never supplies a
 * base URL (that would make this an SSRF gadget), a model, or a key (the server cannot
 * vouch for a secret it is handed).
 */
export function providerFromEnv(): Provider | undefined {
  const baseUrl = process.env.AI_BASE_URL;
  const apiKey = process.env.AI_API_KEY;
  const model = process.env.AI_MODEL;
  if (!baseUrl || !apiKey || !model) return undefined;

  return async messages => {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages }),
    });
    if (!res.ok) throw new Error(`provider ${res.status}`);
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return body.choices?.[0]?.message?.content ?? '';
  };
}

export async function aiRoutes(app: FastifyInstance, db: Db, provider?: Provider) {
  // Keyed on the user id from the token, like every other statement in this server.
  const readUsage = db.prepare('SELECT count FROM ai_usage WHERE user_id = ? AND day = ?');
  const bumpUsage = db.prepare(`
    INSERT INTO ai_usage (user_id, day, count) VALUES (?, ?, 1)
    ON CONFLICT(user_id, day) DO UPDATE SET count = count + 1
  `);

  app.post('/ai/complete', {
    // The proxy spends the server's own API key, so it is the one thing behind the tier.
    // «مستقیم» mode is untouched: it uses the user's own key and never reaches here.
    onRequest: [app.authenticate, app.requirePro],
    // The per-minute limit rides the global @fastify/rate-limit plugin; see index.ts,
    // where /ai/ is removed from its allowList so this config is honoured.
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object',
        required: ['task', 'text'],
        additionalProperties: false,
        properties: {
          task: { type: 'string', enum: TASKS },
          text: { type: 'string', minLength: 1, maxLength: MAX_TEXT },
          targetLang: { type: 'string', enum: LANGS, default: 'fa' },
        },
      },
    },
  }, async (req, reply) => {
    // Answering 503 rather than 500 is what lets the UI say "not configured" instead of
    // showing the user a server error for something that is not broken.
    if (!provider) return reply.code(503).send({ error: 'ai_not_configured' });

    const uid = userId(req);
    const day = new Date().toISOString().slice(0, 10);
    const limit = Number(process.env.AI_DAILY_LIMIT ?? 300);
    const used = (readUsage.get(uid, day) as { count: number } | undefined)?.count ?? 0;
    if (used >= limit) return reply.code(429).send({ error: 'daily_limit' });

    const { task, text, targetLang = 'fa' } = req.body as
      { task: string; text: string; targetLang?: string };

    // Counted before the call: a provider timeout must not be a free retry loop.
    bumpUsage.run(uid, day);

    try {
      return { result: await provider(buildMessages(task, text, targetLang)) };
    } catch {
      // The provider's own message may carry the key or an internal URL; it never
      // reaches the client.
      return reply.code(502).send({ error: 'provider_failed' });
    }
  });
}
