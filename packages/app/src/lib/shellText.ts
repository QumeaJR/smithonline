import { formatEngineering, wattToDbm } from '@smithonline/core';
import type { Design } from './design';
import { stressSettings } from './stress';

/**
 * An error or refusal: it stays on the phone as a banner until dismissed
 * (docs/07 section 4, Status), where other messages pass as a toast.
 */
export function isErrorMessage(text: string | null): boolean {
  if (!text) return false;
  return (
    /^(Could not|Refused|Cannot|Can't)\b/i.test(text) ||
    /: "[^"]*" (is not a number|has the wrong unit|is below|is above|is ambiguous)/.test(text) ||
    /is not a (load|number)/.test(text)
  );
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
