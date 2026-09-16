import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { liffAuth } from '../middleware/auth';
import { AppError, Errors } from '../lib/errors';
import { signLiffContext } from '../lib/liff-context';
import {
  handleRouteError,
  parseJson,
  requireBoolean,
  requireCapacity,
  requireDate,
  requireFeeAmount,
  requireGoogleMapsUrl,
  requireGroupId,
  requireString,
  requireTime,
  requireTimeRange,
  userOf,
} from '../lib/http';
import {
  closeEvent,
  copyEvent,
  createEvent,
  deleteEvent,
  getEventDetail,
  listEvents,
  listHistoryEvents,
  updateEvent,
} from '../services/events';
import {
  acceptTransferInvite,
  cancelTransferInvites,
  createTransferInvite,
  previewTransferInvite,
} from '../services/transfer';
import { cancelRegistration, joinProxy, joinSelf } from '../services/registrations';
import { buildPreselectMemberRoster } from '../services/group-members';
import {
  recoverContextFromEventId,
  refreshExpiredContext,
} from '../services/context-recovery';
import { preorderRoutes } from './preorders';
import { menuRoutes } from './menus';
import type { CopyEventInput, UpdateEventInput } from '../../../shared/types';

export const api = new Hono<AppEnv>();

api.onError((err, c) => {
  const { status, body } = handleRouteError(err);
  return c.json(body, status as 400 | 401 | 403 | 404 | 408 | 409 | 410 | 422 | 429 | 500 | 502);
});

function requirePreselectedMemberIds(value: unknown): string[] {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    throw Errors.validation('預選成員格式無效');
  }
  const ids = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
  return [...new Set(ids)];
}

function requirePreselectedProxyNames(value: unknown): string[] {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    throw Errors.validation('預選代報格式無效');
  }
  const names = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().replace(/\s+/g, ' '))
    .filter((item) => item.length > 0 && item.length <= 40);
  return names;
}

api.get('/health', (c) => c.json({ ok: true, service: 'joyin' }));

api.get('/config', (c) =>
  c.json({
    liffId: c.env.LIFF_ID || '',
    liffUrl: c.env.LIFF_URL || '',
    endpointUrl: c.env.LIFF_ENDPOINT_URL || 'https://joyin-web.pages.dev',
  }),
);

/** Local / test-only: mint a signed context token. Disabled when ALLOW_TEST_AUTH is not true. */
api.post('/dev/context', liffAuth, async (c) => {
  if (c.env.ALLOW_TEST_AUTH !== 'true') {
    throw Errors.notFound();
  }
  const body = parseJson<Record<string, unknown>>(await c.req.json());
  const groupId = requireString(body.groupId, 'groupId', 1, 64);
  const context = await signLiffContext(c.env.LIFF_CONTEXT_SIGNING_SECRET, groupId);
  return c.json({ context });
});

api.use('/events/*', liffAuth);
api.use('/events', liffAuth);
api.use('/registrations/*', liffAuth);
api.use('/transfer-invites/*', liffAuth);
api.use('/context/*', liffAuth);
api.use('/group/*', liffAuth);
api.use('/preorders/*', liffAuth);
api.use('/menus/*', liffAuth);
api.use('/menus', liffAuth);

api.route('/', preorderRoutes);
api.route('/', menuRoutes);

/**
 * Refresh an expired group context when HMAC is still valid and the user is a group member.
 * Body: { context: string } — never accepts client groupId.
 */
api.post('/context/refresh', async (c) => {
  const body = parseJson<Record<string, unknown>>(await c.req.json());
  const contextToken = requireString(body.context, 'context', 10, 2048);
  const result = await refreshExpiredContext({
    secret: c.env.LIFF_CONTEXT_SIGNING_SECRET,
    channelAccessToken: c.env.LINE_CHANNEL_ACCESS_TOKEN,
    contextToken,
    user: userOf(c),
    allowTestAuth: c.env.ALLOW_TEST_AUTH === 'true',
  });
  return c.json(result);
});

/**
 * Recover group context from a legacy deep link that only has eventId.
 * Never returns event payload; membership must succeed.
 */
