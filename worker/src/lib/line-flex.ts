import type { EventSummary } from '../../../shared/types';

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
  if (event.confirmedCount < event.capacity) return '查看並報名';
  if (event.waitlistEnabled) return '查看並候補';
  return '查看活動';
}

function eventBubble(event: EventSummary, detailUrl: string): Record<string, unknown> {
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
      spacing: 'sm',
      contents: [
        {
          type: 'text',
          text: event.name,
          weight: 'bold',
          size: 'lg',
          wrap: true,
          color: '#14302E',
        },
        {
          type: 'text',
          text: `📅 ${formatFlexRange(event)}`,
          size: 'sm',
          color: '#4A6462',
          wrap: true,
          margin: 'md',
        },
        {
          type: 'text',
          text: `📍 ${event.address}`,
          size: 'sm',
          color: '#4A6462',
          wrap: true,
        },
        {
          type: 'text',
          text: `👥 ${event.confirmedCount}／${event.capacity}`,
          size: 'sm',
          color: '#0F6E6C',
          weight: 'bold',
        },
      ],
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'button',
          style: 'primary',
          color: '#0F6E6C',
          action: {
            type: 'uri',
            label: eventCtaLabel(event),
            uri: detailUrl,
          },
        },
      ],
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
      contents: [
        {
          type: 'text',
          text: '查看全部活動',
          weight: 'bold',
          size: 'lg',
          wrap: true,
          color: '#14302E',
        },
        {
          type: 'text',
          text: '開啟 JoyIn 完整活動列表',
          size: 'sm',
          color: '#4A6462',
          wrap: true,
          margin: 'md',
        },
      ],
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'button',
          style: 'secondary',
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
          contents: [
            {
              type: 'text',
              text: '目前沒有即將舉行的活動',
              weight: 'bold',
              wrap: true,
            },
            {
              type: 'text',
              text: '到 JoyIn 建立第一個活動吧',
              size: 'sm',
              color: '#666666',
              margin: 'md',
              wrap: true,
            },
          ],
        },
        footer: {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'button',
              style: 'primary',
              color: '#0F6E6C',
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
