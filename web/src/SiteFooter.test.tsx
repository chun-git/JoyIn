import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppShell } from './components/AppShell';
import { SiteFooter } from './components/SiteFooter';

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.css'), 'utf8');

describe('SiteFooter', () => {
  it('renders credit and external contact pills with safe link attributes', () => {
    render(
      <MemoryRouter>
        <SiteFooter />
      </MemoryRouter>,
    );
    expect(screen.getByRole('contentinfo', { name: '網站頁尾' })).toBeInTheDocument();
    expect(screen.getByText('JoyIn Technology 製作')).toBeInTheDocument();
    expect(screen.getByText('合作洽談')).toBeInTheDocument();

    const ig = screen.getByRole('link', { name: /Instagram.*@joyin_technology/i });
    expect(ig).toHaveAttribute('href', 'https://www.instagram.com/joyin_technology/');
    expect(ig).toHaveAttribute('target', '_blank');
    expect(ig).toHaveAttribute('rel', 'noopener noreferrer');

    const line = screen.getByRole('link', { name: /LINE 聯絡我們/i });
    expect(line).toHaveAttribute('href', 'https://line.me/ti/p/hMNqdu_Sua');
    expect(line).toHaveAttribute('target', '_blank');
    expect(line).toHaveAttribute('rel', 'noopener noreferrer');

    expect(screen.queryByText(/@gmail|電話|手機|Email/i)).not.toBeInTheDocument();
  });

  it('AppShell places footer after main content and is not position:fixed', () => {
    render(
      <MemoryRouter>
        <AppShell>
          <p>頁面內容</p>
        </AppShell>
      </MemoryRouter>,
    );
    expect(screen.getByText('頁面內容')).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
    expect(css).toMatch(/\.site-footer[\s\S]*?margin-top:\s*auto/);
    expect(css).not.toMatch(/\.site-footer[\s\S]{0,200}position:\s*fixed/);
    expect(css).toMatch(/--navy:\s*#0756a5/i);
    expect(css).toMatch(/--brand:\s*#149be8/i);
    expect(css).toMatch(/--mint:\s*#35c7b5/i);
    expect(css).toMatch(/--bg:\s*#f5fbff/i);
    expect(css).toMatch(/--paper:\s*#ffffff/i);
    expect(css).toMatch(/--ink:\s*#12324a/i);
    expect(css).not.toMatch(/--bg:\s*#f4efe4/i);
  });
});
