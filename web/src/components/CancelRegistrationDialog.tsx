import { Modal } from './Modal';
import { cancelConfirmCopy } from '../cancel-registration-copy';
import type { RegistrationRecord } from '../../../shared/types';

export function CancelRegistrationDialog({
  item,
  pending,
  error,
  onDismiss,
  onConfirm,
}: {
  item: RegistrationRecord | null;
  pending: boolean;
  error: string;
  onDismiss: () => void;
  onConfirm: () => void;
}) {
  if (!item) return null;
  const copy = cancelConfirmCopy(item);

  return (
    <Modal open title={copy.title} onClose={onDismiss} initialFocus="safe">
      <p className="modal-body">{copy.body}</p>
      {error ? <p className="error modal-inline-error">{error}</p> : null}
      <div className="modal-actions">
        <button className="btn secondary" type="button" disabled={pending} onClick={onDismiss} autoFocus>
          返回
        </button>
        <button className="btn danger" type="button" disabled={pending} onClick={onConfirm}>
          {pending ? '處理中…' : copy.confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
