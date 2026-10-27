/**
 * The edits of the Build inspector (docs/09b section 5): each one a named, undoable step of
 * the design, through the design store's setBuild.
 */
import { track } from './analytics/track';
import {
  DEFAULT_PACKAGES,
  formatEngineering,
  STACKUP_PRESETS,
  type BoardSettings,
  type PackageId,
  type Stackup,
} from '@smithonline/core';
import { useDesignStore } from '../store/useDesignStore';
import {
  boardName,
  browserBuildDefaults,
  patchBoard,
  patchPackage,
  patchStackup,
  designBuild,
  resetPackage,
  sameBuild,
  storedBuild,
  type PackageNumber,
} from './designBuild';
import { useSettings } from '../store/useSettings';
import { noteBoardOn, noteBuildEdit } from './nextSteps';

const eng = (v: number, unit: string): string => formatEngineering(v, { unit, digits: 4 });

const BOARD_WORDS: Readonly<
  Record<'viaDrill' | 'viasPerShunt' | 'traceLength' | 'traceWidth', (v: number) => string>
> = {
  viaDrill: (v) => `the via drill to ${eng(v, 'm')}`,
  viasPerShunt: (v) => `the vias per shunt part to ${v}`,
  traceLength: (v) => `the trace between parts to ${eng(v, 'm')}`,
  traceWidth: (v) =>
    v === 0 ? 'the trace width to follow Z0' : `the trace width to ${eng(v, 'm')}`,
};

/** Board on or off (the switch in the network row and in Build). */
export function setBoardEnabled(enabled: boolean): void {
  track('build', 'board', 'change');
  useDesignStore.getState().setBuild(enabled ? 'Board on' : 'Board off', (b) => ({
    ...b,
    board: patchBoard(b.board, { enabled }),
  }));
  if (enabled) noteBoardOn();
  noteBuildEdit();
}

/** One number of the board (via drill, vias per shunt part, trace length or width). */
export function setBoardNumber(key: keyof typeof BOARD_WORDS, value: number): void {
  track('build', 'board', 'change');
  useDesignStore.getState().setBuild(`Changed ${BOARD_WORDS[key](value)}`, (b) => ({
    ...b,
    board: patchBoard(b.board, { [key]: value }),
  }));
  noteBuildEdit();
}

const STACKUP_WORDS: Readonly<Record<string, (v: number) => string>> = {
  h: (v) => `h to ${eng(v, 'm')}`,
  er: (v) => `εr to ${v}`,
  tanD: (v) => `tanδ to ${v}`,
  fRef: (v) => `the frequency of εr and tanδ to ${eng(v, 'Hz')}`,
  t: (v) => `the copper to ${eng(v, 'm')}`,
  roughness: (v) => `the roughness to ${eng(v, 'm')}`,
};

/** Numbers of the stackup. */
export function setStackup(patch: Partial<Stackup>): void {
  track('build', 'board', 'change');
  const [key, value] = Object.entries(patch)[0] ?? [];
  const words =
    key !== undefined && typeof value === 'number' && STACKUP_WORDS[key]
      ? `Changed the stackup: ${STACKUP_WORDS[key](value)}`
      : 'Changed the stackup';
  useDesignStore.getState().setBuild(words, (b) => ({ ...b, board: patchStackup(b.board, patch) }));
  noteBuildEdit();
}

/** A whole laminate: a preset or one of your own. */
export function applyLaminate(stackup: Stackup): void {
  track('build', 'board', 'change');
  useDesignStore
    .getState()
    .setBuild(`Changed the stackup to ${boardName({ stackup } as BoardSettings)}`, (b) => ({
      ...b,
      board: { ...b.board, stackup },
    }));
  noteBuildEdit();
}

/** A laminate preset by id. */
export function applyPreset(id: string): void {
  track('build', 'board', 'change');
  const p = STACKUP_PRESETS.find((x) => x.id === id);
  if (p) applyLaminate(p.stackup);
}

const PACKAGE_WORDS: Readonly<Record<PackageNumber, readonly [string, string]>> = {
  esl: ['ESL', 'H'],
  cp: ['Cp', 'F'],
  esr: ['ESR', 'Ω'],
  pad: ['Pads', 'F'],
  padLength: ['Land l', 'm'],
  padWidth: ['Land w', 'm'],
};

/** One number of one package model, for this design. */
export function setPackageNumber(id: PackageId, key: PackageNumber, value: number): void {
  track('build', 'packages', 'change');
  const [label, unit] = PACKAGE_WORDS[key];
  useDesignStore.getState().setBuild(`Changed ${id}: ${label} to ${eng(value, unit)}`, (b) => ({
    ...b,
    table: patchPackage(b.table, id, { [key]: value }),
  }));
  noteBuildEdit();
}

/** One package model back to the built-in numbers. */
export function resetPackageRow(id: PackageId): void {
  track('build', 'packages', 'change');
  useDesignStore.getState().setBuild(`Reset ${id} to the built-in values`, (b) => ({
    ...b,
    table: resetPackage(b.table, id),
  }));
}

/**
 * The build back to this browser's defaults for new designs (Build, Reset to defaults): the
 * board, the package models, the default Q and the series, as one step. Part ratings, the
 * stock list and the switches stay.
 */
export function resetBuildToDefaults(): void {
  const defaults = browserBuildDefaults();
  const s = useSettings.getState().settings;
  const build = storedBuild(defaults);
  useDesignStore.getState().step('Reset the build to the defaults for new designs', (d) => {
    const next = {
      ...d,
      build,
      losses: { ...d.losses, inductorQ: s.defaultInductorQ, capacitorQ: s.defaultCapacitorQ },
      realize: {
        ...d.realize,
        series: d.realize.series === 'stock' ? d.realize.series : s.defaultSeries,
      },
    };
    const same =
      sameBuild(designBuild(d), defaults) &&
      JSON.stringify(d.build) === JSON.stringify(build) &&
      JSON.stringify(d.losses) === JSON.stringify(next.losses) &&
      d.realize.series === next.realize.series;
    return same ? d : next;
  });
}

/** Give every inductor and capacitor the package (those the package is offered for), as one step. */
export function setPackageForAll(pkg: PackageId): void {
  track('build', 'packages', 'change');
  const row = DEFAULT_PACKAGES.find((p) => p.id === pkg);
  if (!row) return;
  useDesignStore.getState().step(`Package ${pkg} for every L and C`, (d) => {
    let changed = false;
    const elements = d.elements.map((el) => {
      if ((el.kind !== 'L' && el.kind !== 'C') || !row.parts.includes(el.kind)) return el;
      if (el.package === pkg) return el;
      changed = true;
      return { ...el, package: pkg };
    });
    return changed ? { ...d, elements } : d;
  });
  noteBuildEdit();
}
