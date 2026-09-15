import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { runDailyCleanup } from '../src/services/cleanup';

describe('expired event cleanup', () => {
  it('does not delete events that only just ended; deletes past 30-day retention', async () => {
    const now = '2026-09-10T16:00:00.000Z';
    await env.DB.prepare(
      `INSERT INTO events (
        event_id, group_id, name, event_date, event_time, event_at, start_at, end_at, address,
        capacity, waitlist_enabled, status, organizer_line_user_id,
        organizer_display_name, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?, ?)`,
    )
      .bind(
        'just-ended-event',
        'G-test-group',
        '剛結束',
        '2026-09-01',
        '19:00',
        '2026-09-01T11:00:00.000Z',
        '2026-09-01T11:00:00.000Z',
        '2026-09-01T13:00:00.000Z',
        '台北',
        2,
        1,
        'U-org',
        '主揪',
        now,
        now,
      )
      .run();

    await env.DB.prepare(
      `INSERT INTO events (
        event_id, group_id, name, event_date, event_time, event_at, start_at, end_at, address,
        capacity, waitlist_enabled, status, organizer_line_user_id,
        organizer_display_name, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?, ?)`,
    )
      .bind(
        'old-ended-event',
        'G-test-group',
        '超過保留',
        '2026-07-01',
        '19:00',
        '2026-07-01T11:00:00.000Z',
        '2026-07-01T11:00:00.000Z',
        '2026-07-01T13:00:00.000Z',
        '台北',
        2,
        1,
        'U-org',
        '主揪',
        now,
        now,
      )
      .run();

    await env.DB.prepare(
      `INSERT INTO registrations (
        registration_id, event_id, type, status, waitlist_position,
        participant_name, line_user_id, created_by_line_user_id,
        created_by_display_name, created_at, updated_at
      ) VALUES (?, ?, 'SELF', 'CONFIRMED', NULL, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        'old-ended-reg',
        'old-ended-event',
        'Lee',
        'U-lee',
        'U-lee',
        'Lee',
        now,
        now,
      )
      .run();

    await env.DB.prepare(
      `INSERT INTO events (
        event_id, group_id, name, event_date, event_time, event_at, start_at, end_at, address,
        capacity, waitlist_enabled, status, organizer_line_user_id,
        organizer_display_name, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?, ?)`,
    )
      .bind(
        'future-event',
        'G-test-group',
        '未來活動',
        '2026-12-01',
        '19:00',
        '2026-12-01T11:00:00.000Z',
        '2026-12-01T11:00:00.000Z',
        '2026-12-01T13:00:00.000Z',
        '台北',
        2,
        1,
        'U-org',
        '主揪',
        now,
        now,
      )
      .run();

    const result = await runDailyCleanup(env.DB, new Date('2026-09-10T16:00:00.000Z'));
    expect(result.events).toBeGreaterThanOrEqual(1);

    const justEnded = await env.DB.prepare('SELECT * FROM events WHERE event_id = ?')
      .bind('just-ended-event')
      .first();
    const oldEnded = await env.DB.prepare('SELECT * FROM events WHERE event_id = ?')
      .bind('old-ended-event')
      .first();
    const future = await env.DB.prepare('SELECT * FROM events WHERE event_id = ?')
      .bind('future-event')
      .first();
    const leftoverReg = await env.DB.prepare('SELECT * FROM registrations WHERE event_id = ?')
      .bind('old-ended-event')
      .first();

    expect(justEnded).not.toBeNull();
    expect(oldEnded).toBeNull();
    expect(future).not.toBeNull();
    expect(leftoverReg).toBeNull();
  });
});
