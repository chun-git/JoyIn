export interface Bindings {
  DB: D1Database;
  AI: Ai;
  ASSETS?: Fetcher;
  LINE_CHANNEL_ACCESS_TOKEN: string;
  LINE_CHANNEL_SECRET: string;
  LINE_CHANNEL_ID: string;
  LIFF_ID: string;
  LIFF_URL: string;
  /** Public Pages origin — must match LIFF Endpoint URL in LINE Developers */
  LIFF_ENDPOINT_URL: string;
  /** HMAC secret for signed LIFF group context tokens — never log token values */
  LIFF_CONTEXT_SIGNING_SECRET: string;
  ALLOW_TEST_AUTH: string;
  APP_TIMEZONE?: string;
  MENU_AI_MODEL?: string;
  MENU_AI_MONTHLY_FREE_LIMIT?: string;
  MENU_AI_PLATFORM_DAILY_LIMIT?: string;
}

export interface AuthUser {
  lineUserId: string;
  displayName: string;
  pictureUrl?: string;
}

export interface AppVariables {
  user: AuthUser;
  groupId: string;
  requestId?: string;
  preorderMeta?: {
    operation: string;
    offerPresent?: boolean | null;
    orderPresent?: boolean | null;
    idempotencyHit?: boolean | null;
  };
}

export type AppEnv = {
  Bindings: Bindings;
  Variables: AppVariables;
};
