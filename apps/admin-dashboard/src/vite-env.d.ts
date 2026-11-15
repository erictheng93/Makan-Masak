/// <reference types="vite/client" />

declare module "*.vue" {
  import type { DefineComponent } from "vue";

  const component: DefineComponent<
    Record<string, unknown>,
    Record<string, unknown>,
    unknown
  >;
  export default component;
}

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  readonly VITE_API_URL: string;
  readonly VITE_IMAGE_API_URL: string;
  readonly VITE_APP_TITLE: string;
  readonly VITE_APP_VERSION: string;
  readonly VITE_REALTIME_WS_URL: string;
  readonly VITE_REALTIME_HTTP_URL?: string;
  readonly VITE_REALTIME_URL?: string;
  readonly VITE_RESTAURANT_ID: string;
  readonly VITE_KITCHEN_DISPLAY_URL?: string;
  readonly VITE_ONBOARDING_URL?: string;
  readonly VITE_CUSTOMER_APP_URL?: string;
  readonly MODE: string;
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly SSR: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const __APP_VERSION__: string;
