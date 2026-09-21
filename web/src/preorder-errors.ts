import { ApiError } from './api';

/** Map API failures to stable Traditional Chinese copy for preorder UIs. */
export function preorderErrorMessage(err: unknown, fallback = '操作失敗'): string {
  if (!(err instanceof Error)) return fallback;
  if (!(err instanceof ApiError) && err.message === 'Failed to fetch') {
    return '連線失敗，請重新整理';
  }
  const message = err.message || fallback;
  if (/Failed to fetch|NetworkError|Load failed|network/i.test(message)) {
    return '連線失敗，請重新整理';
  }
  if (message.includes('尚未報名') || message.includes('未報名')) {
    return '尚未報名此活動，無法使用代訂功能';
  }
  if (message.includes('候補')) {
    return '候補狀態不可建立或訂購代訂';
  }
  if (message.includes('截止')) {
    return '已超過訂購截止時間';
  }
  if (message.includes('數量不足') || message.includes('剩餘')) {
    return '商品數量不足，請調整後再試';
  }
  if (message.includes('已確認付款不可自行取消')) {
    return '已確認付款不可自行取消，請聯絡代訂者處理';
  }
  if (message.includes('訂單狀態已變更') || message.includes('請重新整理')) {
    return '訂單狀態已變更，請重新整理後再試';
  }
  if (message.includes('無權管理')) {
    return '無權管理此代訂';
  }
  if (message.includes('已關閉')) {
    return '代訂已關閉';
  }
  if (message.includes('已取消') && message.includes('代訂')) {
    return '代訂已取消';
  }
  if (message.includes('已回報處理，無需重複回報')) {
    return '已回報處理，無需重複回報';
  }
  if (message.includes('此訂單無需款項處理紀錄')) {
    return '此訂單無需款項處理紀錄';
  }
  return message || fallback;
}

export function isPreorderConflict(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 409 || err.status === 410);
}
