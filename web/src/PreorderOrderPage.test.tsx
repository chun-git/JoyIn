import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PREORDER_CANCELLED_WITHOUT_SETTLEMENT,
  PREORDER_REORDER_OPEN_SETTLEMENT_REMINDER,
  PREORDER_SETTLEMENT_NO_PUSH_NOTICE,
  PREORDER_SETTLEMENT_STATUS_DETAIL,
  PREORDER_SETTLEMENT_STATUS_LABEL,
  type PreorderOfferDetail,
  type PreorderOrder,
  type PreorderPaymentSettlement,
  type PreorderPaymentSettlementStatus,
} from '../../shared/types';
import { PreorderOrderPage } from './pages/PreorderOrderPage';
import type { LiffSession } from './liff';

const getPreorder = vi.fn();
const getMyPreorderOrder = vi.fn();
const upsertMyPreorderOrder = vi.fn();

vi.mock('./api', () => ({
  api: {
    getPreorder: (...args: unknown[]) => getPreorder(...args),
    getMyPreorderOrder: (...args: unknown[]) => getMyPreorderOrder(...args),
    upsertMyPreorderOrder: (...args: unknown[]) => upsertMyPreorderOrder(...args),
  },
}));

const session: LiffSession = {
  lineUserId: 'U-cart',
  displayName: '購物車測試',
  contextToken: 'ctx',
  inClient: true,
  getIdToken: () => 'test:U-cart:購物車測試',
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
    canManagePreorder: false,
    preorderRestrictionReason: null,
    orderRestrictionReason: null,
  },
  products: [
    {
      productId: 'product-1',
      offerId: 'offer-1',
      name: '紅茶',
      description: '',
      sourceMenuProductId: null,
      specification: null,
      unitPrice: 40,
      quantityLimit: null,
      orderedQuantity: 0,
      remainingQuantity: null,
      sortOrder: 0,
      isActive: true,
      optionGroups: [],
      createdAt: '2026-09-16T00:00:00.000Z',
      updatedAt: '2026-09-16T00:00:00.000Z',
    },
  ],
};

function settlement(
  status: PreorderPaymentSettlementStatus,
  overrides: Partial<PreorderPaymentSettlement> = {},
): PreorderPaymentSettlement {
  return {
    settlementId: `set-${status}`,
    orderId: `order-${status}`,
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
        historyId: `h-${status}`,
        fromStatus: null,
        toStatus: status,
        actorLineUserId: 'U-provider',
        actorDisplayName: '代訂者小李',
        note: `${status} 備註`,
        createdAt: '2026-09-17T01:00:00.000Z',
      },
    ],
    ...overrides,
  };
}

function cancelledOrder(
  orderId: string,
  paymentSettlement: PreorderOrder['paymentSettlement'],
  reason = '改主意',
): PreorderOrder {
  return {
    orderId,
    offerId: 'offer-1',
    eventId: 'event-1',
    buyerLineUserId: 'U-cart',
    buyerDisplayName: '購物車測試',
    status: 'CANCELLED',
    totalAmount: 40,
    cancellationReason: reason,
    paymentReportedAt: '2026-09-16T01:00:00.000Z',
    paymentConfirmedAt: paymentSettlement?.sourceOrderStatus === 'PAYMENT_CONFIRMED'
      ? '2026-09-16T02:00:00.000Z'
      : null,
    fulfilledAt: null,
    items: [
      {
        orderItemId: `${orderId}-item`,
        productId: 'product-1',
        productNameSnapshot: '紅茶',
        specificationSnapshot: null,
        unitPriceSnapshot: 40,
        optionPriceSnapshot: 0,
        quantity: 1,
        subtotal: 40,
        options: [],
      },
    ],
    paymentSettlement,
    createdAt: '2026-09-16T00:00:00.000Z',
    updatedAt: '2026-09-16T03:00:00.000Z',
  };
}

