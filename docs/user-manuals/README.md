# MakanMakan 用戶手冊 / User Manuals

> **索引最後更新 / Index Last Updated**: 2026-10-05

## 系統完整手冊 / System Handbook

[開啟繁體中文 HTML 系統完整手冊](./system-handbook.html)

涵蓋營運人員與開發者：21 個 Part 串起 11 個 App、角色權限、點餐到收款退款與列印、入駐與租戶管理、API、即時通訊、資料模型、開發部署及維運排錯。另附路由宣告、Drizzle 資料表欄位與來源索引。可直接以瀏覽器開啟，支援離線閱讀、章節搜尋與列印。

此手冊以 2026-10-05 的 repository 程式碼與設定核對，並明列尚待驗證的功能及已知限制；不代表當日 production 已完成所有驗收。下方多語言角色指南保留原版本，部分內容早於目前實作，請以新手冊及對應來源為準。

---

## 📚 可用語言 / Available Languages

MakanMakan 提供以下語言的完整用戶手冊：

### 🌐 語言列表 / Language List

#### 顧客指南 / Customer Guide

| 語言 / Language     | 文件 / Document                                 | 狀態 / Status |
| ------------------- | ----------------------------------------------- | ------------- |
| 🇹🇼 繁體中文         | [customer-guide.md](./zh-TW/customer-guide.md)  | ✅ 完整       |
| 🇬🇧 English          | [customer-guide.md](./en-US/customer-guide.md)  | ✅ Complete   |
| 🇻🇳 Tiếng Việt       | [customer-guide.md](./vi-VN/customer-guide.md)  | ✅ Hoàn thành |
| 🇮🇩 Bahasa Indonesia | [customer-guide.md](./id-ID/customer-guide.md)  | ✅ Lengkap    |
| 🇵🇭 Filipino         | [customer-guide.md](./fil-PH/customer-guide.md) | ✅ Kumpleto   |
| 🇯🇵 日本語           | [customer-guide.md](./ja-JP/customer-guide.md)  | ✅ 完了       |

#### 店主操作手冊 / Shop Owner Manual

| 語言 / Language | 文件 / Document                                    | 狀態 / Status |
| --------------- | -------------------------------------------------- | ------------- |
| 🇹🇼 繁體中文     | [shop-owner-guide.md](./zh-TW/shop-owner-guide.md) | ✅ 完整       |
| 🇻🇳 Tiếng Việt   | [shop-owner-guide.md](./vi-VN/shop-owner-guide.md) | ✅ Hoàn thành |
| 🇯🇵 日本語       | [shop-owner-guide.md](./ja-JP/shop-owner-guide.md) | ✅ 完了       |

#### 廚師操作手冊 / Chef Manual

| 語言 / Language     | 文件 / Document                         | 狀態 / Status |
| ------------------- | --------------------------------------- | ------------- |
| 🇹🇼 繁體中文         | [chef-guide.md](./zh-TW/chef-guide.md)  | ✅ 完整       |
| 🇬🇧 English          | [chef-guide.md](./en-US/chef-guide.md)  | ✅ Complete   |
| 🇻🇳 Tiếng Việt       | [chef-guide.md](./vi-VN/chef-guide.md)  | ✅ Hoàn thành |
| 🇮🇩 Bahasa Indonesia | [chef-guide.md](./id-ID/chef-guide.md)  | ✅ Lengkap    |
| 🇵🇭 Filipino         | [chef-guide.md](./fil-PH/chef-guide.md) | ✅ Kumpleto   |
| 🇯🇵 日本語           | [chef-guide.md](./ja-JP/chef-guide.md)  | ✅ 完了       |

#### 服務員操作手冊 / Service Crew Manual

| 語言 / Language     | 文件 / Document                                         | 狀態 / Status |
| ------------------- | ------------------------------------------------------- | ------------- |
| 🇹🇼 繁體中文         | [service-crew-guide.md](./zh-TW/service-crew-guide.md)  | ✅ 完整       |
| 🇬🇧 English          | [service-crew-guide.md](./en-US/service-crew-guide.md)  | ✅ Complete   |
| 🇻🇳 Tiếng Việt       | [service-crew-guide.md](./vi-VN/service-crew-guide.md)  | ✅ Hoàn thành |
| 🇮🇩 Bahasa Indonesia | [service-crew-guide.md](./id-ID/service-crew-guide.md)  | ✅ Lengkap    |
| 🇵🇭 Filipino         | [service-crew-guide.md](./fil-PH/service-crew-guide.md) | ✅ Kumpleto   |
| 🇯🇵 日本語           | [service-crew-guide.md](./ja-JP/service-crew-guide.md)  | ✅ 完了       |

