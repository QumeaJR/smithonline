/**
 * Adversarial, static: after the token aliasing the chart colour names that
 * Settings writes and reads by name (--grid-z, --grid-y, --marker, --sweep,
 * --vswr, --q) must still be hex primitives in every theme scope, not var()
 * aliases; --mc-cloud must resolve in both themes; the theme-color metas in
 * App.tsx and index.html must match --canvas of each theme.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '..');
const css = readFileSync(resolve(root, 'src/index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const app = readFileSync(resolve(root, 'src/App.tsx'), 'utf8');
const html = readFileSync(resolve(root, 'index.html'), 'utf8');
const settings = readFileSync(resolve(root, 'src/lib/settings.ts'), 'utf8');
const dialog = readFileSync(resolve(root, 'src/components/SettingsDialog.tsx'), 'utf8');

/** Every declaration `--name: value` with the selector of the innermost block it sits in. */
function declarations(name: string): { selector: string; value: string }[] {
  const out: { selector: string; value: string }[] = [];
  const re = new RegExp(`(^|[\\s;{])${name}\\s*:\\s*([^;}]+)`, 'g');
  for (const m of css.matchAll(re)) {
    const before = css.slice(0, m.index! + m[1]!.length);
    // Walk back to the unmatched "{" that opens the block of this declaration.
    let depth = 0;
    let open = -1;
    for (let i = before.length - 1; i >= 0; i--) {
      const ch = before[i];
      if (ch === '}') depth++;
      else if (ch === '{') {
        if (depth === 0) {
          open = i;
          break;
        }
        depth--;
      }
    }
    const head = before.slice(0, open);
    const selStart = Math.max(head.lastIndexOf('}'), head.lastIndexOf('{'), head.lastIndexOf(';'));
    out.push({
      selector: head
        .slice(selStart + 1)
        .trim()
        .replace(/\s+/g, ' '),
      value: m[2]!.trim(),
    });
  }
  return out;
}

const HEX = /^#[0-9a-f]{6}$/i;
const themeScopes = [':root', ":root:not([data-theme='light'])", ":root[data-theme='dark']"];

/** The names Settings writes inline and SettingsDialog.themeColor reads back. */
const written = [...settings.matchAll(/'(--[a-z-]+)'/g)].map((m) => m[1]!);
const read = [...dialog.matchAll(/'(--[a-z-]+)'/g)].map((m) => m[1]!);
const chart = [...new Set([...written, ...read])].filter((n) => !n.startsWith('--w-'));

describe('adv css tokens: chart colour names survive the aliasing', () => {
  it('finds the token blocks', () => {
    expect(declarations('--canvas').map((d) => d.selector)).toEqual(themeScopes);
  });

  it('Settings and SettingsDialog still agree on the names', () => {
    for (const n of read) expect(written, n).toContain(n);
  });

  it.each(chart)('%s is a hex primitive in every theme scope where it is declared', (name) => {
    const decls = declarations(name);
    if (name === '--dp-user') {
      // Read with a fallback to --marker; never declared, which is fine.
      expect(decls).toHaveLength(0);
      expect(css).toMatch(/var\(--dp-user,\s*var\(--marker\)\)/);
      return;
    }
    expect(decls.length, `${name} declared`).toBeGreaterThan(0);
    for (const d of decls) {
      expect(themeScopes, `${name} in ${d.selector}`).toContain(d.selector);
      expect(d.value, `${name} in ${d.selector} = ${d.value}`).toMatch(HEX);
    }
    // The light root always declares it, so a Theme reset reads a colour back.
    expect(decls.map((d) => d.selector)).toContain(':root');
  });

  it('--mc-cloud resolves in both themes as a hex primitive and is used', () => {
    const decls = declarations('--mc-cloud');
    expect(decls.map((d) => d.selector)).toContain(':root');
    for (const d of decls) expect(d.value).toMatch(HEX);
    expect(css).toMatch(/var\(--mc-cloud\)/);
  });

  // Phase 7 removed the aliases of phase 1: the old names are gone, their semantic tokens are
  // declared in both themes.
  it('the old aliases are gone and their semantic tokens carry both themes', () => {
    for (const [old, semantic] of [
      ['--bg', '--canvas'],
      ['--panel', '--surface'],
      ['--text', '--text-primary'],
      ['--muted', '--text-secondary'],
      ['--border', '--border-strong'],
      ['--font', '--font-ui'],
      ['--mono', '--font-mono'],
    ] as const) {
      expect(declarations(old), old).toHaveLength(0);
      expect(css, old).not.toContain(`var(${old})`);
      expect(declarations(semantic).length, semantic).toBeGreaterThan(0);
    }
    for (const semantic of ['--canvas', '--surface', '--text-primary', '--text-secondary']) {
      expect(
        declarations(semantic).map((d) => d.selector),
        semantic,
      ).toContain(":root[data-theme='dark']");
    }
  });

  it('theme-color metas match --canvas of each theme in index.html and App.tsx', () => {
    const canvas = Object.fromEntries(declarations('--canvas').map((d) => [d.selector, d.value]));
    const light = canvas[':root']!;
    const dark = canvas[":root[data-theme='dark']"]!;
    expect(light).toMatch(HEX);
    expect(dark).toMatch(HEX);
    expect(html).toContain(`content="${light}" media="(prefers-color-scheme: light)"`);
    expect(html).toContain(`content="${dark}" media="(prefers-color-scheme: dark)"`);
    const rewrite = app.match(/meta\.content = scheme === 'dark' \? '([^']+)' : '([^']+)'/);
    expect(rewrite?.[1]).toBe(dark);
    expect(rewrite?.[2]).toBe(light);
  });
});
