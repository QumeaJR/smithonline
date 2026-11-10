/**
 * What a tool says when its Web Worker reports an error without a message: the worker's script
 * did not load, most often because a newer version replaced it on the server since the page opened.
 */
export const WORKER_NOT_LOADED =
  'The background worker did not load: SmithChart.Online may have been updated since this page opened. Reload the page and run it again (your design is kept).';
