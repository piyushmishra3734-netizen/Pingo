import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  ExternalLink,
  Film,
  Maximize2,
  MonitorPlay,
  Play,
  RefreshCw,
  SkipForward,
  Sparkles,
  Tv,
  X,
  Zap,
} from 'lucide-react';
import { cn } from '@pingo/ui';
import type { MediaType, TmdbMedia } from '../types.js';
import { TvEpisodePanel } from './TvEpisodePanel.js';
import { TvHlsPlayer } from './TvHlsPlayer.js';
import { TvLogo } from './TvLogo.js';
import {
  probeIframe,
  probeResolver,
  rankProbes,
  type AudioPreference,
  type SourceProbe,
} from '../sourceProbe.js';

export interface StreamProvider {
  id: string;
  name: string;
  badge?: string;
  isHindi?: boolean;
  /**
   * Starts playing without a click. Only providers observed doing this get the
   * flag: it decides how long the player waits before looking elsewhere.
   */
  autoStarts?: boolean;
  /**
   * Some hosts refuse a request with no `Referer` at all (Videasy answers 403 to
   * one and 200 to the other). Defaults to `no-referrer`, which is what every
   * other source here gets: there is no reason to tell a third-party host which
   * page of Pingo someone is watching.
   */
  referrerPolicy?: 'no-referrer' | 'origin';
  /**
   * `iframe` (the default) hands a third party's page the whole rectangle.
   * `hls` asks a resolver for a playlist and plays it in our own `<video>`, so
   * the page behind it — pop-unders, redirects, scripts — is never loaded.
   */
  kind?: 'iframe' | 'hls';
  /** For `hls` sources: the resolver's provider id. */
  apiProvider?: string;
  buildUrl: (mediaType: MediaType, id: number | string, season: number, episode: number) => string;
}

/**
 * FrameXTV's stream API. It answers with a direct `.m3u8` per provider, plus the
 * audio tracks that stream actually carries — which is the only place in this
 * whole component where Hindi can be *seen* rather than guessed at.
 *
 * CORS is `*`, so the browser calls it directly; there is no proxy in the way.
 */
const FRAMEXTV_SITE = 'https://framextv.xyz';

/**
 * Streaming sources. Every entry below was played end to end in the real
 * player on 20 Oct 2026, from India, before it earned a place here.
 *
 * The list used to hold eight. Six are gone, and not because they merely looked
 * broken from a script - each was opened in the browser and watched:
 *
 *   NHD Embed   403 Forbidden (LiteSpeed) — and its certificate does not match
 *               the hostname, so it can never be embedded
 *   VidLink     page loads, spinner runs forever, stream never resolves
 *   VidSrc.pm   HTTP 200, then a blank black frame for as long as you watch
 *   VidSrc.pk   connection fails outright
 *   ApiPlayer   renders a play button, then never gets a stream
 *   VidSrc.io   host unreachable
 *
 * Keep them out even if a mirror appears: the entire `vidsrc.*` family
 * (`.pm`, `.pk`, `.io`, `.to`, `.xyz`, `.net`, `.in`) is unreachable from this
 * region — connect timeouts, not bad paths — so a new subdomain of the same
 * family will fail the same way. `www.2embed.cc` embeds vidsrc, and it hung on
 * "Connecting to VidSrc Stream" for the same reason.
 *
 * What each one is good at, measured rather than assumed:
 *
 *   vidfast   movies and TV, plays on its own in a few seconds, and its own
 *             server list includes a "Multiple audio" server — the nearest
 *             thing to Hindi audio this lineup has left
 *   autoembed movies and TV, but needs one click on its poster. It is the
 *             fallback because it starts slow, not because it is worse
 *   vidrock   movies only. A TV episode sat on "Loading..." past 20s in
 *             testing, so it is last and the fallback walks past it
 */
