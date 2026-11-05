/**
 * The "PINGO Feedback" profile: the other side of the operator's feedback chat.
 *
 * It exists so that chat is an ordinary chat with a name, and it is not a
 * person to look up: it never reads or replies, so it is kept out of people
 * search. The same id is made by `pingo_feedback_user_id()` in the database
 * (20261126000002_master_feedback.sql).
 */
export const PINGO_FEEDBACK_USER_ID = 'a1000000-0000-4000-8000-0000000000f1';
