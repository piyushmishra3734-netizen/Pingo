/**
 * The shapes the `pingo-saavn` Worker answers with.
 *
 * The source of truth is `workers/saavn/src/normalize.ts`; these mirror it for
 * the app. If one changes, change both.
 */

export interface Artist {
  type: 'artist';
  id: string;
  name: string;
  image: string;
  role?: string;
}

/** kbps ('12' | '48' | '96' | '160' | '320') -> address. Empty when JioSaavn will not stream it. */
export type Stream = Partial<Record<'12' | '48' | '96' | '160' | '320', string>>;

export interface Song {
  type: 'song';
  id: string;
  name: string;
  album: { id: string; name: string };
  artists: Artist[];
  credits: Artist[];
  image: string;
  secs: number;
  year: number;
  language: string;
  explicit: boolean;
  plays: number;
  hasLyrics: boolean;
  label: string;
  copyright: string;
  url: string;
  stream: Stream;
}

export interface Album {
  type: 'album';
  id: string;
  name: string;
  subtitle: string;
  artists: Artist[];
  image: string;
  year: number;
  language: string;
  songCount: number;
  url: string;
  songs?: Song[];
}

export interface Playlist {
  type: 'playlist';
  id: string;
  name: string;
  subtitle: string;
  image: string;
  songCount: number;
  followers: number;
  url: string;
  songs?: Song[];
}

export interface Station {
  type: 'station';
  id: string;
  kind: 'featured' | 'artist' | 'song';
  name: string;
  subtitle: string;
  image: string;
  language: string;
  artistId?: string;
  color?: string;
}

export interface Channel {
  type: 'channel';
  id: string;
  name: string;
  kind: string;
  image: string;
  video?: string;
}

export type Item = Song | Album | Playlist | Artist | Station | Channel;

export interface Module {
  key: string;
  title: string;
  subtitle: string;
  items: Item[];
}

export interface Paged<T> {
  items: T[];
  page: number;
  more: boolean;
  total?: number;
  /** Set when nothing matched as typed and a loosened spelling did. */
  corrected?: string;
}

export interface SearchAll {
  corrected?: string;
  top: Item[];
  songs: Song[];
  albums: Item[];
  artists: Item[];
  playlists: Item[];
}

export interface ArtistPage extends Artist {
  followers: number;
  fans: number;
  verified: boolean;
  language: string;
  languages: string[];
  hasRadio: boolean;
  bio: { title: string; text: string }[];
  born: string;
  links: { wiki: string; facebook: string; twitter: string };
  topSongs: Song[];
  topAlbums: Album[];
  singles: Album[];
  latest: Album[];
  playlists: Playlist[];
  similar: Artist[];
  more: { songs: boolean; albums: boolean };
}

export interface ChannelPage extends Channel {
  description: string;
  modules: Module[];
}

export interface Lyrics {
  lines: string[];
  copyright: string;
  snippet: string;
}

export interface StationStart {
  stationId: string;
  songs: Song[];
}
