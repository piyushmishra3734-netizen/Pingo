import { useProfile } from '@pingo/core';
import { Button, cn } from '@pingo/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';

import { ScreenHeader } from '../../components/ScreenHeader.js';
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
      const [slides, splash] = await Promise.all([
        listOnboardingSlideRows(),
        listAppSplashRows(),
      ]);
      setRows(slides);
      setSplashRows(splash);
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
