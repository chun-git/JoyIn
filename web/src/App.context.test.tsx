import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { CONTEXT_MISSING_MESSAGE } from './liff-context';

vi.mock('./liff', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./liff')>();
  return {
    ...actual,
    initSession: vi.fn(async () => ({
      status: 'ready' as const,
      phase: 'ready' as const,
      session: {
        lineUserId: 'U-lee',
        displayName: 'Lee',
        contextToken: '',
        inClient: false,
        getIdToken: () => 'header.payload.signature',
        contextDiag: {
          hasContextToken: false,
          contextTokenLength: 0,
          contextSource: '' as const,
          loadedAt: new Date().toISOString(),
        },
      },
    })),
    retryInitSession: vi.fn(),
  };
});

import App from './App';

describe('GroupGate without context', () => {
  it('shows /list guidance when opening Pages URL without context', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );
    expect(await screen.findByText(CONTEXT_MISSING_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByText('活動載入中…')).not.toBeInTheDocument();
  });
});
