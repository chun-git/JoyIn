import type { ReactNode } from 'react';

export function InlineHint({
  question,
  children,
}: {
  question: string;
  children: ReactNode;
}) {
  return (
    <details className="inline-hint">
      <summary>{question}</summary>
      <div className="inline-hint-body">{children}</div>
    </details>
  );
}
