import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { EventDetail, RegistrationRecord, TransferInviteCreated } from '../../../shared/types';
import { api } from '../api';
import { EventCard } from '../components/EventCard';
import { InlineHint } from '../components/InlineHint';
import { SiteNav } from '../components/SiteNav';
import { StateBlock } from '../components/StateBlock';
import type { LiffSession } from '../liff';

function RegistrationList({
  title,
  items,
  onCancel,
}: {
  title: string;
  items: RegistrationRecord[];
  onCancel: (registration: RegistrationRecord) => void;
}) {
  return (
    <section className="panel">
      <h2>{title}</h2>
      {items.length === 0 ? <p className="hint">目前沒有資料</p> : null}
      <div className="list">
        {items.map((item) => (
          <div className="list-item" key={item.registrationId}>
            <div>
              <strong>{item.displayLabel}</strong>
              {item.status === 'WAITLIST' && item.waitlistPosition ? (
                <div className="hint">候補第 {item.waitlistPosition} 位</div>
              ) : null}
            </div>
            {item.canCancel ? (
              <button className="btn secondary" type="button" onClick={() => onCancel(item)}>
                取消
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

export function EventDetailPage({ session }: { session: LiffSession }) {
  const { eventId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [proxyName, setProxyName] = useState('');
  const [invite, setInvite] = useState<TransferInviteCreated | null>(null);
  const [pending, setPending] = useState(false);

  async function reload() {
    const result = await api.getEvent(session, eventId);
    setEvent(result.event);
  }

  useEffect(() => {
    let cancelled = false;
    api
      .getEvent(session, eventId)
      .then((result) => {
        if (!cancelled) setEvent(result.event);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [eventId, session]);

  async function run(action: () => Promise<unknown>, success: string) {
    setPending(true);
    setError('');
    try {
      await action();
      await reload();
      setNotice(success);
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失敗');
    } finally {
      setPending(false);
    }
  }

  const shareUrl = invite ? `${window.location.origin}${invite.sharePath}` : '';
  const justCreated = searchParams.get('created') === '1';
  const justCopied = searchParams.get('copied') === '1';

  if (!event && !error) return <StateBlock kind="loading" title="載入活動中…" />;
  if (error && !event) return <StateBlock kind="error" title="無法載入活動">{error}</StateBlock>;
  if (!event) return null;

  const full = event.confirmedCount >= event.capacity;
  const canJoin =
    event.status === 'OPEN' &&
    !event.viewer.selfRegistration &&
    (!full || event.waitlistEnabled);
  const joinLabel = full && event.waitlistEnabled ? '加入候補' : '本人報名';
  const proxyLabel = full && event.waitlistEnabled ? '代他人加入候補' : '代他人報名';

  return (
    <div className="stack">
      <SiteNav current="events" />
      <div className="topbar">
        <button className="btn ghost" type="button" onClick={() => navigate('/')}>
          返回列表
        </button>
      </div>
      {justCreated || justCopied ? (
        <section className="panel stack">
          <strong>{justCopied ? '已建立複製活動' : '活動已建立，你是這場的主揪'}</strong>
          <p className="hint">可以開始邀請大家報名，或先看主揪能做哪些管理。</p>
          <div className="row">
            <Link to="/help/organize" className="btn secondary">
              查看主揪操作
            </Link>
          </div>
        </section>
      ) : null}
      {notice ? <div className="toast">{notice}</div> : null}
      {error ? <StateBlock kind="error" title="操作失敗">{error}</StateBlock> : null}
      <EventCard event={event} />
      <p className="hint">主揪：{event.organizerDisplayName}</p>
      <div className="row">
        <button className="btn secondary" type="button" onClick={() => navigate(`/events/new?copy=${eventId}`)}>
          複製活動
        </button>
      </div>

      <section className="panel stack">
        <h2>報名</h2>
        <Link to="/help/join" className="hint-link">
          查看報名與代報說明
        </Link>
        {event.status !== 'OPEN' ? <p className="hint">此活動已關閉報名。</p> : null}
        <div className="row">
          <button
            className="btn"
            type="button"
            disabled={!canJoin || pending}
            onClick={() => run(() => api.join(session, eventId), full ? '已加入候補' : '報名成功')}
          >
            {joinLabel}
          </button>
        </div>
        {event.viewer.selfRegistration ? (
          <p className="success">
            你已{event.viewer.selfRegistration.status === 'WAITLIST' ? '加入候補' : '報名'}：
            {event.viewer.selfRegistration.displayLabel}
            {event.viewer.selfRegistration.waitlistPosition
              ? `（第 ${event.viewer.selfRegistration.waitlistPosition} 位）`
              : ''}
          </p>
        ) : null}
        <label className="field">
          <span>{proxyLabel}</span>
          <input
            value={proxyName}
            onChange={(e) => setProxyName(e.target.value)}
            placeholder="參加者姓名，例如 Amy"
          />
        </label>
        <button
          className="btn secondary"
          type="button"
          disabled={pending || event.status !== 'OPEN' || !proxyName.trim()}
          onClick={() =>
            run(async () => {
              await api.proxyJoin(session, eventId, proxyName.trim());
              setProxyName('');
            }, '代報成功')
          }
        >
          {proxyLabel}
        </button>
      </section>

      <RegistrationList
        title="正式報名名單"
        items={event.registrations.confirmed}
        onCancel={(item) => run(() => api.cancel(session, item.registrationId), '已取消報名')}
      />
      <RegistrationList
        title="候補名單"
        items={event.registrations.waitlist}
        onCancel={(item) => run(() => api.cancel(session, item.registrationId), '已取消候補')}
      />

      {event.viewer.isOrganizer ? (
        <section className="panel stack">
          <h2>主揪管理</h2>
          <div className="row">
            <button className="btn secondary" type="button" onClick={() => navigate(`/events/${eventId}/edit`)}>
              編輯活動
            </button>
            <button
              className="btn secondary"
              type="button"
              disabled={pending || event.status !== 'OPEN'}
              onClick={() => {
                if (window.confirm('確定要關閉報名嗎？')) {
                  void run(() => api.closeEvent(session, eventId), '已關閉報名');
                }
              }}
            >
              關閉報名
            </button>
            <button
              className="btn danger"
              type="button"
              disabled={pending}
              onClick={() => {
                if (window.confirm('確定要刪除活動嗎？此為軟刪除，列表將不再顯示。')) {
                  void run(async () => {
                    await api.deleteEvent(session, eventId);
                    navigate('/');
                  }, '活動已刪除');
                }
              }}
            >
              刪除活動
            </button>
          </div>
          <h3>轉移主揪</h3>
          <p className="hint">產生一次性邀請連結後分享給對方。對方開啟後會以 LINE 身分確認，才會完成轉移。</p>
          <InlineHint question="什麼是轉移主揪？">
            把這場活動的管理權交給另一位群組成員。對方開啟邀請連結並按確認後才會生效，不必輸入 LINE User ID。
            <div className="row" style={{ marginTop: 8 }}>
              <Link to="/help/transfer" className="hint-link">
                查看完整步驟
              </Link>
            </div>
          </InlineHint>
          <div className="row">
            <button
              className="btn"
              type="button"
              disabled={pending}
              onClick={() =>
                run(async () => {
                  const result = await api.createTransferInvite(session, eventId);
                  setInvite(result.invite);
                }, invite ? '已重新產生轉移連結，舊連結已失效' : '已產生轉移連結')
              }
            >
              {invite ? '重新產生連結' : '產生轉移連結'}
            </button>
            {invite ? (
              <button
                className="btn secondary"
                type="button"
                disabled={pending}
                onClick={() =>
                  run(async () => {
                    await api.cancelTransferInvites(session, eventId);
                    setInvite(null);
                  }, '已取消轉移連結')
                }
              >
                取消連結
              </button>
            ) : null}
          </div>
          {invite ? (
            <>
              <div className="share-box">{shareUrl}</div>
              <button
                className="btn secondary"
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(shareUrl);
                  setNotice('已複製轉移連結');
                }}
              >
                複製連結
              </button>
            </>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
