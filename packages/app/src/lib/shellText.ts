import { formatEngineering, wattToDbm } from '@smithonline/core';
import type { Design } from './design';
import { stressSettings } from './stress';

/**
 * Whether a message text reads as an error or refusal. The sites that refuse
 * say so with `setMessage(text, { error: true })` or `refusal(text)`
 * (lib/messageKind.ts); this reading of the text is only the fallback for a
 * message set without the flag.
 */
export function isErrorMessage(text: string | null): boolean {
  if (!text) return false;
  return (
    /^(Could not|Refused|Cannot|Can't|Nothing is selected)\b/i.test(text) ||
    /: "[^"]*" (is not a number|has the wrong unit|is below|is above|is not above|is ambiguous)/.test(
      text,
    ) ||
    /is not a (load|number)/.test(text) ||
    / (must be at least|is limited to) /.test(text) ||
    /; remove one first\.?$/.test(text) ||
    / has no s\d\d\b/.test(text) ||
    / needs at least two points\b/.test(text) ||
    / is a \d+-port; /.test(text) ||
    /: no data$/.test(text)
  );
}

/**
 * An error or refusal on show: it stays on the phone as a banner until
 * dismissed (docs/07 section 4, Status), where other messages pass as a toast.
 */
export function messageIsError(state: {
  readonly message: string | null;
  readonly messageError: boolean;
}): boolean {
  return state.message !== null && (state.messageError || isErrorMessage(state.message));
}

/**
 * What the design chip says: "450 MHz · 50 Ω", and the source power when
 * one is set ("450 MHz · 50 Ω · 2 W", or in dBm when the power is typed in dBm).
 */
export function designChipText(design: Design): string {
  const parts = [
    formatEngineering(design.frequency, { unit: 'Hz', digits: 4 }),
    formatEngineering(design.z0, { unit: 'Ω', digits: 4 }),
  ];
  const stress = stressSettings(design);
  if (stress.power > 0) {
    parts.push(
      stress.unit === 'dBm'
        ? `${Number(wattToDbm(stress.power).toPrecision(4))} dBm`
        : formatEngineering(stress.power, { unit: 'W', digits: 4 }),
    );
  }
  return parts.join(' · ');
}
