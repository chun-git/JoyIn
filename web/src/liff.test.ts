import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JOYIN_CONTEXT_STORAGE_KEY } from './liff-context';
import {
  assertEndpointRedirectUri,
  initLiffSingleton,
  initSession,
  JOYIN_LOGIN_ATTEMPTED_KEY,
  LiffBootError,
  resetLiffBootStateForTests,
  retryInitSession,
  startManualLineLogin,
  withTimeout,
  type LiffLike,
} from './liff';

const VALID_JWT_A = `${'a'.repeat(12)}.${'b'.repeat(12)}.${'c'.repeat(12)}`;
const VALID_JWT_B = `${'d'.repeat(12)}.${'e'.repeat(12)}.${'f'.repeat(12)}`;
const CONTEXT = `${'g'.repeat(40)}.${'h'.repeat(40)}`;

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    key: (index: number) => [...map.keys()][index] ?? null,
  } as Storage;
}

function mockLiff(overrides: Partial<LiffLike> & { initImpl?: () => Promise<void> } = {}): LiffLike & {
  init: ReturnType<typeof vi.fn>;
  login: ReturnType<typeof vi.fn>;
} {
  const init = vi.fn(async () => {
    if (overrides.initImpl) await overrides.initImpl();
  });
  const login = vi.fn();
  return {
    init,
    login,
    isLoggedIn: overrides.isLoggedIn ?? (() => true),
    isInClient: overrides.isInClient ?? (() => false),
    getIDToken: overrides.getIDToken ?? (() => VALID_JWT_A),
    getProfile:
      overrides.getProfile ??
      (async () => ({ userId: 'U-alice', displayName: 'Alice' })),
    getOS: overrides.getOS ?? (() => 'android'),
    getVersion: overrides.getVersion ?? (() => '2.27.2'),
  };
}

describe('withTimeout', () => {
  it('resolves when the promise settles in time', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 100)).resolves.toBe('ok');
  });

  it('rejects with init_timeout when the promise hangs', async () => {
    const hung = new Promise<string>(() => undefined);
    await expect(withTimeout(hung, 30)).rejects.toMatchObject({
      code: 'init_timeout',
      name: 'LiffBootError',
    });
  });
});

describe('initLiffSingleton', () => {
  beforeEach(() => {
    resetLiffBootStateForTests();
  });

  it('calls liff.init only once across repeated callers', async () => {
    const liff = mockLiff();
    await Promise.all([
      initLiffSingleton(liff, 'liff-id', { timeoutMs: 500 }),
      initLiffSingleton(liff, 'liff-id', { timeoutMs: 500 }),
      initLiffSingleton(liff, 'liff-id', { timeoutMs: 500 }),
    ]);
    expect(liff.init).toHaveBeenCalledTimes(1);
  });

  it('times out hanging init so callers are not stuck forever', async () => {
    const liff = mockLiff({
      initImpl: () => new Promise(() => undefined),
    });
    await expect(initLiffSingleton(liff, 'liff-id', { timeoutMs: 40 })).rejects.toMatchObject({
      code: 'init_timeout',
    });
  });

  it('clears cached init promise on timeout so retry can call liff.init again', async () => {
    let resolveInit: (() => void) | undefined;
    const liff = mockLiff({
      initImpl: () =>
        new Promise<void>((resolve) => {
          resolveInit = resolve;
        }),
    });
    await expect(initLiffSingleton(liff, 'liff-id', { timeoutMs: 40 })).rejects.toMatchObject({
      code: 'init_timeout',
    });
    expect(liff.init).toHaveBeenCalledTimes(1);

    // Late resolve of the old init must not mark success for a new attempt.
    resolveInit?.();
    await Promise.resolve();

    const liff2 = mockLiff();
    await initLiffSingleton(liff2, 'liff-id', { timeoutMs: 500 });
    expect(liff2.init).toHaveBeenCalledTimes(1);
  });
});

