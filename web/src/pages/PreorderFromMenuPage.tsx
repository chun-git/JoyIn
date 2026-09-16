import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { SharedMenuDetail, SharedMenuSummary } from '../../../shared/types';
import { PREORDER_PAYMENT_DISCLAIMER } from '../../../shared/types';
import { api } from '../api';
import { SiteNav } from '../components/SiteNav';
import type { LiffSession } from '../liff';
import { fromDatetimeLocalValue } from '../preorder-format';

export function PreorderFromMenuPage({ session }: { session: LiffSession }) {
  const { eventId = '' } = useParams();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [menus, setMenus] = useState<SharedMenuSummary[]>([]);
  const [detail, setDetail] = useState<SharedMenuDetail | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [title, setTitle] = useState('');
  const [deadline, setDeadline] = useState('');
  const [paymentInstructions, setPaymentInstructions] = useState(PREORDER_PAYMENT_DISCLAIMER);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void api.listSharedMenus(session).then((result) => setMenus(result.menus)).catch((err) => {
      setError(err instanceof Error ? err.message : '載入共用菜單失敗');
    });
  }, [session]);

  async function loadMenus() {
    setError('');
    try {
      const result = await api.listSharedMenus(session, search);
      setMenus(result.menus);
    } catch (err) {
      setError(err instanceof Error ? err.message : '搜尋失敗');
    }
  }

  async function chooseMenu(menu: SharedMenuSummary) {
    try {
      const result = await api.getSharedMenu(session, menu.menuId);
      setDetail(result);
      setSelected(new Set(result.currentVersion?.products.filter((p) => p.isActive).map((p) => p.menuProductId) || []));
      setTitle(`${menu.merchantName}代訂`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '載入菜單失敗');
    }
  }

  async function create() {
    if (!detail?.currentVersion) return;
    setPending(true);
    setError('');
    try {
      const result = await api.createPreorderFromMenu(
        session,
        eventId,
        {
          title,
          orderDeadline: fromDatetimeLocalValue(deadline),
          paymentInstructions,
          menuId: detail.menu.menuId,
          menuVersionId: detail.currentVersion.versionId,
          selectedMenuProductIds: [...selected],
        },
        crypto.randomUUID(),
      );
      navigate(`/preorders/${result.offer.offerId}/manage`, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : '建立代訂失敗');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="stack preorder-from-menu-page">
      <SiteNav current="events" />
      <Link className="btn-back" to={`/events/${eventId}/preorders/new`}><span>返回手動建立</span></Link>
      <section className="panel stack">
        <h1>使用共用菜單建立代訂</h1>
        <form className="shared-menu-search" onSubmit={(e) => { e.preventDefault(); void loadMenus(); }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜尋店家或商品名稱" />
          <button className="btn secondary" type="submit">搜尋</button>
        </form>
        {error ? <p className="error">{error}</p> : null}
        <div className="shared-menu-grid">
          {menus.map((menu) => (
            <button className="shared-menu-card" type="button" key={menu.menuId} onClick={() => void chooseMenu(menu)}>
              <strong>{menu.merchantName}</strong><span>{menu.category || '未分類'}</span><span>{menu.productCount} 項商品</span>
            </button>
          ))}
        </div>
      </section>
      {detail?.currentVersion ? (
        <>
          <section className="panel stack">
            <h2>{detail.currentVersion.merchantName} · v{detail.currentVersion.versionNumber}</h2>
            <p className="hint">建立後會保存此版本的商品、價格與選項快照。</p>
            {detail.currentVersion.products.filter((p) => p.isActive).map((product) => (
              <label className="shared-menu-product checkbox-row" key={product.menuProductId}>
                <input
                  type="checkbox"
                  checked={selected.has(product.menuProductId)}
                  onChange={(e) => setSelected((prev) => {
                    const next = new Set(prev);
                    if (e.target.checked) next.add(product.menuProductId); else next.delete(product.menuProductId);
                    return next;
                  })}
                />
                <span className="preorder-wrap">
                  <strong>{product.name} · ${product.basePrice}</strong>
                  {product.description ? <small>{product.description}</small> : null}
                  {product.optionGroups.length ? <small>{product.optionGroups.map((group) => group.name).join('、')}</small> : null}
                </span>
              </label>
            ))}
          </section>
          <section className="panel stack">
            <label className="field"><span>服務名稱</span><input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
            <label className="field"><span>訂購截止時間</span><input type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} /></label>
            <label className="field"><span>付款說明</span><textarea rows={3} value={paymentInstructions} onChange={(e) => setPaymentInstructions(e.target.value)} /></label>
            <button className="btn" type="button" disabled={pending || selected.size === 0} onClick={() => void create()}>
              {pending ? '建立快照中…' : '建立代訂'}
            </button>
          </section>
        </>
      ) : null}
    </div>
  );
}