const activeOrder: PreorderOrder = {
  orderId: 'order-active',
  offerId: 'offer-1',
  eventId: 'event-1',
  buyerLineUserId: 'U-cart',
  buyerDisplayName: '購物車測試',
  status: 'PENDING_PAYMENT',
  totalAmount: 40,
  cancellationReason: null,
  paymentReportedAt: null,
  paymentConfirmedAt: null,
  fulfilledAt: null,
  items: [
    {
      orderItemId: 'item-1',
      productId: 'product-1',
      productNameSnapshot: '紅茶',
      specificationSnapshot: null,
      unitPriceSnapshot: 40,
      optionPriceSnapshot: 0,
      quantity: 1,
      subtotal: 40,
      options: [],
    },
  ],
  paymentSettlement: null,
  createdAt: '2026-09-18T00:00:00.000Z',
  updatedAt: '2026-09-18T00:00:00.000Z',
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/preorders/offer-1']}>
      <Routes>
        <Route path="/preorders/:offerId" element={<PreorderOrderPage session={session} />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('PreorderOrderPage cart removal', () => {
  beforeEach(() => {
    getPreorder.mockResolvedValue({ offer });
    getMyPreorderOrder.mockResolvedValue({ order: null, cancelledOrders: [] });
    upsertMyPreorderOrder.mockResolvedValue({ order: activeOrder });
  });

  it('keeps a quantity-one cart line when removal confirmation is cancelled', async () => {
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: '加入購物車' }));
    const cart = screen.getByRole('heading', { name: '購物車' }).closest('section');
    expect(cart).not.toBeNull();
    const quantityGroup = within(cart!).getByRole('group', { name: '紅茶 購物車數量' });
    expect(within(quantityGroup).getByText('1')).toBeInTheDocument();

    fireEvent.click(within(quantityGroup).getByRole('button', { name: '減少 紅茶' }));
    expect(screen.getByRole('dialog', { name: '移除購物車商品' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: '移除購物車商品' })).not.toBeInTheDocument(),
    );
    expect(within(quantityGroup).getByText('1')).toBeInTheDocument();
    expect(within(cart!).getByText('紅茶')).toBeInTheDocument();
  });
});

