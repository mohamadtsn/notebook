/**
 * Arabic (0600-06FF), Arabic Supplement (0750-077F), Arabic Extended-A
 * (08A0-08FF), and the two presentation-form blocks (FB50-FDFF, FE70-FEFF).
 * Written as escapes so the ranges survive editors, diffs, and linters.
 */
const RTL_REGEX = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

export function detectDirection(text: string): 'rtl' | 'ltr' {
  for (const char of text) {
    if (RTL_REGEX.test(char)) return 'rtl';
    if (/[a-zA-Z]/.test(char)) return 'ltr';
  }
  // Persian-first: with no strong character yet, assume the user is writing Persian.
  return 'rtl';
}
