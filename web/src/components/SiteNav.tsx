import { Link } from 'react-router-dom';

export function SiteNav({ current }: { current?: 'events' | 'help' }) {
  return (
    <nav className="site-nav" aria-label="主要">
      <Link to={current === 'help' ? '/help' : '/events'} className="site-nav-brand">
        JoyIn
      </Link>
      <div className="site-nav-links">
        <Link
          to="/events"
          className="site-nav-pill"
          aria-current={current === 'events' ? 'page' : undefined}
        >
          活動
        </Link>
        <Link
          to="/help"
          className="site-nav-pill"
          aria-current={current === 'help' ? 'page' : undefined}
        >
          使用手冊
        </Link>
      </div>
    </nav>
  );
}
