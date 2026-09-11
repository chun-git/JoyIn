import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { CONTEXT_MISSING_MESSAGE } from './liff-context';

vi.mock('./liff', () => ({
  CONTEXT_MISSING_MESSAGE: '請回到 LINE 群組輸入 /list，並從活動卡片開啟 JoyIn',
  CONTEXT_INVALID_MESSAGE: '活動連結已失效，請重新輸入 /list',
  initSession: vi.fn(async () => ({
    idToken: 'test:U-lee:Lee',
    lineUserId: 'U-lee',
    displayName: 'Lee',
    contextToken: '',
    inClient: false,
    contextDiag: {
      hasContextToken: false,
      contextTokenLength: 0,
      contextSource: '',
      loadedAt: new Date().toISOString(),
    },
  })),
}));

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
