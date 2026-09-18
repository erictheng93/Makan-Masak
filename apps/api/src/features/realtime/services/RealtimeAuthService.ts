import { sign, verify } from "jsonwebtoken";
import { drizzle } from "drizzle-orm/d1";
import { eq, and } from "drizzle-orm";
import {
  groupMembers,
  groupOrders,
  orders,
  restaurants,
  seats,
  tables,
} from "@makanmasak/database";
import { parseSignedQRUrl, verifyQRSignature } from "@makanmasak/utils";
import type { Env } from "../../../shared/types";
import type { GuestTokenData } from "../../../middleware/guestAuth";
import { ConsoleLogger } from "../../../core/monitoring";
import type {
  GroupOrderRealtimeTokenRequest,
  GroupOrderRealtimeTokenResponse,
  GuestRealtimeTokenRequest,
  GuestRealtimeTokenResponse,
  RealtimeAuthPayload,
  RealtimeAuthTokenRequest,
  RealtimeAuthTokenResponse,
  RoomType,
} from "@makanmasak/shared-types";
import {
  TokenBlacklistService,
  type RevokeReason,
} from "./TokenBlacklistService";

export interface WebSocketTokenVerification {
  valid: boolean;
  payload?: RealtimeAuthPayload;
  error?: string;
  revoked?: boolean;
}

interface SessionTokenPayload {
  sub: string;
  username: string;
  role: number;
  exp: number;
  iat?: number;
  nbf?: number;
  tv?: number;
  restaurantId?: string | number | null;
}

interface AuthenticatedRealtimeUser {
  id: string;
  publicId?: string;
  username: string;
  role: number;
  restaurantId?: string;
  isActive: boolean;
  tokenVersion: number;
}

const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function isSessionTokenPayload(value: unknown): value is SessionTokenPayload {
  if (!value || typeof value !== "object") return false;

  const payload = value as Record<string, unknown>;
  return (
    typeof payload.sub === "string" &&
    UUID_V7_PATTERN.test(payload.sub) &&
    typeof payload.username === "string" &&
    payload.username.length > 0 &&
    Number.isInteger(payload.role) &&
    typeof payload.exp === "number" &&
    (payload.iat === undefined || typeof payload.iat === "number") &&
    (payload.nbf === undefined || typeof payload.nbf === "number") &&
    (payload.tv === undefined || typeof payload.tv === "number") &&
    (payload.restaurantId === undefined ||
      payload.restaurantId === null ||
      typeof payload.restaurantId === "string" ||
      typeof payload.restaurantId === "number")
  );
}

export class RealtimeAuthService {
  private db;
  private logger: ConsoleLogger;
  private env: Env;
  private realtimeJwtSecret: string;
  private blacklistService: TokenBlacklistService | null = null;

  constructor(env: Env) {
    this.env = env;
    this.db = drizzle(env.DB);
    this.logger = new ConsoleLogger("realtime-auth");
    this.realtimeJwtSecret = this.resolveRealtimeJwtSecret();

    if (!this.realtimeJwtSecret || this.realtimeJwtSecret.length < 32) {
      throw new Error(
        "REALTIME_JWT_SECRET must be set and at least 32 characters",
      );
    }

    const kvNamespace = env.TOKEN_BLACKLIST || env.CACHE_KV;
    if (kvNamespace) {
      this.blacklistService = new TokenBlacklistService(kvNamespace);
    }
  }

