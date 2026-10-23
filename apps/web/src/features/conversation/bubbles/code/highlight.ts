/**
 * Syntax highlighting of fenced code blocks (```ts …```) with highlight.js, loaded on first
 * use: the core once, then each language the first time a block needs it (a small chunk
 * each). Once a language is in, blocks highlight synchronously (cached), so rows the list
 * re-mounts never flash plain text. The output is read as a token tree and rendered as React
 * elements — never as HTML. `codeLanguage` and `tokensOf` are pure (unit-tested).
 */
import type { HLJSApi, LanguageFn } from 'highlight.js';

type Loader = () => Promise<{ default: LanguageFn }>;

/** The languages we highlight (Discord's common set), by their highlight.js name. */
const LANGUAGES: Record<string, Loader> = {
  bash: () => import('highlight.js/lib/languages/bash'),
  c: () => import('highlight.js/lib/languages/c'),
  cpp: () => import('highlight.js/lib/languages/cpp'),
  csharp: () => import('highlight.js/lib/languages/csharp'),
  css: () => import('highlight.js/lib/languages/css'),
  diff: () => import('highlight.js/lib/languages/diff'),
  go: () => import('highlight.js/lib/languages/go'),
  ini: () => import('highlight.js/lib/languages/ini'),
  java: () => import('highlight.js/lib/languages/java'),
  javascript: () => import('highlight.js/lib/languages/javascript'),
  json: () => import('highlight.js/lib/languages/json'),
  kotlin: () => import('highlight.js/lib/languages/kotlin'),
  lua: () => import('highlight.js/lib/languages/lua'),
  markdown: () => import('highlight.js/lib/languages/markdown'),
  php: () => import('highlight.js/lib/languages/php'),
  python: () => import('highlight.js/lib/languages/python'),
  ruby: () => import('highlight.js/lib/languages/ruby'),
  rust: () => import('highlight.js/lib/languages/rust'),
  scss: () => import('highlight.js/lib/languages/scss'),
  shell: () => import('highlight.js/lib/languages/shell'),
  sql: () => import('highlight.js/lib/languages/sql'),
  swift: () => import('highlight.js/lib/languages/swift'),
  typescript: () => import('highlight.js/lib/languages/typescript'),
  xml: () => import('highlight.js/lib/languages/xml'),
  yaml: () => import('highlight.js/lib/languages/yaml'),
};

/** Tags people write after ``` for those languages. */
const ALIASES: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  jsonc: 'json',
  py: 'python',
  py3: 'python',
  sh: 'bash',
  zsh: 'bash',
  console: 'shell',
  html: 'xml',
  htm: 'xml',
  xhtml: 'xml',
  svg: 'xml',
  h: 'c',
  'c++': 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  'c#': 'csharp',
  golang: 'go',
  rs: 'rust',
  rb: 'ruby',
  yml: 'yaml',
  md: 'markdown',
  patch: 'diff',
  kt: 'kotlin',
  kts: 'kotlin',
  toml: 'ini',
};

/** The highlight.js language of a block's tag, or null (no tag, plain text, unknown). */
export function codeLanguage(tag: string | null | undefined): string | null {
  if (!tag) return null;
  const t = tag.toLowerCase();
  const name = Object.hasOwn(ALIASES, t) ? ALIASES[t]! : t;
  return Object.hasOwn(LANGUAGES, name) ? name : null;
}

/** A highlighted run: text, or a scope (`hljs-keyword`…) around more runs. */
export type CodeToken = string | { cls: string; children: CodeToken[] };

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#x27;': "'",
};

/**
 * highlight.js's HTML as a token tree. It only ever writes `<span class="…">`, `</span>` and
 * escaped text (the five entities above).
 */
export function tokensOf(html: string): CodeToken[] {
  const root: CodeToken[] = [];
  const stack: CodeToken[][] = [root];
  for (const m of html.matchAll(/<span class="([^"]*)">|<\/span>|([^<]+)/g)) {
    const top = stack[stack.length - 1]!;
    if (m[1] !== undefined) {
      const node = { cls: m[1], children: [] as CodeToken[] };
      top.push(node);
      stack.push(node.children);
    } else if (m[2] !== undefined) top.push(m[2].replace(/&(?:amp|lt|gt|quot|#x27);/g, (e) => ENTITIES[e]!));
    else if (stack.length > 1) stack.pop();
  }
  return root;
}

let core: Promise<HLJSApi> | null = null;
let hljs: HLJSApi | null = null;
const loading = new Map<string, Promise<void>>();

/** Load highlight.js and register `language` (once; a failed load is retried next time). */
export function loadLanguage(language: string): Promise<void> {
  let p = loading.get(language);
  if (!p) {
    core ??= import('highlight.js/lib/core').then((m) => m.default);
    p = Promise.all([core, LANGUAGES[language]!()]).then(([api, lang]) => {
      if (!api.getLanguage(language)) api.registerLanguage(language, lang.default);
      hljs = api;
    });
    p.catch(() => {
      loading.delete(language);
      if (!hljs) core = null;
    });
    loading.set(language, p);
  }
  return p;
}

const CACHE_MAX = 200;
const cache = new Map<string, CodeToken[]>();

/** `code` highlighted as `language` now, or null until highlight.js and the language are in. */
export function highlightNow(code: string, language: string): CodeToken[] | null {
  if (!hljs?.getLanguage(language)) return null;
  const key = `${language}\u0000${code}`;
  let tokens = cache.get(key);
  if (tokens) {
    // Most recently used last.
    cache.delete(key);
  } else {
    tokens = tokensOf(hljs.highlight(code, { language, ignoreIllegals: true }).value);
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  }
  cache.set(key, tokens);
  return tokens;
}
