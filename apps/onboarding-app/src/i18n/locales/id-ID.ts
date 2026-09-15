import type { Messages } from "../types";

const idID: Messages = {
  app: {
    footer: {
      copyright: "© 2026 MakanMasak. Semua hak dilindungi undang-undang.",
    },
    tagline: {
      selfHosted: "Dihosting Sendiri",
    },
  },
  apply: {
    form: {
      businessName: {
        label: "Nama Restoran",
        placeholder: "misalnya Dapur Kerajaan",
      },
      contactEmail: {
        label: "Surel",
        placeholder: "anda@email.com",
      },
      contactName: {
        label: "Nama Kontak",
        placeholder: "Namamu",
      },
      contactPhone: {
        label: "Telepon",
        placeholder: "+1-234-567-8900",
      },
      location: {
        failure:
          "Tidak dapat memperoleh lokasi Anda saat ini. Periksa izin lokasi atau masukkan koordinat secara manual.",
        help: "Digunakan untuk penemuan pasar malam / distrik dan pencarian terdekat. Gunakan koordinat etalase atau kios sebenarnya.",
        label: "Lokasi Restoran",
        latitudePlaceholder: "Lintang, mis. 24.147736",
        locating: "Menemukan...",
        longitudePlaceholder: "Bujur, mis. 120.673648",
        unsupported:
          "Browser ini tidak mendukung geolokasi. Masukkan koordinat secara manual.",
        useCurrent: "Gunakan Lokasi Saat Ini",
      },
      next: "Selanjutnya",
      subdomain: {
        available: "URL ini tersedia",
        emptyHint: "Biarkan kosong untuk menghasilkan secara otomatis",
        invalidFormat:
          "Hanya huruf kecil, angka, dan tanda hubung yang diperbolehkan",
        label: "URL yang diinginkan (Opsional)",
        placeholder: "restoran Anda",
        suggestionsLabel: "Alternatif yang disarankan:",
        taken: "URL ini sudah dipakai",
      },
      submitting: "Mengirimkan...",
    },
    title: "Formulir Aplikasi",
    toast: {
      submitFailureFallback: "Pengiriman gagal. Silakan coba lagi nanti.",
      submitSuccess: "Permohonan diajukan",
    },
    validation: {
      businessNameRequired: "Silakan masukkan nama restoran",
      contactNameRequired: "Silakan masukkan nama kontak",
      emailInvalid: "Silakan masukkan email yang valid",
      emailRequired: "Silakan masukkan email",
      latitudeInvalid: "Lintang harus antara -90 dan 90",
      latitudeRequired: "Silakan masukkan garis lintang restoran",
      longitudeInvalid: "Garis bujur harus antara -180 dan 180",
      longitudeRequired: "Silakan masukkan garis bujur restoran",
      phoneRequired: "Silakan masukkan nomor telepon",
      subdomainInvalidFormat:
        "Hanya huruf kecil, angka, dan tanda hubung yang diperbolehkan",
      subdomainTaken: "URL ini sudah dipakai",
      subdomainTooShort: "Minimal harus 3 karakter",
    },
  },
  common: {
    back: "Kembali",
    cancel: "Batalkan",
    loading: "Memuat...",
    submit: "Kirim",
    toast: {
      copiedToClipboard: "Disalin ke papan klip",
    },
  },
  home: {
    cta: {
      button: "Mulai Aplikasi",
      subtitle:
        "Isi aplikasi dan kami akan menghubungi Anda dalam waktu 24 jam.",
      title: "Siap Memulai?",
    },
    features: {
      fast: {
        description: "Alur penerapan otomatis. Hidup dalam 24 jam.",
        title: "Penerapan Cepat",
      },
      isolated: {
        description:
          "Lingkungan cloud yang sepenuhnya terisolasi. Data Anda 100% milik Anda.",
        title: "Lingkungan Terisolasi",
      },
      secure: {
        description:
          "Dibangun di jaringan edge global Cloudflare dengan keamanan tingkat perusahaan.",
        title: "Aman & Andal",
      },
    },
    hero: {
      ctaApply: "Lamar Sekarang",
      ctaDemo: "Lihat Demo →",
      subtitle: "Dihosting Sendiri · Data Aman · Peluncuran dalam 24 Jam",
      titleLine1: "Bangun Restoran Anda",
      titleLine2: "Sistem Manajemen Khusus",
    },
  },
  plans: {
    enterprise: "Perusahaan",
    professional: "Profesional",
    standard: "Standar",
    trial: "Uji coba gratis",
  },
  success: {
    button: {
      backHome: "Kembali ke Rumah",
      goToAdmin: "Buka Dasbor Admin",
    },
    contact: {
      prompt: "Ada pertanyaan? Kontak",
    },
    nextSteps: {
      deploy: {
        description:
          "Sistem khusus Anda sedang diterapkan, biasanya dalam beberapa menit. Detail login akan dikirim jika sudah siap.",
        title: "Penerapan Sistem",
      },
      email: {
        prefix: "Kami telah mengirimkan email konfirmasi ke",
        suffix: ". Silakan periksa kotak masuk Anda.",
        title: "Email Konfirmasi",
      },
      start: {
        description:
          "Setelah Anda menerima detail login, Anda dapat segera mengakses dasbor admin dan mulai mengonfigurasi restoran Anda.",
        title: "Memulai",
      },
      title: "Apa yang Terjadi Selanjutnya?",
    },
    subtitleLine1: "Kami telah menerima aplikasi restoran Anda.",
    subtitleLine2:
      "Setelah ditinjau platform, kami akan mengaktifkan akun dan sumber daya hosting Anda.",
    summary: {
      applicationId: "ID Aplikasi",
      businessName: "Nama Restoran",
      cloudflare: "Hosting Platform",
      connected: "Aktif",
      contactEmail: "Hubungi Email",
      plan: "Paket yang Dipilih",
      subdomain: "URL khusus",
      tenantId: "ID Penyewa",
      status: "Status Aplikasi",
      pendingReview: "Menunggu Tinjauan Platform",
      title: "Ringkasan Aplikasi",
    },
    title: "Aplikasi Dikirim!",
  },
};

export default idID;
