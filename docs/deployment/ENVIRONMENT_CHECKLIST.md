# ✅ MakanMakan 環境配置檢查清單

> **Complete Environment Setup Checklist for All Deployment Stages**

本檢查清單用於確保 MakanMakan 系統在所有環境（Development、Production）中正確配置，涵蓋基礎設施、安全性、性能和監控等各個方面。

---

## 📋 使用說明

### 如何使用此檢查清單

1. **選擇目標環境**：根據你要配置的環境（Development/Production），選擇對應的章節
2. **逐項檢查**：按照清單順序，逐項完成配置並打勾
3. **記錄資訊**：在提供的空格中記錄重要的 ID、URL 等資訊
4. **驗證測試**：完成配置後，運行驗證測試確保一切正常
5. **存檔備份**：將完成的檢查清單存檔，作為環境配置文檔

### 檢查清單符號說明

- ✅ 必需項目（所有環境）
- 🔸 推薦項目（建議配置）
- 🔹 可選項目（根據需求）
- ⚠️ 安全相關（務必重視）
- 🔧 開發環境專用
- 🚀 生產環境專用

---

## 🏗️ 通用基礎設施檢查清單

適用於所有環境的基礎配置項目。

### Cloudflare 帳號設置

- [ ] ✅ Cloudflare 帳號已創建並驗證
  - Account ID: `_____________________________`
  - Account Email: `_____________________________`

- [ ] ✅ Workers Paid Plan 已訂閱
  - Plan Type: `□ Free  □ Workers Paid ($5/month)`
  - 訂閱日期: `_____________________________`

- [ ] ✅ 域名已添加到 Cloudflare
  - 主域名: `_____________________________`
  - Nameservers 已更新: `□ Yes  □ No`
  - SSL/TLS 模式: `□ Full (strict)`

### API Token 配置

- [ ] ✅ Cloudflare API Token 已創建
  - Token Name: `makanmakan-deployment`
  - 權限包含：
    - [ ] Workers Scripts - Edit
    - [ ] Workers KV Storage - Edit
    - [ ] D1 - Edit
    - [ ] R2 - Edit
    - [ ] DNS - Edit
  - Token (安全存儲): `已保存到密碼管理器 □`

- [ ] ✅ Wrangler CLI 已安裝並登入
  ```bash
  wrangler --version  # >= 4.0.0
  wrangler whoami     # 顯示已登入帳號
  ```

### 本地開發環境

- [ ] 🔧 Node.js 已安裝
  - 版本: `□ >= 22.18.0` (運行 `node --version`)

- [ ] 🔧 pnpm 已安裝
  - 版本: `□ 10.24.0`（`package.json` 的 `packageManager` 欄位鎖定，透過 corepack 強制，運行 `pnpm --version`）

- [ ] 🔧 專案依賴已安裝

  ```bash
  pnpm install  # 無錯誤完成 □
  ```

- [ ] 🔧 TypeScript 和 ESLint 通過
  ```bash
  pnpm run typecheck  # 0 errors □
  pnpm run lint       # 0 errors □
  ```

---

## 🔧 Development 環境檢查清單

本地開發環境配置。

### 環境變數配置

- [ ] ✅ `.dev.vars` 文件已創建
  - 位置：`apps/api/.dev.vars`
  - 包含以下變數：
    ```bash
    JWT_SECRET=local-dev-secret-min-32-chars  □
    CLOUDFLARE_API_TOKEN=your_token           □
    ```

- [ ] 🔸 可選服務 API Keys

  ```bash
  RESEND_API_KEY=re_xxxxxxxxxxxx              □
  TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxx       □
  TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxx        □
  SLACK_WEBHOOK_URL=https://hooks.slack.com/  □
  ```

- [ ] ⚠️ `.dev.vars` 已添加到 `.gitignore`
  ```bash
  grep -r ".dev.vars" .gitignore  # 應該找到 □
  ```

### 本地數據庫

- [ ] ✅ 本地 D1 數據庫已初始化

  ```bash
  wrangler d1 migrations apply makanmakan-local --local  □
  ```

- [ ] 🔸 測試數據已填充

  ```bash
  pnpm run db:seed:local  □
  ```

- [ ] ✅ 數據庫連接測試
  ```bash
  wrangler d1 execute makanmakan-local --local --command "SELECT COUNT(*) FROM users;"  □
  ```

### 本地服務啟動

- [ ] ✅ API Service 可以啟動

  ```bash
  cd apps/api && pnpm run dev
  # 訪問 http://localhost:8787/info  □
  ```

