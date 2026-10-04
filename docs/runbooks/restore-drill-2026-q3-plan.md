# 2026 Q3 還原演練計畫

> 狀態：**規劃中，尚未執行**。執行前由操作者確認日期，執行後把結果回填到
> [backup-restore-runbook.md](./backup-restore-runbook.md)，本檔保留為紀錄。
>
> 對應 `.github/workflows/restore-drill-reminder.yml` 在 2026-09-30 開出的季度提醒 issue。

## 1. 為什麼還要再演練一次

2026-07-30 已經演練過一次，證明了以下幾件事（詳見 runbook）：

- 在一顆拋棄式資料庫上，Time Travel 能把一般資料列、FTS5 索引和同步 trigger 一起還原。
- 還原可以反悔：還原完成時印出的 undo bookmark 能退回還原前的狀態。
- `wrangler d1 export` 在正式庫上不能用（因為 fts5 虛擬表）。

那次**沒有**驗證的缺口，正是這次的範圍：

| # | 缺口 | 為什麼重要 |
| --- | --- | --- |
| G1 | **資料庫被整顆刪除時，完全沒有保護。** Time Travel 只作用在仍存在的資料庫，刪了就一起消失；`export` 又在正式庫上失敗。 | 2026-06-17 已經發生過一次（`mcis-db`，見 `docs/incidents/2026-06-17-mcis-db-deletion.md`）。目前 `makanmasak-prod` 被刪就是永久遺失。 |
| G2 | **兩顆資料庫還原到同一時間點，從沒練過。** runbook 只把它列為風險。 | 管理庫 `tenants.platform_restaurant_id` 指向平台庫 `restaurants.id`，只還原一邊會讓兩邊對不上。 |
| G3 | **沒有凍結寫入的機制。** runbook 的正式還原第 1 步寫「Freeze writes if possible」，但程式裡沒有任何維護模式或唯讀開關。 | 還原期間持續寫入的資料，會在還原時一起被覆蓋掉。 |
| G4 | **只量過還原指令本身的秒數，沒量過整體 RTO。** | 真實事故的時間花在判斷該還原到哪個 bookmark、驗證、煙霧測試，不是指令本身。 |
| G5 | **管理庫的 schema 沒被納入演練。** 上次只複製了平台庫的高風險結構。 | 管理庫是另一顆獨立的資料庫，有自己的 bookmark。 |

## 2. 不做的事

- **不在正式庫上演練任何還原。** Time Travel 是原地覆蓋，正式庫上的演練本身就是事故。
- 不演練 KV、R2、Queue：Time Travel 不涵蓋它們，runbook 已經寫明還原後的處理方式。
- 本次不修改任何正式環境設定。演練結論需要的改動（例如 G1 的備份排程、G3 的唯讀開關）另開 issue 決定。

## 3. 安全規則（每一條都來自過去的事故或演練）

1. **動手前核對帳號。** 先跑 `pnpm wrangler whoami`，確認帳號 ID 是
   `bdddc08c066a9abc285d75fe5947a468`。不要用 Cloudflare MCP 做任何建立或刪除操作：
   它綁的是另一個帳號，2026-06-17 的誤刪就是這樣發生的。
2. **破壞性指令只由操作者在互動式終端機執行。** 這裡指 `d1 create`、`d1 delete`、
   `time-travel restore`。在非互動環境中，wrangler 的確認提示會自動回答 yes，
   `check:no-automated-destructive-wrangler` 也禁止把它們寫進腳本。Claude 負責準備指令、
   驗證查詢、計時和記錄。
3. **每一個被動到的資料庫，名稱都要包含 `drill`。** 執行任何破壞性指令前，把資料庫名稱唸出來再按 Enter。
4. 每次還原後，**先抄下 undo bookmark**，再做任何其他事。

## 4. 演練內容

演練資料庫：`makanmasak-drill-platform`、`makanmasak-drill-mgmt`（演練結束後刪除）。

### 情境 A：誤刪資料，兩顆庫同時還原（補 G2、G4、G5）

模擬的事故：一個錯誤的 migration 同時清掉平台庫的 `orders`，以及管理庫的 `tenants.platform_restaurant_id`。

1. 建立兩顆演練庫。
2. 從正式庫的 `sqlite_master` 取出 schema（唯讀查詢，runbook 的〈Forensics without export〉已有指令），
   在演練庫**逐條**執行（`--command` 一次一條；用 `--file` 批次執行在 D1 上會部分寫入且報錯不明）。
   - 平台庫：`restaurants`、`orders`、`dish_search_index`、`dish_search_fts` 及它的 3 個 trigger。
   - 管理庫：`tenants`、`shop_subscriptions`、`onboarding_applications`。
3. 灌入合成的測試資料（不用正式資料）：3 家店、每家 20 筆訂單、對應的 3 筆 tenant。
4. **基準驗證**，記錄結果：兩庫各表筆數、一個 `dish_search_fts MATCH` 查詢，以及下方的跨庫一致性查詢。
5. 兩庫各跑一次 `time-travel info`，記下 good bookmark 與時間。
6. 造成損害：刪除平台庫的 `orders`，並把管理庫的 `platform_restaurant_id` 設為 NULL。
7. **從這一刻開始計時（RTO 起點）**，照 runbook 的〈Production Restore〉流程走：
   1. 記下兩庫目前的 bookmark。
   2. 用 `info --timestamp=` 預覽要還原的時間點。
   3. **依 bookmark** 分別還原兩庫。
   4. 抄下兩個 undo bookmark。