api.post('/context/recover-event', async (c) => {
  const body = parseJson<Record<string, unknown>>(await c.req.json());
  const eventId = requireString(body.eventId, 'eventId', 8, 80);
  const result = await recoverContextFromEventId({
    db: c.env.DB,
    secret: c.env.LIFF_CONTEXT_SIGNING_SECRET,
    channelAccessToken: c.env.LINE_CHANNEL_ACCESS_TOKEN,
    eventId,
    user: userOf(c),
    allowTestAuth: c.env.ALLOW_TEST_AUTH === 'true',
  });
  return c.json(result);
});

api.get('/events', async (c) => {
  const groupId = requireGroupId(c);
  const events = await listEvents(c.env.DB, groupId);
  return c.json({ events });
});

api.get('/events/history', async (c) => {
  const groupId = requireGroupId(c);
  const events = await listHistoryEvents(c.env.DB, groupId, userOf(c));
  return c.json({ events });
});

/** Group members for organizer preselect — never returns groupId or tokens. */
api.get('/group/members', async (c) => {
  const groupId = requireGroupId(c);
  const forceRefresh = c.req.query('refresh') === '1';
  const copyEventId = (c.req.query('copyEventId') || '').trim();
  const result = await buildPreselectMemberRoster(
    c.env.DB,
    groupId,
    c.env.LINE_CHANNEL_ACCESS_TOKEN,
    { forceRefresh, copyEventId: copyEventId || undefined },
  );
  return c.json(result);
});

api.post('/events', async (c) => {
  const groupId = requireGroupId(c);
  const body = parseJson<Record<string, unknown>>(await c.req.json());
  const range = requireTimeRange(body);
  const event = await createEvent(
    c.env.DB,
    groupId,
    userOf(c),
    {
      name: requireString(body.name, '活動名稱', 1, 50),
      address: requireString(body.address, '活動地址', 1, 120),
      googleMapsUrl: requireGoogleMapsUrl(body.googleMapsUrl),
      feeAmount: requireFeeAmount(body.feeAmount ?? 0),
      capacity: requireCapacity(body.capacity),
      waitlistEnabled: requireBoolean(body.waitlistEnabled, '是否開放候補'),
      startDate: range.startDate,
      startTime: range.startTime,
      endDate: range.endDate,
      endTime: range.endTime,
      preselectedMemberIds: requirePreselectedMemberIds(body.preselectedMemberIds),
      preselectedProxyNames: requirePreselectedProxyNames(body.preselectedProxyNames),
    },
    { channelAccessToken: c.env.LINE_CHANNEL_ACCESS_TOKEN },
  );
  return c.json({ event }, 201);
});

api.get('/events/:eventId', async (c) => {
  const groupId = requireGroupId(c);
  const event = await getEventDetail(c.env.DB, c.req.param('eventId'), userOf(c), groupId);
  return c.json({ event });
});

api.patch('/events/:eventId', async (c) => {
  const groupId = requireGroupId(c);
  const body = parseJson<Record<string, unknown>>(await c.req.json());
  const input: UpdateEventInput = {};
  if (body.name !== undefined) input.name = requireString(body.name, '活動名稱', 1, 50);
  if (body.startDate !== undefined) input.startDate = requireDate(body.startDate, '開始日期');
  if (body.startTime !== undefined) input.startTime = requireTime(body.startTime, '開始時間');
  if (body.endDate !== undefined) input.endDate = requireDate(body.endDate, '結束日期');
  if (body.endTime !== undefined) input.endTime = requireTime(body.endTime, '結束時間');
  if (body.address !== undefined) input.address = requireString(body.address, '活動地址', 1, 120);
  if (body.googleMapsUrl !== undefined) input.googleMapsUrl = requireGoogleMapsUrl(body.googleMapsUrl);
  if (body.feeAmount !== undefined) input.feeAmount = requireFeeAmount(body.feeAmount);
  if (body.capacity !== undefined) input.capacity = requireCapacity(body.capacity);
  if (body.waitlistEnabled !== undefined) {
    input.waitlistEnabled = requireBoolean(body.waitlistEnabled, '是否開放候補');
  }
  if (body.confirmTimeLocationChange !== undefined) {
    input.confirmTimeLocationChange = requireBoolean(
      body.confirmTimeLocationChange,
      'confirmTimeLocationChange',
    );
  }
  const event = await updateEvent(c.env.DB, c.req.param('eventId'), userOf(c), groupId, input);
  return c.json({ event });
});

