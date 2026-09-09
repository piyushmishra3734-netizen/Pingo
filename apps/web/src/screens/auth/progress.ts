/**
 * How full the progress bar is at each step.
 *
 * Fractions, not step numbers - [docs/01 § 2.1](../../../../../docs/01-onboarding-auth.md#21-global-rules-for-the-whole-flow)
 * rules out "3 of 7" because a count makes a short flow feel long.
 *
 * Sign-up by phone is **three** steps again, now that § 6.2's verification is
 * back: the number, the code, the password. Email is still two - there is no
 * code to answer - and both read from this table, so the bar is only ever
 * wrong in one place if it is wrong.
 *
 * The blueprint's bar spans the whole journey through Contacts, so these values
 * shift down when Profile Setup, Theme, Notifications and Contacts land - which
 * is why they are one shared table rather than a literal inside each screen.
 */
export const SIGNUP_PROGRESS = {
  identifier: 1 / 3,
  code: 2 / 3,
  password: 1,
} as const;

/**
 * Log-in is not onboarding and has no bar in the § 13 wireframes - a returning
 * user is doing one thing, not making progress through a flow.
 */
export const LOGIN_PROGRESS = undefined;
