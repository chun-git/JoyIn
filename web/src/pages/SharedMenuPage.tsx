import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { SharedMenuDetail, SharedMenuSummary, SharedMenuVersion } from '../../../shared/types';
import { api } from '../api';
import { SiteNav } from '../components/SiteNav';
import { StateBlock } from '../components/StateBlock';
import type { LiffSession } from '../liff';

export function SharedMenuPage({ session }: { session: LiffSession }) {
  const [search, setSearch] = useState('');
  const [menus, setMenus] = useState<SharedMenuSummary[]>([]);
  const [selected, setSelected] = useState<SharedMenuDetail | null>(null);
  const [versions, setVersions] = useState<SharedMenuVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(
    async (query = search) => {
      setLoading(true);
      setError('');
      try {
        const result = await api.listSharedMenus(session, query);
        setMenus(result.menus);
      } catch (err) {
        setError(err instanceof Error ? err.message : '載入共用菜單失敗');
      } finally {
        setLoading(false);
      }
    },
    [session, search],
  );

  useEffect(() => {
    void load('');
  }, [session]); // eslint-disable-line react-hooks/exhaustive-deps

  async function showMenu(menuId: string) {
    setError('');
    try {
      const [detail, history] = await Promise.all([
        api.getSharedMenu(session, menuId),
        api.getSharedMenuVersions(session, menuId),
      ]);
      setSelected(detail);
      setVersions(history.versions);
    } catch (err) {
      setError(err instanceof Error ? err.message : '載入菜單失敗');
    }
  }

  return (
    <div className="stack shared-menu-page">
      <SiteNav current="menus" />
      <section className="panel stack">
        <div className="section-heading">
          <div>
            <h1>全站共用菜單</h1>
            <p className="hint">所有登入 JoyIn 的使用者都能搜尋、選用並提出新版本。</p>
          </div>
          <Link className="btn" to="/menus/new">
            建立菜單
          </Link>
        </div>
        <form
          className="shared-menu-search"
          onSubmit={(event) => {
            event.preventDefault();
            void load();
          }}
        >
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜尋店家或商品名稱"
            aria-label="搜尋共用菜單"
          />
          <button className="btn secondary" type="submit" disabled={loading}>
            搜尋
          </button>
        </form>
        {error ? <p className="error">{error}</p> : null}
        {loading ? <StateBlock kind="loading" title="載入菜單中…" /> : null}
        {!loading && menus.length === 0 ? <p className="hint">找不到符合的共用菜單。</p> : null}
        <div className="shared-menu-grid">
          {menus.map((menu) => (
            <button
              className="shared-menu-card"
              type="button"
              key={menu.menuId}
              onClick={() => void showMenu(menu.menuId)}
            >
              <strong>{menu.merchantName}</strong>
              <span>{menu.category || '未分類'}</span>
              <span>{menu.productCount} 項商品</span>
            </button>
          ))}
        </div>
      </section>

      {selected?.currentVersion ? (
        <section className="panel stack">
          <div className="section-heading">
            <div>
              <h2>{selected.currentVersion.merchantName}</h2>
              <p className="hint">目前版本 v{selected.currentVersion.versionNumber}</p>
            </div>
            <Link className="btn secondary" to={`/menus/${selected.menu.menuId}/edit`}>
              提出更新
            </Link>
          </div>
          {selected.currentVersion.description ? <p>{selected.currentVersion.description}</p> : null}
          <div className="shared-menu-products">
            {selected.currentVersion.products
              .filter((product) => product.isActive)
              .map((product) => (
                <article className="shared-menu-product" key={product.menuProductId}>
                  <div className="section-heading">
                    <strong>{product.name}</strong>
                    <strong>${product.basePrice}</strong>
                  </div>
                  {product.description ? <p className="hint">{product.description}</p> : null}
                  {product.optionGroups.map((group) => (
                    <p className="hint preorder-wrap" key={group.optionGroupId}>
                      {group.name}：{group.type === 'TEXT' ? '自由文字' : group.values.map((v) => `${v.name}${v.priceAdjustment ? ` +$${v.priceAdjustment}` : ''}`).join('、')}
                    </p>
                  ))}
                </article>
              ))}
          </div>
          <details>
            <summary>版本紀錄（{versions.length}）</summary>
            <ol className="shared-menu-version-list">
              {versions.map((version) => (
                <li key={version.versionId}>
                  v{version.versionNumber} · {version.status} ·{' '}
                  {new Date(version.createdAt).toLocaleString('zh-TW')}
                </li>
              ))}
            </ol>
          </details>
        </section>
      ) : null}
    </div>
  );
}
