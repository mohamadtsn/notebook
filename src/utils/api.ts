import type { WireNote } from '../types/note';
import type { WireSettings } from '../types/settings';
import type { WireGroup } from '../types/group';
import type { WireAttachment } from '../types/attachment';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit, token?: string | null): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      // Only when there is actually a body. Fastify rejects a request that announces
      // JSON and then sends nothing with a 400 — which is every bodyless DELETE.
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  if (!res.ok) throw new ApiError(res.status, `${init.method ?? 'GET'} ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

export interface DeviceSession {
  id: string;
  createdAt: number;
  lastSeenAt: number;
  userAgent: string | null;
  /** The device making the request. Revoking it is a sign-out. */
  current: boolean;
}

/** `/auth/me`. `isAdmin` is derived server-side from ADMIN_EMAILS, never from the token. */
export interface Me {
  id: string;
  email: string;
  tier: 'free' | 'pro';
  isAdmin: boolean;
}

/** One row of `/admin/users`. Server-computed: the client never counts anything itself. */
export interface AdminUser {
  id: string;
  email: string;
  tier: 'free' | 'pro';
  disabled: boolean;
  createdAt: number;
  noteCount: number;
  sessionCount: number;
  aiUsedToday: number;
  attachmentBytes: number;
}

export const api = {
  me: (token: string) => request<Me>('/auth/me', { method: 'GET' }, token),

  register: (email: string, password: string) =>
    request<{ token: string }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  login: (email: string, password: string) =>
    request<{ token: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  push: (token: string, notes: WireNote[], groups: WireGroup[]) =>
    request<{ serverTime: number; rejected: string[]; rejectedGroups: string[] }>(
      '/sync/push',
      { method: 'POST', body: JSON.stringify({ notes, groups }) },
      token,
    ),

  // `attachments` is pull-only: an attachment is created and deleted through
  // /attachments, both of which need the network, so nothing is ever queued locally.
  pull: (token: string, since: number) =>
    request<{
      notes: WireNote[];
      groups: WireGroup[];
      attachments?: WireAttachment[];
      serverTime: number;
    }>(
      `/sync/pull?since=${since}`,
      { method: 'GET' },
      token,
    ),

  getSettings: (token: string) =>
    request<{ settings: WireSettings | null; updatedAt: number }>(
      '/settings',
      { method: 'GET' },
      token,
    ),

  // Not under /auth/ — see the comment on the routes. Authenticated, unthrottled.
  sessions: (token: string) =>
    request<{ sessions: DeviceSession[] }>('/sessions', { method: 'GET' }, token),

  revokeSession: (token: string, id: string) =>
    request<{ ok: true }>(`/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }, token),

  revokeOtherSessions: (token: string) =>
    request<{ ok: true }>('/sessions', { method: 'DELETE' }, token),

  admin: {
    // The server caps `limit` at 100 and validates it at the route boundary; this is the
    // page size the panel asks for, not the trusted one.
    users: (token: string, limit = 50, offset = 0) =>
      request<{ total: number; users: AdminUser[] }>(
        `/admin/users?limit=${limit}&offset=${offset}`,
        { method: 'GET' },
        token,
      ),

    patchUser: (token: string, id: string, patch: { tier?: 'free' | 'pro'; disabled?: boolean }) =>
      request<{ ok: true }>(
        `/admin/users/${encodeURIComponent(id)}`,
        { method: 'PATCH', body: JSON.stringify(patch) },
        token,
      ),

    revokeSessions: (token: string, id: string) =>
      request<{ ok: true }>(
        `/admin/users/${encodeURIComponent(id)}/sessions`,
        { method: 'DELETE' },
        token,
      ),
  },

  putSettings: (token: string, settings: WireSettings, updatedAt: number) =>
    request<{ settings: WireSettings; updatedAt: number }>(
      '/settings',
      { method: 'PUT', body: JSON.stringify({ settings, updatedAt }) },
      token,
    ),
};