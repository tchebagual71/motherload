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

/** Litres or HP with at most one decimal: 4 → "4", 3.27 → "3.3". Fuel uses `litres` (rounded down). */
export function amount1(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/**
 * Fuel litres in a Pump quote or receipt: rounded DOWN to 0.1 L like the gauge (03 §6.1), whole amounts without
 * ".0": 4.67 → "4.6 L", 5 → "5 L", 1250 → "1,250 L". Rounding down means a receipt never names more fuel than
 * the quote offered or the tank shows (PLAYER-11: "Fill 4.6 L" must not become "Filled up: 4.7 L").
 */
export function litres(n: number): string {
  const v = Math.floor(Math.max(0, n) * 10 + 1e-6) / 10;
  return `${Number.isInteger(v) ? grouped(v) : v.toFixed(1)} L`;
}

/** "1 Pop Charge" / "5 Pop Charges" (regular English plural of the last word). */
export function counted(n: number, singular: string): string {
  return `${n} ${n === 1 ? singular : `${singular}s`}`;
}
