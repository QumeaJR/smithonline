// @vitest-environment jsdom
/**
 * docs/11, local projects in the application: File, Projects… and Save to projects on the
 * desktop, More, Data, Projects on a phone, the chip beside the name, and the list's search,
 * sort, rename (Enter and Escape), duplicate, delete with Undo, export and import.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyDesign, identify, type Design } from '../src/lib/design';
import { ownBuild } from '../src/lib/designBuild';
import {
  memoryProjectStore,
  projectFileOfDesign,
  projectsFileObject,
  type ProjectRecord,
} from '../src/lib/projectStore';
import { useDesignStore } from '../src/store/useDesignStore';
import { openProjectId, useProjects } from '../src/store/useProjects';

vi.mock('uplot', () => {
  class FakePlot {
    static pxRatio = 1;
    over = document.createElement('div');
    cursor = {};
    setCursor(): void {}
    posToIdx(): number {
      return 0;
    }
    setData(): void {}
    setSize(): void {}
    redraw(): void {}
    destroy(): void {}
  }
  return { default: FakePlot };
});
vi.mock('uplot/dist/uPlot.min.css', () => ({}));

const D = () => useDesignStore.getState();
const P = () => useProjects.getState();

/** One design per name, with its own build (stable ids, as the app writes it). */
const made = new Map<string, Design>();
const design = (name: string): Design => {
  const known = made.get(name);
  if (known) return known;
  const d = ownBuild({
    ...emptyDesign(),
    name,
    elements: identify([{ kind: 'C', orientation: 'shunt', value: 2e-12 }]),
  });
  made.set(name, d);
  return d;
};
const record = (name: string, modified: number): ProjectRecord => ({
  id: `p-${name.toLowerCase()}`,
  name,
  created: 1,
  modified,
  file: projectFileOfDesign(design(name)),
});

const downloads: string[] = [];

function stubs(width: number): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
  }));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
  vi.stubGlobal('innerWidth', width);
  vi.stubGlobal('innerHeight', 900);
  URL.createObjectURL = () => 'blob:qa';
  URL.revokeObjectURL = () => undefined;
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloads.push(this.download);
  });
}

const wait = (ms: number): Promise<void> =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });

async function mount(width: number, records: ProjectRecord[]): Promise<void> {
  stubs(width);
  localStorage.clear();
  D().init(design('On show'));
  await P().init({ store: { ...memoryProjectStore(records), persistent: true } });
  P().setOpen(false);
  const { App } = await import('../src/App');
  render(<App />);
  await wait(10);
}

const dialog = (): HTMLElement => {
  const d = document.querySelector<HTMLElement>('.projects-dialog');
  if (!d) throw new Error('no Projects dialog');
  return d;
};
const names = (): string[] =>
  [...dialog().querySelectorAll('.project-name')].map((n) => n.textContent ?? '');

