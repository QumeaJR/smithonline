/**
 * The kind of a file and of a refusal, as the usage counts name them (docs/10
 * section 1.3). Only these closed names are sent: never the file name.
 */
import type { EventA, EventB } from './schema';
import { track } from './track';

/** The format by the file's extension. */
export function importFormat(fileName: string): EventA<'import'> {
  const ext = /\.([a-z0-9]+)$/i.exec(fileName)?.[1]?.toLowerCase() ?? '';
  if (ext === 's1p' || ext === 's2p' || ext === 's3p' || ext === 's4p') return ext;
  if (ext === 'citi' || ext === 'cti') return 'citi';
  if (ext === 'csv' || ext === 'txt' || ext === 'xmlsc' || ext === 'json') return ext;
  if (ext === 'ez' || ext === 'eznec') return 'eznec';
  return 'other';
}

/** The reader that refused a file, by its format. */
export function readerOf(fileName: string): EventA<'refused'> {
  const f = importFormat(fileName);
  if (f === 's1p' || f === 's2p' || f === 's3p' || f === 's4p') return 'touchstone';
  if (f === 'citi' || f === 'xmlsc' || f === 'json' || f === 'eznec') return f;
  return 'csv';
}

/** The reason of a refusal from its message (the message itself is never sent). */
export function refusalReason(message: string): EventB<'refused'> {
  const m = message.toLowerCase();
  if (/option line/.test(m)) return 'bad_option_line';
  if (/too large|larger than|\bmb\b|at most/.test(m)) return 'too_large';
  if (/no (usable )?frequenc|frequency column|without a frequency/.test(m)) return 'no_frequency';
  if (/s-?parameter|s11|no impedance/.test(m)) return 'no_sparams';
  if (/(two|enough|too few).*(rows|points)|(rows|points).*(two|enough)/.test(m)) {
    return 'too_few_rows';
  }
  if (/not supported|unsupported|ports?\b.*(three|four|3|4)/.test(m)) return 'unsupported';
  return 'parse';
}

/** A file was read and used: where it went. */
export function countImport(fileName: string, to: EventB<'import'>): void {
  track('import', importFormat(fileName), to, 'ok');
}

/** A file was refused: its format, where it was going, and why. */
export function countRefused(fileName: string, to: EventB<'import'>, message: string): void {
  track('import', importFormat(fileName), to, 'refused');
  track('refused', readerOf(fileName), refusalReason(message));
}
