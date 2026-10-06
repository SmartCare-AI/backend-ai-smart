/**
 * Small, dependency-free time-zone helpers built on Intl (ICU ships with
 * Node). They answer two questions the scheduling code keeps asking:
 *
 *  - "What is the UTC instant of 09:00 on 2026-10-06 in Africa/Cairo?"
 *    → zonedTimeToUtc()
 *  - "What local date/time is this UTC instant in Africa/Cairo?"
 *    → localParts()
 *
 * Daylight-saving shifts are handled by ICU, not by us.
 */

export const DEFAULT_TIMEZONE = 'Africa/Cairo';

export interface LocalParts {
  year: number;
  /** 1–12 */
  month: number;
  /** 1–31 */
  day: number;
  hour: number;
  minute: number;
  /** 0 = Sunday … 6 = Saturday */
  weekday: number;
}

const WEEKDAYS: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let fmt = formatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      weekday: 'short',
    });
    formatters.set(timeZone, fmt);
  }
  return fmt;
}

/** True for any IANA zone ICU knows, e.g. "Africa/Cairo", "Europe/Berlin". */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** Wall-clock date and time of `instant` in `timeZone`. */
export function localParts(instant: Date, timeZone: string): LocalParts {
  const parts: Record<string, string> = {};
  for (const p of formatterFor(timeZone).formatToParts(instant)) {
    parts[p.type] = p.value;
  }
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: WEEKDAYS[parts.weekday],
  };
}

/** How far `timeZone` is ahead of UTC at `instant`, in milliseconds. */
function offsetMs(instant: Date, timeZone: string): number {
  const p = localParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  const truncated = Math.floor(instant.getTime() / 60_000) * 60_000;
  return asUtc - truncated;
}

/**
 * The UTC instant at which the wall clock in `timeZone` shows the given
 * local date and time. `month` is 1–12. Day overflow is allowed
 * (day 32 → next month), which makes "today + n days" trivial.
 */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  // First guess with the offset at the naive instant, then correct once in
  // case that guess landed on the other side of a DST switch.
  let result = naive - offsetMs(new Date(naive), timeZone);
  const corrected = naive - offsetMs(new Date(result), timeZone);
  if (corrected !== result) result = corrected;
  return new Date(result);
}

/** Calendar date ("YYYY-MM-DD") of `instant` in `timeZone`. */
export function localDateString(instant: Date, timeZone: string): string {
  const p = localParts(instant, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Parses "HH:mm" into minutes since midnight. */
export function minutesOfDay(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}
