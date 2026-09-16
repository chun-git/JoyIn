import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  PREORDER_PAYMENT_DISCLAIMER,
  type PreorderProductInput,
  type ProductOptionGroupType,
} from '../../../shared/types';
import { api } from '../api';
import { SiteNav } from '../components/SiteNav';
import { StateBlock } from '../components/StateBlock';
import type { LiffSession } from '../liff';
import {
  fromDatetimeLocalValue,
  toDatetimeLocalValue,
} from '../preorder-format';

type DraftProduct = {
  key: string;
  productId?: string;
  name: string;
  description: string;
  specification: string;
  unitPrice: string;
  quantityLimit: string;
  isActive: boolean;
  optionGroups: DraftOptionGroup[];
};

type DraftOptionValue = { key: string; name: string; priceAdjustment: string; isActive: boolean };
type DraftOptionGroup = {
  key: string;
  name: string;
  type: ProductOptionGroupType;
  isRequired: boolean;
  minSelections: string;
  maxSelections: string;
  values: DraftOptionValue[];
};

function emptyProduct(key: string): DraftProduct {
  return {
    key,
    name: '',
    description: '',
    specification: '',
    unitPrice: '',
    quantityLimit: '',
    isActive: true,
    optionGroups: [],
  };
}

export function PreorderEditPage({ session }: { session: LiffSession }) {
  const { eventId = '', offerId = '' } = useParams();
  const isCreate = !offerId;
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [merchantName, setMerchantName] = useState('');
  const [description, setDescription] = useState('');
  const [orderDeadline, setOrderDeadline] = useState('');
  const [paymentInstructions, setPaymentInstructions] = useState(PREORDER_PAYMENT_DISCLAIMER);
  const [paymentUrl, setPaymentUrl] = useState('');
  const [products, setProducts] = useState<DraftProduct[]>([emptyProduct('p1')]);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(!isCreate);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [eventStartHint, setEventStartHint] = useState('');
  const [publishToSharedMenu, setPublishToSharedMenu] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (isCreate) {
      void api
        .getEvent(session, eventId)
        .then((result) => {
          if (cancelled) return;
          setEventStartHint(`${result.event.startDate} ${result.event.startTime}`);
        })
        .catch(() => {
          /* ignore — create still validates on server */
        });
      return () => {
        cancelled = true;
      };
    }
    setLoading(true);
    void api
      .getPreorder(session, offerId)
      .then((result) => {
        if (cancelled) return;
        const offer = result.offer;
        if (!offer.viewer.canManagePreorder) {
          setError('只有代訂者可以編輯');
          return;
        }
        setTitle(offer.title);
        setMerchantName(offer.merchantName);
        setDescription(offer.description);
        setOrderDeadline(toDatetimeLocalValue(offer.orderDeadline));
        setPaymentInstructions(offer.paymentInstructions || PREORDER_PAYMENT_DISCLAIMER);
        setPaymentUrl(offer.paymentUrl || '');
        setProducts(
          offer.products.length
            ? offer.products.map((p) => ({
                key: p.productId,
                productId: p.productId,
                name: p.name,
                description: p.description,
                specification: p.specification || '',
                unitPrice: String(p.unitPrice),
                quantityLimit: p.quantityLimit == null ? '' : String(p.quantityLimit),
                isActive: p.isActive,
                optionGroups: p.optionGroups.map((group) => ({
                  key: group.optionGroupId,
                  name: group.name,
                  type: group.type,
                  isRequired: group.isRequired,
                  minSelections: String(group.minSelections),
                  maxSelections: group.maxSelections == null ? '' : String(group.maxSelections),
                  values: group.values.map((value) => ({
                    key: value.optionValueId,
                    name: value.name,
                    priceAdjustment: String(value.priceAdjustment),
                    isActive: value.isActive,
                  })),
                })),
              }))
            : [emptyProduct('p1')],
        );
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : '載入失敗');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session, eventId, offerId, isCreate]);

  const liveSummary = useMemo(() => {
    const active = products.filter((p) => p.isActive && p.name.trim());
    const total = active.reduce((sum, p) => sum + (Number(p.unitPrice) || 0), 0);
    return { count: active.length, sampleTotal: total };
  }, [products]);

  function updateProduct(key: string, patch: Partial<DraftProduct>) {
    setProducts((prev) => prev.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  }

  function updateOptionGroup(productKey: string, groupKey: string, patch: Partial<DraftOptionGroup>) {
    setProducts((prev) =>
      prev.map((product) =>
        product.key === productKey
          ? {
              ...product,
              optionGroups: product.optionGroups.map((group) =>
                group.key === groupKey ? { ...group, ...patch } : group,
              ),
            }
          : product,
      ),
    );
  }

  function updateOptionValue(
    productKey: string,
    groupKey: string,
    valueKey: string,
    patch: Partial<DraftOptionValue>,
  ) {
    setProducts((prev) =>
      prev.map((product) =>
        product.key === productKey
          ? {
              ...product,
              optionGroups: product.optionGroups.map((group) =>
                group.key === groupKey
                  ? {
                      ...group,
                      values: group.values.map((value) =>
                        value.key === valueKey ? { ...value, ...patch } : value,
                      ),
                    }
                  : group,
              ),
            }
          : product,
      ),
    );
  }

  function moveProduct(key: string, direction: -1 | 1) {
    setProducts((prev) => {
      const index = prev.findIndex((p) => p.key === key);
      if (index < 0) return prev;
      const next = index + direction;
      if (next < 0 || next >= prev.length) return prev;
      const copy = [...prev];
      const [item] = copy.splice(index, 1);
      copy.splice(next, 0, item);
      return copy;
    });
  }

  function buildPayload(): CreatePreorderOfferInputish {
    let deadlineIso: string;
    try {
      deadlineIso = fromDatetimeLocalValue(orderDeadline);
    } catch {
      throw new Error('請填寫有效的訂購截止時間');
    }
    const productInputs: PreorderProductInput[] = products.map((p, index) => ({
      productId: p.productId,
      name: p.name.trim(),
      description: p.description.trim(),
      specification: p.specification.trim() || null,
      unitPrice: Number(p.unitPrice),
      quantityLimit: p.quantityLimit.trim() === '' ? null : Number(p.quantityLimit),
      sortOrder: index,
      isActive: p.isActive,
      optionGroups: p.optionGroups.map((group, groupIndex) => ({
        optionGroupId: group.key.startsWith('new-') ? undefined : group.key,
        name: group.name.trim(),
        type: group.type,
        isRequired: group.isRequired,
        minSelections: group.minSelections === '' ? undefined : Number(group.minSelections),
        maxSelections: group.maxSelections === '' ? null : Number(group.maxSelections),
        sortOrder: groupIndex,
        values: group.values.map((value, valueIndex) => ({
          optionValueId: value.key.startsWith('new-') ? undefined : value.key,
          name: value.name.trim(),
          priceAdjustment: Number(value.priceAdjustment || 0),
          isActive: value.isActive,
          sortOrder: valueIndex,
        })),
      })),
    }));
    return {
      title: title.trim(),
      merchantName: merchantName.trim(),
      description: description.trim(),
      orderDeadline: deadlineIso,
      paymentInstructions: paymentInstructions.trim() || PREORDER_PAYMENT_DISCLAIMER,
      paymentUrl: paymentUrl.trim() || null,
      products: productInputs,
    };
  }

  type CreatePreorderOfferInputish = {
    title: string;
    merchantName: string;
    description: string;
    orderDeadline: string;
    paymentInstructions: string;
    paymentUrl: string | null;
    products: PreorderProductInput[];
    sharedMenuVersionId?: string | null;
  };

  async function save() {
    setPending(true);
    setError('');
    try {
      const payload = buildPayload();
      if (isCreate) {
        if (publishToSharedMenu) {
          const draft = await api.createSharedMenuDraft(
            session,
            {
              merchantName: payload.merchantName,
              category: '',
              description: payload.description,
              products: payload.products.map((product, index) => ({
                name: product.name,
                description: product.description || product.specification || '',
                basePrice: product.unitPrice,
                isActive: product.isActive,
                sortOrder: index,
                optionGroups: product.optionGroups,
              })),
            },
            crypto.randomUUID(),
          );
          const published = await api.publishSharedMenuVersion(
            session,
            draft.version.menuId,
            draft.version.versionId,
            null,
            true,
          );
          payload.sharedMenuVersionId = published.currentVersion?.versionId || null;
        }
        const result = await api.createPreorder(session, eventId, payload);
        navigate(`/preorders/${result.offer.offerId}/manage`, { replace: true });
      } else {
        await api.updatePreorder(session, offerId, payload);
        navigate(`/preorders/${offerId}/manage`, { replace: true });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '儲存失敗');
      setConfirmOpen(false);
    } finally {
      setPending(false);
    }
  }

  if (loading) return <StateBlock kind="loading" title="載入代訂中…" />;

  return (
    <div className="stack preorder-edit-page">
      <SiteNav current="events" />
      <div className="detail-back-row">
        <Link className="btn-back" to={isCreate ? `/events/${eventId}` : `/preorders/${offerId}/manage`}>
          <span>返回</span>
        </Link>
      </div>
      <section className="panel stack">
        <h1>{isCreate ? '建立代訂服務' : '編輯代訂服務'}</h1>
        <p className="hint">商品款由訂購者直接支付代訂者，JoyIn 不代收商品費用。</p>
        {eventStartHint ? <p className="hint">截止時間不可晚於活動開始（{eventStartHint}）。</p> : null}
        {error ? <p className="error">{error}</p> : null}

        <label className="field">
          <span>服務名稱</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如 飲料代訂" maxLength={50} />
        </label>
        <label className="field">
          <span>店家名稱</span>
          <input value={merchantName} onChange={(e) => setMerchantName(e.target.value)} maxLength={80} />
        </label>
        <label className="field">
          <span>說明</span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={500} />
        </label>
        <label className="field">
          <span>訂購截止時間</span>
          <input
            type="datetime-local"
            value={orderDeadline}
            onChange={(e) => setOrderDeadline(e.target.value)}
          />
        </label>
        <label className="field">
          <span>付款說明</span>
          <textarea
            value={paymentInstructions}
            onChange={(e) => setPaymentInstructions(e.target.value)}
            rows={3}
            maxLength={500}
          />
        </label>
        <label className="field">
          <span>付款連結（選填，僅 HTTPS）</span>
          <input
            value={paymentUrl}
            onChange={(e) => setPaymentUrl(e.target.value)}
            placeholder="https://"
            inputMode="url"
          />
        </label>
      </section>

      <section className="panel stack">
        <div className="section-heading">
          <h2>商品清單</h2>
          <span className="hint">
            {liveSummary.count} 項 · 單價合計參考 ${liveSummary.sampleTotal}
          </span>
        </div>
        {isCreate ? (
          <Link className="btn secondary" to={`/events/${eventId}/preorders/menu`}>
            改用共用菜單建立
          </Link>
        ) : null}
        {products.map((product, index) => (
          <div className="preorder-product-editor" key={product.key}>
            <label className="field">
              <span>商品名稱</span>
              <input
                value={product.name}
                onChange={(e) => updateProduct(product.key, { name: e.target.value })}
                maxLength={80}
              />
            </label>
            <label className="field">
              <span>商品說明（選填）</span>
              <textarea
                value={product.description}
                onChange={(e) => updateProduct(product.key, { description: e.target.value })}
                rows={2}
                maxLength={500}
              />
            </label>
            <label className="field">
              <span>規格（選填）</span>
              <input
                value={product.specification}
                onChange={(e) => updateProduct(product.key, { specification: e.target.value })}
                maxLength={80}
              />
            </label>
            <div className="stack preorder-option-editor">
              <div className="section-heading">
                <strong>彈性選項</strong>
                <button
                  className="btn secondary btn-compact"
                  type="button"
                  onClick={() =>
                    updateProduct(product.key, {
                      optionGroups: [
                        ...product.optionGroups,
                        {
                          key: `new-g-${Date.now()}`,
                          name: '',
                          type: 'SINGLE',
                          isRequired: false,
                          minSelections: '0',
                          maxSelections: '1',
                          values: [],
                        },
                      ],
                    })
                  }
                >
                  新增選項群組
                </button>
              </div>
              {product.optionGroups.map((group) => (
                <div className="preorder-option-group" key={group.key}>
                  <label className="field">
                    <span>群組名稱</span>
                    <input
                      value={group.name}
                      onChange={(e) =>
                        updateOptionGroup(product.key, group.key, { name: e.target.value })
                      }
                      placeholder="例如 糖度、加料、備註"
                    />
                  </label>
                  <div className="preorder-product-row">
                    <label className="field">
                      <span>類型</span>
                      <select
                        value={group.type}
                        onChange={(e) =>
                          updateOptionGroup(product.key, group.key, {
                            type: e.target.value as ProductOptionGroupType,
                            maxSelections: e.target.value === 'SINGLE' ? '1' : '',
                            values: e.target.value === 'TEXT' ? [] : group.values,
                          })
                        }
                      >
                        <option value="SINGLE">單選</option>
                        <option value="MULTIPLE">複選</option>
                        <option value="TEXT">自由文字</option>
                      </select>
                    </label>
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={group.isRequired}
                        onChange={(e) =>
                          updateOptionGroup(product.key, group.key, {
                            isRequired: e.target.checked,
                            minSelections: e.target.checked ? '1' : '0',
                          })
                        }
                      />
                      <span>必填</span>
                    </label>
                  </div>
                  {group.type === 'MULTIPLE' ? (
                    <div className="preorder-product-row">
                      <label className="field">
                        <span>最少選擇</span>
                        <input
                          inputMode="numeric"
                          value={group.minSelections}
                          onChange={(e) =>
                            updateOptionGroup(product.key, group.key, {
                              minSelections: e.target.value,
                            })
                          }
                        />
                      </label>
                      <label className="field">
                        <span>最多選擇（選填）</span>
                        <input
                          inputMode="numeric"
                          value={group.maxSelections}
                          onChange={(e) =>
                            updateOptionGroup(product.key, group.key, {
                              maxSelections: e.target.value,
                            })
                          }
                        />
                      </label>
                    </div>
                  ) : null}
                  {group.type !== 'TEXT'
                    ? group.values.map((value) => (
                        <div className="preorder-option-value" key={value.key}>
                          <input
                            aria-label={`${group.name || '選項'}名稱`}
                            value={value.name}
                            onChange={(e) =>
                              updateOptionValue(product.key, group.key, value.key, {
                                name: e.target.value,
                              })
                            }
                            placeholder="選項名稱"
                          />
                          <input
                            aria-label={`${value.name || '選項'}加價`}
                            inputMode="numeric"
                            value={value.priceAdjustment}
                            onChange={(e) =>
                              updateOptionValue(product.key, group.key, value.key, {
                                priceAdjustment: e.target.value,
                              })
                            }
                            placeholder="加價"
                          />
                          <button
                            className="btn secondary btn-compact"
                            type="button"
                            onClick={() =>
                              updateOptionGroup(product.key, group.key, {
                                values: group.values.filter((item) => item.key !== value.key),
                              })
                            }
                          >
                            移除
                          </button>
                        </div>
                      ))
                    : null}
                  <div className="row">
                    {group.type !== 'TEXT' ? (
                      <button
                        className="btn secondary btn-compact"
                        type="button"
                        onClick={() =>
                          updateOptionGroup(product.key, group.key, {
                            values: [
                              ...group.values,
                              {
                                key: `new-v-${Date.now()}`,
                                name: '',
                                priceAdjustment: '0',
                                isActive: true,
                              },
                            ],
                          })
                        }
                      >
                        新增選項值
                      </button>
                    ) : null}
                    <button
                      className="btn secondary btn-compact"
                      type="button"
                      onClick={() =>
                        updateProduct(product.key, {
                          optionGroups: product.optionGroups.filter(
                            (item) => item.key !== group.key,
                          ),
                        })
                      }
                    >
                      移除群組
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="preorder-product-row">
              <label className="field">
                <span>單價</span>
                <input
                  inputMode="numeric"
                  value={product.unitPrice}
                  onChange={(e) => updateProduct(product.key, { unitPrice: e.target.value })}
                />
              </label>
              <label className="field">
                <span>數量上限（選填）</span>
                <input
                  inputMode="numeric"
                  value={product.quantityLimit}
                  onChange={(e) => updateProduct(product.key, { quantityLimit: e.target.value })}
                />
              </label>
            </div>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={product.isActive}
                onChange={(e) => updateProduct(product.key, { isActive: e.target.checked })}
              />
              <span>啟用</span>
            </label>
            <div className="row">
              <button className="btn secondary btn-compact" type="button" disabled={index === 0} onClick={() => moveProduct(product.key, -1)}>
                上移
              </button>
              <button
                className="btn secondary btn-compact"
                type="button"
                disabled={index === products.length - 1}
                onClick={() => moveProduct(product.key, 1)}
              >
                下移
              </button>
              <button
                className="btn secondary btn-compact"
                type="button"
                onClick={() =>
                  setProducts((prev) =>
                    prev.length <= 1 ? prev : prev.filter((p) => p.key !== product.key),
                  )
                }
              >
                移除
              </button>
            </div>
          </div>
        ))}
        <button
          className="btn secondary"
          type="button"
          onClick={() => setProducts((prev) => [...prev, emptyProduct(`p${Date.now()}`)])}
        >
          新增商品
        </button>
        {isCreate ? (
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={publishToSharedMenu}
              onChange={(event) => setPublishToSharedMenu(event.target.checked)}
            />
            <span>同時將這份菜單發布到全站共用菜單庫</span>
          </label>
        ) : null}
      </section>

      <div className="row">
        <button className="btn" type="button" disabled={pending} onClick={() => setConfirmOpen(true)}>
          儲存前預覽摘要
        </button>
      </div>

      {confirmOpen ? (
        <div className="modal-backdrop" role="presentation">
          <div className="modal sheet-modal" role="dialog" aria-modal="true" aria-label="代訂摘要">
            <h2 className="modal-title">確認代訂內容</h2>
            <div className="stack modal-body">
              <p>
                <strong>{title.trim() || '（未填服務名稱）'}</strong>
              </p>
              <p className="hint preorder-wrap">店家：{merchantName.trim() || '—'}</p>
              <p className="hint">截止：{orderDeadline || '—'}</p>
              <p className="hint">{PREORDER_PAYMENT_DISCLAIMER}</p>
              <ul className="preorder-summary-list">
                {products
                  .filter((p) => p.isActive)
                  .map((p) => (
                    <li key={p.key} className="preorder-wrap">
                      {p.name || '（未命名）'}
                      {p.specification ? `（${p.specification}）` : ''} · ${p.unitPrice || 0}
                      {p.quantityLimit ? ` · 上限 ${p.quantityLimit}` : ''}
                    </li>
                  ))}
              </ul>
            </div>
            <div className="modal-actions">
              <button className="btn secondary" type="button" disabled={pending} onClick={() => setConfirmOpen(false)}>
                返回修改
              </button>
              <button className="btn" type="button" disabled={pending} onClick={() => void save()}>
                {pending ? '儲存中…' : '確認儲存'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
