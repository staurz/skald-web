export function fToC(f: number): number {
  return Math.round(((f - 32) * 5 / 9) * 10) / 10;
}

export function cToF(c: number): number {
  return Math.round((c * 9 / 5 + 32) * 10) / 10;
}
