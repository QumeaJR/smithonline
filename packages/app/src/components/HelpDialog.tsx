import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { GUIDE, GUIDE_SECTIONS } from '../lib/guide';
import { closeOtherDialogs } from '../lib/dialogs';
import { parseTarget, runTarget } from '../lib/helpActions';
import type { Block, Inline } from '../lib/markdown';
import { useDesignStore } from '../store/useDesignStore';
import { useHelp } from '../store/useHelp';
import { useShell } from '../store/useShell';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';

interface HelpDialogProps {
  readonly onClose: () => void;
}

const anchorId = (id: string): string => `help-${id}`;

function renderInline(parts: readonly Inline[]): ReactNode {
  return parts.map((p, i) => {
    switch (p.kind) {
      case 'text':
        return <Fragment key={i}>{p.text}</Fragment>;
      case 'code':
        return <code key={i}>{p.text}</code>;
      case 'bold':
        return <strong key={i}>{renderInline(p.children)}</strong>;
      case 'italic':
        return <em key={i}>{renderInline(p.children)}</em>;
      case 'link':
        // links to a section and the guide's own actions are handled by the text panel's click handler
        return /^(https?:|mailto:)/i.test(p.href) ? (
          <a key={i} href={p.href} target="_blank" rel="noopener noreferrer">
            {renderInline(p.children)}
          </a>
        ) : (
          <a key={i} href={p.href} className={p.href.startsWith('#') ? undefined : 'try'}>
            {renderInline(p.children)}
          </a>
        );
    }
  });
}

function renderBlock(b: Block, i: number): ReactNode {
  switch (b.kind) {
    case 'heading':
      // The dialog title is the page title, so the guide's own levels sit one step lower.
      return b.level === 1 ? (
        <h2 key={i} id={anchorId(b.id)} className="help-title">
          {renderInline(b.children)}
        </h2>
      ) : b.level === 2 ? (
        <h3 key={i} id={anchorId(b.id)}>
          {renderInline(b.children)}
        </h3>
      ) : (
        <h4 key={i} id={anchorId(b.id)}>
          {renderInline(b.children)}
        </h4>
      );
    case 'paragraph':
      return <p key={i}>{renderInline(b.children)}</p>;
    case 'list': {
      const items = b.items.map((item, j) => <li key={j}>{renderInline(item)}</li>);
      return b.ordered ? <ol key={i}>{items}</ol> : <ul key={i}>{items}</ul>;
    }
  }
}

/**
 * The user guide, rendered from docs/06-user-guide.md: a table of contents
 * built from its section headings beside the scrolling text. Escape and a
 * click outside close it; F1 does too.
 */
export function HelpDialog({ onClose }: HelpDialogProps) {
  const startAt = useHelp((s) => s.section);
  const body = useRef<HTMLDivElement>(null);
  const toc = useRef<HTMLElement>(null);
  const [active, setActive] = useState<string>(GUIDE_SECTIONS[0]?.id ?? '');
  const guideClosed = useShell((s) => s.guideClosed);

  /** Scroll the text so a section starts at the top of the panel. */
  const jump = (id: string): void => {
    const el = body.current?.querySelector<HTMLElement>(`#${CSS.escape(anchorId(id))}`);
    if (!el || !body.current) return;
    // the text panel is the offset parent of its headings
    body.current.scrollTo({ top: el.offsetTop - 4 });
    setActive(id);
  };

  // The contents is a short strip on a narrow window: keep the entry being read in view, by
  // scrolling the strip itself (scrollIntoView could move the page behind the dialog).
  useEffect(() => {
    const strip = toc.current;
    const on = strip?.querySelector<HTMLElement>('.on');
    if (!strip || !on) return;
    const top = on.offsetTop - strip.offsetTop;
    if (top < strip.scrollTop) strip.scrollTop = top;
    else if (top + on.offsetHeight > strip.scrollTop + strip.clientHeight) {
      strip.scrollTop = top + on.offsetHeight - strip.clientHeight;
    }
  }, [active]);

  useEffect(() => {
    if (startAt) jump(startAt);
    // only when the dialog opens at a section
  }, [startAt]);

  /** The section the text is scrolled to, for the highlight in the contents. */
  const onScroll = (): void => {
    const el = body.current;
    if (!el) return;
    let current = GUIDE_SECTIONS[0]?.id ?? '';
    for (const s of GUIDE_SECTIONS) {
      const h = el.querySelector<HTMLElement>(`#${CSS.escape(anchorId(s.id))}`);
      if (h && h.offsetTop <= el.scrollTop + 24) current = s.id;
    }
    setActive(current);
  };

  return (
    <Dialog
      title="Help"
      subtitle="F1 or ? opens and closes it"
      onClose={onClose}
      closeLabel="Close help"
      className="help"
      // The text takes the focus so the arrow and page keys scroll it.
      initialFocus={() => body.current}
      footer={
        guideClosed ? (
          <Button
            onClick={() => {
              useShell.getState().showGuide();
              useShell.getState().setPane('network');
              onClose();
              useDesignStore
                .getState()
                .setMessage('The start guide is back at the head of the network panel');
            }}
            title="Bring back the three steps of a match above the load card"
          >
            Show the start guide
          </Button>
        ) : undefined
      }
    >
      <div className="help-layout">
        <nav className="help-toc" aria-label="Contents" ref={toc}>
          <ol>
            {GUIDE_SECTIONS.map((s) => (
              <li key={s.id}>
                <button
                  className={`help-toc-item ${active === s.id ? 'on' : ''}`}
                  aria-current={active === s.id ? 'true' : undefined}
                  onClick={() => jump(s.id)}
                >
                  {s.text}
                </button>
              </li>
            ))}
          </ol>
        </nav>
        <div
          className="help-body"
          ref={body}
          tabIndex={-1}
          onScroll={onScroll}
          onClick={(e) => {
            const a = (e.target as HTMLElement).closest('a');
            const href = a?.getAttribute('href');
            const target = href ? parseTarget(href) : null;
            if (target) {
              e.preventDefault();
              // the dialogs under this one (Settings, Report, Dimensions) would hide what the link shows
              closeOtherDialogs();
              const note = runTarget(target);
              onClose();
              if (note) useDesignStore.getState().setMessage(note);
            } else if (href?.startsWith('#')) {
              e.preventDefault();
              jump(href.slice(1));
            } else if (href && !/^(https?:|mailto:)/i.test(href)) {
              // an own-scheme link that names nothing must not navigate the application away
              e.preventDefault();
            }
          }}
        >
          {GUIDE.map((b, i) => renderBlock(b, i))}
        </div>
      </div>
    </Dialog>
  );
}
