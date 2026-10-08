# Issue #441 Menu Availability Realtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 顧客、後台與廚房接收售完／恢復供應更新，通過真實串接驗收後完成 #441。

**Architecture:** 沿用餐廳 DO 與廣播服務，新增隔離的公開菜單房間。
三個供應寫入入口共用 API MenuService 的寫入後通知，公開事件只要求重新查詢。
顧客沿用 Vue Query 與 useWebSocket，後台與廚房沿用現有連線。

**Tech Stack:** TypeScript、Vue 3、Hono、Drizzle、Cloudflare D1/KV/DO、Vitest、Playwright；使用 pnpm。

**Spec:** `docs/superpowers/specs/2026-10-08-menu-availability-realtime-design.md`（使用者已核准）。

## Global Constraints

- Node >=22.18、pnpm 12；不增加依賴、資料庫 migration、事件歷史、DO alarm 或輪詢。
- Token scope `menu-realtime`，五分鐘到期，餐廳／房間固定；簽發每 IP 每分鐘 10 次。
- 公開 payload 只含 `menuItemId`、`action: "updated"`；後台／廚房使用既有供應事件。
- 公開餐廳須啟用且未刪除，公開菜品須未刪除且分類可見；售完不阻擋通知。
- 保留三個入口的權限、經理稽核、下單驗證與購物車；斷線補取，不重播歷史提示。
- UI 依 DESIGN.md、design-tokens.js、既有六語系；測試依 CLAUDE.md 的 mock 驗證規則。
- 原子提交只含本工作，發布需使用者明確授權；未通過串接驗收不關閉 issue。

## Review Focus

1. 查詢快取與 API edge cache 使用不同 tag namespace；收到推送後必須讀到主庫新狀態（Task 2）。
2. 批次第二筆寫入失敗，不得留下第一筆已變更但未通知的狀態（Task 2）。
3. 房間允許清單須早於群組事件的直接投遞分支，避免公開房間取得私密事件（Task 1）。
4. 取得 token 途中離頁／切店，晚到的 URL 不得建立舊 socket（Task 3）。
5. 查詢尚未完成時再收到變更，必須在目前查詢結束後補讀，避免 dedupe 吞掉較新的變更（Task 3）。

## Execution and File Boundaries

建議 Native：由本對話依序實作；共享型別、寫入通知、前端與快取有順序相依。
最後依 executing-plans 技能進行一次獨立整體審查。
先確認目前 checkout 與未提交修改，按使用者已表達的工作區偏好執行；
沒有工作區隔離偏好時，不自行建立新分支，依 using-git-worktrees 的規則確認。

後端公開能力由 Task 1 負責；資料寫入／一致性由 Task 2 負責；顧客由 Task 3
負責；員工接收由 Task 4 負責；驗收由 Task 5 負責。保留現有大型檔案結構，
只新增共用顧客 composable 及有必要的測試檔。

---

### Task 1: Restrict and authorize the public menu room

**Files:**

- Modify: `packages/shared-types/src/realtime-events.ts`（RoomType、scope）。
- Modify: `apps/api/src/features/realtime/{schemas/validation.ts,routes/index.ts,services/RealtimeAuthService.ts}`。
- Modify: `apps/api/src/middleware/geo-rate-limiting.ts`（公開 token 簽發策略）。
- Modify: `apps/api/src/openapi/{schemas/realtime.ts,integration.ts}`（新公開端點登記）。
- Modify: `apps/realtime/src/{index.ts,utils/jwtVerifier.ts,utils/rateLimiter.ts,durableObjects/RealtimeSession.ts}`（含 ConnectionInfo）。
- Test: 上述 realtime API schemas/routes/services、geo-rate-limiting 的既有 `*.test.ts`，
  及 realtime Worker 的 `index.test.ts`、`utils/{jwtVerifier,rateLimiter}.test.ts`、
  `durableObjects/RealtimeSession.test.ts`。

**Interfaces:**

- Produces: `generateMenuToken({ restaurantId }: { restaurantId: string }): Promise<RealtimeAuthTokenResponse | { error: string }>`。
- Produces: `POST /api/v1/realtime/auth/menu-token` → `{ success: true, data: { token, expiresIn, wsUrl } }`。
- Produces: `GET /menu/:restaurantId` WebSocket，`roomType: "menu"`、`role: "customer"`、
  `scope: "menu-realtime"`，無 guestFlag、userId、groupOrderId 或 orderId。
