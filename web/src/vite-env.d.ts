/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_LIFF_ID: string;
  readonly VITE_API_BASE_URL: string;
  readonly VITE_DEV_AUTH: string;
  readonly VITE_DEV_USER_ID: string;
  readonly VITE_DEV_DISPLAY_NAME: string;
  readonly VITE_DEV_GROUP_ID: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
