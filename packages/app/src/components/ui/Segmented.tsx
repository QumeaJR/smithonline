import { useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';

export interface SegmentedOption<T extends string> {
  readonly value: T;
  readonly label: ReactNode;
  readonly title?: string;
  readonly disabled?: boolean;
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
}

/**
 * A segmented control: one choice out of a few, shown side by side with a
 * thumb that slides to the chosen one (160 ms, none with reduced motion).
 * Role tablist; the arrow keys, Home and End move the choice and the focus,
 * and only the chosen segment is in the tab order.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  size = 'md',
  wrap = false,
  className,
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
      const on = host.querySelector<HTMLElement>('[aria-selected="true"]');
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
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (at + 1) % enabled.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp')
      next = (at - 1 + enabled.length) % enabled.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = enabled.length - 1;
    if (next === null || enabled.length === 0) return;
    e.preventDefault();
    const option = enabled[next];
    if (!option) return;
    if (option.value !== value) onChange(option.value);
    const tabs = root.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    tabs?.[options.indexOf(option)]?.focus();
  };

  return (
    <div
      ref={root}
      className={['segmented', size === 'sm' ? 'sm' : '', wrap ? 'wrap' : '', className]
        .filter(Boolean)
        .join(' ')}
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
    >
      <span ref={thumb} className="segmented-thumb" aria-hidden="true" />
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            className={selected ? 'segmented-option on' : 'segmented-option'}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            disabled={o.disabled}
            title={o.title}
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
