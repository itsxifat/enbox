import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

/**
 * `React.lazy` for named exports — code-split feature screens:
 *
 *   const CallsPane = lazyNamed(() => import('./CallsPane'), 'CallsPane');
 *
 * Lazy components must render under a <Suspense> boundary; SplitView, FullView, AppShell
 * and RootLayout already provide one (spinner fallback).
 */
// `any` mirrors React.lazy's own constraint; the returned type is the exact component type.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyNamed<K extends string, M extends Record<K, ComponentType<any>>>(
  loader: () => Promise<M>,
  name: K,
): LazyExoticComponent<M[K]> {
  return lazy(async () => ({ default: (await loader())[name] }));
}
