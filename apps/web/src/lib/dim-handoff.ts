/**
 * One dim handed to the next, without a flash in between.
 *
 * Delete, Info and Edit are chosen from the message menu, which dims the chat,
 * and each opens a sheet that dims it again. The menu's dim vanished at once
 * while the sheet's faded in from nothing, so for a frame or two the chat lit
 * up at full brightness between them - on a phone, a flash on every one of
 * those actions.
 *
 * The menu says when it is up and when it goes; a sheet opened while it is up,
 * or just after, starts already dimmed instead of fading in. "While it is up"
 * matters: the sheet usually renders in the same commit that removes the menu,
 * before the menu's cleanup has run.
 */
let open = 0;
let closedAt = 0;

/** Called by whatever dims the screen, as it appears. Returns the matching close. */
export function holdDim(): () => void {
  open += 1;
  return () => {
    open -= 1;
    closedAt = Date.now();
  };
}

/** True while a dim is up or went away a moment ago, so the next one should not fade in. */
export function dimJustClosed(): boolean {
  return open > 0 || Date.now() - closedAt < 500;
}
