# MakanMasak - Modern Serverless Restaurant Management Platform

<div align="center">

![Version](https://img.shields.io/badge/version-2.1.0-blue.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-100%25-blue)
![PWA](https://img.shields.io/badge/PWA-95%2F100-green)
[![codecov](https://codecov.io/gh/erictheng93/Makan-Masak/graph/badge.svg)](https://codecov.io/gh/erictheng93/Makan-Masak)
![License](https://img.shields.io/badge/license-MIT-green.svg)

**A modern restaurant management system built on Cloudflare's edge computing platform**

[Features](#-features) |
[Quick Start](#-quick-start) |
[Architecture](#-architecture) |
[Documentation](#-documentation) |
[Status](#-project-status)

</div>

---

## About

MakanMasak is a serverless, multi-tenant **night-market / 商圈 marketplace platform** built on the **Cloudflare ecosystem**. It aggregates line-side small vendors into a searchable, single-checkout digital market, and ships a **free merchant operating system** — online ordering, menu management, table/seat management, POS, employee scheduling, multi-role access, real-time — to onboard vendors onto the platform.

> **Business positioning (v2.0 — Marketplace-first):** revenue comes from platform transaction flow (closed-loop credits/tokens, vouchers, take-rate, breakage), **not** from selling restaurant-management SaaS subscriptions. The pilot does not connect real-money payment rails; tokens are non-redeemable, non-transferable, and cannot be exchanged for securities or cash. The `subscriptions` / `billing` modules are retained as **entitlement / add-on infrastructure (feature gating)**, not the primary revenue line. See `docs/BUSINESS_PLAN.md` §1.5 / §5.1.

### Highlights

- **Edge Computing** - Global deployment across 300+ Cloudflare nodes, P99 < 300ms (target)
- **Multi-tenant** - Each restaurant/vendor has isolated data, menus, tables, and staff
- **Cost-effective** - Serverless pay-per-use, estimated < $10 USD/month for SMBs
- **Enterprise Security** - Cloudflare WAF + Zero Trust, AES-256 encryption, bcrypt
- **PWA** - 95/100 performance score with full offline support
- **TypeScript** - 100% type-safe, zero compilation errors across all packages

---

## Features

### Restaurant Operations

- **Multi-restaurant Management** - Full tenant isolation with independent configuration
- **QR Code Ordering** - Table-level, seat-level, or shop-level (table-free) modes
- **Real-time Order Tracking** - WebSocket via Durable Objects for kitchen/service staff
- **Kitchen Display System** - Dedicated KDS app with real-time order updates
- **POS System** - Cash registers, shifts, cash movements, receipts, refunds, shift reports

### Ordering & Customers

- **Group Orders & Split Billing** - Shared carts, split bills, share codes
- **Coupon & Promotions** - Coupon templates, usage tracking, distributions
- **Customer Profiles** - Registration, order history, phone verification
- **Discovery System** - Restaurant/dish/market search with full-text indexing
- **Market Location Maps** - MapLibre GL JS external market maps with optional Protomaps PMTiles/R2 tiles, plus separate stall-layout maps for in-market navigation
- **Reservations & Waiting List** - Table reservations and walk-in queue

### Employee Management

- **Employee Scheduling** - Shift templates, auto-generation, swap requests, conflict detection
- **Leave Management** - Multi-type leaves, balance tracking, multi-level approval, Taiwan labor law compliance
- **Multi-role Access** - Admin, Shop Owner, Chef, Service Crew, Cashier

### Business Intelligence

- **AI Analytics** - 4 LLM providers (Claude, OpenAI, Gemini, DeepSeek) for product insights
- **Demand Forecasting** - WMA algorithm for revenue/order predictions with ingredient-level forecasting
- **Business Analytics** - Custom metrics and performance dashboards

### Platform

- **Hybrid Multi-tenant Deployment** - Management portal + API for tenant provisioning and licensing
- **6-language i18n** - zh-TW, zh-CN, en-US, ja-JP, vi-VN, id-ID
- **Automated Backups** - D1 to R2 scheduled backup with recovery
- **Local Print Agent** - Receipt printing via Express + WebSocket
- **Image Processing** - Dedicated worker for image optimization

---

## Quick Start

### Prerequisites

- Node.js 22+ (engines requires `>=22.13.0`)
- pnpm 10+ (required - repo pins `pnpm@10.24.0` via `packageManager`; do not use npm or yarn)
- Cloudflare Account (paid plan for D1, R2, Images)
- Wrangler CLI: `pnpm add -g wrangler`

### Setup

```bash
# 1. Clone and install
git clone https://github.com/erictheng93/Makan-Masak.git
cd Makan-Masak
pnpm install

# 2. Authenticate with Cloudflare
pnpm wrangler login

# 3. Set up local database
pnpm db:migrate:local

# 4. Start all apps
pnpm dev
```

### Development URLs

```
Customer App:       http://localhost:3000
Admin Dashboard:    http://localhost:3001
Kitchen Display:    http://localhost:3002
Management Portal:  http://localhost:3010
Onboarding App:     http://localhost:3011
API (Workers):      http://localhost:8787
```

### Common Commands

```bash
pnpm dev              # Start all apps in parallel
pnpm build            # Build all apps
pnpm typecheck        # TypeScript check (0 errors)
pnpm lint             # ESLint check (0 errors)
pnpm test             # Unit tests
pnpm test:e2e         # End-to-end tests
pnpm deploy:prod      # Deploy to production
```

---

## Architecture

### Tech Stack

| Service             | Purpose                        | Benefit                               |
| ------------------- | ------------------------------ | ------------------------------------- |
| **Workers**         | API, auth, business logic      | Edge computing, < 50ms latency        |
| **D1**              | Primary database (SQLite)      | Global distribution, auto-replication |
| **KV**              | Session cache, hot data        | Ultra-low latency reads               |
| **R2**              | Images, static assets, backups | Zero egress fees                      |
| **MapLibre GL JS**  | Customer market maps           | Open-source WebGL map renderer        |
| **Protomaps PMTiles** | Optional hosted map tiles     | Single-file vector tiles on R2/CDN    |
| **Pages**           | Frontend hosting               | Auto CDN, Git integration             |
| **Durable Objects** | WebSocket real-time            | Stateful connections, low latency     |
| **Images**          | Image optimization             | Auto resize, WebP conversion          |

### Project Structure

```
Makan-Masak/
├── apps/
│   ├── customer-app/          # Consumer ordering PWA (Vue 3)
│   ├── admin-dashboard/       # Restaurant management dashboard (Vue 3)
│   ├── kitchen-display/       # Kitchen display system (Vue 3)
│   ├── api/                   # Main API (Cloudflare Workers)
│   ├── realtime/              # Real-time services (Durable Objects)
│   ├── management-portal/     # Multi-tenant management UI (Vue 3)
│   ├── management-api/        # Tenant management API (Workers)
│   ├── onboarding-app/        # New customer onboarding (Vue 3)
│   ├── backup-scheduler/      # Scheduled D1 backup (Workers Cron)
│   ├── print-agent/           # Local receipt printing (Express + WS)
│   └── image-processor/       # Image optimization (Workers)
├── packages/
│   ├── database/              # D1 schema & migrations (Drizzle ORM)
│   ├── shared-types/          # TypeScript definitions
│   ├── shared/                # Shared Vue components + i18n
│   ├── utils/                 # Shared utilities (UUID v7)
│   ├── ai-analytics/          # AI analytics package
│   ├── queue-core/            # Queue system core
│   ├── queue-service/         # Queue service implementation
│   └── testing-utils/         # Test utilities and helpers
└── docs/                      # Documentation
```

### Database

- **69 tables** across 21 schema files (Drizzle ORM)
- **UUID v7** primary keys (time-sortable, globally unique)
- **Environments**: Production (`makanmasak-prod`), Local SQLite

---

## Documentation

| Document                                 | Description                                                                               |
| ---------------------------------------- | ----------------------------------------------------------------------------------------- |
| **[CLAUDE.md](./CLAUDE.md)**             | Complete project reference — architecture, API endpoints, conventions, development status |
| **[docs/](./docs/README.md)**            | Documentation hub — architecture, features, guides, user manuals                          |
| **[API docs](./docs/api/)**              | REST API endpoint documentation                                                           |
| **[User manuals](./docs/user-manuals/)** | Role-based guides in 6 languages                                                          |

---

## Project Status

### Production-Ready Systems

- Core API (<!-- gen:moduleCount -->45<!-- /gen --> feature modules, <!-- gen:routeGroups -->59<!-- /gen --> mounted route groups)<!-- counts verified by scripts/check-docs-drift.cjs -->
- JWT multi-role authentication with bcrypt
- QR code ordering (table/seat/shop modes)
- Employee scheduling & leave management
- POS system (registers, shifts, receipts, refunds)
- Coupon & promotion management
- Group orders & split billing
- Partnership system
- AI analytics & demand forecasting
- Discovery system (restaurant/dish search)
- Real-time services (WebSocket via Durable Objects)
- Hybrid multi-tenant deployment
- Automated backup & recovery
- 6-language i18n system
- PWA with 95/100 performance score

### In Development

- POS frontend integration
- Reservation system frontend completion
- Payment gateway integration

### Quality Metrics

| Metric            | Value   |
| ----------------- | ------- |
| TypeScript Errors | 0       |
| ESLint Errors     | 0       |
| PWA Score         | 95/100  |
| API P99 Latency   | < 300ms |
| DB Query P95      | < 100ms |

---

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Standards

- All code must pass TypeScript and ESLint checks
- Write tests for new features
- Use Drizzle ORM for new database queries (not raw SQL)
- Follow unified error response format (see CLAUDE.md)
- Use pnpm (not npm or yarn)

---

## License

MIT License - see [LICENSE](./LICENSE) for details.

---

<div align="center">

**Built with Cloudflare Edge Computing**

**Last Updated**: 2026-03-16

</div>