- Produces: `clientRateLimitKey(payload: RealtimeAuthPayload, clientAddress?: string): string`；
  `checkClientRateLimit(payload, env, request?: Request)` 的第三參數僅供公開菜單 bucket。

- [ ] **1. 加入失敗測試。** 在既有 fixtures 下簽發有效餐廳的 token，並驗證 decoded payload：

  ```ts
  expect(decoded).toMatchObject({
    roomType: "menu", scope: "menu-realtime", role: "customer",
    roomId: "rest-1", restaurantId: "rest-1",
  });
  expect(decoded.exp - decoded.iat).toBe(300);
  expect(decoded).not.toHaveProperty("guestFlag");
  ```

  對未啟用／已刪除／不存在餐廳拒絕。Worker 測試用現有 signed-token helper
  驗證 scope、role、roomId、restaurantId 不符與過期 token 在 idFromName 前拒絕。
  DO 測試對 menu connection 注入每一種群組、訂單、桌台及跨餐廳事件，
  斷言 socket.send 未呼叫；有效公開菜單事件可收到。
  同 IP 同餐廳的新 token 維持同 key，不同 IP 不共用匿名 bucket。

- [ ] **2. 執行 red。**

  ```sh
  pnpm --filter @makanmasak/api test -- src/features/realtime src/middleware/geo-rate-limiting.test.ts
  pnpm --filter @makanmasak/realtime test -- src/index.test.ts src/utils src/durableObjects/RealtimeSession.test.ts
  ```

  預期新方法／schema／room 尚未存在，新增測試失敗。

- [ ] **3. 實作端點與權限。** API 使用既有 `isPublicRestaurantAvailable` 判定、
  JSON envelope 與 ApiError；route 沿用 `rateLimitMiddleware` 的 10/60s 配置，
  geo limiter 將此端點納入公開簽發策略。OpenAPI 設定公開 security。
  API verifier、Worker verifier 與 DO handshake 同時加入下列綁定檢查，
  並拒絕其他 room 使用 menu scope：

  ```ts
  const isMenuToken = payload.roomType === "menu" || payload.scope === "menu-realtime";
  if (isMenuToken && (
    payload.roomType !== "menu" || payload.scope !== "menu-realtime" ||
    payload.role !== "customer" || payload.guestFlag ||
    payload.roomId !== payload.restaurantId
  )) return { valid: false, error: "Invalid menu token payload" };
  ```

  Worker 在驗證後用真實 request IP 限流。DO 的事件 predicate 最先加入：

  ```ts
  if (connectionInfo.type === "menu") {
    return connectionInfo.auth?.scope === "menu-realtime" &&
      event.restaurantId === connectionInfo.auth.restaurantId &&
      event.type === RealtimeEventType.MENU_ITEM_UPDATE;
  }
  ```

  菜單房間拒絕 subscribe 擴張權限；握手 ACK 與既有 ping/pong 保留。

- [ ] **4. 執行 green。** 重跑第 2 步，確認新 token、限流及私密事件隔離測試通過；
  舊 guest/staff/group 連線測試也通過。
- [ ] **5. 原子提交。** `feat(realtime): add scoped public menu subscriptions`。

### Task 2: Broadcast actual supply writes after cache invalidation

**Files:**

- Modify: `packages/database/src/services/menu.ts`（批次實際變更回傳、原子寫入、fresh menu read）。
- Modify: `packages/database/src/services/RealtimeBroadcastService.ts`（員工房間與公開刷新）。
- Modify: `apps/api/src/features/menu/{services/MenuService.ts,types/index.ts,routes/index.ts}`。
- Modify: `apps/api/src/features/manager/services/ManagerActionsService.ts`。
- Modify: `apps/api/src/middleware/edge-cache.ts`（菜單 no-cache 讀取與共用失效）。
- Test: `packages/database/src/services/{menu.test.ts,RealtimeBroadcastService.test.ts}`、
  `apps/api/src/features/menu/services/MenuService.test.ts`、
  `apps/api/src/features/manager/services/ManagerActionsService.test.ts`、
  `apps/api/src/middleware/edge-cache-policy.test.ts`。
