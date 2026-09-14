import type { EventSummary } from '../../../shared/types';
import { formatFeeLabel, withOpenExternalBrowser } from '../../../shared/event-fields';

/** JoyIn brand colors for LINE Flex (no CSS gradients). */
export const FLEX_COLORS = {
  navy: '#0756A5',
  brand: '#149BE8',
  mint: '#35C7B5',
  bgSoft: '#F5FBFF',
  paper: '#FFFFFF',
  ink: '#12324A',
  muted: '#5A7388',
  warn: '#D97706',
  danger: '#E25C3A',
  closed: '#6B7C8A',
} as const;

export interface LineFlexMessage {
  type: 'flex';
  altText: string;
  contents: Record<string, unknown>;
}

export interface EventCarouselUrls {
  /** Shared context-bearing LIFF base builder result for the list (`/events`). */
  listUrl: string;
  /** Per-event detail URLs keyed by eventId (`/events/{eventId}`). */
  eventUrls: Record<string, string>;
}

function formatFlexRange(event: EventSummary): string {
  if (event.startDate === event.endDate) {
    return `${event.startDate} ${event.startTime} – ${event.endTime}`;
  }
  return `${event.startDate} ${event.startTime} – ${event.endDate} ${event.endTime}`;
}

function eventCtaLabel(event: EventSummary): string {
  if (event.status === 'CLOSED') return '查看活動';
  if (event.confirmedCount < event.capacity) return '查看並報名';
  if (event.waitlistEnabled) return '查看並候補';
  return '查看活動';
}

/** Status text + color; never color-only. */
export function flexStatusPresentation(event: EventSummary): { label: string; color: string } {
  if (event.status === 'CLOSED') {
    return { label: '已關閉報名', color: FLEX_COLORS.closed };
  }
  if (event.confirmedCount < event.capacity) {
    return { label: '報名中・尚有名額', color: FLEX_COLORS.mint };
  }
  if (event.waitlistEnabled) {
    const wait =
      event.waitlistCount > 0 ? `候補中・${event.waitlistCount} 人` : '額滿・開放候補';
    return { label: wait, color: FLEX_COLORS.warn };
  }
  return { label: '已額滿', color: FLEX_COLORS.danger };
}

function infoRow(iconAndText: string, color: string = FLEX_COLORS.muted): Record<string, unknown> {
  return {
    type: 'text',
    text: iconAndText,
    size: 'sm',
    color,
    wrap: true,
  };
}

function eventBubble(event: EventSummary, detailUrl: string): Record<string, unknown> {
  const status = flexStatusPresentation(event);
  const infoContents: Record<string, unknown>[] = [
    infoRow(`📅 ${formatFlexRange(event)}`, FLEX_COLORS.navy),
    infoRow(`📍 ${event.address}`),
    infoRow(`💰 ${formatFeeLabel(event.feeAmount)}`),
    infoRow(`👥 ${event.confirmedCount}／${event.capacity}`, FLEX_COLORS.navy),
    {
      type: 'text',
      text: status.label,
      size: 'sm',
      weight: 'bold',
      color: status.color,
      wrap: true,
      margin: 'sm',
    },
  ];

  const footerContents: Record<string, unknown>[] = [];
  if (event.googleMapsUrl) {
    // Mint fill + ink text (primary buttons force white text; mint+white fails contrast).
    footerContents.push({
      type: 'box',
      layout: 'vertical',
      backgroundColor: FLEX_COLORS.mint,
      cornerRadius: 'md',
      paddingAll: 'md',
      action: {
        type: 'uri',
        label: '導航',
        uri: withOpenExternalBrowser(event.googleMapsUrl),
      },
      contents: [
        {
          type: 'text',
          text: '導航',
          align: 'center',
          size: 'sm',
          weight: 'bold',
          color: FLEX_COLORS.ink,
        },
      ],
    });
  }
  footerContents.push({
    type: 'button',
    style: 'primary',
    height: 'md',
    color: FLEX_COLORS.navy,
    action: {
      type: 'uri',
      label: eventCtaLabel(event),
      uri: detailUrl,
    },
  });

  return {
    type: 'bubble',
    size: 'kilo',
    action: {
      type: 'uri',
      uri: detailUrl,
    },
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'md',
      paddingAll: 'lg',
      backgroundColor: FLEX_COLORS.paper,
      contents: [
        {
          type: 'text',
          text: event.name,
          weight: 'bold',
          size: 'lg',
          wrap: true,
          color: FLEX_COLORS.ink,
        },
        {
          type: 'box',
          layout: 'vertical',
          spacing: 'sm',
          paddingAll: 'md',
          backgroundColor: FLEX_COLORS.bgSoft,
          cornerRadius: 'md',
          contents: infoContents,
        },
      ],
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      paddingAll: 'lg',
      paddingTop: 'none',
      backgroundColor: FLEX_COLORS.paper,
      contents: footerContents,
    },
  };
}

