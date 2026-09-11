export interface Bindings {
  DB: D1Database;
  ASSETS?: Fetcher;
  LINE_CHANNEL_ACCESS_TOKEN: string;
  LINE_CHANNEL_SECRET: string;
  LINE_CHANNEL_ID: string;
  LIFF_ID: string;
  LIFF_URL: string;
  ALLOW_TEST_AUTH: string;
  APP_TIMEZONE?: string;
}

export interface AuthUser {
  lineUserId: string;
  displayName: string;
  pictureUrl?: string;
}

export interface AppVariables {
  user: AuthUser;
  groupId: string;
}

export type AppEnv = {
  Bindings: Bindings;
  Variables: AppVariables;
};
