import { useCallback, useEffect, useState } from 'react';
import type { AiSettings, Settings, WireSettings } from '../types/settings';
import { DEFAULT_SETTINGS, migrateSettings } from '../types/settings';
import { getItem, setItem } from '../utils/storage';

const STORAGE_KEY = 'notebook_settings';
const LEGACY_DARK_KEY = 'notebook_dark';

function persist(s: Settings): void {
  setItem(STORAGE_KEY, s);
}

/**
 * A user who has only ever used v1/v2 has `notebook_dark` and no settings object.
 * Their explicit light/dark choice is adopted once; defaulting them to `system`
 * would silently change the theme of an app they already configured.
 */
function initialSettings(): Settings {
  const stored = getItem<unknown>(STORAGE_KEY, null);
  if (stored !== null) return migrateSettings(stored);
  const legacyDark = getItem<boolean | null>(LEGACY_DARK_KEY, null);
  if (typeof legacyDark === 'boolean') {
    return migrateSettings({ ...DEFAULT_SETTINGS, theme: legacyDark ? 'dark' : 'light' });
  }
  return migrateSettings(DEFAULT_SETTINGS);
}

/**
 * Same contract as useNotes: persistence is synchronous inside the state updater,
 * so there is no save effect and no window where a write can be lost.
 */
export function useSettings() {
  const [settings, setSettings] = useState<Settings>(initialSettings);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings(prev => {
      const updated = { ...prev, ...patch, updatedAt: Date.now(), dirty: true };
      persist(updated);
      return updated;
    });
  }, []);

  /** `ai` is nested, so a top-level patch would replace the whole sub-object. */
  const updateAi = useCallback((patch: Partial<AiSettings>) => {
    setSettings(prev => {
      const updated = {
        ...prev,
        ai: { ...prev.ai, ...patch },
        updatedAt: Date.now(),
        dirty: true,
      };
      persist(updated);
      return updated;
    });
  }, []);

  /**
   * The single write path for remote settings. Whole-object last-write-wins, and a
   * locally-dirty object is never replaced — the same rule the note merge uses, for
   * the same reason: unpushed local intent outranks a server echo.
   *
   * `apiKey` is preserved from the local copy because the server has never seen it.
   */
  const applyRemote = useCallback((remote: WireSettings) => {
    setSettings(prev => {
      // Our own write coming back: adopt it and clear the flag. Without this the flag
      // would stay on forever and re-push every cycle.
      if (remote.updatedAt === prev.updatedAt) {
        if (!prev.dirty) return prev;
        const updated = { ...prev, dirty: false };
        persist(updated);
        return updated;
      }
      if (prev.dirty && remote.updatedAt < prev.updatedAt) return prev;
      if (remote.updatedAt <= prev.updatedAt) return prev;
      const incoming = migrateSettings(remote);
      const updated: Settings = {
        ...incoming,
        ai: { ...incoming.ai, apiKey: prev.ai.apiKey },
        updatedAt: remote.updatedAt,
        dirty: false,
      };
      persist(updated);
      return updated;
    });
  }, []);

  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  );

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const resolvedDark = settings.theme === 'system' ? systemDark : settings.theme === 'dark';

  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolvedDark);
  }, [resolvedDark]);

  return { settings, update, updateAi, applyRemote, resolvedDark };
}