describe('PreorderOrderPage cancelled settlement', () => {
  beforeEach(() => {
    getPreorder.mockResolvedValue({ offer });
    upsertMyPreorderOrder.mockResolvedValue({ order: activeOrder });
  });

  it('shows cancelled orders with distinct settlement details and no LINE notify promise', async () => {
    getMyPreorderOrder.mockResolvedValue({
      order: null,
      cancelledOrders: [
        cancelledOrder('order-await', settlement('AWAITING_RECEIPT_CHECK'), '先取消'),
        cancelledOrder('order-refund', settlement('REFUND_PENDING'), '確認後取消'),
      ],
    });
    renderPage();

    const panel = await screen.findByRole('region', { name: '已取消訂單' });
    expect(within(panel).getAllByText('已取消')).toHaveLength(2);
    expect(within(panel).getByText('取消原因：先取消')).toBeInTheDocument();
    expect(within(panel).getByText('取消原因：確認後取消')).toBeInTheDocument();
    expect(within(panel).getAllByText('總金額：$40').length).toBe(2);
    expect(within(panel).getAllByText('紅茶 × 1 = $40').length).toBe(2);
    expect(
      within(panel).getByText(PREORDER_SETTLEMENT_STATUS_LABEL.AWAITING_RECEIPT_CHECK),
    ).toBeInTheDocument();
    expect(
      within(panel).getByText(PREORDER_SETTLEMENT_STATUS_DETAIL.AWAITING_RECEIPT_CHECK),
    ).toBeInTheDocument();
    expect(within(panel).getByText(PREORDER_SETTLEMENT_STATUS_LABEL.REFUND_PENDING)).toBeInTheDocument();
    expect(within(panel).getByText(PREORDER_SETTLEMENT_STATUS_DETAIL.REFUND_PENDING)).toBeInTheDocument();
    expect(within(panel).getAllByText(PREORDER_SETTLEMENT_NO_PUSH_NOTICE).length).toBeGreaterThan(0);
    expect(within(panel).getAllByText('代訂者小李').length).toBeGreaterThan(0);
    expect(within(panel).getByText('AWAITING_RECEIPT_CHECK 備註')).toBeInTheDocument();
    expect(within(panel).getByText('REFUND_PENDING 備註')).toBeInTheDocument();
    expect(within(panel).getAllByText(/2026年9月17日/).length).toBeGreaterThan(0);
    expect(screen.queryByText('已退款')).not.toBeInTheDocument();
    expect(screen.queryByText('JoyIn 將通知對方')).not.toBeInTheDocument();
    expect(screen.queryByText('你會收到通知')).not.toBeInTheDocument();
  });

  it('keeps cancelled settlement panel when a new active order exists', async () => {
    getMyPreorderOrder.mockResolvedValue({
      order: activeOrder,
      cancelledOrders: [cancelledOrder('order-await', settlement('AWAITING_RECEIPT_CHECK'))],
    });
    renderPage();

    expect(await screen.findByRole('heading', { name: '我的訂單' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '已取消訂單' })).toBeInTheDocument();
    expect(
      screen.getByText(PREORDER_SETTLEMENT_STATUS_DETAIL.AWAITING_RECEIPT_CHECK),
    ).toBeInTheDocument();
    expect(screen.getByText(PREORDER_SETTLEMENT_NO_PUSH_NOTICE)).toBeInTheDocument();
  });

  it('shows reorder reminder in confirm modal only when a settlement is still open', async () => {
    getMyPreorderOrder.mockResolvedValue({
      order: null,
      cancelledOrders: [cancelledOrder('order-await', settlement('AWAITING_RECEIPT_CHECK'))],
    });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: '加入購物車' }));
    fireEvent.click(screen.getByRole('button', { name: '送出訂單' }));

    const dialog = await screen.findByRole('dialog', { name: '確認訂單' });
    expect(within(dialog).getByText(PREORDER_REORDER_OPEN_SETTLEMENT_REMINDER)).toBeInTheDocument();
    expect(within(dialog).queryByText(/你會收到通知/)).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '確認送出' })).toBeEnabled();

    fireEvent.click(within(dialog).getByRole('button', { name: '確認送出' }));
    await waitFor(() => expect(upsertMyPreorderOrder).toHaveBeenCalled());
    const submitKey = upsertMyPreorderOrder.mock.calls[0][3] as string;
    expect(submitKey).not.toBe('order-offer-1-U-cart');
    expect(submitKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$|^order-offer-1-U-cart-\d+$/i,
    );
  });

  it('does not show reorder reminder after provider reported settled', async () => {
    getMyPreorderOrder.mockResolvedValue({
      order: null,
      cancelledOrders: [cancelledOrder('order-settled', settlement('PROVIDER_REPORTED_SETTLED'))],
    });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: '加入購物車' }));
    fireEvent.click(screen.getByRole('button', { name: '送出訂單' }));

    const dialog = await screen.findByRole('dialog', { name: '確認訂單' });
    expect(within(dialog).queryByText(PREORDER_REORDER_OPEN_SETTLEMENT_REMINDER)).not.toBeInTheDocument();
    expect(
      screen.getByText(PREORDER_SETTLEMENT_STATUS_DETAIL.PROVIDER_REPORTED_SETTLED),
    ).toBeInTheDocument();
  });

  it('labels unpaid cancelled orders as not needing settlement', async () => {
    getMyPreorderOrder.mockResolvedValue({
      order: null,
      cancelledOrders: [cancelledOrder('order-unpaid', null, '還沒付款')],
    });
    renderPage();

    const panel = await screen.findByRole('region', { name: '已取消訂單' });
    expect(within(panel).getByText(PREORDER_CANCELLED_WITHOUT_SETTLEMENT)).toBeInTheDocument();
    expect(within(panel).queryByText(PREORDER_SETTLEMENT_NO_PUSH_NOTICE)).not.toBeInTheDocument();
  });
});
