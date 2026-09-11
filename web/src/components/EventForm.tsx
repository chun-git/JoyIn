import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { CreateEventInput } from '../../../shared/types';
import { InlineHint } from './InlineHint';

function rangeInvalid(startDate: string, startTime: string, endDate: string, endTime: string): boolean {
  const start = new Date(`${startDate}T${startTime}:00+08:00`).getTime();
  const end = new Date(`${endDate}T${endTime}:00+08:00`).getTime();
  return Number.isNaN(start) || Number.isNaN(end) || end <= start;
}

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
  const [address, setAddress] = useState(initial?.address ?? '');
  const [capacity, setCapacity] = useState(String(initial?.capacity ?? 10));
  const [waitlistEnabled, setWaitlistEnabled] = useState(initial?.waitlistEnabled ?? true);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  useEffect(() => {
    setName(initial?.name ?? '');
    setStartDate(initial?.startDate ?? '');
    setStartTime(initial?.startTime ?? '19:00');
    setEndDate(initial?.endDate ?? '');
    setEndTime(initial?.endTime ?? '21:00');
    setAddress(initial?.address ?? '');
    setCapacity(String(initial?.capacity ?? 10));
    setWaitlistEnabled(initial?.waitlistEnabled ?? true);
  }, [initial]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');
    const parsedCapacity = Number(capacity);
    if (!name.trim()) return setError('請填寫活動名稱');
    if (!startDate || !startTime) return setError('請選擇開始時間');
    if (!endDate || !endTime) return setError('請選擇結束時間');
    if (rangeInvalid(startDate, startTime, endDate, endTime)) {
      return setError('結束時間必須晚於開始時間');
    }
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

    const isEdit = Boolean(initial?.startDate && initial?.endDate);
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

  return (
    <form className="panel" onSubmit={handleSubmit}>
      <label className="field">
        <span>活動名稱</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={50} required />
      </label>
      {timeHint ? <p className="hint">{timeHint}</p> : null}
      <InlineHint question="如何設定開始與結束時間？">
        開始、結束都要填日期與時間。結束時間必須晚於開始時間。活動列表依開始時間由近到遠排列。
      </InlineHint>
      <div className="field-grid two">
        <label className="field">
          <span>開始日期</span>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
        </label>
        <label className="field">
          <span>開始時間</span>
          <input
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value.slice(0, 5))}
            required
          />
        </label>
        <label className="field">
          <span>結束日期</span>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} required />
        </label>
        <label className="field">
          <span>結束時間</span>
          <input
            type="time"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value.slice(0, 5))}
            required
          />
        </label>
      </div>
      <label className="field">
        <span>活動地址</span>
        <input value={address} onChange={(e) => setAddress(e.target.value)} maxLength={120} required />
      </label>
      <label className="field">
        <span>正式報名人數上限</span>
        <input
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
      <InlineHint question="如何設定候補？">
        當正式報名額滿後，後續報名者會依序進入候補。有人取消時，系統會自動將最早加入候補的人遞補。
      </InlineHint>
      {error ? <p className="error">{error}</p> : null}
      <div className="row" style={{ marginTop: 16 }}>
        <button className="btn" type="submit" disabled={pending}>
          {pending ? '送出中…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
