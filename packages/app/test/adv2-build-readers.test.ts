/**
 * Adversarial QA round 2 (0.6.0): hostile build fields in links, .json files and the autosave.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { complex, DEFAULT_BOARD, STACKUP_PRESETS } from '@smithonline/core';

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
const old = await import('./fixtures/share-0.5.0');
const { DESIGN_STORAGE_KEY, readSavedDesign } = await import('../src/lib/autosave');
const { useBoard } = await import('../src/store/useBoard');
const { usePackages, loadPackageTable, packagesDropped } = await import('../src/store/usePackages');
const { useDesignStore } = await import('../src/store/useDesignStore');

const D = () => useDesignStore.getState();
const RO4350 = STACKUP_PRESETS.find((p) => p.id === 'ro4350b-0.762')!.stackup;

const b64 = (json: string): string =>
  Buffer.from(json, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const unb64 = (link: string): string =>
  Buffer.from(link.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');

function packaged(): Design {
  const base = emptyDesign();
  return {
    ...base,
    name: 'adv2',
    load: complex(25, -15),
    elements: identify([
      { kind: 'C', orientation: 'shunt', value: 3.3e-12, package: '0402' },
      { kind: 'L', orientation: 'series', value: 6.8e-9, package: '0402' },
    ]),
  };
}

/** The JSON a link carries, with `build` replaced. */
function linkWith(build: unknown): string {
  const raw = JSON.parse(unb64(encodeDesign(packaged())));
  raw.build = build;
  return b64(JSON.stringify(raw));
}
const stackupNumbers = {
  h: 1.6e-3,
  er: 4.17,
  tanD: 0.0161,
  fRef: 1e9,
  t: 35e-6,
  roughness: 3.2e-6,
};

beforeEach(() => {
  memory.clear();
  useBoard.getState().reset();
  usePackages.getState().reset();
  D().init(emptyDesign());
});

describe('hostile build fields are refused, never stored', () => {
  const cases: Record<string, unknown> = {
    'h zero': { board: { stackup: { ...stackupNumbers, h: 0 } } },
    'h negative': { board: { stackup: { ...stackupNumbers, h: -1e-3 } } },
    'h 1e400 (Infinity)': '__INF__',
    'h string': { board: { stackup: { ...stackupNumbers, h: '1.6e-3' } } },
    'viasPerShunt 2.5': { board: { stackup: stackupNumbers, viasPerShunt: 2.5 } },
    'viasPerShunt "2"': { board: { stackup: stackupNumbers, viasPerShunt: '2' } },
    'enabled "true"': { board: { enabled: 'true', stackup: stackupNumbers } },
    'stackup array': { board: { stackup: [] } },
    'board array': { board: [] },
    'board string': { board: 'FR-4' },
    'build array': [],
    'build number': 5,
    'packages object': { packages: { id: '0402' } },
    'packages unknown id': { packages: [{ id: '01005', esl: 1e-10 }] },
    'packages duplicate id': {
      packages: [
        { id: '0402', esl: 1e-10 },
        { id: '0402', esl: 2e-10 },
      ],
    },
    'packages 5000 rows': { packages: Array.from({ length: 5000 }, () => ({ id: '0402' })) },
    'packages esl negative': { packages: [{ id: '0402', esl: -1e-10 }] },
    'packages esl string': { packages: [{ id: '0402', esl: '1e-10' }] },
    'packages null row': { packages: [null] },
    'tanD unphysical on er 1.1': { board: { stackup: { ...stackupNumbers, er: 1.1, tanD: 0.3 } } },
    'fRef 1 Hz': { board: { stackup: { ...stackupNumbers, fRef: 1 } } },
  };
  for (const [name, build] of Object.entries(cases)) {
    it(name, () => {
      const link =
        build === '__INF__'
          ? b64(
              unb64(linkWith({ board: { stackup: { ...stackupNumbers, h: 7 } } })).replace(
                '"h":7',
                '"h":1e400',
              ),
            )
          : linkWith(build);
      expect(decodeDesign(link)).toBeNull();
      // The same payload as the autosave.
      const raw = JSON.parse(unb64(link));
      memory.set(DESIGN_STORAGE_KEY, JSON.stringify(raw));
      expect(readSavedDesign()).toBeNull();
    });
  }

  it('prototype keys in build, board, stackup and package rows change nothing', () => {
    const json =
      '{"board":{"stackup":{"h":0.0016,"er":4.17,"tanD":0.0161,"fRef":1000000000,"t":0.000035,"roughness":0.0000032,"__proto__":{"h":-1}},"__proto__":{"enabled":true}},' +
      '"packages":[{"id":"0402","esl":4e-10,"__proto__":{"cp":1}},{"id":"0603","constructor":1}],"__proto__":{"board":5}}';
    const raw = JSON.parse(unb64(encodeDesign(packaged())));
    const text = JSON.stringify(raw).replace(/\}$/, `,"build":${json}}`);
    const d = decodeDesign(b64(text));
    expect(d).not.toBeNull();
    expect(d!.build?.board?.enabled).toBe(false);
    expect(({} as Record<string, unknown>).enabled).toBeUndefined();
    expect(d!.build?.packages).toEqual([{ id: '0402', esl: 4e-10 }]);
  });

  it('a 1 MB laminate name is cut to 80 characters', () => {
    const d = decodeDesign(
      linkWith({ board: { stackup: { ...stackupNumbers, h: 1e-3, name: 'x'.repeat(1_000_000) } } }),
    );
    expect(d?.build?.board?.stackup.name?.length).toBe(80);
  });
});

