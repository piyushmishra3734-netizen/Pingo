import {
  isValidPack,
  type StickerPack,
  type StickerPackSource,
} from '@pingo/core';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/**
 * Sticker packs, loaded at runtime.
 *
 * ## Built-in packs go through the same path as third-party ones
 *
 * `SOURCES` lists manifest URLs; the loader fetches and validates each one. The
 * pack that ships with PINGO is a JSON file in `public/`, fetched over HTTP
 * exactly like a remote one would be.
 *
 * That is deliberate. If built-in packs were imported as modules, the dynamic
 * path would be untested code - and the first genuinely remote pack would be
 * the thing that discovered it was broken.
 *
 * ## Adding a pack
 *
 * Publish a manifest, add its URL. Nothing else. A user-installed pack is the
 * same operation with the URL coming from storage rather than this array, which
 * is why `addSource` exists.
 */

const SOURCES: StickerPackSource[] = [
  {
    id: 'fluent-3d',
    name: 'Fluent 3D',
    coverUrl:
      'https://cdn.jsdelivr.net/gh/microsoft/fluentui-emoji@main/assets/Grinning%20face/3D/grinning_face_3d.png',
    manifestUrl: '/stickers/fluent-3d.json',
    builtIn: true,
  },
];

const STORAGE_KEY = 'pingo:sticker-sources';
const RECENT_KEY = 'pingo:sticker-recent';

interface StickerContextValue {
  packs: StickerPack[];
  loading: boolean;
  /** Sticker ids, most recent first. */
  recent: string[];
  markUsed: (stickerId: string) => void;
  /** Installs a pack from any manifest URL. */
  addSource: (source: StickerPackSource) => Promise<void>;
  removePack: (packId: string) => void;
}

const StickerContext = createContext<StickerContextValue | undefined>(undefined);

function readStoredSources(): StickerPackSource[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StickerPackSource[]) : [];
  } catch {
    return [];
  }
}

async function fetchPack(source: StickerPackSource): Promise<StickerPack | undefined> {
  try {
    const response = await fetch(source.manifestUrl);
    if (!response.ok) return undefined;

    const data: unknown = await response.json();

    /*
     * Validated, not trusted. A manifest can come from anywhere, and one
     * missing its licence is not a pack that renders badly - it is a pack that
     * must not render at all.
     */
    if (!isValidPack(data)) return undefined;
    return data;
  } catch {
    return undefined;
  }
}

export function StickerProvider({ children }: { children: ReactNode }) {
  const [packs, setPacks] = useState<StickerPack[]>([]);
  const [loading, setLoading] = useState(true);
  const [recent, setRecent] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[];
    } catch {
      return [];
    }
  });

  const load = useCallback(async () => {
    const sources = [...SOURCES, ...readStoredSources()];
    const loaded = await Promise.all(sources.map(fetchPack));
    setPacks(loaded.filter((pack): pack is StickerPack => pack !== undefined));
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const addSource = useCallback(async (source: StickerPackSource) => {
    const pack = await fetchPack(source);
    if (!pack) throw new Error('That manifest is not a valid sticker pack.');

    const stored = readStoredSources().filter((item) => item.id !== source.id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...stored, source]));

    setPacks((previous) => [...previous.filter((item) => item.id !== pack.id), pack]);
  }, []);

  const removePack = useCallback((packId: string) => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(readStoredSources().filter((item) => item.id !== packId)),
    );
    setPacks((previous) => previous.filter((pack) => pack.id !== packId));
  }, []);

  const markUsed = useCallback((stickerId: string) => {
    setRecent((previous) => {
      // Capped: a "recent" row that scrolls is not recent, it is history.
      const next = [stickerId, ...previous.filter((id) => id !== stickerId)].slice(0, 24);
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      } catch {
        // Non-fatal - recents are a convenience, not state anything depends on.
      }
      return next;
    });
  }, []);

  const value = useMemo<StickerContextValue>(
    () => ({ packs, loading, recent, markUsed, addSource, removePack }),
    [packs, loading, recent, markUsed, addSource, removePack],
  );

  return <StickerContext.Provider value={value}>{children}</StickerContext.Provider>;
}

export function useStickers(): StickerContextValue {
  const context = useContext(StickerContext);
  if (!context) throw new Error('useStickers must be used inside a <StickerProvider>');
  return context;
}
