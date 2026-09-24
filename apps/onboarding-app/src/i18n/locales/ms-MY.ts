import type { Messages } from "../types";

const msMY: Messages = {
  app: {
    footer: {
      copyright: "© 2026 MakanMasak. Semua hak terpelihara.",
    },
    tagline: {
      platformHosted: "Dihoskan Platform",
    },
  },
  apply: {
    form: {
      businessName: {
        label: "Nama Restoran",
        placeholder: "cth. Dapur Diraja",
      },
      contactEmail: {
        label: "E-mel",
        placeholder: "your@email.com",
      },
      contactName: {
        label: "Nama Kenalan",
        placeholder: "nama awak",
      },
      contactPhone: {
        label: "telefon",
        placeholder: "+1-234-567-8900",
      },
      address: { label: "Alamat", placeholder: "cth. 1 Jalan Utama" },
      district: { label: "Daerah", placeholder: "cth. Daerah Tengah" },
      country: {
        label: "Negara",
        placeholder: "Pilih negara",
        options: { TW: "Taiwan", MY: "Malaysia" },
      },
      city: { label: "Bandar", placeholder: "Pilih bandar" },
      market: {
        label: "Pasar atau kawasan perniagaan",
        independent: "Saya kedai bebas di luar kawasan pasar",
        fetchError: "Pasar untuk bandar ini tidak dapat dimuatkan. Cuba lagi.",
      },
      stallNumber: {
        label: "Nombor gerai (pilihan)",
        placeholder: "cth. A-12",
      },
      location: {
        failure:
          "Tidak dapat mendapatkan lokasi semasa anda. Semak kebenaran lokasi atau masukkan koordinat secara manual.",
        help: "Digunakan untuk penemuan pasar malam / daerah dan carian berdekatan. Gunakan koordinat etalase atau gerai sebenar.",
        label: "Lokasi Restoran",
        latitudePlaceholder: "Latitud, mis. 24.147736",
        locating: "Mengesan...",
        longitudePlaceholder: "Longitud, cth. 120.673648",
        unsupported:
          "Penyemak imbas ini tidak menyokong geolokasi. Masukkan koordinat secara manual.",
        useCurrent: "Gunakan Lokasi Semasa",
      },
      next: "Seterusnya",
      subdomain: {
        available: "URL ini tersedia",
        emptyHint: "Biarkan kosong untuk menjana automatik",
        invalidFormat: "Hanya huruf kecil, nombor dan sempang dibenarkan",
        label: "URL yang dikehendaki (Pilihan)",
        placeholder: "restoran anda",
        suggestionsLabel: "Alternatif yang dicadangkan:",
        taken: "URL ini sudah diambil",
      },
      submitting: "Menyerahkan...",
    },
    title: "Borang Permohonan",
    toast: {
      submitFailureFallback: "Penyerahan gagal. Sila cuba lagi kemudian.",
      submitSuccess: "Permohonan diserahkan",
    },
    validation: {
      businessNameRequired: "Sila masukkan nama restoran",
      contactNameRequired: "Sila masukkan nama kenalan",
      emailInvalid: "Sila masukkan e-mel yang sah",
      emailRequired: "Sila masukkan e-mel",
      latitudeInvalid: "Latitud mestilah antara -90 dan 90",
      latitudeRequired: "Sila masukkan latitud restoran",
      longitudeInvalid: "Longitud mestilah antara -180 dan 180",
      longitudeRequired: "Sila masukkan longitud restoran",
      phoneRequired: "Sila masukkan nombor telefon",
      addressRequired: "Sila masukkan alamat",
      countryRequired: "Sila pilih negara",
      districtRequired: "Sila masukkan daerah",
      cityRequired: "Sila masukkan bandar",
      subdomainInvalidFormat:
        "Hanya huruf kecil, nombor dan sempang dibenarkan",
      subdomainTaken: "URL ini sudah diambil",
      subdomainTooShort: "Mestilah sekurang-kurangnya 3 aksara",
    },
  },
  common: {
    back: "belakang",
    cancel: "Batal",
    loading: "Memuatkan...",
    submit: "Hantar",
    toast: {
      copiedToClipboard: "Disalin ke papan keratan",
    },
  },
  home: {
    cta: {
      button: "Mulakan Permohonan",
      subtitle:
        "Isi borang permohonan dan pasukan kami akan menghubungi anda selepas semakan.",
      title: "Bersedia untuk Bermula?",
    },
    features: {
      assisted: {
        description:
          "Pasukan kami menyemak permohonan anda, mengaktifkan akaun dan membimbing persediaan kedai",
        title: "Pengaktifan Berbantu",
      },
      hosted: {
        description:
          "Kami mengendalikan sistem untuk anda — tiada pelayan untuk dipasang atau diselenggara",
        title: "Dihoskan Platform",
      },
      secure: {
        description:
          "Dibina pada rangkaian kelebihan global Cloudflare dengan keselamatan gred perusahaan.",
        title: "Selamat & Boleh Dipercayai",
      },
    },
    hero: {
      ctaApply: "Mohon Sekarang",
      ctaDemo: "Lihat Demo →",
      subtitle:
        "Dihoskan Platform · Data Selamat · Disemak dan Diaktifkan oleh Pasukan Kami",
      titleLine1: "Bina Restoran Anda",
      titleLine2: "Sistem Pengurusan Berdedikasi",
    },
  },
  plans: {
    enterprise: "Perusahaan",
    professional: "Profesional",
    standard: "Standard",
    trial: "Percubaan percuma",
  },
  success: {
    button: {
      backHome: "Kembali ke Rumah",
      viewStatus: "Lihat Status Permohonan",
      goToAdmin: "Pergi ke Papan Pemuka Pentadbir",
    },
    statusLink: {
      savePrompt:
        "Simpan pautan ini. Ini satu-satunya cara untuk menyemak kemajuan permohonan anda.",
      copy: "Salin pautan status",
    },
    contact: {
      prompt: "Sebarang pertanyaan? Kenalan",
    },
    nextSteps: {
      deploy: {
        description:
          "Sistem khusus anda sedang digunakan, biasanya dalam masa beberapa minit. Butiran log masuk akan dihantar apabila sedia.",
        title: "Penerapan Sistem",
      },
      email: {
        description:
          "Selepas diluluskan, platform akan memberikan akaun pemilik dan pautan untuk menetapkan kata laluan. Gunakan pautan status untuk menjejak permohonan anda.",
        title: "Maklumat Log Masuk",
      },
      start: {
        description:
          "Sebaik sahaja anda menerima butiran log masuk anda, anda boleh segera mengakses papan pemuka pentadbir dan mula mengkonfigurasi restoran anda.",
        title: "Mulakan",
      },
      title: "Apa yang Berlaku Seterusnya?",
    },
    subtitleLine1: "Kami telah menerima permohonan restoran anda.",
    subtitleLine2:
      "Selepas semakan platform, kami akan mengaktifkan akaun dan sumber hosting anda.",
    summary: {
      applicationId: "ID Permohonan",
      businessName: "Nama Restoran",
      contactEmail: "E-mel Hubungi",
      plan: "Rancangan Terpilih",
      tenantId: "ID penyewa",
      status: "Status Permohonan",
      pendingReview: "Menunggu Semakan Platform",
      title: "Ringkasan Permohonan",
    },
    title: "Permohonan Dihantar!",
  },
  status: {
    title: "Status Permohonan",
    subtitle: "Semak status semakan terkini permohonan restoran anda.",
    loading: "Memuatkan status...",
    businessName: "Nama Restoran",
    currentStatus: "Status Semasa",
    rejectionReason: "Sebab Penolakan",
    lastUpdated: "Segarkan untuk menyemak kemas kini terkini.",
    refresh: "Segarkan Status",
    backHome: "Kembali ke Rumah",
    error: {
      missingLink: "Pautan status ini tidak lengkap.",
      invalidLink: "Pautan status ini tidak sah.",
      unavailable:
        "Kami tidak dapat memuatkan permohonan ini. Sila cuba lagi kemudian.",
    },
    labels: {
      pending: "Menunggu Semakan",
      submitted: "Menunggu Semakan",
      approved: "Diluluskan",
      provisioning: "Sedang Disediakan",
      completed: "Diaktifkan",
      rejected: "Tidak Diluluskan",
    },
  },
};

export default msMY;
