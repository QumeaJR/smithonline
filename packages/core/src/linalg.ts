/**
 * Small dense linear algebra shared by the fitting code (closed loop, RFT,
 * vector fitting).
 */

/**
 * Solve the small dense system A x = b by Gaussian elimination with partial
 * pivoting; null when singular (a pivot not above 1e-300 or not finite) or
 * when the solution is not finite.
 */
export function solveDense(
  a: readonly (readonly number[])[],
  b: readonly number[],
): number[] | null {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i] as number]);
  for (let k = 0; k < n; k++) {
    let p = k;
    for (let i = k + 1; i < n; i++) {
      if (Math.abs((m[i] as number[])[k] as number) > Math.abs((m[p] as number[])[k] as number))
        p = i;
    }
    const pivot = (m[p] as number[])[k] as number;
    if (!(Math.abs(pivot) > 1e-300) || !Number.isFinite(pivot)) return null;
    [m[k], m[p]] = [m[p] as number[], m[k] as number[]];
    const rk = m[k] as number[];
    for (let i = k + 1; i < n; i++) {
      const ri = m[i] as number[];
      const f = (ri[k] as number) / pivot;
      if (f === 0) continue;
      for (let j = k; j <= n; j++) ri[j] = (ri[j] as number) - f * (rk[j] as number);
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let k = n - 1; k >= 0; k--) {
    const rk = m[k] as number[];
    let s = rk[n] as number;
    for (let j = k + 1; j < n; j++) s -= (rk[j] as number) * (x[j] as number);
    x[k] = s / (rk[k] as number);
  }
  return x.every(Number.isFinite) ? x : null;
}
