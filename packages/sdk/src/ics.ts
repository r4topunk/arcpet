// D13: "add to calendar" reminder as an RFC 5545 .ics file. No server: the browser downloads the text.
// One VEVENT that starts REMINDER_LEAD_SECONDS (6h) before deathAt and ends at deathAt, with a display alarm when it
// starts. When less than 6h remain, the event starts REMINDER_MIN_DELAY_SECONDS after `now` instead, so the alarm is
// never in the past (calendars never fire past alarms). The texts state the real time left ({time}).
// deathAt moves every time someone feeds or plays, so the UID includes deathAt: a new reminder is a new event.
import { z } from 'zod';
import { REMINDER_LEAD_SECONDS, REMINDER_MIN_DELAY_SECONDS } from './constants.js';

export const ReminderOptionsSchema = z.object({
  petId: z.bigint().positive(),
  name: z.string().min(1),
  /** Unix seconds (petInfo.deathAt). */
  deathAt: z.bigint().positive(),
  /** Public pet page, included in the event. */
  url: z.url().optional(),
  /** Current time (chain clock if available): DTSTAMP and the lower bound of the event start. Defaults to Date.now. */
  now: z.date().optional(),
  /** Event texts; English defaults. {name}, {id} and {time} (time left at the event start, e.g. "6h", "1h 58m") are replaced. */
  summary: z.string().optional(),
  description: z.string().optional(),
});
export type ReminderOptions = z.input<typeof ReminderOptionsSchema>;

const DEFAULT_SUMMARY = 'Feed {name} (ArcPet #{id})';
const DEFAULT_DESCRIPTION =
  '{name} dies in {time} unless someone feeds it and plays with it. Death is permanent.';

export class ReminderTooLateError extends Error {
  override readonly name = 'ReminderTooLateError';
  constructor(readonly deathAt: bigint) {
    super(`pet dies at ${deathAt}, too soon for a calendar reminder`);
  }
}

/**
 * Event start for a reminder: deathAt - REMINDER_LEAD_SECONDS, but never earlier than now + REMINDER_MIN_DELAY_SECONDS.
 * Returns null when that is not before deathAt (too late for a reminder). All values unix seconds.
 */
export function reminderStart(deathAt: bigint, now: bigint): bigint | null {
  const lead = deathAt - BigInt(REMINDER_LEAD_SECONDS);
  const earliest = now + BigInt(REMINDER_MIN_DELAY_SECONDS);
  const start = lead > earliest ? lead : earliest;
  return start < deathAt ? start : null;
}

/** "6h", "1h 58m", "12m" (floored to minutes, at least "1m"). */
export function formatTimeLeft(seconds: bigint): string {
  const totalMin = seconds > 60n ? seconds / 60n : 1n;
  const h = totalMin / 60n;
  const m = totalMin % 60n;
  if (h === 0n) return `${m}m`;
  return m === 0n ? `${h}h` : `${h}h ${m}m`;
}

/** UTC date-time in iCalendar basic format: 20260918T120000Z. */
export function icsDate(unixSeconds: bigint): string {
  return new Date(Number(unixSeconds) * 1000)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

/** RFC 5545 §3.3.11 TEXT escaping. */
export function escapeIcsText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** RFC 5545 §3.1 folding: lines longer than 75 octets continue on the next line after CRLF + space. */
export function foldIcsLine(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let cur = '';
  let curBytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    // The first line holds 75 octets; continuation lines hold 74 after their leading space.
    const limit = parts.length === 0 ? 75 : 74;
    if (curBytes + n > limit) {
      parts.push(cur);
      cur = '';
      curBytes = 0;
    }
    cur += ch;
    curBytes += n;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}

/** Builds the reminder .ics text (CRLF line endings). Throws ReminderTooLateError when deathAt is too close to `now`. */
export function buildReminderIcs(options: ReminderOptions): string {
  const o = ReminderOptionsSchema.parse(options);
  const stamp = BigInt(Math.floor((o.now ?? new Date()).getTime() / 1000));
  const start = reminderStart(o.deathAt, stamp);
  if (start === null) throw new ReminderTooLateError(o.deathAt);
  const time = formatTimeLeft(o.deathAt - start);
  const fill = (s: string) =>
    s.replaceAll('{name}', o.name).replaceAll('{id}', o.petId.toString()).replaceAll('{time}', time);
  const description = fill(o.description ?? DEFAULT_DESCRIPTION) + (o.url ? `\n${o.url}` : '');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ArcPet//Reminder//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:arcpet-${o.petId}-${o.deathAt}@r4topunk.github.io`,
    `DTSTAMP:${icsDate(stamp)}`,
    `DTSTART:${icsDate(start)}`,
    `DTEND:${icsDate(o.deathAt)}`,
    `SUMMARY:${escapeIcsText(fill(o.summary ?? DEFAULT_SUMMARY))}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
    ...(o.url ? [`URL:${o.url}`] : []),
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeIcsText(fill(o.summary ?? DEFAULT_SUMMARY))}`,
    'TRIGGER:PT0S',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(foldIcsLine).join('\r\n')}\r\n`;
}

/** Suggested download name, e.g. `arcpet-7-reminder.ics`. */
export function reminderFileName(petId: bigint): string {
  return `arcpet-${petId}-reminder.ics`;
}
