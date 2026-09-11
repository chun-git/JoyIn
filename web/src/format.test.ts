import { describe, expect, it } from 'vitest';
import { eventStatusLabel, formatEventDateTime, formatEventRange, waitlistLabel } from './format';

describe('format helpers', () => {
  it('formats Taipei datetime in Traditional Chinese', () => {
    expect(formatEventDateTime('2026-12-01', '19:00')).toContain('2026年12月1日');
    expect(formatEventDateTime('2026-12-01', '19:00')).toContain('19:00');
    expect(
      formatEventRange({
        startDate: '2026-12-01',
        startTime: '19:00',
        endDate: '2026-12-01',
        endTime: '21:00',
      }),
    ).toContain('21:00');
    expect(
      formatEventDateTime('2026-09-12', '00:30'),
    ).toContain('2026年9月12日');
    expect(
      formatEventRange({
        startDate: '2026-12-01',
        startTime: '19:00',
        endDate: '2026-12-02',
        endTime: '10:00',
      }),
    ).toContain('2026年12月2日');
  });

  it('describes waitlist and event status', () => {
    expect(
      waitlistLabel({ capacity: 10, confirmedCount: 3, waitlistCount: 0, waitlistEnabled: true }),
    ).toBe('尚有名額');
    expect(
      waitlistLabel({ capacity: 2, confirmedCount: 2, waitlistCount: 3, waitlistEnabled: true }),
    ).toBe('候補 3 人');
    expect(
      eventStatusLabel({ status: 'OPEN', capacity: 2, confirmedCount: 2, waitlistEnabled: true }),
    ).toBe('候補中');
    expect(
      eventStatusLabel({ status: 'CLOSED', capacity: 2, confirmedCount: 1, waitlistEnabled: true }),
    ).toBe('已關閉報名');
  });
});
