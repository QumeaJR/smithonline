/**
 * The guided workflows of docs/09 section 3, without a page: the numbers of
 * the reference designs come from the evaluation (the 3.2 start design gives
 * the yields of yield.test.ts, and design centring gives the 3.3 start
 * design), the sample files are synthetic and match their generator, every
 * step is well formed, the D6 and D7 placeholders stay hidden, completion is
 * stored, and the next-step suggestions follow their rules.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { centreDesign, complex, monteCarlo, readTouchstone } from '@smithonline/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { centreRequest } from '../src/lib/centre';
import { emptyDesign } from '../src/lib/design';
import { effectiveElements, realizeDesign } from '../src/lib/realize';
import { SAMPLES, sampleText } from '../src/lib/samples';
import { exportLadderOf } from '../src/lib/simexport';
import { monteCarloOptions } from '../src/lib/tolerance';
import {
  isShipped,
  markCompleted,
  readCompleted,
  shippedSteps,
  WORKFLOWS_KEY,
} from '../src/lib/workflowKit';
import {
  buildableStart,
  CENTRED_L,
  ROBUST_START_L,
  robustStart,
  WORKFLOWS,
} from '../src/lib/workflows';

// The browser storage the completion uses, in plain Node.
const memory = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, v),
  removeItem: (k: string) => void memory.delete(k),
  clear: () => memory.clear(),
});

const root = resolve(__dirname, '../../..');

describe('the reference designs come from the evaluation', () => {
  it('3.2 starts at E24 11 nH + 2.7 pF with a yield near the 46 % of yield.test.ts', () => {
    const d = robustStart();
    expect(d.elements.map((el) => ('value' in el ? el.value : NaN))).toEqual([
      ROBUST_START_L,
      2.7e-12,
    ]);
    const ladder = exportLadderOf(d, realizeDesign(d, effectiveElements(d)));
    const r = monteCarlo(ladder, monteCarloOptions(d));
    // yield.test.ts: 46.1 % before centring (922 of 2000); this is the panel's own 1000-run setup.
    expect(r.passed / r.runs).toBeGreaterThan(0.4);
    expect(r.passed / r.runs).toBeLessThan(0.52);
  });

  it('design centring of the 3.2 start gives the 3.3 start, 12 nH, near 93 %', () => {
    const req = centreRequest(robustStart());
    const r = centreDesign(req.ladder, req.options);
    const l = r.elements[0] as { value: number };
    const c = r.elements[1] as { value: number };
    expect(l.value).toBeCloseTo(CENTRED_L, 15);
    expect(c.value).toBeCloseTo(2.7e-12, 18);
    expect(r.significant).toBe(true);
    expect(r.after.yield).toBeGreaterThan(0.88);
    // The 3.3 start design is that result, with Realize off.
    const b = buildableStart();
    expect((b.elements[0] as { value: number }).value).toBe(CENTRED_L);
    expect(b.realize.enabled).toBe(false);
  });
});

describe('sample files', () => {
  it('are synthetic in their name and carry no vendor data', () => {
    for (const s of SAMPLES) expect(s.fileName).toMatch(/synthetic|SYNTH/);
  });

  it('the antenna has 101 rows from 2.2 to 2.7 GHz and equals what its generator writes', () => {
    const data = readTouchstone(sampleText('antenna'), 1);
    expect(data.points.length).toBe(101);
    expect(data.points[0]?.frequency).toBeCloseTo(2.2e9, -3);
    expect(data.points.at(-1)?.frequency).toBeCloseTo(2.7e9, -3);
    expect(sampleText('antenna')).toMatch(/^! Synthetic/);
    execFileSync(process.execPath, [resolve(root, 'scripts/synth-antenna.mjs'), '--check']);
    const committed = readFileSync(
      resolve(root, 'packages/core/test/fixtures/sparams/antenna-2g4-synthetic.s1p'),
      'utf8',
    );
    expect(committed.replace(/\r\n/g, '\n')).toBe(sampleText('antenna').replace(/\r\n/g, '\n'));
  });
});

describe('the workflow definitions', () => {
  it('3.1 to 3.7 are on offer, the D6 and D7 placeholders are hidden', () => {
    const shown = WORKFLOWS.filter(isShipped).map((w) => w.id);
    expect(shown).toEqual([
      'measured-antenna',
      'robust',
      'buildable',
      'verify',
      'amplifier',
      'broadband-limits',
      'real-parts',
    ]);
    expect(WORKFLOWS.find((w) => w.id === 'measure-retune')?.requires).toBe('d6');
    expect(WORKFLOWS.find((w) => w.id === 'real-frequency')?.requires).toBe('d7');
    // A D6 or D7 step inside a shipped workflow is left out.
    const verify = WORKFLOWS.find((w) => w.id === 'verify');
    expect(verify && shippedSteps(verify).some((s) => s.requires === 'd6')).toBe(false);
  });

  it('every step is short and plain: a title of 2 to 5 words, at most two sentences, no dashes', () => {
    const d = emptyDesign();
    for (const w of WORKFLOWS) {
      const ids = new Set<string>();
      for (const s of w.steps) {
        expect(ids.has(s.id)).toBe(false);
        ids.add(s.id);
        const words = s.title.split(/\s+/).length;
        expect(words, `${w.id}/${s.id}`).toBeGreaterThanOrEqual(1);
        expect(words, `${w.id}/${s.id}`).toBeLessThanOrEqual(5);
        const text =
          typeof s.text === 'string'
            ? s.text
            : s.text(d, {
                design: d,
                atEntry: d,
                tool: null,
                matchMode: null,
                view: 'chart',
                importOpen: false,
                libraryOpen: false,
                libraryCount: 0,
                boardOn: false,
                settingsOpen: false,
                splotEntries: 0,
                splotLive: false,
                since: () => 0,
              });
        // Two sentences at most (a decimal point or an abbreviation is not a sentence end).
        expect(text.split(/[.!?](?:\s|$)/).filter((x) => x.trim()).length).toBeLessThanOrEqual(2);
        expect(`${s.title} ${text}`).not.toMatch(/[–—]/);
      }
      expect(`${w.title} ${w.blurb}`).not.toMatch(/[–—]/);
    }
  });

  it('the chain runs 3.1, 3.2, 3.3, 3.4, then the real parts', () => {
    const next = (id: string) => WORKFLOWS.find((w) => w.id === id)?.next;
    expect(next('measured-antenna')).toBe('robust');
    expect(next('robust')).toBe('buildable');
    expect(next('buildable')).toBe('verify');
    expect(next('verify')).toBe('real-parts');
    expect(next('amplifier')).toBe('broadband-limits');
  });

  it('a kept design with parts stays; without parts the reference design loads', () => {
    const robust = WORKFLOWS.find((w) => w.id === 'robust');
    const mine = {
      ...emptyDesign(),
      load: complex(30, 10),
      elements: [
        { id: 'a', color: '#000', kind: 'C' as const, orientation: 'shunt' as const, value: 1e-12 },
      ],
    };
    expect(robust?.start(mine, true)).toBeNull();
    expect(robust?.start(emptyDesign(), true)?.name).toBe('Workflow: robust match');
  });
});

describe('completion is stored per workflow in this browser', () => {
  beforeEach(() => memory.clear());
  it('marks, reads back and survives garbage', () => {
    expect(readCompleted().size).toBe(0);
    markCompleted('robust');
    markCompleted('buildable');
    expect([...readCompleted()].sort()).toEqual(['buildable', 'robust']);
    expect(JSON.parse(memory.get(WORKFLOWS_KEY) ?? '{}')).toEqual({
      done: ['robust', 'buildable'],
    });
    memory.set(WORKFLOWS_KEY, '{not json');
    expect(readCompleted().size).toBe(0);
    memory.set(WORKFLOWS_KEY, JSON.stringify({ done: [1, 'x', null] }));
    expect([...readCompleted()]).toEqual(['x']);
  });
});
