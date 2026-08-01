/** Joins truthy class names. Not clsx — we only ever pass strings and falsy values. */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}