import type { Bindings } from '../env';
import { verifyLineSignature } from '../lib/line-signature';
import { buildEventCarousel } from '../lib/line-flex';
import { buildLiffUrlWithContext, signLiffContext } from '../lib/liff-context';
import { nowIso } from '../lib/datetime';
import { insertWebhookEvent } from '../db/repo';
import { listEvents } from './events';

interface LineWebhookBody {
  destination?: string;
  events?: LineEvent[];
}

interface LineEvent {
  type: string;
  webhookEventId?: string;
  replyToken?: string;
  message?: {
    type: string;
    text?: string;
  };
  source?: {
    type?: string;
    groupId?: string;
    userId?: string;
  };
}

async function replyMessage(
  accessToken: string,
  replyToken: string,
  message: unknown,
): Promise<void> {
  const response = await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      replyToken,
      messages: [message],
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    console.error('LINE reply failed', response.status, text);
  }
}

export async function handleLineWebhook(
  env: Bindings,
  signature: string | null,
  rawBody: ArrayBuffer,
): Promise<{ ok: boolean; status: number }> {
  const valid = await verifyLineSignature(env.LINE_CHANNEL_SECRET, rawBody, signature);
  if (!valid) {
    return { ok: false, status: 401 };
  }

  const decoder = new TextDecoder();
  const body = JSON.parse(decoder.decode(rawBody)) as LineWebhookBody;
  const events = body.events ?? [];

  for (const event of events) {
    const webhookEventId = event.webhookEventId || crypto.randomUUID();
    const inserted = await insertWebhookEvent(
      env.DB,
      webhookEventId,
      event.type,
      nowIso(),
    );
    if (!inserted) {
      continue;
    }

    if (event.type !== 'message' || event.message?.type !== 'text') {
      continue;
    }
    if (event.source?.type !== 'group' || !event.source.groupId) {
      continue;
    }

    const text = (event.message.text || '').trim();
    if (text !== '/list') {
      continue;
    }
    if (!event.replyToken) {
      continue;
    }

    const groupId = event.source.groupId;
    if (!env.LIFF_CONTEXT_SIGNING_SECRET) {
      console.error('LIFF_CONTEXT_SIGNING_SECRET is not configured; cannot reply to /list');
      continue;
    }

    // Official group key = webhook source.groupId only
    const upcoming = await listEvents(env.DB, groupId, 5);
    const contextToken = await signLiffContext(env.LIFF_CONTEXT_SIGNING_SECRET, groupId);
    const baseUrl = env.LIFF_URL || `https://liff.line.me/${env.LIFF_ID}`;
    const liffUrl = buildLiffUrlWithContext(baseUrl, contextToken);
    const flex = buildEventCarousel(upcoming, liffUrl);
    await replyMessage(env.LINE_CHANNEL_ACCESS_TOKEN, event.replyToken, flex);
  }

  return { ok: true, status: 200 };
}
