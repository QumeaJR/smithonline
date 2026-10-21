/**
 * Numbers the way the .NET Framework XmlSerializer writes a double
 * (`double.ToString("R")`): 15 significant digits when they round-trip,
 * otherwise 17 with trailing zeros removed; scientific notation with a
 * two-digit signed exponent (`1E-11`, `6.8E-08`, `1E+15`) when the decimal
 * exponent is below -4 or at least the precision, plain decimal notation
 * otherwise (the .NET "G" rule).
 * Checked against all 1941 numbers in the 22 example projects. Against the
 * real .NET Framework 4.8 formatter about 0.07 percent of random doubles
 * differ in the last digit, because its parser is not correctly rounded and
 * so its 15-digit round-trip test answers differently; the value read back
 * is the same double either way. Non-finite values use the XML Schema
 * spellings the XmlSerializer writes: INF, -INF, NaN.
 */
export function formatDotNetDouble(v: number): string {
  if (!Number.isFinite(v)) {
    if (Number.isNaN(v)) return 'NaN';
    return v > 0 ? 'INF' : '-INF';
  }
  if (v === 0) return '0';
  const precision = Number(v.toPrecision(15)) === v ? 15 : 17;
  const [m, e] = v.toExponential(precision - 1).split('e') as [string, string];
  const mantissa = m.includes('.') ? m.replace(/0+$/, '').replace(/\.$/, '') : m;
  const exp = Number(e);
  const neg = mantissa.startsWith('-');
  const sign = neg ? '-' : '';
  const digits = mantissa.replace('-', '').replace('.', '');
  if (exp < -4 || exp >= precision) {
    return `${mantissa}E${exp < 0 ? '-' : '+'}${String(Math.abs(exp)).padStart(2, '0')}`;
  }
  if (exp < 0) return `${sign}0.${'0'.repeat(-exp - 1)}${digits}`;
  if (digits.length <= exp + 1) return `${sign}${digits}${'0'.repeat(exp + 1 - digits.length)}`;
  return `${sign}${digits.slice(0, exp + 1)}.${digits.slice(exp + 1)}`;
}
