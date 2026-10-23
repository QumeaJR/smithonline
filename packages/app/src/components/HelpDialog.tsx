import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { GUIDE, GUIDE_SECTIONS } from '../lib/guide';
import type { Block, Inline } from '../lib/markdown';
import { useHelp } from '../store/useHelp';

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
        // links to a section are handled by the text panel's click handler, which scrolls it
        return p.href.startsWith('#') ? (
          <a key={i} href={p.href}>
            {renderInline(p.children)}
          </a>
        ) : (
          <a key={i} href={p.href} target="_blank" rel="noopener noreferrer">
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
  const dialog = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<string>(GUIDE_SECTIONS[0]?.id ?? '');

  /** Scroll the text so a section starts at the top of the panel. */
  const jump = (id: string): void => {
    const el = body.current?.querySelector<HTMLElement>(`#${CSS.escape(anchorId(id))}`);
    if (!el || !body.current) return;
    // the text panel is the offset parent of its headings
    body.current.scrollTo({ top: el.offsetTop - 4 });
    setActive(id);
  };

  // Take the focus so the arrow and page keys scroll the text; give it back when closing.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => before?.focus?.();
  }, []);

  useEffect(() => {
    if (startAt) jump(startAt);
    // only when the dialog opens at a section
  }, [startAt]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

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
    <div className="modal-backdrop" onPointerDown={onClose}>
      <div
        ref={dialog}
        className="modal help"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-title"
        tabIndex={-1}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="tool-head">
          <strong id="help-title">Help</strong>
          <span className="muted">F1 or ? opens and closes it</span>
          <button className="btn tiny" onClick={onClose} aria-label="Close help">
            &#215;
          </button>
        </div>
        <div className="help-layout">
          <nav className="help-toc" aria-label="Contents">
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
            onScroll={onScroll}
            onClick={(e) => {
              const a = (e.target as HTMLElement).closest('a');
              const href = a?.getAttribute('href');
              if (href?.startsWith('#')) {
                e.preventDefault();
                jump(href.slice(1).replace(/^help-/, ''));
              }
            }}
          >
            {GUIDE.map((b, i) => renderBlock(b, i))}
          </div>
        </div>
      </div>
    </div>
  );
}
