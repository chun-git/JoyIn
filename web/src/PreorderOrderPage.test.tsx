import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { PreorderOfferDetail } from '../../shared/types';
import { PreorderOrderPage } from './pages/PreorderOrderPage';
import type { LiffSession } from './liff';

const getPreorder = vi.fn();
const getMyPreorderOrder = vi.fn();

vi.mock('./api', () => ({
  api: {
    getPreorder: (...args: unknown[]) => getPreorder(...args),
    getMyPreorderOrder: (...args: unknown[]) => getMyPreorderOrder(...args),
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

describe('PreorderOrderPage cart removal', () => {
  it('keeps a quantity-one cart line when removal confirmation is cancelled', async () => {
    getPreorder.mockResolvedValue({ offer });
    getMyPreorderOrder.mockResolvedValue({ order: null });
    render(
      <MemoryRouter initialEntries={['/preorders/offer-1']}>
        <Routes>
          <Route path="/preorders/:offerId" element={<PreorderOrderPage session={session} />} />
        </Routes>
      </MemoryRouter>,
    );

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
