import { EyeIcon, EyeOffIcon, TextField, cn } from '@pingo/ui';
import { useRef, useState, type PointerEvent, type Ref } from 'react';

/**
 * A password field with the reveal control from
 * [docs/01 § 8](../../../../../docs/01-onboarding-auth.md#8-create-password).
 *
 * The blueprint asks for two different gestures on the same control: **held to
 * reveal on touch, toggled on desktop.** That is not a quirk — on a phone the
 * password is exposed to whoever is standing behind you, so it should be visible
 * only while a thumb is deliberately holding it there. With a mouse, holding a
 * button while typing with the other hand is impossible, so it toggles.
 *
 * `pointerType` tells the two apart at the moment of interaction, which is more
 * reliable than a media query — a touchscreen laptop is both.
 *
 * There is deliberately **no confirm field** (§ 8.1).
 */

export interface PasswordFieldProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  /** `new-password` on sign-up, `current-password` on log-in. */
  autoComplete: 'new-password' | 'current-password';
  invalid?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  onSubmit?: () => void;
  /** For returning focus to a rejected password with its content selected (§ 13.2). */
  inputRef?: Ref<HTMLInputElement>;
}

export function PasswordField({
  value,
  onChange,
  label = 'Password',
  autoComplete,
  invalid = false,
  disabled = false,
  autoFocus = false,
  onSubmit,
  inputRef,
}: PasswordFieldProps) {
  const [revealed, setRevealed] = useState(false);
  // Set on pointerdown so pointerup knows which gesture it is completing.
  const heldRef = useRef(false);

  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === 'touch' || event.pointerType === 'pen') {
      heldRef.current = true;
      setRevealed(true);
    }
  };

  const endHold = () => {
    if (heldRef.current) {
      heldRef.current = false;
      setRevealed(false);
    }
  };

  const handleClick = () => {
    // A touch reveal already ended on pointerup; the click that follows must
    // not toggle it back on.
    if (heldRef.current) return;
    setRevealed((shown) => !shown);
  };

  return (
    <TextField
      label={label}
      inputRef={inputRef}
      type={revealed ? 'text' : 'password'}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      autoComplete={autoComplete}
      autoFocus={autoFocus}
      disabled={disabled}
      invalid={invalid}
      spellCheck={false}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && onSubmit) onSubmit();
      }}
      trailing={
        <button
          type="button"
          onPointerDown={handlePointerDown}
          onPointerUp={endHold}
          onPointerCancel={endHold}
          onPointerLeave={endHold}
          onClick={handleClick}
          // The label names the action, and it is the same action either way.
          aria-label={revealed ? 'Hide password' : 'Show password'}
          aria-pressed={revealed}
          className={cn(
            'grid size-8 place-items-center rounded-full',
            'focus-ring text-text-secondary',
            'transition-colors duration-instant ease-standard',
            'hover:bg-hover hover:text-ink',
          )}
        >
          {revealed ? <EyeOffIcon size={18} /> : <EyeIcon size={18} />}
        </button>
      }
    />
  );
}
