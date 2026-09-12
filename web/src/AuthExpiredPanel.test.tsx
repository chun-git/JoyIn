import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AuthExpiredPanel } from './components/AuthExpiredPanel';
import { AUTH_EXPIRED_BODY, AUTH_EXPIRED_TITLE } from './auth-recovery-keys';

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.css'), 'utf8');

describe('AuthExpiredPanel + 320px layout guards', () => {
  it('LIFF Browser expired UI offers 關閉頁面 and never 重新登入', () => {
    render(
      <MemoryRouter>
        <div className="app-shell" style={{ width: 320 }}>
          <AuthExpiredPanel inClient kind="expired" />
        </div>
      </MemoryRouter>,
    );
    expect(screen.getByText(AUTH_EXPIRED_TITLE)).toBeInTheDocument();
    expect(screen.getByText(AUTH_EXPIRED_BODY)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '關閉頁面' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '查看使用手冊' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重新登入 LINE' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重試登入' })).not.toBeInTheDocument();
  });

  it('CSS prevents horizontal overflow at narrow viewports', () => {
    expect(css).toMatch(/overflow-x:\s*hidden/);
    expect(css).toMatch(/\.app-shell[\s\S]*?max-width:\s*760px/);
    expect(css).toMatch(/\.app-shell[\s\S]*?min-width:\s*0/);
    expect(css).toMatch(/button,\s*input[\s\S]*?max-width:\s*100%/);
  });
});
