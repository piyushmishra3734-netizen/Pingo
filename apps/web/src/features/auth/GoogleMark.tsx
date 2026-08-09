/** Official four-colour Google G - brand terms forbid monochrome redraws. */
export function GoogleMark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden className="shrink-0">
      <path
        fill="#4285F4"
        d="M45.1 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h11.8a10 10 0 0 1-4.4 6.6v5.5h7.1c4.2-3.8 6.6-9.5 6.6-16.1Z"
      />
      <path
        fill="#34A853"
        d="M24 46c6 0 11-2 14.5-5.4l-7.1-5.5a13 13 0 0 1-19.4-6.8H4.7v5.7A22 22 0 0 0 24 46Z"
      />
      <path
        fill="#FBBC05"
        d="M12 28.3a13 13 0 0 1 0-8.6v-5.7H4.7a22 22 0 0 0 0 20l7.3-5.7Z"
      />
      <path
        fill="#EA4335"
        d="M24 9.5c3.3 0 6.2 1.1 8.5 3.3l6.3-6.3A21 21 0 0 0 24 2 22 22 0 0 0 4.7 14l7.3 5.7A13 13 0 0 1 24 9.5Z"
      />
    </svg>
  );
}
