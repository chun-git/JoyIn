import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EventForm } from './components/EventForm';

describe('EventForm', () => {
  it('requires end time to be later than start time', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<EventForm submitLabel="建立活動" onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText('活動名稱'), '桌遊夜');
    await user.type(screen.getByLabelText('活動地址'), '台北');
    await user.type(screen.getByLabelText('開始日期'), '2026-12-01');
    await user.type(screen.getByLabelText('結束日期'), '2026-12-01');
    await user.clear(screen.getByLabelText('開始時間'));
    await user.type(screen.getByLabelText('開始時間'), '21:00');
    await user.clear(screen.getByLabelText('結束時間'));
    await user.type(screen.getByLabelText('結束時間'), '19:00');
    await user.click(screen.getByRole('button', { name: '建立活動' }));

    expect(await screen.findByText('結束時間必須晚於開始時間')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('prefills copy fields except the time range', async () => {
    const user = userEvent.setup();
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

    await user.type(view.getByLabelText('開始日期'), '2026-12-20');
    await user.type(view.getByLabelText('結束日期'), '2026-12-20');
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
