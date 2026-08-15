/**
 * Rupees in words, Indian numbering — "Rupees One Lakh Twenty Thousand Only".
 *
 * A printed bill states the amount twice, in figures and in words, because the
 * words are what settle an argument about a smudged digit. Grouping is
 * crore / lakh / thousand / hundred, not the Western millions, so this cannot
 * be delegated to Intl.
 *
 * Paise are rendered when present and dropped when the amount is whole, which
 * is how bills are written here — "and Fifty Paise Only" only appears if there
 * genuinely are fifty paise.
 */

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
];

const TENS = [
  "", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty",
  "Ninety",
];

/** 0–99. */
function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  const tens = TENS[Math.floor(n / 10)];
  const ones = ONES[n % 10];
  return ones ? `${tens} ${ones}` : tens;
}

/** 0–999. */
function threeDigits(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (hundreds) parts.push(`${ONES[hundreds]} Hundred`);
  if (rest) parts.push(twoDigits(rest));
  return parts.join(" ");
}

/** A whole number in the Indian grouping. */
export function numberToWords(value: number): string {
  const n = Math.floor(Math.abs(value));
  if (n === 0) return "Zero";

  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const rest = n % 1000;

  const parts: string[] = [];
  // Crores above 99 keep grouping in the same system rather than overflowing
  // into a bare number — 123 crore reads "One Hundred Twenty Three Crore".
  if (crore) parts.push(`${threeDigits(crore % 1000) || numberToWords(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (rest) parts.push(threeDigits(rest));
  return parts.join(" ");
}

/** The full line a bill prints under its total. */
export function rupeesInWords(value: unknown): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "";

  const negative = amount < 0;
  const abs = Math.abs(amount);
  // Rounded to paise first, so 0.005 does not print as zero paise while the
  // figure beside it shows one.
  const paise = Math.round(abs * 100) % 100;
  const rupees = Math.floor(Math.round(abs * 100) / 100);

  const words = [`Rupees ${numberToWords(rupees)}`];
  if (paise) words.push(`and ${twoDigits(paise)} Paise`);
  words.push("Only");
  return (negative ? "Minus " : "") + words.join(" ");
}
