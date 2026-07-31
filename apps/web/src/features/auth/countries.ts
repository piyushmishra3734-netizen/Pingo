/**
 * Country dial codes for the § 6.2 selector.
 *
 * A curated list, not the full ITU set. The complete table is ~250 entries and
 * needs per-country number metadata to be worth having; this covers the regions
 * the product is being built for and anything missing is a one-line addition.
 *
 * Flags are derived from the ISO code rather than stored, because a regional
 * indicator pair *is* the flag - `IN` → 🇮🇳. Storing the emoji separately would
 * let the two drift.
 */

export interface Country {
  /** ISO 3166-1 alpha-2. */
  code: string;
  name: string;
  /** Including the leading `+`. */
  dial: string;
}

export const COUNTRIES: Country[] = [
  { code: 'IN', name: 'India', dial: '+91' },
  { code: 'US', name: 'United States', dial: '+1' },
  { code: 'GB', name: 'United Kingdom', dial: '+44' },
  { code: 'CA', name: 'Canada', dial: '+1' },
  { code: 'AU', name: 'Australia', dial: '+61' },
  { code: 'DE', name: 'Germany', dial: '+49' },
  { code: 'FR', name: 'France', dial: '+33' },
  { code: 'ES', name: 'Spain', dial: '+34' },
  { code: 'IT', name: 'Italy', dial: '+39' },
  { code: 'NL', name: 'Netherlands', dial: '+31' },
  { code: 'IE', name: 'Ireland', dial: '+353' },
  { code: 'SE', name: 'Sweden', dial: '+46' },
  { code: 'NO', name: 'Norway', dial: '+47' },
  { code: 'DK', name: 'Denmark', dial: '+45' },
  { code: 'PL', name: 'Poland', dial: '+48' },
  { code: 'PT', name: 'Portugal', dial: '+351' },
  { code: 'CH', name: 'Switzerland', dial: '+41' },
  { code: 'AE', name: 'United Arab Emirates', dial: '+971' },
  { code: 'SA', name: 'Saudi Arabia', dial: '+966' },
  { code: 'SG', name: 'Singapore', dial: '+65' },
  { code: 'MY', name: 'Malaysia', dial: '+60' },
  { code: 'ID', name: 'Indonesia', dial: '+62' },
  { code: 'PH', name: 'Philippines', dial: '+63' },
  { code: 'TH', name: 'Thailand', dial: '+66' },
  { code: 'VN', name: 'Vietnam', dial: '+84' },
  { code: 'JP', name: 'Japan', dial: '+81' },
  { code: 'KR', name: 'South Korea', dial: '+82' },
  { code: 'CN', name: 'China', dial: '+86' },
  { code: 'HK', name: 'Hong Kong', dial: '+852' },
  { code: 'NZ', name: 'New Zealand', dial: '+64' },
  { code: 'ZA', name: 'South Africa', dial: '+27' },
  { code: 'NG', name: 'Nigeria', dial: '+234' },
  { code: 'KE', name: 'Kenya', dial: '+254' },
  { code: 'EG', name: 'Egypt', dial: '+20' },
  { code: 'BR', name: 'Brazil', dial: '+55' },
  { code: 'MX', name: 'Mexico', dial: '+52' },
  { code: 'AR', name: 'Argentina', dial: '+54' },
  { code: 'BD', name: 'Bangladesh', dial: '+880' },
  { code: 'PK', name: 'Pakistan', dial: '+92' },
  { code: 'LK', name: 'Sri Lanka', dial: '+94' },
  { code: 'NP', name: 'Nepal', dial: '+977' },
];

/** `IN` → 🇮🇳, by offsetting each letter into the regional-indicator block. */
export function flagFor(code: string): string {
  return code
    .toUpperCase()
    .replace(/./g, (char) => String.fromCodePoint(127397 + char.charCodeAt(0)));
}

/**
 * The default country - § 6.2: **from device locale, never from IP.**
 *
 * IP reveals travel. Someone signing up from an airport should not have their
 * country quietly changed by where the plane landed, and the locale is the only
 * signal that reflects the user rather than their current network.
 */
export function defaultCountry(): Country {
  const fallback = COUNTRIES[0]!;

  try {
    const region = new Intl.Locale(navigator.language).region;
    return COUNTRIES.find((country) => country.code === region) ?? fallback;
  } catch {
    return fallback;
  }
}
