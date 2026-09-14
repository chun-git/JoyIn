import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MemberPreselectList } from './components/MemberPreselectList';

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.css'), 'utf8');

function item(
  lineUserId: string,
  displayName: string,
  section: 'attended' | 'waitlist' | 'other',
) {
  return {
    lineUserId,
    displayName,
    pictureUrl: null,
    section,
    defaultSelected: false,
  };
}

describe('MemberPreselectList', () => {
  it('defaults to no selection and toggles by row click', () => {
    const onChange = vi.fn();
    render(
      <div style={{ width: 360 }}>
        <MemberPreselectList
          members={[item('U-amy', 'Amy', 'attended'), item('U-bob', 'Bob', 'other')]}
          capacity={5}
          selectedIds={[]}
          onChange={onChange}
        />
      </div>,
    );
    expect(screen.getByText('已選擇 0 人／人數上限 5 人')).toBeInTheDocument();
    expect(screen.getByText('上次參加')).toBeInTheDocument();
    expect(screen.getByText('其他群組成員')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Amy/ }));
    expect(onChange).toHaveBeenCalledWith(['U-amy']);
  });

  it('filters across all sections and keeps overflow guards in CSS', () => {
    render(
      <MemberPreselectList
        members={[
          item('U-amy', 'Amy', 'attended'),
          item('U-bob', 'Bobby', 'waitlist'),
          item('U-cara', 'Cara', 'other'),
        ]}
        attendedTitle="原活動參加者"
        waitlistTitle="原活動候補"
        capacity={3}
        selectedIds={['U-bob']}
        onChange={vi.fn()}
        hint="目前顯示最近使用過的會員名單"
        onRefresh={vi.fn()}
      />,
    );
    expect(screen.getByText('目前顯示最近使用過的會員名單')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '更新名單' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('搜尋成員'), { target: { value: 'bob' } });
    expect(screen.getByRole('button', { name: /Bobby/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Amy/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Cara/ })).not.toBeInTheDocument();
    expect(css).toMatch(/\.member-preselect[\s\S]*?min-width:\s*0/);
    expect(css).toMatch(/\.member-preselect-row[\s\S]*?min-width:\s*0/);
  });
});
