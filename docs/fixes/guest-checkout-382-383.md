# Guest checkout: coupons and order credentials (#382, #383)

## Root causes

- #382: CartView calculated a coupon discount but omitted `couponCode` from the guest submission. The guest request schema stripped the field even if a caller supplied it, and the route never forwarded it to OrdersService. The shared order service already calculates and persists coupon discounts; the guest entry point never reached that logic.
- #383: The server correctly authorizes each guest token for one order. The client stored all tokens in one `guest_auth_token` slot, so another checkout replaced the credential needed to read or cancel an older order. A customer JWT could also take precedence on endpoints that require a guest credential.

## Decisions

Guests can use coupons. Preview and submission resolve the existing `X-Guest-Device-Id` identity on the server and hash it before storing it in `coupon_usage.guest_identity`. It is separate from `user_id`, which references staff/user records. Request bodies cannot choose this identity. Order tokens rotate and are therefore not accepted as a stable coupon identity. Clients without a device identity can use unrestricted coupons, but per-user-limited coupons fail explicitly, including coupons that also have a global cap. For guests, “per user” means per browser storage; clearing that storage or switching browsers changes the identity.

The existing coupon service validates eligibility and computes the amount from server menu prices. The order, items and coupon usage row are written in one D1 batch. Migration `0027_guest_coupon_identity.sql` adds an indexed identity and an insert trigger that enforces the per-device limit inside that batch. A competing request cannot pass an earlier preview and overspend the limit. Failed writes release the existing global coupon reservation; cancellation uses the existing usage-release path.

Guest credentials are saved under `guest_auth_token:<orderId>` and also in the legacy latest-order slot. Guest order reads/mutations select the order's credential even after sign-in. Other requests retain customer JWT precedence. A guest-order 401 does not clear the independent customer session. Successful reads promote legacy credentials only after the server validates ownership. Tracking, cancellation, realtime, route guards, shop checkout, and market child/recovery paths use the same storage helper.

## Regression coverage

- Cart component: apply a coupon, observe the discounted submit amount, and submit its code on the guest path.
- Real API/D1: fixed and percentage discounts survive API read-back and ledger persistence; per-device limits, cancellation, missing identities and invalid coupons do not silently create full-price orders.
- Real axios client: create A and B, then read/cancel A; customer sign-in, legacy promotion, market children and recovery retain the correct credential.
- Real browser/API: `tests/e2e/customer/ordering.spec.ts` checks the saved total against the amount shown before confirmation; `order-tracking.spec.ts` places a second order and reopens the first. Both regressions are required assertions rather than expected failures.

## Release order

Apply platform migration `0027_guest_coupon_identity.sql` before deploying the API that writes the new column, then deploy the customer app. No control-plane migration is required. The migration only adds a nullable column, index and trigger; existing usage records remain intact.
