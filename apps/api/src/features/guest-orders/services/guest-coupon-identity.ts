import { resolveGuestLockIdentity } from "../../../middleware/guestAuth";

/** Reuse the stable guest device identity without persisting its raw value. */
export async function resolveGuestCouponIdentity(req: {
  header(name: string): string | undefined;
}): Promise<string | undefined> {
  const identity = resolveGuestLockIdentity(req);
  // An order token rotates after every checkout and cannot enforce a device limit.
  if (identity?.kind !== "device") return undefined;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${identity.kind}:${identity.value}`),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
