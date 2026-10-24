import { useHelp } from '../store/useHelp';

interface HelpLinkProps {
  /** Section id of the user guide, as `GUIDE_SECTIONS` lists them. */
  readonly section: string;
  /** What the section is about, for the tooltip and the accessible name. */
  readonly topic: string;
}

/** A small "?" next to a heading that opens the user guide at its section. */
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
      ?
    </button>
  );
}
