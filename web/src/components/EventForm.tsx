import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { CreateEventInput, GroupMemberPublic } from '../../../shared/types';
import { addOneMinute, taipeiParts, validateEventSchedule } from '@shared/datetime';
import { parseFeeAmount, parseGoogleMapsUrl } from '@shared/event-fields';
import { MemberPreselectList } from './MemberPreselectList';

export function EventForm({
  initial,
  submitLabel,
  onSubmit,
  timeHint,
  memberPreselect,
}: {
  initial?: Partial<CreateEventInput>;
  submitLabel: string;
  onSubmit: (input: CreateEventInput, confirmTimeLocationChange: boolean) => Promise<void>;
  timeHint?: string;
  memberPreselect?: {
    members: GroupMemberPublic[];
    selectedIds: string[];
    onSelectedIdsChange: (ids: string[]) => void;
    loading?: boolean;
    error?: string;
    onRetry?: () => void;
  };
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [startDate, setStartDate] = useState(initial?.startDate ?? '');
  const [startTime, setStartTime] = useState(initial?.startTime ?? '19:00');
  const [endDate, setEndDate] = useState(initial?.endDate ?? '');
  const [endTime, setEndTime] = useState(initial?.endTime ?? '21:00');
  const [endDateTouched, setEndDateTouched] = useState(Boolean(initial?.endDate));
  const [address, setAddress] = useState(initial?.address ?? '');
  const [googleMapsUrl, setGoogleMapsUrl] = useState(initial?.googleMapsUrl ?? '');
  const [feeAmount, setFeeAmount] = useState(String(initial?.feeAmount ?? 0));
  const [capacity, setCapacity] = useState(String(initial?.capacity ?? 10));
  const [waitlistEnabled, setWaitlistEnabled] = useState(initial?.waitlistEnabled ?? true);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const today = taipeiParts().date;
  const nowTime = taipeiParts().time;

  useEffect(() => {
    setName(initial?.name ?? '');
    setStartDate(initial?.startDate ?? '');
    setStartTime(initial?.startTime ?? '19:00');
    setEndDate(initial?.endDate ?? '');
    setEndTime(initial?.endTime ?? '21:00');
    setEndDateTouched(Boolean(initial?.endDate));
    setAddress(initial?.address ?? '');
    setGoogleMapsUrl(initial?.googleMapsUrl ?? '');
    setFeeAmount(String(initial?.feeAmount ?? 0));
    setCapacity(String(initial?.capacity ?? 10));
    setWaitlistEnabled(initial?.waitlistEnabled ?? true);
  }, [initial]);

  function handleStartDateChange(value: string) {
    setStartDate(value);
    setEndDate((current) => {
      if (!value) return current;
      if (!endDateTouched || !current || current < value) return value;
      return current;
    });
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');
    const parsedCapacity = Number(capacity);
    if (!name.trim()) return setError('請填寫活動名稱');
    if (!startDate || !startTime) return setError('請選擇開始時間');
    if (!endDate || !endTime) return setError('請選擇結束時間');

    const isEdit = Boolean(initial?.startDate && initial?.endDate);
    const startChanged =
      !isEdit || nextStartChanged(initial, startDate, startTime);
    const schedule = validateEventSchedule(
      { startDate, startTime, endDate, endTime },
      { requireStartInFuture: startChanged },
    );
    if (!schedule.ok) return setError(schedule.message);
    if (!address.trim()) return setError('請填寫活動地址');

    const mapsParsed = parseGoogleMapsUrl(googleMapsUrl);
    if (!mapsParsed.ok) return setError(mapsParsed.message);
    const feeParsed = parseFeeAmount(feeAmount);
    if (!feeParsed.ok) return setError(feeParsed.message);

    if (!Number.isInteger(parsedCapacity) || parsedCapacity < 1) {
      return setError('人數上限需為大於 0 的整數');
    }

    const preselectedMemberIds = memberPreselect?.selectedIds ?? [];
    if (preselectedMemberIds.length > parsedCapacity) {
      return setError(
        `預先報名人數（${preselectedMemberIds.length}）不可超過正式報名上限（${parsedCapacity}）`,
      );
    }
    if (memberPreselect?.error) {
      return setError(memberPreselect.error);
    }

    const next: CreateEventInput = {
      name: name.trim(),
      startDate,
      startTime,
      endDate,
      endTime,
      address: address.trim(),
      googleMapsUrl: mapsParsed.value,
      feeAmount: feeParsed.value,
      capacity: parsedCapacity,
      waitlistEnabled,
      preselectedMemberIds,
    };

    const timeOrPlaceChanged =
      isEdit &&
      (next.startDate !== initial?.startDate ||
        next.startTime !== initial?.startTime ||
        next.endDate !== initial?.endDate ||
        next.endTime !== initial?.endTime ||
        next.address !== initial?.address ||
        (next.googleMapsUrl ?? null) !== (initial?.googleMapsUrl ?? null));

    if (timeOrPlaceChanged && !window.confirm('時間或地點即將變更，確定要更新活動嗎？')) {
      return;
    }

    setPending(true);
    try {
      await onSubmit(next, timeOrPlaceChanged);
    } catch (err) {
      setError(err instanceof Error ? err.message : '送出失敗');
    } finally {
      setPending(false);
    }
  }

  const startDateMin = initial?.startDate && initial.startDate < today ? initial.startDate : today;
  const nextStartMin = startDate === today ? addOneMinute(nowTime) : null;
  const startUnchanged =
    Boolean(initial?.startDate && initial?.startTime) &&
    startDate === initial?.startDate &&
    startTime === initial?.startTime;
  const startTimeMin =
    nextStartMin && !startUnchanged && startTime >= nextStartMin ? nextStartMin : undefined;
  const endDateMin = startDate || today;
  const endTimeCandidate =
    startDate && endDate && startDate === endDate ? addOneMinute(startTime) : null;
  const endTimeMin =
    endTimeCandidate && endTime >= endTimeCandidate ? endTimeCandidate : undefined;
  const parsedCapacityForUi = Number(capacity);
  const capacityForUi =
    Number.isInteger(parsedCapacityForUi) && parsedCapacityForUi > 0 ? parsedCapacityForUi : 0;

  return (
    <form className="panel event-form" aria-label="活動表單" onSubmit={handleSubmit}>
      <label className="field" htmlFor="event-name">
        <span>活動名稱</span>
        <input
          id="event-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={50}
          required
        />
      </label>
      <div className="field-grid two">
        <label className="field" htmlFor="event-start-date">
          <span>開始日期</span>
          <input
            id="event-start-date"
            type="date"
            min={startDateMin}
            value={startDate}
            onChange={(e) => handleStartDateChange(e.target.value)}
            required
          />
        </label>
        <label className="field" htmlFor="event-start-time">
          <span>開始時間</span>
          <input
            id="event-start-time"
            type="time"
            min={startTimeMin}
            value={startTime}
            onChange={(e) => setStartTime(e.target.value.slice(0, 5))}
            required
          />
        </label>
        <label className="field" htmlFor="event-end-date">
          <span>結束日期</span>
          <input
            id="event-end-date"
            type="date"
            min={endDateMin}
            value={endDate}
            onChange={(e) => {
              setEndDateTouched(true);
              setEndDate(e.target.value);
            }}
            required
          />
        </label>
        <label className="field" htmlFor="event-end-time">
          <span>結束時間</span>
          <input
            id="event-end-time"
            type="time"
            min={endTimeMin}
            value={endTime}
            onChange={(e) => setEndTime(e.target.value.slice(0, 5))}
            required
          />
        </label>
      </div>
      {timeHint ? <p className="hint">{timeHint}</p> : null}
      <label className="field" htmlFor="event-address">
        <span>活動地址</span>
        <input
          id="event-address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          maxLength={120}
          required
        />
      </label>
      <label className="field" htmlFor="event-google-maps-url">
        <span>Google Maps 網址（選填）</span>
        <input
          id="event-google-maps-url"
          type="text"
          inputMode="url"
          autoComplete="off"
          placeholder="https://maps.app.goo.gl/…"
          value={googleMapsUrl}
          onChange={(e) => setGoogleMapsUrl(e.target.value)}
          maxLength={500}
        />
      </label>
      <div className="field">
        <label htmlFor="event-fee-amount">每人費用</label>
        <div className="field-with-suffix">
          <input
            id="event-fee-amount"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={feeAmount}
            onChange={(e) => setFeeAmount(e.target.value)}
            required
            aria-describedby="event-fee-hint"
          />
          <span className="field-suffix" aria-hidden="true">
            元／人
          </span>
        </div>
        <p id="event-fee-hint" className="hint">
          0 代表免費；僅可輸入整數
        </p>
      </div>
      <label className="field" htmlFor="event-capacity">
        <span>正式報名人數上限</span>
        <input
          id="event-capacity"
          type="number"
          min={1}
          max={500}
          value={capacity}
          onChange={(e) => setCapacity(e.target.value)}
          required
        />
      </label>
      <label className="switch">
        <input
          type="checkbox"
          checked={waitlistEnabled}
          onChange={(e) => setWaitlistEnabled(e.target.checked)}
        />
        開放候補
      </label>
      {memberPreselect ? (
        <MemberPreselectList
          members={memberPreselect.members}
          capacity={capacityForUi}
          selectedIds={memberPreselect.selectedIds}
          onChange={memberPreselect.onSelectedIdsChange}
          loading={memberPreselect.loading}
          error={memberPreselect.error}
          onRetry={memberPreselect.onRetry}
        />
      ) : null}
      {error ? <p className="error">{error}</p> : null}
      <div className="row form-actions">
        <button className="btn" type="submit" disabled={pending}>
          {pending ? '送出中…' : submitLabel}
        </button>
      </div>
    </form>
  );
}

function nextStartChanged(
  initial: Partial<CreateEventInput> | undefined,
  startDate: string,
  startTime: string,
): boolean {
  return startDate !== initial?.startDate || startTime !== initial?.startTime;
}
