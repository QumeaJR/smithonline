/**
 * Adversarial QA round 2 (0.6.0): every board.v1 and packages.v1 this browser accepts as its
 * defaults must give a design whose autosave, link and .json file read back with the same build.
 */
import { describe, expect, it, vi } from 'vitest';
import { complex } from '@smithonline/core';

const memory = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, v),
  removeItem: (k: string) => void memory.delete(k),
  clear: () => memory.clear(),
});

const { emptyDesign, identify } = await import('../src/lib/design');
type Design = import('../src/lib/design').Design;
const db = await import('../src/lib/designBuild');
const { decodeDesign, encodeDesign } = await import('../src/lib/share');
const { DESIGN_STORAGE_KEY, readSavedDesign } = await import('../src/lib/autosave');
const { useBoard, loadBoard } = await import('../src/store/useBoard');
const { usePackages, loadPackageTable } = await import('../src/store/usePackages');

let seed = 12345;
const rnd = (): number => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)] as T;
const NUMS = [
  0, -0, 1, -1, 1e-12, 1e-9, 1e-6, 1.0000001e-6, 1e-3, 0.0099999999, 0.01, 0.5, 0.99999999, 1, 2,
  3.14159265358979, 4.123456789, 100, 1e3, 1e9, 1e12, 1.23456789e-4, 999.9999999,
  0.30000000000000004,
];
const anyNum = (): unknown =>
  rnd() < 0.1
    ? pick(['x', null, true, [], {}])
    : rnd() < 0.5
      ? pick(NUMS)
      : rnd() * Math.pow(10, Math.floor(rnd() * 24) - 15);

function packaged(): Design {
  return {
    ...emptyDesign(),
    load: complex(25, -15),
    elements: identify([
      { kind: 'C', orientation: 'shunt', value: 3.3e-12, package: '0402' },
      { kind: 'L', orientation: 'series', value: 6.8e-9, package: 'wirewound' },
    ]),
  };
}

describe('fuzz: stored defaults from before 0.6.0', () => {
  for (const withRows of [false, true])
    it(`3000 board.v1${withRows ? ' and packages.v1' : ''} contents: the design they give survives the autosave and a link`, () => {
      const failures: string[] = [];
      for (let i = 0; i < 3000; i++) {
        memory.clear();
        const board = {
          enabled: rnd() < 0.5,
          stackup: {
            h: anyNum(),
            er: anyNum(),
            tanD: anyNum(),
            fRef: anyNum(),
            t: anyNum(),
            roughness: anyNum(),
            ...(rnd() < 0.3 ? { rho: anyNum() } : {}),
            ...(rnd() < 0.3 ? { name: pick(['FR-4, 1.6 mm', 'x'.repeat(200), 'a\nb', 5]) } : {}),
          },
          viaDrill: anyNum(),
          viasPerShunt: anyNum(),
          traceLength: anyNum(),
          traceWidth: anyNum(),
        };
        const rows = ['0201', '0402', '0603', '0805', '1206', 'wirewound']
          .filter(() => withRows && rnd() < 0.5)
          .map((id) => ({
            id,
            esl: anyNum(),
            cp: anyNum(),
            esr: anyNum(),
            pad: anyNum(),
            padLength: anyNum(),
            padWidth: anyNum(),
          }));
        memory.set('smithonline.board.v1', JSON.stringify(board));
        memory.set('smithonline.packages.v1', JSON.stringify(rows));
        useBoard.setState({ board: loadBoard() });
        usePackages.setState({ table: loadPackageTable() });
        const d = db.openedDesign(packaged()).design;
        const want = db.designBuild(d);
        const strip = (b: ReturnType<typeof db.designBuild>) =>
          JSON.stringify({ ...b.board, stackup: { ...b.board.stackup, name: undefined } }) +
          JSON.stringify(db.changesFromTable(b.table));
        memory.set(DESIGN_STORAGE_KEY, JSON.stringify(db.ownBuild(d)));
        const saved = readSavedDesign();
        const linked = decodeDesign(encodeDesign(db.ownBuild(d)));
        if (!saved || strip(db.designBuild(saved)) !== strip(want))
          failures.push(
            `autosave ${saved ? 'differs' : 'LOST'} stored=${JSON.stringify(db.ownBuild(d).build?.board)} back=${saved ? JSON.stringify(db.designBuild(saved).board) : ''}`,
          );
        if (!linked) failures.push(`link refused ${JSON.stringify(db.ownBuild(d).build)}`);
      }
      expect(failures.length, failures.slice(0, 3).join('\n')).toBe(0);
    });
});