#### 收銀員操作手冊 / Cashier Manual

| 語言 / Language     | 文件 / Document                               | 狀態 / Status |
| ------------------- | --------------------------------------------- | ------------- |
| 🇹🇼 繁體中文         | [cashier-guide.md](./zh-TW/cashier-guide.md)  | ✅ 完整       |
| 🇬🇧 English          | [cashier-guide.md](./en-US/cashier-guide.md)  | ✅ Complete   |
| 🇻🇳 Tiếng Việt       | [cashier-guide.md](./vi-VN/cashier-guide.md)  | ✅ Hoàn thành |
| 🇮🇩 Bahasa Indonesia | [cashier-guide.md](./id-ID/cashier-guide.md)  | ✅ Lengkap    |
| 🇵🇭 Filipino         | [cashier-guide.md](./fil-PH/cashier-guide.md) | ✅ Kumpleto   |
| 🇯🇵 日本語           | [cashier-guide.md](./ja-JP/cashier-guide.md)  | ✅ 完了       |

---

## 📖 用戶手冊內容 / Manual Contents

每份用戶手冊都包含以下完整內容：

### 主要章節 / Main Sections

1. **歡迎使用 MakanMakan**
   - 平台介紹
   - 主要特色
   - 系統需求

2. **快速開始**
   - 3 步驟開始使用
   - 掃描 QR Code
   - 基本操作流程

3. **點餐方式**
   - 方式 1：桌台掃碼點餐（傳統模式）
   - 方式 2：店家掃碼點餐（Shop QR 模式）
   - 手機驗證流程

4. **會員功能**
   - 註冊與登入
   - 個人資料管理
   - 訂單歷史查詢
   - 密碼重設

5. **菜單瀏覽與點餐**
   - 瀏覽菜單
   - 搜尋功能
   - 分類篩選
   - 加入購物車
   - 客製化選項

6. **購物車管理**
   - 查看購物車
   - 修改數量
   - 刪除項目
   - 送出訂單

7. **訂單追蹤**
   - 即時狀態更新
   - 訂單流程說明
   - 通知設定

8. **常見問題 (FAQ)**
   - 使用相關
   - 購物車相關
   - 付款相關
   - 技術相關
   - 帳號相關

9. **故障排除**
   - 常見問題解決
   - 清除快取方法
   - 技術支援

10. **聯絡我們**
    - 餐廳服務人員
    - 線上客服
    - 社群媒體
    - 問題回報

---

## 🎯 適用對象 / Target Audience

### 顧客 (Customers)

所有使用 MakanMakan 平台點餐的顧客，包括：

- ✅ **首次使用者** - 完整的入門指南
- ✅ **一般使用者** - 詳細的操作說明
- ✅ **會員用戶** - 進階功能教學
- ✅ **國際顧客** - 多語言支援

---

## 📁 文檔結構 / Document Structure

