/** Today's date and weekday as seen in `timezone`. */
export function todayIn(now: Date, timezone: string): { date: string; weekday: string } {
  const parts = partsIn(now, timezone);
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "long" }).format(now);
  return { date: `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`, weekday };
}

/** The instant at which the wall clock in `timezone` reads `date` ("YYYY-MM-DD") at `time` ("HH:MM"). */
export function wallClockToInstant(date: string, time: string, timezone: string): Date {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const [hour, minute] = time.split(":").map(Number) as [number, number];
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  // The offsets in force half a day either side cover any DST change that night.
  const offsetBefore = offsetAt(new Date(wall - HALF_DAY), timezone);
  const offsetAfter = offsetAt(new Date(wall + HALF_DAY), timezone);
  const candidates = [wall - offsetBefore, wall - offsetAfter].filter(
    (instant) => instant + offsetAt(new Date(instant), timezone) === wall,
  );
  // A repeated time (clocks going back) takes its first occurrence. A skipped time (clocks going
  // forward) has no candidate, so it keeps the earlier offset and lands after the jump.
  return new Date(candidates.length > 0 ? Math.min(...candidates) : wall - offsetBefore);
}

const HALF_DAY = 12 * 60 * 60 * 1000;

/** The date ("YYYY-MM-DD") and time ("HH:MM") the wall clock in `timezone` shows at `instant`. */
export function instantToWallClock(instant: Date, timezone: string): { date: string; time: string } {
  const p = partsIn(instant, timezone);
  return { date: `${p.year}-${pad(p.month)}-${pad(p.day)}`, time: `${pad(p.hour)}:${pad(p.minute)}` };
}

/** An instant for people, on the clock in `timezone`, e.g. "Thu 29 Oct 2026, 15:00". */
export function formatInstant(instant: Date, timezone: string): string {
  const { date, time } = instantToWallClock(instant, timezone);
  return `${formatDay(date)}, ${time}`;
}

/** A calendar date ("YYYY-MM-DD") for people, e.g. "Thu 29 Oct 2026". */
export function formatDay(date: string): string {
  return new Date(`${date}T00:00:00Z`)
    .toLocaleDateString("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric" })
    .replace(",", "");
}

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/** How far `timezone`'s wall clock is ahead of UTC at `instant`, in milliseconds. */
function offsetAt(instant: Date, timezone: string): number {
  const p = partsIn(instant, timezone);
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wall - Math.floor(instant.getTime() / 1000) * 1000;
}

function partsIn(instant: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)!.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

const pad = (value: number) => String(value).padStart(2, "0");
