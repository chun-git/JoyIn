import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MemberPreselectList } from './components/MemberPreselectList';

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.css'), 'utf8');

describe('MemberPreselectList', () => {
  it('defaults to no selection and toggles by row click', () => {
    const onChange = vi.fn();
    render(
      <div style={{ width: 360 }}>
        <MemberPreselectList
          members={[
            { lineUserId: 'U-amy', displayName: 'Amy', pictureUrl: null },
            { lineUserId: 'U-bob', displayName: 'Bob', pictureUrl: null },
          ]}
          capacity={5}
          selectedIds={[]}
          onChange={onChange}
        />
      </div>,
    );
    expect(screen.getByText('已選擇 0 人／人數上限 5 人')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Amy/ }));
    expect(onChange).toHaveBeenCalledWith(['U-amy']);
  });

  it('filters by display name and keeps overflow guards in CSS', () => {
    render(
      <MemberPreselectList
        members={[
          { lineUserId: 'U-amy', displayName: 'Amy', pictureUrl: null },
          { lineUserId: 'U-bob', displayName: 'Bobby', pictureUrl: null },
        ]}
        capacity={3}
        selectedIds={['U-bob']}
        onChange={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText('搜尋成員'), { target: { value: 'bob' } });
    expect(screen.getByRole('button', { name: /Bobby/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Amy/ })).not.toBeInTheDocument();
    expect(css).toMatch(/\.member-preselect[\s\S]*?min-width:\s*0/);
    expect(css).toMatch(/\.member-preselect-row[\s\S]*?min-width:\s*0/);
  });
});
