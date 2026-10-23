/**
 * A small AC circuit solver for the tests of the netlist and schematic
 * writers: parse what was written back into components, solve the nodal
 * equations at one frequency, and compare with the ABCD model of the core.
 */
import { cabs, cadd, cdiv, cmul, complex, csub, type Complex } from '../../src/index';

export interface Comp {
  readonly type: 'R' | 'L' | 'C' | 'V' | 'T';
  readonly name: string;
  /** First and second terminal; for T the input and output nodes (the references are ground). */
  readonly a: string;
  readonly b: string;
  readonly value: number;
  readonly z0?: number;
  readonly td?: number;
}

const num = (s: string): number => {
  const n = Number(s);
  if (!Number.isFinite(n)) throw new Error(`Bad number "${s}"`);
  return n;
};

/** Parse the SPICE lines the writer produces: R, L, C, V (AC 1), T (Z0= TD=). */
export function parseSpice(text: string): { comps: Comp[]; ac: string | null } {
  const comps: Comp[] = [];
  let ac: string | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('*')) continue;
    if (line.startsWith('.ac')) ac = line;
    if (line.startsWith('.')) continue;
    const t = line.split(/\s+/);
    const name = t[0] as string;
    const kind = name[0]?.toUpperCase();
    if (kind === 'R' || kind === 'L' || kind === 'C') {
      comps.push({
        type: kind,
        name,
        a: t[1] as string,
        b: t[2] as string,
        value: num(t[3] as string),
      });
    } else if (kind === 'V') {
      comps.push({ type: 'V', name, a: t[1] as string, b: t[2] as string, value: 1 });
    } else if (kind === 'T') {
      const z0 = num((t.find((x) => x.startsWith('Z0=')) as string).slice(3));
      const td = num((t.find((x) => x.startsWith('TD=')) as string).slice(3));
      if (t[2] !== '0' || t[4] !== '0') throw new Error('T reference nodes must be ground');
      comps.push({ type: 'T', name, a: t[1] as string, b: t[3] as string, value: 0, z0, td });
    } else {
      throw new Error(`Unknown line "${line}"`);
    }
  }
  return { comps, ac };
}

function row(m: Complex[][], i: number): Complex[] {
  return m[i] as Complex[];
}

/** Solve a complex linear system by Gaussian elimination with partial pivoting. */
function solve(a: Complex[][], b: Complex[]): Complex[] {
  const n = b.length;
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let r = i + 1; r < n; r++) {
      if (cabs(row(a, r)[i] as Complex) > cabs(row(a, p)[i] as Complex)) p = r;
    }
    [a[i], a[p]] = [row(a, p), row(a, i)];
    [b[i], b[p]] = [b[p] as Complex, b[i] as Complex];
    const piv = row(a, i)[i] as Complex;
    if (cabs(piv) < 1e-300) throw new Error('Singular circuit');
    for (let r = i + 1; r < n; r++) {
      const k = cdiv(row(a, r)[i] as Complex, piv);
      for (let c = i; c < n; c++) {
        row(a, r)[c] = csub(row(a, r)[c] as Complex, cmul(k, row(a, i)[c] as Complex));
      }
      b[r] = csub(b[r] as Complex, cmul(k, b[i] as Complex));
    }
  }
  const x: Complex[] = new Array<Complex>(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i] as Complex;
    for (let c = i + 1; c < n; c++) s = csub(s, cmul(row(a, i)[c] as Complex, x[c] as Complex));
    x[i] = cdiv(s, row(a, i)[i] as Complex);
  }
  return x;
}

