// @vitest-environment jsdom
/**
 * Adversarial round 2: NumberList (VSWR circles, Q contours) is the one app
 * caller of the shared parser outside ValueInput and PowerInput. It has none
 * of the round 1 fixes: foreign units and exponent-plus-prefix are accepted,
 * a refused entry vanishes without a word.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NumberList } from '../src/components/NumberList';
import { emptyDesign } from '../src/lib/design';
import { useDesignStore } from '../src/store/useDesignStore';

afterEach(cleanup);
beforeEach(() => {
  useDesignStore.getState().init(emptyDesign());
  useDesignStore.getState().setMessage('');
});

function setup() {
  const onChange = vi.fn();
  render(
    <NumberList
      label="VSWR circles"
      values={[2]}
      min={1}
      swatch="red"
      placeholder="1.5"
      onChange={onChange}
    />,
  );
  const input = screen.getByRole('textbox', { name: 'Add VSWR circles' }) as HTMLInputElement;
  const add = (text: string): void => {
    fireEvent.change(input, { target: { value: text } });
    fireEvent.keyDown(input, { key: 'Enter' });
  };
  return { onChange, input, add };
}

describe('adv ir2 NumberList', () => {
  it('a foreign unit ("1.5 H") is not added as a VSWR circle', () => {
    const { onChange, add } = setup();
    add('1.5 H');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('a decimal comma "1,5" is either added as 1.5 or the user is told why not', () => {
    const { onChange, input, add } = setup();
    add('1,5');
    const told = useDesignStore.getState().message !== '' || input.value === '1,5';
    expect(onChange.mock.calls.length > 0 || told).toBe(true);
  });

  it('"3m" (prefix typo) is not silently turned into VSWR 0.003 and dropped', () => {
    const { onChange, input, add } = setup();
    add('3m');
    const told = useDesignStore.getState().message !== '' || input.value === '3m';
    expect(onChange.mock.calls.length > 0 || told).toBe(true);
  });
});
