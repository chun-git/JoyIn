import { Modal } from './Modal';
import { cancelConfirmCopy } from '../cancel-registration-copy';
import type { EventPreorderCancelImpact, RegistrationRecord } from '../../../shared/types';

export function CancelRegistrationDialog({
  item,
  pending,
  error,
  preorderImpact,
  onDismiss,
  onConfirm,
}: {
  item: RegistrationRecord | null;
  pending: boolean;
  error: string;
  preorderImpact?: EventPreorderCancelImpact | null;
  onDismiss: () => void;
  onConfirm: () => void;
}) {
  if (!item) return null;
  const copy = cancelConfirmCopy(item);
  const blocked = Boolean(preorderImpact?.blocked);
  const pendingOrders = preorderImpact?.pendingCancelCount ?? 0;

  return (
    <Modal open title={copy.title} onClose={onDismiss} initialFocus="safe">
      <p className="modal-body">{copy.body}</p>
      {pendingOrders > 0 && !blocked ? (
        <p className="modal-body">
          你仍有 {pendingOrders} 筆未完成的代訂訂單，取消報名時會一併取消這些尚未確認付款的訂單。
        </p>
      ) : null}
      {blocked && preorderImpact?.message ? (
        <p className="error modal-inline-error">{preorderImpact.message}</p>
      ) : null}
      {error ? <p className="error modal-inline-error">{error}</p> : null}
      <div className="modal-actions">
        <button className="btn secondary" type="button" disabled={pending} onClick={onDismiss} autoFocus>
          返回
        </button>
        <button
          className="btn danger"
          type="button"
          disabled={pending || blocked}
          onClick={onConfirm}
        >
          {pending ? '處理中…' : copy.confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
