import type { Messages } from "../types";

const zhCN: Messages = {
  app: {
    footer: {
      copyright: "© 2026 MakanMasak. All rights reserved.",
    },
    tagline: {
      platformHosted: "平台代管",
    },
  },
  apply: {
    form: {
      businessName: {
        label: "餐厅名称",
        placeholder: "例如：御膳房",
      },
      contactEmail: {
        label: "Email",
        placeholder: "your@email.com",
      },
      contactName: {
        label: "联络人姓名",
        placeholder: "您的姓名",
      },
      contactPhone: {
        label: "联络电话",
        placeholder: "02-1234-5678",
      },
      address: { label: "店铺地址", placeholder: "例如：中山路 1 号" },
      district: { label: "区", placeholder: "例如：西屯区" },
      country: {
        label: "国家",
        placeholder: "请选择国家",
        options: { TW: "台湾", MY: "马来西亚" },
      },
      city: { label: "城市", placeholder: "请选择城市" },
      market: {
        label: "夜市／商圈",
        independent: "我是独立店面，不属于任何商圈",
        fetchError: "无法载入这个城市的夜市／商圈，请稍后再试",
      },
      stallNumber: {
        label: "摊位号码（选填）",
        placeholder: "例如：A-12",
      },
      location: {
        failure: "无法取得目前位置，请确认定位权限或手动输入座标",
        help: "用于夜市 / 商圈探索与附近搜寻。请使用店面或摊位的实际座标。",
        label: "餐厅位置",
        latitudePlaceholder: "纬度，例如 24.147736",
        locating: "定位中...",
        longitudePlaceholder: "经度，例如 120.673648",
        unsupported: "此浏览器不支援定位功能，请手动输入座标",
        useCurrent: "使用目前位置",
      },
      next: "下一步",
      subdomain: {
        available: "此网址可以使用",
        emptyHint: "留空将自动生成",
        invalidFormat: "只能包含小写字母、数字和连字符",
        label: "期望的网址 (选填)",
        placeholder: "yourrestaurant",
        suggestionsLabel: "建议的替代网址：",
        taken: "此网址已被使用",
      },
      submitting: "提交中...",
    },
    title: "填写申请资料",
    toast: {
      submitFailureFallback: "提交失败，请稍后再试",
      submitSuccess: "申请资料已提交",
    },
    validation: {
      businessNameRequired: "请输入餐厅名称",
      contactNameRequired: "请输入联络人姓名",
      emailInvalid: "请输入有效的 Email",
      emailRequired: "请输入 Email",
      latitudeInvalid: "纬度需介于 -90 到 90 之间",
      latitudeRequired: "请输入餐厅纬度",
      longitudeInvalid: "经度需介于 -180 到 180 之间",
      longitudeRequired: "请输入餐厅经度",
      phoneRequired: "请输入联络电话",
      addressRequired: "请输入店铺地址",
      countryRequired: "请选择国家",
      districtRequired: "请输入区",
      cityRequired: "请输入城市",
      subdomainInvalidFormat: "只能包含小写字母、数字和连字符",
      subdomainTaken: "此网址已被使用",
      subdomainTooShort: "至少需要 3 个字元",
    },
  },
  common: {
    back: "返回",
    cancel: "取消",
    loading: "载入中...",
    submit: "提交",
    toast: {
      copiedToClipboard: "已复制到剪贴簿",
    },
  },
  home: {
    tour: {
      title: "从点餐到出餐，一次看懂",
      subtitle: "以下都是系统的实际画面，店家与订单是示范数据。",
      steps: {
        order: {
          title: "客人扫码点餐",
          description: "客人用手机扫桌上的二维码，看着照片点餐，不用下载 App。",
          alt: "客人手机上的点餐画面",
        },
        kitchen: {
          title: "厨房实时收单",
          description:
            "订单立刻出现在厨房平板，按待处理、制作中、准备完成排好。",
          alt: "厨房平板上的订单看板",
        },
        tracking: {
          title: "客人看得到进度",
          description:
            "餐点做到哪一步，客人手机上实时更新，不用再问「好了没」。",
          alt: "客人手机上的订单进度",
        },
        dashboard: {
          title: "老板随时掌握营收",
          description: "今天卖了多少、几张订单、哪桌还在等，后台一眼看完。",
          alt: "老板后台的店主总览",
        },
      },
    },
    cta: {
      button: "开始申请",
      subtitle: "填写申请表单，平台团队审核后会与您联系",
      title: "准备好开始了吗？",
    },
    features: {
      assisted: {
        description: "平台团队审核后为您开通账号，并引导完成开店设置",
        title: "专人开通",
      },
      hosted: {
        description: "系统由平台运维，无需自行架设主机或管理服务器",
        title: "平台代管",
      },
      secure: {
        description: "基于 Cloudflare 全球边缘网络，企业级安全防护",
        title: "安全可靠",
      },
    },
    hero: {
      ctaApply: "立即申请",
      ctaTour: "看看怎么运作 ↓",
      subtitle: "平台代管 · 数据安全 · 专人审核开通",
      titleLine1: "为您的餐厅打造",
      titleLine2: "专属管理系统",
    },
  },
  plans: {
    enterprise: "企业版",
    professional: "专业版",
    standard: "标准版",
    trial: "免费试用",
  },
  success: {
    button: {
      backHome: "返回首页",
      viewStatus: "查看申请状态",
      goToAdmin: "前往管理后台",
    },
    statusLink: {
      savePrompt: "请保存此链接，这是查询申请进度的唯一方式。",
      copy: "复制查询链接",
    },
    contact: {
      prompt: "有任何问题？请联系",
    },
    nextSteps: {
      deploy: {
        description:
          "您的专属系统正在部署中，通常在几分钟内完成。完成后会发送登入资讯。",
        title: "系统部署",
      },
      email: {
        description:
          "核准后，平台会提供店主账号与设置密码链接。申请进度请通过查询链接查看。",
        title: "登录信息",
      },
      start: {
        description: "收到登入资讯后，您可以立即登入管理后台开始设定您的餐厅。",
        title: "开始使用",
      },
      title: "接下来会发生什么？",
    },
    subtitleLine1: "我们已收到您的店家加入申请。",
    subtitleLine2: "平台团队审核通过后，会启用您的帐号与系统资源。",
    summary: {
      applicationId: "申请编号",
      businessName: "餐厅名称",
      contactEmail: "联络 Email",
      plan: "选择方案",
      tenantId: "租户编号",
      status: "申请状态",
      pendingReview: "等待平台审核",
      title: "申请摘要",
    },
    title: "申请已送出！",
  },
  status: {
    title: "申请状态",
    subtitle: "查看您的餐厅申请最新审核进度。",
    loading: "正在载入申请状态...",
    businessName: "餐厅名称",
    currentStatus: "当前状态",
    rejectionReason: "未批准原因",
    lastUpdated: "可使用刷新查看最新进度。",
    refresh: "刷新状态",
    backHome: "返回首页",
    error: {
      missingLink: "此申请状态链接不完整。",
      invalidLink: "此申请状态链接无效。",
      unavailable: "目前无法载入此申请，请稍后再试。",
    },
    labels: {
      pending: "等待审核",
      submitted: "等待审核",
      approved: "已批准",
      provisioning: "设置中",
      completed: "已启用",
      rejected: "未批准",
    },
  },
};

export default zhCN;
