import type { Context } from 'hono';
import type { AppEnv } from '../env';
import { AppError } from './errors';

export type PreorderLogMeta = {
  operation: string;
  offerPresent?: boolean | null;
  orderPresent?: boolean | null;
  idempotencyHit?: boolean | null;
  canCreatePreorder?: boolean | null;
  canOrder?: boolean | null;
  canManagePreorder?: boolean | null;
};

export function newRequestId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
}

/** Non-sensitive preorder observability — never log tokens, groupId, or user ids. */
export function logPreorderEvent(
  c: Context<AppEnv>,
  status: number,
  meta: PreorderLogMeta,
  errorCode?: string | null,
): void {
  const payload = {
    requestId: c.get('requestId') || 'unknown',
    route: c.req.routePath || c.req.path,
    method: c.req.method,
    status,
    errorCode: errorCode || null,
    operation: meta.operation,
    offerPresent: meta.offerPresent ?? null,
    orderPresent: meta.orderPresent ?? null,
    idempotencyHit: meta.idempotencyHit ?? null,
    canCreatePreorder: meta.canCreatePreorder ?? null,
    canOrder: meta.canOrder ?? null,
    canManagePreorder: meta.canManagePreorder ?? null,
  };
  if (status >= 500) {
    console.error('[JoyIn preorder]', payload);
  } else if (status >= 400) {
    console.info('[JoyIn preorder]', payload);
  } else {
    console.info('[JoyIn preorder]', payload);
  }
}

export function setPreorderMeta(c: Context<AppEnv>, meta: PreorderLogMeta): void {
  c.set('preorderMeta', meta);
}

export function errorCodeOf(err: unknown): string | null {
  if (err instanceof AppError) return err.code;
  return null;
}
