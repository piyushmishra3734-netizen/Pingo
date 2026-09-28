/**
 * @pingo/ui - the PINGO component library.
 *
 * Every component here is a direct expression of the branding board. Screens are
 * assembled from these; no screen reaches for a raw colour, radius or shadow.
 *
 * Layering, outermost first:
 *   brand/      identity - the dot and the loader (the logo itself is
 *               apps/web/brand/pingo-mark.svg)
 *   primitives/ interaction - buttons, fields, chips, toggles, surfaces
 *   icons/      one 24×24 rounded 2px-stroke family
 */

// Brand
export { PingoDot, type DotState, type PingoDotProps } from './brand/PingoDot.js';
export { PingoLoader, type PingoLoaderProps } from './brand/PingoLoader.js';

// Primitives
export {
  Button,
  IconButton,
  type ButtonProps,
  type ButtonSize,
  type ButtonVariant,
  type IconButtonProps,
} from './primitives/Button.js';
export { TextField, SearchField, type TextFieldProps } from './primitives/TextField.js';
export { Chip, ChipGroup, type ChipProps } from './primitives/Chip.js';
export { Toggle, type ToggleProps } from './primitives/Toggle.js';
export { Avatar, AvatarStack, type AvatarProps, type AvatarSize } from './primitives/Avatar.js';
export {
  Card,
  GlassPanel,
  Badge,
  type BadgeProps,
  type CardProps,
  type GlassPanelProps,
} from './primitives/Surface.js';
export { ListRow, ListGroup, type ListRowProps } from './primitives/ListRow.js';
export {
  Skeleton,
  ConversationSkeleton,
  ThreadSkeleton,
  ScreenSkeleton,
  LoadingState,
  EmptyState,
  type EmptyStateProps,
  type SkeletonProps,
} from './primitives/Feedback.js';

// Icons
export * from './icons/index.js';

// Utilities
export { cn } from './utils/cn.js';
export { initials, variantFromSeed } from './utils/text.js';
