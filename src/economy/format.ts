// Player-facing number formatting for shop messages and blockers. PURE MODULE (no Intl dependency, so
// strings are identical in every engine and in Node tests).

/** Integer with thousands separators: 1250 → "1,250". Rounds to the nearest whole number. */
export function grouped(n: number): string {
  const neg = n < 0;
  const digits = String(Math.round(neg ? -n : n));
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ',';
    out += digits[i];
  }
  return neg ? `-${out}` : out;
}

/** Dollars: 1250 → "$1,250". */
export function dollars(n: number): string {
  return n < 0 ? `-$${grouped(-n)}` : `$${grouped(n)}`;
}

/** Litres or HP with at most one decimal: 4 → "4", 3.27 → "3.3". */
export function amount1(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/** "1 Pop Charge" / "5 Pop Charges" (regular English plural of the last word). */
export function counted(n: number, singular: string): string {
  return `${n} ${n === 1 ? singular : `${singular}s`}`;
}
