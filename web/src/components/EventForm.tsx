import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { CreateEventInput } from '../../../shared/types';
import { addOneMinute, taipeiParts, validateEventSchedule } from '@shared/datetime';
import { InlineHint } from './InlineHint';

export function EventForm({
  initial,
  submitLabel,
  onSubmit,
  timeHint,
}: {
  initial?: Partial<CreateEventInput>;
  submitLabel: string;
  onSubmit: (input: CreateEventInput, confirmTimeLocationChange: boolean) => Promise<void>;
  timeHint?: string;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [startDate, setStartDate] = useState(initial?.startDate ?? '');
  const [startTime, setStartTime] = useState(initial?.startTime ?? '19:00');
  const [endDate, setEndDate] = useState(initial?.endDate ?? '');
  const [endTime, setEndTime] = useState(initial?.endTime ?? '21:00');
  const [endDateTouched, setEndDateTouched] = useState(Boolean(initial?.endDate));
  const [address, setAddress] = useState(initial?.address ?? '');
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
    if (!Number.isInteger(parsedCapacity) || parsedCapacity < 1) {
      return setError('人數上限需為大於 0 的整數');
    }

    const next: CreateEventInput = {
      name: name.trim(),
      startDate,
      startTime,
      endDate,
      endTime,
      address: address.trim(),
      capacity: parsedCapacity,
      waitlistEnabled,
    };

    const timeOrPlaceChanged =
      isEdit &&
      (next.startDate !== initial?.startDate ||
        next.startTime !== initial?.startTime ||
        next.endDate !== initial?.endDate ||
        next.endTime !== initial?.endTime ||
        next.address !== initial?.address);

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
