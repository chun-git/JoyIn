import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { InlineHint } from '../components/InlineHint';
import { SiteNav } from '../components/SiteNav';
import { StateBlock } from '../components/StateBlock';
import type { LiffSession } from '../liff';
import type { TransferInvitePreview } from '../../../shared/types';

function inviteExpired(invite: TransferInvitePreview): boolean {
  return new Date(invite.expiresAt).getTime() <= Date.now();
}

export function TransferInvitePage({ session }: { session: LiffSession }) {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const [invite, setInvite] = useState<TransferInvitePreview | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .previewTransferInvite(session, token)
      .then((result) => {
        if (!cancelled) setInvite(result.invite);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [session, token]);

  async function accept() {
    if (!window.confirm('確定要接受主揪轉移嗎？接受後你會成為此活動的主揪。')) {
      return;
    }
    setPending(true);
    setError('');
    try {
      const result = await api.acceptTransferInvite(session, token);
      setNotice('主揪已轉移給你');
      if (session.contextToken) {
        navigate(`/events/${result.event.eventId}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '無法接受轉移');
    } finally {
      setPending(false);
    }
  }

  if (error && !invite) {
    return <StateBlock kind="error" title="無法開啟轉移連結">{error}</StateBlock>;
  }
  if (!invite) {
    return <StateBlock kind="loading" title="載入轉移邀請中…" />;
  }

  const expired = inviteExpired(invite);
  const usable = invite.status === 'PENDING' && !expired && !invite.isOrganizer;

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
        {invite.status === 'ACCEPTED' ? <p className="hint">此轉移連結已經使用過。</p> : null}
        {invite.status === 'CANCELLED' || expired ? <p className="hint">此轉移連結已失效或過期。</p> : null}
        {usable ? (
          <button className="btn" type="button" disabled={pending} onClick={() => void accept()}>
            {pending ? '處理中…' : '確認接受主揪'}
          </button>
        ) : null}
      </section>
    </div>
  );
}
