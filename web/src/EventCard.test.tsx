import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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
    expect(screen.getByText('尚有名額')).toBeInTheDocument();
    expect(screen.getByText('報名中')).toBeInTheDocument();
  });
});
