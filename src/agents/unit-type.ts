const WORD_NUMBERS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };

/**
 * Turns the many spellings of a unit type ("2 bed", "2BR", "two bedroom", "2 BHK") into one value: "studio" or "<n>BHK".
 * Text that is not recognisable as a unit type is returned trimmed and unchanged.
 */
export function normalizeUnitType(text: string): string {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  if (/\bstudio\b/.test(lower)) return "studio";
  const digits = /\b(\d)\s*[- ]?\s*(?:bhk|br|bd|bed(?:room)?s?|b\/r|bhk)\b/.exec(lower) ?? /^(\d)\s*(?:bhk|br|bd)$/.exec(lower);
  if (digits) return `${digits[1]}BHK`;
  const word = /\b(one|two|three|four|five|six|seven|eight|nine)[\s-]*(?:bed(?:room)?s?|br|bhk)\b/.exec(lower);
  if (word) return `${WORD_NUMBERS[word[1]!]}BHK`;
  return trimmed;
}
