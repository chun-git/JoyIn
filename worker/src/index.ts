import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Bindings } from './env';
import { api } from './routes/api';
import { handleLineWebhook } from './services/webhook';
import { runDailyCleanup } from './services/cleanup';

const app = new Hono<{ Bindings: Bindings }>();

app.use(
  '/api/*',
  cors({
    origin: (origin) => origin || '*',
    allowHeaders: ['Content-Type', 'Authorization', 'X-JoyIn-Context', 'Idempotency-Key'],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    maxAge: 86400,
  }),
);

app.route('/api', api);

app.post('/webhook/line', async (c) => {
  const rawBody = await c.req.arrayBuffer();
  const signature = c.req.header('X-Line-Signature');
  const result = await handleLineWebhook(c.env, signature ?? null, rawBody);
  if (!result.ok) {
    return c.json({ error: 'UNAUTHORIZED', message: 'LINE 簽章驗證失敗' }, 401);
  }
  return c.json({ ok: true }, 200);
});

async function handleFetch(
  request: Request,
  env: Bindings,
  ctx: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/webhook')) {
    return app.fetch(request, env, ctx);
  }
  if (env.ASSETS) {
    return env.ASSETS.fetch(request);
  }
  return new Response('Not Found', { status: 404 });
}

export default {
  fetch: handleFetch,
  async scheduled(_controller: ScheduledController, env: Bindings): Promise<void> {
    await runDailyCleanup(env.DB);
  },
};

export { app };