```
user-manuals/
├── README.md                    (本文件 / This file)
│
├── 🆕 SCHEDULING_MANUAL.md      (員工排班系統操作手冊 - 中英雙語 1,000+ 行)
├── 🆕 LEAVE_MANAGEMENT_MANUAL.md (請假管理系統操作手冊 - 中英雙語 1,800+ 行)
├── 🆕 AI_ANALYTICS_USER_MANUAL.md (AI 智能分析操作手冊 - 中英雙語 2,700+ 行)
│
├── zh-TW/                       (繁體中文)
│   ├── customer-guide.md
│   ├── shop-owner-guide.md
│   ├── chef-guide.md
│   ├── service-crew-guide.md
│   └── cashier-guide.md
│
├── en-US/                       (English)
│   ├── customer-guide.md
│   ├── chef-guide.md
│   ├── service-crew-guide.md
│   └── cashier-guide.md
│
├── vi-VN/                       (Tiếng Việt)
│   ├── customer-guide.md
│   ├── shop-owner-guide.md
│   ├── chef-guide.md
│   ├── service-crew-guide.md
│   └── cashier-guide.md
│
├── ja-JP/                       (日本語)
│   ├── customer-guide.md
│   ├── shop-owner-guide.md
│   ├── chef-guide.md
│   ├── service-crew-guide.md
│   └── cashier-guide.md
│
├── id-ID/                       (Bahasa Indonesia)
│   ├── customer-guide.md
│   ├── chef-guide.md
│   ├── service-crew-guide.md
│   └── cashier-guide.md
│
├── fil-PH/                      (Filipino)
│   ├── customer-guide.md
│   ├── chef-guide.md
│   ├── service-crew-guide.md
│   └── cashier-guide.md
│
└── screenshots/                 (操作截圖 / Screenshots)
    ├── customer-app/
    ├── admin-dashboard/
    └── kitchen-display/
```

---

## 🔄 文檔更新政策 / Update Policy

### 更新頻率 / Update Frequency

- **主要版本更新**: 每季度一次 / Quarterly
- **功能新增**: 新功能上線時立即更新 / Immediately upon new feature release
- **錯誤修正**: 發現錯誤後 48 小時內修正 / Within 48 hours of error discovery
- **翻譯同步**: 與繁體中文版同步 / Synchronized with Traditional Chinese version

### 版本記錄 / Version History

| 版本 / Version | 日期 / Date | 更新內容 / Changes                                                                                                                             |
| -------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.0            | 2025-10-26  | ✅ 初版完成 - 顧客指南 (5 語言) / Initial release - Customer Guide (5 languages)                                                               |
| 2.1            | 2025-10-26  | ✅ 廚師操作手冊 (5 語言) / Chef Manual (5 languages)                                                                                           |
| 2.2            | 2025-10-26  | ✅ 服務員操作手冊 (5 語言) / Service Crew Manual (5 languages)                                                                                 |
| 2.3            | 2025-10-26  | ✅ 收銀員操作手冊 (5 語言) / Cashier Manual (5 languages)                                                                                      |
| 2.4            | 2025-10-27  | ✅ 日語版本完整發佈 - 全部 5 份操作手冊 / Japanese version complete - All 5 manuals                                                            |
| 3.0            | 2025-11-06  | 🆕 員工管理手冊 - 排班系統 (1,000+ 行) & 請假管理 (1,800+ 行) / Employee Management Manuals - Scheduling (1,000+ lines) & Leave (1,800+ lines) |
| 3.1            | 2025-11-06  | 🆕 AI 智能分析手冊 - 完整操作指南 (2,700+ 行, 12 章節) / AI Analytics Manual - Complete User Guide (2,700+ lines, 12 chapters)                 |

---

## 📞 意見回饋 / Feedback

### 如何提供意見 / How to Provide Feedback

如果您在使用手冊時發現任何問題或有改進建議，請透過以下方式聯絡我們：

**Email**: support@makanmakan.com

**請提供 / Please Provide**:

- 手冊語言版本 / Manual language version
- 問題頁面或章節 / Problem page or section
- 詳細說明 / Detailed description
- 建議改進方式 / Suggested improvements

---

## 🌟 特別感謝 / Special Thanks

感謝所有協助完成這份多語言用戶手冊的夥伴！

- 📝 內容撰寫: Claude AI
- 🌐 翻譯協助: Claude AI
- 🎨 格式設計: MakanMakan Team
- ✅ 品質審核: Community Contributors

---

## 📜 授權資訊 / License

本用戶手冊採用 **CC BY-NC-SA 4.0** 授權。

This user manual is licensed under **CC BY-NC-SA 4.0**.

---

## 🔗 相關資源 / Related Resources

### 技術文檔 / Technical Documentation

- [開發者文檔 / Developer Docs](../README.md)
- [API 文檔 / API Documentation](../api/)
- [架構文檔 / Architecture Docs](../architecture/)

### 其他手冊 / Other Manuals

