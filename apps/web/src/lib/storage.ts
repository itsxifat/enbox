/**
 * Safe localStorage helpers (private mode / disabled storage never throw).
 * All Enbox keys are prefixed with `enbox.`.
 */
export const storage = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* quota / disabled */
    }
  },
  remove(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      /* disabled */
    }
  },
  getJSON<T>(key: string): T | null {
    const raw = storage.get(key);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  },
  setJSON(key: string, value: unknown): void {
    storage.set(key, JSON.stringify(value));
  },
};

/** Storage keys used by the foundation. Feature code should add its own `enbox.<feature>.*` keys. */
export const StorageKeys = {
  token: 'enbox.token',
  user: 'enbox.user',
  ui: 'enbox.ui',
} as const;
