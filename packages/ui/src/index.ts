/**
 * @pingo/ui — the PINGO component library.
 *
 * Every component here is a direct expression of the branding board. Screens are
 * assembled from these; no screen reaches for a raw colour, radius or shadow.
 *
 * Layering, outermost first:
 *   brand/      identity — the monogram, wordmark, app icon, the dot
 *   primitives/ interaction — buttons, fields, chips, toggles, surfaces
 *   icons/      one 24×24 rounded 2px-stroke family
 */

// Brand
export { PingoMark, markGeometry, type PingoMarkProps } from './brand/PingoMark.js';
export { PingoDot, type DotState, type PingoDotProps } from './brand/PingoDot.js';
export {
  PingoMarkState,
  type MarkState,
  type PingoMarkStateProps,
} from './brand/PingoMarkState.js';
export { Wordmark, Tagline, type WordmarkProps } from './brand/Wordmark.js';
export { PingoLoader, type PingoLoaderProps } from './brand/PingoLoader.js';
export { AppIcon, type AppIconProps, type AppIconVariant } from './brand/AppIcon.js';

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
