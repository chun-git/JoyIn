import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  PREORDER_PAYMENT_DISCLAIMER,
  type PreorderOfferDetail,
  type PreorderOrder,
  type PreorderOrderItemOptionInput,
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

type OptionSelection = { valueIds: string[]; textValue: string };

interface CartLine {
  cartLineId: string;
  productId: string;
  quantity: number;
  options: PreorderOrderItemOptionInput[];
}

function normalizedOptionsKey(options: PreorderOrderItemOptionInput[]): string {
  return options
    .flatMap((option) => {
      const values = [...(option.optionValueIds ?? [])]
        .sort()
        .map((valueId) => `${option.optionGroupId}:v:${valueId}`);
      const text = option.textValue?.trim();
      return text ? [...values, `${option.optionGroupId}:t:${text}`] : values;
    })
    .sort()
    .join('|');
}

export function PreorderOrderPage({ session }: { session: LiffSession }) {
  const { offerId = '' } = useParams();
  const navigate = useNavigate();
  const [offer, setOffer] = useState<PreorderOfferDetail | null>(null);
  const [order, setOrder] = useState<PreorderOrder | null>(null);
  const [draftQty, setDraftQty] = useState<Record<string, number>>({});
  const [draftSelections, setDraftSelections] = useState<
    Record<string, Record<string, OptionSelection>>
  >({});
  const [cart, setCart] = useState<CartLine[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const [syncHint, setSyncHint] = useState('');

  const applyOrderFromServer = (detail: PreorderOfferDetail, mine: PreorderOrder | null) => {
    const nextQty: Record<string, number> = {};
    const nextSelections: Record<
      string,
      Record<string, OptionSelection>
    > = {};
    for (const product of detail.products) {
      nextQty[product.productId] = 1;
      nextSelections[product.productId] = {};
      for (const group of product.optionGroups) {
        nextSelections[product.productId][group.optionGroupId] = {
          valueIds: [],
          textValue: '',
        };
      }
    }
    setDraftQty(nextQty);
    setDraftSelections(nextSelections);
    setCart(
      mine?.items.map((item) => ({
        cartLineId: item.orderItemId,
        productId: item.productId,
        quantity: item.quantity,
        options: item.options.reduce<PreorderOrderItemOptionInput[]>((result, option) => {
          let group = result.find((candidate) => candidate.optionGroupId === option.optionGroupId);
          if (!group) {
            group = { optionGroupId: option.optionGroupId, optionValueIds: [] };
            result.push(group);
          }
          if (option.optionValueId) group.optionValueIds!.push(option.optionValueId);
          if (option.textValueSnapshot) group.textValue = option.textValueSnapshot;
          return result;
        }, []),
      })) ?? [],
    );
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
        applyOrderFromServer(detail.offer, mine.order);
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
    return cart.flatMap((line) => {
      const product = offer.products.find((candidate) => candidate.productId === line.productId);
      if (!product) return [];
      const savedItem = order?.items.find((item) => item.orderItemId === line.cartLineId);
      const unitPrice = savedItem?.unitPriceSnapshot ?? product.unitPrice;
      const optionPrice = line.options.reduce((sum, selected) => {
        const group = product.optionGroups.find(
          (candidate) => candidate.optionGroupId === selected.optionGroupId,
        );
        return (
          sum +
          (selected.optionValueIds ?? []).reduce(
            (valueSum, valueId) =>
              valueSum +
              (savedItem?.options.find((option) => option.optionValueId === valueId)
                ?.priceAdjustmentSnapshot ??
                group?.values.find((value) => value.optionValueId === valueId)?.priceAdjustment ??
                0),
            0,
          )
        );
      }, 0);
      return [{
        ...line,
        product,
        unitPrice,
        optionPrice,
        subtotal: (unitPrice + optionPrice) * line.quantity,
      }];
    });
  }, [cart, offer, order]);

  const total = lines.reduce((sum, line) => sum + line.subtotal, 0);
  const canEditOrder =
    Boolean(offer?.viewer.canOrder) &&
    (!order || order.status === 'PENDING_PAYMENT' || order.status === 'PAYMENT_REPORTED');
  const orderRestrictionReason = offer?.viewer.orderRestrictionReason ?? null;
  const canCancelSelf =
    order && (order.status === 'PENDING_PAYMENT' || order.status === 'PAYMENT_REPORTED');
  const confirmedLocked =
    order && (order.status === 'PAYMENT_CONFIRMED' || order.status === 'FULFILLED');

  function markDirty() {
    dirtyRef.current = true;
    setDirty(true);
  }

  function setOptionSelection(
    productId: string,
    groupId: string,
    next: { valueIds: string[]; textValue: string },
  ) {
    markDirty();
    setDraftSelections((prev) => ({
      ...prev,
      [productId]: { ...(prev[productId] || {}), [groupId]: next },
    }));
  }

  function optionsForProduct(productId: string): PreorderOrderItemOptionInput[] {
    const product = offer?.products.find((candidate) => candidate.productId === productId);
    if (!product) return [];
    return product.optionGroups.map((group) => ({
      optionGroupId: group.optionGroupId,
      optionValueIds: draftSelections[productId]?.[group.optionGroupId]?.valueIds ?? [],
      textValue: draftSelections[productId]?.[group.optionGroupId]?.textValue.trim() || undefined,
    }));
  }

  function addToCart(productId: string) {
    if (!offer) return;
    const product = offer.products.find((candidate) => candidate.productId === productId);
    if (!product) return;
    const options = optionsForProduct(productId);
    for (const group of product.optionGroups) {
      const selected = options.find((option) => option.optionGroupId === group.optionGroupId);
      const selectionCount =
        group.type === 'TEXT'
          ? Number(Boolean(selected?.textValue))
          : (selected?.optionValueIds?.length ?? 0);
      const minimum = Math.max(group.minSelections, group.isRequired ? 1 : 0);
      if (selectionCount < minimum) {
        setError(`${group.name}${group.type === 'TEXT' ? '為必填' : `至少選擇 ${minimum} 項`}`);
        return;
      }
      if (group.maxSelections != null && selectionCount > group.maxSelections) {
        setError(`${group.name}最多選擇 ${group.maxSelections} 項`);
        return;
      }
    }
    const quantity = Math.max(1, draftQty[productId] ?? 1);
    const existingReserved =
      order?.items
        .filter((item) => item.productId === productId)
        .reduce((sum, item) => sum + item.quantity, 0) ?? 0;
    const cartQuantity = cart
      .filter((line) => line.productId === productId)
      .reduce((sum, line) => sum + line.quantity, 0);
    const available =
      product.remainingQuantity == null
        ? null
        : product.remainingQuantity + existingReserved;
    if (available != null && cartQuantity + quantity > available) {
      setError(`商品數量不足，目前最多可訂 ${available}`);
      return;
    }
    const key = normalizedOptionsKey(options);
    markDirty();
    setError('');
    setCart((previous) => {
      const match = previous.find(
        (line) =>
          line.productId === productId && normalizedOptionsKey(line.options) === key,
      );
      if (match) {
        return previous.map((line) =>
          line.cartLineId === match.cartLineId
            ? { ...line, quantity: line.quantity + quantity }
            : line,
        );
      }
      return [
        ...previous,
        { cartLineId: crypto.randomUUID(), productId, quantity, options },
      ];
    });
  }

  function updateCartQuantity(cartLineId: string, next: number) {
    markDirty();
    if (next <= 0) {
      setCart((previous) => previous.filter((line) => line.cartLineId !== cartLineId));
      return;
    }
    const target = cart.find((line) => line.cartLineId === cartLineId);
    const product = offer?.products.find((candidate) => candidate.productId === target?.productId);
    const existingReserved =
      order?.items
        .filter((item) => item.productId === target?.productId)
        .reduce((sum, item) => sum + item.quantity, 0) ?? 0;
    const otherQuantity = cart
      .filter(
        (line) =>
          line.productId === target?.productId && line.cartLineId !== cartLineId,
      )
      .reduce((sum, line) => sum + line.quantity, 0);
    const available =
      product?.remainingQuantity == null
        ? null
        : product.remainingQuantity + existingReserved;
    if (available != null && otherQuantity + next > available) {
      setError(`商品數量不足，目前最多可訂 ${available}`);
      return;
    }
    setError('');
    setCart((previous) =>
      previous.map((line) =>
        line.cartLineId === cartLineId ? { ...line, quantity: next } : line,
      ),
    );
  }

  function cartOptionSummary(line: CartLine): string {
    const product = offer?.products.find((candidate) => candidate.productId === line.productId);
    const savedItem = order?.items.find((item) => item.orderItemId === line.cartLineId);
    return line.options
      .flatMap((selected) => {
        const group = product?.optionGroups.find(
          (candidate) => candidate.optionGroupId === selected.optionGroupId,
        );
        const valueLabels = (selected.optionValueIds ?? []).map((valueId) => {
          const value = group?.values.find((candidate) => candidate.optionValueId === valueId);
          const saved = savedItem?.options.find((option) => option.optionValueId === valueId);
          return `${group?.name ?? saved?.groupNameSnapshot ?? '選項'}：${
            value?.name ?? saved?.optionNameSnapshot ?? '已選'
          }`;
        });
        return selected.textValue
          ? [...valueLabels, `${group?.name ?? '備註'}：${selected.textValue}`]
          : valueLabels;
      })
      .join('、');
  }

  async function submitOrder() {
    setPending(true);
    setError('');
    try {
      const items = cart.map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
        options: line.options,
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
        {offer.products.length === 0 ? <p className="hint">目前沒有可訂購商品</p> : null}
        {offer.products.map((product) => {
          const quantity = draftQty[product.productId] ?? 1;
          return (
          <div className="preorder-product-line" key={product.productId}>
            <div className="preorder-product-line-main">
              <strong className="preorder-wrap">{product.name}</strong>
              {product.specification ? (
                <div className="hint preorder-wrap">{product.specification}</div>
              ) : null}
              {product.description ? (
                <div className="hint preorder-wrap">{product.description}</div>
              ) : null}
              <div className="hint">
                ${product.unitPrice}
                {product.optionGroups.length ? ' 起' : ''}
                {product.remainingQuantity != null ? ` · 剩餘 ${product.remainingQuantity}` : ''}
                {!product.isActive ? ' · 已停用' : ''}
              </div>
              {product.optionGroups.map((group) => {
                const selectedGroup = draftSelections[product.productId]?.[group.optionGroupId] || {
                  valueIds: [],
                  textValue: '',
                };
                return (
                  <fieldset
                    className="preorder-option-picker"
                    key={group.optionGroupId}
                    disabled={!canEditOrder || pending}
                  >
                    <legend>
                      {group.name}
                      {group.isRequired ? '（必填）' : ''}
                    </legend>
                    {group.type === 'TEXT' ? (
                      <input
                        value={selectedGroup.textValue}
                        maxLength={200}
                        onChange={(e) =>
                          setOptionSelection(product.productId, group.optionGroupId, {
                            ...selectedGroup,
                            textValue: e.target.value,
                          })
                        }
                        placeholder={`輸入${group.name}`}
                      />
                    ) : (
                      <div className="preorder-option-values">
                        {group.values
                          .filter((value) => value.isActive)
                          .map((value) => {
                            const checked = selectedGroup.valueIds.includes(value.optionValueId);
                            return (
                              <label className="checkbox-row" key={value.optionValueId}>
                                <input
                                  type={group.type === 'SINGLE' ? 'radio' : 'checkbox'}
                                  name={`${product.productId}-${group.optionGroupId}`}
                                  checked={checked}
                                  onChange={(e) => {
                                    const valueIds =
                                      group.type === 'SINGLE'
                                        ? e.target.checked
                                          ? [value.optionValueId]
                                          : []
                                        : e.target.checked
                                          ? [...selectedGroup.valueIds, value.optionValueId]
                                          : selectedGroup.valueIds.filter(
                                              (id) => id !== value.optionValueId,
                                            );
                                    setOptionSelection(product.productId, group.optionGroupId, {
                                      ...selectedGroup,
                                      valueIds,
                                    });
                                  }}
                                />
                                <span>
                                  {value.name}
                                  {value.priceAdjustment
                                    ? ` ${value.priceAdjustment > 0 ? '+' : ''}$${value.priceAdjustment}`
                                    : ''}
                                </span>
                              </label>
                            );
                          })}
                      </div>
                    )}
                  </fieldset>
                );
              })}
            </div>
            <div className="preorder-qty-controls" role="group" aria-label={`${product.name} 數量`}>
              <button
                className="btn secondary btn-compact preorder-qty-btn"
                type="button"
                disabled={!canEditOrder || quantity <= 1 || pending}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  markDirty();
                  setDraftQty((previous) => ({
                    ...previous,
                    [product.productId]: Math.max(1, quantity - 1),
                  }));
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
                        (order?.items
                          .filter((item) => item.productId === product.productId)
                          .reduce((sum, item) => sum + item.quantity, 0) || 0))
                }
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  markDirty();
                  setDraftQty((previous) => ({
                    ...previous,
                    [product.productId]: quantity + 1,
                  }));
                }}
                aria-label={`增加 ${product.name}`}
              >
                +
              </button>
            </div>
            <button
              className="btn secondary"
              type="button"
              disabled={!canEditOrder || pending || !product.isActive}
              onClick={() => addToCart(product.productId)}
            >
              加入購物車
            </button>
          </div>
          );
        })}
      </section>

      <section className="panel stack">
        <h2>購物車</h2>
        {lines.length === 0 ? <p className="hint">尚未加入商品</p> : null}
        {lines.map((line) => (
          <div className="preorder-product-line preorder-cart-line" key={line.cartLineId}>
            <div className="preorder-product-line-main">
              <strong className="preorder-wrap">{line.product.name}</strong>
              {cartOptionSummary(line) ? (
                <div className="hint preorder-wrap">{cartOptionSummary(line)}</div>
              ) : null}
              <div className="hint">
                單價 ${line.unitPrice + line.optionPrice}
                {line.optionPrice ? `（選項 +$${line.optionPrice}）` : ''}
              </div>
            </div>
            <div className="preorder-qty-controls" role="group" aria-label={`${line.product.name} 購物車數量`}>
              <button
                className="btn secondary btn-compact preorder-qty-btn"
                type="button"
                disabled={!canEditOrder || pending}
                onClick={() => updateCartQuantity(line.cartLineId, line.quantity - 1)}
                aria-label={`減少 ${line.product.name}`}
              >
                −
              </button>
              <span className="preorder-qty-value">{line.quantity}</span>
              <button
                className="btn secondary btn-compact preorder-qty-btn"
                type="button"
                disabled={!canEditOrder || pending}
                onClick={() => updateCartQuantity(line.cartLineId, line.quantity + 1)}
                aria-label={`增加 ${line.product.name}`}
              >
                +
              </button>
            </div>
            <div className="preorder-line-subtotal">
              <strong>${line.subtotal}</strong>
              <button
                className="btn danger btn-compact"
                type="button"
                disabled={!canEditOrder || pending}
                onClick={() => updateCartQuantity(line.cartLineId, 0)}
              >
                移除
              </button>
            </div>
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
          <ul className="preorder-summary-list">
            {order.items.map((item) => (
              <li className="preorder-wrap" key={item.orderItemId}>
                {item.productNameSnapshot} × {item.quantity} = ${item.subtotal}
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
            disabled={pending || lines.length === 0}
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
                {lines.map((line) => (
                  <li key={line.cartLineId} className="preorder-wrap">
                    {line.product.name} × {line.quantity} = ${line.subtotal}
                    {cartOptionSummary(line) ? (
                      <small className="preorder-item-options">{cartOptionSummary(line)}</small>
                    ) : null}
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
