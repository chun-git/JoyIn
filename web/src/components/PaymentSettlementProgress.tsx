import {
  PREORDER_SETTLEMENT_NO_PUSH_NOTICE,
  PREORDER_SETTLEMENT_STATUS_DETAIL,
  PREORDER_SETTLEMENT_STATUS_LABEL,
  type PreorderPaymentSettlement,
} from '../../../shared/types';
import { formatIsoDateTime, settlementStatusTone } from '../preorder-format';

export function PaymentSettlementProgress({
  settlement,
}: {
  settlement: PreorderPaymentSettlement;
}) {
  return (
    <div className="preorder-settlement">
      <p className={`preorder-status tone-${settlementStatusTone(settlement.status)}`}>
        {PREORDER_SETTLEMENT_STATUS_LABEL[settlement.status]}
      </p>
      <p className="hint">{PREORDER_SETTLEMENT_STATUS_DETAIL[settlement.status]}</p>
      {settlement.history.length > 0 ? (
        <ul className="preorder-settlement-history">
          {settlement.history.map((entry) => (
            <li key={entry.historyId}>
              <div className="preorder-settlement-meta preorder-wrap">
                <strong>{entry.actorDisplayName}</strong>
                <span>{formatIsoDateTime(entry.createdAt)}</span>
              </div>
              {entry.note ? <p className="preorder-wrap">{entry.note}</p> : null}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="hint">{PREORDER_SETTLEMENT_NO_PUSH_NOTICE}</p>
    </div>
  );
}
