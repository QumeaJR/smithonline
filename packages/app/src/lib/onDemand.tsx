import { useEffect, useState, type ComponentType } from 'react';
import { useDesignStore } from '../store/useDesignStore';

/**
 * A dialog kept out of the start bundle: its code loads when the browser is idle after the
 * start, or when it first opens if that comes sooner. Once loaded it renders at once, so a
 * dialog opens in the same frame as before. A load that fails (no connection, or a version
 * replaced on the server) is forgotten: the dialog closes, says why, and the next open tries
 * again. No React.lazy, which would keep the failure for the whole session.
 */
export function onDemand<P extends { readonly onClose: () => void }>(
  load: () => Promise<ComponentType<P>>,
): ComponentType<P> {
  let loaded: ComponentType<P> | null = null;
  let loading: Promise<ComponentType<P>> | null = null;
  const fetch = (): Promise<ComponentType<P>> =>
    (loading ??= load().then(
      (c) => (loaded = c),
      (err: unknown) => {
        loading = null;
        throw err;
      },
    ));
  const preload = (): void => void fetch().catch(() => undefined);
  // Called on the window, not detached: a detached requestIdleCallback throws in browsers.
  if (typeof requestIdleCallback === 'function') requestIdleCallback(preload);
  else setTimeout(preload, 0);
  function OnDemand(props: P) {
    const [, setReady] = useState(false);
    const { onClose } = props;
    useEffect(() => {
      if (loaded) return;
      let live = true;
      fetch().then(
        () => live && setReady(true),
        () => {
          if (!live) return;
          useDesignStore
            .getState()
            .setMessage(
              'This window could not be loaded: check the connection, or reload the page if SmithChart.Online was updated (your design is kept).',
              { error: true },
            );
          onClose();
        },
      );
      return () => {
        live = false;
      };
    }, [onClose]);
    const Loaded = loaded;
    return Loaded ? <Loaded {...props} /> : null;
  }
  return OnDemand;
}
