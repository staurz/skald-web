export interface WallParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function partsOf(utcMs: number, tz: string): WallParts {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const m: Record<string, string> = {};
  for (const p of dtf.formatToParts(new Date(utcMs))) m[p.type] = p.value;
  return {
    year: +m.year,
    month: +m.month,
    day: +m.day,
    hour: +m.hour % 24, // guard against the "24" midnight quirk
    minute: +m.minute,
    second: +m.second,
  };
}

export function zonedParts(utcMs: number, tz: string): WallParts {
  return partsOf(utcMs, tz);
}

function offsetMs(utcMs: number, tz: string): number {
  const p = partsOf(utcMs, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - utcMs;
}

// Convert a wall-clock time *in tz* to the corresponding UTC epoch ms.
export function wallTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  tz: string,
): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  const o1 = offsetMs(guess, tz);
  const o2 = offsetMs(guess - o1, tz);
  return guess - o2;
}

export function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
