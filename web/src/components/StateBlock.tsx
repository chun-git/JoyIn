import type { ReactNode } from 'react';

export function StateBlock({
  kind,
  title,
  children,
}: {
  kind: 'loading' | 'error' | 'empty' | 'success';
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className={`panel ${kind}`}>
      <strong>{title}</strong>
      {children ? <div className="state-body">{children}</div> : null}
    </div>
  );
}
