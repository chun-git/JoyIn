import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import worker from '../src/index';

export const GROUP_ID = 'G-test-group';

export function authHeaders(userId: string, displayName: string, groupId = GROUP_ID): HeadersInit {
  return {
    Authorization: `Bearer test:${userId}:${encodeURIComponent(displayName)}`,
    'Content-Type': 'application/json',
    'X-Line-Group-Id': groupId,
  };
}

export async function request(path: string, init?: RequestInit): Promise<Response> {
  const request = new Request(`https://joyin.test${path}`, init);
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

export async function json<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const response = await request(path, init);
  const body = (await response.json()) as T;
  return { status: response.status, body };
}

export function futureDate(daysAhead = 14): { eventDate: string; eventTime: string } {
  const date = new Date('2026-12-01T12:00:00+08:00');
  date.setDate(date.getDate() + daysAhead);
  const eventDate = date.toISOString().slice(0, 10);
  return { eventDate, eventTime: '19:00' };
}

export async function createEvent(
  userId: string,
  displayName: string,
  overrides: Record<string, unknown> = {},
) {
  const { eventDate, eventTime } = futureDate();
  const payload = {
    name: '週五桌遊夜',
    eventDate,
    eventTime,
    address: '台北市中山區南京東路二段 1 號',
    capacity: 2,
    waitlistEnabled: true,
    ...overrides,
  };
  return json<{ event: { eventId: string } & Record<string, unknown> }>('/api/events', {
    method: 'POST',
    headers: authHeaders(userId, displayName),
    body: JSON.stringify(payload),
  });
}
