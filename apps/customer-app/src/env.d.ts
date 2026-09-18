/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

import "vue-router";

declare global {
  interface ImportMetaEnv {
    readonly VITE_API_BASE_URL: string;
    readonly VITE_WS_BASE_URL: string;
    readonly VITE_IMAGES_BASE_URL: string;
    readonly VITE_APP_NAME: string;
    readonly VITE_APP_VERSION: string;
    readonly MODE: string;
    readonly DEV: boolean;
    readonly PROD: boolean;
    readonly SSR: boolean;
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }

  interface NetworkInformation extends EventTarget {
    readonly downlink?: number;
    readonly effectiveType?: string;
    readonly rtt?: number;
    readonly saveData?: boolean;
  }

  interface Navigator {
    readonly connection?: NetworkInformation;
    readonly deviceMemory?: number;
  }

  interface PerformanceMemory {
    readonly usedJSHeapSize: number;
    readonly totalJSHeapSize: number;
    readonly jsHeapSizeLimit: number;
  }

  interface Performance {
    readonly memory?: PerformanceMemory;
  }

  interface SyncManager {
    register(tag: string): Promise<void>;
  }

  interface ServiceWorkerRegistration {
    readonly sync?: SyncManager;
  }

  interface MediaTrackConstraintSet {
    torch?: boolean;
  }
}

declare module "vue-router" {
  interface RouteMeta {
    titleKey?: string;
    requiresAuth?: boolean;
    requiresGuest?: boolean;
    allowGuestToken?: boolean;
  }
}

export {};
