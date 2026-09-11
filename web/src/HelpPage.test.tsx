import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import App from './App';

vi.mock('./liff', () => ({
  initSession: vi.fn(() => new Promise(() => undefined)),
}));

function renderHelp(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

describe('HelpPage', () => {
  it('is readable without LINE login', async () => {
    const { initSession } = await import('./liff');
    renderHelp('/help');
    expect(await screen.findByRole('heading', { name: '使用手冊' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '快速開始' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '將 JoyIn 加入 LINE 群組' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '在群組輸入 /list' })).toBeInTheDocument();
    expect(initSession).not.toHaveBeenCalled();
    const create = screen.getByRole('link', { name: '新增活動' });
    expect(create).toHaveAttribute('href', '/events/new');
    const actions = create.closest('.help-actions');
    expect(actions?.textContent).toMatch(/新增活動.*查看參加者操作/);
  });

  it('keeps create action first on /help/start', async () => {
    renderHelp('/help/start');
    expect(await screen.findByRole('link', { name: '新增活動' })).toHaveAttribute('href', '/events/new');
  });

  it('navigates chapters from the table of contents', async () => {
    const user = userEvent.setup();
    renderHelp('/help/start');
    const toc = screen.getByRole('navigation', { name: '使用手冊章節' });
    await user.click(within(toc).getByRole('link', { name: '轉移主揪' }));
    expect(await screen.findByRole('heading', { name: '轉移主揪' })).toBeInTheDocument();
    expect(screen.getByText(/不需要輸入 LINE User ID/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '轉移主揪流程' })).toBeInTheDocument();
  });

  it('shows an accordion for FAQ', async () => {
    const user = userEvent.setup();
    renderHelp('/help/faq');
    const question = screen.getByText('轉移主揪要填 LINE User ID 嗎？');
    expect(question).toBeInTheDocument();
    await user.click(question);
    expect(screen.getByText(/產生邀請連結給對方/)).toBeVisible();
  });

  it('handles a missing chapter', async () => {
    renderHelp('/help/not-a-real-topic');
    expect(await screen.findByRole('heading', { name: '找不到這個章節' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '回到快速開始' })).toHaveAttribute('href', '/help/start');
  });

  it('lets mobile users pick a chapter from the select', async () => {
    const user = userEvent.setup();
    renderHelp('/help/start');
    const select = screen.getByLabelText('選擇章節');
    await user.selectOptions(select, 'commands');
    expect(await screen.findByRole('heading', { name: 'LINE Bot 指令' })).toBeInTheDocument();
    expect(screen.getByText(/最近的五筆活動/)).toBeInTheDocument();
  });

  it('exposes main landmark and labelled navigation', () => {
    renderHelp('/help/join');
    expect(screen.getByRole('navigation', { name: '主要' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: '使用手冊章節' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    const siteNav = screen.getByRole('navigation', { name: '主要' });
    expect(within(siteNav).getByRole('link', { name: '使用手冊' })).toHaveAttribute('aria-current', 'page');
    expect(within(siteNav).getByRole('link', { name: '活動' })).not.toHaveAttribute('aria-current');
    expect(screen.queryByRole('button', { name: '返回 LINE' })).not.toBeInTheDocument();
    const toc = screen.getByRole('navigation', { name: '使用手冊章節' });
    expect(within(toc).getByRole('link', { name: '參加者操作' })).toHaveAttribute('aria-current', 'page');
  });
});
