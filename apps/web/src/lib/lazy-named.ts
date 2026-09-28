import { createElement, lazy, Suspense, type ComponentProps, type ComponentType, type LazyExoticComponent } from 'react';

import { spareNothing } from '../features/connection/useConnectionStatus.js';

/**
 * A component that arrives when it is first drawn, not with the app.
 *
 * The routes were already split (see `lazyScreen` in App.tsx), but the sheets
 * and overlays a screen *might* open were still imported by the screens that
 * open them - the story viewer and composer by the chat list, the call screen
 * by the app itself, chat info and the media sender by the thread. All of it
 * rode in the one chunk that has to arrive before anything can be drawn, which
 * on 2G is seconds per hundred kilobytes.
 *
 * `preload()` fetches the chunk without drawing anything, for the moments when
 * it is likely to be wanted soon - an idle moment after the list is up, or a
 * finger landing on a story ring - so the wait moves off the tap.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Preloadable<C extends ComponentType<any>> = LazyExoticComponent<C> & { preload: () => Promise<unknown> };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyNamed<M extends Record<K, ComponentType<any>>, K extends keyof M>(
  load: () => Promise<M>,
  name: K,
): Preloadable<M[K]> {
  let pending: Promise<M> | undefined;
  const once = () => (pending ??= load().catch((error: unknown) => {
    // A failed fetch (offline, a deploy in between) may be retried on the next draw.
    pending = undefined;
    throw error;
  }));
  const component = lazy(async () => ({ default: (await once())[name] })) as Preloadable<M[K]>;
  component.preload = () => once().catch(() => undefined);
  return component;
}

/**
 * Runs `work` once the app has been quiet for a moment, so warming a chunk
 * never competes with what is being drawn. On a poor link or with data saver
 * on it does not run at all - the chunk then comes when it is opened. Returns
 * a cancel.
 */
export function whenIdle(work: () => void, delayMs = 2500): () => void {
  if (spareNothing()) return () => undefined;
  let idle: number | undefined;
  const timer = window.setTimeout(() => {
    if ('requestIdleCallback' in window) idle = window.requestIdleCallback(work, { timeout: 5000 });
    else work();
  }, delayMs);
  return () => {
    window.clearTimeout(timer);
    if (idle !== undefined && 'cancelIdleCallback' in window) window.cancelIdleCallback(idle);
  };
}

/**
 * `lazyNamed`, already wrapped in its own `Suspense` (drawing nothing while it
 * loads), for a component opened from many places. Callers keep writing
 * `<ImageViewer … />` exactly as before; only the import changes.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazySuspended<M extends Record<K, ComponentType<any>>, K extends keyof M>(
  load: () => Promise<M>,
  name: K,
): ComponentType<ComponentProps<M[K]>> & { preload: () => Promise<unknown> } {
  const Lazy = lazyNamed(load, name);
  const Wrapped = (props: ComponentProps<M[K]>) =>
    createElement(Suspense, { fallback: null }, createElement(Lazy, props));
  return Object.assign(Wrapped, { preload: Lazy.preload });
}
