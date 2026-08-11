/**
 * A video link, recognised and normalised.
 *
 * ## Why `identify` and `enrich` are separate
 *
 * Everything needed to draw the card - which platform, which video, where the
 * thumbnail lives, whether we may play it in place - is derivable from the URL
 * itself, with no network at all. Only the title and the author require asking
 * anybody, and only YouTube will answer.
 *
 * Splitting the two is what lets a card appear the instant a message is sent
 * rather than after a round trip, and it is why sending is never blocked on
 * preview generation: `identify` is synchronous. Enrichment is pure upside - if
 * it never resolves, the card is still a card.
 *
 * ## Why there is no `playable` flag
 *
 * `embedUrl` already carries that fact. A separate boolean is a second copy of
 * the same answer, and two copies of an answer eventually disagree - the bug
 * being an embed we refuse to play or, far worse, a play button wired to
 * nothing. Present means playable, absent means offer the original.
 */

export type VideoPlatform = 'youtube' | 'instagram' | 'snapchat' | 'direct';

export interface VideoPreview {
  platform: VideoPlatform;
  /** Exactly what the sender typed, kept so the message never loses it. */
  originalUrl: string;
  /** Cleaned - tracking parameters dropped, mobile hosts folded to canonical. */
  canonicalUrl: string;
  /**
   * Where the player lives, when the platform officially permits framing.
   *
   * **Always constructed by a provider from a validated id, never taken from
   * the message.** That is the whole iframe-abuse defence: no string a sender
   * controls can reach an `iframe src`, because the only thing that survives
   * parsing is an id matched against a fixed character class, and the host is a
   * constant in our own code.
   */
  embedUrl?: string;
  /**
   * The media itself, when the link *is* a video file rather than a page.
   *
   * Played in our own `<video>`, which is why it is a separate field from
   * `embedUrl` rather than a platform the card checks for. The distinction the
   * UI branches on is "a frame somebody else draws" against "a file we can
   * play", and that stays true for any platform added later.
   *
   * Unlike `embedUrl`, this **is** the sender's own URL - there is no id to
   * validate and no host of ours to put it on. That is acceptable here and
   * would not be for a frame: a `<video src>` cannot run script, cannot read
   * this page, and fails closed by simply not playing. It is still only ever
   * requested after somebody presses play, so a link nobody opens is never
   * fetched.
   */
  fileUrl?: string;
  thumbnailUrl?: string;
  title?: string;
  author?: string;
}

export interface VideoProvider {
  name: VideoPlatform;

  canHandle(url: URL): boolean;

  /**
   * The whole preview, from the URL alone. Never touches the network.
   *
   * Returns nothing when the URL belongs to the platform but is not a video -
   * an Instagram profile, a YouTube channel - which is what stops an ordinary
   * link being dressed up as a reel.
   */
  identify(url: URL): VideoPreview | undefined;

  /**
   * Title and author, where the platform publishes them.
   *
   * Optional, and must never reject: a provider that cannot enrich simply does
   * not implement this, and one whose request fails resolves to nothing. The
   * card is already on screen by the time this runs.
   */
  enrich?(preview: VideoPreview, signal: AbortSignal): Promise<Partial<VideoPreview>>;
}
