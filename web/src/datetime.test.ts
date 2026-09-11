import { describe, expect, it } from 'vitest';
import {
  addOneMinute,
  toEventAt,
  taipeiParts,
  validateEventSchedule,
} from '@shared/datetime';

const afternoonInTaipei = new Date('2026-09-11T07:00:00.000Z');

describe('shared event schedule', () => {
  it('converts Taipei wall time with an explicit +08:00 offset, not as UTC', () => {
    expect(toEventAt('2026-09-11', '19:00')).toBe('2026-09-11T11:00:00.000Z');
    expect(toEventAt('2026-09-11', '19:00')).not.toBe('2026-09-11T19:00:00.000Z');
    expect(taipeiParts(afternoonInTaipei)).toEqual({ date: '2026-09-11', time: '15:00' });
  });

  it('accepts same-day evening, overnight, and tomorrow ranges', () => {
    expect(
      validateEventSchedule(
        { startDate: '2026-09-11', startTime: '19:00', endDate: '2026-09-11', endTime: '21:00' },
        { now: afternoonInTaipei },
      ),
    ).toMatchObject({ ok: true, startAt: '2026-09-11T11:00:00.000Z', endAt: '2026-09-11T13:00:00.000Z' });

    expect(
      validateEventSchedule(
        { startDate: '2026-09-11', startTime: '23:00', endDate: '2026-09-12', endTime: '01:00' },
        { now: afternoonInTaipei },
      ),
    ).toMatchObject({ ok: true, startAt: '2026-09-11T15:00:00.000Z', endAt: '2026-09-11T17:00:00.000Z' });

    expect(
      validateEventSchedule(
        { startDate: '2026-09-12', startTime: '09:00', endDate: '2026-09-12', endTime: '11:00' },
        { now: afternoonInTaipei },
      ),
    ).toMatchObject({ ok: true });
  });

  it('rejects start at or before now, and end at or before start', () => {
    const now = new Date('2026-09-11T07:00:00.000Z');
    expect(
      validateEventSchedule(
        { startDate: '2026-09-11', startTime: '14:00', endDate: '2026-09-11', endTime: '21:00' },
        { now },
      ),
    ).toEqual({ ok: false, message: '開始時間必須晚於現在' });

    expect(
      validateEventSchedule(
        { startDate: '2026-09-11', startTime: '15:00', endDate: '2026-09-11', endTime: '21:00' },
        { now },
      ),
    ).toEqual({ ok: false, message: '開始時間必須晚於現在' });

    expect(
      validateEventSchedule(
        { startDate: '2026-09-11', startTime: '19:00', endDate: '2026-09-11', endTime: '18:00' },
        { now },
      ),
    ).toEqual({ ok: false, message: '結束時間必須晚於開始時間' });

    expect(
      validateEventSchedule(
        { startDate: '2026-09-11', startTime: '19:00', endDate: '2026-09-11', endTime: '19:00' },
        { now },
      ),
    ).toEqual({ ok: false, message: '結束時間必須晚於開始時間' });

    expect(
      validateEventSchedule(
        { startDate: '2026-09-12', startTime: '19:00', endDate: '2026-09-11', endTime: '21:00' },
        { now },
      ),
    ).toEqual({ ok: false, message: '結束時間必須晚於開始時間' });
  });

  it('does not reject a future evening event just because the end time is compared with now', () => {
    const duringTheRange = new Date('2026-09-11T12:30:00.000Z');
    const result = validateEventSchedule(
      { startDate: '2026-09-11', startTime: '19:00', endDate: '2026-09-11', endTime: '21:00' },
      { now: duringTheRange },
    );
    expect(result).toEqual({ ok: false, message: '開始時間必須晚於現在' });
    expect(addOneMinute('19:00')).toBe('19:01');
    expect(addOneMinute('23:59')).toBeNull();
  });
});
