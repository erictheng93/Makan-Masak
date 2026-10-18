import { drizzle } from "drizzle-orm/d1";
import { and, eq } from "drizzle-orm";
import { seats, tables } from "@makanmasak/database";
import {
  parseSignedQRUrl,
  verifyQRSignature,
  type SignedQRUrlParams,
} from "@makanmasak/utils";
import type { Env } from "../../../shared/types";

export type SignedQrVerificationFailureReason =
  | "malformed"
  | "wrong_type"
  | "signature_invalid"
  | "not_found"
  | "inactive"
  | "stale"
  | "mismatch";

type VerificationFailure = {
  valid: false;
  reason: SignedQrVerificationFailureReason;
};

type ParsedSignedQr =
  | { valid: true; payload: SignedQRUrlParams }
  | VerificationFailure;

export type TableQrVerification =
  | VerificationFailure
  | {
      valid: true;
      type: "table";
      restaurantId: string;
      tableId: number;
      tableNumber: string;
      formatVersion: 2;
    };

export type SeatQrVerification =
  | VerificationFailure
  | {
      valid: true;
      type: "seat";
      restaurantId: string;
      tableId: number;
      tableNumber: string;
      seatId: number;
      seatNumber: string;
      formatVersion: 2;
    };

export class SignedQrVerificationService {
  private readonly signingKey: string;

  constructor(
    env: Pick<Env, "DB" | "QR_SIGNING_KEY">,
    private readonly db = drizzle(env.DB),
  ) {
    if (!env.QR_SIGNING_KEY || env.QR_SIGNING_KEY.length < 32) {
      throw new Error("QR_SIGNING_KEY must be set and at least 32 characters");
    }
    this.signingKey = env.QR_SIGNING_KEY;
  }

  async verifyTable(
    qrCode: string,
    tableId?: number,
  ): Promise<TableQrVerification> {
    const parsed = await this.parseAndVerify(qrCode, "table");
    if (!parsed.valid) return parsed;
    const { payload } = parsed;

    const resolvedTableId = tableId ?? payload.tableId;
    const [table] = await this.db
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
        resolvedTableId === undefined
          ? eq(tables.qrCode, qrCode)
          : eq(tables.id, resolvedTableId),
      )
      .limit(1);

    if (!table) return { valid: false, reason: "not_found" };
    if (table.isActive !== true || table.deletedAt !== null) {
      return { valid: false, reason: "inactive" };
    }
    if (payload.tableId !== table.id) {
      return { valid: false, reason: "mismatch" };
    }
    if (table.qrCodeVersion !== payload.version) {
      return { valid: false, reason: "stale" };
    }
    // The number is signed but deliberately not compared: a table keeps its
    // id across a rename, and its printed sticker must keep working.
    // Revocation is the version (regenerate / rotation) or deletion.
    if (table.restaurantId !== payload.restaurantId) {
      return { valid: false, reason: "mismatch" };
    }

    return {
      valid: true,
      type: "table",
      restaurantId: table.restaurantId,
      tableId: table.id,
      tableNumber: table.number,
      formatVersion: payload.formatVersion,
    };
  }

  async verifySeat(
    qrCode: string,
    seatId?: number,
  ): Promise<SeatQrVerification> {
    const parsed = await this.parseAndVerify(qrCode, "seat");
    if (!parsed.valid) return parsed;
    const { payload } = parsed;

    const seatIdentity =
      seatId !== undefined
        ? eq(seats.id, seatId)
        : and(
            eq(seats.tableId, payload.tableId),
            eq(seats.seatNumber, payload.identifier),
          );
    const [seat] = await this.db
      .select({
        id: seats.id,
        tableId: seats.tableId,
        seatNumber: seats.seatNumber,
        qrCode: seats.qrCode,
        qrCodeVersion: seats.qrCodeVersion,
        isActive: seats.isActive,
        deletedAt: seats.deletedAt,
        restaurantId: tables.restaurantId,
        tableNumber: tables.number,
        tableIsActive: tables.isActive,
        tableDeletedAt: tables.deletedAt,
      })
      .from(seats)
      .leftJoin(tables, eq(seats.tableId, tables.id))
      .where(seatIdentity)
      .limit(1);

    if (!seat) return { valid: false, reason: "not_found" };
    if (
      seat.isActive !== true ||
      seat.deletedAt !== null ||
      seat.tableIsActive !== true ||
      seat.tableDeletedAt !== null
    ) {
      return { valid: false, reason: "inactive" };
    }
    if (
      seat.restaurantId === null ||
      seat.tableNumber === null ||
      payload.tableId !== seat.tableId
    ) {
      return { valid: false, reason: "mismatch" };
    }
    if (seat.qrCodeVersion !== payload.version) {
      return { valid: false, reason: "stale" };
    }
    if (
      seat.restaurantId !== payload.restaurantId ||
      seat.seatNumber !== payload.identifier
    ) {
      return { valid: false, reason: "mismatch" };
    }

    return {
      valid: true,
      type: "seat",
      restaurantId: seat.restaurantId,
      tableId: seat.tableId,
      tableNumber: seat.tableNumber,
      seatId: seat.id,
      seatNumber: seat.seatNumber,
      formatVersion: payload.formatVersion,
    };
  }

  verifyTableFromQrCode(qrCode: string): Promise<TableQrVerification> {
    return this.verifyTable(qrCode);
  }

  verifySeatFromQrCode(qrCode: string): Promise<SeatQrVerification> {
    return this.verifySeat(qrCode);
  }

  private async parseAndVerify(
    qrCode: string,
    expectedType: "table" | "seat",
  ): Promise<ParsedSignedQr> {
    const payload = parseSignedQRUrl(qrCode);
    if (!payload) return { valid: false, reason: "malformed" };
    if (payload.type !== expectedType) {
      return { valid: false, reason: "wrong_type" };
    }

    const valid = await verifyQRSignature(
      payload,
      payload.signature,
      this.signingKey,
    );
    return valid
      ? { valid: true, payload }
      : { valid: false, reason: "signature_invalid" };
  }
}
