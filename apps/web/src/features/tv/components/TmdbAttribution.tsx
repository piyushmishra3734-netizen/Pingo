import React from 'react';

export function TmdbAttribution() {
  return (
    <footer className="mt-12 flex flex-col items-center justify-center gap-2 border-t border-line px-4 py-8 text-center text-xs text-text-secondary">
      <div className="flex items-center gap-2">
        <span className="font-semibold text-ink">PINGO TV</span>
        <span>•</span>
        <a
          href="https://www.themoviedb.org"
          target="_blank"
          rel="noopener noreferrer"
          className="text-text-secondary transition-colors hover:text-ink hover:underline"
        >
          TMDB Database
        </a>
      </div>
      <p className="max-w-md leading-relaxed text-[11px] text-text-secondary/80">
        This product uses the TMDB API but is not endorsed or certified by TMDB.
      </p>
    </footer>
  );
}
