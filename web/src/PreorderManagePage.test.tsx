import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PREORDER_PROVIDER_CANCEL_CONFIRMED_HINT,
  PREORDER_PROVIDER_CANCEL_REPORTED_HINT,
  PREORDER_PROVIDER_REPORT_SETTLED_HINT,
  PREORDER_SETTLEMENT_NO_PUSH_NOTICE,
  PREORDER_SETTLEMENT_STATUS_DETAIL,
  type PreorderOfferDetail,
  type PreorderOfferOrderSummary,
  type PreorderOrder,
  type PreorderPaymentSettlement,
  type PreorderPaymentSettlementStatus,
} from '../../shared/types';
import { PreorderManagePage } from './pages/PreorderManagePage';
import type { LiffSession } from './liff';

const getPreorder = vi.fn();
const getPreorderSummary = vi.fn();
const cancelPreorderOrder = vi.fn();
const reportPreorderSettlementHandled = vi.fn();
const confirmPreorderPayment = vi.fn();
const fulfillPreorderOrder = vi.fn();

vi.mock('./api', () => ({
  api: {
    getPreorder: (...args: unknown[]) => getPreorder(...args),
    getPreorderSummary: (...args: unknown[]) => getPreorderSummary(...args),
    cancelPreorderOrder: (...args: unknown[]) => cancelPreorderOrder(...args),
    reportPreorderSettlementHandled: (...args: unknown[]) =>
      reportPreorderSettlementHandled(...args),
    confirmPreorderPayment: (...args: unknown[]) => confirmPreorderPayment(...args),
    fulfillPreorderOrder: (...args: unknown[]) => fulfillPreorderOrder(...args),
  },
}));

const session: LiffSession = {
  lineUserId: 'U-provider',
  displayName: '代訂者',
  contextToken: 'ctx',
  inClient: true,
  getIdToken: () => 'test:U-provider:代訂者',
};

const offer: PreorderOfferDetail = {
  offerId: 'offer-1',
  eventId: 'event-1',
  providerLineUserId: 'U-provider',
  providerDisplayName: '代訂者',
  title: '飲料代訂',
  merchantName: '茶店',
  description: '',
  orderDeadline: '2099-01-01T00:00:00.000Z',
  paymentInstructions: '',
  paymentUrl: null,
  status: 'OPEN',
  productCount: 1,
  myOrderStatus: null,
  createdAt: '2026-09-16T00:00:00.000Z',
  updatedAt: '2026-09-16T00:00:00.000Z',
  viewer: {
    canCreatePreorder: true,
    canOrder: true,
    canManagePreorder: true,
    preorderRestrictionReason: null,
    orderRestrictionReason: null,
  },
  products: [],
};

function settlement(
  status: PreorderPaymentSettlementStatus,
  orderId: string,
): PreorderPaymentSettlement {
  return {
    settlementId: `set-${orderId}`,
    orderId,
    offerId: 'offer-1',
    status,
    sourceOrderStatus: status === 'REFUND_PENDING' ? 'PAYMENT_CONFIRMED' : 'PAYMENT_REPORTED',
    latestNote: '處理備註',
    settledReportedAt: status === 'PROVIDER_REPORTED_SETTLED' ? '2026-09-18T00:00:00.000Z' : null,
    settledReportedByLineUserId: status === 'PROVIDER_REPORTED_SETTLED' ? 'U-provider' : null,
    settledReportedByDisplayName: status === 'PROVIDER_REPORTED_SETTLED' ? '代訂者' : null,
    createdByLineUserId: 'U-provider',
    createdByDisplayName: '代訂者',
    createdAt: '2026-09-17T00:00:00.000Z',
    updatedAt: '2026-09-17T01:00:00.000Z',
    history: [
      {
        historyId: `h-${orderId}`,
        fromStatus: null,
        toStatus: status,
        actorLineUserId: 'U-provider',
        actorDisplayName: '代訂者小李',
        note: '已與買家確認',
        createdAt: '2026-09-17T01:00:00.000Z',
      },
    ],
  };
}

function order(partial: Partial<PreorderOrder> & Pick<PreorderOrder, 'orderId' | 'status'>): PreorderOrder {
  return {
    offerId: 'offer-1',
    eventId: 'event-1',
    buyerLineUserId: `U-${partial.orderId}`,
    buyerDisplayName: partial.buyerDisplayName ?? partial.orderId,
    totalAmount: 80,
    cancellationReason: partial.status === 'CANCELLED' ? '代訂者取消' : null,
    paymentReportedAt: null,
    paymentConfirmedAt: null,
    fulfilledAt: partial.status === 'FULFILLED' ? '2026-09-18T00:00:00.000Z' : null,
    items: [],
    paymentSettlement: null,
    createdAt: '2026-09-16T00:00:00.000Z',
    updatedAt: '2026-09-16T00:00:00.000Z',
    ...partial,
  };
}

const reported = order({
  orderId: 'order-reported',
  status: 'PAYMENT_REPORTED',
  buyerDisplayName: '回報買家',
});
const confirmed = order({
  orderId: 'order-confirmed',
  status: 'PAYMENT_CONFIRMED',
  buyerDisplayName: '確認買家',
});
const fulfilled = order({
  orderId: 'order-fulfilled',
  status: 'FULFILLED',
  buyerDisplayName: '完成買家',
});
const cancelledOpen = order({
  orderId: 'order-open-settle',
  status: 'CANCELLED',
  buyerDisplayName: '待處理買家',
  paymentSettlement: settlement('AWAITING_RECEIPT_CHECK', 'order-open-settle'),
});
const cancelledSettled = order({
  orderId: 'order-settled',
  status: 'CANCELLED',
  buyerDisplayName: '已回報買家',
  paymentSettlement: settlement('PROVIDER_REPORTED_SETTLED', 'order-settled'),
});

