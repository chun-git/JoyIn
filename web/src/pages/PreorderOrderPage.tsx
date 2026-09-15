import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  PREORDER_PAYMENT_DISCLAIMER,
  type PreorderOfferDetail,
  type PreorderOrder,
} from '../../../shared/types';
import { api } from '../api';
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

export function PreorderOrderPage({ session }: { session: LiffSession }) {
  const { offerId = '' } = useParams();
  const navigate = useNavigate();
  const [offer, setOffer] = useState<PreorderOfferDetail | null>(null);
  const [order, setOrder] = useState<PreorderOrder | null>(null);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const [syncHint, setSyncHint] = useState('');

  const applyQtyFromServer = (detail: PreorderOfferDetail, mine: PreorderOrder | null) => {
    const next: Record<string, number> = {};
    for (const product of detail.products) {
      next[product.productId] = 0;
    }
    if (mine) {
      for (const item of mine.items) {
        next[item.productId] = item.quantity;
      }
    }
    setQty(next);
    dirtyRef.current = false;
    setDirty(false);
  };

  const reload = useCallback(
    async (options?: { forceQty?: boolean; signal?: AbortSignal }) => {
      const [detail, mine] = await Promise.all([
        api.getPreorder(session, offerId),
        api.getMyPreorderOrder(session, offerId),
      ]);
      if (options?.signal?.aborted) return;
      setOffer(detail.offer);
      setOrder(mine.order);
      if (options?.forceQty || !dirtyRef.current) {
        applyQtyFromServer(detail.offer, mine.order);
      }
    },
    [session, offerId],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    void reload({ forceQty: true })
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
      await reload({ signal });
    },
    {
      intervalMs: 10_000,
      enabled: Boolean(offerId) && !confirmOpen && !pending,
      pauseWhen: dirty,
      onConsecutiveFailures: () => setSyncHint('商品資料同步暫時失敗，仍顯示目前內容'),
      onRecovered: () => setSyncHint(''),
    },
  );

  const lines = useMemo(() => {
    if (!offer) return [];
    return offer.products
      .filter((p) => p.isActive || (qty[p.productId] || 0) > 0)
      .map((product) => {
        const quantity = qty[product.productId] || 0;
        const unitPrice =
          order?.items.find((i) => i.productId === product.productId)?.unitPriceSnapshot ??
          product.unitPrice;
        return {
          product,
          quantity,
          unitPrice,
          subtotal: unitPrice * quantity,
        };
      });
  }, [offer, qty, order]);

  const total = lines.reduce((sum, line) => sum + line.subtotal, 0);
  const selected = lines.filter((line) => line.quantity > 0);
  const canEditOrder =
    Boolean(offer?.viewer.canOrder) &&
    (!order || order.status === 'PENDING_PAYMENT' || order.status === 'PAYMENT_REPORTED');
  const orderRestrictionReason = offer?.viewer.orderRestrictionReason ?? null;
  const canCancelSelf =
    order && (order.status === 'PENDING_PAYMENT' || order.status === 'PAYMENT_REPORTED');
  const confirmedLocked =
    order && (order.status === 'PAYMENT_CONFIRMED' || order.status === 'FULFILLED');

  function setQuantity(productId: string, next: number) {
    dirtyRef.current = true;
    setDirty(true);
    setQty((prev) => ({ ...prev, [productId]: Math.max(0, next) }));
  }

  async function submitOrder() {
    setPending(true);
    setError('');
    try {
      const items = selected.map((line) => ({
        productId: line.product.productId,
        quantity: line.quantity,
      }));
      const key = order?.orderId || `order-${offerId}-${session.lineUserId}`;
      const result = await api.upsertMyPreorderOrder(session, offerId, items, key);
      setOrder(result.order);
      setNotice(order ? '訂單已更新' : '訂單已送出');
      setConfirmOpen(false);
      setDirty(false);
      await reload({ forceQty: true });
    } catch (err) {
      setError(preorderErrorMessage(err, '下單失敗'));
      if (isPreorderConflict(err)) {
        try {
          await reload({ forceQty: true });
        } catch {
          /* keep message */
        }
      }
    } finally {
      setPending(false);
    }
  }

  if (loading) return <StateBlock kind="loading" title="載入商品中…" />;
  if (error && !offer) {
    return (
      <StateBlock kind="error" title="無法載入代訂">
        {error}
      </StateBlock>
    );
  }
  if (!offer) return null;

  return (
    <div className="stack preorder-order-page">
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
        <p className="hint preorder-wrap">代訂者：{offer.providerDisplayName}</p>
        <p className="hint">截止：{formatIsoDateTime(offer.orderDeadline)}</p>
        {offer.description ? <p className="hint preorder-wrap">{offer.description}</p> : null}
        <div className="preorder-payment-box">
          <strong>付款說明</strong>
          <p>{PREORDER_PAYMENT_DISCLAIMER}</p>
          {offer.paymentInstructions && offer.paymentInstructions !== PREORDER_PAYMENT_DISCLAIMER ? (
            <p className="preorder-wrap">{offer.paymentInstructions}</p>
          ) : null}
          {offer.paymentUrl ? (
            <a className="hint-link" href={offer.paymentUrl} target="_blank" rel="noreferrer">
              開啟付款連結
            </a>
          ) : null}
        </div>
        {offer.viewer.canManagePreorder ? (
          <Link className="btn secondary" to={`/preorders/${offerId}/manage`}>
            前往代訂管理
          </Link>
        ) : null}
      </section>

      <section className="panel stack">
        <h2>商品</h2>
        {!offer.viewer.canOrder && orderRestrictionReason ? (
          <p className="hint">{orderRestrictionReason}</p>
        ) : null}
        {lines.length === 0 ? <p className="hint">目前沒有可訂購商品</p> : null}
        {lines.map(({ product, quantity, unitPrice, subtotal }) => (
          <div className="preorder-product-line" key={product.productId}>
            <div className="preorder-product-line-main">
              <strong className="preorder-wrap">{product.name}</strong>
              {product.specification ? (
                <div className="hint preorder-wrap">{product.specification}</div>
              ) : null}
              <div className="hint">
                ${unitPrice}
                {product.remainingQuantity != null ? ` · 剩餘 ${product.remainingQuantity}` : ''}
                {!product.isActive ? ' · 已停用' : ''}
              </div>
            </div>
            <div className="preorder-qty-controls" role="group" aria-label={`${product.name} 數量`}>
              <button
                className="btn secondary btn-compact preorder-qty-btn"
                type="button"
                disabled={!canEditOrder || quantity <= 0 || pending}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setQuantity(product.productId, quantity - 1);
                }}
                aria-label={`減少 ${product.name}`}
              >
                −
              </button>
              <span className="preorder-qty-value">{quantity}</span>
              <button
                className="btn secondary btn-compact preorder-qty-btn"
                type="button"
                disabled={
                  !canEditOrder ||
                  pending ||
                  !product.isActive ||
                  (product.remainingQuantity != null &&
                    quantity >=
                      product.remainingQuantity +
                        (order?.items.find((i) => i.productId === product.productId)?.quantity || 0))
                }
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setQuantity(product.productId, quantity + 1);
                }}
                aria-label={`增加 ${product.name}`}
              >
                +
              </button>
            </div>
            <div className="preorder-line-subtotal">${subtotal}</div>
          </div>
        ))}
        <div className="preorder-total-row">
          <strong>訂單總額</strong>
          <strong>${total}</strong>
        </div>
      </section>

      {order ? (
        <section className="panel stack">
          <h2>我的訂單</h2>
          <p className={`preorder-status tone-${orderStatusTone(order.status)}`}>
            {orderStatusLabel(order.status)}
          </p>
          <p className="hint">總金額：${order.totalAmount}</p>
          {confirmedLocked ? (
            <p className="hint">訂單已確認付款，如需取消請聯絡代訂者處理。</p>
          ) : null}
        </section>
      ) : null}

      <div className="stack preorder-actions">
        {canEditOrder ? (
          <button
            className="btn"
            type="button"
            disabled={pending || selected.length === 0}
            onClick={() => setConfirmOpen(true)}
          >
            {order ? '更新訂單' : '送出訂單'}
          </button>
        ) : null}
        {order?.status === 'PENDING_PAYMENT' ? (
          <button
            className="btn secondary"
            type="button"
            disabled={pending}
            onClick={() => {
              void (async () => {
                setPending(true);
                setError('');
                try {
                  const result = await api.reportMyPreorderPayment(session, offerId);
                  setOrder(result.order);
                  setNotice('已回報付款');
                } catch (err) {
                  setError(preorderErrorMessage(err, '回報失敗'));
                  if (isPreorderConflict(err)) {
                    try {
                      await reload({ forceQty: true });
                    } catch {
                      /* keep */
                    }
                  }
                } finally {
                  setPending(false);
                }
              })();
            }}
          >
            我已付款
          </button>
        ) : null}
        {canCancelSelf ? (
          <button
            className="btn danger"
            type="button"
            disabled={pending}
            onClick={() => {
              if (!window.confirm('確定取消此代訂訂單？')) return;
              void (async () => {
                setPending(true);
                setError('');
                try {
                  await api.cancelMyPreorderOrder(session, offerId);
                  setNotice('訂單已取消');
                  await reload();
                } catch (err) {
                  setError(preorderErrorMessage(err, '取消失敗'));
                  if (isPreorderConflict(err)) {
                    try {
                      await reload({ forceQty: true });
                    } catch {
                      /* keep */
                    }
                  }
                } finally {
                  setPending(false);
                }
              })();
            }}
          >
            取消訂單
          </button>
        ) : null}
      </div>

      {confirmOpen ? (
        <div className="modal-backdrop" role="presentation">
          <div className="modal sheet-modal" role="dialog" aria-modal="true" aria-label="確認訂單">
            <h2 className="modal-title">確認訂單</h2>
            <div className="stack modal-body">
              <p className="hint">{PREORDER_PAYMENT_DISCLAIMER}</p>
              <ul className="preorder-summary-list">
                {selected.map((line) => (
                  <li key={line.product.productId} className="preorder-wrap">
                    {line.product.name} × {line.quantity} = ${line.subtotal}
                  </li>
                ))}
              </ul>
              <p>
                <strong>總額 ${total}</strong>
              </p>
            </div>
            <div className="modal-actions">
              <button className="btn secondary" type="button" disabled={pending} onClick={() => setConfirmOpen(false)}>
                返回
              </button>
              <button className="btn" type="button" disabled={pending} onClick={() => void submitOrder()}>
                {pending ? '送出中…' : '確認送出'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
