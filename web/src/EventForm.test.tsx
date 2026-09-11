import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventForm } from './components/EventForm';

function setField(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe('EventForm', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-11T07:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('requires end time to be later than start time', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onSubmit = vi.fn();
    render(<EventForm submitLabel="建立活動" onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText('活動名稱'), '桌遊夜');
    await user.type(screen.getByLabelText('活動地址'), '台北');
    setField('開始日期', '2026-12-01');
    setField('結束日期', '2026-12-02');
    setField('開始時間', '21:00');
    setField('結束時間', '19:00');
    setField('結束日期', '2026-12-01');
    await user.click(screen.getByRole('button', { name: '建立活動' }));

    expect(await screen.findByText('結束時間必須晚於開始時間')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('accepts tonight 19:00-21:00 in Asia/Taipei', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<EventForm submitLabel="建立活動" onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText('活動名稱'), '今晚桌遊');
    await user.type(screen.getByLabelText('活動地址'), '台北');
    setField('開始日期', '2026-09-11');
    setField('開始時間', '19:00');
    setField('結束時間', '21:00');
    await user.click(screen.getByRole('button', { name: '建立活動' }));

    expect(screen.queryByText('結束時間不可早於現在')).not.toBeInTheDocument();
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        startDate: '2026-09-11',
        startTime: '19:00',
        endDate: '2026-09-11',
        endTime: '21:00',
      }),
      false,
    );
  });

  it('accepts an overnight event from 23:00 to 01:00', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<EventForm submitLabel="建立活動" onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText('活動名稱'), '跨日活動');
    await user.type(screen.getByLabelText('活動地址'), '台北');
    setField('開始日期', '2026-09-11');
    setField('開始時間', '23:00');
    setField('結束日期', '2026-09-12');
    setField('結束時間', '01:00');
    await user.click(screen.getByRole('button', { name: '建立活動' }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        startDate: '2026-09-11',
        startTime: '23:00',
        endDate: '2026-09-12',
        endTime: '01:00',
      }),
      false,
    );
  });

  it('rejects a start time that is not after now', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onSubmit = vi.fn();
    render(<EventForm submitLabel="建立活動" onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText('活動名稱'), '過去活動');
    await user.type(screen.getByLabelText('活動地址'), '台北');
    setField('開始時間', '15:00');
    setField('結束時間', '21:00');
    setField('開始日期', '2026-09-11');
    await user.click(screen.getByRole('button', { name: '建立活動' }));

    expect(await screen.findByText('開始時間必須晚於現在')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('syncs end date with the first start date, then only when it would be earlier', () => {
    render(<EventForm submitLabel="建立活動" onSubmit={vi.fn()} />);

    setField('開始日期', '2026-09-20');
    expect(screen.getByLabelText('結束日期')).toHaveValue('2026-09-20');

    setField('結束日期', '2026-09-21');
    setField('開始日期', '2026-09-20');
    expect(screen.getByLabelText('結束日期')).toHaveValue('2026-09-21');

    setField('開始日期', '2026-09-22');
    expect(screen.getByLabelText('結束日期')).toHaveValue('2026-09-22');
  });

  it('does not apply today time limits when the end date is later than start date', () => {
    render(<EventForm submitLabel="建立活動" onSubmit={vi.fn()} />);

    setField('開始日期', '2026-09-11');
    expect(screen.getByLabelText('開始時間')).toHaveAttribute('min', '15:01');
    expect(screen.getByLabelText('結束日期')).toHaveAttribute('min', '2026-09-11');
    expect(screen.getByLabelText('結束時間')).toHaveAttribute('min', '19:01');

    setField('結束日期', '2026-09-12');
    expect(screen.getByLabelText('結束時間')).not.toHaveAttribute('min');

    setField('開始日期', '2026-09-12');
    expect(screen.getByLabelText('開始時間')).not.toHaveAttribute('min');
  });

  it('prefills copy fields except the time range', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      <EventForm
        submitLabel="建立複製活動"
        timeHint="請重新設定開始時間與結束時間"
        initial={{
          name: '週五桌遊夜',
          address: '台北車站',
          capacity: 8,
          waitlistEnabled: false,
        }}
        onSubmit={onSubmit}
      />,
    );
    const view = within(container);

    expect(view.getByDisplayValue('週五桌遊夜')).toBeInTheDocument();
    expect(view.getByDisplayValue('台北車站')).toBeInTheDocument();
    expect(view.getByDisplayValue('8')).toBeInTheDocument();
    expect(view.getByLabelText('開始日期')).toHaveValue('');
    expect(view.getByLabelText('結束日期')).toHaveValue('');
    expect(view.getByText('請重新設定開始時間與結束時間')).toBeInTheDocument();

    fireEvent.change(view.getByLabelText('開始日期'), { target: { value: '2026-12-20' } });
    expect(view.getByLabelText('結束日期')).toHaveValue('2026-12-20');
    await user.click(view.getByRole('button', { name: '建立複製活動' }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: '週五桌遊夜',
        address: '台北車站',
        capacity: 8,
        waitlistEnabled: false,
        startDate: '2026-12-20',
        endDate: '2026-12-20',
      }),
      false,
    );
  });
});
