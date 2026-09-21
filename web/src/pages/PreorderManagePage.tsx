import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  PREORDER_PAYMENT_DISCLAIMER,
  PREORDER_PROVIDER_CANCEL_CONFIRMED_HINT,
  PREORDER_PROVIDER_CANCEL_REPORTED_HINT,
  PREORDER_PROVIDER_REPORT_SETTLED_HINT,
  isOpenPaymentSettlement,
  type PreorderOfferDetail,
  type PreorderOfferOrderSummary,
  type PreorderOrder,
  type PreorderOrderStatus,
} from '../../../shared/types';
import { api } from '../api';
import { Modal } from '../components/Modal';
import { PaymentSettlementProgress } from '../components/PaymentSettlementProgress';
import { SiteNav } from '../components/SiteNav';
import { StateBlock } from '../components/StateBlock';
import type { LiffSession } from '../liff';
import { isPreorderConflict, preorderErrorMessage } from '../preorder-errors';
import {
  formatIsoDateTime,
  offerStatusLabel,
  offerStatusTone,
  orderStatusLabel,
  orderStatusTone,
} from '../preorder-format';
import { usePolling } from '../use-polling';

const STATUS_KEYS: PreorderOrderStatus[] = [
  'PENDING_PAYMENT',
  'PAYMENT_REPORTED',
  'PAYMENT_CONFIRMED',
  'FULFILLED',
  'CANCELLED',
];

