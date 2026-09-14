import { Link } from 'react-router-dom';
import {
  AUTH_EXPIRED_BODY,
  AUTH_EXPIRED_TITLE,
  AUTH_LOGIN_FAILED_BODY,
  AUTH_LOGIN_FAILED_TITLE,
  AUTH_RELOGIN_BUTTON,
} from '../auth-recovery-keys';
import { closeLiffWindowIfInClient } from '../auth-recovery';
import { getCachedLiff } from '../liff';
import { StateBlock } from './StateBlock';

export function AuthExpiredPanel({
  inClient,
  onRelogin,
}: {
  inClient: boolean;
  /** One-shot manual LINE login — never auto-loop. */
  onRelogin?: () => void;
  /** @deprecated external kind removed — use LoginFailedPanel */
  kind?: 'expired' | 'external';
}) {
  return (
    <div className="auth-panel">
      <StateBlock kind="error" title={AUTH_EXPIRED_TITLE}>
        {AUTH_EXPIRED_BODY}
        <div className="row" style={{ marginTop: 12, justifyContent: 'center' }}>
          {onRelogin ? (
            <button className="btn" type="button" onClick={onRelogin}>
              {AUTH_RELOGIN_BUTTON}
            </button>
          ) : null}
          {inClient ? (
            <button
              className="btn secondary"
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
    </div>
  );
}

export function LoginFailedPanel({ onRetryLogin }: { onRetryLogin: () => void }) {
  return (
    <div className="auth-panel">
      <StateBlock kind="error" title={AUTH_LOGIN_FAILED_TITLE}>
        {AUTH_LOGIN_FAILED_BODY}
        <div className="row" style={{ marginTop: 12, justifyContent: 'center' }}>
          <button className="btn" type="button" onClick={onRetryLogin}>
            {AUTH_RELOGIN_BUTTON}
          </button>
          <Link to="/help" className="btn secondary">
            查看使用手冊
          </Link>
        </div>
      </StateBlock>
    </div>
  );
}
