const KEY = 'pingo:translateTarget';

/** The language picked last time, so the picker opens on it. English until chosen. */
export function lastTarget(): string {
  try {
    return localStorage.getItem(KEY) || 'en';
  } catch {
    return 'en';
  }
}

export function rememberTarget(code: string): void {
  try {
    localStorage.setItem(KEY, code);
  } catch {
    // private mode
  }
}
