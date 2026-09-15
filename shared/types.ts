export type EventStatus = 'OPEN' | 'CLOSED' | 'DELETED';
export type RegistrationType = 'SELF' | 'PROXY';
export type RegistrationStatus = 'CONFIRMED' | 'WAITLIST';
export type RegistrationSource = 'SELF_JOIN' | 'PROXY' | 'ORGANIZER_PRESELECT';
export type TransferInviteStatus = 'PENDING' | 'ACCEPTED' | 'CANCELLED';

export interface EventSummary {
  eventId: string;
  groupId: string;
  name: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  startAt: string;
  endAt: string;
  address: string;
  /** Optional Google Maps https URL; null when unset. */
  googleMapsUrl: string | null;
  /** Per-person fee in TWD; 0 means free. */
  feeAmount: number;
  capacity: number;
  waitlistEnabled: boolean;
  status: EventStatus;
  confirmedCount: number;
  waitlistCount: number;
  organizerLineUserId: string;
  organizerDisplayName: string;
  createdAt: string;
  updatedAt: string;
  /** True when end_at has passed (still within retention when returned by APIs). */
  isEnded?: boolean;
}

export type HistoryViewerRole = 'organizer' | 'attended' | 'waitlist' | 'proxy';

export interface HistoryEventSummary extends EventSummary {
  isEnded: true;
  viewerRoles: HistoryViewerRole[];
}

export interface RegistrationRecord {
  registrationId: string;
  eventId: string;
  type: RegistrationType;
  status: RegistrationStatus;
  registrationSource: RegistrationSource;
  waitlistPosition: number | null;
  participantName: string;
  displayLabel: string;
  lineUserId: string | null;
  /** LINE user id of the attendee when known (SELF / ORGANIZER_PRESELECT). */
  participantLineUserId: string | null;
  createdByLineUserId: string;
  createdByDisplayName: string;
  createdAt: string;
  canCancel: boolean;
}

export interface GroupMemberPublic {
  lineUserId: string;
  displayName: string;
  pictureUrl: string | null;
}

export type PreselectCandidateKind = 'line' | 'proxy';
export type PreselectMemberSection =
  | 'attended'
  | 'proxy'
  | 'waitlist'
  | 'history'
  | 'other';
export type PreselectMemberBadge = 'proxy' | 'waitlist' | null;

export interface PreselectMemberItem {
  /** Stable selection key: `line:{userId}` or `proxy:{normalizedName}`. */
  key: string;
  kind: PreselectCandidateKind;
  lineUserId: string | null;
  proxyName: string | null;
  displayName: string;
  pictureUrl: string | null;
  section: PreselectMemberSection;
  defaultSelected: boolean;
  badge: PreselectMemberBadge;
}

export interface PreselectMemberRoster {
  members: PreselectMemberItem[];
  sections: {
    attended: PreselectMemberItem[];
    proxy: PreselectMemberItem[];
    waitlist: PreselectMemberItem[];
    history: PreselectMemberItem[];
    other: PreselectMemberItem[];
  };
  attendedTitle: string;
  proxyTitle: string;
  waitlistTitle: string;
  historyTitle: string;
  otherTitle: string;
  defaultSelectedKeys: string[];
  /** @deprecated Prefer defaultSelectedKeys */
  defaultSelectedIds: string[];
  lineSyncStatus: 'ok' | 'failed' | 'skipped' | 'unavailable';
  hint: string | null;
  emptyMessage: string | null;
  syncedAt: string | null;
}

export interface EventDetail extends EventSummary {
  registrations: {
    confirmed: RegistrationRecord[];
    waitlist: RegistrationRecord[];
  };
  viewer: {
    isOrganizer: boolean;
    selfRegistration: RegistrationRecord | null;
    proxyRegistrations: RegistrationRecord[];
  };
}

export interface EventTimeRangeInput {
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
}

export interface CreateEventInput extends EventTimeRangeInput {
  name: string;
  address: string;
  googleMapsUrl: string | null;
  feeAmount: number;
  capacity: number;
  waitlistEnabled: boolean;
  /** LINE user ids to pre-register as CONFIRMED (organizer preselect). */
  preselectedMemberIds?: string[];
  /** Proxy display names to pre-register as PROXY (organizer preselect). */
  preselectedProxyNames?: string[];
}

export interface UpdateEventInput extends Partial<Omit<CreateEventInput, 'preselectedMemberIds' | 'preselectedProxyNames'>> {
  confirmTimeLocationChange?: boolean;
}

export interface CopyEventInput extends EventTimeRangeInput {
  name?: string;
  address?: string;
  googleMapsUrl?: string | null;
  feeAmount?: number;
  capacity?: number;
  waitlistEnabled?: boolean;
  preselectedMemberIds?: string[];
  preselectedProxyNames?: string[];
}