describe('a link the new build writes, read by the 0.5.0 reader', () => {
  it('a full build with a board and changed rows opens in 0.5.0', () => {
    const d: Design = {
      ...packaged(),
      build: {
        board: {
          ...DEFAULT_BOARD,
          enabled: true,
          stackup: { ...RO4350, name: 'My <b>laminate</b> "x"' },
          viasPerShunt: 3,
          traceLength: 2e-3,
          traceWidth: 0.4e-3,
        },
        packages: [
          { id: '0402', esl: 0.45e-9 },
          { id: 'wirewound', cp: 1e-13 },
        ],
      },
      tolerance: {
        runs: 1000,
        seed: 1,
        distribution: 'uniform',
        percent: null,
        vswrLimit: 1.5,
        overBand: false,
        overrides: {},
      },
    };
    const back = old.decodeDesign(encodeDesign(d));
    expect(back).not.toBeNull();
    expect(back!.tolerance?.vswrLimit).toBe(1.5);
  });
});

describe('the browser defaults from before 0.6.0 that the readers refuse', () => {
  // 0.5.0 Settings > Component packages: every field had min 0 and no max (SettingsDialog.tsx
  // at v0.5.0), and normalizePackageTable keeps any finite non-negative number. A value typed
  // without its suffix ("10" for 10 nH) is stored as 10 H.
  it('esl 10 H in packages.v1: the autosave of a new design is refused on the next start', () => {
    memory.set(
      'smithonline.packages.v1',
      JSON.stringify([
        { id: '0402', esl: 10, cp: 0, esr: 0, pad: 0.05e-12, padLength: 0.5e-3, padWidth: 0.5e-3 },
      ]),
    );
    usePackages.setState({ table: loadPackageTable() });
    // One rule (core PACKAGE_LIMITS): the 10 H is set back to the built-in ESL when it is read,
    // and the start names it once (packagesDropped, main.tsx).
    expect(usePackages.getState().table.find((r) => r.id === '0402')?.esl).toBe(0.4e-9);
    expect(packagesDropped.list).toEqual([{ id: '0402', key: 'esl', value: 10 }]);
    const fresh = db.newDesignFromDefaults();
    // What App.tsx writes on every change.
    memory.set(
      DESIGN_STORAGE_KEY,
      JSON.stringify(db.ownBuild({ ...fresh, elements: packaged().elements })),
    );
    const back = readSavedDesign();
    expect(back, 'the autosave is unreadable: the user loses the design on reload').not.toBeNull();
  });

  it('esl 10 H in packages.v1: a share link from that browser opens nowhere', () => {
    memory.set('smithonline.packages.v1', JSON.stringify([{ id: '0402', esl: 10 }]));
    usePackages.setState({ table: loadPackageTable() });
    const own = db.ownBuild(packaged());
    expect(decodeDesign(encodeDesign(own)), 'the link the sender copies is refused').not.toBeNull();
  });

  it('esr 5000 ohm for wirewound in packages.v1: an old autosave opened is lost on the next start', () => {
    memory.set('smithonline.packages.v1', JSON.stringify([{ id: 'wirewound', esr: 5000 }]));
    usePackages.setState({ table: loadPackageTable() });
    // A 0.5.0 autosave (no build) is read and opened (main.tsx), then autosaved (App.tsx).
    memory.set(DESIGN_STORAGE_KEY, JSON.stringify(packaged()));
    const first = readSavedDesign();
    expect(first).not.toBeNull();
    const opened = db.openedDesign(first!).design;
    memory.set(DESIGN_STORAGE_KEY, JSON.stringify(db.ownBuild(opened)));
    expect(readSavedDesign(), 'second start: the design is gone, Example 5 shows').not.toBeNull();
  });
});