- ✅ **店主操作手冊 / Restaurant Owner Manual** (已完成 / Complete - 3 語言 / 3 Languages)
  - 🇹🇼 [繁中版](./zh-TW/shop-owner-guide.md)
  - 🇻🇳 [越南語版](./vi-VN/shop-owner-guide.md)
  - 🇯🇵 [日本語版](./ja-JP/shop-owner-guide.md)

- ✅ **廚師操作手冊 / Chef Manual** (已完成 / Complete - 6 語言 / 6 Languages)
  - 🇹🇼 [繁中版](./zh-TW/chef-guide.md)
  - 🇬🇧 [English](./en-US/chef-guide.md)
  - 🇻🇳 [Tiếng Việt](./vi-VN/chef-guide.md)
  - 🇮🇩 [Bahasa Indonesia](./id-ID/chef-guide.md)
  - 🇵🇭 [Filipino](./fil-PH/chef-guide.md)
  - 🇯🇵 [日本語](./ja-JP/chef-guide.md)

- ✅ **服務員操作手冊 / Service Crew Manual** (已完成 / Complete - 6 語言 / 6 Languages)
  - 🇹🇼 [繁中版](./zh-TW/service-crew-guide.md)
  - 🇬🇧 [English](./en-US/service-crew-guide.md)
  - 🇻🇳 [Tiếng Việt](./vi-VN/service-crew-guide.md)
  - 🇮🇩 [Bahasa Indonesia](./id-ID/service-crew-guide.md)
  - 🇵🇭 [Filipino](./fil-PH/service-crew-guide.md)
  - 🇯🇵 [日本語](./ja-JP/service-crew-guide.md)

- ✅ **收銀員操作手冊 / Cashier Manual** (已完成 / Complete - 6 語言 / 6 Languages)
  - 🇹🇼 [繁中版](./zh-TW/cashier-guide.md)
  - 🇬🇧 [English](./en-US/cashier-guide.md)
  - 🇻🇳 [Tiếng Việt](./vi-VN/cashier-guide.md)
  - 🇮🇩 [Bahasa Indonesia](./id-ID/cashier-guide.md)
  - 🇵🇭 [Filipino](./fil-PH/cashier-guide.md)
  - 🇯🇵 [日本語](./ja-JP/cashier-guide.md)

- 🆕 **員工排班系統操作手冊 / Employee Scheduling Manual** (已完成 / Complete - 雙語 / Bilingual)
  - 📖 [中英雙語版 / Chinese-English](./SCHEDULING_MANUAL.md)
  - **內容 / Content:** 班次模板、員工排班、打卡管理、調班請求、衝突解決
  - **頁數 / Pages:** 1,000+ 行 / lines
  - **適用對象 / Users:** 員工、主管、店主、管理員

- 🆕 **請假管理系統操作手冊 / Leave Management Manual** (已完成 / Complete - 雙語 / Bilingual)
  - 📖 [中英雙語版 / Chinese-English](./LEAVE_MANAGEMENT_MANUAL.md)
  - **內容 / Content:** 請假申請、審批管理、餘額管理、統計分析、匯出功能
  - **頁數 / Pages:** 1,800+ 行 / lines
  - **適用對象 / Users:** 員工、主管、店主、管理員

- 🆕 **AI 智能分析操作手冊 / AI Analytics User Manual** (已完成 / Complete - 雙語 / Bilingual)
  - 📖 [中英雙語版 / Chinese-English](./AI_ANALYTICS_USER_MANUAL.md)
  - **內容 / Content:** AI Provider 配置、洞察報告、產品分析、成本設定、報告解讀、最佳實踐、故障排除
  - **頁數 / Pages:** 2,700+ 行 / lines
  - **適用對象 / Users:** 店主、管理員
  - **支援 LLM / Supported LLMs:** Anthropic Claude, OpenAI GPT, Google Gemini, DeepSeek

---

<div align="center">

**MakanMakan User Manuals**

Built with ❤️ for our customers worldwide

**Version 3.0** | **2025-11-06**

[繁體中文](./zh-TW/customer-guide.md) |
[English](./en-US/customer-guide.md) |
[Tiếng Việt](./vi-VN/customer-guide.md) |
[Bahasa Indonesia](./id-ID/customer-guide.md) |
[Filipino](./fil-PH/customer-guide.md) |
[日本語](./ja-JP/customer-guide.md)

</div>
