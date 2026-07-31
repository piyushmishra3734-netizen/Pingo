import { useEffect, useState } from 'react';

/**
 * Subscribe to a CSS media query from JavaScript.
 *
 * Used only where layout *structure* changes, never for styling - a size that
 * merely changes padding or type belongs in a Tailwind breakpoint. Here it
 * decides whether the chats route renders one pane or two, which is a different
 * component tree, not a different set of classes.
 *
 * Initialised from `matchMedia` during the first render rather than in an effect,
 * so the correct layout paints immediately instead of flashing the mobile one.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches,
  );

  useEffect(() => {
    const list = window.matchMedia(query);
    // Re-read on subscribe: the query may have changed between render and effect.
    setMatches(list.matches);

    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

/** The single breakpoint at which PINGO switches to a two-pane layout. */
export const useIsDesktop = () => useMediaQuery('(min-width: 1024px)');
