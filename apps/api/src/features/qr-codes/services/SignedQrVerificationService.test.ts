import { describe, expect, it } from "vitest";
import { buildSignedQRUrl } from "@makanmasak/utils";
import { SignedQrVerificationService } from "./SignedQrVerificationService";

const signingKey = "test-qr-signing-key-at-least-32-characters";

function createDb(...results: unknown[][]) {
  let index = 0;
  return {
    select: () => ({
      from: () => ({
        leftJoin: () => ({
          where: () => ({
            limit: async () => results[index++] ?? [],
          }),
        }),
        where: () => ({
          limit: async () => results[index++] ?? [],
        }),
      }),
    }),
  };
}

describe("SignedQrVerificationService", () => {
  it("accepts a current v2 table QR and rejects its stale version", async () => {
    const currentQr = await buildSignedQRUrl(
      "https://example.test",
      {
        type: "table",
        restaurantId: "restaurant-1",
        tableId: 10,
        identifier: "T1",
        version: 2,
      },
      signingKey,
    );
    const staleQr = await buildSignedQRUrl(
      "https://example.test",
      {
        type: "table",
        restaurantId: "restaurant-1",
        tableId: 10,
        identifier: "T1",
        version: 1,
      },
      signingKey,
    );
    const table = {
      id: 10,
      restaurantId: "restaurant-1",
      number: "T1",
      qrCodeVersion: 2,
      isActive: true,
      deletedAt: null,
    };
    const service = new SignedQrVerificationService(
      { DB: {} as D1Database, QR_SIGNING_KEY: signingKey },
      createDb([table], [table]) as never,
    );

    await expect(service.verifyTable(currentQr, 10)).resolves.toEqual({
      valid: true,
      type: "table",
      restaurantId: "restaurant-1",
      tableId: 10,
      tableNumber: "T1",
      formatVersion: 2,
    });
    await expect(service.verifyTable(staleQr, 10)).resolves.toEqual({
      valid: false,
      reason: "stale",
    });
  });

  it("keeps a renamed table's printed QR valid", async () => {
    const printedQr = await buildSignedQRUrl(
      "https://example.test",
      {
        type: "table",
        restaurantId: "restaurant-1",
        tableId: 10,
        identifier: "T1",
        version: 2,
      },
      signingKey,
    );
    const renamed = {
      id: 10,
      restaurantId: "restaurant-1",
      number: "VIP-1",
      qrCodeVersion: 2,
      isActive: true,
      deletedAt: null,
    };
    const service = new SignedQrVerificationService(
      { DB: {} as D1Database, QR_SIGNING_KEY: signingKey },
      createDb([renamed]) as never,
    );

    // The answer names the current number, not the one printed on the sticker.
    await expect(service.verifyTable(printedQr, 10)).resolves.toMatchObject({
      valid: true,
      tableId: 10,
      tableNumber: "VIP-1",
    });
  });

  it("distinguishes inactive or deleted tables from missing tables", async () => {
    const qrCode = await buildSignedQRUrl(
      "https://example.test",
      {
        type: "table",
        restaurantId: "restaurant-1",
        tableId: 10,
        identifier: "T1",
        version: 2,
      },
      signingKey,
    );
    const service = new SignedQrVerificationService(
      { DB: {} as D1Database, QR_SIGNING_KEY: signingKey },
      createDb(
        [
          {
            id: 10,
            restaurantId: "restaurant-1",
            number: "T1",
            qrCodeVersion: 2,
            isActive: false,
            deletedAt: null,
          },
        ],
        [],
      ) as never,
    );

    await expect(service.verifyTable(qrCode, 10)).resolves.toEqual({
      valid: false,
      reason: "inactive",
    });
    await expect(service.verifyTable(qrCode, 10)).resolves.toEqual({
      valid: false,
      reason: "not_found",
    });
  });

  it("rejects a legacy QR even when it matches the stored row", async () => {
    // Phase 3 cutoff: a pre-v2 URL is unparseable now, so it fails before any
    // database comparison. Matching the stored value must not rescue it —
    // otherwise the legacy downgrade path would still be reachable for every
    // table whose code was never regenerated.
    const legacyUrl = new URL("https://example.test/order");
    legacyUrl.searchParams.set("t", "table");
    legacyUrl.searchParams.set("r", "restaurant-1");
    legacyUrl.searchParams.set("n", "T1");
    legacyUrl.searchParams.set("v", "1");
    legacyUrl.searchParams.set("sig", "a".repeat(16));
    const legacyQr = legacyUrl.toString();

    const service = new SignedQrVerificationService(
      { DB: {} as D1Database, QR_SIGNING_KEY: signingKey },
      createDb([
        {
          id: 10,
          restaurantId: "restaurant-1",
          number: "T1",
          qrCode: legacyQr,
          qrCodeVersion: 1,
          isActive: true,
          deletedAt: null,
        },
      ]) as never,
    );

    await expect(service.verifyTableFromQrCode(legacyQr)).resolves.toEqual({
      valid: false,
      reason: "malformed",
    });
  });

  it("binds seat QR verification to both seat and table identity", async () => {
    const qrCode = await buildSignedQRUrl(
      "https://example.test",
      {
        type: "seat",
        restaurantId: "restaurant-1",
        tableId: 10,
        identifier: "01",
        version: 3,
      },
      signingKey,
    );
    const service = new SignedQrVerificationService(
      { DB: {} as D1Database, QR_SIGNING_KEY: signingKey },
      createDb([
        {
          id: 21,
          tableId: 11,
          seatNumber: "01",
          qrCodeVersion: 3,
          isActive: true,
          deletedAt: null,
          restaurantId: "restaurant-1",
          tableNumber: "T2",
          tableIsActive: true,
          tableDeletedAt: null,
        },
      ]) as never,
    );

    await expect(service.verifySeat(qrCode, 21)).resolves.toEqual({
      valid: false,
      reason: "mismatch",
    });
  });

  it("resolves a v2 seat QR from its signed table and seat number", async () => {
    const qrCode = await buildSignedQRUrl(
      "https://example.test",
      {
        type: "seat",
        restaurantId: "restaurant-1",
        tableId: 10,
        identifier: "VIP-1",
        version: 3,
      },
      signingKey,
    );
    const service = new SignedQrVerificationService(
      { DB: {} as D1Database, QR_SIGNING_KEY: signingKey },
      createDb([
        {
          id: 21,
          tableId: 10,
          seatNumber: "VIP-1",
          qrCodeVersion: 3,
          isActive: true,
          deletedAt: null,
          restaurantId: "restaurant-1",
          tableNumber: "T1",
          tableIsActive: true,
          tableDeletedAt: null,
        },
      ]) as never,
    );

    await expect(service.verifySeatFromQrCode(qrCode)).resolves.toMatchObject({
      valid: true,
      type: "seat",
      tableId: 10,
      seatId: 21,
      seatNumber: "VIP-1",
    });
  });
});