- [ ] ✅ Realtime Service 可以啟動

  ```bash
  cd apps/realtime && pnpm run dev
  # 訪問 http://localhost:8788/health  □
  ```

- [ ] ✅ Frontend Apps 可以啟動
  ```bash
  cd apps/customer-app && pnpm run dev      # localhost:3000 □
  cd apps/admin-dashboard && pnpm run dev   # localhost:3001 □
  cd apps/kitchen-display && pnpm run dev   # localhost:3002 □
  ```

### 開發工具

- [ ] 🔸 VS Code 擴展已安裝
  - [ ] ESLint
  - [ ] Prettier
  - [ ] Vue Language Features (Volar)
  - [ ] TypeScript Vue Plugin (Volar)

- [ ] 🔸 Git hooks 已配置
  ```bash
  # 檢查 pre-commit hook
  ls -la .git/hooks/pre-commit  □
  ```

---

## 🚀 Production 環境檢查清單

生產環境配置。

### 前置檢查

- [ ] ⚠️ 所有測試通過（單元、整合、端到端）
- [ ] ⚠️ 性能測試滿足要求
- [ ] ⚠️ 安全審計完成
- [ ] ⚠️ 備份計劃已確認
- [ ] ⚠️ 回滾計劃已準備

### D1 數據庫 (Production)

- [ ] ✅ Production 數據庫已創建

  ```bash
  wrangler d1 create makanmakan-prod
  ```

  - Database Name: `makanmakan-prod`
  - Database ID: `_____________________________`

- [ ] ✅ Database ID 已更新到配置文件
  - [ ] `apps/api/wrangler.toml` - `env.production.d1_databases`
  - [ ] `apps/realtime/wrangler.toml` - `env.production.d1_databases`
  - [ ] `apps/backup-scheduler/wrangler.toml` - `env.production.d1_databases`

- [ ] ✅ 數據庫遷移已應用

  ```bash
  wrangler d1 migrations apply makanmakan-prod --env production  □
  ```

- [ ] 🚀 數據庫備份已配置
  - 自動備份頻率: `每日 2:00 AM UTC`
  - 備份保留期: `30 天`
  - 備份位置: `R2 Bucket: makanmakan-backups-prod`

### KV Namespaces (Production)

- [ ] ✅ API Service KV Namespaces

  ```bash
  wrangler kv:namespace create "CACHE_KV" --env production
  ```

  - CACHE_KV ID: `_____________________________`

  ```bash
  wrangler kv:namespace create "RATE_LIMIT_KV" --env production
  ```

  - RATE_LIMIT_KV ID: `_____________________________`

  ```bash
  wrangler kv:namespace create "BACKUP_KV" --env production
  ```

  - BACKUP_KV ID: `_____________________________`

- [ ] ✅ Realtime Service KV Namespace

  ```bash
  wrangler kv:namespace create "REALTIME_CACHE" --env production
  ```

  - REALTIME_CACHE ID: `_____________________________`

- [ ] ✅ Image Processor KV Namespace

  ```bash
  wrangler kv:namespace create "IMAGE_CACHE" --env production
  ```

  - IMAGE_CACHE ID: `_____________________________`

- [ ] ✅ KV IDs 已更新到 wrangler.toml
  - [ ] `apps/api/wrangler.toml`
  - [ ] `apps/realtime/wrangler.toml`
  - [ ] `apps/image-processor/wrangler.toml`

### R2 Buckets (Production)

- [ ] ✅ Backup Storage Bucket 已創建

  ```bash
  wrangler r2 bucket create makanmakan-backups-prod  □
  ```

- [ ] 🚀 Image Storage Bucket 已創建

  ```bash
  wrangler r2 bucket create makanmakan-images-prod  □
  ```

- [ ] ✅ Bucket 名稱已更新到 wrangler.toml
  - [ ] `apps/api/wrangler.toml`
  - [ ] `apps/backup-scheduler/wrangler.toml`
  - [ ] `apps/image-processor/wrangler.toml`

- [ ] 🚀 Map Tiles Bucket / Object 已準備（若使用 Protomaps PMTiles）
  - [ ] `makanmakan-map-tiles-prod` 或等效 production bucket 已建立
  - [ ] production PMTiles archive 已上傳
  - [ ] public/custom domain URL 可被瀏覽器讀取
  - [ ] CORS 已允許 PMTiles Range requests

### Customer App Map Variables (Production)

