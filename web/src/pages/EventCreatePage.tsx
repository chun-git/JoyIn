import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { CreateEventInput, PreselectMemberItem } from '../../../shared/types';
import { api } from '../api';
import { EventForm } from '../components/EventForm';
import { SiteNav } from '../components/SiteNav';
import { StateBlock } from '../components/StateBlock';
import type { LiffSession } from '../liff';

export function EventCreatePage({ session }: { session: LiffSession }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const copyId = searchParams.get('copy') || '';
  const [copyInitial, setCopyInitial] = useState<Partial<CreateEventInput> | null>(null);
  const [copyError, setCopyError] = useState('');
  const [copyLoading, setCopyLoading] = useState(Boolean(copyId));
  const [members, setMembers] = useState<PreselectMemberItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);
  const [membersHint, setMembersHint] = useState<string | null>(null);
  const [emptyMessage, setEmptyMessage] = useState<string | null>(null);
  const [attendedTitle, setAttendedTitle] = useState('上次參加');
  const [waitlistTitle, setWaitlistTitle] = useState('上次候補');

  const loadMembers = useCallback(
    async (forceRefresh = false) => {
      setMembersLoading(true);
      try {
        const result = await api.listGroupMembers(session, {
          refresh: forceRefresh,
          copyEventId: copyId || undefined,
        });
        setMembers(result.members);
        setMembersHint(result.hint);
        setEmptyMessage(result.emptyMessage);
        setAttendedTitle(result.attendedTitle);
        setWaitlistTitle(result.waitlistTitle);
        setSelectedIds((prev) => {
          if (!forceRefresh) return result.defaultSelectedIds;
          const valid = new Set(result.members.map((m) => m.lineUserId));
          return prev.filter((id) => valid.has(id));
        });
      } catch {
        setMembersHint('目前顯示最近使用過的會員名單');
        setMembers((prev) => {
          if (prev.length === 0) {
            setEmptyMessage('目前還沒有可選擇的會員');
          }
          return prev;
        });
      } finally {
        setMembersLoading(false);
      }
    },
    [copyId, session],
  );

  useEffect(() => {
    void loadMembers(false);
  }, [loadMembers]);

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
          googleMapsUrl: result.event.googleMapsUrl,
          feeAmount: result.event.feeAmount,
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
        <button className="btn ghost" type="button" onClick={() => navigate('/events')}>
          返回列表
        </button>
      </div>
      {copyId ? (
        <p className="hint">
          已帶入名稱、地址、Google Maps 網址、費用、人數，以及原活動具 LINE
          身分的正式報名成員。文字代報、候補與已取消者不預選。請重新設定時間後建立。
        </p>
      ) : null}
      <EventForm
        initial={copyInitial ?? undefined}
        submitLabel={copyId ? '建立複製活動' : '建立活動'}
        timeHint={copyId ? '請重新設定開始時間與結束時間' : undefined}
        onSubmit={handleSubmit}
        memberPreselect={{
          members,
          attendedTitle,
          waitlistTitle,
          selectedIds,
          onSelectedIdsChange: setSelectedIds,
          loading: membersLoading,
          hint: membersHint,
          emptyMessage,
          onRefresh: () => void loadMembers(true),
        }}
      />
    </div>
  );
}
