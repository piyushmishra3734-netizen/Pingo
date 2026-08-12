import { createPortal } from "react-dom";

import { useBackStep } from "../features/navigation/useBackStep.js";

/**
 * Renders its children at the end of `<body>`, outside every layout ancestor.
 *
 * ## Why a portal rather than trusting `position: fixed`
 *
 * `fixed` is only fixed to the viewport while no ancestor establishes a
 * containing block - and a `transform`, `filter`, `backdrop-filter`,
 * `perspective`, `will-change: transform` or `contain: paint` anywhere above is
 * enough to capture it. Any one of those is a reasonable thing to add to a
 * screen, and none of them looks like it has anything to do with a dialog three
 * levels down.
 *
 * That is not hypothetical here. The screen wrapper's entrance animation left a
 * transform behind, so every overlay in this app - the context menu, all three
 * chat-list sheets, the edit dialog, the photo editor - was being sized against
 * the screen container rather than the viewport. The photo editor came out
 * short by exactly the height of the dock, which is subtle enough to read as a
 * spacing choice rather than a bug.
 *
 * Changing that one animation fixed that one case. A portal fixes the class:
 * children of `<body>` have no ancestor to be captured by, so an overlay stays
 * correct no matter what any screen above it does later.
 */

export function Overlay({
  children,
  onDismiss,
}: {
  children: React.ReactNode;
  /**
   * What the phone's Back button should do while this is open.
   *
   * Given here rather than left to each caller because every overlay in the
   * product had the same fault: Back popped the page underneath and closed
   * three things at once. An overlay that passes this closes itself instead,
   * which is what Back means everywhere else on a phone. See `useBackStep`.
   */
  onDismiss?: () => void;
}) {
  useBackStep(Boolean(onDismiss), () => onDismiss?.());

  /*
   * No wrapper element. The children already carry their own `fixed inset-0`
   * and z-index, and an extra div here would be one more box for a future
   * stylesheet to reach into.
   */
  return createPortal(children, document.body);
}
