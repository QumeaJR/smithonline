/**
 * QA, release documentation: the house style forbids en and em dashes (U+2013, U+2014) in
 * user-visible text. Every string literal and JSX text in packages/app/src, index.html, the
 * manifest and the user guide shown in Help is checked.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const app = join(__dirname, '..');
const repo = join(app, '..', '..');

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.(tsx?|css)$/.test(name)) out.push(p);
  }
  return out;
}

function dashes(path: string): string[] {
  const hits: string[] = [];
  readFileSync(path, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      if (/[–—]/.test(line)) hits.push(`${relative(repo, path)}:${i + 1}`);
    });
  return hits;
}

describe('qa: no en or em dashes', () => {
  it('in the app source (the "no value" cells included)', () => {
    const hits = files(join(app, 'src')).flatMap(dashes);
    expect(hits).toEqual([]);
  });

  it('in index.html, the manifest and the user guide', () => {
    const hits = [
      join(app, 'index.html'),
      join(app, 'public', 'manifest.webmanifest'),
      join(repo, 'docs', '06-user-guide.md'),
      join(repo, 'README.md'),
      join(repo, 'CHANGELOG.md'),
    ].flatMap(dashes);
    expect(hits).toEqual([]);
  });
});
