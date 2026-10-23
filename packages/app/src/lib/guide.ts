// The user guide is read straight from docs/, the one source of truth; Vite inlines it at build time.
import guideSource from '../../../../docs/06-user-guide.md?raw';
import { headingsOf, parseMarkdown, type Block, type Heading } from './markdown';

export const GUIDE_SOURCE: string = guideSource;
export const GUIDE: readonly Block[] = parseMarkdown(guideSource);
/** The numbered sections (the second level headings), for the table of contents. */
export const GUIDE_SECTIONS: readonly Heading[] = headingsOf(GUIDE, 2).filter((h) => h.level === 2);
