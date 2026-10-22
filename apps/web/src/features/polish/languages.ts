import { franc } from 'franc-min';

/** What the translate picker offers. `name` is what the model is told. */
export const TRANSLATE_TARGETS: { code: string; name: string; native: string }[] = [
  { code: 'en', name: 'English', native: 'English' },
  { code: 'hi', name: 'Hindi', native: 'हिन्दी' },
  { code: 'hinglish', name: 'Hinglish (Hindi in English letters)', native: 'Hinglish' },
  { code: 'es', name: 'Spanish', native: 'Español' },
  { code: 'fr', name: 'French', native: 'Français' },
  { code: 'de', name: 'German', native: 'Deutsch' },
  { code: 'pt', name: 'Portuguese', native: 'Português' },
  { code: 'ar', name: 'Arabic', native: 'العربية' },
  { code: 'ja', name: 'Japanese', native: '日本語' },
  { code: 'ko', name: 'Korean', native: '한국어' },
  { code: 'zh', name: 'Chinese', native: '中文' },
  { code: 'ru', name: 'Russian', native: 'Русский' },
  { code: 'tr', name: 'Turkish', native: 'Türkçe' },
  { code: 'bn', name: 'Bengali', native: 'বাংলা' },
  { code: 'ta', name: 'Tamil', native: 'தமிழ்' },
  { code: 'te', name: 'Telugu', native: 'తెలుగు' },
  { code: 'mr', name: 'Marathi', native: 'मराठी' },
  { code: 'gu', name: 'Gujarati', native: 'ગુજરાતી' },
  { code: 'pa', name: 'Punjabi', native: 'ਪੰਜਾਬੀ' },
  { code: 'ur', name: 'Urdu', native: 'اردو' },
  { code: 'id', name: 'Indonesian', native: 'Indonesia' },
  { code: 'it', name: 'Italian', native: 'Italiano' },
  { code: 'nl', name: 'Dutch', native: 'Nederlands' },
];

export function targetName(code: string): string {
  return TRANSLATE_TARGETS.find((t) => t.code === code)?.name ?? code;
}

/** Common Hinglish words. Latin-letter Hindi is what people here type, not a foreign language. */
const HINGLISH =
  /\b(hai|hain|nahi|nahin|kya|kyu|kyun|kaise|kaisa|kab|kahan|bhai|bro|yaar|yar|acha|accha|theek|thik|mera|meri|tera|teri|tum|tumhe|aap|hum|ham|kar|karo|kro|kerna|karna|rha|raha|rhi|rahi|hoga|hogi|wala|wali|bhi|toh|to|abhi|kal|aaj|bas|sab|kuch|mujhe|mereko|tujhe|isse|usse|lekin|par|aur|ka|ke|ki|se|me|mein|ko|ho|tha|thi)\b/gi;

/** Scripts that are plainly not English, and not Hindi-in-Latin. */
const SCRIPTS: [RegExp, string][] = [
  [/[ऀ-ॿ]/u, 'hi'],
  [/[ঀ-৿]/u, 'bn'],
  [/[਀-੿]/u, 'pa'],
  [/[઀-૿]/u, 'gu'],
  [/[஀-௿]/u, 'ta'],
  [/[ఀ-౿]/u, 'te'],
  [/[؀-ۿ]/u, 'ar'],
  [/[぀-ヿ]/u, 'ja'],
  [/[가-힯]/u, 'ko'],
  [/[一-鿿]/u, 'zh'],
  [/[Ѐ-ӿ]/u, 'ru'],
];

/** franc's ISO 639-3 to the codes above, for the Latin-script languages worth offering a translation for. */
const LATIN: Record<string, string> = {
  spa: 'es', fra: 'fr', deu: 'de', por: 'pt', tur: 'tr', ind: 'id', ita: 'it', nld: 'nl',
};

/**
 * The language of a message when it is not English or Hinglish, otherwise nothing.
 *
 * Local and instant, so it can run on every message in a list. Short text is
 * left alone: three words are not enough to tell, and a wrong "Translate" under
 * a plain message is worse than a missing one.
 */
export function foreignLanguage(text: string): string | undefined {
  const t = text.trim();
  if (t.length < 4) return undefined;

  const letters = t.replace(/[^\p{L}]/gu, '');
  if (letters.length < 3) return undefined;
  for (const [pattern, code] of SCRIPTS) {
    if (pattern.test(t)) return code;
  }

  if (t.length < 24) return undefined;
  const hinglish = t.match(HINGLISH)?.length ?? 0;
  if (hinglish >= 2) return undefined;

  const guess = franc(t, { minLength: 24 });
  return LATIN[guess] && LATIN[guess] !== 'en' ? LATIN[guess] : undefined;
}
