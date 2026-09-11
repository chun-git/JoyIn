import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { EventDetail, RegistrationRecord } from '../../../shared/types';
import { api } from '../api';
import { EventCard } from '../components/EventCard';
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
  const navigate = useNavigate();
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [proxyName, setProxyName] = useState('');
  const [transferUserId, setTransferUserId] = useState('');
  const [transferName, setTransferName] = useState('');
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
      <div className="topbar">
        <button className="btn ghost" type="button" onClick={() => navigate('/')}>
          返回列表
        </button>
      </div>
      {notice ? <div className="toast">{notice}</div> : null}
      {error ? <StateBlock kind="error" title="操作失敗">{error}</StateBlock> : null}
      <EventCard event={event} />
      <p className="hint">主揪：{event.organizerDisplayName}</p>

      <section className="panel stack">
        <h2>報名</h2>
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
          <label className="field">
            <span>轉移主揪（LINE User ID）</span>
            <input value={transferUserId} onChange={(e) => setTransferUserId(e.target.value)} />
          </label>
          <label className="field">
            <span>新主揪顯示名稱</span>
            <input value={transferName} onChange={(e) => setTransferName(e.target.value)} />
          </label>
          <p className="hint">可從正式報名名單中選擇本人報名者作為新主揪。</p>
          <select
            onChange={(e) => {
              const selected = event.registrations.confirmed.find(
                (item) => item.registrationId === e.target.value,
              );
              if (selected?.lineUserId) {
                setTransferUserId(selected.lineUserId);
                setTransferName(selected.participantName);
              }
            }}
          >
            <option value="">從正式報名名單選擇</option>
            {event.registrations.confirmed
              .filter((item) => item.type === 'SELF' && item.lineUserId)
              .map((item) => (
                <option key={item.registrationId} value={item.registrationId}>
                  {item.participantName}
                </option>
              ))}
          </select>
          <button
            className="btn"
            type="button"
            disabled={pending || !transferUserId.trim() || !transferName.trim()}
            onClick={() =>
              run(
                () => api.transferOrganizer(session, eventId, transferUserId.trim(), transferName.trim()),
                '主揪已轉移',
              )
            }
          >
            轉移主揪
          </button>
        </section>
      ) : null}
    </div>
  );
}
