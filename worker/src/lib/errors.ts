export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const Errors = {
  unauthorized: (message = '請先透過 LIFF 登入') =>
    new AppError(401, 'UNAUTHORIZED', message),
  forbidden: (message = '沒有權限執行此操作') =>
    new AppError(403, 'FORBIDDEN', message),
  notFound: (message = '找不到資料') => new AppError(404, 'NOT_FOUND', message),
  conflict: (message: string) => new AppError(409, 'CONFLICT', message),
  validation: (message: string) => new AppError(400, 'VALIDATION', message),
  gone: (message = '活動已結束') => new AppError(410, 'GONE', message),
  payload: (message = '請求內容無效') => new AppError(400, 'INVALID_PAYLOAD', message),
  transferInviteUsed: (message = '此主揪轉移連結已使用') =>
    new AppError(410, 'transfer_invite_used', message),
  transferInviteExpired: (message = '此主揪轉移連結已過期') =>
    new AppError(410, 'transfer_invite_expired', message),
  transferInviteInvalid: (message = '此主揪轉移連結已失效') =>
    new AppError(410, 'transfer_invite_cancelled', message),
  /** Activity ended by schedule — valid group context may still exist. */
  eventEnded: (message = '此活動已結束') => new AppError(410, 'event_ended', message),
  /** Soft-deleted activity. */
  eventDeleted: (message = '此活動已刪除') => new AppError(410, 'event_deleted', message),
  /** Missing or not in this group — never leak cross-group existence. */
  eventNotFound: (message = '找不到此活動') => new AppError(404, 'event_not_found', message),
  /** Shared external message for failed legacy recovery / membership. */
  linkUnrecoverable: (message = '此活動連結已失效，請回群組重新輸入 /list') =>
    new AppError(403, 'link_unrecoverable', message),
  rateLimited: (message = '操作過於頻繁，請稍後再試') =>
    new AppError(429, 'rate_limited', message),
  groupMembersUnavailable: (message = '暫時無法取得群組成員') =>
    new AppError(502, 'group_members_unavailable', message),
};
