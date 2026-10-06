import {
  isValidTimeZone,
  localDateString,
  localParts,
  minutesOfDay,
  zonedTimeToUtc,
} from './timezone.util';

describe('timezone.util', () => {
  it('converts Cairo winter time (UTC+2) to UTC', () => {
    expect(zonedTimeToUtc(2027, 1, 15, 9, 0, 'Africa/Cairo').toISOString()).toBe(
      '2027-01-15T07:00:00.000Z',
    );
  });

  it('converts Cairo summer time (UTC+3, DST) to UTC', () => {
    expect(zonedTimeToUtc(2026, 7, 15, 9, 0, 'Africa/Cairo').toISOString()).toBe(
      '2026-07-15T06:00:00.000Z',
    );
  });

  it('handles zones behind UTC and day overflow', () => {
    // 32 January = 1 February; New York is UTC-5 in winter.
    expect(
      zonedTimeToUtc(2027, 1, 32, 21, 30, 'America/New_York').toISOString(),
    ).toBe('2027-02-02T02:30:00.000Z');
  });

  it('is the inverse of localParts', () => {
    const instant = zonedTimeToUtc(2026, 10, 6, 23, 15, 'Asia/Riyadh');
    expect(localParts(instant, 'Asia/Riyadh')).toMatchObject({
      year: 2026,
      month: 10,
      day: 6,
      hour: 23,
      minute: 15,
      weekday: 2, // Tuesday
    });
    expect(localDateString(instant, 'Asia/Riyadh')).toBe('2026-10-06');
  });

  it('validates IANA zones', () => {
    expect(isValidTimeZone('Africa/Cairo')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
  });

  it('parses HH:mm', () => {
    expect(minutesOfDay('09:30')).toBe(570);
    expect(minutesOfDay('00:00')).toBe(0);
  });
});
