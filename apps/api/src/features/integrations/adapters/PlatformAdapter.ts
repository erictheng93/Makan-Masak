import type {
  PlatformType,
  PlatformCredentials,
  ParsedPlatformOrder,
  MenuSyncPayload,
  MenuSyncResult,
} from "@makanmasak/shared-types";
import { UberEatsAdapter } from "./UberEatsAdapter";

export interface PlatformAdapter {
  readonly platform: PlatformType;
  verifyWebhook(request: Request, secret: string): Promise<boolean>;
  refreshToken(credentials: PlatformCredentials): Promise<PlatformCredentials>;
  parseOrder(payload: unknown): Promise<ParsedPlatformOrder>;
  fetchOrder?(
    platformOrderId: string,
    creds: PlatformCredentials,
  ): Promise<unknown>;
  parseCancellation(
    payload: unknown,
  ): Promise<{ platformOrderId: string; reason?: string }>;
  acceptOrder(
    platformOrderId: string,
    creds: PlatformCredentials,
  ): Promise<void>;
  denyOrder(
    platformOrderId: string,
    reason: string,
    creds: PlatformCredentials,
  ): Promise<void>;
  cancelOrder(
    platformOrderId: string,
    reason: string,
    creds: PlatformCredentials,
  ): Promise<void>;
  syncMenu(
    menuData: MenuSyncPayload,
    creds: PlatformCredentials,
  ): Promise<MenuSyncResult>;
}

export const SUPPORTED_PLATFORM_ADAPTERS: readonly PlatformType[] = [
  "uber_eats",
];

const adapters: Partial<Record<PlatformType, () => PlatformAdapter>> = {
  uber_eats: () => new UberEatsAdapter(),
};

export function isPlatformAdapterSupported(platform: PlatformType): boolean {
  return platform in adapters;
}

export function getAdapter(platform: PlatformType): PlatformAdapter {
  const factory = adapters[platform];
  if (!factory) throw new Error(`Platform adapter is not enabled: ${platform}`);
  return factory();
}
