# 📦 MakanMakan 完整部署指南

> **Production-Ready Deployment Guide for Cloudflare Workers + D1**

本指南提供 MakanMakan 系統從零到生產環境的完整部署流程，包含環境配置、資源創建、部署步驟及驗證測試。

---

## 📋 目錄

- [部署架構總覽](#部署架構總覽)
- [前置需求](#前置需求)
- [環境準備](#環境準備)
- [Cloudflare 資源創建](#cloudflare-資源創建)
- [應用部署流程](#應用部署流程)
- [DNS 與域名配置](#dns-與域名配置)
- [生產環境驗證](#生產環境驗證)
- [監控與日誌](#監控與日誌)
- [備份與恢復](#備份與恢復)
- [持續部署 (CI/CD)](#持續部署-cicd)

---

## 🏗️ 部署架構總覽

### 系統組件

```
┌────────────────────────────────────────────────────────┐
│                   Cloudflare Edge                      │
├────────────────────────────────────────────────────────┤
│                                                        │
│  Frontend Apps (Cloudflare Pages)                     │
│  ├─ Customer App       (customer.makanmakan.com)      │
│  ├─ Admin Dashboard    (admin.makanmakan.com)         │
│  └─ Kitchen Display    (kitchen.makanmakan.com)       │
│                                                        │
│  Backend Services (Cloudflare Workers)                │
│  ├─ API Service        (api.makanmakan.com)           │
│  ├─ Realtime Service   (realtime.makanmakan.com)      │
│  ├─ Image Processor    (images.makanmakan.com)        │
│  └─ Backup Scheduler   (scheduled, no domain)         │
│                                                        │
│  Data Layer                                           │
│  ├─ D1 Database        (Serverless SQL)               │
│  ├─ KV Namespaces      (Cache, Rate Limit)            │
│  ├─ R2 Buckets         (Backups, Images)              │
│  └─ Durable Objects    (WebSocket Sessions)           │
│                                                        │
└────────────────────────────────────────────────────────┘
```

### 部署環境對應

| 環境            | 用途       | 域名範例        | 資料庫        | 說明       |
| --------------- | ---------- | --------------- | ------------- | ---------- |
| **Development** | 本地開發   | localhost:\*    | Local SQLite  | 開發測試用 |
| **Production**  | 正式環境   | makanmakan.com  | D1 Production | 線上服務   |

---

## 📋 前置需求

### 1. 開發環境

- **Node.js**: >= 22.18.0
- **pnpm**: 10.24.0（`packageManager` 欄位鎖定，透過 corepack 強制）
- **Git**: 版本控制工具
- **Terminal**: Bash/PowerShell/Zsh

```bash
# 驗證環境
node --version    # 應該 >= v22.18.0
pnpm --version    # 應該是 10.24.0
git --version     # 任意版本
```

### 2. Cloudflare 帳號

- ✅ **Cloudflare 帳號** (免費或付費計畫)
- ✅ **Workers Paid Plan** (必需，用於 D1、R2、Durable Objects)
- ✅ **域名** (可在 Cloudflare 註冊或轉移)
- ✅ **API Token** (具備相關權限)

#### 創建 Cloudflare API Token

1. 登入 Cloudflare Dashboard: https://dash.cloudflare.com
2. 進入 **My Profile** → **API Tokens**
3. 點擊 **Create Token**
4. 選擇 **Edit Cloudflare Workers** 範本
5. 配置權限：
   - **Account Resources**: Workers Scripts (Edit)
   - **Account Resources**: Workers KV Storage (Edit)
   - **Account Resources**: D1 (Edit)
   - **Account Resources**: R2 (Edit)
   - **Zone Resources**: DNS (Edit)
6. 複製 Token 並妥善保存

```bash
# 設置環境變數（建議加到 ~/.bashrc 或 ~/.zshrc）
export CLOUDFLARE_API_TOKEN="your_token_here"
```

### 3. 安裝 Wrangler CLI

```bash
# 全域安裝 Wrangler
pnpm install -g wrangler

# 驗證安裝
wrangler --version  # 應該 >= 4.0.0

# 登入 Cloudflare
wrangler login
# 這會開啟瀏覽器進行授權
```

### 4. 克隆專案

```bash
# 克隆倉庫
git clone https://github.com/your-org/makanmakan.git
cd makanmakan

# 安裝依賴
pnpm install

# 驗證 TypeScript 和 ESLint
pnpm run typecheck
pnpm run lint
```

---

## ⚙️ 環境準備

### 1. 環境變數配置

#### Local Development (.dev.vars)

在各個 Worker 應用目錄創建 `.dev.vars` 文件：

```bash
# apps/api/.dev.vars
JWT_SECRET=your-local-jwt-secret-min-32-characters
INTERNAL_API_TOKEN=your-local-internal-api-token-min-32-characters
CLOUDFLARE_API_TOKEN=your_api_token
RESEND_API_KEY=your_resend_api_key
TWILIO_ACCOUNT_SID=your_twilio_sid
TWILIO_AUTH_TOKEN=your_twilio_token
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL

# apps/realtime/.dev.vars
JWT_SECRET=your-local-jwt-secret-min-32-characters

# apps/management-api/.dev.vars
# ⚠️ 必須與 apps/api/.dev.vars 的 JWT_SECRET 完全相同（見下方說明）
JWT_SECRET=your-local-jwt-secret-min-32-characters
# ⚠️ 必須與 apps/api/.dev.vars 的 INTERNAL_API_TOKEN 完全相同（見下方說明）
INTERNAL_API_TOKEN=your-local-internal-api-token-min-32-characters

# apps/image-processor/.dev.vars
JWT_SECRET=your-local-jwt-secret-min-32-characters
```

⚠️ **重要**: `.dev.vars` 文件已在 `.gitignore` 中，**絕不提交到版本控制**！

> **跨 Worker JWT_SECRET 對齊（onboarding 必需）**
> 平台 onboarding 頁面（`/dashboard/platform/onboarding`）的 admin dashboard 先登入
> `apps/api`（8787），再呼叫 `apps/management-api`（8789）的
> `POST /api/v1/auth/exchange` 把 token 換成 management token。`/auth/exchange`
> 用 `env.JWT_SECRET` 驗證 `apps/api` 簽出的 token，因此
> **`apps/management-api` 與 `apps/api` 的 `JWT_SECRET` 必須一致**。
> 兩者不同會導致 exchange 回 `401 Invalid or expired API token`，onboarding 頁面無法載入。
> 範本見 `apps/management-api/.dev.vars.example`。

> **跨 Worker INTERNAL_API_TOKEN 對齊（tenant provisioning 必需）**
> `apps/api` 建立餐廳時會透過 `MANAGEMENT_API` service binding 呼叫
> `apps/management-api` 的 `/api/v1/internal/platform-restaurants/*` 路由。
> `apps/api` 會用 `INTERNAL_API_TOKEN` 填入 `X-Internal-API-Token` header，
> `apps/management-api` 會用同名 secret 驗證。兩個 Worker 同一環境的
> **`INTERNAL_API_TOKEN` 必須一致**；缺值時 `apps/api` 會拋
> `INTERNAL_API_TOKEN is not configured`，不一致時 internal route 會回 401。

#### Production Secrets

生產環境的秘密使用 `wrangler secret` 命令管理：

```bash
# === JWT Secret (必需) ===
# 生成安全的 JWT secret (64 字符)
openssl rand -hex 32

# 為 production 設置
wrangler secret put JWT_SECRET --env production
# 粘貼生成的 secret

# === Management API JWT_SECRET (onboarding 必需) ===
# apps/management-api 的 /auth/exchange 用 JWT_SECRET 驗證 apps/api 簽出的 token，
# 因此 management-api 的 JWT_SECRET 必須與 apps/api 完全相同。
# 在 apps/management-api 目錄設置相同的值：
wrangler secret put JWT_SECRET --env production    # = apps/api production 的 JWT_SECRET
# 驗證：兩個 Worker 的 secret 一致，否則 onboarding 換 token 會 401。

# === Internal API Token (tenant provisioning 必需) ===
# 生成安全的 internal token (64 字符)
openssl rand -hex 32

# apps/api 與 apps/management-api 必須使用完全相同的值。
wrangler secret put INTERNAL_API_TOKEN --env production --config apps/api/wrangler.toml
wrangler secret put INTERNAL_API_TOKEN --env production --config apps/management-api/wrangler.toml

# 部署前可檢查兩個 Worker 是否都有設定（Cloudflare 不會回傳 secret 值）：
scripts/verify-internal-api-token-secrets.sh production

# === API Tokens (選用) ===
# Cloudflare API Token
wrangler secret put CLOUDFLARE_API_TOKEN --env production

# Email Service (Resend)
wrangler secret put RESEND_API_KEY --env production

# SMS Service (Twilio)
wrangler secret put TWILIO_ACCOUNT_SID --env production
wrangler secret put TWILIO_AUTH_TOKEN --env production

# Error Notifications (Slack)
wrangler secret put SLACK_WEBHOOK_URL --env production

# Image Processing
wrangler secret put JWT_SECRET --env production
```

#### 驗證 Secrets

```bash
# 列出已設置的 secrets
wrangler secret list --env production

# 注意：此命令只顯示 secret 名稱，不會顯示值
```

---

## ☁️ Cloudflare 資源創建

### 1. D1 數據庫

#### 創建數據庫

```bash
# Production 數據庫
wrangler d1 create makanmakan-prod

# 輸出範例：
# ✅ Successfully created DB 'makanmakan-prod'
#
# [[d1_databases]]
# binding = "DB"
# database_name = "makanmakan-prod"
# database_id = "yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy"
```

#### 更新 Database ID

複製輸出中的 `database_id`，更新以下文件：

**apps/api/wrangler.toml**:

```toml
[[env.production.d1_databases]]
binding = "DB"
database_name = "makanmakan-prod"
database_id = "yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy"  # 替換這裡
```

同樣更新：

- `apps/realtime/wrangler.toml`
- `apps/backup-scheduler/wrangler.toml`

#### 應用數據庫遷移

```bash
# 應用到 Production
wrangler d1 migrations apply makanmakan-prod --env production

# 驗證遷移
wrangler d1 execute makanmakan-prod --command "SELECT name FROM sqlite_master WHERE type='table';"
```

### 2. KV Namespaces

#### 創建 KV Namespaces

```bash
# === API Service KV Namespaces ===
# Cache
wrangler kv:namespace create "CACHE_KV" --env production

# Rate Limiting
wrangler kv:namespace create "RATE_LIMIT_KV" --env production

# Backup Metadata
wrangler kv:namespace create "BACKUP_KV" --env production


# === Realtime Service KV Namespaces ===
wrangler kv:namespace create "REALTIME_CACHE" --env production


# === Image Processor KV Namespaces ===
wrangler kv:namespace create "IMAGE_CACHE" --env production
```

#### 記錄 Namespace IDs

每次創建會輸出：

```
✅ Success! Created KV namespace "CACHE_KV"
id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

#### 更新 Wrangler 配置

**apps/api/wrangler.toml**:

```toml
[[env.production.kv_namespaces]]
binding = "CACHE_KV"
id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"  # 替換

[[env.production.kv_namespaces]]
binding = "RATE_LIMIT_KV"
id = "yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"  # 替換

[[env.production.kv_namespaces]]
binding = "BACKUP_KV"
id = "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"  # 替換
```

同樣更新其他 Workers 的配置。

### 3. R2 Buckets

#### 創建 R2 Buckets

```bash
# Backup Storage
wrangler r2 bucket create makanmakan-backups-prod

# Image Storage (如需要)
wrangler r2 bucket create makanmakan-images-prod
```

#### 更新 Wrangler 配置

**apps/api/wrangler.toml**:

```toml
[[env.production.r2_buckets]]
binding = "BACKUP_STORAGE"
bucket_name = "makanmakan-backups-prod"
```

### 4. Analytics Engine (Production Only)

```bash
# 創建 Analytics Dataset
wrangler analytics-engine create makanmakan-metrics-prod
```

**apps/api/wrangler.toml** (production only):

```toml
[[env.production.analytics_engine_datasets]]
binding = "ANALYTICS"
dataset = "makanmakan-metrics-prod"
```

---

## 🚀 應用部署流程

### 部署順序

按照依賴關係部署：

1. **Backend Services**
   - API Service
   - Realtime Service
   - Image Processor
   - Backup Scheduler

2. **Frontend Apps**
   - Customer App
   - Admin Dashboard
   - Kitchen Display

### 1. 部署 Backend Services

```bash
# === 方法 1: 全部一起部署 ===
pnpm run deploy:prod

# === 方法 2: 單獨部署各服務 ===
# API Service
cd apps/api
pnpm run deploy:prod

# Realtime Service
cd apps/realtime
pnpm run deploy:prod

# Image Processor
cd apps/image-processor
pnpm run deploy:prod

# Backup Scheduler
cd apps/backup-scheduler
pnpm run deploy:prod
```

#### 驗證部署

```bash
# 查看 Workers 列表
wrangler deployments list --name makanmakan-api-prod

# 查看實時日誌
wrangler tail makanmakan-api-prod

# 測試 API Health Endpoint
curl https://api.makanmakan.com/info
```

### 2. 部署 Frontend Apps

#### 使用 Cloudflare Pages

```bash
# === 方法 1: 透過 Git 自動部署 ===
# 1. 將 repo 連接到 Cloudflare Pages
# 2. 設置 build 配置：
#    - Framework preset: Vue
#    - Build command: pnpm run build
#    - Build output directory: dist
#    - Root directory: apps/customer-app (或其他 app)

# === 方法 2: 透過 Wrangler 手動部署 ===
cd apps/customer-app
pnpm run build
wrangler pages deploy dist --project-name makanmakan-customer-prod

cd apps/admin-dashboard
pnpm run build
wrangler pages deploy dist --project-name makanmakan-admin-prod

cd apps/kitchen-display
pnpm run build
wrangler pages deploy dist --project-name makanmakan-kitchen-prod
```

### 3. 部署到 Production

⚠️ **生產環境部署檢查清單**：

- [ ] 所有測試已通過
- [ ] 所有 secrets 已正確配置
- [ ] Database IDs 已更新為 production
- [ ] KV Namespace IDs 已更新為 production
- [ ] R2 Bucket 名稱已更新為 production
- [ ] Customer App map variables 已設定：`VITE_MAP_PM_TILES_URL` plus `VITE_MAP_GLYPHS_URL`，或 `VITE_MAP_STYLE_URL`
- [ ] 若使用 Protomaps PMTiles，R2 map tile bucket/object 已上傳並允許 browser Range requests
- [ ] Admin Dashboard 已設定 `VITE_MANAGEMENT_API_URL` 指向已部署的 management-api（例如 `https://management-api.example.com/api/v1`）。生產 build **不走 Vite proxy**，此值會直接當作 management-api 請求的 baseURL；未設定則平台 onboarding 頁面無法連到 management-api。
- [ ] CORS 設定為正確的 production 域名
- [ ] Rate limiting 設定為生產級別
- [ ] 已備份現有 production 數據

```bash
# 部署 Backend Services
pnpm run deploy:prod

# 部署 Frontend Apps
cd apps/customer-app && pnpm run build && wrangler pages deploy dist --project-name makanmakan-customer-prod
cd apps/admin-dashboard && pnpm run build && wrangler pages deploy dist --project-name makanmakan-admin-prod
cd apps/kitchen-display && pnpm run build && wrangler pages deploy dist --project-name makanmakan-kitchen-prod
```

---

## 🌐 DNS 與域名配置

### 1. 添加域名到 Cloudflare

1. 登入 Cloudflare Dashboard
2. 點擊 **Add a Site**
3. 輸入域名：`makanmakan.com`
4. 選擇方案（Free 或 Pro）
5. 按照指示更新 Nameservers

### 2. 配置 DNS 記錄

#### Workers 域名

在 Cloudflare Dashboard → DNS → Records 添加：

| Type  | Name     | Target                                      | Proxy      |
| ----- | -------- | -------------------------------------------- | ---------- |
| CNAME | api      | makanmakan-api-prod.workers.dev             | ✅ Proxied |
| CNAME | realtime | makanmakan-realtime-prod.workers.dev        | ✅ Proxied |
| CNAME | images   | makanmakan-image-processor-prod.workers.dev | ✅ Proxied |

#### Pages 域名

在 Cloudflare Dashboard → Pages → Custom Domains 添加：

- `makanmakan.com` → Customer App (Production)
- `admin.makanmakan.com` → Admin Dashboard (Production)
- `kitchen.makanmakan.com` → Kitchen Display (Production)

### 3. SSL/TLS 配置

1. 進入 **SSL/TLS** → **Overview**
2. 選擇 **Full (strict)** 模式
3. 啟用 **Always Use HTTPS**
4. 啟用 **Automatic HTTPS Rewrites**
5. 設置 **Minimum TLS Version** 為 1.2

---

## ✅ 生產環境驗證

### 1. 健康檢查

```bash
# API Service
curl https://api.makanmakan.com/info
# 預期: {"name":"MakanMakan API","version":"v1","environment":"...",...} (200 OK)

# Realtime Service
curl https://realtime.makanmakan.com/health
# 預期: {"status":"ok","connections":0}

# Image Processor
curl https://images.makanmakan.com/health
# 預期: {"status":"ok"}
```

### 2. 功能測試

#### 測試認證

```bash
# 登入測試
curl -X POST https://api.makanmakan.com/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "test@example.com",
    "password": "testpassword"
  }'

# 預期: 返回 JWT token
```

#### 測試數據庫連接

```bash
# 查詢數據庫
wrangler d1 execute makanmakan-prod --command "SELECT COUNT(*) as count FROM users;"
```

#### 測試 WebSocket

使用瀏覽器開發者工具或 WebSocket 客戶端：

```javascript
const ws = new WebSocket("wss://realtime.makanmakan.com/customer/table-123");
ws.onopen = () => console.log("Connected");
ws.onmessage = (msg) => console.log("Message:", msg.data);
```

### 3. 性能測試

```bash
# 安裝 Artillery (負載測試工具)
npm install -g artillery

# 創建測試配置 load-test.yml
cat > load-test.yml << EOF
config:
  target: "https://api.makanmakan.com"
  phases:
    - duration: 60
      arrivalRate: 10
scenarios:
  - flow:
    - get:
        url: "/info"
EOF

# 運行負載測試
artillery run load-test.yml
```

### 4. 安全驗證

```bash
# HTTPS 強制重定向
curl -I http://api.makanmakan.com
# 預期: 301 或 302 重定向到 https://

# CORS Headers
curl -I https://api.makanmakan.com/info \
  -H "Origin: https://makanmakan.com"
# 預期: Access-Control-Allow-Origin 正確

# Rate Limiting
for i in {1..150}; do
  curl -s -o /dev/null -w "%{http_code}\n" https://api.makanmakan.com/info
done
# 預期: 前 100 個請求返回 200，之後返回 429
```

---

## 📊 監控與日誌

### 1. Cloudflare Analytics

- **Dashboard**: https://dash.cloudflare.com → Workers & Pages → Analytics
- **Metrics**: Requests, Errors, CPU Time, Duration

### 2. 實時日誌

```bash
# 查看 API Service 日誌
wrangler tail makanmakan-api-prod

# 過濾錯誤
wrangler tail makanmakan-api-prod --status error

# 查看 Realtime Service 日誌
wrangler tail makanmakan-realtime-prod
```

### 3. 錯誤追蹤

系統已集成 Slack 通知，所有錯誤會自動發送到配置的 Slack Webhook。

#### 配置 Slack 通知

1. 創建 Slack Incoming Webhook:
   - 進入 Slack → Apps → Incoming Webhooks
   - 選擇頻道並創建 webhook
2. 設置 secret:
   ```bash
   wrangler secret put SLACK_WEBHOOK_URL --env production
   ```

### 4. Custom Analytics (Production)

查詢自定義指標：

```bash
# 使用 GraphQL API 查詢 Analytics Engine
curl https://api.cloudflare.com/client/v4/accounts/{account_id}/analytics_engine/sql \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -d "SELECT timestamp, blob1 as endpoint, double1 as duration FROM makanmakan-metrics-prod WHERE timestamp > NOW() - INTERVAL '1' HOUR"
```

---

## 💾 備份與恢復

### 1. 自動備份

系統已配置自動備份（Backup Scheduler Worker）：

- **頻率**: 每日 2:00 AM UTC
- **保留**: 30 天
- **存儲**: R2 Bucket (`makanmakan-backups-prod`)

### 2. 手動備份

```bash
# 導出數據庫
wrangler d1 export makanmakan-prod --output backup-$(date +%Y%m%d).sql

# 上傳到 R2
wrangler r2 object put makanmakan-backups-prod/manual/backup-$(date +%Y%m%d).sql --file backup-$(date +%Y%m%d).sql
```

### 3. 數據恢復

```bash
# 下載備份
wrangler r2 object get makanmakan-backups-prod/manual/backup-20250101.sql --file restore.sql

# 恢復到數據庫（需先創建新數據庫）
wrangler d1 create makanmakan-restore
wrangler d1 execute makanmakan-restore --file restore.sql
```

### 4. 災難恢復計劃

#### RTO (Recovery Time Objective): 4 hours

#### RPO (Recovery Point Objective): 24 hours

**恢復步驟**：

1. **評估影響範圍**
   - 檢查哪些服務受影響
   - 查看 Cloudflare Status Page

2. **切換到備份**
   - 如數據庫損壞，從 R2 恢復最新備份
   - 如 Worker 故障，回滾到上一版本

3. **驗證功能**
   - 運行健康檢查
   - 測試關鍵功能

4. **通知用戶**
   - 更新狀態頁面
   - 發送通知（如需要）

---

## 🔄 持續部署 (CI/CD)

### 1. GitHub Actions 配置

創建 `.github/workflows/deploy.yml`:

```yaml
name: Deploy to Production

on:
  push:
    branches:
      - main

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: pnpm/action-setup@v2
        with:
          version: 8
      - uses: actions/setup-node@v3
        with:
          node-version: 20
          cache: "pnpm"

      - name: Install dependencies
        run: pnpm install

      - name: Run tests
        run: pnpm run test:ci

      - name: Type check
        run: pnpm run typecheck

      - name: Lint
        run: pnpm run lint

  deploy-production:
    needs: test
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v3
      - uses: pnpm/action-setup@v2
        with:
          version: 8

      - name: Deploy to Production
        run: pnpm run deploy:prod
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
```

### 2. 配置 GitHub Secrets

在 GitHub Repository → Settings → Secrets 添加：

- `CLOUDFLARE_API_TOKEN`: Cloudflare API Token
- `CLOUDFLARE_ACCOUNT_ID`: Cloudflare Account ID

### 3. 部署策略

#### Blue-Green Deployment

```bash
# 部署新版本到 "green" 環境
wrangler deploy --env production-green

# 測試 green 環境
curl https://api-green.makanmakan.com/info

# 切換流量到 green (透過 DNS 或 Workers 路由)
# 如果有問題，立即切換回 blue
```

#### Canary Deployment

使用 Cloudflare Workers 路由權重：

```javascript
// 在 routing worker 中
const shouldUseCanary = Math.random() < 0.1; // 10% 流量

if (shouldUseCanary) {
  return fetch("https://api-canary.makanmakan.com" + url);
} else {
  return fetch("https://api.makanmakan.com" + url);
}
```

---

## 📝 部署檢查清單

### 部署前 (Pre-Deployment)

- [ ] 所有測試通過 (`pnpm run test:ci`)
- [ ] TypeScript 無錯誤 (`pnpm run typecheck`)
- [ ] ESLint 無錯誤 (`pnpm run lint`)
- [ ] 數據庫遷移已準備並測試
- [ ] 所有環境變數已設置
- [ ] 備份當前生產數據
- [ ] 通知團隊部署時間

### 部署中 (During Deployment)

- [ ] 按順序部署服務（Backend → Frontend）
- [ ] 監控部署日誌
- [ ] 檢查錯誤率
- [ ] 驗證健康檢查端點

### 部署後 (Post-Deployment)

- [ ] 運行煙霧測試
- [ ] 驗證關鍵功能（登入、訂單、支付）
- [ ] 檢查性能指標
- [ ] 監控錯誤日誌（至少 30 分鐘）
- [ ] 更新部署文檔
- [ ] 通知團隊部署完成

---

## 🆘 緊急回滾

如果部署後發現嚴重問題，立即回滾：

```bash
# 查看部署歷史
wrangler deployments list --name makanmakan-api-prod

# 回滾到上一版本
wrangler rollback --name makanmakan-api-prod --message "Rollback due to critical issue"

# 驗證回滾
curl https://api.makanmakan.com/info
wrangler tail makanmakan-api-prod
```

---

## 📚 相關文檔

- [故障排除指南](./TROUBLESHOOTING.md)
- [安全部署檢查清單](../security/DEPLOYMENT_SECURITY_CHECKLIST.md)
- [環境配置檢查清單](./ENVIRONMENT_CHECKLIST.md)
- [API 文檔](../api/)
- [架構文檔](../architecture/technical-documentation.md)

---

## 🤝 支持

如遇問題，請參考：

1. **故障排除文檔**: [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)
2. **Cloudflare 文檔**: https://developers.cloudflare.com/workers/
3. **Issue Tracker**: https://github.com/your-org/makanmakan/issues
4. **團隊 Slack**: #makanmakan-ops

---

**最後更新**: 2025-11-11
**維護者**: MakanMakan DevOps Team
**版本**: 2.0.0