export const STREAM_PROVIDERS: StreamProvider[] = [
  {
    id: 'vidfast',
    name: 'VidFast',
    badge: 'Multi-Audio',
    isHindi: true,
    autoStarts: true,
    buildUrl: (type, id, s, e) =>
      type === 'movie'
        ? `https://vidfast.vc/movie/${id}?autoPlay=true`
        : `https://vidfast.vc/tv/${id}/${s}/${e}?autoPlay=true`,
  },
  {
    id: 'autoembed',
    name: 'AutoEmbed',
    badge: 'Tap to Play',
    buildUrl: (type, id, s, e) =>
      type === 'movie'
        ? `https://autoembed.co/movie/tmdb/${id}`
        : `https://autoembed.co/tv/tmdb/${id}-${s}-${e}`,
  },
  {
    id: 'vidrock',
    name: 'VidRock',
    badge: 'Movies',
    autoStarts: true,
    buildUrl: (type, id, s, e) =>
      type === 'movie'
        ? `https://vidrock.net/movie/${id}`
        : `https://vidrock.net/tv/${id}/${s}/${e}`,
  },
  {
    id: 'nontongo',
    name: 'NontonGo',
    badge: 'MIX',
    autoStarts: true,
    buildUrl: (type, id, s, e) =>
      type === 'movie'
        ? `https://www.nontongo.win/embed/movie/${id}`
        : `https://www.nontongo.win/embed/tv/${id}/${s}/${e}`,
  },
  {
    id: 'embedmaster',
    name: 'EmbedMaster',
    badge: '10+ servers',
    buildUrl: (type, id, s, e) =>
      type === 'movie'
        ? `https://embedmaster.link/movie/${id}`
        : `https://embedmaster.link/tv/${id}/${s}/${e}`,
  },

  /*
   * FrameXTV providers. These are not pages: the resolver returns a playlist,
   * and the player above plays it. `giant` is listed first in the order because
   * it is the one that carried an actual Hindi track (Inception came back as
   * audio=[English, Hindi]); `bowler` advertises multi-language and returned
   * seven mirrors for the same title.
   */
  {
    id: 'fx-giant',
    name: 'Giant',
    badge: 'Hindi audio',
    isHindi: true,
    autoStarts: true,
    kind: 'hls',
    apiProvider: 'giant',
    buildUrl: () => FRAMEXTV_SITE,
  },
  {
    id: 'fx-super',
    name: 'Barbarian',
    badge: '4K',
    autoStarts: true,
    kind: 'hls',
    apiProvider: 'super_barbarian',
    buildUrl: () => FRAMEXTV_SITE,
  },
  {
    id: 'fx-bowler',
    name: 'Bowler',
    badge: 'Multi-lang',
    kind: 'hls',
    apiProvider: 'bowler',
    buildUrl: () => FRAMEXTV_SITE,
  },
  {
    id: 'fx-titan',
    name: 'Titan',
    badge: 'MP4 1080p',
    kind: 'hls',
    apiProvider: 'titan',
    buildUrl: () => FRAMEXTV_SITE,
  },
  {
    id: 'fx-miner',
    name: 'Miner',
    badge: '4K multi-city',
    kind: 'hls',
    apiProvider: 'miner',
    buildUrl: () => FRAMEXTV_SITE,
  },
  {
    id: 'fx-headhunter',
    name: 'Headhunter',
    badge: 'VidLink',
    kind: 'hls',
    apiProvider: 'headhunter',
    buildUrl: () => FRAMEXTV_SITE,
  },
  {
    id: 'fx-valkyrie',
    name: 'Valkyrie',
    badge: '4K multi',
    kind: 'hls',
    apiProvider: 'valkyrie',
    buildUrl: () => FRAMEXTV_SITE,
  },
  {
    id: 'fx-hogrider',
    name: 'Hog Rider',
    badge: '4K',
    kind: 'hls',
    apiProvider: 'hog_rider',
    buildUrl: () => FRAMEXTV_SITE,
  },
  {
    id: 'fx-lavahound',
    name: 'Lava Hound',
    badge: '4K fast',
    kind: 'hls',
    apiProvider: 'lavahound',
    buildUrl: () => FRAMEXTV_SITE,
  },
];

/**
 * Which source to try first, per kind of title. This is measurement, not taste.
 *
 *   movie  VidFast plays on its own in seconds and has a multiple-audio server;
 *          NontonGo resolves a real CDN and lets its own player pick between
 *          MIX / HD / VIP; AutoEmbed needs a tap; VidRock resolved a film's
 *          exact runtime.
 *   tv     AutoEmbed opens a real episode player ("Breaking Bad 2008 1-1").
 *          NontonGo opens its player and buffers. VidFast sat on "LOADING, ONE
 *          MOMENT..." for 42s on the same episode, so it is last here.
 *
 * A source left out of a list is not shown for that kind of title, which is the
 * point — offering a source that cannot work is the bug this replaced.
 *
 * NontonGo is the only one of the five that is not a `vidsrc`-style aggregator
 * or a paid embed: it is its own site with its own CDN, and it is the only one
 * that sends `X-Frame-Options: ALLOWALL`, so it is the least likely to break
 * because of a framing change.
 *
 * EmbedMaster is a purpose-built embed API rather than a streaming site: the
 * homepage is "Movie & TV Streaming API for webmasters" with a player builder
 * and 10+ HLS servers behind it. `embedmaster.link/movie/27205` answers with the
 * title "Inception" and `.../tv/1396/1/1` with "Breaking Bad", it accepts a TMDB
 * id or an IMDb id, and it sends no framing headers at all. Its player lives on
 * a second host (`embdmstrplayer.com/v2/<token>`) that the embed redirects to.
 *
 * Videasy was tried and removed. It was the one source that looked fixable: it
 * answered 403 to a request with no `Referer` and 200 with one, so a per-source
 * referrer policy was added (`referrerPolicy` below) to send `origin` for it.
 * The document then loaded — and the frame stayed black, the same way VidSrc.pm
 * did. A chip that opens a black rectangle is worse than five chips that work.
 */
