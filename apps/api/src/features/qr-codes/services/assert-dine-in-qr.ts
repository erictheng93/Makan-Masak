import { forbidden } from "../../../shared/utils/api-error";
import type { Env } from "../../../types/env";
import { SignedQrVerificationService } from "./SignedQrVerificationService";

/**
 * Proof of presence for table/seat orders: the caller must present the signed
 * QR it scanned, and it must match the restaurant, table and (for seat orders)
 * seat being ordered to. Table/seat QRs are HMAC-signed and not public; SHOP-
 * codes are public identifiers and are never accepted here.
 *
 * Throws 403 QR_VERIFICATION_FAILED otherwise.
 */
export async function assertDineInQr(
  env: Pick<Env, "DB" | "QR_SIGNING_KEY">,
  input: {
    restaurantId: string;
    tableId: number;
    seatId?: number;
    qrCode?: string;
  },
): Promise<void> {
  const fail = (): never => {
    throw forbidden(
      "A valid table or seat QR code is required to order here",
      "QR_VERIFICATION_FAILED",
    );
  };
  if (!input.qrCode) return fail();

  const service = new SignedQrVerificationService(env);
  if (input.seatId !== undefined) {
    const r = await service.verifySeat(input.qrCode, input.seatId);
    if (
      !r.valid ||
      r.restaurantId !== input.restaurantId ||
      r.tableId !== input.tableId
    ) {
      return fail();
    }
    return;
  }

  // Table order: a table QR, or a seat QR of that table, both prove presence.
  const t = await service.verifyTable(input.qrCode, input.tableId);
  if (t.valid) {
    if (t.restaurantId !== input.restaurantId) return fail();
    return;
  }
  if (t.reason !== "wrong_type") return fail();
  const s = await service.verifySeat(input.qrCode);
  if (
    !s.valid ||
    s.restaurantId !== input.restaurantId ||
    s.tableId !== input.tableId
  ) {
    return fail();
  }
}
