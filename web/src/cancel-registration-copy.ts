import type { RegistrationRecord } from '../../shared/types';

export function isProxyRegistration(item: RegistrationRecord): boolean {
  return item.type === 'PROXY';
}

export function isWaitlistRegistration(item: RegistrationRecord): boolean {
  return item.status === 'WAITLIST';
}

export function cancelListButtonLabel(item: RegistrationRecord): string {
  return isWaitlistRegistration(item) ? '取消候補' : '取消';
}

export function cancelConfirmCopy(item: RegistrationRecord): {
  title: string;
  body: string;
  confirmLabel: string;
} {
  const waitlist = isWaitlistRegistration(item);
  if (isProxyRegistration(item)) {
    return {
      title: '確認取消代報？',
      body: waitlist
        ? `確定要取消「${item.participantName}」的候補嗎？`
        : `確定要取消「${item.participantName}」的報名嗎？`,
      confirmLabel: '確認取消',
    };
  }
  if (waitlist) {
    return {
      title: '確認取消候補？',
      body: '確定要取消自己的候補嗎？',
      confirmLabel: '確認取消',
    };
  }
  return {
    title: '確認取消報名？',
    body: '確定要取消自己的報名嗎？',
    confirmLabel: '確認取消',
  };
}