api.post('/events/:eventId/join', async (c) => {
  const groupId = requireGroupId(c);
  const registration = await joinSelf(c.env.DB, c.req.param('eventId'), userOf(c), groupId);
  return c.json({ registration }, 201);
});

api.post('/events/:eventId/proxy-join', async (c) => {
  const groupId = requireGroupId(c);
  const body = parseJson<Record<string, unknown>>(await c.req.json());
  const participantName = requireString(body.participantName, '參加者姓名', 1, 40);
  const registration = await joinProxy(
    c.env.DB,
    c.req.param('eventId'),
    userOf(c),
    groupId,
    participantName,
  );
  return c.json({ registration }, 201);
});

api.post('/events/:eventId/close', async (c) => {
  const groupId = requireGroupId(c);
  const event = await closeEvent(c.env.DB, c.req.param('eventId'), userOf(c), groupId);
  return c.json({ event });
});

api.delete('/events/:eventId', async (c) => {
  const groupId = requireGroupId(c);
  await deleteEvent(c.env.DB, c.req.param('eventId'), userOf(c), groupId);
  return c.json({ ok: true });
});

api.post('/events/:eventId/copy', async (c) => {
  const groupId = requireGroupId(c);
  const body = parseJson<Record<string, unknown>>(await c.req.json());
  const range = requireTimeRange(body);
  const input: CopyEventInput = {
    startDate: range.startDate,
    startTime: range.startTime,
    endDate: range.endDate,
    endTime: range.endTime,
  };
  if (body.name !== undefined) input.name = requireString(body.name, '活動名稱', 1, 50);
  if (body.address !== undefined) input.address = requireString(body.address, '活動地址', 1, 120);
  if (body.googleMapsUrl !== undefined) input.googleMapsUrl = requireGoogleMapsUrl(body.googleMapsUrl);
  if (body.feeAmount !== undefined) input.feeAmount = requireFeeAmount(body.feeAmount);
  if (body.capacity !== undefined) input.capacity = requireCapacity(body.capacity);
  if (body.waitlistEnabled !== undefined) {
    input.waitlistEnabled = requireBoolean(body.waitlistEnabled, '是否開放候補');
  }
  input.preselectedMemberIds = requirePreselectedMemberIds(body.preselectedMemberIds);
  input.preselectedProxyNames = requirePreselectedProxyNames(body.preselectedProxyNames);
  const event = await copyEvent(c.env.DB, c.req.param('eventId'), userOf(c), groupId, input, {
    channelAccessToken: c.env.LINE_CHANNEL_ACCESS_TOKEN,
  });
  return c.json({ event }, 201);
});

api.post('/events/:eventId/transfer-invites', async (c) => {
  const groupId = requireGroupId(c);
  const invite = await createTransferInvite(c.env.DB, c.req.param('eventId'), userOf(c), groupId);
  return c.json({ invite }, 201);
});

api.delete('/events/:eventId/transfer-invites', async (c) => {
  const groupId = requireGroupId(c);
  await cancelTransferInvites(c.env.DB, c.req.param('eventId'), userOf(c), groupId);
  return c.json({ ok: true });
});

api.get('/transfer-invites/:token', async (c) => {
  const invite = await previewTransferInvite(c.env.DB, c.req.param('token'), userOf(c));
  return c.json({ invite });
});

api.post('/transfer-invites/:token/accept', async (c) => {
  const event = await acceptTransferInvite(c.env.DB, c.req.param('token'), userOf(c));
  return c.json({ event });
});

api.delete('/registrations/:registrationId', async (c) => {
  const groupId = requireGroupId(c);
  const result = await cancelRegistration(
    c.env.DB,
    c.req.param('registrationId'),
    userOf(c),
    groupId,
  );
  return c.json({ ok: true, ...result });
});

api.notFound((c) => {
  throw new AppError(404, 'NOT_FOUND', '找不到 API');
});
