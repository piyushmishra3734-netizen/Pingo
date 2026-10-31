/**
 * A chat banner behind a row: the picture on the right, fading into the row's
 * own background toward the left, so the avatar, name and message stay on
 * plain ground and stay readable whatever the picture is.
 *
 * Decorative, and drawn as a background so a slow or missing file is simply no
 * banner rather than a broken image. The row must be `relative` and clip its
 * corners; its content sits above this with `relative`.
 */
export function BannerBackdrop({ src }: { src: string }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-y-0 right-0 w-[78%] bg-cover bg-center [mask-image:linear-gradient(to_left,#000_35%,transparent)] opacity-75"
      style={{ backgroundImage: `url(${src})` }}
    />
  );
}
