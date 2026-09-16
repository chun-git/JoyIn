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
const orderPageSource = readFileSync(
  path.join(__dirname, 'pages', 'PreorderOrderPage.tsx'),
  'utf8',
);

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
      canCreatePreorder: true,
      preorderRestrictionReason: null,
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
    expect(css).toMatch(/\.shared-menu-grid[\s\S]*minmax\(0,\s*1fr\)/);
  });

  it('uses native 44px touch quantity buttons without mouse-only handlers', () => {
    expect(orderPageSource).toMatch(/className="btn secondary btn-compact preorder-qty-btn"/);
    expect(orderPageSource).toMatch(/type="button"/);
    expect(orderPageSource).not.toMatch(/onPointerDown|onMouseDown/);
    expect(css).toMatch(/\.preorder-qty-btn[\s\S]*min-width:\s*44px/);
    expect(css).toMatch(/\.preorder-qty-btn[\s\S]*min-height:\s*44px/);
  });
});