- Create: `apps/api/src/__tests__/integration/menu-availability.real.integration.test.ts`。

**Interfaces:**

- Database `batchUpdateAvailability(restaurantId, updates): Promise<MenuItem[]>` 回傳實際變更。
- Database/API `getMenu(restaurantId, options?: { includeUnavailable?: boolean; skipCache?: boolean })`。
- API private `notifyAvailabilityChanges(items: MenuItem[]): Promise<void>`。
- Broadcast `broadcastMenuAvailabilityUpdate(event): Promise<BroadcastResult>` 投遞 admin、kitchen。
- API export `invalidateRestaurantMenuEdgeCache(env: Env, restaurantId: string): Promise<void>`，
  供 MenuService 寫入後、推送前清除既有 EdgeCacheManager 的 explicit keys 與餐廳 tag。
- `Cache-Control: no-cache` 僅在公開 menu GET 讓 edge cache 與資料庫 QueryCache 繞過讀寫。
  直接主庫讀取解決不同地區 Cache API 與 KV 最終一致性；仍使用公開過濾與既有 GET 限流。

- [ ] **1. 加入失敗測試。** 單筆供應／庫存改變會通知，name-only 或同值不通知。
  資料庫寫入失敗不通知；廣播失敗仍返回成功寫入結果。
  以實際 D1 比較單筆、批次和經理動作的供應結果、deletedAt 及跨租戶邊界。
  批次重複 ID 採最後一個目標值，第二筆失敗整批 rollback；空批次不呼叫 db.batch。
  既有 service fixture 擴充 broadcast stub，以 `toHaveBeenCalledWith(objectContaining(...))`
  斷言 staff payload，公開 payload 不含名稱／庫存／原因。

  真實 D1 測試用同餐廳可見菜品設定回歸斷言：

  ```ts
  await service.batchUpdateAvailability(restaurant.id, [
    { id: item.id, isAvailable: false },
    { id: item.id, isAvailable: true },
  ]);
  const actual = await service.getMenu(restaurant.id, { skipCache: true });
  expect(actual?.menuItems.find(row => row.id === item.id)?.isAvailable).toBe(true);
  ```

  cache 測試預載舊公開回應與舊查詢結果，供應寫入後在廣播 callback 中讀取，
  應取得新狀態。另一個 no-cache 請求即使 tag 刪除尚未傳播也取新主庫資料。

- [ ] **2. 執行 red。**

  ```sh
  pnpm --filter @makanmasak/database test -- src/services/menu.test.ts src/services/RealtimeBroadcastService.test.ts
  pnpm --filter @makanmasak/api test -- src/features/menu/services/MenuService.test.ts src/features/manager/services/ManagerActionsService.test.ts src/middleware/edge-cache-policy.test.ts
  pnpm --filter @makanmasak/api test:real-integration -- src/__tests__/integration/menu-availability.real.integration.test.ts
  ```

- [ ] **3. 最小寫入實作。** 批次沿用 Drizzle D1 batch，餐廳／未刪除／不同供應狀態
  條件在 UPDATE WHERE，不用先讀再逐筆 await：

  ```ts
  const unique = [...new Map(updates.map(update => [update.id, update])).values()];
  const queries = unique.map(update => this.db.update(menuItems).set({
    isAvailable: update.isAvailable, updatedAt: new Date(),
  }).where(and(
    eq(menuItems.id, update.id), eq(menuItems.restaurantId, restaurantId),
    isNull(menuItems.deletedAt), ne(menuItems.isAvailable, update.isAvailable),
  )).returning());
  if (queries.length === 0) return [];
  const rows = (await this.db.batch([queries[0], ...queries.slice(1)])).flat();
  ```

  batch 成功後清除 QueryCache，回傳 mapToMenuItem 後的 rows。
  API 單筆用既有 existingItem 比較成功寫入結果；batch 用變更 rows。
  單筆 UPDATE 限定原本餐廳與未刪除列，不能以 request body 移轉餐廳；
  對 race 或 concurrent write 的影響加入實際 SQL 條件檢查測試。
  經理用 `getMenuItem` 核對餐廳及已刪除狀態，再呼叫共用 API update；
  `resourceId` 用 Number.isSafeInteger，保留 reason、代理者與 audit 寫入。

  notify 先清除 EdgeCacheManager 與 QueryCache，再發 staff 事件；公開可見
  categories 用一次有界批次查詢判定，公開 refresh 只發一次，event.data 為：

  ```ts
  { menuItemId: visibleChangedItem.id, action: "updated" }
  ```

  復用 broadcastEvent("menu", restaurantId, publicEvent)，無新增泛用事件系統。
  整個通知流程 catch/logger，廣播或通知附帶查詢故障不改寫 mutation 結果。
  middleware 的原本 mutation 失效仍保護其他菜單修改，菜單供應 service 提前
  執行失效是為了推送／HTTP 回應時序；只清除同餐廳已知 keys 與 tag。
  no-cache menu 讀取直接執行既有查詢函式，不創建另一套菜單過濾邏輯。

