import { useEffect, useState } from 'react';

/** Changes whenever the theme attribute or the system colour scheme does. */
export function useThemeToken(): number {
  const [token, setToken] = useState(0);
  useEffect(() => {
    const bump = (): void => setToken((t) => t + 1);
    const observer = new MutationObserver(bump);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', bump);
    return () => {
      observer.disconnect();
      media.removeEventListener('change', bump);
    };
  }, []);
  return token;
}