  async generateWebSocketToken(
    request: RealtimeAuthTokenRequest,
  ): Promise<RealtimeAuthTokenResponse | { error: string }> {
    try {
      const { roomType, roomId, restaurantId, sessionId } = request;
      let authenticatedUser: AuthenticatedRealtimeUser | null = null;

      switch (roomType) {
        // Customer rooms are NOT mintable here. This endpoint is public, so any
        // authorization it could apply is something an anonymous caller already
        // supplies: a table/seat ID is a guessable sequential integer, not a
        // secret, and `roomId` was never bound to it — so a valid table ID
        // still bought a token for any `customer:*` room (including
        // `customer:{groupOrderId}`, whose events skip restaurant filtering).
        // Customer realtime goes through /auth/guest-token, which proves
        // possession of an HMAC-signed QR or a KV-backed guest token and pins
        // roomId to `order:{orderId}` / `customer:{tableId}`.
        case "customer":
          return {
            error:
              "Customer realtime tokens must be requested from /realtime/auth/guest-token",
          };

        case "kitchen":
        case "admin":
        case "restaurant":
          if (!sessionId) {
            return { error: "Session ID required for this room type" };
          }
          if (roomId !== restaurantId) {
            return { error: "Room ID must match restaurant ID" };
          }
          {
            const sessionValidation = await this.validateSessionAccess(
              sessionId,
              roomType,
              restaurantId,
            );
            if ("error" in sessionValidation) {
              return sessionValidation;
            }
            authenticatedUser = sessionValidation.user;
          }
          break;

        default:
          return { error: "Invalid room type" };
      }

      const issuedAt = Math.floor(Date.now() / 1000);
      const expiresIn = 5 * 60;
      const payload: RealtimeAuthPayload = {
        roomType,
        roomId,
        restaurantId,
        role: this.determineRole(roomType, authenticatedUser?.role),
        ...(authenticatedUser
          ? {
              userId: authenticatedUser.id,
              publicUserId: authenticatedUser.publicId,
              appRole: authenticatedUser.role,
            }
          : {}),
        exp: issuedAt + expiresIn,
        iat: issuedAt,
      };

      const token = sign(payload, this.realtimeJwtSecret);
      const wsUrl = this.buildWebSocketUrl(roomType, roomId, token);

      return {
        token,
        expiresIn,
        wsUrl,
      };
    } catch (error) {
      this.logger.error("Failed to generate WebSocket token", error as Error);
      return { error: "Failed to generate token" };
    }
  }

  async generateGuestToken(
    request: GuestRealtimeTokenRequest,
  ): Promise<GuestRealtimeTokenResponse | { error: string }> {
    try {
      const validated = await this.validateGuestRealtimeRequest(request);
      if ("error" in validated) {
        return validated;
      }

      const issuedAt = Math.floor(Date.now() / 1000);
      const expiresAt = issuedAt + 15 * 60;
      const roomId = validated.orderId
        ? `order:${validated.orderId}`
        : `customer:${validated.table!.id}`;
      const payload: RealtimeAuthPayload = {
        roomType: "customer",
        roomId,
        restaurantId: validated.restaurant.id,
        role: "customer",
        guestFlag: true,
        exp: expiresAt,
        iat: issuedAt,
      };

      if (validated.orderId) {
        payload.scope = "guest-realtime";
        payload.orderId = validated.orderId;
      } else {
        payload.tableId = String(validated.table!.id);
        if (validated.seat) {
          payload.seatId = String(validated.seat.id);
        }
      }

      const token = sign(payload, this.realtimeJwtSecret);
      const wsUrl = this.buildWebSocketUrl("customer", roomId, token);

      return {
        token,
        expiresAt: new Date(expiresAt * 1000).toISOString(),
        wsUrl,
      };
    } catch (error) {
      this.logger.error(
        "Failed to generate guest realtime token",
        error as Error,
      );
      return { error: "Failed to generate guest realtime token" };
    }
  }

