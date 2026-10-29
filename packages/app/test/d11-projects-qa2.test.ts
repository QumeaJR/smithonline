// @vitest-environment jsdom
/**
 * docs/11, QA round 2: tabs that know of each other (lib/tabs.ts), this tab's own copy of a
 * design no project holds, and Save to projects under a name the list has.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyDesign, identify, type Design } from '../src/lib/design';
import { ownBuild } from '../src/lib/designBuild';
import { memoryProjectStore, type ProjectStore } from '../src/lib/projectStore';
import { numberedName } from '../src/store/useProjects';

const design = (name: string, l = 10e-9): Design =>
  ownBuild({
    ...emptyDesign(),
    name,
    load: { re: 25, im: -10 },
    elements: identify([{ kind: 'L', orientation: 'series', value: l }]),
  });

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** A tab: its own copy of the app's modules and its own id, over one store. */
async function openTab(id: string, store: ProjectStore, start: Design) {
  vi.resetModules();
  sessionStorage.setItem('smithonline.tab', id);
  const ds = await import('../src/store/useDesignStore');
  const projects = await import('../src/store/useProjects');
  ds.useDesignStore.getState().init(start);
  await projects.useProjects.getState().init({ store });
  return { D: ds.useDesignStore, P: projects.useProjects, projects };
}

afterEach(() => localStorage.clear());

describe('Save to projects under a name the list has', () => {
  it('adds a number, case ignored', () => {
    expect(numberedName('LNA', ['Mixer'])).toBe('LNA');
    expect(numberedName('LNA', ['lna', 'LNA (2)'])).toBe('LNA (3)');
  });
});

describe.skipIf(typeof BroadcastChannel === 'undefined')('two tabs', () => {
  it('hear each other, keep their own copies and read the list again', async () => {
    const store: ProjectStore = { ...memoryProjectStore(), persistent: true };
    const a = await openTab('tab-a', store, design('Design A'));
    const b = await openTab('tab-b', store, design('Design B', 20e-9));
    await wait(50);
    expect(a.P.getState().tabsOpen).toBe(true);
    // Tab A's unsaved design is kept under its own key, beside the one autosave.
    const copy = localStorage.getItem('smithonline.design.tab.tab-a');
    expect(copy && (JSON.parse(copy) as Design).name).toBe('Design A');
    // Tab B saves its design: tab A's list shows it without a reload.
    expect(await b.P.getState().saveCurrent()).toBeNull();
    await wait(50);
    expect(a.P.getState().records.map((r) => r.name)).toEqual(['Design B']);
    // Saved, tab B's own copy goes.
    expect(localStorage.getItem('smithonline.design.tab.tab-b')).toBeNull();
    // Tab A deletes it: tab B hears it, its design turns unsaved and is kept, and says so.
    const id = a.P.getState().records[0]?.id ?? '';
    expect(await a.P.getState().remove(id)).not.toBeNull();
    await wait(50);
    expect(b.D.getState().projectId).toBeNull();
    expect(b.D.getState().message).toMatch(/deleted in another tab.*this tab's own copy/);
    expect(localStorage.getItem('smithonline.design.tab.tab-b')).not.toBeNull();
  });
});
