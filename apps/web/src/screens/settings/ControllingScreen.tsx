import { useProfile } from '@pingo/core';
import { Button, cn } from '@pingo/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';

import { ScreenHeader } from '../../components/ScreenHeader.js';
import { getSupabaseClient } from '../../lib/supabase/client.js';
import { MissionControl } from '../../features/referrals/MissionControl.js';
import {
  listAppSplashRows,
  listOnboardingSlideRows,
  previewSplashUrl,
  previewUrlFor,
  SLIDE_COUNT,
  type AppSplashRow,
  type OnboardingSlideRow,
  type SlideVariant,
  uploadAppSplash,
  uploadOnboardingSlide,
} from '../../lib/supabase/onboarding-slides.js';
import {
  clearUpdateNotice,
  loadUpdateNotice,
  updateNoticeUrl,
  uploadUpdateNotice,
  type UpdateNoticeRow,
} from '../../lib/supabase/update-notice.js';

/**
 * Operator-only: upload original-quality splash + intro art (PC + mobile).
 * Visible solely for `@piuxxh` so assets can be published without redesign.
 */

const OPERATOR_USERNAME = 'piuxxh';

export function ControllingScreen() {
  const { profile } = useProfile();
  const navigate = useNavigate();
  const allowed = profile?.username === OPERATOR_USERNAME;

  const [rows, setRows] = useState<OnboardingSlideRow[]>([]);
  const [splashRows, setSplashRows] = useState<AppSplashRow[]>([]);
  const [premiumHandle, setPremiumHandle] = useState('');
  const [notice, setNotice] = useState<UpdateNoticeRow | null>(null);
  const [minBuild, setMinBuild] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const byKey = useMemo(() => {
    const map = new Map<string, OnboardingSlideRow>();
    for (const row of rows) map.set(`${row.slide_index}:${row.variant}`, row);
    return map;
  }, [rows]);

  const splashByVariant = useMemo(() => {
    const map = new Map<SlideVariant, AppSplashRow>();
    for (const row of splashRows) map.set(row.variant, row);
    return map;
  }, [splashRows]);

  const refresh = useCallback(async () => {
    try {
      const [slides, splash, update] = await Promise.all([
        listOnboardingSlideRows(),
        listAppSplashRows(),
        loadUpdateNotice(),
      ]);
      setRows(slides);
      setSplashRows(splash);
      setNotice(update);
      setMinBuild(update ? String(update.min_build) : '');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load assets');
    }
  }, []);

  useEffect(() => {
    if (!allowed) return;
    void refresh();
  }, [allowed, refresh]);

  if (!allowed) {
    return <Navigate to="/settings" replace />;
  }

  const onPickSlide = async (slide: number, variant: SlideVariant, file: File | null) => {
    if (!file) return;
    const key = `slide:${slide}:${variant}`;
    setBusy(key);
    setError(null);
    setOk(null);
    try {
      await uploadOnboardingSlide(slide, variant, file);
      await refresh();
      setOk(`Slide ${slide} (${variant}) uploaded — original quality kept.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setBusy(null);
    }
  };

  const onPickSplash = async (variant: SlideVariant, file: File | null) => {
    if (!file) return;
    const key = `splash:${variant}`;
    setBusy(key);
    setError(null);
    setOk(null);
    try {
      await uploadAppSplash(variant, file);
      await refresh();
      setOk(`Splash (${variant}) uploaded — original quality kept.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setBusy(null);
    }
  };

  /*
   * Granting premium by hand, which is the whole billing system for now.
   *
   * Deliberately a username rather than a picker: there is no list of accounts
   * anywhere in the app, building one for this would be a screen, and the
   * operator granting premium already knows who they are granting it to.
   */
  const onPremium = async (value: boolean) => {
    const handle = premiumHandle.trim().replace(/^@/, '').toLowerCase();
    if (!handle) return;
    setBusy('premium');
    setError(null);
    setOk(null);
    try {
      const client = getSupabaseClient();
      const { data: found, error: lookupError } = await client
        .from('profiles')
        .select('id, username')
        .eq('username', handle)
        .maybeSingle();
      if (lookupError) throw lookupError;
      if (!found) throw new Error(`No account called @${handle}`);

      const { error: rpcError } = await client.rpc('set_premium', {
        target: found.id,
        value,
      });
      if (rpcError) throw rpcError;
      setOk(`@${found.username} ${value ? 'now has' : 'no longer has'} premium.`);
      setPremiumHandle('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change premium');
    } finally {
      setBusy(null);
    }
  };

  const onPickNotice = async (file: File | null) => {
    if (!file) return;
    setBusy('notice');
    setError(null);
    setOk(null);
    try {
      await uploadUpdateNotice(file, Number.parseInt(minBuild, 10));
      await refresh();
      setOk('Update card published — anyone on an older build sees it next open.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setBusy(null);
    }
  };

  const onClearNotice = async () => {
    setBusy('notice');
    setError(null);
    setOk(null);
    try {
      await clearUpdateNotice();
      await refresh();
      setOk('Update card taken down.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not take it down');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex h-full flex-col bg-page">
      <ScreenHeader title="Controlling" showBack />

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-28 pt-3">
        <p className="mb-3 px-1 text-caption text-text-secondary">
          Upload splash + intro art at original quality (no redesign, no recompress).
          Public visitors see these after a hard refresh / new open.
        </p>

        <div className="mb-3 flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => navigate('/')}>
            Preview splash
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => navigate('/intro?replay=1')}
          >
            Preview intro
          </Button>
          <Button variant="text" size="sm" onClick={() => void refresh()}>
            Refresh
          </Button>
        </div>

        {error ? (
          <p className="mb-3 rounded-lg bg-danger/10 px-3 py-2 text-caption text-danger">{error}</p>
        ) : null}
        {ok ? (
          <p className="mb-3 rounded-lg bg-brand/10 px-3 py-2 text-caption text-brand">{ok}</p>
        ) : null}

        <MissionControl />

        {/* Premium */}
        <section className="mb-4 rounded-lg bg-surface p-3 shadow-sm">
          <h2 className="mb-1 text-body font-semibold text-ink">Premium</h2>
          <p className="mb-3 text-caption text-text-secondary">
            Unlocks HD — sending photos at original quality instead of 480p.
            Granted by hand until there is something to buy it with.
          </p>
          <input
            value={premiumHandle}
            onChange={(e) => setPremiumHandle(e.target.value)}
            placeholder="username"
            autoCapitalize="none"
            autoCorrect="off"
            className="mb-2 w-full rounded-md border border-border/60 bg-page px-3 py-2 text-body text-ink"
          />
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={busy === 'premium' || !premiumHandle.trim()}
              onClick={() => void onPremium(true)}
            >
              Grant
            </Button>
            <Button
              variant="text"
              size="sm"
              disabled={busy === 'premium' || !premiumHandle.trim()}
              onClick={() => void onPremium(false)}
            >
              Remove
            </Button>
          </div>
        </section>

        {/* Update card */}
        <section className="mb-4 rounded-lg bg-surface p-3 shadow-sm">
          <h2 className="mb-1 text-body font-semibold text-ink">Update card</h2>
          <p className="mb-3 text-caption text-text-secondary">
            Everyone sees this on launch — web included. Anyone on an installed
            build below the number you set gets it back every open until they
            install the new APK; everyone else can close it once and it is gone.
            Publishing a new card shows it to everybody again.
          </p>

          <label className="mb-3 block">
            <span className="text-caption font-medium text-text-secondary">
              Show to builds below
            </span>
            <input
              type="number"
              inputMode="numeric"
              value={minBuild}
              onChange={(e) => setMinBuild(e.target.value)}
              placeholder="2603503"
              className="mt-1 w-full rounded-md border border-border/60 bg-page px-3 py-2 text-body text-ink"
            />
            <span className="mt-1 block text-[11px] text-text-tertiary">
              versionCode of the build you just shipped — YYWWBB, so 2.26.35.8 is
              2603508.
            </span>
            {/*
              What the number actually means, in a sentence.

              A build number is seven digits and one wrong one changes who the
              card reaches, silently. 4664 was typed once: every phone is above
              it, so everybody counted as up to date, saw it once, and never saw
              it again. Nothing errored. This says out loud what is about to
              happen so the mistake is visible before it is published.
            */}
            {minBuild.trim() ? (
              <span className="mt-1 block text-[11px] text-text-secondary">
                {Number(minBuild) >= 1_000_000
                  ? `Anyone on a build older than ${Number(minBuild)} keeps seeing this until they update. Everyone else sees it once.`
                  : 'That is not a build number — they are seven digits. Every phone is above this, so nobody would be asked to update.'}
              </span>
            ) : null}
          </label>

          <div className="mb-2 overflow-hidden rounded bg-page">
            {notice ? (
              <img
                src={updateNoticeUrl(notice)}
                alt=""
                className="max-h-56 w-full object-contain"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.opacity = '0.25';
                }}
              />
            ) : (
              <p className="px-3 py-6 text-center text-caption text-text-tertiary">
                No card published
              </p>
            )}
          </div>

          <span className="mb-2 block text-[11px] text-text-tertiary">
            {notice
              ? `Nagging builds under ${notice.min_build} · ${new Date(notice.updated_at).toLocaleString()}`
              : 'Nobody is being shown anything'}
          </span>

          <input
            type="file"
            accept="image/*"
            className="text-caption file:mr-2 file:rounded-md file:border-0 file:bg-brand/15 file:px-2 file:py-1 file:text-caption file:font-medium file:text-brand"
            disabled={busy === 'notice' || !minBuild.trim()}
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              e.target.value = '';
              void onPickNotice(f);
            }}
          />
          {notice ? (
            /*
              A real button, not a text link under a file input.
              
              It was `variant="text"` at `sm`, tucked below the picker, and the
              operator could not find it - which for the one control that stops
              a card appearing on everybody's phone is the wrong place to be
              subtle.
            */
            <Button
              variant="secondary"
              size="sm"
              className="mt-3 w-full border-danger/40 text-danger"
              disabled={busy === 'notice'}
              onClick={() => void onClearNotice()}
            >
              Remove this card
            </Button>
          ) : null}
        </section>

        {/* Splash */}
        <section className="mb-4 rounded-lg bg-surface p-3 shadow-sm">
          <h2 className="mb-1 text-body font-semibold text-ink">Splash screen</h2>
          <p className="mb-3 text-caption text-text-secondary">
            First screen after launch. PC (landscape) and mobile (portrait) —
            not the same image stretched.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {(['desktop', 'mobile'] as const).map((variant) => {
              const row = splashByVariant.get(variant);
              const key = `splash:${variant}`;
              const preview = previewSplashUrl(row, variant);
              return (
                <label
                  key={variant}
                  className={cn(
                    'flex cursor-pointer flex-col gap-2 rounded-md border border-border/60 p-2',
                    'hover:bg-hover/60',
                    busy === key && 'opacity-60',
                  )}
                >
                  <span className="text-caption font-medium text-text-secondary">
                    {variant === 'desktop' ? 'PC / desktop' : 'Mobile'}
                  </span>
                  <div
                    className={cn(
                      'overflow-hidden rounded bg-page',
                      variant === 'mobile'
                        ? 'aspect-[9/16] max-h-56'
                        : 'aspect-video max-h-40',
                    )}
                  >
                    <img
                      src={preview}
                      alt=""
                      className="h-full w-full object-cover"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.opacity = '0.25';
                      }}
                    />
                  </div>
                  <span className="text-[11px] text-text-tertiary">
                    {row
                      ? `${row.storage_path} · ${new Date(row.updated_at).toLocaleString()}`
                      : 'Using built-in splash until you upload'}
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    className="text-caption file:mr-2 file:rounded-md file:border-0 file:bg-brand/15 file:px-2 file:py-1 file:text-caption file:font-medium file:text-brand"
                    disabled={busy === key}
                    onChange={(e) => {
                      const f = e.target.files?.[0] ?? null;
                      e.target.value = '';
                      void onPickSplash(variant, f);
                    }}
                  />
                </label>
              );
            })}
          </div>
        </section>

        <h2 className="mb-2 px-1 text-body font-semibold text-ink">Intro slides</h2>
        <p className="mb-3 px-1 text-caption text-text-secondary">
          Five slides after splash, before login / get started.
        </p>

        <div className="space-y-3">
          {Array.from({ length: SLIDE_COUNT }, (_, i) => {
            const slide = i + 1;
            return (
              <section key={slide} className="rounded-lg bg-surface p-3 shadow-sm">
                <h3 className="mb-2 text-body font-semibold text-ink">Slide {slide}</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  {(['desktop', 'mobile'] as const).map((variant) => {
                    const row = byKey.get(`${slide}:${variant}`);
                    const key = `slide:${slide}:${variant}`;
                    const preview = previewUrlFor(row, slide, variant);
                    return (
                      <label
                        key={variant}
                        className={cn(
                          'flex cursor-pointer flex-col gap-2 rounded-md border border-border/60 p-2',
                          'hover:bg-hover/60',
                          busy === key && 'opacity-60',
                        )}
                      >
                        <span className="text-caption font-medium capitalize text-text-secondary">
                          {variant === 'desktop' ? 'PC / desktop' : 'Mobile'}
                        </span>
                        <div className="aspect-[9/16] max-h-48 overflow-hidden rounded bg-page sm:aspect-video sm:max-h-36">
                          <img
                            src={preview}
                            alt=""
                            className="h-full w-full object-cover"
                            onError={(e) => {
                              (e.currentTarget as HTMLImageElement).style.opacity = '0.25';
                            }}
                          />
                        </div>
                        <span className="text-[11px] text-text-tertiary">
                          {row
                            ? `${row.storage_path} · ${new Date(row.updated_at).toLocaleString()}`
                            : 'Not uploaded yet — local fallback if present'}
                        </span>
                        <input
                          type="file"
                          accept="image/*"
                          className="text-caption file:mr-2 file:rounded-md file:border-0 file:bg-brand/15 file:px-2 file:py-1 file:text-caption file:font-medium file:text-brand"
                          disabled={busy === key}
                          onChange={(e) => {
                            const f = e.target.files?.[0] ?? null;
                            e.target.value = '';
                            void onPickSlide(slide, variant, f);
                          }}
                        />
                      </label>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
