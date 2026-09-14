import { describe, expect, it } from 'vitest';
import type { RegistrationRecord } from '../../shared/types';
import {
  cancelConfirmCopy,
  cancelListButtonLabel,
} from './cancel-registration-copy';

function record(overrides: Partial<RegistrationRecord>): RegistrationRecord {
  return {
    registrationId: 'r1',
    eventId: 'e1',
    type: 'SELF',
    status: 'CONFIRMED',
    registrationSource: 'SELF_JOIN',
    waitlistPosition: null,
    participantName: 'Lee',
    displayLabel: 'Lee',
    lineUserId: 'U-lee',
    participantLineUserId: 'U-lee',
    createdByLineUserId: 'U-lee',
    createdByDisplayName: 'Lee',
    createdAt: '2026-09-10T00:00:00.000Z',
    canCancel: true,
    ...overrides,
  };
}

describe('cancelConfirmCopy', () => {
  it('uses self-cancel copy for confirmed self registration', () => {
    expect(cancelConfirmCopy(record({}))).toEqual({
      title: '確認取消報名？',
      body: '確定要取消自己的報名嗎？',
      confirmLabel: '確認取消',
    });
    expect(cancelListButtonLabel(record({}))).toBe('取消');
  });

  it('shows proxy participant name in confirm body', () => {
    const item = record({
      type: 'PROXY',
      participantName: 'Amy',
      displayLabel: 'Amy（Lee 代報）',
    });
    expect(cancelConfirmCopy(item)).toEqual({
      title: '確認取消代報？',
      body: '確定要取消「Amy」的報名嗎？',
      confirmLabel: '確認取消',
    });
  });

  it('labels waitlist cancel clearly', () => {
    const item = record({ status: 'WAITLIST', waitlistPosition: 1 });
    expect(cancelListButtonLabel(item)).toBe('取消候補');
    expect(cancelConfirmCopy(item).title).toBe('確認取消候補？');
  });
});
