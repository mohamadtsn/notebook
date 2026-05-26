const RTL_REGEX = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;

export function detectDirection(text: string): 'rtl' | 'ltr' {
  for (const char of text) {
    if (RTL_REGEX.test(char)) return 'rtl';
    if (/[a-zA-Z]/.test(char)) return 'ltr';
  }
  return 'rtl';
}