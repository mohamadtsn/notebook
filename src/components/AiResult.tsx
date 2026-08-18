import { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, RefreshCw, Settings2, X } from 'lucide-react';
import type { Settings } from '../types/settings';
import type { AiTask } from '../utils/aiCache';
import { AiError, callAi } from '../utils/ai';
import { useTextDirection } from '../hooks/useTextDirection';
import { ContextMenu } from './ui/ContextMenu';
import { Button } from './ui/Button';

interface AiResultProps {
  x: number;
  y: number;
  task: AiTask;
  text: string;
  settings: Settings;
  token: string | null;
  onReplace: (result: string) => void;
  onOpenSettings: () => void;
  onClose: () => void;
}

/** One plain sentence per failure. Never a status code, never a stack. DESIGN.md §6. */
const MESSAGES: Record<string, string> = {
  unconfigured: 'اتصال هوش مصنوعی تنظیم نشده است.',
  offline: 'اتصال اینترنت برقرار نیست.',
  rate_limited: 'سقف درخواست‌ها پر شده است؛ کمی بعد دوباره تلاش کنید.',
  unauthorized: 'نشست منقضی شده است؛ دوباره وارد شوید.',
  provider: 'سرویس پاسخ نداد.',
  input: 'متن انتخاب‌شده برای این کار مناسب نیست.',
};

export function AiResult({
  x, y, task, text, settings, token, onReplace, onOpenSettings, onClose,
}: AiResultProps) {
  const [state, setState] = useState<'loading' | 'done' | 'error'>('loading');
  const [result, setResult] = useState('');
  const [cached, setCached] = useState(false);
  const [errorKind, setErrorKind] = useState<string>('provider');
  // The result's own direction: a translation into another script must not inherit the
  // source's. DESIGN.md §6.
  const dir = useTextDirection(result);

  /**
   * No `setState('loading')` here: that is the initial state, and setting state
   * synchronously inside the mount effect below is both a lint error and a wasted
   * render. The retry paths set it themselves — see `retry`.
   */
  const run = useCallback(async (force: boolean) => {
    try {
      const res = await callAi({ task, text, settings, token, force });
      setResult(res.result);
      setCached(res.cached);
      setState('done');
    } catch (err) {
      setErrorKind(err instanceof AiError ? err.kind : 'provider');
      setState('error');
    }
  }, [task, text, settings, token]);

  const retry = useCallback(() => { setState('loading'); void run(true); }, [run]);

  /**
   * Fire exactly once per mount. StrictMode invokes mount effects twice in development,
   * and this effect starts a *billed* request — the second one is money and quota spent
   * on a result that is thrown away. The popover is mounted per request, so "once" is
   * the whole contract; «دوباره تولید کن» is the deliberate way to ask again.
   */
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void run(false);
  }, [run]);

  return (
    <ContextMenu x={x} y={y} onClose={onClose}>
      <div className="max-w-[28rem] p-2">
        {state === 'loading' && (
          // A caption, not a spinner: the request is the wait, and animating it for
          // multiple seconds only draws attention to the delay. DESIGN.md §6.
          <p className="px-2 py-3 text-xs text-muted">
            {task === 'translate' ? 'در حال ترجمه…' : 'در حال بهبود…'}
          </p>
        )}

        {state === 'error' && (
          <div className="px-2 py-2">
            <p className="mb-2 text-xs leading-relaxed text-ink">{MESSAGES[errorKind]}</p>
            <div className="flex gap-1">
              {errorKind === 'unconfigured' ? (
                <Button variant="primary" size="sm" onClick={onOpenSettings}>
                  <Settings2 size={14} /> تنظیمات
                </Button>
              ) : (
                <Button variant="ghost" size="sm" onClick={retry}>
                  <RefreshCw size={14} /> دوباره تلاش کن
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={onClose}>
                <X size={14} /> بستن
              </Button>
            </div>
          </div>
        )}

        {state === 'done' && (
          <>
            <div
              dir={dir}
              className="max-h-[40vh] overflow-y-auto rounded-md bg-fill px-3 py-2 text-sm leading-[1.8] text-ink whitespace-pre-wrap"
            >
              {result}
            </div>
            {/* Never hidden: a user expecting fresh output must be able to see why it
                was instant, and reach «دوباره تولید کن». */}
            {cached && (
              <p className="px-1 pt-1.5 text-[.6875rem] text-muted">از حافظهٔ محلی</p>
            )}
            <div className="mt-2 flex flex-wrap gap-1">
              <Button variant="primary" size="sm" onClick={() => { onReplace(result); onClose(); }}>
                جایگزین کن
              </Button>
              <Button variant="ghost" size="sm" onClick={() => void navigator.clipboard?.writeText(result)}>
                <Copy size={14} /> کپی
              </Button>
              <Button variant="ghost" size="sm" onClick={retry}>
                <RefreshCw size={14} /> دوباره تولید کن
              </Button>
              <Button variant="ghost" size="sm" onClick={onClose}>لغو</Button>
            </div>
          </>
        )}
      </div>
    </ContextMenu>
  );
}
