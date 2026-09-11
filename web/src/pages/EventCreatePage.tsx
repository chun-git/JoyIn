import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { EventForm } from '../components/EventForm';
import { SiteNav } from '../components/SiteNav';
import { StateBlock } from '../components/StateBlock';
import type { LiffSession } from '../liff';
import type { CreateEventInput } from '../../../shared/types';

export function EventCreatePage({ session }: { session: LiffSession }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const copyId = searchParams.get('copy') || '';
  const [copyInitial, setCopyInitial] = useState<Partial<CreateEventInput> | null>(null);
  const [copyError, setCopyError] = useState('');
  const [copyLoading, setCopyLoading] = useState(Boolean(copyId));

  useEffect(() => {
    if (!copyId) {
      setCopyInitial(null);
      setCopyLoading(false);
      return;
    }
    let cancelled = false;
    setCopyLoading(true);
    api
      .getEvent(session, copyId)
      .then((result) => {
        if (cancelled) return;
        setCopyInitial({
          name: result.event.name,
          address: result.event.address,
          capacity: result.event.capacity,
          waitlistEnabled: result.event.waitlistEnabled,
        });
      })
      .catch((err: Error) => {
        if (!cancelled) setCopyError(err.message);
      })
      .finally(() => {
        if (!cancelled) setCopyLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [copyId, session]);

  async function handleSubmit(input: CreateEventInput) {
    const result = copyId
      ? await api.copyEvent(session, copyId, input)
      : await api.createEvent(session, input);
    navigate(`/events/${result.event.eventId}${copyId ? '?copied=1' : '?created=1'}`);
  }

  if (copyLoading) return <StateBlock kind="loading" title="載入複製內容中…" />;
  if (copyError) return <StateBlock kind="error" title="無法複製活動">{copyError}</StateBlock>;

  return (
    <div className="stack">
      <SiteNav current="events" />
      <div className="topbar">
        <div className="brand">
          <strong>{copyId ? '複製活動' : '新增活動'}</strong>
          <span>{copyId ? '請重新設定開始與結束時間' : '建立後你會成為主揪'}</span>
        </div>
        <button className="btn ghost" type="button" onClick={() => navigate('/')}>
          返回列表
        </button>
      </div>
      {copyId ? (
        <p className="hint">已帶入名稱、地址與人數設定。報名名單、主揪轉移資料與舊活動 ID 不會複製。</p>
      ) : null}
      <EventForm
        initial={copyInitial ?? undefined}
        submitLabel={copyId ? '建立複製活動' : '建立活動'}
        timeHint={copyId ? '請重新設定開始時間與結束時間' : undefined}
        onSubmit={handleSubmit}
      />
    </div>
  );
}
