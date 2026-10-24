/**
 * QA: the pointer kind without a window (plain node, no jsdom): the plain
 * function and the hook's server snapshot both report a fine pointer.
 */
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { COARSE_POINTER_QUERY, isCoarsePointer, useCoarsePointer } from '../src/lib/pointer';

function Probe() {
  return <span>{useCoarsePointer() ? 'coarse' : 'fine'}</span>;
}

describe('pointer kind without a window', () => {
  it('there is no window here', () => {
    expect(typeof window).toBe('undefined');
  });

  it('isCoarsePointer is false', () => {
    expect(isCoarsePointer()).toBe(false);
  });

  it('useCoarsePointer renders false on the server', () => {
    expect(renderToString(<Probe />)).toBe('<span>fine</span>');
  });

  it('the query is the one index.css uses', () => {
    expect(COARSE_POINTER_QUERY).toBe('(pointer: coarse)');
  });
});
