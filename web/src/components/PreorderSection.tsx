import { useCallback, useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import type { PreorderOfferSummary } from '../../../shared/types';
import { api } from '../api';
import type { LiffSession } from '../liff';
import { preorderErrorMessage } from '../preorder-errors';
import {
  formatIsoDateTime,
  offerStatusLabel,
  offerStatusTone,
  orderStatusLabel,
  orderStatusTone,
} from '../preorder-format';
import { usePolling } from '../use-polling';

export function PreorderSection({
  session,
  eventId,
  readOnly,
}: {
  session: LiffSession;
  eventId: string;
  readOnly?: boolean;
}) {
  const headingId = useId();
  const [offers, setOffers] = useState<PreorderOfferSummary[]>([]);
  const [canCreate, setCanCreate] = useState(false);
  const [error, setError] = useState('');
  const [syncHint, setSyncHint] = useState('');
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const result = await api.listEventPreorders(session, eventId);
      if (signal?.aborted) return;
      setOffers(result.offers);
      setCanCreate(result.canCreateOffer);
      setError('');
      setHasLoaded(true);
    },
    [session, eventId],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void load()
      .catch((err) => {
        if (cancelled) return;
        setError((prev) => prev || preorderErrorMessage(err, '無法載入代訂服務'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  usePolling(
    async (signal) => {
      await load(signal);
    },
    {
      intervalMs: 10_000,
      enabled: !readOnly && hasLoaded,
      onConsecutiveFailures: () => setSyncHint('代訂資料同步暫時失敗，仍顯示目前內容'),
      onRecovered: () => setSyncHint(''),
    },
  );

  return (
    <section className="panel stack preorder-section" aria-labelledby={headingId}>
      <div className="section-heading">
        <h2 id={headingId}>代訂服務</h2>
      </div>

      {loading && !hasLoaded ? <p className="hint">載入代訂中…</p> : null}
      {error ? <p className="error">{error}</p> : null}
      {syncHint ? <p className="hint">{syncHint}</p> : null}

      {!loading && !error && offers.length === 0 ? (
        <p className="hint list-empty">目前沒有代訂服務</p>
      ) : null}

      {offers.length > 0 ? (
        <div className="preorder-offer-grid">
          {offers.map((offer) => (
            <article className="preorder-offer-card" key={offer.offerId}>
              <div className="preorder-offer-card-head">
                <strong className="preorder-offer-title">{offer.title}</strong>
                <span className={`preorder-status tone-${offerStatusTone(offer.status)}`}>
                  {offerStatusLabel(offer.status)}
                </span>
              </div>
              <p className="hint preorder-wrap">店家：{offer.merchantName}</p>
              <p className="hint preorder-wrap">代訂者：{offer.providerDisplayName}</p>
              <p className="hint">截止：{formatIsoDateTime(offer.orderDeadline)}</p>
              <p className="hint">商品：{offer.productCount} 項</p>
              {offer.myOrderStatus ? (
                <p className={`hint preorder-my-order tone-${orderStatusTone(offer.myOrderStatus)}`}>
                  我的訂單：{orderStatusLabel(offer.myOrderStatus)}
                </p>
              ) : null}
              <div className="row preorder-card-actions">
                <Link className="btn secondary btn-compact" to={`/preorders/${offer.offerId}`}>
                  查看商品
                </Link>
                {offer.providerLineUserId === session.lineUserId ? (
                  <Link
                    className="btn secondary btn-compact"
                    to={`/preorders/${offer.offerId}/manage`}
                  >
                    管理
                  </Link>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      ) : null}

      {!readOnly && canCreate ? (
        <div className="row">
          <Link className="btn" to={`/events/${eventId}/preorders/new`}>
            我要提供代訂
          </Link>
        </div>
      ) : null}
    </section>
  );
}
