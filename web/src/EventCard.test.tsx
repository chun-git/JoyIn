import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EventCard } from './components/EventCard';
import { sampleEvent } from './test/fixtures';

describe('EventCard', () => {
  it('renders event summary fields including the time range', () => {
    render(<EventCard event={sampleEvent} />);
    expect(screen.getByText('週五桌遊夜')).toBeInTheDocument();
    expect(screen.getByText(/台北市中山區/)).toBeInTheDocument();
    expect(screen.getByText(/4／10/)).toBeInTheDocument();
    expect(screen.getByText(/19:00/)).toBeInTheDocument();
    expect(screen.getByText(/21:00/)).toBeInTheDocument();
    expect(screen.getByText(/免費/)).toBeInTheDocument();
    expect(screen.getByText('尚有名額')).toBeInTheDocument();
    expect(screen.getByText('報名中')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '導航' })).not.toBeInTheDocument();
  });

  it('shows paid fee and external 導航 link without replacing card click', () => {
    const onClick = vi.fn();
    render(
      <EventCard
        event={{
          ...sampleEvent,
          feeAmount: 150,
          googleMapsUrl: 'https://maps.app.goo.gl/navDemo',
          address: '超長地址測試用台北市中山區南京東路二段一號旁巷弄咖啡廳地下室活動空間',
        }}
        onClick={onClick}
      />,
    );
    expect(screen.getByText(/150 元／人/)).toBeInTheDocument();
    const nav = screen.getByRole('link', { name: '導航' });
    expect(nav).toHaveAttribute('href', 'https://maps.app.goo.gl/navDemo');
    expect(nav).toHaveAttribute('target', '_blank');
    expect(nav).toHaveAttribute('rel', 'noopener noreferrer');

    fireEvent.click(nav);
    expect(onClick).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /週五桌遊夜/ }));
    expect(onClick).toHaveBeenCalledTimes(1);

    const card = document.querySelector('.event-card');
    expect(card).toBeTruthy();
    expect(getComputedStyle(card!).maxWidth).not.toBe('none');
  });
});