- [ ] **4. 執行 green。** 重跑第 2 步，檢查實際 D1 rollback、快取順序、
  private/public payload 與跨餐廳結果。
- [ ] **5. 原子提交。** `feat(menu): broadcast supply changes from all three write paths`。

### Task 3: Refresh both customer menu views safely

**Files:**

- Create: `apps/customer-app/src/composables/useMenuRealtime.ts` 與 `useMenuRealtime.test.ts`。
- Modify: `apps/customer-app/src/composables/useWebSocket.ts`。
- Create: `apps/customer-app/src/composables/useWebSocket.test.ts`。
- Modify: `apps/customer-app/src/services/menuApi.ts`、`views/{MenuView,ShopMenuView}.vue`。
- Test: `apps/customer-app/src/tests/views/{menu-view-table-validation,shop-menu-ordering-gate}.test.ts`。

**Interfaces:**

- Produces: `useMenuRealtime(restaurantId: () => string, refresh: () => Promise<unknown>): void`。
- Extends: `menuApi.getMenu(restaurantId: string, tableId?: number, options?: { fresh?: boolean })`，
  其別名來源 getRestaurantMenu 同步接受並傳遞第三參數。
- `fresh: true` 在 API 請求帶 `Cache-Control: no-cache`，供推送與重連的刷新使用。

- [ ] **1. 加入失敗測試。** 使用既有 Vue mount 和 WebSocket mock 模式，
  menu event／首次 open／重連 open 各觸發 refresh，其他餐廳／事件不觸發。
  fresh 請求帶標準 no-cache header；普通首次查詢仍可走快取。
  token 在五分鐘內重用，過期或 auth rejection 才重簽，不增加持久 token 存放。
  deferred token promise 在 unmount 後 resolve，不得建立 socket 或安排重試。
  舊 socket 的晚到 close 不得關閉新 socket 的心跳／狀態。
  在 refresh 執行中再收到事件，完成後必須額外查詢一次。

  ```ts
  expect(refresh).toHaveBeenCalledTimes(2);
  expect(apiClient.post).toHaveBeenCalledWith(
    "/realtime/auth/menu-token", expect.objectContaining({ restaurantId: "rest-1" }),
  );
  ```

  views 測試使用新餐廳 props，確認 query key 變動、舊回應不覆寫新菜單。
  售完／恢復時保持購物車內容，連線失敗不阻止原本 REST 瀏覽與下單。

- [ ] **2. 執行 red。**

  ```sh
  pnpm --filter makanmasak-customer-app test -- src/composables/useMenuRealtime.test.ts src/composables/useWebSocket.test.ts
  ```

