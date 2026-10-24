import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react';

/** How long the keyboard may pause between steps that still count as one undo step. */
export const KEY_COALESCE_MS = 500;

export interface SliderProps {
  readonly min: number;
  readonly max: number;
  readonly step?: number;
  readonly value: number;
  /** Every move of the knob; the caller applies it as a transient change. */
  readonly onChange: (value: number) => void;
  /**
   * Closes the run of changes as one undo step: once per drag (on release or
   * when the browser takes the pointer), and once per run of keyboard steps
   * that follow each other within 500 ms (or when the focus leaves).
   */
  readonly onCommit?: () => void;
  readonly ariaLabel: string;
  readonly ariaValuetext?: string;
  readonly title?: string;
  /** Number of tick marks to draw along the track, such as the steps of an E series. */
  readonly ticks?: number;
  readonly disabled?: boolean;
  readonly className?: string;
  readonly onClick?: (e: MouseEvent<HTMLInputElement>) => void;
}

/**
 * The run of changes still open, whichever slider made it: a second slider
 * closes the first one's run before it starts its own, so two sliders never
 * share an undo step.
 */
let openRun: { readonly owner: object; readonly close: () => void } | null = null;

function closeOpenRun(except?: object): void {
  if (openRun && openRun.owner !== except) {
    const run = openRun;
    openRun = null;
    run.close();
  }
}

/**
 * A native range input styled to the design: 4 px track, 16 px knob on a
 * fine pointer and 28 px on a coarse one, `touch-action: pan-y` so a vertical
 * swipe still scrolls the panel.
 */
export function Slider({
  min,
  max,
  step,
  value,
  onChange,
  onCommit,
  ariaLabel,
  ariaValuetext,
  title,
  ticks,
  disabled,
  className,
  onClick,
}: SliderProps) {
  const owner = useRef<object>({});
  const commitRef = useRef(onCommit);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The pointers pressed on this slider: the drag ends when the last one is released.
  const pointers = useRef(new Set<number>());
  // Set between a release and the end of its task: the browser's trailing change event
  // (React reports it as one more onChange with the released value) belongs to the drag.
  const released = useRef(false);
  // The value of the last onChange, to tell the trailing repeat from a real step.
  const lastSent = useRef<number | null>(null);
  useEffect(() => {
    commitRef.current = onCommit;
  });

  /** Close this slider's run now: the caller records the step. */
  const close = (): void => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (openRun?.owner === owner.current) openRun = null;
    commitRef.current?.();
  };

  const open = (): void => {
    closeOpenRun(owner.current);
    if (openRun?.owner !== owner.current) openRun = { owner: owner.current, close };
  };

  // One stable listener for the life of the slider, so the removal always matches the addition.
  const release = useRef<(e: PointerEvent) => void>(() => undefined);
  const [onRelease] = useState(() => (e: PointerEvent) => release.current(e));
  const stopListening = (): void => {
    window.removeEventListener('pointerup', onRelease);
    window.removeEventListener('pointercancel', onRelease);
  };
  /** End the drag: one step for the whole gesture, however many pointers took part. */
  const endDrag = (): void => {
    stopListening();
    pointers.current.clear();
    released.current = true;
    setTimeout(() => {
      released.current = false;
    }, 0);
    close();
  };
  useEffect(() => {
    release.current = (e: PointerEvent): void => {
      if (!pointers.current.delete(e.pointerId)) return;
      if (pointers.current.size === 0) endDrag();
    };
  });

  // Leaving the page or unmounting closes a pending keyboard run or drag.
  useEffect(
    () => () => {
      window.removeEventListener('pointerup', onRelease);
      window.removeEventListener('pointercancel', onRelease);
      pointers.current.clear();
      if (openRun?.owner === owner.current) closeOpenRun();
    },
    [onRelease],
  );

  const tickCount = ticks !== undefined && ticks >= 2 && ticks <= 60 ? ticks : 0;
  const style = tickCount ? ({ '--ticks': tickCount - 1 } as CSSProperties) : undefined;

  return (
    <span
      className={['slider', tickCount ? 'ticked' : '', className].filter(Boolean).join(' ')}
      style={style}
    >
      <input
        type="range"
        className="slider-input"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        title={title}
        aria-label={ariaLabel}
        aria-valuetext={ariaValuetext}
        onPointerDown={(e) => {
          released.current = false;
          // a keyboard run of this slider ends where the drag begins
          if (timer.current !== null) close();
          open();
          if (pointers.current.size === 0) {
            window.addEventListener('pointerup', onRelease);
            window.addEventListener('pointercancel', onRelease);
          }
          pointers.current.add(e.pointerId);
        }}
        onKeyDown={() => {
          released.current = false;
        }}
        onChange={(e) => {
          // The change event the browser fires after the release repeats the last value:
          // it must not open a second run (a second undo step with the same design).
          const next = Number(e.target.value);
          if (released.current) {
            const span = Math.abs(max - min) || 1;
            if (lastSent.current !== null && Math.abs(next - lastSent.current) <= span * 1e-9)
              return;
            released.current = false;
          }
          open();
          lastSent.current = next;
          onChange(next);
          if (pointers.current.size > 0) return;
          // Keyboard (or assistive technology): the run closes once the steps pause.
          if (timer.current !== null) clearTimeout(timer.current);
          timer.current = setTimeout(close, KEY_COALESCE_MS);
        }}
        onBlur={() => {
          if (pointers.current.size > 0) endDrag();
          else if (timer.current !== null) close();
        }}
        onClick={onClick}
      />
    </span>
  );
}