  /**
   * Exchange a group order membership credential for a realtime token.
   *
   * The credential is `group_members.session_id`, handed to a member exactly
   * once when they create or join the group. Possession of it is the
   * authorization — the same shape as the signed QR for table guests. The
   * minted token's `roomId` is pinned to the group order UUID, so it cannot be
   * used to reach any other room.
   */
  async generateGroupOrderToken(
    request: GroupOrderRealtimeTokenRequest,
  ): Promise<GroupOrderRealtimeTokenResponse | { error: string }> {
    try {
      const { groupOrderId, memberToken } = request;

      const rows = await this.db
        .select({
          memberId: groupMembers.id,
          memberIsActive: groupMembers.isActive,
          memberLeftAt: groupMembers.leftAt,
          restaurantId: groupOrders.restaurantId,
          status: groupOrders.status,
          expiresAt: groupOrders.expiresAt,
        })
        .from(groupMembers)
        .innerJoin(groupOrders, eq(groupMembers.groupOrderId, groupOrders.id))
        .where(
          and(
            eq(groupMembers.groupOrderId, groupOrderId),
            eq(groupMembers.sessionId, memberToken),
          ),
        )
        .limit(1);

      const membership = rows[0];
      // One message for every rejection below: a caller probing group order IDs
      // must not learn which part was wrong.
      const denied = { error: "Invalid group order membership" };

      if (!membership) return denied;
      if (membership.memberIsActive !== true) return denied;
      if (membership.memberLeftAt !== null) return denied;
      if (membership.status !== "active") return denied;

      const expiresAtMs =
        membership.expiresAt instanceof Date
          ? membership.expiresAt.getTime()
          : Number(membership.expiresAt);
      if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
        return denied;
      }

      const issuedAt = Math.floor(Date.now() / 1000);
      const expiresAt = issuedAt + 15 * 60;
      const payload: RealtimeAuthPayload = {
        roomType: "customer",
        // Bare UUID: this is the room RealtimeBroadcastService fans group
        // events out to (`customer:{groupOrderId}`).
        roomId: groupOrderId,
        restaurantId: membership.restaurantId,
        role: "customer",
        guestFlag: true,
        scope: "group-order-realtime",
        groupOrderId,
        memberId: membership.memberId,
        exp: expiresAt,
        iat: issuedAt,
      };

      const token = sign(payload, this.realtimeJwtSecret);

      return {
        token,
        expiresAt: new Date(expiresAt * 1000).toISOString(),
        wsUrl: this.buildWebSocketUrl("customer", groupOrderId, token),
      };
    } catch (error) {
      this.logger.error(
        "Failed to generate group order realtime token",
        error as Error,
      );
      return { error: "Failed to generate group order realtime token" };
    }
  }

  async verifyWebSocketToken(
    token: string,
  ): Promise<WebSocketTokenVerification> {
    try {
      if (this.blacklistService) {
        const isRevoked = await this.blacklistService.isTokenRevoked(token);
        if (isRevoked) {
          return {
            valid: false,
            error: "Token has been revoked",
            revoked: true,
          };
        }
      }

      const payload = verify(
        token,
        this.realtimeJwtSecret,
      ) as RealtimeAuthPayload;

      if (!payload.roomType || !payload.roomId || !payload.restaurantId) {
        return {
          valid: false,
          error: "Invalid token payload",
        };
      }

      if (payload.guestFlag) {
        const isScopedGuestRealtime =
          payload.scope === "guest-realtime" &&
          payload.roomType === "customer" &&
          payload.role === "customer" &&
          !!payload.orderId &&
          payload.roomId === `order:${payload.orderId}`;

        const isLegacyGuestRealtime =
          !payload.scope &&
          payload.roomType === "customer" &&
          payload.role === "customer" &&
          !!payload.tableId &&
          payload.roomId === `customer:${payload.tableId}`;

        // Group order rooms are addressed by the bare group order UUID, because
        // that is what RealtimeBroadcastService targets (`customer:{id}`).
        const isGroupOrderRealtime =
          payload.scope === "group-order-realtime" &&
          payload.roomType === "customer" &&
          payload.role === "customer" &&
          !!payload.groupOrderId &&
          payload.roomId === payload.groupOrderId;

        if (
          !isScopedGuestRealtime &&
          !isLegacyGuestRealtime &&
          !isGroupOrderRealtime
        ) {
          return {
            valid: false,
            error: "Invalid guest token payload",
          };
        }
      }

      const now = Math.floor(Date.now() / 1000);
      if (payload.exp && payload.exp < now) {
        return {
          valid: false,
          error: "Token expired",
        };
      }

      return {
        valid: true,
        payload,
      };
    } catch (error) {
      this.logger.error("Token verification failed", error as Error);

      if (error instanceof Error) {
        if (error.name === "TokenExpiredError") {
          return { valid: false, error: "Token expired" };
        }
        if (error.name === "JsonWebTokenError") {
          return { valid: false, error: "Invalid token" };
        }
      }

      return {
        valid: false,
        error: "Token verification failed",
      };
    }
  }

  verifyChannelAccess(
    payload: RealtimeAuthPayload,
    channel: string,
  ): { allowed: boolean; error?: string } {
    if (payload.scope === "group-order-realtime") {
      if (!payload.groupOrderId) {
        return { allowed: false, error: "Invalid group order token payload" };
      }
      if (channel !== payload.groupOrderId) {
        return { allowed: false, error: "Token is not scoped to this channel" };
      }
      return { allowed: true };
    }

    if (payload.scope !== "guest-realtime") {
      return { allowed: true };
    }

    if (!payload.orderId) {
      return { allowed: false, error: "Invalid guest token payload" };
    }

    const expectedChannel = `order:${payload.orderId}`;
    if (channel !== expectedChannel) {
      return { allowed: false, error: "Token is not scoped to this channel" };
    }

    return { allowed: true };
  }

  async revokeToken(
    token: string,
    reason: RevokeReason,
    revokedBy?: string,
  ): Promise<{ success: boolean; error?: string }> {
    if (!this.blacklistService) {
      return {
        success: false,
        error: "Token blacklist service not available",
      };
    }

    try {
      await this.blacklistService.revokeToken(token, reason, {
        revokedBy,
      });
      return { success: true };
    } catch (error) {
      this.logger.error("Failed to revoke token", error as Error);
      return {
        success: false,
        error: "Failed to revoke token",
      };
    }
  }

  async revokeUserTokens(
    userId: string,
    reason: RevokeReason,
    revokedBy?: string,
  ): Promise<{ success: boolean; count?: number; error?: string }> {
    if (!this.blacklistService) {
      return {
        success: false,
        error: "Token blacklist service not available",
      };
    }

    try {
      const result = await this.blacklistService.revokeUserTokens(
        userId,
        reason,
        revokedBy,
      );
      return { success: true, count: result.count };
    } catch (error) {
      this.logger.error("Failed to revoke user tokens", error as Error);
      return {
        success: false,
        error: "Failed to revoke user tokens",
      };
    }
  }

  async isTokenRevoked(token: string): Promise<boolean> {
    if (!this.blacklistService) {
      return false;
    }

    return this.blacklistService.isTokenRevoked(token);
  }

  async getBlacklistStats(): Promise<{
    available: boolean;
    estimatedCount?: number;
    sampleRecords?: unknown[];
  }> {
    if (!this.blacklistService) {
      return { available: false };
    }

    const stats = await this.blacklistService.getStats();
    return {
      available: true,
      ...stats,
    };
  }

  /**
   * The realtime role is a projection of the caller's app role, never of the
   * room they asked for. Stamping "admin" for every admin/restaurant room let
   * the room hand out a privilege the caller did not hold: the DO reads this
   * claim to decide who receives unclassified event types
   * (`shouldSendEventToConnection`'s default arm). canAccessRoomType is the
   * only thing that decides who may enter; this only says what they are.
   */
  private determineRole(
    roomType: RoomType,
    appRole?: number | string,
  ): "customer" | "staff" | "admin" {
    if (roomType === "customer") {
      return "customer";
    }
    // Only a real numeric role earns "admin". Coercing a string would promote
    // "" and null to 0, which is the platform-admin code.
    if (typeof appRole === "number" && appRole >= 0 && appRole <= 1) {
      return "admin";
    }
    return "staff";
  }

  private async validateSessionAccess(
    sessionId: string,
    roomType: RoomType,
    restaurantId: string,
  ): Promise<{ user: AuthenticatedRealtimeUser } | { error: string }> {
    if (!this.env.JWT_SECRET || this.env.JWT_SECRET.length < 32) {
      return { error: "JWT_SECRET is not configured" };
    }

    if (this.env.TOKEN_BLACKLIST) {
      const blacklisted = await this.env.TOKEN_BLACKLIST.get(
        `token:${sessionId}`,
      );
      if (blacklisted) {
        return { error: "Session token has been invalidated" };
      }
    }

    let decoded: unknown;
    try {
      decoded = verify(sessionId, this.env.JWT_SECRET);
    } catch (error) {
      if (error instanceof Error && error.name === "TokenExpiredError") {
        return { error: "Session token expired" };
      }
      if (error instanceof Error && error.name === "NotBeforeError") {
        return { error: "Session token not yet valid" };
      }

      this.logger.warn("Realtime session token verification failed", {
        roomType,
        restaurantId,
        error: error instanceof Error ? error.message : String(error),
      });
      return { error: "Invalid session token" };
    }

    if (!isSessionTokenPayload(decoded)) {
      return { error: "Invalid session token claims" };
    }

    const now = Math.floor(Date.now() / 1000);
    if (decoded.exp <= now) {
      return { error: "Session token expired" };
    }
    if (decoded.iat && decoded.iat > now + 60) {
      return { error: "Session token issued in future" };
    }
    if (decoded.nbf && decoded.nbf > now + 60) {
      return { error: "Session token not yet valid" };
    }
    if (decoded.role < 0 || decoded.role > 4) {
      return { error: "Session role is not allowed for realtime rooms" };
    }

    if (!this.canAccessRoomType(decoded.role, roomType)) {
      return { error: "Session role cannot access this realtime room" };
    }

    const loadedUser = await this.loadSessionUser(decoded);
    if ("error" in loadedUser) {
      return loadedUser;
    }

    const user = loadedUser.user;
    if (!user.isActive) {
      return { error: "User not found or inactive" };
    }

    const tokenVersion = typeof decoded.tv === "number" ? decoded.tv : 1;
    if (user.tokenVersion !== tokenVersion) {
      return { error: "Session token has been invalidated" };
    }
    if (user.username !== decoded.username || user.role !== decoded.role) {
      return { error: "Invalid session token claims" };
    }

    if (!this.canAccessRestaurant(user, restaurantId)) {
      return { error: "User does not have access to this restaurant" };
    }

    return { user };
  }

  /**
   * The `admin` room used to fall through to "any staff role", which let a
   * chef or cashier mint a token for it. That room carries data the kitchen
   * room deliberately does not — WaitingListService broadcasts `customerName`
   * to `admin:{rid}` — so it is owner/platform only, same as `restaurant`.
   * `kitchen` stays the one staff-wide room. Anything outside the union is
   * denied rather than defaulted, because the route reads roomType off the
   * request body.
   */
  private canAccessRoomType(role: number, roomType: RoomType): boolean {
    if (roomType === "customer") return role === 5;
    if (roomType === "restaurant" || roomType === "admin") {
      return role === 0 || role === 1;
    }
    if (roomType === "kitchen") return role >= 0 && role <= 4;
    return false;
  }

  private canAccessRestaurant(
    user: AuthenticatedRealtimeUser,
    restaurantId: string,
  ): boolean {
    if (user.role === 0) {
      return true;
    }

    return !!user.restaurantId && user.restaurantId === restaurantId;
  }

  private async loadSessionUser(
    payload: SessionTokenPayload,
  ): Promise<{ user: AuthenticatedRealtimeUser } | { error: string }> {
    const fromToken = (): AuthenticatedRealtimeUser => ({
      id: payload.sub,
      publicId: payload.sub,
      username: payload.username,
      role: payload.role,
      restaurantId:
        payload.restaurantId == null ? undefined : String(payload.restaurantId),
      isActive: true,
      tokenVersion: typeof payload.tv === "number" ? payload.tv : 1,
    });
    const canFallbackToToken = () => this.allowTokenOnlySessionValidation();

    if (!this.env.DB || typeof this.env.DB.prepare !== "function") {
      if (canFallbackToToken()) {
        return { user: fromToken() };
      }
      return { error: "User lookup unavailable" };
    }

    try {
      const row = await this.env.DB.prepare(
        `SELECT id, username, role, restaurant_id, is_active, token_version
           FROM users
          WHERE id = ?
          LIMIT 1`,
      )
        .bind(payload.sub)
        .first<{
          id: string;
          username: string;
          role: number;
          restaurant_id: string | null;
          is_active: number | boolean;
          token_version: number | null;
        }>();

      if (!row) {
        if (canFallbackToToken()) {
          return { user: fromToken() };
        }
        return { error: "User not found or inactive" };
      }

      return {
        user: {
          id: String(row.id),
          publicId: String(row.id),
          username: String(row.username),
          role: Number(row.role),
          restaurantId: row.restaurant_id ?? undefined,
          isActive: row.is_active === true || Number(row.is_active) === 1,
          tokenVersion: Number(row.token_version ?? 1),
        },
      };
    } catch (error) {
      this.logger.error("Failed to load session user", error as Error);
      if (canFallbackToToken()) {
        return { user: fromToken() };
      }
      return { error: "Failed to validate session user" };
    }
  }

  private allowTokenOnlySessionValidation(): boolean {
    return this.env.NODE_ENV === "test" || this.env.NODE_ENV === "development";
  }

  private buildWebSocketUrl(
    roomType: RoomType,
    roomId: string,
    token: string,
  ): string {
    const baseUrl =
      this.env.REALTIME_WS_URL || "wss://realtime.makanmakan.workers.dev";
    return `${baseUrl}/${roomType}/${roomId}?token=${token}`;
  }

  private resolveRealtimeJwtSecret(): string {
    return this.env.REALTIME_JWT_SECRET || this.env.JWT_SECRET || "";
  }

  private async validateGuestRealtimeRequest(
    request: GuestRealtimeTokenRequest,
  ): Promise<
    | {
        restaurant: { id: string };
        table?: { id: number; restaurantId: string; number: string };
        seat?: { id: number; tableId: number; number: string };
        orderId?: string;
      }
    | { error: string }
  > {
    if (request.guestToken) {
      const tokenData = (await this.env.CACHE_KV.get(
        `guest_token:${request.guestToken}`,
        "json",
      )) as GuestTokenData | null;

      if (!tokenData) {
        return { error: "Guest token expired or invalid" };
      }

      if (
        tokenData.orderId !== request.orderId ||
        tokenData.restaurantId !== request.restaurantId
      ) {
        return { error: "Guest token does not match this order" };
      }

      const orderRows = await this.db
        .select({
          id: orders.id,
          restaurantId: orders.restaurantId,
        })
        .from(orders)
        .where(
          and(
            eq(orders.id, tokenData.orderId),
            eq(orders.restaurantId, tokenData.restaurantId),
          ),
        )
        .limit(1);

      if (!orderRows[0]) {
        return { error: "Guest token does not match this order" };
      }

      return {
        restaurant: { id: tokenData.restaurantId },
        orderId: tokenData.orderId,
      };
    }

    if (!request.qrCode) {
      return { error: "A guest token or signed table QR code is required" };
    }

    const qrPayload = parseSignedQRUrl(request.qrCode);
    if (!qrPayload) {
      return { error: "A valid signed table QR code is required" };
    }
    if (qrPayload.type === "table" && !request.tableId) {
      return { error: "A table ID is required for a table QR code" };
    }
    if (qrPayload.type === "seat" && !request.seatId) {
      return { error: "A seat ID is required for a seat QR code" };
    }

    const signingKey = this.env.QR_SIGNING_KEY;
    if (!signingKey || signingKey.length < 32) {
      return {
        error: "QR_SIGNING_KEY must be set and at least 32 characters",
      };
    }

    const signingParams = {
      type: qrPayload.type,
      restaurantId: qrPayload.restaurantId,
      tableId: qrPayload.tableId,
      identifier: qrPayload.identifier,
      version: qrPayload.version,
    };
    const qrValid = await verifyQRSignature(
      signingParams,
      qrPayload.signature,
      signingKey,
    );

    if (!qrValid) {
      return { error: "Invalid QR signature" };
    }

    if (qrPayload.restaurantId !== request.restaurantId) {
      return { error: "QR code does not match restaurant" };
    }

    const restaurantRows = await this.db
      .select({
        id: restaurants.id,
        settings: restaurants.settings,
        isActive: restaurants.isActive,
        isAvailable: restaurants.isAvailable,
      })
      .from(restaurants)
      .where(eq(restaurants.id, request.restaurantId))
      .limit(1);
    const restaurant = restaurantRows[0];

    if (!restaurant || restaurant.isActive !== true) {
      return { error: "Restaurant not found" };
    }

    const settings =
      (restaurant.settings as Record<string, unknown> | null) ?? {};
    if (restaurant.isAvailable !== true || settings.allowGuestOrders !== true) {
      return { error: "Guest realtime is not enabled for this restaurant" };
    }

    let seat:
      | {
          id: number;
          tableId: number;
          number: string;
        }
      | undefined;
    let resolvedTableId = request.tableId ? Number(request.tableId) : undefined;

    if (qrPayload.type === "seat") {
      const seatRows = await this.db
        .select({
          id: seats.id,
          tableId: seats.tableId,
          seatNumber: seats.seatNumber,
          qrCode: seats.qrCode,
          qrCodeVersion: seats.qrCodeVersion,
          isActive: seats.isActive,
          deletedAt: seats.deletedAt,
        })
        .from(seats)
        .where(eq(seats.id, Number(request.seatId)))
        .limit(1);
      const seatRow = seatRows[0];

      if (!seatRow || seatRow.isActive !== true || seatRow.deletedAt !== null) {
        return { error: "Seat not found or inactive" };
      }
      if (seatRow.seatNumber !== qrPayload.identifier) {
        return { error: "QR code does not match seat" };
      }
      if (seatRow.qrCodeVersion !== qrPayload.version) {
        return { error: "QR code version is no longer current" };
      }
      if (qrPayload.tableId !== seatRow.tableId) {
        return { error: "QR code does not match table" };
      }

      resolvedTableId = seatRow.tableId;
      seat = {
        id: seatRow.id,
        tableId: seatRow.tableId,
        number: seatRow.seatNumber,
      };
    }

    const tableRows = await this.db
      .select({
        id: tables.id,
        restaurantId: tables.restaurantId,
        number: tables.number,
        qrCode: tables.qrCode,
        qrCodeVersion: tables.qrCodeVersion,
        isActive: tables.isActive,
        deletedAt: tables.deletedAt,
      })
      .from(tables)
      .where(
        and(
          eq(tables.id, Number(resolvedTableId)),
          eq(tables.restaurantId, request.restaurantId),
        ),
      )
      .limit(1);
    const table = tableRows[0];

    if (!table || table.isActive !== true || table.deletedAt !== null) {
      return { error: "Table not found or inactive" };
    }

    if (qrPayload.type === "table") {
      if (table.number !== qrPayload.identifier) {
        return { error: "QR code does not match table" };
      }
      if (table.qrCodeVersion !== qrPayload.version) {
        return { error: "QR code version is no longer current" };
      }
      if (qrPayload.tableId !== table.id) {
        return { error: "QR code does not match table" };
      }
    }

    if (request.orderId) {
      const orderRows = await this.db
        .select({
          id: orders.id,
          restaurantId: orders.restaurantId,
          tableId: orders.tableId,
        })
        .from(orders)
        .where(
          and(
            eq(orders.restaurantId, request.restaurantId),
            eq(orders.id, request.orderId),
          ),
        )
        .limit(1);
      const order = orderRows[0];

      if (
        !order ||
        order.restaurantId !== request.restaurantId ||
        String(order.tableId) !== String(table.id)
      ) {
        return { error: "Order does not belong to this table" };
      }
    }

    return {
      restaurant: { id: restaurant.id },
      table: {
        id: table.id,
        restaurantId: table.restaurantId,
        number: table.number,
      },
      seat,
      orderId: request.orderId,
    };
  }
}
