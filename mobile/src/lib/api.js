/**
 * Typed REST client for the Enbox API (see `ApiRoutes` in @enbox/shared for every endpoint).
 *
 *   const chats = await api.get('/api/chats');
 *   const msg = await api.post(`/api/chats/${chatId}/messages`, body);
 *   await api.delete(`/api/messages/${id}`, undefined, { query: { for: 'everyone' } });
 *   const media = await api.upload(file, { kind: 'image', width, height }, (p) => setProgress(p));
 *
 * - Paths are the full `/api/...` paths from the catalogue; they are resolved against
 *   the configured server origin (lib/env.js).
 * - The bearer token is attached automatically (set by the auth store via `setApiToken`).
 * - Non-2xx responses throw `ApiError` (code/message/status/details from `ApiErrorBody`);
 *   network failures throw `ApiError` with code `network_error` and status 0.
 * - A 401 on any authenticated call (except login/register) triggers the global
 *   unauthorized handler (auth store → logout).
 */

import { Platform } from 'react-native';
import { getApiOrigin } from './env';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Client-side failure codes in addition to the server's `ApiErrorCode`s. */

export class ApiError extends Error {
  code;
  /** HTTP status; 0 when the request never got a response. */
  status;
  details;

  constructor(code, message, status = 0, details) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }

  /** True for connectivity problems (worth retrying / showing "offline"). */
  get isNetworkError() {
    return this.code === 'network_error' || this.code === 'timeout';
  }
}

export function isApiError(e) {
  return e instanceof ApiError;
}

