import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MemberPreselectList } from './components/MemberPreselectList';
import { lineCandidateKey, proxyCandidateKey } from '../../shared/preselect';

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.css'), 'utf8');

function item(
  overrides: Partial<{
    key: string;
    kind: 'line' | 'proxy';
    lineUserId: string | null;
    proxyName: string | null;
    displayName: string;
    section: 'attended' | 'proxy' | 'waitlist' | 'history' | 'other';
    badge: 'proxy' | 'waitlist' | null;
  }>,
) {
  const kind = overrides.kind ?? 'line';
  const displayName = overrides.displayName ?? 'Amy';
  const lineUserId = overrides.lineUserId ?? (kind === 'line' ? 'U-amy' : null);
  const proxyName = overrides.proxyName ?? (kind === 'proxy' ? displayName : null);
  return {
    key:
      overrides.key ??
      (kind === 'line' ? lineCandidateKey(lineUserId!) : proxyCandidateKey(proxyName!)),
    kind,
    lineUserId,
    proxyName,
    displayName,
    pictureUrl: null,
    section: overrides.section ?? 'attended',
    defaultSelected: false,
    badge: overrides.badge ?? (kind === 'proxy' ? 'proxy' : null),
  };
}

describe('MemberPreselectList', () => {
  it('defaults to no selection and toggles by row click', () => {
    const onChange = vi.fn();
    render(
      <div style={{ width: 360 }}>
        <MemberPreselectList
          members={[
            item({ displayName: 'Amy', section: 'attended' }),
            item({
              displayName: 'Bob',
              lineUserId: 'U-bob',
              key: lineCandidateKey('U-bob'),
              section: 'other',
            }),
          ]}
          capacity={5}
          selectedKeys={[]}
          onChange={onChange}
        />
      </div>,
    );
    expect(screen.getByText('已選擇 0 人／人數上限 5 人')).toBeInTheDocument();
    expect(screen.getByText('上次參加者')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Amy/ }));
    expect(onChange).toHaveBeenCalledWith([lineCandidateKey('U-amy')]);
  });

  it('filters across sections, shows badges, and keeps overflow guards', () => {
    render(
      <div style={{ width: 320 }}>
        <MemberPreselectList
          members={[
            item({ displayName: 'Amy', section: 'attended' }),
            item({
              kind: 'proxy',
              displayName: 'Bobby',
              section: 'proxy',
              key: proxyCandidateKey('Bobby'),
            }),
            item({
              displayName: 'Cara',
              lineUserId: 'U-cara',
              key: lineCandidateKey('U-cara'),
              section: 'waitlist',
              badge: 'waitlist',
            }),
          ]}
          attendedTitle="原活動參加者"
          proxyTitle="原活動代報者"
          waitlistTitle="原活動候補"
          capacity={3}
          selectedKeys={[proxyCandidateKey('Bobby')]}
          onChange={vi.fn()}
          hint="目前顯示最近使用過的會員名單"
          onRefresh={vi.fn()}
        />
      </div>,
    );
    expect(screen.getByText('目前顯示最近使用過的會員名單')).toBeInTheDocument();
    expect(screen.getByText('代報')).toBeInTheDocument();
    expect(screen.getAllByText('原活動候補').length).toBeGreaterThanOrEqual(1);
    fireEvent.change(screen.getByLabelText('搜尋成員'), { target: { value: 'bob' } });
    expect(screen.getByRole('button', { name: /Bobby/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Amy/ })).not.toBeInTheDocument();
    expect(css).toMatch(/\.member-preselect[\s\S]*?min-width:\s*0/);
    expect(css).toMatch(/\.member-preselect-row[\s\S]*?min-width:\s*0/);
  });

  it('keeps selection when refresh fails to clear list (parent responsibility)', () => {
    const onChange = vi.fn();
    const onRefresh = vi.fn();
    render(
      <MemberPreselectList
        members={[item({ displayName: 'Amy' })]}
        capacity={2}
        selectedKeys={[lineCandidateKey('U-amy')]}
        onChange={onChange}
        onRefresh={onRefresh}
      />,
    );
    expect(screen.getByText('已選擇 1 人／人數上限 2 人')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '更新名單' }));
    expect(onRefresh).toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });
});
