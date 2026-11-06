import type { ApiFailure, ApiSuccess, ErrorCode, PaginationMeta } from '@cadence/shared';

/**
 * The one way this app talks to the API.
 *
 * Responsibilities, all in one place so no component has to think about them:
 *  - send cookies (`credentials: 'include'`)
 *  - echo the readable `csrf_token` cookie as `X-CSRF-Token` on mutations
 *  - unwrap the `{ success, message, data, meta }` envelope
 *  - throw a typed `ApiError` carrying the status, stable code and field errors
 *  - on a 401, refresh ONCE through a shared in-flight promise, retry, and if
 *    that fails, clear auth state and bounce to /login?next=…
 */

// Vite types `import.meta.env` loosely, so the value is narrowed here rather
// than letting an `any` leak into every request URL.
export const API_BASE: string = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api/v1';

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly fieldErrors?: Record<string, string[]>;

  constructor(
    status: number,
    code: ErrorCode,
    message: string,
    fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    if (fieldErrors) this.fieldErrors = fieldErrors;
  }

  /** 4xx other than 408/429: retrying will not change the answer. */
  get isClientError(): boolean {
    return this.status >= 400 && this.status < 500 && ![408, 429].includes(this.status);
  }
}

export type Paginated<T> = { items: T; meta: PaginationMeta };

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

/**
 * Hooks the api-client up to the rest of the app without importing React
 * here: the query client registers a cache-clearing callback at start-up.
 */
let onUnauthenticated: (() => void) | undefined;
export function setUnauthenticatedHandler(handler: () => void): void {
  onUnauthenticated = handler;
}

/** Single-flight refresh: a burst of 401s triggers exactly one refresh call. */
let refreshInFlight: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const response = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      // Cleared on the microtask after settling, so concurrent callers all
      // observe the same result before a new attempt can start.
      queueMicrotask(() => {
        refreshInFlight = null;
      });
    }
  })();
  return refreshInFlight;
}

function redirectToLogin(): void {
  const current = `${window.location.pathname}${window.location.search}`;
  if (window.location.pathname === '/login') return;
  const next = encodeURIComponent(current);
  window.location.assign(`/login?next=${next}`);
}

export type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  signal?: AbortSignal;
  /** Used by the progress tracker's unload flush. */
  keepalive?: boolean;
  /** Internal: prevents a refresh loop. */
  skipRefresh?: boolean;
};

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = `${API_BASE}${path}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const queryString = params.toString();
  return queryString ? `${url}?${queryString}` : url;
}

async function parse<T>(response: Response): Promise<{ data: T; meta?: PaginationMeta }> {
  if (response.status === 204) return { data: undefined as T };

  const text = await response.text();
  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    // A non-JSON body means something upstream (a proxy, a crash) answered.
    throw new ApiError(response.status, 'INTERNAL_ERROR', 'The server sent an unreadable response');
  }

  if (!response.ok) {
    const failure = payload as ApiFailure;
    throw new ApiError(
      response.status,
      failure?.code ?? 'INTERNAL_ERROR',
      failure?.message ?? 'Something went wrong',
      failure?.errors,
    );
  }

  const success = payload as ApiSuccess<T>;
  return success.meta ? { data: success.data, meta: success.meta } : { data: success.data };
}

async function send<T>(path: string, options: RequestOptions = {}): Promise<{ data: T; meta?: PaginationMeta }> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  if (MUTATING.has(method)) {
    const csrf = readCookie('csrf_token');
    // Sent when present; the server is the thing that enforces it.
    if (csrf) headers['X-CSRF-Token'] = csrf;
  }

  const response = await fetch(buildUrl(path, options.query), {
    method,
    headers,
    credentials: 'include',
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.keepalive ? { keepalive: true } : {}),
  });

  // 401 → one refresh, then one retry.  Auth endpoints opt out, so a failed
  // login cannot start a refresh loop.
  if (response.status === 401 && !options.skipRefresh && !path.startsWith('/auth/')) {
    const refreshed = await refreshSession();
    if (refreshed) {
      return send<T>(path, { ...options, skipRefresh: true });
    }
    onUnauthenticated?.();
    redirectToLogin();
  }

  return parse<T>(response);
}

export const apiClient = {
  async get<T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T> {
    return (await send<T>(path, { ...options, method: 'GET' })).data;
  },

  /** For list endpoints, where `meta` is part of the answer. */
  async getPaginated<T>(
    path: string,
    options?: Omit<RequestOptions, 'method' | 'body'>,
  ): Promise<Paginated<T>> {
    const result = await send<T>(path, { ...options, method: 'GET' });
    return {
      items: result.data,
      meta: result.meta ?? { page: 1, pageSize: 0, total: 0, totalPages: 1 },
    };
  },

  async post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return (await send<T>(path, { ...options, method: 'POST', body })).data;
  },

  async put<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return (await send<T>(path, { ...options, method: 'PUT', body })).data;
  },

  async patch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return (await send<T>(path, { ...options, method: 'PATCH', body })).data;
  },

  async delete<T = void>(path: string, options?: RequestOptions): Promise<T> {
    return (await send<T>(path, { ...options, method: 'DELETE' })).data;
  },

  /**
   * A fire-and-forget write for `pagehide` / `visibilitychange`.
   *
   * `fetch(..., { keepalive: true })` rather than `navigator.sendBeacon`:
   * sendBeacon cannot set the `X-CSRF-Token` header, so the request would be
   * rejected. Errors are swallowed deliberately — the page is going away and
   * there is nothing left to show a message on.
   */
  flush(path: string, body: unknown): void {
    const csrf = readCookie('csrf_token');
    void fetch(buildUrl(path), {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
      },
      credentials: 'include',
      keepalive: true,
      body: JSON.stringify(body),
    }).catch(() => {
      /* the page is unloading; a failed flush costs at most a few seconds */
    });
  },
};
