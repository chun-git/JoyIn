/** User-facing copy for expired / failed LIFF auth (no auto logout/login loops). */

export const AUTH_EXPIRED_TITLE = 'LINE 登入狀態已失效';

export const AUTH_EXPIRED_BODY = '請重新登入 LINE 後繼續查看活動。';

export const AUTH_RELOGIN_BUTTON = '重新登入 LINE';

/** @deprecated External browser is allowed; kept only for legacy string checks in tests. */
export const AUTH_EXTERNAL_BROWSER_MESSAGE = '請使用 LINE 開啟 JoyIn';

export const AUTH_LOGIN_FAILED_TITLE = '無法登入 LINE';

export const AUTH_LOGIN_FAILED_BODY =
  '請重新登入，或回到 LINE 群組從最新活動卡片開啟。';

export const AUTH_REDIRECTING_LOGIN = '正在前往 LINE 登入…';

export const CONTEXT_MISSING_TITLE = '缺少群組活動資訊';

export const CONTEXT_MISSING_BODY =
  '請回到 LINE 群組輸入 /list，並從新的活動卡片開啟。';

export const CONTEXT_EXPIRED_TITLE = '群組活動連結已失效';

export const CONTEXT_EXPIRED_BODY = '無法確認你仍在此群組，請重新輸入 /list。';

export const SERVER_ERROR_TITLE = '無法載入活動';
