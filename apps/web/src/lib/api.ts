/**
 * Typed REST client for the Enbox API (see `ApiRoutes` in @enbox/shared for every endpoint).
 *
 *   const chats = await api.get<ChatSummary[]>('/api/chats');
 *   const msg = await api.post<Message>(`/api/chats/${chatId}/messages`, body);
 *   await api.delete(`/api/messages/${id}`, undefined, { query: { for: 'everyone' } });
 *   const media = await api.upload(file, { kind: 'image', width, height }, (p) => setProgress(p));
 *
 * Or derive types from the catalogue: `api.get<ApiResponse<'GET /api/chats'>>('/api/chats')`.
 *
 * - Paths are the full `/api/...` paths from the catalogue; they are resolved against
 *   `VITE_API_URL` when set (native wrappers), otherwise same-origin.
 * - The bearer token is attached automatically (set by the auth store via `setApiToken`).
 * - Non-2xx responses throw `ApiError` (code/message/status/details from `ApiErrorBody`);
 *   network failures throw `ApiError` with code `network_error` and status 0.
 * - A 401 on any authenticated call (except login/register) triggers the global
 *   unauthorized handler (auth store → logout).
 */
import type {
  ApiErrorBody,
  ApiErrorCode,
  ApiRoutes,
  MediaAttachment,
  MediaKind,
} from '@enbox/shared';
import { API_ORIGIN } from './env';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Client-side failure codes in addition to the server's `ApiErrorCode`s. */
export type ClientErrorCode = 'network_error' | 'timeout' | 'aborted' | 'bad_response';

export class ApiError extends Error {
  readonly code: ApiErrorCode | ClientErrorCode;
  /** HTTP status; 0 when the request never got a response. */
  readonly status: number;
  readonly details?: unknown;

  constructor(
    code: ApiErrorCode | ClientErrorCode,
    message: string,
    status = 0,
    details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }

  /** True for connectivity problems (worth retrying / showing "offline"). */
  get isNetworkError(): boolean {
    return this.code === 'network_error' || this.code === 'timeout';
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}

/** Best human-readable message for any thrown value. */
export function errorMessage(e: unknown, fallback = 'Something went wrong'): string {
  if (e instanceof ApiError) {
    if (e.isNetworkError) return "Can't reach Enbox. Check your connection.";
    return e.message || fallback;
  }
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === 'string' && e) return e;
  return fallback;
}

/**
 * Map a `validation_error`'s zod issues (`details`) to `{ fieldName: message }` for forms.
 */
export function fieldErrors(e: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!(e instanceof ApiError) || e.code !== 'validation_error' || !Array.isArray(e.details))
    return out;
  for (const issue of e.details as { path?: unknown; message?: unknown }[]) {
    const key = Array.isArray(issue.path) && issue.path.length ? String(issue.path[0]) : '';
    if (key && typeof issue.message === 'string' && !out[key]) out[key] = issue.message;
  }
  return out;
}

function toApiError(status: number, body: unknown, fallbackText = ''): ApiError {
  const err = (body as Partial<ApiErrorBody> | null)?.error;
  if (err && typeof err.code === 'string') {
    return new ApiError(err.code, err.message || defaultMessage(status), status, err.details);
  }
  return new ApiError(statusToCode(status), fallbackText || defaultMessage(status), status);
}

function statusToCode(status: number): ApiErrorCode {
  switch (status) {
    case 400:
      return 'validation_error';
    case 401:
      return 'unauthorized';
    case 403:
      return 'forbidden';
    case 404:
      return 'not_found';
    case 409:
      return 'conflict';
    case 413:
      return 'payload_too_large';
    case 429:
      return 'rate_limited';
    default:
      return 'internal_error';
  }
}

function defaultMessage(status: number): string {
  if (status === 404) return 'Not found';
  if (status === 413) return 'File is too large';
  if (status === 429) return 'Too many requests. Please slow down.';
  if (status >= 500) return 'Server error. Please try again.';
  return `Request failed (${status})`;
}

// ---------------------------------------------------------------------------
// Route typing helpers (derived from the ApiRoutes catalogue)
// ---------------------------------------------------------------------------

