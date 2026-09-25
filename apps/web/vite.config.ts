import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv, type Plugin, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Enbox web client — Vite config.
 *
 * Env (process env or apps/web/.env*):
 * - ENBOX_API_URL  dev/preview proxy target for /api, /uploads, /socket.io (default http://localhost:4000)
 * - WEB_PORT       dev/preview port (default 5173; `npm run dev -w @enbox/web -- --port 5180` works too).
 *                  `PORT` is deliberately NOT used: the root `npm run dev` shares env with the server.
 * - WEB_HOST       bind host (e.g. 0.0.0.0 to test on a phone over LAN)
 * - VITE_API_URL   absolute API origin baked into the client (Capacitor / split deployments)
 * - VITE_ENABLE_SW `true` registers the service worker in dev (always registered in builds)
 */
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  const target = env.ENBOX_API_URL || 'http://localhost:4000';
  const port = Number(env.WEB_PORT) || 5173;
  const host = env.WEB_HOST || undefined;

  const proxy: Record<string, ProxyOptions> = {
    '/api': { target, changeOrigin: true },
    '/uploads': { target, changeOrigin: true },
    '/socket.io': { target, changeOrigin: true, ws: true },
  };

  return {
    plugins: [
      react(),
      tailwindcss(),
      contentSecurityPolicy(env.VITE_API_URL),
      serviceWorkerVersion(),
    ],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: { port, host, proxy },
    preview: { port, host, proxy },
    build: {
      target: 'es2022',
      sourcemap: true,
      chunkSizeWarningLimit: 900,
      rollupOptions: {
        onwarn(warning, warn) {
          // zod ships comments rollup can't place; harmless.
          if (warning.code === 'INVALID_ANNOTATION' && warning.id?.includes('node_modules/zod'))
            return;
          warn(warning);
        },
        output: {
          // Long-lived vendor chunks (cache across app deploys).
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;
            if (/node_modules\/(react|react-dom|react-router|scheduler)\//.test(id))
              return 'vendor-react';
            if (
              /node_modules\/(socket\.io-client|socket\.io-parser|engine\.io-client|engine\.io-parser|@socket\.io)\//.test(
                id,
              )
            )
              return 'vendor-socket';
            if (/node_modules\/zod\//.test(id)) return 'vendor-zod';
            return undefined;
          },
        },
      },
    },
  };
});

/**
 * Stamp the (static, public) service worker with a build id derived from the emitted file
 * names: its bytes then change with every deploy, the browser installs the new worker and
 * its activate step drops the previous builds' asset caches (see public/sw.js).
 */
function serviceWorkerVersion(): Plugin {
  const placeholder = '__ENBOX_BUILD_ID__';
  let outDir = 'dist';
  let buildId = '';
  return {
    name: 'enbox-sw-version',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    generateBundle(_options, bundle) {
      buildId = createHash('sha256')
        .update(Object.keys(bundle).sort().join('\n'))
        .digest('hex')
        .slice(0, 12);
    },
    closeBundle() {
      const file = path.join(outDir, 'sw.js');
      if (!existsSync(file)) return;
      const source = readFileSync(file, 'utf8');
      if (source.includes(placeholder))
        writeFileSync(file, source.replaceAll(placeholder, buildId || Date.now().toString(36)));
    },
  };
}

/**
 * Production-only CSP `<meta>` (the API server disables its CSP header for the SPA).
 * Inline scripts in index.html (the theme boot script) are allowed by hash, so keep them
 * byte-identical between edits or rebuild — the hash is computed at build time.
 *
 * Network/media sources are the real origins only ('self', the VITE_API_URL origin and its
 * ws origin, OpenStreetMap tiles for location previews) — no blanket `https:`/`ws:`, so a
 * script that does run can't simply fetch() or <img>-beacon data to any host. Same-origin
 * WebSockets rely on CSP3 `'self'` matching ws/wss (older Safari: socket.io falls back to
 * long-polling). Emoji pickers use native emoji (no image CDN).
 */
function contentSecurityPolicy(apiUrl: string | undefined): Plugin {
  return {
    name: 'enbox-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const hashes: string[] = [];
        for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
          const body = m[1] ?? '';
          if (body.trim())
            hashes.push(`'sha256-${createHash('sha256').update(body).digest('base64')}'`);
        }
        let apiOrigin = '';
        try {
          if (apiUrl) apiOrigin = new URL(apiUrl).origin;
        } catch {
          /* invalid VITE_API_URL: same-origin only */
        }
        const wsOrigin = apiOrigin.replace(/^http/, 'ws');
        const src = (...list: string[]) => list.filter(Boolean).join(' ');
        const policy = [
          "default-src 'self'",
          `script-src 'self' ${hashes.join(' ')}`.trim(),
          "style-src 'self' 'unsafe-inline'",
          `img-src ${src("'self'", 'data:', 'blob:', 'https://tile.openstreetmap.org', apiOrigin)}`,
          `media-src ${src("'self'", 'blob:', apiOrigin)}`,
          `connect-src ${src("'self'", apiOrigin, wsOrigin)}`,
          "font-src 'self' data:",
          "worker-src 'self'",
          "manifest-src 'self'",
          "object-src 'none'",
          "base-uri 'self'",
          "form-action 'self'",
        ].join('; ');
        return html.replace(
          '<meta charset="UTF-8" />',
          `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`,
        );
      },
    },
  };
}
