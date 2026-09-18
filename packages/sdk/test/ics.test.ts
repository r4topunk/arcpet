import { describe, expect, it } from 'vitest';
import {
  buildReminderIcs,
  escapeIcsText,
  foldIcsLine,
  formatTimeLeft,
  icsDate,
  ReminderTooLateError,
  reminderFileName,
  reminderStart,
} from '../src/index.js';

describe('.ics reminder (D13)', () => {
  const deathAt = 1_790_000_000n; // 2026-09-21T14:13:20Z
  const ics = buildReminderIcs({
    petId: 7n,
    name: 'Mochi',
    deathAt,
    url: 'https://r4topunk.github.io/arcpet/app/pet/?id=7',
    now: new Date('2026-09-18T12:00:00Z'),
  });
  const lines = ics.split('\r\n');

  it('starts 6h before deathAt and alarms at start', () => {
    expect(icsDate(deathAt)).toBe('20260921T141320Z');
    expect(lines).toContain('DTSTART:20260921T081320Z');
    expect(lines).toContain('DTEND:20260921T141320Z');
    expect(lines).toContain('TRIGGER:PT0S');
    expect(lines).toContain('DTSTAMP:20260918T120000Z');
    expect(lines).toContain(`UID:arcpet-7-${deathAt}@r4topunk.github.io`);
    expect(lines).toContain('SUMMARY:Feed Mochi (ArcPet #7)');
  });

  it('is well-formed: CRLF, balanced blocks, lines <= 75 octets', () => {
    expect(ics.endsWith('\r\n')).toBe(true);
    expect(ics.includes('\n') && !/[^\r]\n/.test(ics)).toBe(true);
    for (const b of ['VCALENDAR', 'VEVENT', 'VALARM']) {
      expect(lines.filter((l) => l === `BEGIN:${b}`)).toHaveLength(1);
      expect(lines.filter((l) => l === `END:${b}`)).toHaveLength(1);
    }
    for (const l of lines) expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75);
  });

  it('escapes and folds text', () => {
    expect(escapeIcsText('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne');
    const long = `DESCRIPTION:${'x'.repeat(200)}`;
    const folded = foldIcsLine(long);
    expect(folded.split('\r\n ').join('')).toBe(long);
    for (const part of folded.split('\r\n')) expect(part.length).toBeLessThanOrEqual(75);
  });

  it('accepts localized texts and rejects bad input', () => {
    const pt = buildReminderIcs({
      petId: 1n,
      name: 'Rex',
      deathAt,
      now: new Date('2026-09-18T12:00:00Z'),
      summary: 'Alimente {name} (#{id})',
    });
    expect(pt).toContain('SUMMARY:Alimente Rex (#1)');
    expect(() => buildReminderIcs({ petId: 0n, name: 'x', deathAt, now: new Date(0) })).toThrow();
    expect(reminderFileName(7n)).toBe('arcpet-7-reminder.ics');
  });

  it('states the real time left: 6h when far from death', () => {
    expect(ics).toContain('dies in 6h unless');
  });

  it('never puts the event or its alarm in the past when less than 6h remain', () => {
    const now = new Date('2026-09-21T12:13:20Z'); // 2h before deathAt
    const nowSec = BigInt(now.getTime() / 1000);
    const late = buildReminderIcs({ petId: 7n, name: 'Mochi', deathAt, now });
    const ls = late.replace(/\r\n /g, '').split('\r\n');
    // start = now + 60 s, alarm at start, end at deathAt
    expect(ls).toContain(`DTSTART:${icsDate(nowSec + 60n)}`);
    expect(ls).toContain('DTEND:20260921T141320Z');
    expect(ls).toContain('TRIGGER:PT0S');
    expect(late).toContain('dies in 1h 59m unless');
    expect(late).not.toContain('6h');
  });

  it('refuses a reminder when death is too close or past', () => {
    expect(reminderStart(deathAt, deathAt - 60n)).toBeNull();
    expect(reminderStart(deathAt, deathAt + 10n)).toBeNull();
    expect(reminderStart(deathAt, deathAt - 61n)).toBe(deathAt - 1n);
    expect(reminderStart(deathAt, 0n)).toBe(deathAt - 6n * 3600n);
    expect(() =>
      buildReminderIcs({ petId: 7n, name: 'Mochi', deathAt, now: new Date(Number(deathAt) * 1000) }),
    ).toThrow(ReminderTooLateError);
  });

  it('formats time left', () => {
    expect(formatTimeLeft(6n * 3600n)).toBe('6h');
    expect(formatTimeLeft(7140n)).toBe('1h 59m');
    expect(formatTimeLeft(720n)).toBe('12m');
    expect(formatTimeLeft(5n)).toBe('1m');
  });
});
