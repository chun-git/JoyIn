import type { EventSummary } from '../../../shared/types';

export interface LineFlexMessage {
  type: 'flex';
  altText: string;
  contents: Record<string, unknown>;
}

function formatFlexRange(event: EventSummary): string {
  if (event.startDate === event.endDate) {
    return `${event.startDate} ${event.startTime} – ${event.endTime}`;
  }
  return `${event.startDate} ${event.startTime} – ${event.endDate} ${event.endTime}`;
}

function bubble(event: EventSummary, liffUrl: string): Record<string, unknown> {
  return {
    type: 'bubble',
    size: 'kilo',
    action: {
      type: 'uri',
      uri: liffUrl,
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
            label: '查看全部活動',
            uri: liffUrl,
          },
        },
      ],
    },
  };
}

export function buildEventCarousel(events: EventSummary[], liffUrl: string): LineFlexMessage {
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
                uri: liffUrl,
              },
            },
          ],
        },
      },
    };
  }

  return {
    type: 'flex',
    altText: '即將舉行的活動',
    contents: {
      type: 'carousel',
      contents: events.map((event) => bubble(event, liffUrl)),
    },
  };
}