- [ ] **3. 實作共用 composable。** token local cache 在切店失效，沿用 useWebSocket
  的五次重試與退避；事件僅為刷新訊號。
  用單一 dirty flag 和一個 in-flight refresh 合併 burst 並保留尾端補讀，
  refresh reject 在 composable 中記錄，避免未處理 promise rejection。
  watcher 追蹤 restaurant getter，並在 unmount 取消連線／舊結果。

  useWebSocket 增加 connection generation：disconnect 遞增，resolveUrl 後
  generation 不同即 return；每個 socket handler 檢查仍是目前 socket。
  onAuthFailure await 後重新檢查 manualDisconnect／generation，防止離頁後重連。

  ```ts
  const generation = ++connectionGeneration;
  const targetUrl = await resolveUrl(wsUrl);
  if (generation !== connectionGeneration || manualDisconnect) return;
  const socket = new WebSocket(targetUrl, protocols);
  ws.value = socket;
  // 每個 handler 的第一行：if (ws.value !== socket) return;
  ```

  兩個 view 使用 reactive menu queryKey，refresh 將下一次 query 標為 fresh
  並呼叫既有 refetch。menu queryFn 仍使用 menuApi.getMenu，公開過濾在伺服器。
  getRestaurantMenu 使用既有 apiClient.request 接受 no-cache header：

  ```ts
  return apiClient.request<MenuApiResponse>({
    method: "GET", url,
    ...(options?.fresh ? { headers: { "Cache-Control": "no-cache" } } : {}),
  });
  ```

  url 為既有 URLSearchParams 組成的菜單 URL；apiClient.get 的第二參數是 params，
  不能將 headers 當第二參數傳入。現有 CORS 已允許 Cache-Control。
  watch／async 回應以餐廳世代防護；保留 table validation、group cart 及 options。

- [ ] **4. 執行 green。** 重跑第 2 步，並回歸既有
  `useGroupOrder.test.ts` 及 `src/tests/views`，確認共用 socket 修改不破壞訂單／群組。
- [ ] **5. 原子提交。** `feat(customer): refresh menu availability over scoped realtime`。

### Task 4: Update staff lists and kitchen notifications

**Files:**

- Modify: `apps/admin-dashboard/src/composables/useMenuManagement.ts`。
- Create: `apps/admin-dashboard/src/composables/useMenuManagement.test.ts`。
- Modify: `apps/kitchen-display/src/views/EnhancedKitchenDashboard.vue`。
- Test: `apps/kitchen-display/src/views/EnhancedKitchenDashboard.test.ts`。
- Modify: 廚房既有 `src/i18n/locales/{zh-TW,zh-CN,en-US,ms-MY,vi-VN,id-ID}.ts`。

**Interfaces:** 沿用 admin/kitchen realtimeService 的 subscribe/unsubscribe/status，
不讓 useMenuManagement 建立另一條 staff 連線。廚房用單獨 menu callback，
不能將供應事件 cast 成 KitchenSSEEvent 交給訂單 reducer。

- [ ] **1. 加入失敗測試。** 後台 menu event 和 reconnect 刷新清單；編輯表單資料
  不被刷新覆寫；同餐廳 burst 合併、跨餐廳忽略、unmount unsubscribe。
  廚房供應 callback 觸發 toast，訂單 reducer 不被呼叫：

  ```ts
  expect(toast.info).toHaveBeenCalledWith(expect.stringContaining("Laksa"));
  expect(ordersStore.handleSSEEvent).not.toHaveBeenCalled();
  ```

  使用既有 dashboard test mocks 擴充 toast.info、handleSSEEvent 和 subscription
  callback 捕捉；i18n mock 必須將 name 參數包含於回傳字串，以驗證實際使用名稱。

- [ ] **2. 執行 red。**

  ```sh
  pnpm --filter makanmasak-admin-dashboard test -- src/composables/useMenuManagement.test.ts
  pnpm --filter makanmasak-kitchen-display test -- src/views/EnhancedKitchenDashboard.test.ts
  ```

- [ ] **3. 接上既有連線。** useMenuManagement 在 setup 生命週期註冊 subscriber
  和 reconnect watcher，清單 refresh 重用 fetchMenu；只更新清單，保留表單狀態。
  fetchMenu 開始時捕捉餐廳 ID，回應／finally 僅套用於仍有效的餐廳／請求。
  廚房獨立訂閱 MENU_AVAILABILITY_UPDATE，檢查 restaurantId 後使用既有
  toast 與 `t("realtime.menuUnavailable", { name })`／menuAvailable 文案。
  unmount 清除所有新增訂閱；不增加 sound、timer 或歷史清單。

- [ ] **4. 執行 green。** 第 2 步全部通過，六語系鍵存在，palette 檢查通過。
- [ ] **5. 原子提交。** `feat(staff): receive menu supply updates in admin and kitchen`。

### Task 5: Prove the full flow and record acceptance

**Files:**

- Create: `tests/e2e/customer/menu-availability-realtime.spec.ts`。
- Reuse: `tests/e2e/customer/customer-e2e.ts`、`tests/e2e/admin/admin-e2e.ts`、
  `tests/e2e/smoke/owner-auth.ts`（fixture、login、csrf、document marker）。
