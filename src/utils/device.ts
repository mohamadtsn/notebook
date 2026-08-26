/**
 * A user-agent string turned into something a person recognises in a device list.
 *
 * Deliberately not a UA-parsing dependency: this label is cosmetic, it never gates
 * anything, and being wrong about a rare browser costs nothing. Order matters — the
 * checks run most-specific first, because every Chromium browser also says "Chrome"
 * and every one of them also says "Safari".
 */
const BROWSERS: [RegExp, string][] = [
  [/\bEdgA?\//,          'Edge'],
  [/\bOPR\/|\bOpera\//,  'Opera'],
  [/\bSamsungBrowser\//, 'Samsung Internet'],
  [/\bFirefox\/|\bFxiOS\//, 'Firefox'],
  [/\bCriOS\//,          'Chrome'],
  [/\bChrome\//,         'Chrome'],
  [/\bSafari\//,         'Safari'],
];

const PLATFORMS: [RegExp, string][] = [
  // iPadOS reports as a Mac, so iPad has to be tested before Macintosh.
  [/\biPad\b/,                     'iPad'],
  [/\biPhone\b/,                   'iPhone'],
  [/\bAndroid\b/,                  'Android'],
  [/\bWindows\b/,                  'Windows'],
  [/\bMacintosh\b|\bMac OS X\b/,   'macOS'],
  [/\bCrOS\b/,                     'ChromeOS'],
  [/\bLinux\b/,                    'Linux'],
];

const first = (table: [RegExp, string][], ua: string): string | null =>
  table.find(([re]) => re.test(ua))?.[1] ?? null;

export function deviceLabel(userAgent: string | null): string {
  if (!userAgent) return 'دستگاه ناشناس';
  const browser = first(BROWSERS, userAgent);
  const platform = first(PLATFORMS, userAgent);
  if (browser && platform) return `${browser} روی ${platform}`;
  return browser ?? platform ?? 'دستگاه ناشناس';
}

/**
 * Touch or pen — the long press belongs to the platform on such a device, so our own
 * menus need an explicit affordance instead of the `contextmenu` event. Read per call
 * rather than cached: a hybrid laptop can gain and lose a touch pointer at runtime.
 */
export function isCoarsePointer(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
}
