/**
 * JWT 驗證工具
 * 用於驗證 WebSocket 連線的 JWT token
 *
 * 功能:
 * - JWT 簽名驗證
 * - Token 過期檢查
 * - Token 黑名單檢查（使用 KV 存儲）
 */

import { verify } from "jsonwebtoken";
import type { RealtimeAuthPayload } from "@makanmasak/shared-types";

// KV key 前綴（與 TokenBlacklistService 保持一致）
const TOKEN_BLACKLIST_PREFIX = "token:revoked:";

export interface TokenVerificationResult {
  valid: boolean;
  payload?: RealtimeAuthPayload;
  error?: string;
  revoked?: boolean;
}

/**
 * 生成 token 的唯一標識（與 TokenBlacklistService 保持一致）
 */
function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function generateTokenId(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return `sha256:${base64UrlEncode(new Uint8Array(digest))}`;
}

/**
 * 檢查 token 是否在黑名單中
 */
export async function isTokenRevoked(
  token: string,
  kv: KVNamespace | undefined,
): Promise<boolean> {
  if (!kv) {
    return false; // 如果沒有 KV，假設 token 未被撤銷
  }

  try {
    const tokenId = await generateTokenId(token);
    const key = `${TOKEN_BLACKLIST_PREFIX}${tokenId}`;
    const record = await kv.get(key);
    return record !== null;
  } catch (error) {
    console.error("Failed to check token blacklist:", error);
    // 在錯誤情況下，為了安全起見，返回 true（視為已撤銷）
    return true;
  }
}

/**
 * 驗證 JWT token（包含黑名單檢查）
 */
export async function verifyWebSocketToken(
  token: string,
  jwtSecret: string,
  kv?: KVNamespace,
): Promise<TokenVerificationResult> {
  try {
    if (!token) {
      return {
        valid: false,
        error: "Token is required",
      };
    }

    if (!jwtSecret || jwtSecret.length < 32) {
      console.error("JWT_SECRET is not properly configured");
      return {
        valid: false,
        error: "Server configuration error",
      };
    }

    // 🔒 首先檢查 token 是否在黑名單中
    if (kv) {
      const revoked = await isTokenRevoked(token, kv);
      if (revoked) {
        console.warn("WebSocket token has been revoked");
        return {
          valid: false,
          error: "Token has been revoked",
          revoked: true,
        };
      }
    }

    // 驗證 JWT token
    const payload = verify(token, jwtSecret, {
      algorithms: ["HS256"],
    }) as RealtimeAuthPayload;

    // 檢查必要欄位
    if (!payload.roomType || !payload.roomId || !payload.restaurantId) {
      return {
        valid: false,
        error: "Invalid token payload: missing required fields",
      };
    }

    if (payload.guestFlag) {
      const isScopedOrderGuest =
        payload.scope === "guest-realtime" &&
        !!payload.orderId &&
        payload.roomId === `order:${payload.orderId}`;
      const isLegacyTableGuest =
        !payload.scope &&
        !!payload.tableId &&
        payload.roomId === `customer:${payload.tableId}`;
      // Group order rooms are addressed by the bare group order UUID — that is
      // the room RealtimeBroadcastService fans group events out to.
      const isGroupOrderGuest =
        payload.scope === "group-order-realtime" &&
        !!payload.groupOrderId &&
        payload.roomId === payload.groupOrderId;

      if (
        payload.roomType !== "customer" ||
        payload.role !== "customer" ||
        (!isScopedOrderGuest && !isLegacyTableGuest && !isGroupOrderGuest)
      ) {
        return {
          valid: false,
          error: "Invalid guest token payload",
        };
      }
    }

    // 檢查 token 是否過期（verify 已經會檢查，但我們再加一層保險）
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      return {
        valid: false,
        error: "Token has expired",
      };
    }

    return {
      valid: true,
      payload,
    };
  } catch (error) {
    console.error("Token verification error:", error);

    if (error instanceof Error) {
      if (error.name === "TokenExpiredError") {
        return { valid: false, error: "Token has expired" };
      }
      if (error.name === "JsonWebTokenError") {
        return { valid: false, error: "Invalid token format" };
      }
      if (error.name === "NotBeforeError") {
        return { valid: false, error: "Token not yet valid" };
      }
    }

    return {
      valid: false,
      error: "Token verification failed",
    };
  }
}

/**
 * Whether a verified token addresses `roomId`. Legacy table guests carry
 * `customer:{tableId}` while the URL names the bare table id.
 */
export function tokenRoomIdMatches(
  payload: RealtimeAuthPayload,
  roomId: string,
): boolean {
  if (payload.roomId === roomId) return true;
  return (
    !!payload.guestFlag &&
    !payload.scope &&
    payload.roomId === `customer:${roomId}`
  );
}

/**
 * 從 URL 查詢參數中提取 token
 */
export function extractTokenFromUrl(url: URL): string | null {
  return url.searchParams.get("token");
}