8. 驗證，全部與第 4 步的基準一致：筆數、FTS 的 `MATCH`、trigger 數量、跨庫一致性。
9. **停止計時（RTO 終點）**。分別記錄三段時間：判斷要還原到哪裡、執行還原、驗證。
10. 反悔測試：用 undo bookmark 退回損壞狀態，確認退得回去；再還原回 good bookmark。

跨庫一致性檢查的做法：兩庫無法 JOIN，所以各自查出 ID 清單後在本機比對。

```sql
-- 管理庫
SELECT platform_restaurant_id FROM tenants WHERE platform_restaurant_id IS NOT NULL ORDER BY 1;
-- 平台庫
SELECT id FROM restaurants ORDER BY 1;
```

通過條件：管理庫查到的每一個 `platform_restaurant_id`，都能在平台庫查到。

### 情境 B：整顆資料庫被刪除（補 G1，本次最重要）

要回答的問題：**在 export 無法使用的前提下，能不能用別的方法做出一份放在 Cloudflare D1 之外的備份，並從它重建出一顆可用的資料庫？**

1. 在 `makanmasak-drill-platform`（情境 A 結束時的狀態）上試逐表匯出：
   `wrangler d1 export <db> --remote --table=<table>`，**只匯出一般資料表**，跳過 `dish_search_fts` 與它的影子表。
   - 先確認：當資料庫裡有 fts5 虛擬表時，`--table` 匯出一般表是否可行。這是整個情境的前提，失敗就改用下面的備案。
   - 備案：對每張表跑 `SELECT *` 轉成 JSON，搭配 `sqlite_master` 取出的 schema，作為備份。
2. 另外匯出 schema：`sqlite_master` 中所有 `table`、`index`、`trigger` 的 `sql`。
3. 建立一顆全新的 `makanmasak-drill-rebuilt`，依序執行：一般表 schema → 資料 → FTS 虛擬表 → trigger →
   重建 FTS 索引：`INSERT INTO dish_search_fts(dish_search_fts) VALUES('rebuild')`。
   `dish_search_fts` 是外部內容表（`content='dish_search_index'`），所以 FTS 的影子表不用備份，
   用 `rebuild` 就能從 `dish_search_index` 重新產生整個索引。
4. 用情境 A 第 4 步的同一組查詢驗證。
5. 記錄：備份檔大小、匯出耗時、重建耗時，以及哪些步驟需要手動介入。

演練結束後要做的決定：若情境 B 可行，另開 issue 設計定期的站外備份（例如 cron 觸發、存到 R2 的另一個 bucket，
或存到 Cloudflare 以外）。**這是本季最值得投資的一件事**：Time Travel 防誤改，只有站外備份防誤刪。

### 情境 C：凍結寫入（補 G3，桌上推演，不動任何系統）

一起走過一次事故流程，回答以下問題：

- 還原期間，哪些寫入來源仍在跑？包括顧客下單、廚房更新狀態、cron（每 5 分鐘的對帳）、Queue consumer。
- 現在要停掉它們，實際能做的是什麼？（例如暫時把 Worker 路由指到維護頁、關閉 cron trigger 後重新部署。）每一種各要多久？
- 要不要做一個正式的唯讀或維護模式開關？若要，另開 issue。

## 5. 成功標準

- 情境 A：兩庫的筆數、FTS 查詢、trigger 數量、跨庫一致性全部與基準一致；undo bookmark 反悔測試成功；
  RTO 分段時間有紀錄。
- 情境 B：得出明確的「可行／不可行」結論與實測數字；若可行，重建出的資料庫通過同一組驗證。
- 情境 C：寫下目前能凍結寫入的方法與所需時間，並對「是否要建唯讀開關」做出決定。
- 所有演練庫都已刪除：`pnpm wrangler d1 list` 中不再有名稱含 `drill` 的資料庫。

## 6. 角色與時間

| 項目 | 內容 |
| --- | --- |
| 操作者 | 你：執行所有 create、delete、restore 指令 |
| 協作 | Claude：準備每一步的指令與 SQL、執行唯讀查詢、計時、記錄證據、事後更新 runbook |
| 時長 | 預估 2–3 小時：情境 A 約 1 小時、B 約 1 小時、C 約 30 分鐘 |
| 時段 | 待定；建議選平日白天，避開用餐尖峰 |
| 費用 | 演練庫極小，Time Travel 與還原本身不另收費 |

## 7. 演練後要更新的文件

- `backup-restore-runbook.md`：
  - 補上兩庫同步還原的實際步驟與一致性查詢；
  - 把 RTO 的「minutes」換成實測的分段數字；
  - 寫明刪除情境的結論；
  - 把〈Production Restore〉第 1 步的「Freeze writes if possible」改成實際可行的做法。
- 季度提醒 issue：附上本次證據（bookmark、查詢輸出、計時）後關閉。
