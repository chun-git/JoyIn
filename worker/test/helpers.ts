import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import worker from '../src/index';
import { signLiffContext } from '../src/lib/liff-context';

export const GROUP_ID = 'G-test-group';

export async function authHeaders(
  userId: string,
  displayName: string,
  groupId = GROUP_ID,
): Promise<HeadersInit> {
  const context = await signLiffContext(env.LIFF_CONTEXT_SIGNING_SECRET, groupId);
  return {
    Authorization: `Bearer test:${userId}:${encodeURIComponent(displayName)}`,
    'Content-Type': 'application/json',
    'X-JoyIn-Context': context,
  };
}

export function authOnlyHeaders(userId: string, displayName: string): HeadersInit {
  return {
    Authorization: `Bearer test:${userId}:${encodeURIComponent(displayName)}`,
    'Content-Type': 'application/json',
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

export function futureRange(daysAhead = 14, durationHours = 2) {
  const start = new Date('2026-12-01T12:00:00+08:00');
  start.setDate(start.getDate() + daysAhead);
  const end = new Date(start.getTime() + durationHours * 60 * 60 * 1000);
  const startDate = start.toISOString().slice(0, 10);
  const endDate = end.toISOString().slice(0, 10);
  return {
    startDate,
    startTime: '19:00',
    endDate,
    endTime: '21:00',
  };
}

export async function createEvent(
  userId: string,
  displayName: string,
  overrides: Record<string, unknown> = {},
) {
  const payload = {
    name: '週五桌遊夜',
    ...futureRange(),
    address: '台北市中山區南京東路二段 1 號',
    capacity: 2,
    waitlistEnabled: true,
    ...overrides,
  };
  return json<{ event: { eventId: string } & Record<string, unknown> }>('/api/events', {
    method: 'POST',
    headers: await authHeaders(userId, displayName),
    body: JSON.stringify(payload),
  });
}
