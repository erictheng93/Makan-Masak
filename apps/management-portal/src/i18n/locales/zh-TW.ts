const zhTW = {
  common: {
    appName: "MakanMasak",
    loading: "載入中...",
    view: "查看",
    viewAll: "查看全部",
    viewDetails: "查看詳情",
    manage: "管理",
    actions: "操作",
    cancel: "取消",
    generate: "生成",
    selectAll: "全選",
    pleaseSelect: "請選擇",
    unknown: "未知",
    processing: "處理中...",
  },

  nav: {
    dashboard: "總覽",
    tenants: "租戶管理",
    deployments: "部署管理",
    health: "健康監控",
    licenses: "授權管理",
    markets: "市場管理",
    policies: "地區政策",
  },

  layout: {
    managementPortal: "管理平台",
    version: "版本 {version}",
  },

  dashboard: {
    title: "總覽",
    subtitle: "管理平台運行狀態概覽",
    stats: {
      totalTenants: "總租戶數",
      active: "運行中",
      pending: "待處理",
      unhealthy: "健康異常",
    },
    health: {
      title: "健康狀態",
      healthyRunning: "正常運行",
    },
    pending: {
      title: "待處理事項",
      empty: "沒有待處理的事項",
      waitingProvision: "等待配置資源",
      handle: "處理",
      serviceDown: "服務離線",
      serviceDegraded: "服務降級",
    },
    recentTenants: {
      title: "最近租戶",
    },
  },

  tenants: {
    title: "租戶管理",
    subtitle: "管理所有獨立部署的餐廳租戶",
    create: "新增租戶",
    empty: {
      none: "暫無租戶",
      noResults: "沒有符合條件的租戶",
      tryAdjust: "嘗試調整搜索條件",
      createFirst: "點擊新增按鈕創建第一個租戶",
    },
    filter: {
      searchPlaceholder: "搜索商家名稱、Email、子域名...",
      allStatuses: "全部狀態",
    },
    column: {
      businessName: "商家名稱",
      contactEmail: "聯絡 Email",
      subdomain: "子域名",
      status: "狀態",
      version: "版本",
      deployedVersion: "部署版本",
      createdAt: "建立時間",
    },
    status: {
      active: "運行中",
      pending: "待處理",
      provisioning: "配置中",
      suspended: "已暫停",
      terminated: "已終止",
    },
    toast: {
      createSuccess: "租戶創建成功",
    },
    createModal: {
      title: "新增租戶",
      field: {
        businessName: "商家名稱",
        businessNamePlaceholder: "例如：御膳房",
        contactEmail: "聯絡 Email",
        contactEmailPlaceholder: "owner@restaurant.com",
        contactPhone: "聯絡電話",
        contactPhonePlaceholder: "02-1234-5678",
        subdomain: "子域名",
        subdomainPlaceholder: "yushenfang",
        subdomainSuffix: ".makanmasak.com",
        subdomainHint: "留空將自動生成",
        selectPlan: "選擇方案",
      },
      plan: {
        standard: {
          label: "標準版 - $149/月",
          description: "1 間餐廳，基本功能",
        },
        professional: {
          label: "專業版 - $299/月",
          description: "3 間餐廳，完整功能",
        },
        enterprise: {
          label: "企業版 - 議價",
          description: "無限餐廳，客製化服務",
        },
      },
      validation: {
        businessNameRequired: "請輸入商家名稱",
        emailRequired: "請輸入聯絡 Email",
        emailInvalid: "請輸入有效的 Email",
        subdomainFormat: "子域名只能包含小寫字母、數字和連字符",
      },
      error: {
        createFailed: "創建租戶失敗，請稍後再試",
      },
      creating: "創建中...",
      submit: "創建租戶",
    },
  },

  tenantDetail: {
    backToList: "返回租戶列表",
    provisioning: "配置中...",
    provisionResources: "配置資源",
    deploying: "部署中...",
    redeploy: "重新部署",
    tabs: {
      overview: "概覽",
      resources: "資源",
      deployments: "部署",
      health: "健康",
      license: "授權",
    },
    toast: {
      loadFailed: "載入租戶資料失敗",
      provisionSuccess: "資源配置成功",
      provisionFailed: "資源配置失敗",
      deployStarted: "部署已開始",
      deployFailed: "部署失敗",
    },
    resource: {
      type: {
        d1: "D1 資料庫",
        kv: "KV 儲存",
        r2: "R2 物件儲存",
        worker: "Worker",
        pages: "Pages",
      },
    },
    basicInfo: {
      title: "基本資訊",
      businessName: "商家名稱",
      contactEmail: "聯絡 Email",
      contactPhone: "聯絡電話",
      subdomain: "子域名",
      customDomain: "自訂域名",
      createdAt: "建立時間",
    },
    deployInfo: {
      title: "部署資訊",
      currentVersion: "當前版本",
      notDeployed: "未部署",
      connected: "已連接",
      notConnected: "未連接",
      resourceCount: "資源數量",
      itemSuffix: "個",
      lastDeploy: "最近部署",
    },
    resources: {
      title: "Cloudflare 資源",
      empty: "尚未配置資源",
      column: {
        type: "資源類型",
        name: "資源名稱",
        id: "資源 ID",
        status: "狀態",
        createdAt: "建立時間",
      },
      status: {
        provisioned: "已配置",
        pending: "待配置",
        failed: "失敗",
      },
    },
    deployments: {
      title: "部署歷史",
      empty: "尚無部署記錄",
      type: {
        initial: "初始部署",
        update: "版本更新",
        rollback: "版本回滾",
      },
    },
    health: {
      title: "健康狀態",
      empty: "尚無健康檢查記錄",
    },
    license: {
      title: "授權資訊",
      empty: "尚無授權記錄",
    },
  },

  licenses: {
    title: "授權管理",
    subtitle: "管理租戶授權金鑰",
    generate: "生成授權",
    empty: "暫無授權記錄",
    valid: "有效",
    revoked: "已撤銷",
    permanent: "永久",
    permanentValid: "永久有效",
    validUntil: "有效期至",
    upgrade: "升級",
    stats: {
      active: "有效授權",
    },
    tier: {
      standard: "標準版",
      professional: "專業版",
      enterprise: "企業版",
    },
    column: {
      tenant: "租戶",
      licenseKey: "授權金鑰",
      tier: "等級",
      status: "狀態",
      validity: "有效期",
      createdAt: "建立時間",
    },
    validation: {
      selectTenant: "請選擇租戶",
    },
    toast: {
      generateSuccess: "授權生成成功",
      generateFailed: "授權生成失敗",
    },
    modal: {
      title: "生成授權",
      selectTenant: "選擇租戶",
      tier: "授權等級",
      tierOption: {
        standard: "標準版 - $149/月",
        professional: "專業版 - $299/月",
        enterprise: "企業版 - 議價",
      },
      expiresAt: "有效期至 (選填)",
      expiresAtHint: "留空表示永久有效",
    },
  },

  deployments: {
    title: "部署管理",
    subtitle: "批量部署和版本更新",
    batch: {
      title: "批量部署",
      targetVersion: "目標版本",
      versionPlaceholder: "例如：1.2.0",
      deploying: "部署中...",
      deployWithCount: "部署 ({count})",
      selectTenants: "選擇租戶",
      currentVersionLabel: "當前版本：",
      notDeployed: "未部署",
    },
    status: {
      pending: "待執行",
      inProgress: "執行中",
      completed: "已完成",
      failed: "失敗",
      rolledBack: "已回滾",
    },
    validation: {
      selectTenant: "請選擇至少一個租戶",
      enterVersion: "請輸入目標版本",
    },
    toast: {
      queuedCount: "已排入 {count} 個部署任務",
      failedCount: "{count} 個租戶部署失敗",
      batchFailed: "批量部署失敗",
    },
    recent: {
      title: "最近部署",
      empty: "暫無部署記錄",
    },
  },

  health: {
    title: "健康監控",
    subtitle: "監控所有租戶的運行狀態",
    refresh: "刷新",
    refreshing: "刷新中...",
    overall: "總體狀態",
    avgResponseTime: "平均回應時間",
    lastUpdated: "最後更新：",
    status: {
      healthy: "正常",
      degraded: "降級",
      down: "離線",
    },
    attention: {
      title: "需要注意",
      serviceDown: "服務離線",
      serviceDegraded: "服務降級",
    },
    all: {
      title: "所有租戶",
      empty: "暫無健康檢查資料",
    },
    column: {
      tenant: "租戶",
      status: "狀態",
      responseTime: "回應時間",
      api: "API",
      database: "資料庫",
      cache: "快取",
      storage: "儲存",
      checkedAt: "檢查時間",
    },
  },

  policies: {
    title: "地區政策",
    subtitle:
      "依國家或市集設定功能、金流、方案與費率。沒有設定的項目沿用上一層。",
    countries: { TW: "台灣", MY: "馬來西亞" },
    scope: { market: "市集", marketPlaceholder: "選擇市集…" },
    unknownCountryWarning:
      "有 {count} 家店尚未設定國別，國家政策不會套用到它們。請先執行國別回填。",
    confirmUnknownCountry:
      "有 {count} 家店尚未設定國別，這項政策不會套用到它們。確定仍要儲存嗎？",
    inherited: "未設定，沿用上一層",
    merge: {
      ceiling_deny: "上限：任一層關閉即關閉",
      ceiling_allow: "上限：只允許清單內的項目",
      default: "預設：店家可自行覆寫",
      platform_cap: "平台限定：店家無法修改",
    },
    keys: {
      modules_disabled: "關閉的功能模組",
      payments_allowed_providers: "允許的線上金流商",
      pricing_default_tax_rate_bps: "預設稅率",
      pricing_default_service_charge_rate_bps: "預設服務費率",
      plans_allowed_tiers: "可販售的付費方案",
      platform_max_fee_rate_bps: "市集平台費率上限",
    },
    actions: { save: "儲存", clear: "清除" },
    toast: { saved: "已儲存政策", cleared: "已清除政策" },
  },

  notFound: {
    title: "頁面不存在",
    description: "您訪問的頁面可能已被移除或暫時無法使用",
    backHome: "返回首頁",
  },
};

export default zhTW;
