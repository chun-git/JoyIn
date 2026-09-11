import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { CreateEventInput } from '../../../shared/types';

export function EventForm({
  initial,
  submitLabel,
  onSubmit,
}: {
  initial?: Partial<CreateEventInput>;
  submitLabel: string;
  onSubmit: (input: CreateEventInput, confirmTimeLocationChange: boolean) => Promise<void>;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [eventDate, setEventDate] = useState(initial?.eventDate ?? '');
  const [eventTime, setEventTime] = useState(initial?.eventTime ?? '19:00');
  const [address, setAddress] = useState(initial?.address ?? '');
  const [capacity, setCapacity] = useState(String(initial?.capacity ?? 10));
  const [waitlistEnabled, setWaitlistEnabled] = useState(initial?.waitlistEnabled ?? true);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  useEffect(() => {
    setName(initial?.name ?? '');
    setEventDate(initial?.eventDate ?? '');
    setEventTime(initial?.eventTime ?? '19:00');
    setAddress(initial?.address ?? '');
    setCapacity(String(initial?.capacity ?? 10));
    setWaitlistEnabled(initial?.waitlistEnabled ?? true);
  }, [initial]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');
    const parsedCapacity = Number(capacity);
    if (!name.trim()) return setError('請填寫活動名稱');
    if (!eventDate) return setError('請選擇活動日期');
    if (!eventTime) return setError('請選擇活動時間');
    if (!address.trim()) return setError('請填寫活動地址');
    if (!Number.isInteger(parsedCapacity) || parsedCapacity < 1) {
      return setError('人數上限需為大於 0 的整數');
    }

    const next: CreateEventInput = {
      name: name.trim(),
      eventDate,
      eventTime,
      address: address.trim(),
      capacity: parsedCapacity,
      waitlistEnabled,
    };

    const timeOrPlaceChanged =
      Boolean(initial) &&
      (next.eventDate !== initial?.eventDate ||
        next.eventTime !== initial?.eventTime ||
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
      <label className="field">
        <span>活動日期</span>
        <input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} required />
      </label>
      <label className="field">
        <span>活動時間</span>
        <input
          type="time"
          value={eventTime}
          onChange={(e) => setEventTime(e.target.value.slice(0, 5))}
          required
        />
      </label>
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
      {error ? <p className="error">{error}</p> : null}
      <div className="row" style={{ marginTop: 16 }}>
        <button className="btn" type="submit" disabled={pending}>
          {pending ? '送出中…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