export type ApiRoute = keyof ApiRoutes;
/** Response body type of a catalogue route, e.g. `ApiResponse<'GET /api/chats'>`. */
export type ApiResponse<K extends ApiRoute> = ApiRoutes[K] extends { R: infer R } ? R : never;
/** Request body type of a catalogue route. */
export type ApiBody<K extends ApiRoute> = ApiRoutes[K] extends { B: infer B } ? B : never;
/** Query type of a catalogue route. */
export type ApiQuery<K extends ApiRoute> = ApiRoutes[K] extends { Q: infer Q } ? Q : never;

// ---------------------------------------------------------------------------
// Token & global handlers
// ---------------------------------------------------------------------------

let authToken: string | null = null;
let unauthorizedHandler: (() => void) | null = null;

/** Called by the auth store whenever the session token changes. */
export function setApiToken(token: string | null): void {
  authToken = token;
}

export function getApiToken(): string | null {
  return authToken;
}

/** Register the handler for 401s on authenticated requests (the auth store logs out). */
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  unauthorizedHandler = fn;
}

const NO_LOGOUT_PATHS = ['/api/auth/login', '/api/auth/register', '/api/auth/logout'];

function handleUnauthorized(path: string, sentToken: string | null): void {
  // Only react if the token that failed is still the current one (avoids logout races).
  if (!sentToken || sentToken !== authToken) return;
  if (NO_LOGOUT_PATHS.some((p) => path.startsWith(p))) return;
  unauthorizedHandler?.();
}

// ---------------------------------------------------------------------------
// URLs
// ---------------------------------------------------------------------------

export type QueryValue = string | number | boolean | null | undefined;
export type Query = Record<string, QueryValue | readonly QueryValue[]>;

function buildQuery(query?: Query): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    const values = Array.isArray(value) ? value : [value];
    for (const v of values as QueryValue[]) {
      if (v === undefined || v === null) continue;
      params.append(key, String(v));
    }
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

/** Absolute (or same-origin relative) URL for an API path. */
export function apiUrl(path: string, query?: Query): string {
  return `${API_ORIGIN}${path}${buildQuery(query)}`;
}

/**
 * Resolve a media URL from the API (e.g. `/uploads/…`) for `<img src>` / `<video src>`.
 * Absolute, `blob:` and `data:` URLs pass through. Returns undefined for null/empty.
 */
export function mediaUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  if (/^(https?:|blob:|data:)/i.test(url)) return url;
  if (url.startsWith('/')) return `${API_ORIGIN}${url}`;
  return url;
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export interface RequestOptions {
  query?: Query;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  /** Attach the bearer token (default true). */
  auth?: boolean;
  /** Abort after this many ms (default 30s). */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

async function request<T>(
  method: string,
  path: string,
  body: unknown,
  opts: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers };
  const sentToken = opts.auth === false ? null : authToken;
  if (sentToken) headers.Authorization = `Bearer ${sentToken}`;

  let payload: BodyInit | undefined;
  if (body instanceof FormData || body instanceof Blob) {
    payload = body;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort();
    else opts.signal.addEventListener('abort', onAbort, { once: true });
  }

  let res: Response;
  try {
    res = await fetch(apiUrl(path, opts.query), {
      method,
      headers,
      body: payload,
      signal: controller.signal,
    });
  } catch (e) {
    if (timedOut) throw new ApiError('timeout', 'The request timed out');
    if (controller.signal.aborted) throw new ApiError('aborted', 'Request cancelled');
    throw new ApiError('network_error', e instanceof Error ? e.message : 'Network error');
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }

  if (res.status === 204 || res.status === 205) {
    if (!res.ok) throw toApiError(res.status, null);
    return undefined as T;
  }

  const text = await res.text().catch(() => '');
  let data: unknown = undefined;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      if (res.ok) throw new ApiError('bad_response', 'Unexpected response from server', res.status);
    }
  }

  if (!res.ok) {
    if (res.status === 401) handleUnauthorized(path, sentToken);
    throw toApiError(res.status, data, res.status >= 500 ? '' : text.slice(0, 200));
  }
  return data as T;
}

