import type { WireNote } from '../types/note';

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
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  if (!res.ok) throw new ApiError(res.status, `${init.method ?? 'GET'} ${path} → ${res.status}`);
  return res.json() as Promise<T>;
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

  push: (token: string, notes: WireNote[]) =>
    request<{ serverTime: number; rejected: string[] }>(
      '/sync/push',
      { method: 'POST', body: JSON.stringify({ notes }) },
      token,
    ),

  pull: (token: string, since: number) =>
    request<{ notes: WireNote[]; serverTime: number }>(
      `/sync/pull?since=${since}`,
      { method: 'GET' },
      token,
    ),
};