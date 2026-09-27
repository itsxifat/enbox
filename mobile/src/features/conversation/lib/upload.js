/**
 * `POST /api/media` with progress AND the optional `thumbnail` part (the foundation's
 * `api.upload` has no thumbnail support; kept here to avoid touching the shared client).
 */

import {
  ApiError,
  apiUrl,
  filePart,
  getApiToken,
  sessionChanged,
  sessionChangedError,
  throttleProgress,
} from '@/lib/api';

export function uploadMedia(file, meta, opts = {}) {
  // XHR progress fires every ~50 ms; each tick re-renders the conversation: throttle it.
  const onProgress = throttleProgress(opts.onProgress);
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) {
      reject(new ApiError('aborted', 'Upload cancelled'));
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open('POST', apiUrl('/api/media'));
    xhr.setRequestHeader('Accept', 'application/json');
    const token = getApiToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress?.(Math.min(0.99, e.loaded / e.total));
    };
    xhr.onload = () => {
      // Logged out meanwhile: the upload belongs to the previous session.
      if (sessionChanged(token)) {
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
      const err = data?.error;
      reject(
        new ApiError(
          err?.code ?? (xhr.status === 413 ? 'payload_too_large' : 'internal_error'),
          err?.message ?? (xhr.status === 413 ? 'File is too large' : 'Upload failed'),
          xhr.status,
          err?.details,
        ),
      );
    };
    xhr.onerror = () => reject(new ApiError('network_error', 'Upload failed: network error'));
    xhr.ontimeout = () => reject(new ApiError('timeout', 'Upload timed out'));
    xhr.onabort = () => reject(new ApiError('aborted', 'Upload cancelled'));
    opts.signal?.addEventListener('abort', () => xhr.abort(), { once: true });

    const form = new FormData();
    form.append('kind', meta.kind);
    if (meta.width) form.append('width', String(Math.round(meta.width)));
    if (meta.height) form.append('height', String(Math.round(meta.height)));
    if (meta.durationMs !== undefined && Number.isFinite(meta.durationMs))
      form.append('durationMs', String(Math.max(0, Math.round(meta.durationMs))));
    if (meta.waveform?.length)
      form.append(
        'waveform',
        JSON.stringify(meta.waveform.slice(0, 64).map((n) => Math.round(n * 100) / 100)),
      );
    form.append('file', filePart(file, opts.fileName));
    if (opts.thumbnail)
      form.append(
        'thumbnail',
        filePart({ type: 'image/jpeg', ...opts.thumbnail }, 'thumbnail.jpg'),
      );
    xhr.send(form);
  });
}