- [ ] 🚀 `VITE_MAP_PM_TILES_URL` plus `VITE_MAP_GLYPHS_URL`，或 `VITE_MAP_STYLE_URL`，已在 Customer App Pages production 環境設定
- [ ] 🚀 若使用 `VITE_MAP_PM_TILES_URL`，URL 指向 production R2/custom-domain PMTiles object
- [ ] 🚀 若使用 `VITE_MAP_GLYPHS_URL`，URL 指向 production glyph PBF path
- [ ] 🚀 PMTiles object 支援 browser Range requests（`HEAD` 回 `Accept-Ranges: bytes`，`Range: bytes=0-16383` 回 `206 Partial Content`）
- [ ] 🚀 手機瀏覽 `/markets/:slug` 時外部市場地圖可載入，且攤位示意圖仍保留

### Secrets (Production)

- [ ] ⚠️ JWT_SECRET 已設置

  ```bash
  openssl rand -hex 32 > prod-jwt-secret.txt  # 安全存儲於密碼管理器
  wrangler secret put JWT_SECRET --env production  □
  ```

- [ ] ⚠️ CLOUDFLARE_API_TOKEN 已設置

  ```bash
  wrangler secret put CLOUDFLARE_API_TOKEN --env production  □
  ```

- [ ] 🚀 通知服務 Secrets

  ```bash
  wrangler secret put RESEND_API_KEY --env production           □
  wrangler secret put TWILIO_ACCOUNT_SID --env production       □
  wrangler secret put TWILIO_AUTH_TOKEN --env production        □
  wrangler secret put SLACK_WEBHOOK_URL --env production        □
  ```

- [ ] 🚀 圖片處理資源

  ```bash
  wrangler r2 bucket create makanmasak-images-prod                □
  wrangler secret put JWT_SECRET --env production                 □
  ```

- [ ] 🚀 GitHub production environment secrets
  - [ ] `PRODUCTION_URL`（API `/info` + customer app liveness）
  - [ ] `PRODUCTION_KITCHEN_URL`（Kitchen Display Pages liveness）

- [ ] ✅ Secrets 驗證
  ```bash
  wrangler secret list --env production  # 確認所有必需 secrets 已設置 □
  ```

### Analytics Engine (Production)

- [ ] 🚀 Analytics Dataset 已創建

  ```bash
  # 注意：需要手動在 Cloudflare Dashboard 創建
  # Dashboard → Analytics → Analytics Engine → Create Dataset
  ```

  - Dataset Name: `makanmakan-metrics-prod`
  - 已添加到 `apps/api/wrangler.toml`: `□`

### DNS 配置 (Production)

- [ ] ✅ 主域名 DNS 記錄已添加
  - [ ] `api.makanmakan.com` → API Service (CNAME, Proxied)
  - [ ] `realtime.makanmakan.com` → Realtime Service (CNAME, Proxied)
  - [ ] `images.makanmakan.com` → Image Processor (CNAME, Proxied)

- [ ] ✅ Pages Custom Domains 已配置
  - [ ] `makanmakan.com` → Customer App
  - [ ] `admin.makanmakan.com` → Admin Dashboard
  - [ ] `kitchen.makanmakan.com` → Kitchen Display

- [ ] ✅ SSL/TLS 配置
  - SSL/TLS 加密模式: `□ Full (strict)`
  - Always Use HTTPS: `□ Enabled`
  - Automatic HTTPS Rewrites: `□ Enabled`
  - Minimum TLS Version: `□ TLS 1.2`
  - TLS 1.3: `□ Enabled`

### 安全配置 (Production)

- [ ] ⚠️ WAF (Web Application Firewall) 已啟用
  - 位置: Dashboard → Security → WAF
  - Managed Rules: `□ Enabled`
  - Rate Limiting Rules: `□ Configured`

- [ ] ⚠️ DDoS Protection 已驗證
  - 位置: Dashboard → Security → DDoS
  - Status: `□ Active`

- [ ] ⚠️ Bot Management
  - Bot Fight Mode: `□ Enabled`
  - Super Bot Fight Mode (if available): `□ Enabled`

- [ ] ⚠️ Security Headers 已配置
  - 在 Worker 代碼中驗證以下 headers:
    - [ ] `Content-Security-Policy`
    - [ ] `X-Content-Type-Options: nosniff`
    - [ ] `X-Frame-Options: DENY`
    - [ ] `X-XSS-Protection: 1; mode=block`
    - [ ] `Strict-Transport-Security`

### 性能配置 (Production)