export function PreorderManagePage({ session }: { session: LiffSession }) {
  const { offerId = '' } = useParams();
  const navigate = useNavigate();
  const [offer, setOffer] = useState<PreorderOfferDetail | null>(null);
  const [summary, setSummary] = useState<PreorderOfferOrderSummary | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [syncHint, setSyncHint] = useState('');
  const [cancelTarget, setCancelTarget] = useState<PreorderOrder | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelError, setCancelError] = useState('');
  const [settleTarget, setSettleTarget] = useState<PreorderOrder | null>(null);
  const [settleNote, setSettleNote] = useState('');
  const [settleError, setSettleError] = useState('');

  const reload = useCallback(
    async (signal?: AbortSignal) => {
      const [detail, sum] = await Promise.all([
        api.getPreorder(session, offerId),
        api.getPreorderSummary(session, offerId),
      ]);
      if (signal?.aborted) return;
      setOffer(detail.offer);
      setSummary(sum.summary);
    },
    [session, offerId],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void reload()
      .catch((err) => {
        if (cancelled) return;
        setError(preorderErrorMessage(err, '載入失敗'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reload]);

  usePolling(
    async (signal) => {
      await reload(signal);
    },
    {
      intervalMs: 10_000,
      enabled: Boolean(offerId) && !pending && !cancelTarget && !settleTarget,
      onConsecutiveFailures: () => setSyncHint('訂單同步暫時失敗，仍顯示目前內容'),
      onRecovered: () => setSyncHint(''),
    },
  );

  async function run(action: () => Promise<unknown>, success: string): Promise<boolean> {
    setPending(true);
    setError('');
    try {
      await action();
      await reload();
      setNotice(success);
      return true;
    } catch (err) {
      setError(preorderErrorMessage(err, '操作失敗'));
      if (isPreorderConflict(err)) {
        try {
          await reload();
        } catch {
          /* keep */
        }
      }
      return false;
    } finally {
      setPending(false);
    }
  }

  function openCancelModal(order: PreorderOrder) {
    setCancelTarget(order);
    setCancelReason('');
    setCancelError('');
  }

  function closeCancelModal() {
    if (pending) return;
    setCancelTarget(null);
    setCancelReason('');
    setCancelError('');
  }

  function openSettleModal(order: PreorderOrder) {
    setSettleTarget(order);
    setSettleNote('');
    setSettleError('');
  }

  function closeSettleModal() {
    if (pending) return;
    setSettleTarget(null);
    setSettleNote('');
    setSettleError('');
  }

  function cancelHintFor(order: PreorderOrder): string | null {
    if (order.status === 'PAYMENT_REPORTED') return PREORDER_PROVIDER_CANCEL_REPORTED_HINT;
    if (order.status === 'PAYMENT_CONFIRMED') return PREORDER_PROVIDER_CANCEL_CONFIRMED_HINT;
    return null;
  }

  async function submitCancelOrder() {
    if (!cancelTarget) return;
    const reason = cancelReason.trim();
    if (reason.length < 1 || reason.length > 200) {
      setCancelError('請輸入 1 到 200 字的取消原因');
      return;
    }
    setCancelError('');
    const ok = await run(
      () => api.cancelPreorderOrder(session, offerId, cancelTarget.orderId, reason),
      '已取消訂單',
    );
    if (ok) {
      setCancelTarget(null);
      setCancelReason('');
      setCancelError('');
    }
  }

  async function submitSettlementHandled() {
    if (!settleTarget) return;
    const note = settleNote.trim();
    if (note.length < 1 || note.length > 200) {
      setSettleError('請輸入 1 到 200 字的處理說明');
      return;
    }
    setSettleError('');
    const ok = await run(
      () => api.reportPreorderSettlementHandled(session, offerId, settleTarget.orderId, note),
      '已回報處理',
    );
    if (ok) {
      setSettleTarget(null);
      setSettleNote('');
      setSettleError('');
    }
  }

  if (loading) return <StateBlock kind="loading" title="載入代訂管理…" />;
  if (error && !offer) {
    return (
      <StateBlock kind="error" title="無法載入代訂管理">
        {error}
      </StateBlock>
    );
  }
  if (!offer || !summary) return null;

  return (
    <div className="stack preorder-manage-page">
      <SiteNav current="events" />
      <div className="detail-back-row">
        <button className="btn-back" type="button" onClick={() => navigate(`/events/${offer.eventId}`)}>
          <span>返回活動</span>
        </button>
      </div>

      {notice ? <div className="toast">{notice}</div> : null}
      {syncHint ? <p className="hint">{syncHint}</p> : null}
      {error ? <p className="error">{error}</p> : null}

      <section className="panel stack">
        <div className="section-heading">
          <h1 className="preorder-wrap">{offer.title}</h1>
          <span className={`preorder-status tone-${offerStatusTone(offer.status)}`}>
            {offerStatusLabel(offer.status)}
          </span>
        </div>
        <p className="hint preorder-wrap">店家：{offer.merchantName}</p>
        <p className="hint">截止：{formatIsoDateTime(offer.orderDeadline)}</p>
        <p className="hint">{PREORDER_PAYMENT_DISCLAIMER}</p>
        <div className="row">
          <Link className="btn secondary" to={`/preorders/${offerId}`}>
            查看訂購頁
          </Link>
          <Link className="btn secondary" to={`/preorders/${offerId}/edit`}>
            編輯代訂
          </Link>
          {offer.status === 'OPEN' ? (
            <button
              className="btn secondary"
              type="button"
              disabled={pending}
              onClick={() => {
                if (window.confirm('確定關閉代訂？關閉後無法再下單。')) {
                  void run(() => api.closePreorder(session, offerId), '已關閉代訂');
                }
              }}
            >
              關閉代訂
            </button>
          ) : null}
        </div>
      </section>

      <section className="panel stack">
        <h2>訂單彙總</h2>
        <div className="preorder-stats-grid">
          <div className="preorder-stat">
            <span className="hint">總訂單數</span>
            <strong>{summary.orderCount}</strong>
          </div>
          <div className="preorder-stat">
            <span className="hint">應收總額</span>
            <strong>${summary.totalReceivable}</strong>
          </div>
          {STATUS_KEYS.map((status) => (
            <div className={`preorder-stat tone-${orderStatusTone(status)}`} key={status}>
              <span className="hint">{orderStatusLabel(status)}</span>
              <strong>{summary.countsByStatus[status] || 0}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="panel stack">
        <h2>商品訂購彙總</h2>
        {summary.productAggregates.length === 0 ? <p className="hint">尚無訂購</p> : null}
        {summary.productAggregates.map((item) => (
          <div className="list-item" key={item.productId}>
            <div className="list-item-main">
              <strong className="preorder-wrap">{item.name}</strong>
              {item.specification ? <div className="hint preorder-wrap">{item.specification}</div> : null}
              <div className="hint">
                單價 ${item.unitPrice} · 數量 {item.totalQuantity} · 小計 ${item.subtotal}
              </div>
            </div>
          </div>
        ))}
      </section>

      <section className="panel stack">
        <h2>訂購者明細</h2>
        {summary.orders.length === 0 ? <p className="hint">尚無訂單</p> : null}
        {summary.orders.map((order) => (
          <article className="preorder-order-card" key={order.orderId}>
            <div className="section-heading">
              <strong className="preorder-wrap">{order.buyerDisplayName}</strong>
              <span className={`preorder-status tone-${orderStatusTone(order.status)}`}>
                {orderStatusLabel(order.status)}
              </span>
            </div>
            <p className="hint">總額 ${order.totalAmount}</p>
            <ul className="preorder-summary-list">
              {order.items.map((item) => (
                <li key={item.orderItemId} className="preorder-wrap">
                  {item.productNameSnapshot}
                  {item.specificationSnapshot ? `（${item.specificationSnapshot}）` : ''} ×{' '}
                  {item.quantity} = ${item.subtotal}
                  {item.options.length ? (
                    <small className="preorder-item-options">
                      {item.options
                        .map((option) =>
                          option.textValueSnapshot
                            ? `${option.groupNameSnapshot}：${option.textValueSnapshot}`
                            : `${option.groupNameSnapshot}：${option.optionNameSnapshot}${
                                option.priceAdjustmentSnapshot
                                  ? ` ${option.priceAdjustmentSnapshot > 0 ? '+' : ''}$${option.priceAdjustmentSnapshot}`
                                  : ''
                              }`,
                        )
                        .join('、')}
                    </small>
                  ) : null}
                </li>
              ))}
            </ul>
            {order.cancellationReason ? (
              <p className="hint preorder-wrap">取消原因：{order.cancellationReason}</p>
            ) : null}
            {order.paymentSettlement ? (
              <PaymentSettlementProgress settlement={order.paymentSettlement} />
            ) : null}
            <div className="row preorder-card-actions">
              {order.status === 'PAYMENT_REPORTED' || order.status === 'PENDING_PAYMENT' ? (
                <button
                  className="btn btn-compact"
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    void run(
                      () => api.confirmPreorderPayment(session, offerId, order.orderId),
                      '已確認收款',
                    )
                  }
                >
                  確認收款
                </button>
              ) : null}
              {order.status === 'PAYMENT_CONFIRMED' ? (
                <button
                  className="btn btn-compact"
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    void run(
                      () => api.fulfillPreorderOrder(session, offerId, order.orderId),
                      '已標記完成',
                    )
                  }
                >
                  標記完成
                </button>
              ) : null}
              {isOpenPaymentSettlement(order.paymentSettlement) ? (
                <button
                  className="btn secondary btn-compact"
                  type="button"
                  disabled={pending}
                  onClick={() => openSettleModal(order)}
                >
                  回報已處理
                </button>
              ) : null}
              {order.status !== 'CANCELLED' && order.status !== 'FULFILLED' ? (
                <button
                  className="btn danger btn-compact"
                  type="button"
                  disabled={pending}
                  onClick={() => openCancelModal(order)}
                >
                  取消訂單
                </button>
              ) : null}
            </div>
          </article>
        ))}
      </section>

      <Modal
        open={Boolean(cancelTarget)}
        title="取消訂單"
        onClose={closeCancelModal}
        initialFocus="first"
      >
        <div className="stack modal-body">
          {cancelTarget && cancelHintFor(cancelTarget) ? (
            <p className="hint">{cancelHintFor(cancelTarget)}</p>
          ) : (
            <p className="hint">請輸入取消原因</p>
          )}
          <label className="field">
            <span>取消原因（1–200 字）</span>
            <textarea
              rows={3}
              maxLength={200}
              value={cancelReason}
              disabled={pending}
              onChange={(event) => setCancelReason(event.target.value)}
            />
          </label>
          {cancelError ? <p className="error modal-inline-error">{cancelError}</p> : null}
        </div>
        <div className="modal-actions">
          <button className="btn secondary" type="button" disabled={pending} onClick={closeCancelModal}>
            返回
          </button>
          <button className="btn danger" type="button" disabled={pending} onClick={() => void submitCancelOrder()}>
            {pending ? '處理中…' : '確認取消'}
          </button>
        </div>
      </Modal>

      <Modal
        open={Boolean(settleTarget)}
        title="回報已處理"
        onClose={closeSettleModal}
        initialFocus="first"
      >
        <div className="stack modal-body">
          <p className="hint">{PREORDER_PROVIDER_REPORT_SETTLED_HINT}</p>
          <label className="field">
            <span>處理說明（1–200 字）</span>
            <textarea
              rows={3}
              maxLength={200}
              value={settleNote}
              disabled={pending}
              onChange={(event) => setSettleNote(event.target.value)}
            />
          </label>
          {settleError ? <p className="error modal-inline-error">{settleError}</p> : null}
        </div>
        <div className="modal-actions">
          <button className="btn secondary" type="button" disabled={pending} onClick={closeSettleModal}>
            返回
          </button>
          <button className="btn" type="button" disabled={pending} onClick={() => void submitSettlementHandled()}>
            {pending ? '送出中…' : '確認回報'}
          </button>
        </div>
      </Modal>
    </div>
  );
}