/** Best human-readable message for any thrown value. */
export function errorMessage(e, fallback = 'Something went wrong') {
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
export function fieldErrors(e) {
  const out = {};
  if (!(e instanceof ApiError) || e.code !== 'validation_error' || !Array.isArray(e.details))
    return out;
  for (const issue of e.details) {
    const key = Array.isArray(issue.path) && issue.path.length ? String(issue.path[0]) : '';
    if (key && typeof issue.message === 'string' && !out[key]) out[key] = issue.message;
  }
  return out;
}

function toApiError(status, body, fallbackText = '') {
  const err = body?.error;
  if (err && typeof err.code === 'string') {
    return new ApiError(err.code, err.message || defaultMessage(status), status, err.details);
  }
  return new ApiError(statusToCode(status), fallbackText || defaultMessage(status), status);
}

function statusToCode(status) {
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

function defaultMessage(status) {
  if (status === 404) return 'Not found';
  if (status === 413) return 'File is too large';
  if (status === 429) return 'Too many requests. Please slow down.';
  if (status >= 500) return 'Server error. Please try again.';
  return `Request failed (${status})`;
}

// ---------------------------------------------------------------------------
// Route typing helpers (derived from the ApiRoutes catalogue)
// ---------------------------------------------------------------------------

/** Response body type of a catalogue route, e.g. `ApiResponse<'GET /api/chats'>`. */
/** Request body type of a catalogue route. */
/** Query type of a catalogue route. */
// ---------------------------------------------------------------------------
// Token & global handlers
// ---------------------------------------------------------------------------

let authToken = null;
let unauthorizedHandler = null;

/** Called by the auth store whenever the session token changes. */
export function setApiToken(token) {
  authToken = token;
}

export function getApiToken() {
  return authToken;
}

/** Register the handler for 401s on authenticated requests (the auth store logs out). */
export function setUnauthorizedHandler(fn) {
  unauthorizedHandler = fn;
}

const NO_LOGOUT_PATHS = ['/api/auth/login', '/api/auth/register', '/api/auth/logout'];

function handleUnauthorized(path, sentToken) {
  // Only react if the token that failed is still the current one (avoids logout races).
  if (!sentToken || sentToken !== authToken) return;
  if (NO_LOGOUT_PATHS.some((p) => path.startsWith(p))) return;
  unauthorizedHandler?.();
}

// ---------------------------------------------------------------------------
// URLs
// ---------------------------------------------------------------------------

function buildQuery(query) {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    const values = Array.isArray(value) ? value : [value];
    for (const v of values) {
      if (v === undefined || v === null) continue;
      params.append(key, String(v));
    }
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

/** Absolute (or same-origin relative) URL for an API path. */
export function apiUrl(path, query) {
  return `${getApiOrigin()}${path}${buildQuery(query)}`;
}

/**
 * Resolve a media URL from the API (e.g. `/uploads/…`) for `<img src>` / `<video src>`.
 * Absolute, `blob:` and `data:` URLs pass through. Returns undefined for null/empty.
 */
export function mediaUrl(url) {
  if (!url) return undefined;
  if (/^(https?:|blob:|data:|file:|content:)/i.test(url)) return url;
  if (url.startsWith('/')) return `${getApiOrigin()}${url}`;
  return url;
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 30_000;

/** The request was sent with a session token that is no longer the current one. */
export function sessionChanged(sentToken) {
  return !!sentToken && sentToken !== authToken;
}

/** Thrown for responses that arrive after a logout / account switch (callers ignore it). */
export function sessionChangedError() {
  return new ApiError('aborted', 'Session changed', 0, { sessionChanged: true });
}

export function isSessionChangedError(e) {
  return e instanceof ApiError && e.code === 'aborted' && !!e.details?.sessionChanged;
}

async function request(method, path, body, opts = {}) {
  const headers = { Accept: 'application/json', ...opts.headers };
  const sentToken = opts.auth === false ? null : authToken;
  if (sentToken) headers.Authorization = `Bearer ${sentToken}`;

  let payload;
  if (body instanceof FormData || (typeof Blob !== 'undefined' && body instanceof Blob)) {
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

  let res;
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

  // Logged out (or switched account) while this was in flight: its data belongs to the
  // previous session and must not land in the stores that were reset meanwhile.
  if (sessionChanged(sentToken)) throw sessionChangedError();

  if (res.status === 204 || res.status === 205) {
    if (!res.ok) throw toApiError(res.status, null);
    return undefined;
  }

  const text = await res.text().catch(() => '');
  if (sessionChanged(sentToken)) throw sessionChangedError();
  let data = undefined;
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
  return data;
}

// ---------------------------------------------------------------------------
// Upload (XMLHttpRequest for progress)
// ---------------------------------------------------------------------------

/** Meta fields for `POST /api/media` (mirrors `uploadMediaMetaSchema`). */
/** Minimum time between two upload progress callbacks. */
export const PROGRESS_INTERVAL_MS = 150;

/**
 * Throttle upload progress: XHR fires every ~50 ms and each callback usually re-renders a
 * store window. Calls through at most every `intervalMs`, only when the whole percentage
 * changed; the final `1` always goes through.
 */
export function throttleProgress(fn, intervalMs = PROGRESS_INTERVAL_MS) {
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

/**
 * A multipart file part. On Android/iOS `file` is a local file `{ uri, name?, type? }` (from
 * the image/document pickers, the camera or the recorder) which React Native streams from
 * disk; on the web preview it may also be a Blob/File.
 */
export function filePart(file, fileName) {
  if (typeof Blob !== 'undefined' && file instanceof Blob) {
    if (Platform.OS === 'web') return file;
  }
  const name = fileName ?? file.name ?? file.fileName ?? 'upload';
  const type = file.type ?? file.mimeType ?? 'application/octet-stream';
  return { uri: file.uri, name, type };
}

function upload(file, meta, progress, opts = {}) {
  const onProgress = throttleProgress(progress);
  return new Promise((resolve, reject) => {
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
      if (sessionChanged(sentToken)) {
        reject(sessionChangedError());
        return;
      }
      let data = null;
      try {
        data = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        /* non-JSON */
      }
      if (xhr.status >= 200 && xhr.status < 300 && data) {
        onProgress?.(1);
        resolve(data);
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
    form.append('file', filePart(file, opts.fileName));
    if (opts.thumbnail) {
      const type = opts.thumbnail.type || 'image/jpeg';
      const ext = type === 'image/webp' ? 'webp' : 'jpg';
      form.append('thumbnail', filePart({ ...opts.thumbnail, type }, `thumbnail.${ext}`));
    }
    xhr.send(form);
  });
}

export const api = {
  get: (path, opts) => request('GET', path, undefined, opts),
  post: (path, body, opts) => request('POST', path, body, opts),
  put: (path, body, opts) => request('PUT', path, body, opts),
  patch: (path, body, opts) => request('PATCH', path, body, opts),
  delete: (path, body, opts) => request('DELETE', path, body, opts),
  upload,
};
