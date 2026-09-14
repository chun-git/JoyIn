import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AuthExpiredPanel, LoginFailedPanel } from './components/AuthExpiredPanel';
import {
  AUTH_EXPIRED_BODY,
  AUTH_EXPIRED_TITLE,
  AUTH_LOGIN_FAILED_BODY,
  AUTH_LOGIN_FAILED_TITLE,
  AUTH_RELOGIN_BUTTON,
} from './auth-recovery-keys';

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.css'), 'utf8');

describe('Auth panels + responsive layout guards', () => {
  it('auth expired offers 重新登入 LINE and never /list copy', () => {
    const onRelogin = vi.fn();
    render(
      <MemoryRouter>
        <div className="app-shell" style={{ width: 320 }}>
          <AuthExpiredPanel inClient onRelogin={onRelogin} />
        </div>
      </MemoryRouter>,
    );
    expect(screen.getByText(AUTH_EXPIRED_TITLE)).toBeInTheDocument();
    expect(screen.getByText(AUTH_EXPIRED_BODY)).toBeInTheDocument();
    expect(AUTH_EXPIRED_BODY).not.toContain('/list');
    expect(screen.getByRole('button', { name: AUTH_RELOGIN_BUTTON })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '關閉頁面' })).toBeInTheDocument();
    screen.getByRole('button', { name: AUTH_RELOGIN_BUTTON }).click();
    expect(onRelogin).toHaveBeenCalledTimes(1);
  });

  it('external login failure offers 重新登入 LINE', () => {
    const onRetry = vi.fn();
    render(
      <MemoryRouter>
        <div className="app-shell" style={{ width: 1024 }}>
          <LoginFailedPanel onRetryLogin={onRetry} />
        </div>
      </MemoryRouter>,
    );
    expect(screen.getByText(AUTH_LOGIN_FAILED_TITLE)).toBeInTheDocument();
    expect(screen.getByText(AUTH_LOGIN_FAILED_BODY)).toBeInTheDocument();
    screen.getByRole('button', { name: AUTH_RELOGIN_BUTTON }).click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('CSS prevents horizontal overflow and centers desktop auth panel', () => {
    expect(css).toMatch(/overflow-x:\s*hidden/);
    expect(css).toMatch(/\.app-shell[\s\S]*?max-width:\s*760px/);
    expect(css).toMatch(/\.app-shell[\s\S]*?min-width:\s*0/);
    expect(css).toMatch(/\.auth-panel[\s\S]*?max-width:\s*420px/);
    expect(css).toMatch(/@media \(min-width: 768px\)/);
    expect(css).toMatch(/@media \(min-width: 1024px\)/);
  });
});
