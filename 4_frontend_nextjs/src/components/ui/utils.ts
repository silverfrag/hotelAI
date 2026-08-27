export type ClassValue = string | number | null | false | undefined | ClassValue[];

/**
 * Minimal, dependency-free className combiner.
 * Later classes are appended after earlier ones, so caller-supplied
 * `className` should be passed last to win in the cascade.
 */
export function cn(...inputs: ClassValue[]): string {
  const out: string[] = [];
  const walk = (value: ClassValue) => {
    if (value === null || value === undefined || value === false || value === '') return;
    if (Array.isArray(value)) {
      value.forEach(walk);
    } else {
      out.push(String(value));
    }
  };
  inputs.forEach(walk);
  return out.join(' ');
}
