import type { WireNote } from '../types/note';
import type { WireSettings } from '../types/settings';
import type { WireGroup } from '../types/group';

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

export const api = {
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

  pull: (token: string, since: number) =>
    request<{ notes: WireNote[]; groups: WireGroup[]; serverTime: number }>(
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

  putSettings: (token: string, settings: WireSettings, updatedAt: number) =>
    request<{ settings: WireSettings; updatedAt: number }>(
      '/settings',
      { method: 'PUT', body: JSON.stringify({ settings, updatedAt }) },
      token,
    ),
};