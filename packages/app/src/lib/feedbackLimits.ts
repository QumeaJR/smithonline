/**
 * The limits of Send feedback, shared by the app's dialog and the Worker
 * (docs/10 section 2.3), so the dialog never sends what the Worker refuses.
 * No imports: the Worker bundles this file.
 */

export const MESSAGE_MIN = 10;
export const MESSAGE_MAX = 4000;
export const EMAIL_MAX = 254;

/**
 * The largest design a feedback may carry, in characters of its share-link
 * payload: 256 KiB. A design keeps at most 2001 measured rows
 * (MAX_SWEEP_LOADS), about 150 KB in a share link, so every design the app
 * makes fits with room for the rest of it; the dialog still checks.
 */
export const MAX_DESIGN_CHARS = 256 * 1024;

/** The largest feedback body: the design, a message of 4000 characters in UTF-8 and the rest. */
export const MAX_FEEDBACK_BYTES = MAX_DESIGN_CHARS + 32 * 1024;
