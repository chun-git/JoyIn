import { describe, expect, it } from 'vitest';
import { ApiError } from './api';
import { isPreorderConflict, preorderErrorMessage } from './preorder-errors';

describe('preorderErrorMessage', () => {
  it('maps known backend messages', () => {
    expect(preorderErrorMessage(new Error('尚未報名此活動，無法使用代訂功能'))).toContain('尚未報名');
    expect(preorderErrorMessage(new Error('候補狀態不可建立或訂購代訂'))).toContain('候補');
    expect(preorderErrorMessage(new Error('已超過訂購截止時間'))).toContain('截止');
    expect(preorderErrorMessage(new Error('商品數量不足，請調整後再試'))).toContain('數量不足');
    expect(preorderErrorMessage(new Error('已確認付款不可自行取消，請聯絡代訂者處理'))).toContain(
      '已確認付款不可自行取消',
    );
    expect(preorderErrorMessage(new Error('無權管理此代訂'))).toContain('無權管理');
    expect(preorderErrorMessage(new Error('代訂已關閉'))).toContain('已關閉');
    expect(preorderErrorMessage(new Error('Failed to fetch'))).toBe('連線失敗，請重新整理');
  });

  it('detects conflict status for reload', () => {
    expect(isPreorderConflict(new ApiError(409, 'CONFLICT', '訂單狀態已變更'))).toBe(true);
    expect(isPreorderConflict(new ApiError(400, 'VALIDATION', '壞'))).toBe(false);
  });
});
