import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { InlineHint } from '../components/InlineHint';
import { SiteNav } from '../components/SiteNav';
import { StateBlock } from '../components/StateBlock';
import type { LiffSession } from '../liff';
import type { TransferInvitePreview } from '../../../shared/types';

const REDIRECT_MS = 1_500;

type TerminalKind = 'used' | 'expired' | 'invalid' | null;

function terminalMessage(kind: TerminalKind): string {
  switch (kind) {
    case 'used':
      return '此主揪轉移連結已使用';
    case 'expired':
      return '此主揪轉移連結已過期';
    case 'invalid':
      return '此主揪轉移連結已失效';
    default:
      return '';
  }
}

function classifyTerminal(err: unknown): TerminalKind {
  if (!(err instanceof ApiError)) return null;
  if (err.code === 'transfer_invite_used') return 'used';
  if (err.code === 'transfer_invite_expired') return 'expired';
  if (err.code === 'transfer_invite_cancelled' || err.code === 'GONE') return 'invalid';
  return null;
}

export function TransferInvitePage({ session }: { session: LiffSession }) {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const [invite, setInvite] = useState<TransferInvitePreview | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState(false);
  const [terminal, setTerminal] = useState<TerminalKind>(null);
  const redirected = useRef(false);

  function goToListSoon() {
    if (redirected.current) return;
    redirected.current = true;
    window.setTimeout(() => {
      navigate('/events', { replace: true });
    }, REDIRECT_MS);
  }

  useEffect(() => {
    let cancelled = false;
    api
      .previewTransferInvite(session, token)
      .then((result) => {
        if (cancelled) return;
        setInvite(result.invite);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        const kind = classifyTerminal(err);
        if (kind) {
          setTerminal(kind);
          goToListSoon();
          return;
        }
        setError(err.message);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot load per token
  }, [session, token]);

  async function accept() {
    setPending(true);
    setError('');
    try {
      const result = await api.acceptTransferInvite(session, token);
      setNotice('你已成為此活動的主揪');
      if (session.contextToken) {
        try {
          await api.getEvent(session, result.event.eventId);
        } catch {
          // detail page will reload
        }
        navigate(`/events/${result.event.eventId}`, {
          replace: true,
          state: { transferSuccess: true },
        });
      } else {
        navigate('/events', { replace: true });
      }
    } catch (err) {
      const kind = classifyTerminal(err);
      if (kind) {
        setTerminal(kind);
        goToListSoon();
      } else {
        setError(err instanceof Error ? err.message : '無法接受轉移');
      }
    } finally {
      setPending(false);
    }
  }

  if (terminal) {
    return (
      <div className="stack">
        <SiteNav current="events" />
        <StateBlock kind="error" title={terminalMessage(terminal)}>
          <p className="hint">即將前往活動列表…</p>
          <div className="row" style={{ marginTop: 12, justifyContent: 'center' }}>
            <button
              className="btn"
              type="button"
              onClick={() => navigate('/events', { replace: true })}
            >
              立即前往活動列表
            </button>
          </div>
        </StateBlock>
      </div>
    );
  }

  if (error && !invite) {
    return <StateBlock kind="error" title="無法開啟轉移連結">{error}</StateBlock>;
  }
  if (!invite) {
    return <StateBlock kind="loading" title="載入轉移邀請中…" />;
  }

  const usable = invite.status === 'PENDING' && !invite.isOrganizer;

  return (
    <div className="stack">
      <SiteNav current="events" />
      <div className="topbar">
        <div className="brand">
          <strong>轉移主揪</strong>
          <span>{invite.eventName}</span>
        </div>
      </div>
      {notice ? <div className="toast">{notice}</div> : null}
      {error ? <StateBlock kind="error" title="無法完成轉移">{error}</StateBlock> : null}
      <section className="panel stack">
        <InlineHint question="什麼是轉移主揪？">
          原主揪產生一次性邀請連結。你用 LINE 開啟後，系統會辨識你的身分；按確認後，你才會成為這場活動的主揪。不必輸入 LINE User ID。
        </InlineHint>
        <p>目前主揪：{invite.organizerDisplayName}</p>
        {invite.isOrganizer ? (
          <p className="hint">這是你產生的轉移連結，請分享給新主揪。你不能自己接受。</p>
        ) : null}
        {usable ? (
          <button className="btn" type="button" disabled={pending} onClick={() => void accept()}>
            {pending ? '處理中…' : '確認轉移主揪'}
          </button>
        ) : null}
        <div className="row">
          <Link to="/events" className="btn secondary" replace>
            前往活動列表
          </Link>
        </div>
      </section>
    </div>
  );
}
