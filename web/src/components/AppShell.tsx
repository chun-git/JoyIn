import type { ReactNode } from 'react';
import { SiteFooter } from './SiteFooter';

/** Page chrome: main content + sticky-bottom (non-fixed) site footer. */
export function AppShell({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={['app-shell', className].filter(Boolean).join(' ')}>
      <div className="app-shell-main">{children}</div>
      <SiteFooter />
    </div>
  );
}