export interface TransferInviteCreated {
  token: string;
  expiresAt: string;
  sharePath: string;
}

export interface TransferInvitePreview {
  eventId: string;
  eventName: string;
  organizerDisplayName: string;
  status: TransferInviteStatus;
  expiresAt: string;
  isOrganizer: boolean;
}

export interface ApiErrorBody {
  error: string;
  message: string;
}

/** Fixed disclaimer shown on all preorder payment UIs. */
export const PREORDER_PAYMENT_DISCLAIMER =
  '商品款由訂購者直接支付代訂者，JoyIn 不代收商品費用。';

export type PreorderOfferStatus = 'OPEN' | 'CLOSED' | 'CANCELLED';
export type PreorderOrderStatus =
  | 'PENDING_PAYMENT'
  | 'PAYMENT_REPORTED'
  | 'PAYMENT_CONFIRMED'
  | 'CANCELLED'
  | 'FULFILLED';

export interface PreorderProductInput {
  name: string;
  specification?: string | null;
  unitPrice: number;
  quantityLimit?: number | null;
  sortOrder?: number;
  isActive?: boolean;
  /** When editing an existing product. */
  productId?: string;
}

export interface PreorderProduct {
  productId: string;
  offerId: string;
  name: string;
  specification: string | null;
  unitPrice: number;
  quantityLimit: number | null;
  orderedQuantity: number;
  remainingQuantity: number | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PreorderOfferSummary {
  offerId: string;
  eventId: string;
  providerLineUserId: string;
  providerDisplayName: string;
  title: string;
  merchantName: string;
  description: string;
  orderDeadline: string;
  paymentInstructions: string;
  paymentUrl: string | null;
  status: PreorderOfferStatus;
  productCount: number;
  myOrderStatus: PreorderOrderStatus | null;
  createdAt: string;
  updatedAt: string;
}

/** Explicit viewer capabilities — frontend must not re-derive from roles. */
export interface PreorderViewerCapabilities {
  canCreatePreorder: boolean;
  canOrder: boolean;
  canManagePreorder: boolean;
  preorderRestrictionReason: string | null;
  orderRestrictionReason: string | null;
}

export interface PreorderOfferDetail extends PreorderOfferSummary {
  products: PreorderProduct[];
  viewer: PreorderViewerCapabilities;
}

export interface EventPreorderListResponse {
  offers: PreorderOfferSummary[];
  canCreatePreorder: boolean;
  preorderRestrictionReason: string | null;
}

export interface CreatePreorderOfferInput {
  title: string;
  merchantName: string;
  description?: string;
  orderDeadline: string;
  paymentInstructions?: string;
  paymentUrl?: string | null;
  products: PreorderProductInput[];
}

export interface UpdatePreorderOfferInput {
  title?: string;
  merchantName?: string;
  description?: string;
  orderDeadline?: string;
  paymentInstructions?: string;
  paymentUrl?: string | null;
  products?: PreorderProductInput[];
}

export interface PreorderOrderItemInput {
  productId: string;
  quantity: number;
}

export interface PreorderOrderItem {
  orderItemId: string;
  productId: string;
  productNameSnapshot: string;
  specificationSnapshot: string | null;
  unitPriceSnapshot: number;
  quantity: number;
  subtotal: number;
}

export interface PreorderOrder {
  orderId: string;
  offerId: string;
  eventId: string;
  buyerLineUserId: string;
  buyerDisplayName: string;
  status: PreorderOrderStatus;
  totalAmount: number;
  cancellationReason: string | null;
  paymentReportedAt: string | null;
  paymentConfirmedAt: string | null;
  fulfilledAt: string | null;
  items: PreorderOrderItem[];
  createdAt: string;
  updatedAt: string;
}

export interface PreorderProductAggregate {
  productId: string;
  name: string;
  specification: string | null;
  unitPrice: number;
  totalQuantity: number;
  subtotal: number;
}

export interface PreorderOfferOrderSummary {
  offerId: string;
  orderCount: number;
  totalReceivable: number;
  countsByStatus: Record<PreorderOrderStatus, number>;
  productAggregates: PreorderProductAggregate[];
  orders: PreorderOrder[];
}

export interface EventPreorderCancelImpact {
  blocked: boolean;
  kind: 'buyer_confirmed' | 'provider_has_orders' | null;
  message: string | null;
  pendingCancelCount: number;
}

export interface EventPreorderCancelBlock {
  kind: 'buyer_confirmed' | 'provider_has_orders';
  message: string;
  offerTitles: string[];
}
