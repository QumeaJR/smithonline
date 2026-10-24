import { useHelp } from '../store/useHelp';
import { IconHelp } from './ui/icons';

interface HelpLinkProps {
  /** Section id of the user guide, as `GUIDE_SECTIONS` lists them. */
  readonly section: string;
  /** What the section is about, for the tooltip and the accessible name. */
  readonly topic: string;
}

/**
 * A small help icon next to a heading that opens the user guide at its
 * section: 16 px on a fine pointer, a 28 px hit area on a coarse one.
 */
export function HelpLink({ section, topic }: HelpLinkProps) {
  return (
    <button
      type="button"
      className="help-link"
      title={`Open the guide: ${topic}`}
      aria-label={`Help on ${topic}`}
      onClick={(e) => {
        e.stopPropagation();
        useHelp.getState().openHelp(section);
      }}
    >
      <IconHelp />
    </button>
  );
}
