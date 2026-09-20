const zhTW = {
  common: {
    back: "返回",
    cancel: "取消",
    submit: "提交",
    loading: "載入中...",
    toast: {
      copiedToClipboard: "已複製到剪貼簿",
    },
  },

  app: {
    tagline: {
      selfHosted: "獨立部署",
    },
    footer: {
      copyright: "© 2026 MakanMasak. All rights reserved.",
    },
  },

  home: {
    hero: {
      titleLine1: "為您的餐廳打造",
      titleLine2: "專屬管理系統",
      subtitle: "獨立部署 · 數據安全 · 24 小時內完成上線",
      ctaApply: "立即申請",
      ctaDemo: "查看演示 →",
    },
    features: {
      isolated: {
        title: "獨立環境",
        description: "完全隔離的雲端環境，數據 100% 歸您所有",
      },
      secure: {
        title: "安全可靠",
        description: "基於 Cloudflare 全球邊緣網絡，企業級安全防護",
      },
      fast: {
        title: "快速部署",
        description: "自動化部署流程，最快 24 小時內完成上線",
      },
    },
    cta: {
      title: "準備好開始了嗎？",
      subtitle: "填寫申請表單，我們將在 24 小時內與您聯繫",
      button: "開始申請",
    },
  },

  apply: {
    title: "填寫申請資料",
    form: {
      businessName: {
        label: "餐廳名稱",
        placeholder: "例如：御膳房",
      },
      contactName: {
        label: "聯絡人姓名",
        placeholder: "您的姓名",
      },
      contactEmail: {
        label: "Email",
        placeholder: "your@email.com",
      },
      contactPhone: {
        label: "聯絡電話",
        placeholder: "02-1234-5678",
      },
      address: { label: "店家地址", placeholder: "例如：中山路 1 號" },
      district: { label: "鄉鎮市區", placeholder: "例如：西屯區" },
      country: {
        label: "國家",
        placeholder: "請選擇國家",
        options: { TW: "台灣", MY: "馬來西亞" },
      },
      city: { label: "縣市", placeholder: "請選擇縣市" },
      market: {
        label: "夜市／商圈",
        independent: "我是獨立店面，不屬於任何商圈",
        fetchError: "無法載入這個縣市的夜市／商圈，請稍後再試",
      },
      stallNumber: {
        label: "攤位號碼（選填）",
        placeholder: "例如：A-12",
      },
      location: {
        label: "餐廳位置",
        help: "用於夜市 / 商圈探索與附近搜尋。請使用店面或攤位的實際座標。",
        useCurrent: "使用目前位置",
        locating: "定位中...",
        unsupported: "此瀏覽器不支援定位功能，請手動輸入座標",
        failure: "無法取得目前位置，請確認定位權限或手動輸入座標",
        latitudePlaceholder: "緯度，例如 24.147736",
        longitudePlaceholder: "經度，例如 120.673648",
      },
      subdomain: {
        label: "期望的網址 (選填)",
        placeholder: "yourrestaurant",
        available: "此網址可以使用",
        taken: "此網址已被使用",
        invalidFormat: "只能包含小寫字母、數字和連字符",
        emptyHint: "留空將自動生成",
        suggestionsLabel: "建議的替代網址：",
      },
      submitting: "提交中...",
      next: "下一步",
    },
    validation: {
      businessNameRequired: "請輸入餐廳名稱",
      contactNameRequired: "請輸入聯絡人姓名",
      emailRequired: "請輸入 Email",
      emailInvalid: "請輸入有效的 Email",
      phoneRequired: "請輸入聯絡電話",
      addressRequired: "請輸入店家地址",
      countryRequired: "請選擇國家",
      districtRequired: "請輸入鄉鎮市區",
      cityRequired: "請輸入縣市",
      latitudeRequired: "請輸入餐廳緯度",
      latitudeInvalid: "緯度需介於 -90 到 90 之間",
      longitudeRequired: "請輸入餐廳經度",
      longitudeInvalid: "經度需介於 -180 到 180 之間",
      subdomainInvalidFormat: "只能包含小寫字母、數字和連字符",
      subdomainTooShort: "至少需要 3 個字元",
      subdomainTaken: "此網址已被使用",
    },
    toast: {
      submitSuccess: "申請資料已提交",
      submitFailureFallback: "提交失敗，請稍後再試",
    },
  },

  success: {
    title: "申請已送出！",
    subtitleLine1: "我們已收到您的店家加入申請。",
    subtitleLine2: "平台團隊審核通過後，會啟用您的帳號與系統資源。",
    summary: {
      title: "申請摘要",
      applicationId: "申請編號",
      tenantId: "租戶編號",
      businessName: "餐廳名稱",
      contactEmail: "聯絡 Email",
      plan: "選擇方案",
      subdomain: "專屬網址",
      cloudflare: "平台代管",
      connected: "已啟用",
      status: "申請狀態",
      pendingReview: "等待平台審核",
    },
    nextSteps: {
      title: "接下來會發生什麼？",
      email: {
        title: "確認郵件",
        prefix: "我們已發送確認郵件至",
        suffix: "，請查收。",
        description: "申請狀態有更新時，我們會寄送 Email 通知您。",
      },
      deploy: {
        title: "平台審核",
        description: "平台方會確認店家資料與方案，核准後即啟用平台代管資源。",
      },
      start: {
        title: "開始使用",
        description: "收到登入資訊後，您可以立即登入管理後台開始設定您的餐廳。",
      },
    },
    button: {
      goToAdmin: "前往管理後台",
      backHome: "返回首頁",
      viewStatus: "查看申請狀態",
    },
    statusLink: {
      savePrompt: "請保存此連結，這是查詢申請進度的唯一方式。",
      copy: "複製查詢連結",
    },
    contact: {
      prompt: "有任何問題？請聯繫",
    },
  },
  status: {
    title: "申請狀態",
    subtitle: "查看您的店家申請最新審核進度。",
    loading: "正在載入申請狀態...",
    businessName: "餐廳名稱",
    currentStatus: "目前狀態",
    rejectionReason: "未核准原因",
    lastUpdated: "可使用重新整理查看最新進度。",
    refresh: "重新整理狀態",
    backHome: "返回首頁",
    error: {
      missingLink: "此申請狀態連結不完整。",
      invalidLink: "此申請狀態連結無效。",
      unavailable: "目前無法載入此申請，請稍後再試。",
    },
    labels: {
      pending: "等待審核",
      submitted: "等待審核",
      approved: "已核准",
      provisioning: "設定中",
      completed: "已啟用",
      rejected: "未核准",
    },
  },

  plans: {
    trial: "免費試用",
    standard: "標準版",
    professional: "專業版",
    enterprise: "企業版",
  },
};

export default zhTW;