function summaryWith(orders: PreorderOrder[]): PreorderOfferOrderSummary {
  return {
    offerId: 'offer-1',
    orderCount: orders.length,
    totalReceivable: 80,
    countsByStatus: {
      PENDING_PAYMENT: 0,
      PAYMENT_REPORTED: orders.filter((item) => item.status === 'PAYMENT_REPORTED').length,
      PAYMENT_CONFIRMED: orders.filter((item) => item.status === 'PAYMENT_CONFIRMED').length,
      FULFILLED: orders.filter((item) => item.status === 'FULFILLED').length,
      CANCELLED: orders.filter((item) => item.status === 'CANCELLED').length,
    },
    productAggregates: [],
    orders,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/preorders/offer-1/manage']}>
      <Routes>
        <Route
          path="/preorders/:offerId/manage"
          element={<PreorderManagePage session={session} />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

function cardFor(buyerName: string) {
  const heading = screen.getByText(buyerName);
  const card = heading.closest('article');
  expect(card).not.toBeNull();
  return card as HTMLElement;
}

describe('PreorderManagePage settlement actions', () => {
  beforeEach(() => {
    getPreorder.mockResolvedValue({ offer });
    getPreorderSummary.mockResolvedValue({
      summary: summaryWith([reported, confirmed, fulfilled, cancelledOpen, cancelledSettled]),
    });
    cancelPreorderOrder.mockResolvedValue({ order: reported });
    reportPreorderSettlementHandled.mockResolvedValue({ order: cancelledOpen });
  });

  it('shows settlement progress, history, and no LINE notify promise', async () => {
    renderPage();

    expect(await screen.findByText('待處理買家')).toBeInTheDocument();
    expect(screen.getByText(PREORDER_SETTLEMENT_STATUS_DETAIL.AWAITING_RECEIPT_CHECK)).toBeInTheDocument();
    expect(
      screen.getByText(PREORDER_SETTLEMENT_STATUS_DETAIL.PROVIDER_REPORTED_SETTLED),
    ).toBeInTheDocument();
    expect(screen.getAllByText(PREORDER_SETTLEMENT_NO_PUSH_NOTICE).length).toBeGreaterThan(0);
    expect(screen.getAllByText('代訂者小李').length).toBeGreaterThan(0);
    expect(screen.getAllByText('已與買家確認').length).toBeGreaterThan(0);
    expect(screen.queryByText('JoyIn 將通知對方')).not.toBeInTheDocument();
    expect(screen.queryByText('你會收到通知')).not.toBeInTheDocument();
  });

  it('uses a cancel modal with reported vs confirmed hints and does not use window.prompt', async () => {
    const promptSpy = vi.spyOn(window, 'prompt');
    renderPage();
    await screen.findByText('回報買家');

    fireEvent.click(within(cardFor('回報買家')).getByRole('button', { name: '取消訂單' }));
    const reportedDialog = await screen.findByRole('dialog', { name: '取消訂單' });
    expect(within(reportedDialog).getByText(PREORDER_PROVIDER_CANCEL_REPORTED_HINT)).toBeInTheDocument();
    fireEvent.click(within(reportedDialog).getByRole('button', { name: '返回' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '取消訂單' })).not.toBeInTheDocument());

    fireEvent.click(within(cardFor('確認買家')).getByRole('button', { name: '取消訂單' }));
    const confirmedDialog = await screen.findByRole('dialog', { name: '取消訂單' });
    expect(within(confirmedDialog).getByText(PREORDER_PROVIDER_CANCEL_CONFIRMED_HINT)).toBeInTheDocument();
    fireEvent.change(within(confirmedDialog).getByRole('textbox'), {
      target: { value: '貨源不足' },
    });
    fireEvent.click(within(confirmedDialog).getByRole('button', { name: '確認取消' }));
    await waitFor(() =>
      expect(cancelPreorderOrder).toHaveBeenCalledWith(session, 'offer-1', 'order-confirmed', '貨源不足'),
    );
    expect(promptSpy).not.toHaveBeenCalled();
    promptSpy.mockRestore();
  });

  it('lets the provider report handled only while settlement is open', async () => {
    renderPage();
    await screen.findByText('待處理買家');

    expect(within(cardFor('已回報買家')).queryByRole('button', { name: '回報已處理' })).not.toBeInTheDocument();
    expect(within(cardFor('完成買家')).queryByRole('button', { name: '取消訂單' })).not.toBeInTheDocument();

    fireEvent.click(within(cardFor('待處理買家')).getByRole('button', { name: '回報已處理' }));
    const dialog = await screen.findByRole('dialog', { name: '回報已處理' });
    expect(within(dialog).getByText(PREORDER_PROVIDER_REPORT_SETTLED_HINT)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: '已私下處理' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '確認回報' }));
    await waitFor(() =>
      expect(reportPreorderSettlementHandled).toHaveBeenCalledWith(
        session,
        'offer-1',
        'order-open-settle',
        '已私下處理',
      ),
    );
  });
});
