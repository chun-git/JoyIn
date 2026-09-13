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
};