// ---------------------------------------------------------------------------
// Upload (XMLHttpRequest for progress)
// ---------------------------------------------------------------------------

/** Meta fields for `POST /api/media` (mirrors `uploadMediaMetaSchema`). */
export interface UploadMeta {
  kind: MediaKind;
  width?: number;
  height?: number;
  durationMs?: number;
  /** Voice-note waveform, 0..1 amplitudes (≤ 64 samples). */
  waveform?: number[];
}

export interface UploadOptions {
  signal?: AbortSignal;
  /** File name to send when `file` is a Blob (defaults to File.name or "upload"). */
  fileName?: string;
}

/** Minimum time between two upload progress callbacks. */
export const PROGRESS_INTERVAL_MS = 150;

/**
 * Throttle upload progress: XHR fires every ~50 ms and each callback usually re-renders a
 * store window. Calls through at most every `intervalMs`, only when the whole percentage
 * changed; the final `1` always goes through.
 */
export function throttleProgress(
  fn: ((fraction: number) => void) | undefined,
  intervalMs = PROGRESS_INTERVAL_MS,
): ((fraction: number) => void) | undefined {
  if (!fn) return undefined;
  let lastPct = -1;
  let lastAt = -Infinity;
  return (fraction) => {
    const pct = Math.round(fraction * 100);
    const now = Date.now();
    if (fraction < 1 && (pct === lastPct || now - lastAt < intervalMs)) return;
    lastPct = pct;
    lastAt = now;
    fn(fraction);
  };
}

function upload(
  file: Blob,
  meta: UploadMeta,
  progress?: (fraction: number) => void,
  opts: UploadOptions = {},
): Promise<MediaAttachment> {
  const onProgress = throttleProgress(progress);
  return new Promise<MediaAttachment>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const path = '/api/media';
    const sentToken = authToken;
    xhr.open('POST', apiUrl(path));
    xhr.setRequestHeader('Accept', 'application/json');
    if (sentToken) xhr.setRequestHeader('Authorization', `Bearer ${sentToken}`);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress?.(Math.min(1, e.loaded / e.total));
    };
    xhr.onload = () => {
      let data: unknown = null;
      try {
        data = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        /* non-JSON */
      }
      if (xhr.status >= 200 && xhr.status < 300 && data) {
        onProgress?.(1);
        resolve(data as MediaAttachment);
        return;
      }
      if (xhr.status === 401) handleUnauthorized(path, sentToken);
      reject(toApiError(xhr.status, data));
    };
    xhr.onerror = () => reject(new ApiError('network_error', 'Upload failed: network error'));
    xhr.ontimeout = () => reject(new ApiError('timeout', 'Upload timed out'));
    xhr.onabort = () => reject(new ApiError('aborted', 'Upload cancelled'));
    if (opts.signal) {
      if (opts.signal.aborted) {
        reject(new ApiError('aborted', 'Upload cancelled'));
        return;
      }
      opts.signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }

    // Meta fields first so the server can validate before streaming the file.
    const form = new FormData();
    form.append('kind', meta.kind);
    if (meta.width) form.append('width', String(Math.round(meta.width)));
    if (meta.height) form.append('height', String(Math.round(meta.height)));
    if (meta.durationMs !== undefined)
      form.append('durationMs', String(Math.round(meta.durationMs)));
    if (meta.waveform?.length) {
      form.append(
        'waveform',
        JSON.stringify(meta.waveform.slice(0, 64).map((n) => Math.round(n * 100) / 100)),
      );
    }
    const name = opts.fileName ?? (file instanceof File ? file.name : 'upload');
    form.append('file', file, name);
    xhr.send(form);
  });
}

export const api = {
  get: <T>(path: string, opts?: RequestOptions) => request<T>('GET', path, undefined, opts),
  post: <T = void>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>('POST', path, body, opts),
  put: <T = void>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>('PUT', path, body, opts),
  patch: <T = void>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>('PATCH', path, body, opts),
  delete: <T = void>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>('DELETE', path, body, opts),
  upload,
};
