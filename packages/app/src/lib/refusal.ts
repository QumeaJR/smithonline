import type { FieldRefusal } from '@smithonline/core';
import { useDesignStore } from '../store/useDesignStore';

/** The refusal message on show, so the next accepted entry clears it and nothing else. */
let shown: string | null = null;

/** The typed text as the message quotes it: trimmed, and a long paste cut short. */
function quote(typed: string): string {
  const t = typed.trim();
  return t.length > 24 ? `${t.slice(0, 23)}…` : t;
}

/**
 * Say in the status bar why an entry was refused, in one pattern that repeats
 * what was typed: `f: "abc" is not a number`, `f: "-5" is below the minimum
 * 1 Hz`, `f: "5 F" has the wrong unit (Hz)`.
 */
export function sayRefusal(name: string, typed: string, reason: string): void {
  shown = `${name}: "${quote(typed)}" ${reason}`;
  useDesignStore.getState().setMessage(shown);
}

/** An entry was accepted: a refusal message still on show has served its purpose. */
export function clearRefusal(): void {
  if (shown !== null && useDesignStore.getState().message === shown) {
    useDesignStore.getState().setMessage(null);
  }
  shown = null;
}

/**
 * The reason for a refused parse: not a number (with the decimal point spelt
 * out when a decimal comma was typed), the wrong unit, or milli and mega that
 * cannot be told apart.
 */
export function parseRefusal(
  reason: FieldRefusal,
  typed: string,
  typedUnit: string,
  unit: string,
): string {
  if (reason === 'ambiguous') {
    const word = typedUnit.charAt(0).toUpperCase() + typedUnit.slice(1);
    return `is ambiguous (m${word} or M${word})`;
  }
  if (reason === 'unit') return `has the wrong unit (${unit || 'a plain number'})`;
  if (/\d,\d/.test(typed)) {
    return `is not a number (use a decimal point: ${quote(typed).replace(/(\d),(?=\d)/g, '$1.')})`;
  }
  return 'is not a number';
}

/**
 * Whether an Escape belongs to a value field with typed text: the field reverts
 * it, so a dialog listening in the capture phase leaves this Escape alone and
 * closes on the next one.
 */
export function isFieldEscape(e: KeyboardEvent): boolean {
  return e.target instanceof HTMLElement && e.target.hasAttribute('data-editing');
}
