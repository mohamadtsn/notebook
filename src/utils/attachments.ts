import type { WireAttachment } from '../types/attachment';

const BASE = (import.meta as { env?: Record<string, string> }).env?.VITE_API_URL
  ?? 'http://localhost:3000';

/** Mirrors the server's `MAX_FILE_BYTES`. Client-side checks are UX, not security. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/**
 * Dangerous file extensions that execute directly on desktop operating systems
 * or trigger scripting hosts. Developer files (.sh, .py, .ts, .ps1, etc.) are allowed.
 */
export const DISALLOWED_EXTENSIONS = new Set([
  'exe', 'dll', 'com', 'scr', 'pif', 'cpl', 'hta', 'msi', 'msp',
  'bat', 'cmd', 'vbs', 'vbe', 'wsf', 'wsh',
  'reg', 'inf', 'lnk',
  'dmg', 'pkg', 'apk',
]);

export const DISALLOWED_MIME = new Set([
  'application/x-msdownload',
  'application/x-msdos-program',
  'application/x-executable',
  'application/x-dosexec',
  'application/x-bat',
  'application/vnd.microsoft.portable-executable',
]);

export const BROWSER_EXECUTABLE_EXTENSIONS = new Set([
  'html', 'htm', 'xhtml', 'svg', 'svgz',
]);

export const BROWSER_EXECUTABLE_MIME = new Set([
  'text/html', 'image/svg+xml', 'application/xhtml+xml',
]);

const RTLO_AND_BIDI_CONTROLS = /[\u202A-\u202E\u2066-\u2069]/g;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x1F\x7F]/g;

export function sanitizeFilename(raw: string): string {
  const cleaned = raw
    .replace(RTLO_AND_BIDI_CONTROLS, '')
    .replace(CONTROL_CHARS, '')
    .trim();
  return (cleaned || 'file').slice(0, 255);
}

export function getFileExtension(filename: string): string {
  const clean = sanitizeFilename(filename);
  const lastDot = clean.lastIndexOf('.');
  if (lastDot === -1 || lastDot === clean.length - 1) return '';
  return clean.slice(lastDot + 1).toLowerCase();
}

export function isDangerousFile(filename: string, mime?: string): boolean {
  const ext = getFileExtension(filename);
  if (ext && DISALLOWED_EXTENSIONS.has(ext)) return true;
  if (mime && DISALLOWED_MIME.has(mime.toLowerCase())) return true;
  return false;
}

export function isBrowserExecutable(filename: string, mime?: string): boolean {
  const ext = getFileExtension(filename);
  if (ext && BROWSER_EXECUTABLE_EXTENSIONS.has(ext)) return true;
  if (mime && BROWSER_EXECUTABLE_MIME.has(mime.toLowerCase())) return true;
  return false;
}

export type AttachmentErrorKind =
  | 'too_large' | 'unsupported' | 'quota' | 'too_many' | 'tier_required' | 'offline' | 'failed';

export class AttachmentError extends Error {
  kind: AttachmentErrorKind;
  constructor(kind: AttachmentErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

/** One plain Persian sentence per failure — never a status code. DESIGN.md §6. */
export const ATTACHMENT_MESSAGES: Record<AttachmentErrorKind, string> = {
  too_large: 'حجم فایل بیش از ۱۰ مگابایت است.',
  unsupported: 'بارگذاری این نوع فایل به دلایل امنیتی مجاز نیست.',
  quota: 'فضای ذخیره‌سازی حساب شما پر شده است.',
  too_many: 'برای هر یادداشت حداکثر ۲۰ فایل می‌توان افزود.',
  tier_required: 'حساب شما به پیوست فایل دسترسی ندارد.',
  offline: 'اتصال اینترنت برقرار نیست.',
  failed: 'افزودن فایل انجام نشد.',
};

/** Refused locally, before a byte travels. The server checks all of this again. */
export function precheck(file: File): AttachmentErrorKind | null {
  if (file.size > MAX_FILE_BYTES) return 'too_large';
  if (isDangerousFile(file.name, file.type)) return 'unsupported';
  return null;
}

const KIND_BY_STATUS: Record<number, AttachmentErrorKind> = {
  403: 'tier_required',
  409: 'too_many',
  413: 'too_large',
  415: 'unsupported',
};

/**
 * `XMLHttpRequest`, not `fetch`: upload progress is an `xhr.upload` event and `fetch`
 * still has no equivalent that ships everywhere. `AbortController` works with both, so
 * cancellation is the same either way.
 *
 * ponytail: no offline blob cache. Attachments require the network in v1 — if that turns
 * out to matter, IndexedDB keyed by attachment id is the upgrade path, behind the same
 * `downloadUrl` call site.
 */
export function upload(
  token: string,
  noteId: string,
  file: File,
  { signal, onProgress }: { signal?: AbortSignal; onProgress?: (fraction: number) => void } = {},
): Promise<WireAttachment> {
  const kind = precheck(file);
  if (kind) return Promise.reject(new AttachmentError(kind, ATTACHMENT_MESSAGES[kind]));
  if (!navigator.onLine) {
    return Promise.reject(new AttachmentError('offline', ATTACHMENT_MESSAGES.offline));
  }

  // `noteId` before the file: the server reads it off the multipart stream as the file
  // part arrives, and a field appended after has not been parsed yet.
  const body = new FormData();
  body.append('noteId', noteId);
  body.append('file', file);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${BASE}/attachments`);
    xhr.setRequestHeader('authorization', `Bearer ${token}`);
    xhr.upload.addEventListener('progress', e => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    });
    xhr.addEventListener('load', () => {
      if (xhr.status === 200) {
        try {
          return resolve(JSON.parse(xhr.responseText) as WireAttachment);
        } catch {
          return reject(new AttachmentError('failed', ATTACHMENT_MESSAGES.failed));
        }
      }
      // A 413 from the quota check and a 413 from the size check read the same to the
      // client, so the body distinguishes them.
      const quota = xhr.status === 413 && xhr.responseText.includes('quota');
      const k = quota ? 'quota' : KIND_BY_STATUS[xhr.status] ?? 'failed';
      reject(new AttachmentError(k, ATTACHMENT_MESSAGES[k]));
    });
    xhr.addEventListener('error', () =>
      reject(new AttachmentError('failed', ATTACHMENT_MESSAGES.failed)));
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(body);
  });
}

export async function remove(token: string, id: string): Promise<void> {
  const res = await fetch(`${BASE}/attachments/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new AttachmentError('failed', 'حذف فایل انجام نشد.');
}

/**
 * Downloads go through fetch rather than a plain link: the route is authenticated and an
 * `<a href>` carries no Authorization header. The object URL is revoked immediately —
 * the browser has already taken its own reference by then.
 */
export async function download(token: string, id: string, name: string): Promise<void> {
  const res = await fetch(`${BASE}/attachments/${encodeURIComponent(id)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new AttachmentError('failed', 'دریافت فایل انجام نشد.');
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
