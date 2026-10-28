import { useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';

export interface SegmentedOption<T extends string> {
  readonly value: T;
  readonly label: ReactNode;
  readonly title?: string;
  readonly disabled?: boolean;
  /** A guided workflow's anchor (docs/09). */
  readonly tour?: string;
}

export interface SegmentedProps<T extends string> {
  readonly options: readonly SegmentedOption<T>[];
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly ariaLabel: string;
  readonly size?: 'md' | 'sm';
  /** Let the segments wrap onto a second row where the container is narrow. */
  readonly wrap?: boolean;
  readonly className?: string;
  /** A radio group (a choice of order or mode) rather than tabs (a choice of view). */
  readonly radio?: boolean;
}

/**
 * A segmented control: one choice out of a few, shown side by side with a
 * thumb that slides to the chosen one (160 ms, none with reduced motion).
 * Role tablist (radiogroup with `radio`); the arrow keys, Home and End move the choice and
 * the focus, and only the chosen segment is in the tab order.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  size = 'md',
  wrap = false,
  className,
  radio = false,
}: SegmentedProps<T>) {
  const root = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLSpanElement>(null);

  // The thumb is placed by measuring the chosen segment; without a layout (server, tests) the
  // chosen segment keeps its own background instead.
  useLayoutEffect(() => {
    const host = root.current;
    const th = thumb.current;
    if (!host || !th) return;
    const place = (): void => {
      const on = host.querySelector<HTMLElement>('[aria-selected="true"], [aria-checked="true"]');
      if (!on || on.offsetWidth === 0) {
        host.classList.remove('ready');
        return;
      }
      // The first placement jumps; later ones slide.
      const first = !host.classList.contains('ready');
      if (first) th.style.transition = 'none';
      // Left and top both: a control that wraps onto two rows (Auto match) still works.
      th.style.width = `${on.offsetWidth}px`;
      th.style.height = `${on.offsetHeight}px`;
      th.style.transform = `translate(${on.offsetLeft}px, ${on.offsetTop}px)`;
      host.classList.add('ready');
      if (first) {
        void th.offsetWidth;
        th.style.transition = '';
      }
    };
    place();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(place);
    observer.observe(host);
    return () => observer.disconnect();
  }, [value, options]);

  const enabled = options.filter((o) => !o.disabled);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const at = enabled.findIndex((o) => o.value === value);
    let next: number | null = null;
    // A chosen value that is disabled or absent (at -1): the arrows start from either end.
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (at + 1) % enabled.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp')
      next = at < 0 ? enabled.length - 1 : (at - 1 + enabled.length) % enabled.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = enabled.length - 1;
    if (next === null || enabled.length === 0) return;
    e.preventDefault();
    const option = enabled[next];
    if (!option) return;
    if (option.value !== value) onChange(option.value);
    const tabs = root.current?.querySelectorAll<HTMLButtonElement>('[role="tab"], [role="radio"]');
    tabs?.[options.indexOf(option)]?.focus();
  };

  return (
    <div
      ref={root}
      className={['segmented', size === 'sm' ? 'sm' : '', wrap ? 'wrap' : '', className]
        .filter(Boolean)
        .join(' ')}
      role={radio ? 'radiogroup' : 'tablist'}
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
    >
      <span ref={thumb} className="segmented-thumb" aria-hidden="true" />
      {options.map((o, i) => {
        const selected = o.value === value;
        return (
          <button
            key={i}
            type="button"
            role={radio ? 'radio' : 'tab'}
            className={selected ? 'segmented-option on' : 'segmented-option'}
            aria-selected={radio ? undefined : selected}
            aria-checked={radio ? selected : undefined}
            tabIndex={selected ? 0 : -1}
            disabled={o.disabled}
            title={o.title}
            data-tour={o.tour}
            onClick={() => {
              if (!selected) onChange(o.value);
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
