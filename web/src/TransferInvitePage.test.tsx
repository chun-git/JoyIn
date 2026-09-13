import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './api';
import { TransferInvitePage } from './pages/TransferInvitePage';
import type { LiffSession } from './liff';

const previewTransferInvite = vi.fn();
const acceptTransferInvite = vi.fn();
const getEvent = vi.fn();

vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof import('./api')>('./api');
  return {
    ...actual,
    api: {
      previewTransferInvite: (...args: unknown[]) => previewTransferInvite(...args),
      acceptTransferInvite: (...args: unknown[]) => acceptTransferInvite(...args),
      getEvent: (...args: unknown[]) => getEvent(...args),
    },
  };
});

const session: LiffSession = {
  lineUserId: 'U-amy',
  displayName: 'Amy',
  contextToken: 'a.b',
  inClient: true,
  getIdToken: () => 'token',
};

function renderPage(token = `${'a'.repeat(64)}`) {
  return render(
    <MemoryRouter initialEntries={[`/transfer/${token}`]}>
      <Routes>
        <Route path="/transfer/:token" element={<TransferInvitePage session={session} />} />
        <Route path="/events" element={<div>活動列表頁</div>} />
        <Route path="/events/:eventId" element={<div>活動詳情頁</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('TransferInvitePage', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows confirm only for pending invites', async () => {
    previewTransferInvite.mockResolvedValue({
      invite: {
        eventId: 'e1',
        eventName: '夜衝',
        organizerDisplayName: 'Lee',
        status: 'PENDING',
        expiresAt: '2099-01-01T00:00:00.000Z',
        isOrganizer: false,
      },
    });
    renderPage();
    expect(await screen.findByRole('button', { name: '確認轉移主揪' })).toBeInTheDocument();
  });

  it('shows used message without confirm and can go to list immediately', async () => {
    previewTransferInvite.mockRejectedValue(
      new ApiError(410, 'transfer_invite_used', '此主揪轉移連結已使用'),
    );
    renderPage();
    expect(await screen.findByText('此主揪轉移連結已使用')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '確認轉移主揪' })).not.toBeInTheDocument();
    screen.getByRole('button', { name: '立即前往活動列表' }).click();
    expect(await screen.findByText('活動列表頁')).toBeInTheDocument();
  });

  it('shows expired and invalid messages', async () => {
    previewTransferInvite.mockRejectedValue(
      new ApiError(410, 'transfer_invite_expired', '此主揪轉移連結已過期'),
    );
    const { unmount } = renderPage();
    expect(await screen.findByText('此主揪轉移連結已過期')).toBeInTheDocument();
    unmount();

    previewTransferInvite.mockRejectedValue(
      new ApiError(410, 'transfer_invite_cancelled', '此主揪轉移連結已失效'),
    );
    renderPage(`${'b'.repeat(64)}`);
    expect(await screen.findByText('此主揪轉移連結已失效')).toBeInTheDocument();
  });
});