const SOURCE_ORDER: Record<MediaType, readonly string[]> = {
  movie: [
    'fx-giant',
    'vidfast',
    'nontongo',
    'embedmaster',
    'autoembed',
    'vidrock',
    'fx-super',
    'fx-bowler',
    'fx-titan',
    'fx-miner',
    'fx-headhunter',
    'fx-valkyrie',
    'fx-hogrider',
    'fx-lavahound',
  ],
  /*
   * Shows lead with the iframes, which is the opposite of films, and the reason
   * is measured rather than stylistic. Asking the resolver for episodes:
   *
   *   Breaking Bad S5E16 (finale)      4/9 providers
   *   The Simpsons S38E1 (current)     1/9
   *   Grey's Anatomy S23E1 (current)   0/9
   *   Khatron Ke Khiladi S15E1         0/9
   *
   * It indexes finished shows and not running ones — so its nine providers are
   * empty exactly where a viewer is most likely to be, which is the newest
   * episode. The iframes answer all four: EmbedMaster and NontonGo both resolve
   * 'The Simpsons', "Grey's Anatomy" and 'Khatron Ke Khiladi' for the same
   * episodes. Hence the iframes first, and the resolver kept for the older
   * library it does hold.
   */
  tv: [
    'embedmaster',
    'nontongo',
    'autoembed',
    'vidfast',
    'fx-giant',
    'fx-super',
    'fx-bowler',
    'fx-titan',
    'fx-miner',
    'fx-headhunter',
    'fx-valkyrie',
    'fx-hogrider',
    'fx-lavahound',
  ],
};

const LAST_SOURCE_KEY = 'pingo:lastSource';

/**
 * The last source used, tracked separately for films and for shows.
 *
 * One shared key was a real bug: choosing Giant for a film — the Hindi one —
 * became the starting source for the next episode, and Giant has no episodes at
 * all, so the player opened on a source that could not work and had to walk the
 * whole lineup to say so. What is good for a film is not what is good for an
 * episode, so the memory is kept apart.
 */
const lastSourceKey = (type: MediaType) => `${LAST_SOURCE_KEY}:${type}`;

/** The audio language the viewer wants first: Hindi unless they say otherwise. */
const AUDIO_PREF_KEY = 'pingo:tvAudio';

/** Which source last worked for this exact title, so a return visit opens on it. */
const titleSourceKey = (type: MediaType, id: number | string) => `pingo:tvSource:${type}:${id}`;

/** A host that cannot be reached at all is skipped without waiting for a timer. */
const REACH_TIMEOUT_MS = 4000;

/**
 * How long a freshly mounted frame gets to fire `load` before the next source
 * is tried. Long enough for a slow host on a bad connection, short enough that
 * a dead one is not a full minute of black.
 */
const GRACE_MS = 20000;

/**
 * Can the browser open a connection to this URL at all?
 *
 * `no-cors` on purpose: the answer we want is "did the host answer", not "what
 * did it say". Any HTTP response — 200, 403, 500 — resolves as an opaque
 * response; only a dead host, a bad certificate or a timeout rejects. That is
 * exactly the difference between the six removed sources and the three kept
 * ones, so a dead host is skipped in about a second instead of after a grace
 * period of black screen.
 *
 * It cannot see a host that answers and then shows nothing (VidSrc.pm did
 * that), which is why the timer still exists.
 */
const reachCache = new Map<string, Promise<boolean>>();
function isReachable(url: string): Promise<boolean> {
  const cached = reachCache.get(url);
  if (cached) return cached;

  const probe = (async () => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REACH_TIMEOUT_MS);
      try {
        await fetch(url, { mode: 'no-cors', referrerPolicy: 'no-referrer', signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
      return true;
    } catch {
      return false;
    }
  })();

  reachCache.set(url, probe);
  return probe;
}

interface TvStreamPlayerProps {
  media: TmdbMedia;
  initialSeason?: number;
  initialEpisode?: number;
  onClose: () => void;
  onOpenTrailer?: (media: TmdbMedia) => void;
  /** Told when the episode changes, so friends can see which one this is. */
  onEpisodeChange?: (season: number, episode: number) => void;
  /** A title picked from "More Like This". */
  onOpenMedia?: (media: TmdbMedia) => void;
}

