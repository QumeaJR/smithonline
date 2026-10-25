import type { FieldParse } from '@smithonline/core';
import { useDesignStore } from '../store/useDesignStore';

/** A refused parse, as parseFieldValue returns it. */
type FieldRefusalOf = Extract<FieldParse, { ok: false }>;

/** The refusal message on show, so the next accepted entry clears it and nothing else. */
let shown: string | null = null;
/** The name of the field that said it. */
let owner: string | null = null;

/** The typed text as the message quotes it: trimmed, and a long paste cut short. */
function quote(typed: string): string {
  const t = typed.trim();
  return t.length > 24 ? `${t.slice(0, 23)}…` : t;
}

/**
 * Say in the status bar why an entry was refused, in one pattern that repeats
 * what was typed: `f: "abc" is not a number`, `f: "-5" is below the minimum
 * 1 Hz`, `f: "5 F" has the wrong unit (Hz)`. Returns the message.
 */
export function sayRefusal(name: string, typed: string, reason: string): string {
  owner = name;
  const message = `${name}: "${quote(typed)}" ${reason}`;
  shown = message;
  useDesignStore.getState().setMessage(message, { error: true });
  return message;
}

/**
 * An entry was accepted, or a field reverted with Escape: a refusal message still on show has
 * served its purpose. With a name, only that field's own refusal is cleared, so reverting
 * one field leaves the refusal of another on show.
 */
export function clearRefusal(name?: string): void {
  if (name !== undefined && name !== owner) return;
  if (shown !== null && useDesignStore.getState().message === shown) {
    useDesignStore.getState().setMessage(null);
  }
  shown = null;
  owner = null;
}

/**
 * The reason for a refused parse: not a number (with the decimal point spelt
 * out when a decimal comma was typed), the wrong unit, or a text with two
 * readings, named both: `is ambiguous (2 fF or 2 F?)`, `is ambiguous (mHz or
 * MHz)`, and in a metre field `is ambiguous (write 1.5 mm or 1.5 m)`.
 */
export function parseRefusal(refusal: FieldRefusalOf, typed: string, unit: string): string {
  if (refusal.reason === 'ambiguous') {
    if (refusal.readings) {
      const [prefixed, plain] = refusal.readings;
      return unit === 'm'
        ? `is ambiguous (write ${prefixed} or ${plain})`
        : `is ambiguous (${prefixed} or ${plain}?)`;
    }
    const word = refusal.unit.charAt(0).toUpperCase() + refusal.unit.slice(1);
    return `is ambiguous (m${word} or M${word})`;
  }
  if (refusal.reason === 'unit') return `has the wrong unit (${unit || 'a plain number'})`;
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
