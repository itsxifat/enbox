/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Absolute API origin (e.g. `https://api.enbox.app`) for native wrappers (Capacitor) or
   * split deployments. Empty/unset = same origin as the web app (dev: Vite proxy).
   */
  readonly VITE_API_URL?: string;
  /** Set to `true` to register the service worker in `vite dev` (always on in builds). */
  readonly VITE_ENABLE_SW?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
