import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PreorderSection } from './components/PreorderSection';
import type { LiffSession } from './liff';

const listEventPreorders = vi.fn();

vi.mock('./api', () => ({
  api: {
    listEventPreorders: (...args: unknown[]) => listEventPreorders(...args),
  },
}));

const css = readFileSync(path.join(__dirname, 'index.css'), 'utf8');

const session: LiffSession = {
  lineUserId: 'U-test',
  displayName: '測試',
  contextToken: 'ctx',
  inClient: true,
  getIdToken: () => 'test:U-test:測試',
};

describe('preorder UI', () => {
  it('shows empty state and create button when eligible', async () => {
    listEventPreorders.mockResolvedValue({
      offers: [],
      canCreateOffer: true,
    });
    render(
      <MemoryRouter>
        <div style={{ width: 320 }}>
          <PreorderSection session={session} eventId="evt-1" />
        </div>
      </MemoryRouter>,
    );
    expect(await screen.findByText('目前沒有代訂服務')).toBeInTheDocument();
    expect(screen.getByText('我要提供代訂')).toBeInTheDocument();
  });

  it('CSS guards preorder layout against horizontal overflow', () => {
    expect(css).toMatch(/\.preorder-offer-grid/);
    expect(css).toMatch(/minmax\(0,\s*1fr\)/);
    expect(css).toMatch(/overflow-wrap:\s*anywhere/);
    expect(css).toMatch(/\.preorder-status\.tone-pending/);
  });
});
