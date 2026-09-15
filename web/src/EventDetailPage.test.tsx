import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { EventDetail, RegistrationRecord } from '../../shared/types';
import { EventDetailPage } from './pages/EventDetailPage';
import { sampleEvent } from './test/fixtures';
import type { LiffSession } from './liff';

const getEvent = vi.fn();
const cancel = vi.fn();
const join = vi.fn();
const proxyJoin = vi.fn();

vi.mock('./api', () => ({
  api: {
    getEvent: (...args: unknown[]) => getEvent(...args),
    cancel: (...args: unknown[]) => cancel(...args),
    join: (...args: unknown[]) => join(...args),
    proxyJoin: (...args: unknown[]) => proxyJoin(...args),
    closeEvent: vi.fn(),
    deleteEvent: vi.fn(),
    createTransferInvite: vi.fn(),
    cancelTransferInvites: vi.fn(),
    listEventPreorders: vi.fn().mockResolvedValue({ offers: [], canCreateOffer: false }),
    preorderCancelCheck: vi.fn().mockResolvedValue({
      blocked: false,
      kind: null,
      message: null,
      pendingCancelCount: 0,
    }),
  },
}));

const session: LiffSession = {
  lineUserId: 'U-lee',
  displayName: 'Lee',
  contextToken: 'test-context-token',
  inClient: false,
  getIdToken: () => 'test:U-lee:Lee',
};

function reg(overrides: Partial<RegistrationRecord>): RegistrationRecord {
  return {
    registrationId: 'r-self',
    eventId: 'e1',
    type: 'SELF',
    status: 'CONFIRMED',
    registrationSource: 'SELF_JOIN',
    waitlistPosition: null,
    participantName: 'Lee',
    displayLabel: 'Lee',
    lineUserId: 'U-lee',
    participantLineUserId: 'U-lee',
    createdByLineUserId: 'U-lee',
    createdByDisplayName: 'Lee',
    createdAt: '2026-09-10T00:00:00.000Z',
    canCancel: true,
    ...overrides,
  };
}

function detail(overrides: Partial<EventDetail> = {}): EventDetail {
  return {
    ...sampleEvent,
    eventId: 'e1',
    confirmedCount: 1,
    waitlistCount: 1,
    waitlistEnabled: true,
    registrations: {
      confirmed: [reg({})],
      waitlist: [
        reg({
          registrationId: 'r-wait',
          status: 'WAITLIST',
          waitlistPosition: 1,
          participantName: 'Bob',
          displayLabel: 'Bob',
          lineUserId: 'U-bob',
          createdByLineUserId: 'U-bob',
          createdByDisplayName: 'Bob',
          canCancel: false,
        }),
      ],
    },
    viewer: {
      isOrganizer: false,
      selfRegistration: reg({}),
      proxyRegistrations: [],
    },
    ...overrides,
  };
}

