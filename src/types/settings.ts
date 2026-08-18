export interface AiSettings {
  /** `proxy` sends to our server (needs an account); `direct` calls the user's own endpoint. */
  mode: 'proxy' | 'direct';
  /** OpenAI-compatible base URL. Direct mode only — the server never accepts one. */
  baseUrl: string;
  model: string;
  /** Direct mode only. A device credential: never synced, never sent to our server. */
  apiKey: string | null;
  /** ISO code the translate task targets. */
  targetLang: string;
  cache: boolean;
}

export interface Settings {
  version: number;
  theme: 'light' | 'dark' | 'system';
  /** null = no timer; focus/online/manual triggers still run. */
  syncIntervalMs: number | null;
  ai: AiSettings;
  experimentalEditor: boolean;
  updatedAt: number;
  /** Local-only sync bookkeeping. Stripped before settings go to the server. */
  dirty: boolean;
}

/** The settings shape the server speaks — bookkeeping and the provider key stripped. */
export type WireSettings = Omit<Settings, 'dirty' | 'ai'> & { ai: Omit<AiSettings, 'apiKey'> };

export const SETTINGS_VERSION = 3;

export const DEFAULT_SETTINGS: Settings = {
  version: SETTINGS_VERSION,
  theme: 'system',
  // 60s is what useSync has always done; existing users must see no change.
  syncIntervalMs: 60_000,
  ai: {
    mode: 'proxy',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    apiKey: null,
    targetLang: 'fa',
    cache: true,
  },
  experimentalEditor: false,
  updatedAt: 0,
  dirty: false,
};

export const SYNC_INTERVALS: { value: number | null; label: string }[] = [
  { value: null, label: 'خاموش' },
  { value: 60_000, label: 'هر ۱ دقیقه' },
  { value: 300_000, label: 'هر ۵ دقیقه' },
  { value: 900_000, label: 'هر ۱۵ دقیقه' },
  { value: 3_600_000, label: 'هر ۶۰ دقیقه' },
];

const THEMES: Settings['theme'][] = ['light', 'dark', 'system'];
const AI_MODES: AiSettings['mode'][] = ['proxy', 'direct'];

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function pickString(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}

function pickBool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

/**
 * Fields are read one at a time rather than spread: a stored object from an older
 * build must never produce `undefined` at a read site, and an unknown key from a
 * newer build must never survive into a push. Same reasoning as `migrateNotes`.
 */
export function migrateSettings(raw: unknown): Settings {
  if (!isRecord(raw)) return { ...DEFAULT_SETTINGS, ai: { ...DEFAULT_SETTINGS.ai } };

  const ai = isRecord(raw.ai) ? raw.ai : {};
  const theme = raw.theme;
  const interval = raw.syncIntervalMs;

  return {
    version: SETTINGS_VERSION,
    theme: THEMES.includes(theme as Settings['theme'])
      ? (theme as Settings['theme'])
      : DEFAULT_SETTINGS.theme,
    // `null` is a real value here (manual only), so it is checked before the type test.
    syncIntervalMs:
      interval === null
        ? null
        : typeof interval === 'number' && interval > 0
          ? interval
          : DEFAULT_SETTINGS.syncIntervalMs,
    ai: {
      mode: AI_MODES.includes(ai.mode as AiSettings['mode'])
        ? (ai.mode as AiSettings['mode'])
        : DEFAULT_SETTINGS.ai.mode,
      baseUrl: pickString(ai.baseUrl, DEFAULT_SETTINGS.ai.baseUrl),
      model: pickString(ai.model, DEFAULT_SETTINGS.ai.model),
      apiKey: typeof ai.apiKey === 'string' ? ai.apiKey : null,
      targetLang: pickString(ai.targetLang, DEFAULT_SETTINGS.ai.targetLang),
      cache: pickBool(ai.cache, DEFAULT_SETTINGS.ai.cache),
    },
    experimentalEditor: pickBool(raw.experimentalEditor, DEFAULT_SETTINGS.experimentalEditor),
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : DEFAULT_SETTINGS.updatedAt,
    dirty: pickBool(raw.dirty, DEFAULT_SETTINGS.dirty),
  };
}

/**
 * Listed rather than spread-and-deleted, for the same reason as `toWire` in note.ts:
 * the server rejects unknown properties, and `ai.apiKey` must be structurally
 * impossible to leak — a spread would ship it the day someone forgets.
 */
export function toWireSettings(s: Settings): WireSettings {
  return {
    version: s.version,
    theme: s.theme,
    syncIntervalMs: s.syncIntervalMs,
    ai: {
      mode: s.ai.mode,
      baseUrl: s.ai.baseUrl,
      model: s.ai.model,
      targetLang: s.ai.targetLang,
      cache: s.ai.cache,
    },
    experimentalEditor: s.experimentalEditor,
    updatedAt: s.updatedAt,
  };
}
