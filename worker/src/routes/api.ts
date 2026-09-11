import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { liffAuth } from '../middleware/auth';
import { AppError } from '../lib/errors';
import {
  eventAtFromParts,
  handleRouteError,
  parseJson,
  requireBoolean,
  requireCapacity,
  requireDate,
  requireGroupId,
  requireString,
  requireTime,
  userOf,
} from '../lib/http';
import {
  closeEvent,
  createEvent,
  deleteEvent,
  getEventDetail,
  listEvents,
  transferOrganizer,
  updateEvent,
} from '../services/events';
import { cancelRegistration, joinProxy, joinSelf } from '../services/registrations';
import type { UpdateEventInput } from '../../../shared/types';

export const api = new Hono<AppEnv>();

api.onError((err, c) => {
  const { status, body } = handleRouteError(err);
  return c.json(body, status as 400 | 401 | 403 | 404 | 409 | 410 | 500);
});

api.get('/health', (c) => c.json({ ok: true, service: 'joyin' }));

api.get('/config', (c) =>
  c.json({
    liffId: c.env.LIFF_ID || '',
    liffUrl: c.env.LIFF_URL || '',
  }),
);

api.use('/events/*', liffAuth);
api.use('/events', liffAuth);
api.use('/registrations/*', liffAuth);

api.get('/events', async (c) => {
  const groupId = requireGroupId(c);
  const events = await listEvents(c.env.DB, groupId);
  return c.json({ events });
});

api.post('/events', async (c) => {
  const groupId = requireGroupId(c);
  const body = parseJson<Record<string, unknown>>(await c.req.json());
  const event = await createEvent(c.env.DB, groupId, userOf(c), {
    name: requireString(body.name, '活動名稱', 1, 50),
    eventDate: requireDate(body.eventDate),
    eventTime: requireTime(body.eventTime),
    address: requireString(body.address, '活動地址', 1, 120),
    capacity: requireCapacity(body.capacity),
    waitlistEnabled: requireBoolean(body.waitlistEnabled, '是否開放候補'),
  });
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
  if (body.eventDate !== undefined) input.eventDate = requireDate(body.eventDate);
  if (body.eventTime !== undefined) input.eventTime = requireTime(body.eventTime);
  if (body.address !== undefined) input.address = requireString(body.address, '活動地址', 1, 120);
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
  if (input.eventDate && input.eventTime) {
    eventAtFromParts(input.eventDate, input.eventTime);
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

api.post('/events/:eventId/transfer-organizer', async (c) => {
  const groupId = requireGroupId(c);
  const body = parseJson<Record<string, unknown>>(await c.req.json());
  const event = await transferOrganizer(
    c.env.DB,
    c.req.param('eventId'),
    userOf(c),
    groupId,
    requireString(body.toLineUserId, '新主揪 LINE User ID', 1, 64),
    requireString(body.toDisplayName, '新主揪顯示名稱', 1, 40),
  );
  return c.json({ event });
});

api.delete('/registrations/:registrationId', async (c) => {
  const groupId = c.req.header('X-Line-Group-Id') || undefined;
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