- Update: 本計畫 checkboxes 及 `docs/superpowers/specs/2026-10-08-menu-availability-realtime-design.md`
  的驗收證據；API contracts snapshot 只透過既有產生／檢查工具更新。

**Interfaces:** 真實 local API :8787、realtime :8788、customer :3000、admin :3001、
kitchen :3002，使用既有 dev 配置確認實際 port；不注入假的 API／WebSocket 事件。
使用既有 seed 與 `Cleanup` 建立本次 fixture，驗收僅修改本地資料。

- [ ] **1. 加入真實 E2E。** import `Cleanup`、`createMenuFixture`、`getOwner`、
  `newDinerContext`、`markDocument`、`expectNoReload`、`recordRealtimeEvents`、
  `waitForRealtimeAck` 與 apiRequest；開兩個顧客畫面並確認 menu room ACK。
  item locator 使用菜品名稱縮小到 card，避免推薦區多次出現同名造成假失敗。
  售完後兩頁 card 都移除，恢復後重新出現，確認文件未 reload。
  單筆／批次／經理各自執行一次售完和一次恢復；同步確認另一個後台卡片／
  通知，以及廚房供應 toast。用瀏覽器 offline 斷線，期間修改，online 重連後
  菜單補讀；清除 token／private 事件隔離用 Task 1 的測試和實際握手拒絕驗證。

  每次真實供應寫入的最低斷言：

  ```ts
  const result = await apiRequest(`/api/v1/menu/items/${item.id}`, {
    token: owner.token, method: "PUT", body: { isAvailable: false },
  });
  expect(result.ok).toBe(true);
  await expect(card).toHaveCount(0);
  await expectNoReload(page);
  ```

  owner、item、card、page 由上述 fixture／browser context 在該 test 內建立。
  finally 執行 cleanup.run 並 close contexts；測試不能讓備援輪詢掩蓋失去推送。

- [ ] **2. 啟動與驗證本地 stack。** 使用現有本地 D1 migrations／seed 的命令，
  不重設或刪除本地資料；服務已在執行時直接重用。以 `E2E_STRICT=1`
  執行新增 E2E，任何 skip／stack down 不得列為通過：

  ```sh
  E2E_STRICT=1 pnpm exec playwright test --project=customer-real tests/e2e/customer/menu-availability-realtime.spec.ts --workers=1
  ```

  以三個入口的 HTTP 成功、實際 WebSocket frame 與 UI refetch／card變化，
  證明 mutation → DO → socket → menu GET 的完整流程。保留驗收截圖與 trace。

- [ ] **3. 執行完整相關檢查。**

  ```sh
  pnpm lint:fix
  pnpm run check:design-palette
  pnpm run check:i18n-locales
  pnpm run typecheck:tests
  pnpm verify
  git diff --check
  ```

  對本次新增／修改檔執行 Prettier check；lint:fix 的無關修改不納入提交。
  若 verify 的 affected 範圍未包含某個修改 package，補跑該 package 的
  typecheck、lint 和本計畫指定測試，不能用「沒有測試被選中」聲稱通過。
  前端 build 與 realtime/API dry-run build 用現有 build scripts，驗證實際 bundle。

- [ ] **4. 獨立審查與提交。** 按所選 execution skill 完成審查，修正本次問題，
  只重跑受修正影響的測試；提交 `test(realtime): verify menu availability across live clients`。
  驗收紀錄列實際指令、pass/fail/skip、三個入口結果、限制與提交 SHA。
- [ ] **5. 處理 #441。** 已獲使用者授權關閉 issue，但推送／發布需另有明確授權。
  所有驗收通過且整合位置可取得後，透過 GitHub 寫入驗收證據並關閉為 completed。
  如只有本地提交或 stack 驗收不完整，保留開啟並具體列出剩餘項目。

## Self-review and handoff

- Spec 的訂閱隔離／限流：Task 1；三個入口／快取／成本：Task 2；顧客補讀：Task 3；
  後台／廚房：Task 4；真實串接與關閉：Task 5。
- Review Focus 五個項目皆有對應測試步驟。沒有新依賴、alarm 或歷史事件。
- 在實作前由使用者審閱本計畫並選 Native 或 Subagent-driven。
