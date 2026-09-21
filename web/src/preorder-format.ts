import type {
  PreorderOfferStatus,
  PreorderOrderStatus,
  PreorderPaymentSettlementStatus,
} from '../../shared/types';
import { taipeiParts, toEventAt } from '../../shared/datetime';

export function formatIsoDateTime(iso: string): string {
  try {
    const { date, time } = taipeiParts(new Date(iso));
    const [y, m, d] = date.split('-');
    return `${y}年${Number(m)}月${Number(d)}日 ${time}`;
  } catch {
    return iso;
  }
}

/** datetime-local value in Asia/Taipei wall time. */
export function toDatetimeLocalValue(iso: string): string {
  const { date, time } = taipeiParts(new Date(iso));
  return `${date}T${time}`;
}

/** Parse datetime-local as Taipei wall time → UTC ISO. */
export function fromDatetimeLocalValue(value: string): string {
  const [date, time] = value.split('T');
  if (!date || !time) throw new Error('時間格式無效');
  return toEventAt(date, time.slice(0, 5));
}

export function offerStatusLabel(status: PreorderOfferStatus): string {
  switch (status) {
    case 'OPEN':
      return '開放中';
    case 'CLOSED':
      return '已關閉';
    case 'CANCELLED':
      return '已取消';
    default:
      return status;
  }
}

export function offerStatusTone(status: PreorderOfferStatus): 'open' | 'closed' | 'cancelled' {
  if (status === 'OPEN') return 'open';
  if (status === 'CLOSED') return 'closed';
  return 'cancelled';
}

export function orderStatusLabel(status: PreorderOrderStatus): string {
  switch (status) {
    case 'PENDING_PAYMENT':
      return '待付款';
    case 'PAYMENT_REPORTED':
      return '已回報付款';
    case 'PAYMENT_CONFIRMED':
      return '已確認付款';
    case 'FULFILLED':
      return '已完成';
    case 'CANCELLED':
      return '已取消';
    default:
      return status;
  }
}

export function orderStatusTone(
  status: PreorderOrderStatus,
): 'pending' | 'reported' | 'confirmed' | 'fulfilled' | 'cancelled' {
  switch (status) {
    case 'PENDING_PAYMENT':
      return 'pending';
    case 'PAYMENT_REPORTED':
      return 'reported';
    case 'PAYMENT_CONFIRMED':
      return 'confirmed';
    case 'FULFILLED':
      return 'fulfilled';
    case 'CANCELLED':
      return 'cancelled';
    default:
      return 'pending';
  }
}

export function settlementStatusTone(
  status: PreorderPaymentSettlementStatus,
): 'pending' | 'reported' | 'settled' {
  switch (status) {
    case 'AWAITING_RECEIPT_CHECK':
      return 'pending';
    case 'REFUND_PENDING':
      return 'reported';
    case 'PROVIDER_REPORTED_SETTLED':
      return 'settled';
    default:
      return 'pending';
  }
}
