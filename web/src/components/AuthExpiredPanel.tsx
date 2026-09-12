import { Link } from 'react-router-dom';
import {
  AUTH_EXPIRED_BODY,
  AUTH_EXPIRED_TITLE,
  AUTH_EXTERNAL_BROWSER_MESSAGE,
} from '../auth-recovery-keys';
import { closeLiffWindowIfInClient } from '../auth-recovery';
import { getCachedLiff } from '../liff';
import { StateBlock } from './StateBlock';

export function AuthExpiredPanel({
  inClient,
  kind = 'expired',
}: {
  inClient: boolean;
  kind?: 'expired' | 'external';
}) {
  if (kind === 'external') {
    return (
      <StateBlock kind="error" title={AUTH_EXTERNAL_BROWSER_MESSAGE}>
        <div className="row" style={{ marginTop: 12, justifyContent: 'center' }}>
          <Link to="/help" className="btn secondary">
            查看使用手冊
          </Link>
        </div>
      </StateBlock>
    );
  }

  return (
    <StateBlock kind="error" title={AUTH_EXPIRED_TITLE}>
      {AUTH_EXPIRED_BODY}
      <div className="row" style={{ marginTop: 12, justifyContent: 'center' }}>
        {inClient ? (
          <button
            className="btn"
            type="button"
            onClick={() => {
              closeLiffWindowIfInClient(getCachedLiff());
            }}
          >
            關閉頁面
          </button>
        ) : null}
        <Link to="/help" className="btn secondary">
          查看使用手冊
        </Link>
      </div>
    </StateBlock>
  );
}
