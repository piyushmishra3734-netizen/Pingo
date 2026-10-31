/**
 * The outdated-version gate, on the app's side.
 *
 * Every database request carries `x-pingo-gen: CLIENT_GENERATION`. When the
 * operator turns the gate on (`app_gate.min_gen`, Settings > Controlling), the
 * database refuses any app below it with `PINGO_UPDATE_REQUIRED` - see
 * `20261119000002_outdated_app_gate.sql`. This notices that answer and tells
 * the app, which then shows the update screen instead of failing everywhere
 * one request at a time (`UpdateRequired`).
 *
 * Raise CLIENT_GENERATION only in the build that should outlive the ones
 * before it, and only then raise the gate to match.
 */

export const CLIENT_GENERATION = 1;

const EVENT = 'pingo:update-required';
let required = false;

export function isUpdateRequired(): boolean {
  return required;
}

export function onUpdateRequired(listener: () => void): () => void {
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}

function announce(): void {
  if (required) return;
  required = true;
  window.dispatchEvent(new Event(EVENT));
}

/**
 * Wraps fetch: a refused request is passed on unchanged, and the refusal is
 * announced once. Only error responses are read, from a clone, so a normal
 * response costs nothing.
 */
export function watchForUpdateRequired(inner: typeof fetch): typeof fetch {
  return async (input, init) => {
    const response = await inner(input, init);
    if (response.status >= 400 && !required) {
      void response
        .clone()
        .text()
        .then((body) => {
          if (body.includes('PINGO_UPDATE_REQUIRED')) announce();
        })
        .catch(() => undefined);
    }
    return response;
  };
}