describe('initSession boot flow', () => {
  let storage: Storage;

  beforeEach(() => {
    resetLiffBootStateForTests();
    storage = memoryStorage();
  });

  afterEach(() => {
    resetLiffBootStateForTests();
  });

  it('resolves to ready and leaves loading-equivalent phase ready', async () => {
    const phases: string[] = [];
    const liff = mockLiff();
    const result = await initSession({
      allowDev: false,
      liff,
      liffId: 'liff-id',
      endpointOrigin: 'https://joyin-web.pages.dev',
      storage,
      locationSearch: `?context=${CONTEXT}`,
      onPhase: (phase) => phases.push(phase),
    });
    expect(result.status).toBe('ready');
    expect(result.phase).toBe('ready');
    expect(result.session?.idToken).toBe(VALID_JWT_A);
    expect(result.session?.contextToken).toBe(CONTEXT);
    expect(phases).toContain('preserving_context');
    expect(phases).toContain('initializing_liff');
    expect(phases).toContain('retrieving_id_token');
    expect(phases).toContain('ready');
    expect(phases).not.toContain('failed');
  });

  it('returns failed (not hang) when init rejects', async () => {
    const liff = mockLiff({
      initImpl: async () => {
        throw new Error('network down');
      },
    });
    const result = await initSession({
      allowDev: false,
      liff,
      liffId: 'liff-id',
      endpointOrigin: 'https://joyin-web.pages.dev',
      storage,
    });
    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('init_error');
    expect(result.canRetryLogin).toBe(true);
  });

  it('returns failed on init timeout so UI can leave loading', async () => {
    const liff = mockLiff({
      initImpl: () => new Promise(() => undefined),
    });
    const result = await initSession({
      allowDev: false,
      liff,
      liffId: 'liff-id',
      endpointOrigin: 'https://joyin-web.pages.dev',
      storage,
      initTimeoutMs: 40,
    });
    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('init_timeout');
  });

  it('reuses one init across StrictMode-style double initSession', async () => {
    const liff = mockLiff();
    const deps = {
      allowDev: false as const,
      liff,
      liffId: 'liff-id',
      endpointOrigin: 'https://joyin-web.pages.dev',
      storage,
      locationSearch: `?context=${CONTEXT}`,
    };
    const [a, b] = await Promise.all([initSession(deps), initSession(deps)]);
    expect(a.status).toBe('ready');
    expect(b.status).toBe('ready');
    expect(liff.init).toHaveBeenCalledTimes(1);
  });

  it('auto-calls liff.login at most once per browser session', async () => {
    const liff = mockLiff({
      isLoggedIn: () => false,
      isInClient: () => false,
    });
    const first = await initSession({
      allowDev: false,
      liff,
      liffId: 'liff-id',
      endpointOrigin: 'https://joyin-web.pages.dev',
      storage,
      locationSearch: `?context=${CONTEXT}`,
    });
    expect(first.status).toBe('redirecting');
    expect(first.phase).toBe('redirecting_login');
    expect(liff.login).toHaveBeenCalledTimes(1);
    expect(liff.login.mock.calls[0][0].redirectUri).toBe('https://joyin-web.pages.dev/');
    expect(storage.getItem(JOYIN_LOGIN_ATTEMPTED_KEY)).toBe('1');

    // Simulate OAuth return still not logged in — must NOT auto login again
    resetLiffBootStateForTests();
    const second = await initSession({
      allowDev: false,
      liff,
      liffId: 'liff-id',
      endpointOrigin: 'https://joyin-web.pages.dev',
      storage,
      locationSearch: '',
    });
    expect(second.status).toBe('failed');
    expect(second.phase).toBe('login_required');
    expect(second.canRetryLogin).toBe(true);
    expect(liff.login).toHaveBeenCalledTimes(1);
  });

  it('manual relogin clears the one-shot flag and calls login again', async () => {
    storage.setItem(JOYIN_LOGIN_ATTEMPTED_KEY, '1');
    storage.setItem(JOYIN_CONTEXT_STORAGE_KEY, CONTEXT);
    const liff = mockLiff({
      isLoggedIn: () => false,
      isInClient: () => false,
    });
    const result = await startManualLineLogin({
      allowDev: false,
      liff,
      liffId: 'liff-id',
      endpointOrigin: 'https://joyin-web.pages.dev',
      storage,
    });
    expect(result.status).toBe('redirecting');
    expect(liff.login).toHaveBeenCalledTimes(1);
    // Group context must survive manual login retry.
    expect(storage.getItem(JOYIN_CONTEXT_STORAGE_KEY)).toBe(CONTEXT);
  });

  it('retry after init timeout can call liff.init again and keeps group context', async () => {
    storage.setItem(JOYIN_CONTEXT_STORAGE_KEY, CONTEXT);
    const hanging = mockLiff({
      initImpl: () => new Promise(() => undefined),
    });
    const failed = await initSession({
      allowDev: false,
      liff: hanging,
      liffId: 'liff-id',
      endpointOrigin: 'https://joyin-web.pages.dev',
      storage,
      initTimeoutMs: 40,
    });
    expect(failed.status).toBe('failed');
    expect(failed.error?.code).toBe('init_timeout');

    const ok = mockLiff();
    const recovered = await retryInitSession({
      allowDev: false,
      liff: ok,
      liffId: 'liff-id',
      endpointOrigin: 'https://joyin-web.pages.dev',
      storage,
    });
    expect(recovered.status).toBe('ready');
    expect(ok.init).toHaveBeenCalledTimes(1);
    expect(recovered.session?.contextToken).toBe(CONTEXT);
    expect(storage.getItem(JOYIN_CONTEXT_STORAGE_KEY)).toBe(CONTEXT);
  });

  it('fails immediately when ID Token is null or not a JWT', async () => {
    const liff = mockLiff({
      getIDToken: () => null,
    });
    const result = await initSession({
      allowDev: false,
      liff,
      liffId: 'liff-id',
      endpointOrigin: 'https://joyin-web.pages.dev',
      storage,
      locationSearch: `?context=${CONTEXT}`,
    });
    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('auth_token_invalid');
  });

  it('lets A and B share context with different ID Tokens', async () => {
    storage.setItem(JOYIN_CONTEXT_STORAGE_KEY, CONTEXT);

    const liffA = mockLiff({
      getIDToken: () => VALID_JWT_A,
      getProfile: async () => ({ userId: 'U-alice', displayName: 'Alice' }),
    });
    const resultA = await initSession({
      allowDev: false,
      liff: liffA,
      liffId: 'liff-id',
      endpointOrigin: 'https://joyin-web.pages.dev',
      storage,
      locationSearch: '',
    });
    expect(resultA.status).toBe('ready');
    expect(resultA.session?.idToken).toBe(VALID_JWT_A);
    expect(resultA.session?.contextToken).toBe(CONTEXT);
    expect(resultA.session?.lineUserId).toBe('U-alice');

    resetLiffBootStateForTests();
    const liffB = mockLiff({
      getIDToken: () => VALID_JWT_B,
      getProfile: async () => ({ userId: 'U-bob', displayName: 'Bob' }),
    });
    const resultB = await initSession({
      allowDev: false,
      liff: liffB,
      liffId: 'liff-id',
      endpointOrigin: 'https://joyin-web.pages.dev',
      storage,
      locationSearch: '',
    });
    expect(resultB.status).toBe('ready');
    expect(resultB.session?.idToken).toBe(VALID_JWT_B);
    expect(resultB.session?.idToken).not.toBe(resultA.session?.idToken);
    expect(resultB.session?.contextToken).toBe(CONTEXT);
    expect(resultB.session?.lineUserId).toBe('U-bob');

    // ID Token must not be written to sessionStorage
    expect(storage.getItem('idToken')).toBeNull();
    expect(storage.getItem('Authorization')).toBeNull();
    expect(storage.getItem(JOYIN_CONTEXT_STORAGE_KEY)).toBe(CONTEXT);
  });

  it('retryInitSession recovers after a failed boot', async () => {
    const failing = mockLiff({
      initImpl: async () => {
        throw new Error('boom');
      },
    });
    const failed = await initSession({
      allowDev: false,
      liff: failing,
      liffId: 'liff-id',
      endpointOrigin: 'https://joyin-web.pages.dev',
      storage,
    });
    expect(failed.status).toBe('failed');

    const ok = mockLiff();
    const recovered = await retryInitSession({
      allowDev: false,
      liff: ok,
      liffId: 'liff-id',
      endpointOrigin: 'https://joyin-web.pages.dev',
      storage,
      locationSearch: `?context=${CONTEXT}`,
    });
    expect(recovered.status).toBe('ready');
  });
});

describe('assertEndpointRedirectUri', () => {
  it('requires joyin-web.pages.dev origin', () => {
    expect(assertEndpointRedirectUri('https://joyin-web.pages.dev/', 'https://joyin-web.pages.dev')).toBe(
      'https://joyin-web.pages.dev/',
    );
    expect(() => assertEndpointRedirectUri('https://evil.example/', 'https://joyin-web.pages.dev')).toThrow(
      LiffBootError,
    );
  });
});
