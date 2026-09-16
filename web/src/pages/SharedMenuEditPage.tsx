import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AI_MENU_DISCLAIMER,
  type ProductOptionGroupInput,
  type SharedMenuProductInput,
} from '../../../shared/types';
import { api } from '../api';
import { SiteNav } from '../components/SiteNav';
import { StateBlock } from '../components/StateBlock';
import type { LiffSession } from '../liff';

type ProductDraft = SharedMenuProductInput & {
  key: string;
  aiConfidence?: { name: number; description: number; basePrice: number };
};

function newProduct(): ProductDraft {
  return {
    key: crypto.randomUUID(),
    name: '',
    description: '',
    basePrice: 0,
    isActive: true,
    optionGroups: [],
  };
}

export function SharedMenuEditPage({ session }: { session: LiffSession }) {
  const { menuId = '' } = useParams();
  const navigate = useNavigate();
  const [expectedVersionId, setExpectedVersionId] = useState<string | null>(null);
  const [merchantName, setMerchantName] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [merchantUrl, setMerchantUrl] = useState('');
  const [menuImageUrl, setMenuImageUrl] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [products, setProducts] = useState<ProductDraft[]>([newProduct()]);
  const [imageUrl, setImageUrl] = useState('');
  const [quota, setQuota] = useState<{ used: number; limit: number; nextResetAt: string } | null>(null);
  const [aiImported, setAiImported] = useState(false);
  const [aiParseId, setAiParseId] = useState<string | null>(null);
  const [aiTopConfidence, setAiTopConfidence] = useState<{ merchant: number; category: number } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(Boolean(menuId));
  const [pending, setPending] = useState(false);
  const [aiPending, setAiPending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    void api.getMyAiMenuQuota(session).then(({ quota: next }) => {
      if (!cancelled) setQuota(next);
    }).catch(() => undefined);
    if (!menuId) return () => { cancelled = true; };
    void api
      .getSharedMenu(session, menuId)
      .then((detail) => {
        if (cancelled || !detail.currentVersion) return;
        const version = detail.currentVersion;
        setExpectedVersionId(version.versionId);
        setMerchantName(version.merchantName);
        setCategory(version.category);
        setDescription(version.description);
        setMerchantUrl(version.merchantUrl || '');
        setMenuImageUrl(version.menuImageUrl || '');
        setSourceUrl(version.sourceUrl || '');
        setProducts(version.products.map((product) => ({ ...product, key: crypto.randomUUID() })));
      })
      .catch((err) => setError(err instanceof Error ? err.message : '載入菜單失敗'))
      .finally(() => setLoading(false));
    return () => { cancelled = true; };
  }, [menuId, session]);

  function patchProduct(key: string, patch: Partial<ProductDraft>) {
    setProducts((prev) => prev.map((product) => product.key === key ? { ...product, ...patch } : product));
  }

  function patchGroup(productKey: string, index: number, patch: Partial<ProductOptionGroupInput>) {
    setProducts((prev) => prev.map((product) => product.key === productKey ? {
      ...product,
      optionGroups: (product.optionGroups || []).map((group, groupIndex) => groupIndex === index ? { ...group, ...patch } : group),
    } : product));
  }

  async function parseImage() {
    setAiPending(true);
    setError('');
    try {
      const { draft } = await api.parseMenuImage(session, imageUrl, crypto.randomUUID());
      setAiImported(true);
      setAiParseId(draft.parseId);
      setAiTopConfidence({
        merchant: draft.merchantName.confidence,
        category: draft.category.confidence,
      });
      setConfirmed(false);
      setMerchantName(String(draft.merchantName.value || ''));
      setCategory(String(draft.category.value || ''));
      setProducts(draft.products.map((product) => ({
        key: crypto.randomUUID(),
        name: String(product.name.value || ''),
        description: String(product.description.value || ''),
        basePrice: Math.max(0, Math.round(Number(product.basePrice.value) || 0)),
        isActive: true,
        optionGroups: product.optionGroups,
        aiConfidence: {
          name: product.name.confidence,
          description: product.description.confidence,
          basePrice: product.basePrice.confidence,
        },
      })));
      const result = await api.getMyAiMenuQuota(session);
      setQuota(result.quota);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI 解析失敗，可重試或改用手動輸入');
    } finally {
      setAiPending(false);
    }
  }

  async function saveAndPublish() {
    setPending(true);
    setError('');
    try {
      const input = {
        expectedCurrentVersionId: expectedVersionId,
        aiParseId,
        merchantName,
        category,
        description,
        merchantUrl: merchantUrl || null,
        menuImageUrl: menuImageUrl || null,
        sourceUrl: sourceUrl || null,
        products: products.map(({ key: _key, aiConfidence: _confidence, ...product }, index) => ({ ...product, sortOrder: index })),
      };
      const result = menuId
        ? await api.createSharedMenuVersion(session, menuId, input, crypto.randomUUID())
        : await api.createSharedMenuDraft(session, input, crypto.randomUUID());
      await api.publishSharedMenuVersion(
        session,
        result.version.menuId,
        result.version.versionId,
        expectedVersionId,
        confirmed,
      );
      navigate('/menus', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : '儲存菜單失敗');
    } finally {
      setPending(false);
    }
  }

  if (loading) return <StateBlock kind="loading" title="載入菜單中…" />;

  return (
    <div className="stack shared-menu-edit-page">
      <SiteNav current="menus" />
      <Link className="btn-back" to="/menus"><span>返回共用菜單</span></Link>
      <section className="panel stack">
        <h1>{menuId ? '提出菜單新版本' : '建立共用菜單'}</h1>
        <div className="ai-menu-import stack">
          <h2>從圖片網址匯入</h2>
          <p className="hint">
            本月 AI 菜單解析：已使用 {quota?.used ?? '—'}／{quota?.limit ?? 1} 次
            {quota ? `；${new Date(quota.nextResetAt).toLocaleDateString('zh-TW')} 重置` : ''}
          </p>
          <div className="shared-menu-search">
            <input
              type="url"
              value={imageUrl}
              onChange={(event) => setImageUrl(event.target.value)}
              placeholder="公開 HTTPS 圖片直連網址"
            />
            <button className="btn secondary" type="button" disabled={aiPending || !imageUrl.trim()} onClick={() => void parseImage()}>
              {aiPending ? 'AI 解析中…' : '開始解析'}
            </button>
          </div>
          <p className="hint">解析失敗時可修正網址重試，或直接使用下方手動輸入。</p>
        </div>
        {error ? <p className="error">{error}</p> : null}
        <label className="field"><span>店家名稱{aiTopConfidence ? `（AI 信心 ${Math.round(aiTopConfidence.merchant * 100)}%）` : ''}</span><input value={merchantName} onChange={(e) => setMerchantName(e.target.value)} /></label>
        <label className="field"><span>分類{aiTopConfidence ? `（AI 信心 ${Math.round(aiTopConfidence.category * 100)}%）` : ''}</span><input value={category} onChange={(e) => setCategory(e.target.value)} /></label>
        <label className="field"><span>說明</span><textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
        <label className="field"><span>店家網址（選填）</span><input type="url" value={merchantUrl} onChange={(e) => setMerchantUrl(e.target.value)} /></label>
        <label className="field"><span>菜單圖片網址（選填）</span><input type="url" value={menuImageUrl} onChange={(e) => setMenuImageUrl(e.target.value)} /></label>
        <label className="field"><span>資料來源網址（選填）</span><input type="url" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} /></label>
      </section>

      <section className="panel stack">
        <div className="section-heading"><h2>商品與選項</h2><span className="hint">{products.length} 項</span></div>
        {products.map((product) => (
          <article className="preorder-product-editor" key={product.key}>
            <label className="field"><span>商品名稱{product.aiConfidence ? `（AI 信心 ${Math.round(product.aiConfidence.name * 100)}%）` : ''}</span><input value={product.name} onChange={(e) => patchProduct(product.key, { name: e.target.value })} /></label>
            <label className="field"><span>商品說明{product.aiConfidence ? `（AI 信心 ${Math.round(product.aiConfidence.description * 100)}%）` : ''}</span><textarea rows={2} value={product.description || ''} onChange={(e) => patchProduct(product.key, { description: e.target.value })} /></label>
            <label className="field"><span>基本價格{product.aiConfidence ? `（AI 信心 ${Math.round(product.aiConfidence.basePrice * 100)}%）` : ''}</span><input inputMode="numeric" value={product.basePrice} onChange={(e) => patchProduct(product.key, { basePrice: Number(e.target.value) })} /></label>
            {(product.optionGroups || []).map((group, groupIndex) => (
              <div className="preorder-option-group" key={`${product.key}-${groupIndex}`}>
                <div className="preorder-product-row">
                  <label className="field"><span>選項群組</span><input value={group.name} onChange={(e) => patchGroup(product.key, groupIndex, { name: e.target.value })} /></label>
                  <label className="field"><span>類型</span><select value={group.type} onChange={(e) => patchGroup(product.key, groupIndex, { type: e.target.value as ProductOptionGroupInput['type'], values: e.target.value === 'TEXT' ? [] : group.values })}><option value="SINGLE">單選</option><option value="MULTIPLE">複選</option><option value="TEXT">自由文字</option></select></label>
                </div>
                <label className="checkbox-row"><input type="checkbox" checked={group.isRequired} onChange={(e) => patchGroup(product.key, groupIndex, { isRequired: e.target.checked, minSelections: e.target.checked ? 1 : 0 })} /><span>必填</span></label>
                {group.type !== 'TEXT' ? group.values.map((value, valueIndex) => (
                  <div className="preorder-option-value" key={valueIndex}>
                    <input value={value.name} onChange={(e) => patchGroup(product.key, groupIndex, { values: group.values.map((item, i) => i === valueIndex ? { ...item, name: e.target.value } : item) })} placeholder="選項名稱" />
                    <input inputMode="numeric" value={value.priceAdjustment} onChange={(e) => patchGroup(product.key, groupIndex, { values: group.values.map((item, i) => i === valueIndex ? { ...item, priceAdjustment: Number(e.target.value) } : item) })} placeholder="加價" />
                    <button className="btn secondary btn-compact" type="button" onClick={() => patchGroup(product.key, groupIndex, { values: group.values.filter((_, i) => i !== valueIndex) })}>移除</button>
                  </div>
                )) : null}
                <div className="row">
                  {group.type !== 'TEXT' ? <button className="btn secondary btn-compact" type="button" onClick={() => patchGroup(product.key, groupIndex, { values: [...group.values, { name: '', priceAdjustment: 0, isActive: true }] })}>新增選項值</button> : null}
                  <button className="btn secondary btn-compact" type="button" onClick={() => patchProduct(product.key, { optionGroups: (product.optionGroups || []).filter((_, i) => i !== groupIndex) })}>移除群組</button>
                </div>
              </div>
            ))}
            <div className="row">
              <button className="btn secondary btn-compact" type="button" onClick={() => patchProduct(product.key, { optionGroups: [...(product.optionGroups || []), { name: '', type: 'SINGLE', isRequired: false, minSelections: 0, maxSelections: 1, values: [] }] })}>新增選項群組</button>
              <button className="btn secondary btn-compact" type="button" disabled={products.length === 1} onClick={() => setProducts((prev) => prev.filter((item) => item.key !== product.key))}>移除商品</button>
            </div>
          </article>
        ))}
        <button className="btn secondary" type="button" onClick={() => setProducts((prev) => [...prev, newProduct()])}>新增商品</button>
      </section>

      <section className="panel stack ai-confirmation">
        {aiImported ? <p>{AI_MENU_DISCLAIMER}</p> : <p className="hint">發布後所有 JoyIn 使用者都可搜尋與選用；後續修改會建立新版本，不覆蓋舊資料。</p>}
        <label className="checkbox-row">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          <span>我已確認菜單內容與價格正確</span>
        </label>
        <button className="btn" type="button" disabled={pending || !confirmed} onClick={() => void saveAndPublish()}>
          {pending ? '建立版本中…' : '建立並發布版本'}
        </button>
      </section>
    </div>
  );
}
