/**
 * The operator: one account, by id.
 *
 * It was the username `piuxxh`, and a username is a label anybody can take
 * once it is free - on 2026-10-03 the operator renamed and a new account
 * picked the old name up, Controlling and all. The server rules check the
 * same id (`public.is_operator()`, 20261020000000); this only decides what
 * the app shows.
 */
export const OPERATOR_ID = 'f32129ea-9ecd-4e56-a67c-d9837e9e2cc2';

export function isOperator(userId: string | null | undefined): boolean {
  return userId === OPERATOR_ID;
}