/** Node voltages (by name, ground "0" is 0) of the circuit at frequency f. */
export function solveAc(comps: readonly Comp[], f: number): Map<string, Complex> {
  const w = 2 * Math.PI * f;
  const nodes = new Set<string>();
  for (const c of comps) {
    nodes.add(c.a);
    nodes.add(c.b);
  }
  nodes.delete('0');
  const index = new Map([...nodes].map((n, i) => [n, i]));
  const vs = comps.filter((c) => c.type === 'V');
  const size = nodes.size + vs.length;
  const A: Complex[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => complex(0)),
  );
  const rhs: Complex[] = Array.from({ length: size }, () => complex(0));
  const add = (r: string, c: string, y: Complex): void => {
    const i = index.get(r);
    const j = index.get(c);
    if (i === undefined || j === undefined) return;
    row(A, i)[j] = cadd(row(A, i)[j] as Complex, y);
  };
  const stamp = (a: string, b: string, y: Complex): void => {
    add(a, a, y);
    add(b, b, y);
    add(a, b, complex(-y.re, -y.im));
    add(b, a, complex(-y.re, -y.im));
  };
  for (const c of comps) {
    if (c.type === 'R') stamp(c.a, c.b, complex(1 / c.value));
    else if (c.type === 'C') stamp(c.a, c.b, complex(0, w * c.value));
    else if (c.type === 'L') stamp(c.a, c.b, cdiv(complex(1), complex(0, w * c.value)));
    else if (c.type === 'T') {
      const th = w * (c.td as number);
      const z0 = c.z0 as number;
      const y11 = complex(0, -1 / (z0 * Math.tan(th)));
      const y12 = complex(0, 1 / (z0 * Math.sin(th)));
      add(c.a, c.a, y11);
      add(c.b, c.b, y11);
      add(c.a, c.b, y12);
      add(c.b, c.a, y12);
    }
  }
  vs.forEach((v, k) => {
    const r = nodes.size + k;
    const i = index.get(v.a);
    const j = index.get(v.b);
    if (i !== undefined) {
      row(A, i)[r] = complex(1);
      row(A, r)[i] = complex(1);
    }
    if (j !== undefined) {
      row(A, j)[r] = complex(-1);
      row(A, r)[j] = complex(-1);
    }
    rhs[r] = complex(v.value);
  });
  const x = solve(A, rhs);
  const out = new Map<string, Complex>([['0', complex(0)]]);
  for (const [n, i] of index) out.set(n, x[i] as Complex);
  return out;
}

type Pins = Readonly<Record<string, readonly (readonly [number, number])[]>>;

/** Parse an LTspice schematic into components; nets come from wire endpoints, pin positions and flags. */
export function parseAsc(text: string, pins: Pins): { comps: Comp[]; lines: string[] } {
  const lines = text.split(/\r?\n/).filter((l) => l !== '');
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    if (!parent.has(k)) parent.set(k, k);
    let r = k;
    while (parent.get(r) !== r) r = parent.get(r) as string;
    parent.set(k, r);
    return r;
  };
  const union = (a: string, b: string): void => void parent.set(find(a), find(b));
  const key = (x: number, y: number): string => `${x},${y}`;
  interface Sym {
    symbol: string;
    x: number;
    y: number;
    name: string;
    value: string;
  }
  const syms: Sym[] = [];
  const flags: { x: number; y: number; label: string }[] = [];
  for (const l of lines) {
    const t = l.split(' ');
    if (t[0] === 'WIRE') union(key(Number(t[1]), Number(t[2])), key(Number(t[3]), Number(t[4])));
    else if (t[0] === 'FLAG')
      flags.push({ x: Number(t[1]), y: Number(t[2]), label: t[3] as string });
    else if (t[0] === 'SYMBOL') {
      if (t[4] !== 'R0') throw new Error('Only unrotated symbols are expected');
      syms.push({ symbol: t[1] as string, x: Number(t[2]), y: Number(t[3]), name: '', value: '' });
    } else if (t[0] === 'SYMATTR') {
      const s = syms[syms.length - 1] as Sym;
      if (t[1] === 'InstName') s.name = t[2] as string;
      else if (t[1] === 'Value') s.value = t.slice(2).join(' ');
    }
  }
  const pinKey = (s: Sym, k: number): string => {
    const p = (pins[s.symbol] as readonly (readonly [number, number])[])[k] as readonly [
      number,
      number,
    ];
    return key(s.x + p[0], s.y + p[1]);
  };
  for (const s of syms) {
    find(pinKey(s, 0));
    find(pinKey(s, 1));
  }
  // Every ground flag is one net; other flags name theirs.
  const grounds = flags.filter((f) => f.label === '0').map((f) => key(f.x, f.y));
  for (const g of grounds.slice(1)) union(g, grounds[0] as string);
  const names = new Map<string, string>();
  if (grounds[0] !== undefined) names.set(find(grounds[0]), '0');
  for (const f of flags) if (f.label !== '0') names.set(find(key(f.x, f.y)), f.label);
  let anon = 0;
  const net = (k: string): string => {
    const r = find(k);
    if (!names.has(r)) names.set(r, `net${anon++}`);
    return names.get(r) as string;
  };
  const comps: Comp[] = syms.map((s) => {
    const type = s.name[0]?.toUpperCase() as Comp['type'];
    const value = type === 'V' ? 1 : Number(s.value);
    if (!Number.isFinite(value)) throw new Error(`Bad value "${s.value}" of ${s.name}`);
    return { type, name: s.name, a: net(pinKey(s, 0)), b: net(pinKey(s, 1)), value };
  });
  return { comps, lines };
}
