import { useFeedback } from './feedback';
import { track, trackDynamic } from './analytics/track';
import { designFromXmlsc } from './design';
import { EXAMPLES } from './examples';
import { refusal } from './messageKind';
import { TOURS } from './tours';
import { isShipped } from './workflowKit';
import { WORKFLOWS } from './workflows';
import { useDesignStore, type View } from '../store/useDesignStore';
import { useHelp } from '../store/useHelp';
import { useTourStore } from '../store/useTourStore';

/**
 * Links in the user guide that do something in the application instead of
 * going to a page, written as ordinary Markdown links:
 *
 * - `tour:l-network` starts a guided tour (a lesson),
 * - `workflow:robust` starts a guided workflow (docs/09),
 * - `example:Example5.xmlsc` loads a Smith V4.1 example, optionally on a view
 *   (`example:Example16.xmlsc?view=response`),
 * - `view:response` switches to the Smith chart, Response or S-Plot view,
 * - `feedback:` opens Send feedback (docs/10 section 3.1).
 */
export type GuideTarget =
  | { readonly kind: 'tour'; readonly id: string }
  | { readonly kind: 'workflow'; readonly id: string }
  | { readonly kind: 'example'; readonly file: string; readonly view: View | null }
  | { readonly kind: 'view'; readonly view: View }
  | { readonly kind: 'feedback' };

const VIEWS: readonly View[] = ['chart', 'response', 'splot'];
const asView = (v: string | null | undefined): View | null => VIEWS.find((x) => x === v) ?? null;

/** What a guide link asks for, or null when it names nothing the application has. */
export function parseTarget(href: string): GuideTarget | null {
  if (/^feedback:(open)?$/i.test(href.trim())) return { kind: 'feedback' };
  const m = /^(tour|workflow|example|view):([^?]+)(?:\?view=(\w+))?$/i.exec(href.trim());
  if (!m) return null;
  const [, rawScheme = '', name = '', viewName] = m;
  const scheme = rawScheme.toLowerCase();
  // only an example takes a view in its query
  if (scheme !== 'example' && viewName !== undefined) return null;
  if (scheme === 'tour')
    return TOURS.some((t) => t.id === name) ? { kind: 'tour', id: name } : null;
  if (scheme === 'workflow')
    return WORKFLOWS.some((w) => w.id === name && isShipped(w))
      ? { kind: 'workflow', id: name }
      : null;
  if (scheme === 'view') {
    const view = asView(name);
    return view ? { kind: 'view', view } : null;
  }
  if (!EXAMPLES.some((e) => e.file === name)) return null;
  if (viewName !== undefined && !asView(viewName)) return null;
  return { kind: 'example', file: name, view: asView(viewName) };
}

/** Do what the link asks; returns the status line to show, or null when there was nothing to do. */
export function runTarget(target: GuideTarget): string | null {
  track('help', 'try_link');
  const store = useDesignStore.getState();
  if (target.kind === 'tour') {
    useTourStore.getState().start(target.id);
    return null; // a tour sets its own status message
  }
  if (target.kind === 'workflow') {
    useTourStore.getState().startWorkflow(target.id);
    return null; // a workflow sets its own status message
  }
  if (target.kind === 'view') {
    store.setView(target.view);
    return null;
  }
  if (target.kind === 'feedback') {
    // From Help's guide: Feedback returns there when it closes.
    const help = useHelp.getState();
    useFeedback
      .getState()
      .openFeedback(
        help.open ? { section: 'feedback-and-privacy', helpReturn: help.returnTo } : undefined,
      );
    return null;
  }
  const example = EXAMPLES.find((e) => e.file === target.file);
  if (!example) return null;
  try {
    // Named as the Examples menu names the same step ("Loaded Example 5").
    store.loadDesign(designFromXmlsc(example.xml, example.title), `Loaded ${example.title}`);
    trackDynamic('example', example.file.replace(/\.xmlsc$/, ''));
    store.setView(target.view ?? 'chart');
    return `Loaded ${example.title}. Undo brings your previous design back.`;
  } catch (err) {
    return refusal(
      `Could not load ${example.file}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