function listAllBubble(listUrl: string): Record<string, unknown> {
  return {
    type: 'bubble',
    size: 'kilo',
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'md',
      paddingAll: 'lg',
      backgroundColor: FLEX_COLORS.paper,
      contents: [
        {
          type: 'text',
          text: '查看全部活動',
          weight: 'bold',
          size: 'lg',
          wrap: true,
          color: FLEX_COLORS.ink,
        },
        {
          type: 'box',
          layout: 'vertical',
          paddingAll: 'md',
          backgroundColor: FLEX_COLORS.bgSoft,
          cornerRadius: 'md',
          contents: [
            {
              type: 'text',
              text: '開啟 JoyIn 完整活動列表',
              size: 'sm',
              color: FLEX_COLORS.muted,
              wrap: true,
            },
          ],
        },
      ],
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      paddingAll: 'lg',
      paddingTop: 'none',
      backgroundColor: FLEX_COLORS.paper,
      contents: [
        {
          type: 'button',
          style: 'primary',
          height: 'md',
          color: FLEX_COLORS.brand,
          action: {
            type: 'uri',
            label: '查看全部活動',
            uri: listUrl,
          },
        },
      ],
    },
  };
}

/**
 * Build /list Flex carousel.
 * - Each event bubble URI → `/events/{eventId}`
 * - Trailing bubble → `/events` (查看全部活動)
 * - Empty state → `/events`
 * - Optional「導航」uses uri action + openExternalBrowser (maps outside LIFF)
 */
export function buildEventCarousel(
  events: EventSummary[],
  urls: EventCarouselUrls | string,
): LineFlexMessage {
  // Backward-compatible: single string = list URL for every action (tests).
  const listUrl = typeof urls === 'string' ? urls : urls.listUrl;
  const eventUrls = typeof urls === 'string' ? {} : urls.eventUrls;

  if (events.length === 0) {
    return {
      type: 'flex',
      altText: '目前沒有即將舉行的活動',
      contents: {
        type: 'bubble',
        body: {
          type: 'box',
          layout: 'vertical',
          spacing: 'md',
          paddingAll: 'lg',
          backgroundColor: FLEX_COLORS.paper,
          contents: [
            {
              type: 'text',
              text: '目前沒有即將舉行的活動',
              weight: 'bold',
              wrap: true,
              color: FLEX_COLORS.ink,
            },
            {
              type: 'box',
              layout: 'vertical',
              paddingAll: 'md',
              backgroundColor: FLEX_COLORS.bgSoft,
              cornerRadius: 'md',
              contents: [
                {
                  type: 'text',
                  text: '到 JoyIn 建立第一個活動吧',
                  size: 'sm',
                  color: FLEX_COLORS.muted,
                  wrap: true,
                },
              ],
            },
          ],
        },
        footer: {
          type: 'box',
          layout: 'vertical',
          paddingAll: 'lg',
          paddingTop: 'none',
          backgroundColor: FLEX_COLORS.paper,
          contents: [
            {
              type: 'button',
              style: 'primary',
              color: FLEX_COLORS.brand,
              action: {
                type: 'uri',
                label: '開啟 JoyIn',
                uri: listUrl,
              },
            },
          ],
        },
      },
    };
  }

  const bubbles = events.map((event) => {
    const detailUrl = eventUrls[event.eventId] || listUrl;
    return eventBubble(event, detailUrl);
  });
  bubbles.push(listAllBubble(listUrl));

  return {
    type: 'flex',
    altText: '即將舉行的活動',
    contents: {
      type: 'carousel',
      contents: bubbles,
    },
  };
}
