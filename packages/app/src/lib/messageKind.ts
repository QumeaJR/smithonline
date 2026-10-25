/**
 * Refusals said by text that a function returns instead of setting the
 * message itself (the S-Plot actions, the store's own limits): the function
 * marks its refusal with `refusal(text)`, and the store sets the message's
 * error flag when that text is shown. Callers that set a message directly say
 * `setMessage(text, { error: true })`.
 */
const refused = new Set<string>();
/** Enough for every refusal of a session; the oldest go first beyond it. */
const KEEP = 200;

/** Mark a text as a refusal and return it, for a `return refusal(...)`. */
export function refusal(text: string): string {
  if (refused.size >= KEEP) {
    const oldest = refused.values().next();
    if (!oldest.done) refused.delete(oldest.value);
  }
  refused.add(text);
  return text;
}

/** Whether a text was marked as a refusal. */
export function isRefusal(text: string | null | undefined): boolean {
  return typeof text === 'string' && refused.has(text);
}
