import type { Messages } from "../types";

const viVN: Messages = {
  app: {
    footer: {
      copyright: "© 2026 MakanMasak. Mọi quyền được bảo lưu.",
    },
    tagline: {
      platformHosted: "Nền tảng vận hành",
    },
  },
  apply: {
    form: {
      businessName: {
        label: "Tên nhà hàng",
        placeholder: "ví dụ: Bếp Hoàng Gia",
      },
      contactEmail: {
        label: "Email",
        placeholder: "your@email.com",
      },
      contactName: {
        label: "Tên liên hệ",
        placeholder: "Tên của bạn",
      },
      contactPhone: {
        label: "Điện thoại",
        placeholder: "+1-234-567-8900",
      },
      address: { label: "Địa chỉ", placeholder: "ví dụ: 1 Đường Chính" },
      district: { label: "Quận", placeholder: "ví dụ: Quận Trung Tâm" },
      country: {
        label: "Quốc gia",
        placeholder: "Chọn quốc gia",
        options: { TW: "Đài Loan", MY: "Malaysia" },
      },
      city: { label: "Thành phố", placeholder: "Chọn thành phố" },
      market: {
        label: "Chợ hoặc khu thương mại",
        independent: "Tôi là cửa hàng độc lập ngoài khu chợ",
        fetchError: "Không thể tải chợ cho thành phố này. Vui lòng thử lại.",
      },
      stallNumber: {
        label: "Số gian hàng (không bắt buộc)",
        placeholder: "ví dụ: A-12",
      },
      location: {
        failure:
          "Không thể nhận được vị trí hiện tại của bạn. Kiểm tra quyền vị trí hoặc nhập tọa độ theo cách thủ công.",
        help: "Được sử dụng để khám phá chợ đêm / quận và tìm kiếm gần đó. Sử dụng tọa độ mặt tiền cửa hàng hoặc gian hàng thực tế.",
        label: "Vị trí nhà hàng",
        latitudePlaceholder: "Vĩ độ, ví dụ: 24.147736",
        locating: "Đang định vị...",
        longitudePlaceholder: "Kinh độ, ví dụ: 120.673648",
        unsupported:
          "Trình duyệt này không hỗ trợ định vị địa lý. Nhập tọa độ bằng tay.",
        useCurrent: "Sử dụng vị trí hiện tại",
      },
      next: "Tiếp theo",
      subdomain: {
        available: "URL này có sẵn",
        emptyHint: "Để trống để tự động tạo",
        invalidFormat: "Chỉ cho phép chữ cái viết thường, số và dấu gạch nối",
        label: "URL mong muốn (Tùy chọn)",
        placeholder: "nhà hàng của bạn",
        suggestionsLabel: "Các lựa chọn thay thế được đề xuất:",
        taken: "URL này đã được sử dụng",
      },
      submitting: "Đang gửi...",
    },
    title: "Đơn đăng ký",
    toast: {
      submitFailureFallback: "Gửi không thành công. Vui lòng thử lại sau.",
      submitSuccess: "Đơn đăng ký đã được gửi",
    },
    validation: {
      businessNameRequired: "Vui lòng nhập tên nhà hàng",
      contactNameRequired: "Vui lòng nhập tên liên hệ",
      emailInvalid: "Vui lòng nhập email hợp lệ",
      emailRequired: "Vui lòng nhập email",
      latitudeInvalid: "Vĩ độ phải nằm trong khoảng từ -90 đến 90",
      latitudeRequired: "Vui lòng nhập vĩ độ nhà hàng",
      longitudeInvalid: "Kinh độ phải nằm trong khoảng từ -180 đến 180",
      longitudeRequired: "Vui lòng nhập kinh độ của nhà hàng",
      phoneRequired: "Vui lòng nhập số điện thoại",
      addressRequired: "Vui lòng nhập địa chỉ",
      countryRequired: "Vui lòng chọn quốc gia",
      districtRequired: "Vui lòng nhập quận",
      cityRequired: "Vui lòng nhập thành phố",
      subdomainInvalidFormat:
        "Chỉ cho phép chữ cái viết thường, số và dấu gạch nối",
      subdomainTaken: "URL này đã được sử dụng",
      subdomainTooShort: "Phải có ít nhất 3 ký tự",
    },
  },
  common: {
    back: "Quay lại",
    cancel: "Hủy bỏ",
    loading: "Đang tải...",
    submit: "Gửi",
    toast: {
      copiedToClipboard: "Đã sao chép vào bảng nhớ tạm",
    },
  },
  home: {
    cta: {
      button: "Bắt đầu ứng dụng",
      subtitle:
        "Điền đơn đăng ký, đội ngũ của chúng tôi sẽ liên hệ sau khi xét duyệt.",
      title: "Sẵn sàng để bắt đầu?",
    },
    features: {
      assisted: {
        description:
          "Đội ngũ của chúng tôi xét duyệt đơn, kích hoạt tài khoản và hướng dẫn bạn thiết lập cửa hàng",
        title: "Kích hoạt có hỗ trợ",
      },
      hosted: {
        description:
          "Chúng tôi vận hành hệ thống cho bạn — không cần tự dựng hay bảo trì máy chủ",
        title: "Nền tảng vận hành",
      },
      secure: {
        description:
          "Được xây dựng trên mạng biên toàn cầu của Cloudflare với tính năng bảo mật cấp doanh nghiệp.",
        title: "An toàn & đáng tin cậy",
      },
    },
    hero: {
      ctaApply: "Đăng ký ngay",
      ctaDemo: "Xem bản trình diễn →",
      subtitle:
        "Nền tảng vận hành · Dữ liệu an toàn · Được đội ngũ xét duyệt và kích hoạt",
      titleLine1: "Xây dựng nhà hàng của bạn",
      titleLine2: "Hệ thống quản lý chuyên dụng",
    },
  },
  plans: {
    enterprise: "Doanh nghiệp",
    professional: "chuyên nghiệp",
    standard: "Tiêu chuẩn",
    trial: "Dùng thử miễn phí",
  },
  success: {
    button: {
      backHome: "Quay lại trang chủ",
      viewStatus: "Xem trạng thái đơn đăng ký",
      goToAdmin: "Đi tới Bảng điều khiển dành cho quản trị viên",
    },
    statusLink: {
      savePrompt:
        "Hãy lưu liên kết này. Đây là cách duy nhất để kiểm tra tiến độ đơn đăng ký.",
      copy: "Sao chép liên kết trạng thái",
    },
    contact: {
      prompt: "Có câu hỏi nào không? Liên hệ",
    },
    nextSteps: {
      deploy: {
        description:
          "Hệ thống chuyên dụng của bạn đang được triển khai, thường trong vòng vài phút. Chi tiết đăng nhập sẽ được gửi khi sẵn sàng.",
        title: "Triển khai hệ thống",
      },
      email: {
        description:
          "Sau khi được duyệt, nền tảng sẽ cung cấp tài khoản chủ quán và liên kết đặt mật khẩu. Dùng liên kết trạng thái để theo dõi đơn của bạn.",
        title: "Thông tin đăng nhập",
      },
      start: {
        description:
          "Sau khi nhận được thông tin đăng nhập, bạn có thể truy cập ngay vào bảng điều khiển quản trị và bắt đầu định cấu hình nhà hàng của mình.",
        title: "Bắt đầu",
      },
      title: "Điều gì xảy ra tiếp theo?",
    },
    subtitleLine1: "Chúng tôi đã nhận được đơn đăng ký nhà hàng của bạn.",
    subtitleLine2:
      "Sau khi nền tảng xét duyệt, chúng tôi sẽ kích hoạt tài khoản và tài nguyên lưu trữ của bạn.",
    summary: {
      applicationId: "ID ứng dụng",
      businessName: "Tên nhà hàng",
      contactEmail: "Email liên hệ",
      plan: "Kế hoạch đã chọn",
      tenantId: "ID người thuê",
      status: "Trạng thái ứng dụng",
      pendingReview: "Đang chờ nền tảng xét duyệt",
      title: "Tóm tắt ứng dụng",
    },
    title: "Ứng dụng đã được gửi!",
  },
  status: {
    title: "Trạng thái đơn đăng ký",
    subtitle: "Kiểm tra trạng thái xét duyệt mới nhất.",
    loading: "Đang tải trạng thái...",
    businessName: "Tên nhà hàng",
    currentStatus: "Trạng thái hiện tại",
    rejectionReason: "Lý do từ chối",
    lastUpdated: "Làm mới để kiểm tra cập nhật mới nhất.",
    refresh: "Làm mới trạng thái",
    backHome: "Quay lại trang chủ",
    error: {
      missingLink: "Liên kết trạng thái này không đầy đủ.",
      invalidLink: "Liên kết trạng thái này không hợp lệ.",
      unavailable: "Không thể tải đơn đăng ký này. Vui lòng thử lại sau.",
    },
    labels: {
      pending: "Đang chờ xét duyệt",
      submitted: "Đang chờ xét duyệt",
      approved: "Đã phê duyệt",
      provisioning: "Đang thiết lập",
      completed: "Đã kích hoạt",
      rejected: "Không được phê duyệt",
    },
  },
};

export default viVN;
