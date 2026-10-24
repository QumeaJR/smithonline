// The user guide is read straight from docs/, the one source of truth; Vite inlines it at build time.
import guideSource from '../../../../docs/06-user-guide.md?raw';
import { EXAMPLES } from './examples';
import { headingsOf, parseMarkdown, type Block, type Heading } from './markdown';
import { TOURS } from './tours';

export const GUIDE_SOURCE: string = guideSource;

/** The closing section of the dialog: every tour and example as a link that loads it. */
export const INDEX_TITLE = 'Tour and example index';
export const INDEX_SOURCE: string = [
  `## ${INDEX_TITLE}`,
  '',
  'Each entry loads into the application and closes this window. Undo brings your previous design back.',
  '',
  '**Guided tours**',
  '',
  ...TOURS.map((t) => `- [${t.title}](tour:${t.id}): ${t.blurb}`),
  '',
  '**Smith V4.1 examples**',
  '',
  ...EXAMPLES.map((e) => `- [${e.title}](example:${e.file}): ${e.description}`),
  '',
  '**Views**',
  '',
  '- [Smith chart](view:chart), [Response](view:response), [S-Plot](view:splot)',
].join('\n');

export const GUIDE: readonly Block[] = parseMarkdown(`${guideSource}\n\n${INDEX_SOURCE}`);
/** The sections (the second level headings), for the table of contents. */
export const GUIDE_SECTIONS: readonly Heading[] = headingsOf(GUIDE, 2).filter((h) => h.level === 2);