- [ ] 🚀 Caching 策略已配置
  - Browser Cache TTL: `□ Respect Existing Headers`
  - Edge Cache TTL: `□ Configured per route`

- [ ] 🚀 Smart Placement 已啟用
  - 位置: `apps/api/wrangler.toml` - `env.production.placement`
  - Mode: `□ smart`
  - Strategy: `□ closest`
  - Hints: `□ asia-southeast1` (或根據用戶地理位置調整)

- [ ] 🚀 Compression 已啟用
  - 位置: Dashboard → Speed → Optimization
  - Brotli: `□ Enabled`

### 監控與告警 (Production)

- [ ] 🚀 Cloudflare Analytics 已啟用
  - Workers Analytics: `□ Active`
  - Web Analytics (Pages): `□ Active`

- [ ] 🚀 錯誤通知已配置
  - Slack Webhook: `□ Configured`
  - 測試通知: `□ Received`

- [ ] 🚀 健康檢查監控
  - 配置外部監控服務（如 UptimeRobot, Pingdom）
  - 監控端點: `https://api.makanmakan.com/info`
  - 檢查頻率: `□ 每 5 分鐘`
  - 告警接收人: `_____________________________`

### 部署 (Production)

- [ ] ⚠️ 部署前最終檢查
  - [ ] Code review 完成
  - [ ] 團隊已通知部署時間
  - [ ] 維護視窗已確認（如需要）
  - [ ] 回滾計劃已準備

- [ ] ✅ Backend Services 部署

  ```bash
  pnpm run deploy:prod  □
  ```

  或分別部署：

  ```bash
  cd apps/api && wrangler deploy --env production              □
  cd apps/realtime && wrangler deploy --env production         □
  cd apps/image-processor && wrangler deploy --env production  □
  cd apps/backup-scheduler && wrangler deploy --env production □
  ```

- [ ] ✅ Frontend Apps 部署
  ```bash
  cd apps/customer-app && pnpm run build && wrangler pages deploy dist --project-name makanmakan-customer-prod     □
  cd apps/admin-dashboard && pnpm run build && wrangler pages deploy dist --project-name makanmakan-admin-prod    □
  cd apps/kitchen-display && pnpm run build && wrangler pages deploy dist --project-name makanmakan-kitchen-prod  □
  ```

### 部署後驗證 (Production)

- [ ] ✅ Health Checks 通過

  ```bash
  curl https://api.makanmakan.com/info        # 應返回 200 □
  curl https://realtime.makanmakan.com/health          # 應返回 200 □
  curl https://makanmakan.com                          # 應返回 200 □
  curl https://kitchen.makanmakan.com                  # 應返回 HTML / 200 □
  ```

- [ ] ✅ 功能測試（關鍵路徑）
  - [ ] 用戶可以訪問主頁
  - [ ] 用戶可以登入/註冊
  - [ ] 可以查看菜單
  - [ ] 可以創建訂單
  - [ ] WebSocket 連接正常
  - [ ] 管理後台可訪問
  - [ ] 廚房顯示系統正常

- [ ] ✅ 性能測試
  - [ ] API 響應時間 < 300ms (P99)
  - [ ] 頁面加載時間 < 2s
  - [ ] WebSocket 延遲 < 50ms

- [ ] ✅ 安全測試
  - [ ] HTTPS 強制重定向
  - [ ] CORS headers 正確
  - [ ] Rate limiting 生效
  - [ ] JWT 認證正常

- [ ] 🚀 監控就緒
  - [ ] 實時日誌可查看
    ```bash
    wrangler tail makanmakan-api-prod  □
    ```
  - [ ] 錯誤告警正常發送
  - [ ] Analytics 數據正在收集

### 部署後任務

- [ ] 📝 更新部署文檔
  - [ ] 記錄部署時間
  - [ ] 記錄部署版本
  - [ ] 記錄遇到的問題和解決方案

- [ ] 📢 通知團隊
  - [ ] 部署完成通知
  - [ ] 新功能說明（如有）
  - [ ] 已知問題列表（如有）

- [ ] 🔍 持續監控（至少 24 小時）
  - [ ] 錯誤率監控
  - [ ] 性能指標監控
  - [ ] 用戶反饋收集

---

## 🔐 安全檢查清單

所有環境都應該完成的安全檢查。

### 代碼安全

- [ ] ⚠️ 沒有硬編碼的秘密或密鑰

  ```bash
  grep -r "JWT_SECRET.*=" apps/  # 不應找到硬編碼值 □
  grep -r "API_KEY.*=" apps/     # 不應找到硬編碼值 □
  ```