function renderDetail() {
  return render(
    <MemoryRouter initialEntries={['/events/e1']}>
      <Routes>
        <Route path="/events/:eventId" element={<EventDetailPage session={session} />} />
        <Route path="/events" element={<div>活動列表頁</div>} />
        <Route path="/events/new" element={<div>新增活動頁</div>} />
        <Route path="/help/join" element={<div>報名手冊</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('EventDetailPage layout and cancel flow', () => {
  beforeEach(() => {
    getEvent.mockReset();
    cancel.mockReset();
    join.mockReset();
    proxyJoin.mockReset();
    getEvent.mockResolvedValue({ event: detail() });
    cancel.mockResolvedValue({});
  });

  it('places confirmed and waitlist lists immediately after the event card', async () => {
    const { container } = renderDetail();
    await screen.findByRole('heading', { name: /正式報名名單/ });

    const page = container.querySelector('.event-detail-page');
    expect(page).toBeTruthy();
    const text = page!.textContent || '';
    const cardIdx = text.indexOf('週五桌遊夜');
    const confirmedIdx = text.indexOf('正式報名名單');
    const waitlistIdx = text.indexOf('候補名單');
    const joinIdx = text.indexOf('本人報名');
    const copyIdx = text.lastIndexOf('複製活動');
    expect(cardIdx).toBeGreaterThan(-1);
    expect(confirmedIdx).toBeGreaterThan(cardIdx);
    expect(waitlistIdx).toBeGreaterThan(confirmedIdx);
    expect(joinIdx).toBeGreaterThan(waitlistIdx);
    expect(copyIdx).toBeGreaterThan(joinIdx);
  });

  it('does not call cancel API until 確認取消 is pressed', async () => {
    const user = userEvent.setup();
    renderDetail();
    await screen.findByText('Lee');
    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(cancel).not.toHaveBeenCalled();
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('確認取消報名？')).toBeInTheDocument();
    expect(screen.getByText('確定要取消自己的報名嗎？')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '返回' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(cancel).not.toHaveBeenCalled();
  });

  it('closes confirm dialog on Escape without cancelling', async () => {
    const user = userEvent.setup();
    renderDetail();
    await screen.findByRole('button', { name: '取消' });
    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(cancel).not.toHaveBeenCalled();
  });

  it('closes confirm dialog on backdrop click without cancelling', async () => {
    const user = userEvent.setup();
    renderDetail();
    await screen.findByRole('button', { name: '取消' });
    await user.click(screen.getByRole('button', { name: '取消' }));
    const dialog = await screen.findByRole('dialog');
    const backdrop = dialog.parentElement!;
    fireEvent.mouseDown(backdrop);
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(cancel).not.toHaveBeenCalled();
  });

  it('calls cancel API once on 確認取消 and reloads list', async () => {
    const user = userEvent.setup();
    const after = detail({
      confirmedCount: 0,
      waitlistCount: 0,
      registrations: { confirmed: [], waitlist: [] },
      viewer: { isOrganizer: false, selfRegistration: null, proxyRegistrations: [] },
    });
    getEvent
      .mockResolvedValueOnce({ event: detail() })
      .mockResolvedValueOnce({ event: after });

    renderDetail();
    await screen.findByRole('button', { name: '取消' });
    await user.click(screen.getByRole('button', { name: '取消' }));
    await user.click(await screen.findByRole('button', { name: '確認取消' }));

    await waitFor(() => {
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(cancel).toHaveBeenCalledWith(session, 'r-self');
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(getEvent).toHaveBeenCalledTimes(2);
    expect(await screen.findByText('目前尚無正式報名')).toBeInTheDocument();
  });

  it('keeps dialog open and shows error when cancel API fails', async () => {
    const user = userEvent.setup();
    cancel.mockRejectedValueOnce(new Error('伺服器忙碌'));
    renderDetail();
    await screen.findByRole('button', { name: '取消' });
    await user.click(screen.getByRole('button', { name: '取消' }));
    await user.click(await screen.findByRole('button', { name: '確認取消' }));
    expect(await screen.findByText('伺服器忙碌')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('shows proxy participant name in confirm copy', async () => {
    const user = userEvent.setup();
    getEvent.mockResolvedValue({
      event: detail({
        registrations: {
          confirmed: [
            reg({
              registrationId: 'r-proxy',
              type: 'PROXY',
              participantName: 'Amy',
              displayLabel: 'Amy（Lee 代報）',
              lineUserId: null,
            }),
          ],
          waitlist: [],
        },
        waitlistCount: 0,
        viewer: {
          isOrganizer: false,
          selfRegistration: null,
          proxyRegistrations: [
            reg({
              registrationId: 'r-proxy',
              type: 'PROXY',
              participantName: 'Amy',
              displayLabel: 'Amy（Lee 代報）',
            }),
          ],
        },
      }),
    });
    renderDetail();
    expect(await screen.findByText('Amy（Lee 代報）')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(await screen.findByText('確認取消代報？')).toBeInTheDocument();
    expect(screen.getByText('確定要取消「Amy」的報名嗎？')).toBeInTheDocument();
  });

  it('promotes waitlist into confirmed list after successful cancel reload', async () => {
    const user = userEvent.setup();
    const promoted = detail({
      confirmedCount: 1,
      waitlistCount: 0,
      registrations: {
        confirmed: [
          reg({
            registrationId: 'r-wait',
            participantName: 'Bob',
            displayLabel: 'Bob',
            lineUserId: 'U-bob',
            createdByLineUserId: 'U-bob',
            createdByDisplayName: 'Bob',
            canCancel: false,
          }),
        ],
        waitlist: [],
      },
      viewer: { isOrganizer: false, selfRegistration: null, proxyRegistrations: [] },
    });
    getEvent.mockResolvedValueOnce({ event: detail() }).mockResolvedValueOnce({ event: promoted });

    renderDetail();
    await user.click(await screen.findByRole('button', { name: '取消' }));
    await user.click(await screen.findByRole('button', { name: '確認取消' }));
    await waitFor(() => expect(cancel).toHaveBeenCalledTimes(1));
    const confirmedHeading = await screen.findByRole('heading', { name: /正式報名名單（1／10）/ });
    const confirmedSection = confirmedHeading.closest('section')!;
    expect(within(confirmedSection).getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('目前尚無候補')).toBeInTheDocument();
  });

  it('opens and closes join help from question icon with aria-label', async () => {
    const user = userEvent.setup();
    renderDetail();
    const help = await screen.findByRole('button', { name: '查看報名與代報說明' });
    await user.click(help);
    expect(await screen.findByRole('dialog', { name: '報名與代報說明' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '關閉' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '報名與代報說明' })).not.toBeInTheDocument();
    });
    expect(screen.getByText('週五桌遊夜')).toBeInTheDocument();
  });

  it('navigates back to list via 返回活動列表', async () => {
    const user = userEvent.setup();
    renderDetail();
    await user.click(await screen.findByRole('button', { name: '返回活動列表' }));
    expect(await screen.findByText('活動列表頁')).toBeInTheDocument();
  });

  it('keeps 複製活動 at the bottom and navigates to copy flow', async () => {
    const user = userEvent.setup();
    renderDetail();
    const copyButtons = await screen.findAllByRole('button', { name: '複製活動' });
    expect(copyButtons).toHaveLength(1);
    await user.click(copyButtons[0]);
    expect(await screen.findByText('新增活動頁')).toBeInTheDocument();
  });

  it('does not show cancel for registrations the viewer cannot cancel', async () => {
    renderDetail();
    await screen.findByText('Bob');
    const waitlistHeading = screen.getByRole('heading', { name: /候補名單/ });
    const waitlistSection = waitlistHeading.closest('section')!;
    expect(within(waitlistSection).queryByRole('button', { name: /取消/ })).not.toBeInTheDocument();
  });

  it('CSS includes overflow and flexible layout guards for narrow viewports', () => {
    const css = readFileSync(path.resolve(__dirname, 'index.css'), 'utf8');
    expect(css).toMatch(/overflow-x:\s*hidden/);
    expect(css).toMatch(/\.btn-back[\s\S]*?max-width:\s*100%/);
    expect(css).toMatch(/\.list-item[\s\S]*?flex-wrap:\s*wrap/);
    expect(css).toMatch(/minmax\(0,\s*1fr\)/);
  });
});
