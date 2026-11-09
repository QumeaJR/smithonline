import { lazy, Suspense, type ComponentType } from 'react';

/**
 * A component kept out of the start bundle: its code loads when the browser is idle after the
 * start, or on its first render if that comes sooner. Once loaded it renders at once, with no
 * Suspense step, so a dialog opens in the same frame as before.
 */
export function onDemand<P extends object>(
  load: () => Promise<ComponentType<P>>,
): ComponentType<P> {
  let loaded: ComponentType<P> | null = null;
  let loading: Promise<ComponentType<P>> | null = null;
  const fetch = (): Promise<ComponentType<P>> => (loading ??= load().then((c) => (loaded = c)));
  const Lazy = lazy(() => fetch().then((c) => ({ default: c })));
  const preload = (): void => void fetch().catch(() => undefined);
  // Called on the window, not detached: a detached requestIdleCallback throws in browsers.
  if (typeof requestIdleCallback === 'function') requestIdleCallback(preload);
  else setTimeout(preload, 0);
  function OnDemand(props: P) {
    const Loaded = loaded;
    if (Loaded) return <Loaded {...props} />;
    return (
      <Suspense fallback={null}>
        <Lazy {...props} />
      </Suspense>
    );
  }
  return OnDemand;
}