- [ ] ⚠️ 所有秘密使用 `wrangler secret` 管理
- [ ] ⚠️ `.dev.vars` 已添加到 `.gitignore`
- [ ] ⚠️ 沒有敏感數據提交到版本控制

### 認證與授權

- [ ] ⚠️ JWT token 使用足夠長的 secret (>= 32 字符)
- [ ] ⚠️ Token 過期時間合理（建議 24 小時）
- [ ] ⚠️ 刷新 token 機制已實現
- [ ] ⚠️ 角色權限驗證已實現

### 輸入驗證

- [ ] ⚠️ 所有用戶輸入經過驗證
- [ ] ⚠️ SQL 查詢使用參數化
- [ ] ⚠️ 敏感操作有二次確認

### 網絡安全

- [ ] ⚠️ HTTPS 強制啟用
- [ ] ⚠️ CORS 正確配置
- [ ] ⚠️ Rate limiting 已啟用
- [ ] ⚠️ Security headers 已設置

---

## 📊 性能檢查清單

### 緩存策略

- [ ] 🔸 多層緩存已實現
  - [ ] 內存緩存 (Worker 級別)
  - [ ] KV 緩存 (全局)
  - [ ] 瀏覽器緩存

- [ ] 🔸 緩存失效策略已實現
  - [ ] TTL 設置合理
  - [ ] 手動失效機制

### 數據庫優化

- [ ] 🔸 關鍵表已添加索引
  - [ ] `orders` 表
  - [ ] `menu_items` 表
  - [ ] `users` 表

- [ ] 🔸 查詢優化
  - [ ] 使用 `SELECT` 指定列
  - [ ] 避免 `SELECT *`
  - [ ] 使用分頁

### 前端性能

- [ ] 🔸 Code Splitting 已實現
- [ ] 🔸 懶加載已實現
- [ ] 🔸 圖片優化
  - [ ] WebP 格式
  - [ ] 響應式圖片
  - [ ] Lazy loading

---

## 🎯 驗證腳本

### 自動化驗證腳本

```bash
#!/bin/bash
# verify-environment.sh - 自動驗證環境配置

ENVIRONMENT=$1  # production

if [ -z "$ENVIRONMENT" ]; then
  echo "Usage: ./verify-environment.sh [production]"
  exit 1
fi

echo "=== Verifying $ENVIRONMENT Environment ==="

# 1. Health Checks
echo "1. Health Checks..."
curl -sf https://api-${ENVIRONMENT}.makanmakan.com/info || echo "❌ API Health Check Failed"
curl -sf https://realtime-${ENVIRONMENT}.makanmakan.com/health || echo "❌ Realtime Health Check Failed"

# 2. Database Connection
echo "2. Database Connection..."
wrangler d1 execute makanmakan-${ENVIRONMENT} --command "SELECT 1" > /dev/null 2>&1 || echo "❌ Database Connection Failed"

# 3. Secrets
echo "3. Checking Secrets..."
wrangler secret list --env ${ENVIRONMENT} | grep "JWT_SECRET" || echo "❌ JWT_SECRET not set"

# 4. DNS
echo "4. DNS Configuration..."
nslookup api-${ENVIRONMENT}.makanmakan.com || echo "❌ DNS not configured"

echo "=== Verification Complete ==="
```

### 使用方式

```bash
# 驗證 Production
./verify-environment.sh production
```

---

## 📝 完成後存檔

### 環境配置信息記錄

完成檢查清單後，請記錄以下信息：

```
Environment: [Development / Production]
配置完成日期: _______________
配置人員: _______________

資源 IDs:
- D1 Database ID: _____________________________
- CACHE_KV ID: _____________________________
- RATE_LIMIT_KV ID: _____________________________
- BACKUP_KV ID: _____________________________
- R2 Backup Bucket: _____________________________

域名配置:
- API URL: _____________________________
- Realtime URL: _____________________________
- Customer App URL: _____________________________
- Admin Dashboard URL: _____________________________

重要注意事項:
_______________________________________________
_______________________________________________
_______________________________________________

遇到的問題及解決方案:
_______________________________________________
_______________________________________________
_______________________________________________
```

---

## 🆘 問題排查

如果遇到問題，請參考：

1. **故障排除指南**: [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)
2. **部署指南**: [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md)
3. **團隊支持**: Slack #makanmakan-ops

---

**最後更新**: 2025-11-11
**維護者**: MakanMakan DevOps Team
**版本**: 2.0.0
