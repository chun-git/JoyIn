import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { EventForm } from '../components/EventForm';
import { SiteNav } from '../components/SiteNav';
import { StateBlock } from '../components/StateBlock';
import type { LiffSession } from '../liff';
import type { CreateEventInput, GroupMemberPublic } from '../../../shared/types';

export function EventCreatePage({ session }: { session: LiffSession }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const copyId = searchParams.get('copy') || '';
  const [copyInitial, setCopyInitial] = useState<Partial<CreateEventInput> | null>(null);
  const [copyError, setCopyError] = useState('');
  const [copyLoading, setCopyLoading] = useState(Boolean(copyId));
  const [members, setMembers] = useState<GroupMemberPublic[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);
  const [membersError, setMembersError] = useState('');

  const loadMembers = useCallback(
    async (forceRefresh = false) => {
      setMembersLoading(true);
      setMembersError('');
      try {
        const result = await api.listGroupMembers(session, { refresh: forceRefresh });
        setMembers(result.members);
      } catch (err) {
        const message =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : '暫時無法取得群組成員';
        setMembers([]);
        setMembersError(message || '暫時無法取得群組成員');
      } finally {
        setMembersLoading(false);
      }
    },
    [session],
  );

  useEffect(() => {
    void loadMembers(false);
  }, [loadMembers]);

  useEffect(() => {
    if (!copyId) {
      setCopyInitial(null);
      setCopyLoading(false);
      setSelectedIds([]);
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
          googleMapsUrl: result.event.googleMapsUrl,
          feeAmount: result.event.feeAmount,
          capacity: result.event.capacity,
          waitlistEnabled: result.event.waitlistEnabled,
        });
        const preselect = result.event.registrations.confirmed
          .map((item) => item.participantLineUserId || item.lineUserId)
          .filter((id): id is string => Boolean(id));
        setSelectedIds([...new Set(preselect)]);
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
        <button className="btn ghost" type="button" onClick={() => navigate('/events')}>
          返回列表
        </button>
      </div>
      {copyId ? (
        <p className="hint">
          已帶入名稱、地址、Google Maps 網址、費用、人數，以及原活動具 LINE
          身分的正式報名成員。文字代報、候補與已取消者不複製。請重新設定時間後建立。
        </p>
      ) : null}
      <EventForm
        initial={copyInitial ?? undefined}
        submitLabel={copyId ? '建立複製活動' : '建立活動'}
        timeHint={copyId ? '請重新設定開始時間與結束時間' : undefined}
        onSubmit={handleSubmit}
        memberPreselect={{
          members,
          selectedIds,
          onSelectedIdsChange: setSelectedIds,
          loading: membersLoading,
          error: membersError,
          onRetry: () => void loadMembers(true),
        }}
      />
    </div>
  );
}
