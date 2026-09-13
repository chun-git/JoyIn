import { useEffect, useId, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { EventDetail, RegistrationRecord, TransferInviteCreated } from '../../../shared/types';
import { api } from '../api';
import { cancelListButtonLabel } from '../cancel-registration-copy';
import { CancelRegistrationDialog } from '../components/CancelRegistrationDialog';
import { EventCard } from '../components/EventCard';
import { InlineHint } from '../components/InlineHint';
import { JoinHelpSheet } from '../components/JoinHelpSheet';
import { SiteNav } from '../components/SiteNav';
import { StateBlock } from '../components/StateBlock';
import type { LiffSession } from '../liff';

function BackToListButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="btn-back" type="button" onClick={onClick}>
      <span className="btn-back-icon" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path
            d="M15 6L9 12l6 6"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span>返回活動列表</span>
    </button>
  );
}

function CopyEventButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="btn btn-copy-event" type="button" onClick={onClick}>
      <span className="btn-copy-icon" aria-hidden="true">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="2" />
          <path
            d="M5 15V5a2 2 0 0 1 2-2h10"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </span>
      <span>複製活動</span>
    </button>
  );
}

function RegistrationList({
  title,
  emptyLabel,
  items,
  headingExtra,
  onRequestCancel,
}: {
  title: string;
  emptyLabel: string;
  items: RegistrationRecord[];
  headingExtra?: ReactNode;
  onRequestCancel: (registration: RegistrationRecord) => void;
}) {
  const headingId = useId();
  return (
    <section className="panel registration-panel" aria-labelledby={headingId}>
      <div className="section-heading">
        <h2 id={headingId}>{title}</h2>
        {headingExtra}
      </div>
      {items.length === 0 ? <p className="hint list-empty">{emptyLabel}</p> : null}
      {items.length > 0 ? (
        <div className="list">
          {items.map((item) => (
            <div className="list-item" key={item.registrationId}>
              <div className="list-item-main">
                <strong>{item.displayLabel}</strong>
                {item.status === 'WAITLIST' && item.waitlistPosition ? (
                  <div className="hint">候補第 {item.waitlistPosition} 位</div>
                ) : null}
              </div>
              {item.canCancel ? (
                <button
                  className="btn secondary btn-compact"
                  type="button"
                  onClick={() => onRequestCancel(item)}
                >
                  {cancelListButtonLabel(item)}
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function EventDetailPage({ session }: { session: LiffSession }) {
  const { eventId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(() =>
    (location.state as { transferSuccess?: boolean } | null)?.transferSuccess
      ? '你已成為此活動的主揪'
      : '',
  );
  const [proxyName, setProxyName] = useState('');
  const [invite, setInvite] = useState<TransferInviteCreated | null>(null);
  const [pending, setPending] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<RegistrationRecord | null>(null);
  const [cancelPending, setCancelPending] = useState(false);
  const [cancelError, setCancelError] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);

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

  async function confirmCancel() {
    if (!cancelTarget || cancelPending) return;
    setCancelPending(true);
    setCancelError('');
    try {
      await api.cancel(session, cancelTarget.registrationId);
      await reload();
      setNotice(cancelTarget.status === 'WAITLIST' ? '已取消候補' : '已取消報名');
      setCancelTarget(null);
    } catch (err) {
      setCancelError(err instanceof Error ? err.message : '取消失敗');
    } finally {
      setCancelPending(false);
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
    <div className="stack event-detail-page">
      <SiteNav current="events" />

      {/* 1. 返回活動列表 */}
      <div className="detail-back-row">
        <BackToListButton onClick={() => navigate('/events')} />
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

      {/* 2. 活動資訊卡片 */}
      <EventCard event={event} />
      <p className="hint organizer-line">主揪：{event.organizerDisplayName}</p>

      {/* 3. 正式報名名單 */}
      <RegistrationList
        title={`正式報名名單（${event.confirmedCount}／${event.capacity}）`}
        emptyLabel="目前尚無正式報名"
        items={event.registrations.confirmed}
        headingExtra={
          <button
            type="button"
            className="icon-help"
            aria-label="查看報名與代報說明"
            onClick={() => setHelpOpen(true)}
          >
            <span aria-hidden="true">?</span>
          </button>
        }
        onRequestCancel={(item) => {
          setCancelError('');
          setCancelTarget(item);
        }}
      />

      {/* 4. 候補名單（有開放候補時） */}
      {event.waitlistEnabled ? (
        <RegistrationList
          title={`候補名單（${event.waitlistCount}）`}
          emptyLabel="目前尚無候補"
          items={event.registrations.waitlist}
          onRequestCancel={(item) => {
            setCancelError('');
            setCancelTarget(item);
          }}
        />
      ) : null}

      {/* 5. 本人報名／代報操作 */}
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

      {/* 6. 主揪管理 */}
      {event.viewer.isOrganizer ? (
        <section className="panel stack organizer-panel">
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
                    navigate('/events');
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

      {/* 7. 複製活動（整頁最下方） */}
      <div className="copy-event-footer">
        <CopyEventButton onClick={() => navigate(`/events/new?copy=${eventId}`)} />
      </div>

      <CancelRegistrationDialog
        item={cancelTarget}
        pending={cancelPending}
        error={cancelError}
        onDismiss={() => {
          if (cancelPending) return;
          setCancelTarget(null);
          setCancelError('');
        }}
        onConfirm={() => {
          void confirmCancel();
        }}
      />
      <JoinHelpSheet open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}