export function TvStreamPlayer({
  media,
  initialSeason = 1,
  initialEpisode = 1,
  onClose,
  onOpenTrailer,
  onEpisodeChange,
  onOpenMedia,
}: TvStreamPlayerProps) {
  const title = media.title || media.name || 'Untitled';
  const mediaType: MediaType = media.media_type || (media.title ? 'movie' : 'tv');
  const isTv = mediaType === 'tv';
  const rememberedKey = titleSourceKey(mediaType, media.id);

  // Only the sources that are known to work for this kind of title, in the
  // order in SOURCE_ORDER. That order is where Hindi priority lives: VidFast
  // carries the multi-audio server, so it is first for films. It is last for
  // shows, deliberately — its episode path stalls, and a Hindi source that
  // never starts is not a Hindi source. Lifting it above the working ones to
  // satisfy a sort would trade a real Hindi option for a black screen.
  //
  // Memoised on purpose: it is read by an effect, and a fresh array each render
  // would make that effect re-run on every render.
  const available = useMemo(() => {
    const byId = new Map(STREAM_PROVIDERS.map((p) => [p.id, p]));
    return (SOURCE_ORDER[mediaType] ?? SOURCE_ORDER.movie)
      .map((id) => byId.get(id))
      .filter((p): p is StreamProvider => Boolean(p));
  }, [mediaType]);

  // A title that worked on a source last time opens on that source; then the
  // last source used anywhere, if it is still shipped. A saved id that is no
  // longer in the lineup (anyone who had `nhd` stored) falls through to the
  // default rather than selecting a provider that does not exist.
  const [selectedProviderId, setSelectedProviderId] = useState<string>(() => {
    try {
      const forTitle = localStorage.getItem(rememberedKey);
      if (forTitle && available.some((p) => p.id === forTitle)) return forTitle;
      const saved = localStorage.getItem(lastSourceKey(mediaType));
      if (saved && available.some((p) => p.id === saved)) return saved;
    } catch {
      // Ignore localStorage errors
    }
    return available[0]!.id;
  });

  const [season, setSeason] = useState<number>(initialSeason);
  const [episode, setEpisode] = useState<number>(initialEpisode);
  useEffect(() => {
    onEpisodeChange?.(season, episode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season, episode]);

  const [isTheater, setIsTheater] = useState<boolean>(false);
  const [autoFallback, setAutoFallback] = useState<boolean>(true);
  const [countdown, setCountdown] = useState<number | null>(null);
  /** Set when no source would play here, so the viewer is offered the real site. */
  const [showExternal, setShowExternal] = useState<boolean>(false);
  /**
   * Every source's answer for this title, keyed by provider id — the result of
   * asking all of them at once on mount.
   */
  const [probes, setProbes] = useState<Record<string, SourceProbe>>({});
  const [probing, setProbing] = useState<boolean>(false);
  const [audioPref, setAudioPref] = useState<AudioPreference>(() => {
    try {
      const saved = localStorage.getItem(AUDIO_PREF_KEY);
      if (saved === 'hi' || saved === 'en' || saved === 'any') return saved;
    } catch {
      // Ignore
    }
    return 'hi';
  });
  /**
   * Whether the tab is actually being looked at.
   *
   * A background tab does not run an iframe's `load` promptly — Chrome throttles
   * it — so the grace timer would report "never loaded" for a frame that is
   * perfectly fine and walk the whole lineup to the end. That is a bug in the
   * fallback, not in the sources, and the guard is here rather than in a comment
   * because it was seen: thirteen sources were exhausted on a tab that was simply
   * not in front.
   */
  const [tabVisible, setTabVisible] = useState<boolean>(
    () => typeof document === 'undefined' || document.visibilityState === 'visible',
  );

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onChange = () => setTabVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);
  const [reloadKey, setReloadKey] = useState<number>(0);
  const [notification, setNotification] = useState<string | null>(null);

  const toastRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Sources the fallback already moved to on its own, so it can never loop. */
  const autoVisitedRef = useRef<Set<string>>(new Set());
  /** True once the viewer has touched anything: the player stops second-guessing. */
  const claimedRef = useRef<boolean>(false);
  /** True once the frame fired `load` — something answered and rendered. */
  const loadedRef = useRef<boolean>(false);
  /** Read inside the batch probe, so changing the preference does not re-run it. */
  const audioPrefValue = useRef<AudioPreference>(audioPref);
  /** The source currently on screen, read from inside the same callback. */
  const selectedIdRef = useRef<string>(selectedProviderId);

  useEffect(() => {
    audioPrefValue.current = audioPref;
  }, [audioPref]);

  useEffect(() => {
    selectedIdRef.current = selectedProviderId;
  }, [selectedProviderId]);

  const notify = useCallback((message: string, holdMs = 2500) => {
    setNotification(message);
    if (toastRef.current) clearTimeout(toastRef.current);
    toastRef.current = setTimeout(() => setNotification(null), holdMs);
  }, []);

  useEffect(
    () => () => {
      if (toastRef.current) clearTimeout(toastRef.current);
    },
    [],
  );

  const activeId = available.some((p) => p.id === selectedProviderId)
    ? selectedProviderId
    : available[0]!.id;
  const providerIndex = Math.max(
    0,
    available.findIndex((p) => p.id === activeId),
  );
  const provider = available[providerIndex]!;
  const nextProvider = available[providerIndex + 1] ?? null;
  const streamUrl = provider.buildUrl(mediaType, media.id, season, episode);

  const rememberChoice = useCallback(
    (id: string) => {
      try {
        localStorage.setItem(lastSourceKey(mediaType), id);
        localStorage.setItem(rememberedKey, id);
      } catch {
        // Ignore
      }
    },
    [mediaType, rememberedKey],
  );

  const selectSource = useCallback(
    (id: string, remember: boolean) => {
      setSelectedProviderId(id);
      if (remember) rememberChoice(id);
    },
    [rememberChoice],
  );

  // Manual pick: the viewer knows better than the heuristic, so stop guessing.
  const handleSelectProvider = (id: string) => {
    claimedRef.current = true;
    selectSource(id, true);
    const target = available.find((p) => p.id === id);
    if (target) notify(`Switched to ${target.name}`);
  };

  const handleReload = () => {
    setReloadKey((k) => k + 1);
    notify('Reloading stream...', 2000);
  };

  /* -- 0. Ask every source at once ----------------------------------------- */
  useEffect(() => {
    let live = true;
    claimedRef.current = false;
    autoVisitedRef.current = new Set();
    setProbes({});
    setProbing(true);
    setShowExternal(false);

    const resolverSources = available.filter((p) => p.kind === 'hls' && p.apiProvider);
    const iframeSources = available.filter((p) => p.kind !== 'hls');

    // Every source is asked in the same tick, and the answers are applied as
    // they arrive rather than all at once — a batch that waits for the slowest
    // provider is a batch that sits on "checking" for ten seconds while a
    // perfectly good playlist was already in hand.
    const collected: Record<string, SourceProbe> = {};
    let arrived = 0;
    const total = available.length;
    /** Set once a ready playlist has been opened, so later ones only upgrade. */
    let openedReady = false;

    const settle = (probe: SourceProbe) => {
      if (!live) return;
      collected[probe.id] = probe;
      arrived += 1;

      setProbes((current) => ({ ...current, [probe.id]: probe }));

      const answers = Object.values(collected);
      const ranked = rankProbes(answers, SOURCE_ORDER[mediaType] ?? [], audioPrefValue.current);
      const best = ranked[0];

      // The viewer may have picked a source while the answers were arriving.
      if (best && !claimedRef.current) {
        if (!openedReady && best.status === 'ready') {
          openedReady = true;
          setProbing(false);
          setSelectedProviderId(best.id);
          notify(`${best.id.replace(/^fx-/, '')} · ${best.quality ?? 'ready'}`, 2200);
        } else if (openedReady && best.status === 'ready' && best.id !== selectedIdRef.current) {
          // A better ready source turned up after the first one opened.
          setSelectedProviderId(best.id);
        } else if (!openedReady) {
          setSelectedProviderId(best.id);
        }
      }

      if (arrived === total) {
        setProbing(false);
        if (!openedReady && !claimedRef.current) {
          const top = ranked[0];
          if (top) setSelectedProviderId(top.id);
          else setShowExternal(true);
        }
      }
    };

    for (const p of resolverSources) {
      void probeResolver(p.apiProvider!, mediaType, media.id, season, episode).then((result) =>
        // Re-keyed to the app's id ('fx-giant'); everything downstream looks the
        // answer up by the id the lineup uses, not by the resolver's name.
        settle({ ...result, id: p.id }),
      );
    }
    for (const p of iframeSources) {
      const started = Date.now();
      void probeIframe(p.buildUrl(mediaType, media.id, season, episode)).then((status) =>
        settle({ id: p.id, status, ms: Date.now() - started }),
      );
    }

    return () => {
      live = false;
    };
  }, [available, mediaType, media.id, season, episode, notify]);

  /* -- 0a. A new audio preference re-ranks the answers we already have ------ */
  useEffect(() => {
    if (probing) return;
    const answers = Object.values(probes);
    if (!answers.length) return;

    // Changing the language preference is a request to re-pick, so it overrides
    // an earlier manual choice — unlike the batch probe, which never does.
    const ranked = rankProbes(answers, SOURCE_ORDER[mediaType] ?? [], audioPref);
    const best = ranked[0];
    if (best) setSelectedProviderId(best.id);
  }, [audioPref, probing, probes, mediaType]);

  /* -- 0b. A resolver source picked by hand may not have been asked yet ----- */
  useEffect(() => {
    if (provider.kind !== 'hls' || !provider.apiProvider) return;
    if (probes[provider.id]) return; // already answered in the batch above
    if (probing) return;

    let live = true;
    loadedRef.current = false;

    void probeResolver(provider.apiProvider, mediaType, media.id, season, episode).then((result) => {
      if (!live) return;
      // Keyed by the lineup's id, not the resolver's.
      setProbes((current) => ({ ...current, [provider.id]: { ...result, id: provider.id } }));
    });

    return () => {
      live = false;
    };
  }, [provider.id, provider.kind, provider.apiProvider, probes, probing, mediaType, media.id, season, episode]);

  /* -- 1. A host that does not answer is skipped immediately -------------- */
  useEffect(() => {
    let live = true;
    loadedRef.current = false;
    setShowExternal(false);

    // An `hls` source has no page to probe; the resolver already answered.
    if (provider.kind === 'hls') return;

    void isReachable(streamUrl).then((reachable) => {
      if (!live || reachable) return;

      const next = available[providerIndex + 1];
      if (!next || autoVisitedRef.current.has(next.id)) {
        notify(`${provider.name} is not responding`, 3000);
        return;
      }

      autoVisitedRef.current.add(next.id);
      selectSource(next.id, false);
      notify(`${provider.name} is unreachable — switched to ${next.name}`, 3000);
    });
    return () => {
      live = false;
    };
  }, [streamUrl, provider.name, providerIndex, available, selectSource, notify]);

  /* -- 2. A frame that never loads is left after the grace period ---------- */
  useEffect(() => {
    setCountdown(null);

    if (!autoFallback || claimedRef.current) return;
    if (nextProvider && autoVisitedRef.current.has(nextProvider.id)) return;

    /*
     * An `hls` source is not guessed at. The resolver either handed us a
     * playlist or it did not, and hls.js reports a fatal error if it dies — so
     * this timer has nothing to add, and arming it would take a film that is
     * about to play and hand it to the next source for no reason. That is
     * exactly what it did on 3 Idiots: the Giant playlist had arrived and the
     * banner was still counting down to VidFast.
     */
    if (provider.kind === 'hls') return;

    // Nobody is watching a hidden tab, and Chrome will not run an iframe's
    // `load` promptly in one. Judging sources from there is how a working
    // lineup walks itself to the end and shows the "won't play here" card.
    if (!tabVisible) return;

    // A title that already worked here does not get second-guessed.
    let alreadyKnown = false;
    try {
      alreadyKnown = localStorage.getItem(rememberedKey) === provider.id;
    } catch {
      // Ignore
    }
    if (alreadyKnown) return;

    const claim = () => {
      claimedRef.current = true;
      setCountdown(null);
    };

    window.addEventListener('blur', claim);
    window.addEventListener('pointerdown', claim, true);
    window.addEventListener('keydown', claim, true);

    setCountdown(Math.round(GRACE_MS / 1000));
    const tick = setInterval(() => {
      setCountdown((left) => (left === null ? null : Math.max(0, left - 1)));
    }, 1000);

    const jump = setTimeout(() => {
      if (claimedRef.current) return;

      /*
       * The frame firing `load` means something answered and rendered. That is
       * not proof the film is playing — nothing cross-origin can give us that —
       * but taking a working player away from somebody is a worse bug than
       * waiting, so the fallback only moves on from a frame that never loaded
       * at all. A source that renders and then shows nothing is left to the
       * viewer, who has the Next Source button.
       */
      if (loadedRef.current) {
        setCountdown(null);
        return;
      }

      if (nextProvider) {
        autoVisitedRef.current.add(nextProvider.id);
        selectSource(nextProvider.id, false);
        notify(`${provider.name} did not load — trying ${nextProvider.name}`, 3000);
        return;
      }

      /*
       * Nothing left to try inside Pingo. Every provider is its own website, so
       * the honest last resort is to hand the viewer that page instead of a
       * black rectangle — same title, same episode, one tab away.
       */
      setShowExternal(true);
    }, GRACE_MS);

    return () => {
      clearInterval(tick);
      clearTimeout(jump);
      window.removeEventListener('blur', claim);
      window.removeEventListener('pointerdown', claim, true);
      window.removeEventListener('keydown', claim, true);
    };
  }, [
    autoFallback,
    tabVisible,
    provider.id,
    nextProvider,
    reloadKey,
    season,
    episode,
    selectSource,
    notify,
    rememberedKey,
  ]);

  // Reaching the end of the lineup means the fallback did its job; the next
  // viewer interaction records whatever they settled on.
  const keepThisOne = () => {
    claimedRef.current = true;
    setCountdown(null);
    rememberChoice(provider.id);
    notify(`Keeping ${provider.name}`, 1800);
  };

  // A resolved playlist that dies is the same situation as a resolver that
  // returned nothing: walk on, or hand the viewer the site.
  const handleStreamFailure = () => {
    const next = available[providerIndex + 1];
    if (next && !autoVisitedRef.current.has(next.id)) {
      autoVisitedRef.current.add(next.id);
      selectSource(next.id, false);
      notify(`${provider.name} failed — trying ${next.name}`, 3000);
      return;
    }
    setShowExternal(true);
  };

  // A playlist is only playable if this exact source answered with one during
  // the batch probe; everything else about it is a guess.
  const activeProbe = probes[provider.id];
  const activeStream =
    provider.kind === 'hls' && activeProbe?.status === 'ready' ? activeProbe.url : null;

  return (
    <div className="fixed inset-0 z-[230] flex bg-black animate-fadeIn">
      {/* Main Player Box */}
      <div
        className={cn(
          'relative z-10 flex h-full w-full flex-col overflow-hidden bg-[#090a0f]',
        )}
      >
        {/* Player Header Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 bg-[#12141c] px-4 py-2.5">
          <div className="flex items-center gap-2 min-w-0">
            <TvLogo markOnly className="shrink-0 [&_img]:h-7" />
            <div className="flex items-baseline gap-2 truncate">
              <h3 className="truncate text-sm font-bold text-white sm:text-base">{title}</h3>
              {isTv && (
                <span className="shrink-0 rounded bg-brand/20 border border-brand/40 px-2 py-0.5 text-xs font-semibold text-brand">
                  S{season} : E{episode}
                </span>
              )}
            </div>
          </div>

          {/* Right Action Tools */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Audio preference: decides which source wins the ranking */}
            <div className="flex items-center rounded-lg bg-white/5 p-0.5 ring-1 ring-white/10" role="group" aria-label="Preferred audio">
              {(['hi', 'en', 'any'] as const).map((pref) => (
                <button
                  key={pref}
                  type="button"
                  aria-pressed={audioPref === pref}
                  onClick={() => {
                    setAudioPref(pref);
                    try {
                      localStorage.setItem(AUDIO_PREF_KEY, pref);
                    } catch {
                      // Ignore
                    }
                  }}
                  className={cn(
                    'rounded-md px-2 py-0.5 text-[10px] font-bold uppercase transition-colors',
                    audioPref === pref ? 'bg-brand text-on-brand' : 'text-text-secondary hover:text-white',
                  )}
                  title={
                    pref === 'hi'
                      ? 'Prefer a source whose stream carries Hindi audio'
                      : pref === 'en'
                        ? 'Prefer English audio'
                        : 'Whatever answers fastest'
                  }
                >
                  {pref === 'hi' ? 'HI' : pref === 'en' ? 'EN' : 'ANY'}
                </button>
              ))}
            </div>

            {/* Auto-fallback toggle */}
            <button
              type="button"
              onClick={() => {
                const next = !autoFallback;
                setAutoFallback(next);
                if (!next) claimedRef.current = true;
              }}
              className={cn(
                'flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition-all active:scale-95',
                autoFallback
                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                  : 'bg-white/5 text-text-secondary border border-white/10',
              )}
              title={
                autoFallback
                  ? 'Tries the next source on its own when this one does not start'
                  : 'Stays on the source you picked'
              }
            >
              <Zap className="size-3.5 fill-current" />
              <span className="hidden sm:inline">Auto-Fallback: {autoFallback ? 'ON' : 'OFF'}</span>
            </button>

            {/* Next Source Button */}
            <button
              type="button"
              onClick={() => {
                const next = available[(providerIndex + 1) % available.length]!;
                claimedRef.current = true;
                selectSource(next.id, true);
                notify(`Switched to ${next.name}`);
              }}
              className="flex items-center gap-1.5 rounded-lg bg-brand/20 border border-brand/40 px-2.5 py-1 text-xs font-bold text-brand hover:bg-brand/30 transition-all active:scale-95 shadow-sm"
              title="Switch to next streaming source"
            >
              <SkipForward className="size-3.5" />
              <span>Next Source ▸</span>
            </button>

            {/* Reload Stream */}
            <button
              type="button"
              onClick={handleReload}
              className="grid size-8 place-items-center rounded-full text-text-secondary hover:bg-white/10 hover:text-white transition-colors active:scale-95"
              title="Reload current stream"
            >
              <RefreshCw className="size-3.5" />
            </button>

            {/* Open Direct External Stream */}
            <a
              href={streamUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="grid size-8 place-items-center rounded-full text-text-secondary hover:bg-white/10 hover:text-white transition-colors active:scale-95"
              title="Open stream in a new tab"
            >
              <ExternalLink className="size-3.5" />
            </a>

            {onOpenTrailer && (
              <button
                type="button"
                onClick={() => onOpenTrailer(media)}
                className="hidden sm:flex items-center gap-1.5 rounded-lg bg-white/10 border border-white/20 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-white/20"
              >
                <Play className="size-3.5 fill-current text-brand" />
                <span>Trailer</span>
              </button>
            )}

            <button
              type="button"
              aria-label="Toggle Theater Mode"
              onClick={() => setIsTheater((prev) => !prev)}
              className="grid size-8 place-items-center rounded-full text-text-secondary hover:bg-white/10 hover:text-white transition-colors active:scale-95"
            >
              <Maximize2 className="size-4" />
            </button>

            <button
              type="button"
              aria-label="Close player"
              onClick={onClose}
              className="grid size-8 place-items-center rounded-full text-text-secondary hover:bg-white/10 hover:text-white transition-colors active:scale-95"
            >
              <X className="size-5" />
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {/* Video Frame */}
            <div className="relative aspect-video w-full flex-1 bg-black lg:aspect-auto">
              {/* Notification Toast */}
              {notification && (
                <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 rounded-full bg-black/85 px-4 py-1.5 text-xs font-semibold text-white backdrop-blur-md border border-white/20 shadow-xl animate-fadeIn">
                  <Zap className="size-3.5 text-brand" />
                  <span>{notification}</span>
                </div>
              )}

              {/* Fallback countdown: honest about what is about to happen */}
              {countdown !== null && countdown > 0 && nextProvider && autoFallback && (
                <div className="absolute bottom-4 left-4 right-4 sm:left-auto sm:right-4 z-20 flex flex-wrap items-center gap-3 rounded-xl bg-[#12141c]/90 px-4 py-2.5 backdrop-blur-xl border border-white/10 shadow-2xl">
                  <div className="flex items-center gap-2 text-xs text-white">
                    <AlertCircle className="size-4 text-amber-400 shrink-0" />
                    <span>
                      Not starting? Trying <strong>{nextProvider.name}</strong> in {countdown}s
                    </span>
                  </div>
                  <div className="flex items-center gap-2 ml-auto">
                    <button
                      type="button"
                      onClick={keepThisOne}
                      className="rounded-lg bg-brand px-3 py-1 text-xs font-bold text-on-brand shadow-sm transition-transform active:scale-95"
                    >
                      It&apos;s playing — keep this
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        autoVisitedRef.current.add(nextProvider.id);
                        selectSource(nextProvider.id, true);
                        notify(`Switched to ${nextProvider.name}`);
                      }}
                      className="rounded-lg bg-white/10 px-2 py-1 text-xs text-text-secondary hover:text-white"
                    >
                      Switch now
                    </button>
                  </div>
                </div>
              )}

              {/* No source would play here: hand over the provider's own page */}
              {showExternal && (
                <div className="absolute inset-0 z-40 grid place-items-center bg-[#090a0f]/95 px-6">
                  <div className="max-w-md rounded-2xl border border-white/10 bg-[#12141c] p-6 text-center shadow-2xl">
                    <AlertCircle className="mx-auto size-6 text-amber-400" />
                    <h4 className="mt-3 text-base font-bold text-white">
                      {provider.name} won&apos;t play inside Pingo
                    </h4>
                    <p className="mt-1.5 text-xs leading-relaxed text-text-secondary">
                      This server refuses to be embedded, so the film cannot start here. It still
                      exists on {provider.name} — open it there, in a new tab.
                    </p>
                    <div className="mt-4 flex flex-col gap-2">
                      <a
                        href={streamUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-bold text-on-brand shadow-sm transition-transform active:scale-95"
                      >
                        <ExternalLink className="size-4" />
                        Open {provider.name}
                      </a>
                      <div className="flex gap-2">
                        {nextProvider && (
                          <button
                            type="button"
                            onClick={() => {
                              autoVisitedRef.current.add(nextProvider.id);
                              selectSource(nextProvider.id, true);
                              setShowExternal(false);
                              notify(`Switched to ${nextProvider.name}`);
                            }}
                            className="flex-1 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/20"
                          >
                            Try {nextProvider.name}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setShowExternal(false)}
                          className="flex-1 rounded-lg bg-white/5 px-3 py-1.5 text-xs text-text-secondary transition-colors hover:text-white"
                        >
                          Dismiss
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {provider.kind === 'hls' ? (
                activeStream ? (
                  <TvHlsPlayer
                    key={`${activeStream}-${reloadKey}`}
                    src={activeStream}
                    title={title}
                    onFail={handleStreamFailure}
                  />
                ) : (
                  <div className="grid h-full w-full place-items-center bg-black px-6">
                    <div className="flex max-w-sm flex-col items-center gap-3 text-center">
                      <div className="size-9 animate-spin rounded-full border-2 border-white/15 border-t-white/80" />
                      <p className="text-sm font-semibold text-white/85">
                        {probing ? 'Checking every source…' : `${provider.name} has no stream`}
                      </p>
                      <p className="text-[11px] leading-relaxed text-white/45">
                        {probing
                          ? 'Speed depends on your device and your internet connection — each source is asked directly from your browser.'
                          : 'Pick another source from the list below, or open this one on its own site.'}
                      </p>
                    </div>
                  </div>
                )
              ) : (
                <iframe
                  key={`${provider.id}-${mediaType}-${media.id}-${season}-${episode}-${reloadKey}`}
                  src={streamUrl}
                  title={`${title} Live Stream`}
                  allow="autoplay; encrypted-media; fullscreen; picture-in-picture; accelerometer; gyroscope"
                  allowFullScreen
                  referrerPolicy={provider.referrerPolicy ?? 'no-referrer'}
                  className="h-full w-full border-0"
                  onLoad={() => {
                    // Something answered and rendered. See the note in the grace
                    // timer: this is as close to "it works" as a cross-origin
                    // frame can get, and the fallback never overrides it.
                    loadedRef.current = true;
                  }}
                  onError={() => {
                    if (autoFallback && nextProvider && !autoVisitedRef.current.has(nextProvider.id)) {
                      autoVisitedRef.current.add(nextProvider.id);
                      selectSource(nextProvider.id, false);
                      notify(`${provider.name} failed — trying ${nextProvider.name}`, 3000);
                    }
                  }}
                />
              )}
            </div>

            {/* Player Bottom Control Strip */}
            <div className="flex flex-col gap-2.5 border-t border-white/10 bg-[#12141c] px-4 py-2.5">
              {/* Source Selector Bar */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-text-secondary">
                  <MonitorPlay className="size-3.5 text-brand" />
                  <span>{probing ? `Checking ${available.length} sources…` : `Sources (${available.length}):`}</span>
                  {/* Always available: some frames load and then show nothing,
                      and nothing cross-origin can detect that. The viewer needs
                      a way out that is not "give up". */}
                  <a
                    href={streamUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={`Open ${provider.name} on its own site`}
                    className="ml-1 flex items-center gap-1 rounded-md bg-white/5 px-2 py-1 text-[10px] font-semibold normal-case tracking-normal text-text-secondary ring-1 ring-white/10 transition-colors hover:text-white"
                  >
                    <ExternalLink className="size-3" />
                    <span className="hidden sm:inline">Open on {provider.name}</span>
                  </a>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {available.map((p) => {
                    const active = activeId === p.id;
                    const probe = probes[p.id];
                    /*
                     * Green is proof: this source returned a playlist for this
                     * exact episode during the batch probe. Amber is weaker —
                     * the host answered, but a cross-origin frame cannot be
                     * asked whether it has the title. Dim is "no".
                     */
                    const dot =
                      probe?.status === 'ready'
                        ? 'bg-emerald-400'
                        : probe?.status === 'reachable'
                          ? 'bg-amber-400'
                          : probe
                            ? 'bg-white/25'
                            : 'bg-white/10 animate-pulse';
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => handleSelectProvider(p.id)}
                        title={probe ? `${p.name} · ${probe.status}` : `${p.name} · checking`}
                        className={cn(
                          'flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition-all active:scale-95',
                          active
                            ? 'bg-brand text-on-brand shadow-sm'
                            : 'bg-white/5 text-text-secondary hover:bg-white/10 hover:text-white ring-1 ring-white/10',
                        )}
                      >
                        <span className={cn('size-1.5 shrink-0 rounded-full', dot)} aria-hidden />
                        <span>{p.name}</span>
                        {p.badge && (
                          <span
                            className={cn(
                              'rounded px-1.5 py-0.2 text-[9px] font-bold uppercase',
                              active
                                ? 'bg-white/20 text-white'
                                : p.isHindi
                                  ? 'bg-amber-500/20 text-amber-300'
                                  : 'bg-brand/20 text-brand',
                            )}
                          >
                            {p.badge}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {!isTheater && (
            <TvEpisodePanel
              media={media}
              isTv={isTv}
              season={season}
              episode={episode}
              onPick={(s, e) => {
                setSeason(s);
                setEpisode(e);
              }}
              onOpenMedia={(m) => onOpenMedia?.(m)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export default TvStreamPlayer;