beforeEach(() => {
  downloads.length = 0;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('desktop', () => {
  it('File, Save to projects links the design; the chip says so; File, Projects lists it', async () => {
    await mount(1440, [record('Alpha', 3000), record('beta', 2000)]);
    const chip = document.querySelector<HTMLElement>('.desktop-header .project-chip');
    expect(chip?.getAttribute('aria-label')).toBe('Unsaved: open the project list');
    fireEvent.click(screen.getByRole('button', { name: 'File' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Save to projects/ }));
    await wait(20);
    expect(openProjectId()).not.toBeNull();
    expect(
      document.querySelector('.desktop-header .project-chip')?.getAttribute('aria-label'),
    ).toBe('Saved: open the project list');
    fireEvent.click(screen.getByRole('button', { name: 'File' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Projects…/ }));
    await wait(10);
    expect(names()).toEqual(['On show', 'Alpha', 'beta']);
    expect(dialog().querySelector('.project-row.is-open .project-name')?.textContent).toBe(
      'On show',
    );
    // Sort by name, then search.
    fireEvent.click(within(dialog()).getByRole('radio', { name: 'Name' }));
    expect(names()).toEqual(['Alpha', 'beta', 'On show']);
    fireEvent.change(within(dialog()).getByLabelText('Search projects by name'), {
      target: { value: 'ALP' },
    });
    expect(names()).toEqual(['Alpha']);
    fireEvent.change(within(dialog()).getByLabelText('Search projects by name'), {
      target: { value: 'zzz' },
    });
    expect(dialog().textContent).toContain('No project name contains "zzz"');
  });

  it('opens a project, and Undo brings the previous design back', async () => {
    await mount(1440, [record('Alpha', 3000)]);
    act(() => P().setOpen(true));
    await wait(10);
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Open Alpha' }));
    await wait(20);
    expect(document.querySelector('.projects-dialog')).toBeNull();
    expect(D().design.name).toBe('Alpha');
    expect(openProjectId()).toBe('p-alpha');
    act(() => D().undo());
    expect(D().design.name).toBe('On show');
    expect(openProjectId()).toBeNull();
  });

  it('renames with Enter, cancels with Escape, duplicates, deletes with Undo and exports', async () => {
    await mount(1440, [record('Alpha', 3000)]);
    act(() => P().setOpen(true));
    await wait(10);
    const more = (): void => {
      fireEvent.click(within(dialog()).getByRole('button', { name: /^More actions for/ }));
    };
    more();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    let field = within(dialog()).getByLabelText('New name for Alpha');
    fireEvent.change(field, { target: { value: 'Not this' } });
    fireEvent.keyDown(field, { key: 'Escape' });
    await wait(10);
    expect(document.querySelector('.projects-dialog')).not.toBeNull();
    expect(names()).toEqual(['Alpha']);
    more();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    field = within(dialog()).getByLabelText('New name for Alpha');
    fireEvent.change(field, { target: { value: 'Gamma' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await wait(20);
    expect(names()).toEqual(['Gamma']);
    more();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate' }));
    await wait(20);
    expect(names().sort()).toEqual(['Gamma', 'Gamma (copy)']);
    fireEvent.click(
      within(dialog()).getByRole('button', { name: 'More actions for Gamma (copy)' }),
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await wait(20);
    expect(names()).toEqual(['Gamma']);
    expect(dialog().querySelector('.projects-status')?.textContent).toContain(
      'Deleted "Gamma (copy)"',
    );
    fireEvent.click(
      within(dialog().querySelector<HTMLElement>('.projects-status')!).getByRole('button', {
        name: 'Undo',
      }),
    );
    await wait(20);
    expect(names().sort()).toEqual(['Gamma', 'Gamma (copy)']);
    fireEvent.click(within(dialog()).getByRole('button', { name: 'More actions for Gamma' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Export .json' }));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Export all' }));
    expect(downloads[0]).toBe('Gamma.json');
    expect(downloads[1]).toMatch(/^smithonline-projects-\d{4}-\d\d-\d\d\.json$/);
  });

  it('imports .json files into the list and says what it did', async () => {
    await mount(1440, [record('Alpha', 3000)]);
    act(() => P().setOpen(true));
    await wait(10);
    const input = dialog().querySelector<HTMLInputElement>('input[type="file"]');
    const all = JSON.stringify(projectsFileObject([record('Alpha', 3000), record('Delta', 10)]));
    const files = [
      new File([all], 'all.json', { type: 'application/json' }),
      new File(['{"x":1}'], 'other.json', { type: 'application/json' }),
    ];
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    fireEvent.change(input!);
    await wait(50);
    expect(names().sort()).toEqual(['Alpha', 'Delta']);
    const status = dialog().querySelector('.projects-status')?.textContent ?? '';
    expect(status).toContain('Added 1 project');
    expect(status).toContain('1 already in the list, skipped');
    expect(status).toContain('could not import other.json');
  });

  it('a hostile name is shown as text, never as markup', async () => {
    const evil = { ...record('Evil', 5), name: '<img src=x onerror=alert(1)>' };
    await mount(1440, [evil]);
    act(() => P().setOpen(true));
    await wait(10);
    expect(dialog().querySelector('img')).toBeNull();
    expect(names()).toEqual(['<img src=x onerror=alert(1)>']);
  });
});

describe('phone', () => {
  it('More, Data, Projects opens the list and names the open project', async () => {
    await mount(375, [record('Alpha', 3000)]);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    const row = screen.getByRole('button', { name: /^Projects/ });
    expect(row.textContent).toContain('Unsaved: this design is not in projects');
    fireEvent.click(row);
    await wait(10);
    expect(names()).toEqual(['Alpha']);
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Save to projects' }));
    await wait(20);
    expect(names().sort()).toEqual(['Alpha', 'On show']);
    expect(dialog().textContent).toContain('Open now: On show');
  });
});
