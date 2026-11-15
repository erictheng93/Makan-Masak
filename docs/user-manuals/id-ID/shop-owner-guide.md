# 🏪 Panduan Pemilik Restoran MakanMakan

> **Versi**: 2.0
> **Terakhir Diperbarui**: 2025-10-26
> **Untuk**: Pemilik Restoran, Manajer
> **Paket, uji coba, dan pemakaian**: Pemilik toko mengganti paket sendiri di "Paket & Pemakaian" pada dasbor admin (upgrade berlaku segera, downgrade berlaku di akhir periode, tanpa pembayaran online). Lihat [Paket, uji coba, dan pemakaian](../id-ID/plans-and-usage.html).

---

## 📚 Daftar Isi

1. [Mulai Cepat](#mulai-cepat)
2. [Gambaran Sistem](#gambaran-sistem)
3. [Pengaturan Dasar Restoran](#pengaturan-dasar-restoran)
4. [Manajemen Menu](#manajemen-menu)
5. [Manajemen Meja & Kursi](#manajemen-meja--kursi)
6. [Sistem Kode QR](#sistem-kode-qr)
7. [Manajemen Pesanan](#manajemen-pesanan)
8. [Manajemen Staf](#manajemen-staf)
9. [Manajemen Pelanggan](#manajemen-pelanggan)
10. [Sistem Penjadwalan](#sistem-penjadwalan)
11. [Manajemen Cuti](#manajemen-cuti)
12. [Analisis Bisnis](#analisis-bisnis)
13. [Analisis AI](#analisis-ai)
14. [FAQ](#faq)

---

## 🚀 Mulai Cepat

### Proses Login Sistem

```
┌─────────────────────────────────────────────┐
│ Proses Login                                │
├─────────────────────────────────────────────┤
│                                             │
│  1️⃣ Buka Dashboard Admin                   │
│      ↓                                      │
│  2️⃣ Masukkan Username & Password           │
│      ↓                                      │
│  3️⃣ Sistem Melakukan Autentikasi           │
│      ↓                                      │
│  4️⃣ Masuk ke Dashboard Pemilik             │
│                                             │
└─────────────────────────────────────────────┘
```

### Checklist Login Pertama

✅ **Langkah 1: Lengkapi Profil Restoran**

- Nama restoran, alamat, kontak
- Pengaturan jam operasional
- Upload foto restoran

✅ **Langkah 2: Bangun Struktur Menu**

- Tambah kategori menu
- Upload informasi menu
- Atur harga dan gambar

✅ **Langkah 3: Setup Meja**

- Buat informasi meja
- Generate kode QR
- Cetak dan pasang

✅ **Langkah 4: Tambah Akun Staf**

- Buat data karyawan
- Assign hak akses peran
- Kirim info login

✅ **Langkah 5: Mulai Operasional**

- Test alur pemesanan
- Konfirmasi penerimaan order
- Monitor operasional

---

## 🏢 Gambaran Sistem

### Ruang Lingkup Izin Pemilik

```
┌─────────────────────────────────────────────────────────┐
│ Fungsi yang Dikelola Pemilik                            │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌──────────────┐    ┌──────────────┐                 │
│  │  Pengaturan  │───→│  Manajemen   │                 │
│  │  Restoran    │    │  Menu        │                 │
│  └──────────────┘    └──────────────┘                 │
│         ↓                    ↓                         │
│  ┌──────────────┐    ┌──────────────┐                 │
│  │  Manajemen   │───→│  Sistem      │                 │
│  │  Meja        │    │  Kode QR     │                 │
│  └──────────────┘    └──────────────┘                 │
│         ↓                    ↓                         │
│  ┌──────────────┐    ┌──────────────┐                 │
│  │  Manajemen   │───→│  Manajemen   │                 │
│  │  Pesanan     │    │  Staf        │                 │
│  └──────────────┘    └──────────────┘                 │
│         ↓                    ↓                         │
│  ┌──────────────┐    ┌──────────────┐                 │
│  │  Analisis    │───→│  Analisis    │                 │
│  │  Bisnis      │    │  AI          │                 │
│  └──────────────┘    └──────────────┘                 │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Mode Kolaborasi Multi-Peran

```
    Pemilik (Anda)
           │
    ┌──────┼──────┬──────┐
    ↓      ↓      ↓      ↓
   Chef  Server Kasir Pelanggan
    │      │      │      │
    └──────┴──────┴──────┘
           │
   Platform Real-time
```

**Penjelasan**:

- **Pemilik**: Izin penuh, lihat semua data
- **Chef**: Terima pesanan, update status masak
- **Server**: Konfirmasi pengiriman, update progress
- **Kasir**: Proses pembayaran, lihat pendapatan
- **Pelanggan**: Scan QR pesan, lacak pesanan

---

## ⚙️ Pengaturan Dasar Restoran

### Manajemen Informasi Restoran

Navigasi: **Dashboard → Pengaturan Restoran → Info Dasar**

#### Informasi Wajib

| Field           | Deskripsi                        | Contoh                                |
| --------------- | -------------------------------- | ------------------------------------- |
| Nama Restoran   | Nama ditampilkan ke pelanggan    | Restoran Seafood Lezat                |
| Alamat          | Alamat lengkap dengan kode pos   | Jl. Sudirman No. 123, Jakarta         |
| Telepon         | Layanan pelanggan atau reservasi | 021-1234-5678                         |
| Jam Operasional | Jam operasi harian               | 11:00-14:00, 17:00-21:00              |
| Deskripsi       | Pengenalan singkat, kekhasan     | Seafood segar dan masakan tradisional |

#### Konfigurasi Jam Operasional

```
┌─────────────────────────────────────────┐
│ Contoh Jam Operasional                  │
├─────────────────────────────────────────┤
│                                         │
│  Senin - Jumat:                         │
│  ├─ Makan Siang: 11:00 - 14:00         │
│  └─ Makan Malam: 17:00 - 21:00         │
│                                         │
│  Sabtu - Minggu:                        │
│  └─ Sepanjang Hari: 11:00 - 21:00      │
│                                         │
│  Tutup: Setiap Rabu                     │
│                                         │
└─────────────────────────────────────────┘
```

### Upload Foto Restoran

Format didukung: JPG, PNG, WebP
Ukuran disarankan: 1920x1080 pixels
Ukuran file: Maksimal 5MB

**Langkah Upload**:

1. Klik "Upload Foto"
2. Pilih foto eksterior atau menu andalan
3. Sistem otomatis compress dan buat berbagai ukuran
4. Preview dan simpan

---

## 🍽️ Manajemen Menu

### Struktur Menu

```
Menu Restoran
  │
  ├── Kategori 1: Pembuka
  │    ├── Menu A
  │    ├── Menu B
  │    └── Menu C
  │
  ├── Kategori 2: Menu Utama
  │    ├── Menu D
  │    ├── Menu E
  │    └── Menu F
  │
  └── Kategori 3: Penutup
       ├── Menu G
       └── Menu H
```

### Tambah Kategori Menu

Navigasi: **Manajemen Menu → Manajemen Kategori → Tambah Kategori**

#### Pengaturan Kategori

| Pengaturan    | Deskripsi                 | Contoh         |
| ------------- | ------------------------- | -------------- |
| Nama Kategori | Judul ditampilkan di menu | Menu Seafood   |
| Ikon          | Simbol ikon (opsional)    | 🦐             |
| Urutan        | Urutan tampilan           | 1, 2, 3...     |
| Status        | Tampil di menu            | Aktif/Nonaktif |

#### Best Practice Manajemen Kategori

```
┌─────────────────────────────────────────┐
│ Struktur Kategori Disarankan            │
├─────────────────────────────────────────┤
│                                         │
│  1. 🥗 Pembuka / Appetizer             │
│  2. 🥘 Menu Utama / Andalan            │
│  3. 🍜 Mie & Nasi                      │
│  4. 🥤 Minuman                         │
│  5. 🍰 Penutup                         │
│  6. ⭐ Spesial Hari Ini                │
│                                         │
└─────────────────────────────────────────┘
```

### Tambah Item Menu

Navigasi: **Manajemen Menu → Daftar Item → Tambah Item**

#### Form Informasi Item

```
┌──────────────────────────────────────────────┐
│ Form Input Item Menu                         │
├──────────────────────────────────────────────┤
│                                              │
│  【Info Dasar】                              │
│  ├─ Nama Menu: ___________________          │
│  ├─ Kategori: [Pilih]                       │
│  ├─ Harga: Rp ______                        │
│  └─ Deskripsi: ___________________          │
│                                              │
│  【Upload Gambar】                           │
│  └─ [Klik Upload] atau Drag Gambar Di Sini │
│                                              │
│  【Status Ketersediaan】                     │
│  ├─ ✅ Tersedia Saat Ini                    │
│  ├─ ⏸️ Sementara Habis                      │
│  └─ ❌ Tidak Tersedia                       │
│                                              │
│  【Pengaturan Lain】                         │
│  ├─ 🌶️ Level Pedas                         │
│  ├─ 🥬 Opsi Vegetarian                     │
│  └─ ⏱️ Waktu Persiapan                     │
│                                              │
└──────────────────────────────────────────────┘
```

#### Persyaratan Gambar

| Item              | Persyaratan                                     |
| ----------------- | ----------------------------------------------- |
| Format            | JPG, PNG, WebP                                  |
| Ukuran Disarankan | 800x600 pixels                                  |
| Ukuran File       | Maksimal 3MB                                    |
| Tips Foto         | Pencahayaan bagus, fokus tajam, plating menarik |

**Proses Optimasi Gambar**:

```
Upload Gambar Asli
     ↓
Kompresi Otomatis
     ↓
Buat Berbagai Ukuran
 ├─ Thumbnail (200x150)
 ├─ Sedang (400x300)
 └─ Asli (800x600)
     ↓
Simpan ke Cloud (Cloudflare R2)
     ↓
Distribusi Global Cepat (CDN)
```

### Manajemen Batch

#### Update Harga Batch

Navigasi: **Manajemen Menu → Operasi Batch → Penyesuaian Harga**

Kasus penggunaan:

- Penyesuaian harga musiman
- Penyesuaian kenaikan biaya
- Pengaturan harga promo

**Langkah**:

1. Pilih item yang akan disesuaikan (multi-pilih)
2. Atur metode penyesuaian:
   - Jumlah tetap (mis: +Rp 10.000)
   - Persentase (mis: +5%)
3. Preview hasil
4. Konfirmasi dan terapkan

#### Aktifkan/Nonaktifkan Batch

Aksi cepat:

- ✅ Aktifkan item terpilih sekali klik
- ⏸️ Jeda item terpilih sekali klik
- ❌ Nonaktifkan item terpilih sekali klik

---

## 🪑 Manajemen Meja & Kursi

### Arsitektur Sistem Meja

```
┌─────────────────────────────────────────────────────┐
│ Arsitektur Sistem Manajemen Meja                    │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Restoran                                           │
│   │                                                 │
│   ├─ Area 1: Area Makan                           │
│   │   ├─ Meja A (4 kursi)                         │
│   │   │   ├─ Kursi A1                             │
│   │   │   ├─ Kursi A2                             │
│   │   │   ├─ Kursi A3                             │
│   │   │   └─ Kursi A4                             │
│   │   │                                            │
│   │   └─ Meja B (6 kursi)                         │
│   │       └─ [6 kursi]                            │
│   │                                                │
│   └─ Area 2: Area Luar                            │
│       └─ Meja C (2 kursi)                         │
│           └─ [2 kursi]                            │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Tambah Meja

Navigasi: **Manajemen Meja → Tambah Meja**

#### Form Pengaturan Meja

```
┌─────────────────────────────────────────┐
│ Konfigurasi Meja                        │
├─────────────────────────────────────────┤
│                                         │
│  Nomor Meja: [A1] [A2] [A3]...         │
│  Nama Meja: _______________            │
│  Jumlah Kursi: [4]                     │
│  Area: [Area Makan ▼]                  │
│  Status: ○ Aktif  ○ Nonaktif          │
│                                         │
│  [Generate QR]  [Simpan Pengaturan]    │
│                                         │
└─────────────────────────────────────────┘
```

#### Saran Penamaan Meja

```
Penamaan berbasis area:
  AreaMakan-A1, A2, A3...
  AreaLuar-B1, B2, B3...
  RuangPrivat-VIP1, VIP2...

Penamaan berbasis lantai:
  L1-01, L1-02, L1-03...
  L2-01, L2-02, L2-03...

Penamaan berbasis fungsi:
  Bar-1, Bar-2...
  Sofa-1, Sofa-2...
  Jendela-1, Jendela-2...
```

### Manajemen Kursi (Mode Ganda)

MakanMakan mendukung dua mode manajemen kursi:

#### Mode 1: QR Code Level Meja

```
┌─────────────────────────────────────┐
│  Meja A1 (4 kursi)                  │
│                                     │
│    [Satu QR Code di Tengah Meja]   │
│                                     │
│  Kasus Penggunaan:                  │
│  • Kelompok makan bersama           │
│  • Makan keluarga, teman            │
│  • Pembayaran gabungan              │
│                                     │
└─────────────────────────────────────┘
```

#### Mode 2: QR Code Level Kursi

```
┌─────────────────────────────────────┐
│  Meja B1 (4 kursi)                  │
│                                     │
│  [QR-1]     [QR-2]                 │
│   Kursi 1    Kursi 2               │
│                                     │
│  [QR-3]     [QR-4]                 │
│   Kursi 3    Kursi 4               │
│                                     │
│  Kasus Penggunaan:                  │
│  • Pesan individu, bayar terpisah  │
│  • Fast food, food court           │
│  • Makan siang bisnis              │
│                                     │
└─────────────────────────────────────┘
```

#### Panduan Pemilihan Mode

| Tipe Bisnis          | Mode Disarankan | Alasan                                                        |
| -------------------- | --------------- | ------------------------------------------------------------- |
| Restoran Tradisional | Level meja      | Biasanya makan kelompok                                       |
| Restoran Hotpot      | Level meja      | Panci bersama, pesan grup                                     |
| Fast Food            | Level kursi     | Pesan individu, turnover cepat                                |
| Food Court           | Level kursi     | Orang asing duduk bersama, bayar terpisah                     |
| Café                 | Campuran        | Meja besar pakai level meja, kursi individu pakai level kursi |

### Buat Kursi

Navigasi: **Manajemen Meja → Pilih Meja → Konfigurasi Kursi**

**Buat Kursi Batch**:

```
Pilih Meja → Atur Jumlah Kursi → Auto-Generate Nomor
                              ↓
                    Kursi 1, Kursi 2, Kursi 3, Kursi 4
                              ↓
                      Sistem Auto-Generate QR Code
```

---

## 📱 Sistem Kode QR

### Tiga Mode Kode QR

MakanMakan menyediakan tiga mode QR code untuk skenario bisnis berbeda:

```
┌─────────────────────────────────────────────────────┐
│ Arsitektur Sistem Kode QR                           │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Mode 1: QR Level Toko                             │
│  ┌──────────────────────────────┐                 │
│  │  Satu QR → Seluruh Restoran  │                 │
│  │  Untuk: Takeaway, Delivery   │                 │
│  └──────────────────────────────┘                 │
│                 │                                   │
│  Mode 2: QR Level Meja                             │
│  ┌──────────────────────────────┐                 │
│  │  Satu QR per Meja            │                 │
│  │  Untuk: Dine-in Tradisional  │                 │
│  └──────────────────────────────┘                 │
│                 │                                   │
│  Mode 3: QR Level Kursi                            │
│  ┌──────────────────────────────┐                 │
│  │  QR Individual per Kursi     │                 │
│  │  Untuk: Pesan Terpisah       │                 │
│  └──────────────────────────────┘                 │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Mode 1: QR Level Toko

**Skenario Penggunaan**:

- ✅ Toko takeaway/delivery
- ✅ Tanpa kursi (makan berdiri, warung pinggir jalan)
- ✅ Food truck mobile
- ✅ Toko pop-up, kios pasar

**Cara Generate**:

Navigasi: **Manajemen QR Code → Toko QR → Generate QR Code Toko**

```
┌─────────────────────────────────────┐
│ Pengaturan QR Code Toko             │
├─────────────────────────────────────┤
│                                     │
│  Tipe QR Code: Level toko          │
│  Cara pakai: Pelanggan scan langsung│
│             masuk menu              │
│                                     │
│  Saran lokasi tempel:               │
│  ├─ Poster pintu masuk toko        │
│  ├─ Depan counter                  │
│  ├─ Share ke media sosial          │
│  └─ Link platform delivery         │
│                                     │
│  [Generate QR Code]  [Download]    │
│                                     │
└─────────────────────────────────────┘
```

**Alur Pesan Pelanggan**:

```
Scan QR Code toko
     ↓
Masuk menu
     ↓
Pilih menu
     ↓
Isi info ambil pesanan
     ↓
Konfirmasi order
     ↓
Tunggu notif ambil pesanan
```

### Mode 2: QR Level Meja

**Skenario Penggunaan**:

- ✅ Restoran tradisional dine-in
- ✅ Satu meja pesan bareng
- ✅ Makan keluarga, teman
- ✅ Mode bayar gabungan

**Cara Generate**:

Navigasi: **Manajemen Meja → Pilih Meja → Generate QR Code**

```
┌─────────────────────────────────────┐
│ Pengaturan QR Code Meja             │
├─────────────────────────────────────┤
│                                     │
│  Nomor meja: A1                     │
│  Tipe QR Code: Level meja           │
│                                     │
│  Opsi pengaturan:                   │
│  □ Izinkan tambah order             │
│  □ Tampilkan info meja              │
│  □ Auto isi nomor meja              │
│                                     │
│  [Generate Single QR]  [Batch Generate]│
│                                     │
└─────────────────────────────────────┘
```

**Batch Generate QR Code Meja**:

```
Pilih beberapa meja
     ↓
Set parameter uniform
     ↓
One-click generate semua QR Code
     ↓
Download file ZIP
     ↓
Unzip lalu print & tempel
```

**Alur Pesan Pelanggan**:

```
Duduk → Scan QR meja
          ↓
     Masuk halaman order
     (Auto isi nomor meja)
          ↓
     Pilih menu
          ↓
     Kirim order
          ↓
     Tunggu hidangan
```

### Mode 3: QR Level Kursi

**Skenario Penggunaan**:

- ✅ Fast food, food court
- ✅ Makan siang bisnis
- ✅ Orang asing duduk bareng
- ✅ Pesan individual, bayar terpisah

**Cara Generate**:

Navigasi: **Manajemen Meja → Pilih Meja → Manajemen Kursi → Batch Generate QR Kursi**

```
┌─────────────────────────────────────┐
│ Batch Generate QR Code Kursi        │
├─────────────────────────────────────┤
│                                     │
│  Meja: A1                           │
│  Jumlah kursi: [4]                  │
│                                     │
│  Nomor kursi auto-generate:         │
│  ├─ A1-Kursi1                      │
│  ├─ A1-Kursi2                      │
│  ├─ A1-Kursi3                      │
│  └─ A1-Kursi4                      │
│                                     │
│  [Batch Generate QR]  [Download All]│
│                                     │
└─────────────────────────────────────┘
```

**Contoh Label Kursi**:

```
        Meja A1 (Meja 4 Orang)
┌───────────┬───────────┐
│   [QR-1]  │   [QR-2]  │
│   Kursi 1 │   Kursi 2 │
├───────────┼───────────┤
│   [QR-3]  │   [QR-4]  │
│   Kursi 3 │   Kursi 4 │
└───────────┴───────────┘
```

**Alur Pesan Pelanggan**:

```
Duduk di kursi → Scan QR Code kursi
                     ↓
                Masuk halaman order
                (Auto isi meja + nomor kursi)
                     ↓
                Pilih menu sendiri
                     ↓
                Kirim order individual
                     ↓
                Tunggu hidangan
                     ↓
                Bayar terpisah
```

---

### Desain dan Cetak QR Code

#### Rekomendasi Ukuran QR Code

| Lokasi Tempel      | Ukuran Recommended | Jarak Scan |
| ------------------ | ------------------ | ---------- |
| Standing sign meja | 5cm x 5cm          | 20-30cm    |
| Sticker meja       | 3cm x 3cm          | 10-20cm    |
| Poster dinding     | 15cm x 15cm        | 50-100cm   |
| Layar elektronik   | Variabel           | 20-50cm    |

#### Template Desain QR Code

Navigasi: **Manajemen QR Code → Desain Template → Pilih Template**

```
┌─────────────────────────────────────────┐
│ Opsi Desain QR Code                     │
├─────────────────────────────────────────┤
│                                         │
│  Template 1: Minimalis                  │
│  ├─ QR Code murni                      │
│  └─ Warna hitam putih                  │
│                                         │
│  Template 2: Branded                    │
│  ├─ Termasuk Logo restoran             │
│  ├─ Warna brand                        │
│  └─ Nomor meja/kursi                   │
│                                         │
│  Template 3: Panduan                    │
│  ├─ QR Code + teks instruksi           │
│  ├─ Hint "Scan untuk Pesan"            │
│  └─ Panduan step-by-step               │
│                                         │
└─────────────────────────────────────────┘
```

#### Saran Pencetakan

**Material Kertas**:

- 🏆 **Recommended**: Sticker waterproof, material PVC
- ✅ **Dapat digunakan**: Kertas glossy, photo paper
- ❌ **Tidak disarankan**: Kertas copy biasa (mudah rusak)

**Opsi Laminating**:

- Penggunaan meja: Disarankan laminating atau acrylic standing
- Penggunaan outdoor: Harus waterproof treatment
- Penggunaan sementara: Bisa pakai selotip transparan untuk proteksi

### Fungsi Manajemen QR Code

#### Monitor Real-time

Navigasi: **Manajemen QR Code → Statistik Penggunaan**

```
┌─────────────────────────────────────────┐
│ Monitor Status Penggunaan QR Code Real-time│
├─────────────────────────────────────────┤
│                                         │
│  Jumlah scan hari ini: 127 kali        │
│                                         │
│  Tingkat penggunaan tiap QR Code:      │
│  ├─ Meja A1: ████████░░ 85%            │
│  ├─ Meja A2: ██████░░░░ 62%            │
│  ├─ Meja B1: ██████████ 100%           │
│  └─ Meja B2: ████░░░░░░ 45%            │
│                                         │
│  Alert anomali:                         │
│  ⚠️ Meja C3 tidak ada scan 2 jam       │
│                                         │
└─────────────────────────────────────────┘
```

#### Reset QR Code Cepat

**Skenario Penggunaan**:

- QR Code rusak perlu print ulang
- Pertimbangan keamanan perlu ganti
- Rekonfigurasi tata letak meja

**Langkah Operasi**:

1. Ke: **Manajemen QR Code → Pilih QR Code Target**
2. Klik "Generate Ulang"
3. Download QR Code baru
4. QR Code lama otomatis invalid

---

## 📋 Manajemen Pesanan

### Siklus Hidup Pesanan

```
┌─────────────────────────────────────────────────────┐
│ Alur Kerja Pesanan Lengkap                          │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Pelanggan Scan QR → Buka Menu                     │
│         ↓                                           │
│  Pilih Item → Tambah ke Keranjang                  │
│         ↓                                           │
│  Konfirmasi Pesanan → Kirim                        │
│         ↓                                           │
│  ⏰ Status: Pending (Menunggu Konfirmasi)          │
│         ↓                                           │
│  👨‍🍳 Koki Terima Notif → Konfirmasi               │
│         ↓                                           │
│  ⏰ Status: Preparing (Sedang Dimasak)             │
│         ↓                                           │
│  👨‍🍳 Koki Selesai Masak → Update Status          │
│         ↓                                           │
│  ⏰ Status: Ready (Siap Diantar)                   │
│         ↓                                           │
│  🚶 Server Ambil → Antar ke Meja                  │
│         ↓                                           │
│  ⏰ Status: Delivered (Sudah Diantar)              │
│         ↓                                           │
│  💳 Pelanggan Selesai → Bayar di Kasir            │
│         ↓                                           │
│  ⏰ Status: Completed (Selesai)                    │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Monitor Pesanan Real-time

Navigasi: **Dashboard → Monitor Pesanan**

```
┌───────────────────────────────────────────────────────┐
│ Monitor Pesanan Real-time           [2025-10-26 14:30]│
├───────────────────────────────────────────────────────┤
│                                                       │
│  【Pending】(3 pesanan)                               │
│  ├─ #A-001 | Meja A1 | 2 item | 2 menit lalu        │
│  ├─ #A-002 | Meja B2 | 5 item | 5 menit lalu        │
│  └─ #S-001 | Toko | 3 item | 1 menit lalu           │
│                                                       │
│  【Preparing】(5 pesanan) 👨‍🍳                        │
│  ├─ #A-003 | Meja A3 | Memasak 8 menit              │
│  ├─ #A-004 | Meja C1 | Memasak 12 menit             │
│  └─ ...                                              │
│                                                       │
│  【Ready】(2 pesanan) 🔔                              │
│  ├─ #A-005 | Meja D2 | Siap diantar!                │
│  └─ #A-006 | Meja A1 | Siap diantar!                │
│                                                       │
│  【Delivered】(8 pesanan) ✅                          │
│  Pelanggan sedang makan...                           │
│                                                       │
└───────────────────────────────────────────────────────┘
```

### Informasi Detail Pesanan

Klik pesanan mana saja untuk lihat info lengkap:

```
┌─────────────────────────────────────────┐
│ Info Detail Pesanan #1234               │
├─────────────────────────────────────────┤
│                                         │
│  【Info Dasar】                         │
│  Meja: A3                               │
│  Waktu: 2025-10-26 12:35               │
│  Status: 🟡 Sedang Memasak              │
│  Estimasi selesai: 12:50 (8 menit lagi)│
│                                         │
│  【Detail Pesanan】                     │
│  1. Nasi Goreng Seafood x1   $180      │
│  2. Teh Wintermelon x2       $60       │
│  3. Tahu Goreng x1           $80       │
│                                         │
│  Subtotal:           $320              │
│  Service Charge (10%): $32             │
│  Total:              $352              │
│                                         │
│  【Catatan】                            │
│  "Nasi goreng kurang minyak, tahu minta│
│   crispy"                               │
│                                         │
│  [Update Status]  [Print]  [Cancel]    │
│                                         │
└─────────────────────────────────────────┘
```

### Dashboard Pesanan Hari Ini

Navigasi: **Manajemen Pesanan → Gambaran Hari Ini**

```
┌───────────────────────────────────────────────────────┐
│ Gambaran Pesanan Hari Ini               [2025-10-26]  │
├───────────────────────────────────────────────────────┤
│                                                       │
│  Perlu handle: 🔴 3 order  │  Sedang masak: 🟡 5 order│
│  Selesai: 🟢 42 order      │  Total revenue: $12,450  │
│                                                       │
├───────────────────────────────────────────────────────┤
│                                                       │
│  【Notifikasi Order Baru】                            │
│  ┌───────────────────────────────────────┐          │
│  │ 🔔 Meja A3 - Order #1234              │          │
│  │ Waktu: 12:35                          │          │
│  │ Item: Nasi Goreng Seafood x1, Teh x2 │          │
│  │ [Konfirmasi Order]  [Lihat Detail]   │          │
│  └───────────────────────────────────────┘          │
│                                                       │
└───────────────────────────────────────────────────────┘
```

### Alur Operasi Pesanan

#### Konfirmasi Order Baru

```
Terima notifikasi order baru
     ↓
Cek isi order
     ↓
Bisa dibuat?
     │
     ├─ Bisa → Klik "Konfirmasi Order"
     │            ↓
     │        Order masuk ke dapur
     │            ↓
     │        Koki mulai masak
     │
     └─ Tidak bisa → Klik "Tidak Bisa Terima"
                       ↓
                   Isi alasan
                       ↓
                   Notifikasi pelanggan
```

#### Update Status Pesanan

**Lokasi Operasi**: Halaman detail order → Tombol update status

```
┌─────────────────────────────┐
│ Update Status Pesanan       │
├─────────────────────────────┤
│                             │
│  Status sekarang: Memasak   │
│                             │
│  Pilih status baru:         │
│  ○ Selesai (Sudah siap)    │
│  ○ Dikirim (Sudah diantar) │
│  ○ Selesai Bayar           │
│                             │
│  [Konfirmasi Update]        │
│                             │
└─────────────────────────────┘
```

### Manajemen Tambah Order

Pelanggan bisa tambah menu di order asli:

```
Order Asli #1234
├─ Nasi Goreng Seafood x1
├─ Teh Wintermelon x2
└─ (12:35 kirim)

【Tambah Order #1234-A】
├─ Tahu Goreng x1
└─ (12:45 kirim)
     ↓
Sistem auto gabung
     ↓
Order Lengkap #1234
├─ Nasi Goreng Seafood x1
├─ Teh Wintermelon x2
└─ Tahu Goreng x1 [Baru]
```

**Cara Tampil**:

- Item baru ada label "Baru"
- Bedakan warna: Order asli (putih), tambahan (kuning)
- Timeline tampilkan waktu kirim tiap item

### Cari dan Filter Pesanan

Navigasi: **Manajemen Pesanan → Riwayat Pesanan**

#### Kondisi Filter

```
┌─────────────────────────────────────────┐
│ Cari Pesanan                            │
├─────────────────────────────────────────┤
│                                         │
│  Rentang tanggal: [2025-10-20] ~ [2025-10-26]│
│                                         │
│  Status pesanan:                        │
│  ☑ Semua    □ Pending   □ Proses      │
│  □ Selesai  □ Cancel                   │
│                                         │
│  Filter meja: [Semua Meja ▼]           │
│                                         │
│  Rentang harga: $ [100] ~ $ [1000]     │
│                                         │
│  [Cari]  [Reset]  [Export Laporan]     │
│                                         │
└─────────────────────────────────────────┘
```

### Laporan Statistik Pesanan

Navigasi: **Manajemen Pesanan → Laporan Statistik**

```
┌───────────────────────────────────────────────┐
│ Statistik Pesanan Minggu Ini (2025-10-20 ~ 26)│
├───────────────────────────────────────────────┤
│                                               │
│  Total pesanan: 287 order                    │
│  Rata-rata nilai order: $345                 │
│  Total revenue: $99,015                      │
│                                               │
│  Trend pesanan harian:                        │
│  ████████████████░░░░░░ Senin (42)          │
│  ██████████████████████ Selasa (53)         │
│  ███████████████░░░░░░░ Rabu (38)           │
│  ████████████████████░░ Kamis (48)          │
│  ██████████████████████ Jumat (54)          │
│  ████████████████░░░░░░ Sabtu (52) ⭐       │
│                                               │
│  Jam sibuk:                                   │
│  🥇 Makan siang (12:00-14:00): 45%           │
│  🥈 Makan malam (18:00-20:00): 38%           │
│  🥉 Afternoon tea (15:00-17:00): 17%         │
│                                               │
└───────────────────────────────────────────────┘
```

---

## 👥 Manajemen Staf

### Tambah Akun Staf

Navigasi: **Manajemen Staf → Daftar Staf → Tambah Staf**

```
┌─────────────────────────────────────────┐
│ Tambah Akun Staf                        │
├─────────────────────────────────────────┤
│                                         │
│  Nama: _____________________________   │
│  Email: ____________________________   │
│  Telepon: __________________________   │
│                                         │
│  Peran:                                 │
│  ○ Pemilik - Akses penuh               │
│  ○ Koki - Lihat pesanan, update dapur  │
│  ○ Server - Lihat pesanan, antar        │
│  ○ Kasir - Handle pembayaran, lihat revenue│
│                                         │
│  [Simpan]  [Batal]                     │
│                                         │
└─────────────────────────────────────────┘
```

### Matriks Izin Staf

| Fungsi                | Pemilik | Koki | Server | Kasir |
| --------------------- | ------- | ---- | ------ | ----- |
| Lihat pesanan         | ✅      | ✅   | ✅     | ✅    |
| Update status pesanan | ✅      | ✅   | ✅     | ✅    |
| Kelola menu           | ✅      | ❌   | ❌     | ❌    |
| Kelola meja           | ✅      | ❌   | ❌     | ❌    |
| Lihat revenue         | ✅      | ❌   | ❌     | ✅    |
| Lihat biaya           | ✅      | ❌   | ❌     | ❌    |
| Kelola staf           | ✅      | ❌   | ❌     | ❌    |
| Handle pembayaran     | ✅      | ❌   | ❌     | ✅    |
| Refund/Diskon         | ✅      | ❌   | ❌     | ✅    |
| Lihat analitik        | ✅      | ❌   | ❌     | ❌    |

### Manajemen Jadwal Staf

Navigasi: **Manajemen Staf → Manajemen Jadwal**

#### Lihat Jadwal Mingguan

```
┌──────────────────────────────────────────────────────────┐
│ Jadwal Minggu Ini (2025-10-20 ~ 2025-10-26)              │
├──────────────────────────────────────────────────────────┤
│                                                          │
│         Sen   Sel   Rab   Kam   Jum   Sab   Min         │
│                                                          │
│  Chef      Pagi  Pagi  Off   Siang Siang Pagi  Off      │
│  Server Li Siang Siang Pagi  Pagi  Off   Siang Siang    │
│  Kasir     Malam Off   Malam Malam Malam Malam Pagi     │
│                                                          │
│  [Tambah Shift]  [Export]  [Print]                      │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

#### Pengaturan Shift

```
Pengaturan tipe shift:

Shift Pagi: 08:00 - 16:00 (8 jam)
Shift Siang: 12:00 - 20:00 (8 jam)
Shift Malam: 16:00 - 24:00 (8 jam)
Full Day: 10:00 - 22:00 (12 jam)

Bisa custom waktu shift
```

### Catatan Kehadiran

Navigasi: **Manajemen Staf → Manajemen Kehadiran**

```
┌─────────────────────────────────────────┐
│ Catatan Kehadiran                       │
├─────────────────────────────────────────┤
│                                         │
│  Hari ini (2025-10-26)                  │
│                                         │
│  Chef                                   │
│  ├─ Clock in: 08:05 ✅                 │
│  └─ Clock out: Menunggu...             │
│                                         │
│  Server Li                              │
│  ├─ Clock in: 11:58 ✅                 │
│  └─ Clock out: Menunggu...             │
│                                         │
│  Kasir                                  │
│  ├─ Clock in: Belum clock ⚠️           │
│  └─ Shift terjadwal: 16:00             │
│                                         │
└─────────────────────────────────────────┘
```

### Track Performa Staf

Navigasi: **Manajemen Staf → Laporan Performa**

```
┌───────────────────────────────────────────────┐
│ Performa Staf Bulan Ini (2025-10)            │
├───────────────────────────────────────────────┤
│                                               │
│  Chef (Koki)                                  │
│  ├─ Pesanan diproses: 523 pesanan            │
│  ├─ Waktu selesai rata-rata: 15 menit        │
│  ├─ Rating pelanggan: ⭐⭐⭐⭐⭐ (4.8/5.0)   │
│  └─ Tingkat kehadiran: 96%                   │
│                                               │
│  Server Li (Server)                           │
│  ├─ Antar makanan: 487 kali                  │
│  ├─ Waktu antar rata-rata: 3 menit           │
│  ├─ Rating pelanggan: ⭐⭐⭐⭐⭐ (4.9/5.0)   │
│  └─ Tingkat kehadiran: 100%                  │
│                                               │
└───────────────────────────────────────────────┘
```

---

## 👨‍👩‍👧‍👦 Manajemen Pelanggan

### Mode Registrasi Pelanggan

MakanMakan mendukung dua mode penggunaan untuk pelanggan:

```
┌─────────────────────────────────────────┐
│ Mode Penggunaan Pelanggan               │
├─────────────────────────────────────────┤
│                                         │
│  Mode 1: Tamu (Tanpa Registrasi)       │
│  ├─ Scan QR langsung pesan             │
│  ├─ Tidak perlu daftar/login           │
│  ├─ Cocok untuk tamu walk-in           │
│  └─ Tidak akumulasi poin member        │
│                                         │
│  Mode 2: Member (Perlu Registrasi)     │
│  ├─ Daftar untuk track pesanan         │
│  ├─ Akumulasi poin konsumsi            │
│  ├─ Lihat riwayat pesanan              │
│  └─ Nikmati benefit member             │
│                                         │
└─────────────────────────────────────────┘
```

### Lihat Data Pelanggan

Navigasi: **Manajemen Pelanggan → Daftar Pelanggan**

```
┌────────────────────────────────────────────────────────────┐
│ Daftar Pelanggan                      [Cari: ____]         │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  Nama      Telepon        Tgl Daftar  Pesanan  Total Belanja│
│  ──────────────────────────────────────────────────────    │
│  Ahmad A   0812-345-678  2025-08-15   15      $4,500      │
│  Budi B    0823-456-789  2025-09-01   8       $2,800      │
│  Citra C   0834-567-890  2025-10-10   3       $1,200      │
│                                                            │
│  [Export Data]  [Kirim Voucher]                           │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

### Segmentasi Pelanggan

Navigasi: **Manajemen Pelanggan → Segmentasi Pelanggan**

#### Kriteria Segmentasi Otomatis

```
┌─────────────────────────────────────────┐
│ Segmentasi Otomatis Pelanggan           │
├─────────────────────────────────────────┤
│                                         │
│  🥇 Pelanggan VIP (52 orang)           │
│  └─ Kriteria: Total belanja > $5,000   │
│                                         │
│  🥈 Pelanggan Aktif (138 orang)        │
│  └─ Kriteria: 3+ pesanan dalam 30 hari │
│                                         │
│  🥉 Pelanggan Reguler (245 orang)      │
│  └─ Kriteria: Sudah daftar, < 3 pesanan│
│                                         │
│  😴 Pelanggan Tidur (87 orang)         │
│  └─ Kriteria: Lebih 60 hari tidak beli │
│                                         │
│  🆕 Pelanggan Baru (34 orang)          │
│  └─ Kriteria: Daftar kurang 30 hari    │
│                                         │
└─────────────────────────────────────────┘
```

### Detail Pelanggan

Klik nama pelanggan untuk lihat info detail:

```
┌─────────────────────────────────────────┐
│ Profil Pelanggan: Ahmad A                │
├─────────────────────────────────────────┤
│                                         │
│  【Info Dasar】                         │
│  Telepon: 0812-345-678                 │
│  Email: ahmad@example.com              │
│  Ulang tahun: 1990-05-15               │
│  Tgl daftar: 2025-08-15                │
│                                         │
│  【Statistik Konsumsi】                 │
│  Total pesanan: 15                     │
│  Total belanja: $4,500                 │
│  Nilai pesanan rata-rata: $300         │
│  Kunjungan terakhir: 2025-10-20        │
│                                         │
│  【Poin Member】                        │
│  Poin sekarang: 450 poin               │
│  Bisa tukar: $45 diskon                │
│                                         │
│  【Analisis Preferensi】               │
│  Menu sering dipesan:                   │
│  1. Nasi Goreng Seafood (8 kali)       │
│  2. Tahu Goreng (6 kali)               │
│  3. Teh Wintermelon (12 kali)          │
│                                         │
│  Jam biasa datang: Siang (12:00-14:00) │
│  Tempat duduk favorit: Dekat jendela   │
│                                         │
│  [Kirim Promo]  [Lihat Riwayat Pesanan]│
│                                         │
└─────────────────────────────────────────┘
```

### Kirim Voucher

Navigasi: **Manajemen Pelanggan → Manajemen Voucher**

```
┌─────────────────────────────────────────┐
│ Buat Kampanye Promosi                   │
├─────────────────────────────────────────┤
│                                         │
│  Nama kampanye: ___________________    │
│                                         │
│  Tipe promo:                            │
│  ○ Diskon (contoh: 10%, 20% off)       │
│  ○ Voucher uang (contoh: potongan $50) │
│  ○ Beli 1 Gratis 1                     │
│  ○ Belanja & Dapat (contoh: $500 dapat $50)│
│                                         │
│  Target pelanggan:                      │
│  □ Pelanggan VIP                       │
│  □ Pelanggan Aktif                     │
│  □ Pelanggan Tidur                     │
│  □ Pelanggan Baru                      │
│                                         │
│  Masa berlaku:                          │
│  Mulai: [2025-11-01]                   │
│  Selesai: [2025-11-30]                 │
│                                         │
│  [Preview]  [Kirim Sekarang]  [Jadwalkan]│
│                                         │
└─────────────────────────────────────────┘
```

---

## 📅 Sistem Jadwal Kerja

> **Progress Development**: 43% selesai
> **Status**: Struktur database selesai, sedang development service layer

### Arsitektur Sistem Jadwal

```
┌─────────────────────────────────────────────────────┐
│ Arsitektur Fungsi Sistem Jadwal                     │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Manajemen Template Shift                           │
│  ├─ Buat tipe shift                                │
│  ├─ Atur jam kerja                                 │
│  └─ Definisi kebutuhan tenaga                      │
│                                                     │
│  Penjadwalan Staf                                  │
│  ├─ Jadwal mingguan                                │
│  ├─ Jadwal bulanan                                 │
│  ├─ Saran otomatis                                 │
│  └─ Deteksi konflik                                │
│                                                     │
│  Penyesuaian Jadwal                                │
│  ├─ Permintaan tukar shift                         │
│  ├─ Permintaan ganti shift                         │
│  └─ Lembur sementara                               │
│                                                     │
│  Laporan Statistik                                 │
│  ├─ Statistik jam kerja                            │
│  ├─ Kalkulasi gaji                                 │
│  └─ Analisis biaya tenaga kerja                    │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Pengaturan Template Shift

Navigasi: **Manajemen Jadwal → Template Shift**

```
┌─────────────────────────────────────────┐
│ Manajemen Template Shift                │
├─────────────────────────────────────────┤
│                                         │
│  【Shift Pagi】                         │
│  Waktu: 08:00 - 16:00 (8 jam)          │
│  Kebutuhan tenaga:                      │
│  ├─ Koki: 2 orang                      │
│  ├─ Server: 1 orang                    │
│  └─ Kasir: 1 orang                     │
│                                         │
│  【Shift Siang】                        │
│  Waktu: 12:00 - 20:00 (8 jam)          │
│  Kebutuhan tenaga:                      │
│  ├─ Koki: 3 orang                      │
│  ├─ Server: 2 orang                    │
│  └─ Kasir: 1 orang                     │
│                                         │
│  【Shift Malam】                        │
│  Waktu: 16:00 - 24:00 (8 jam)          │
│  Kebutuhan tenaga:                      │
│  ├─ Koki: 2 orang                      │
│  ├─ Server: 1 orang                    │
│  └─ Kasir: 1 orang                     │
│                                         │
│  [Tambah Template]  [Edit]  [Hapus]    │
│                                         │
└─────────────────────────────────────────┘
```

### Fungsi Auto-Scheduling

```
Faktor pertimbangan auto-scheduling:

┌─────────────────────────────────────────┐
│ AI Penjadwalan Cerdas                   │
├─────────────────────────────────────────┤
│                                         │
│  1️⃣ Preferensi Staf                    │
│  ├─ Jam kerja preferensi               │
│  └─ Kebutuhan cuti                     │
│                                         │
│  2️⃣ Regulasi Ketenagakerjaan           │
│  ├─ Batas jam kerja/minggu             │
│  ├─ Hari kerja berturut-turut          │
│  └─ Regulasi waktu istirahat           │
│                                         │
│  3️⃣ Kebutuhan Operasional              │
│  ├─ Tenaga jam sibuk                   │
│  ├─ Penyesuaian jam sepi               │
│  └─ Konfigurasi event khusus           │
│                                         │
│  4️⃣ Kontrol Biaya                      │
│  ├─ Minimalisir biaya lembur           │
│  ├─ Optimasi biaya tenaga kerja        │
│  └─ Maksimalkan efisiensi              │
│                                         │
└─────────────────────────────────────────┘
```

### Deteksi Konflik Jadwal

Sistem otomatis deteksi konflik berikut:

```
⚠️ Tipe konflik jadwal:

1. Staf dijadwalkan shift ganda di waktu sama
   └─ Sistem otomatis reminder dan tandai merah

2. Melebihi batas jam kerja/minggu
   └─ Tampilkan peringatan dan saran penyesuaian

3. Kerja berturut-turut terlalu lama
   └─ Sarankan atur hari libur

4. Konflik dengan permohonan cuti
   └─ Otomatis exclude staf yang cuti

5. Kekurangan kebutuhan tenaga
   └─ Reminder lengkapi kekurangan tenaga
```

---

## 🏖️ Manajemen Cuti

> **Progress Development**: Desain selesai
> **Status**: Menunggu implementasi

### Arsitektur Sistem Cuti

```
┌─────────────────────────────────────────────────────┐
│ Alur Manajemen Cuti                                 │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Staf kirim permohonan cuti                        │
│         ↓                                           │
│  Pemilik terima notifikasi                         │
│         ↓                                           │
│  Review permohonan cuti                            │
│    ├─ Setuju → Update jadwal                      │
│    └─ Tolak → Notifikasi staf dengan alasan       │
│         ↓                                           │
│  Sistem otomatis sesuaikan jadwal                  │
│         ↓                                           │
│  Kurangi kuota cuti tahunan/khusus                 │
│         ↓                                           │
│  Buat catatan cuti                                 │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Pengaturan Tipe Cuti

Navigasi: **Manajemen Cuti → Pengaturan Tipe Cuti**

```
┌─────────────────────────────────────────┐
│ Manajemen Tipe Cuti                     │
├─────────────────────────────────────────┤
│                                         │
│  🏖️ Cuti Tahunan                       │
│  ├─ Perlu daftar di muka: 3 hari       │
│  ├─ Kuota tahunan: 7-14 hari (by senioritas)│
│  └─ Potong gaji: Tidak                 │
│                                         │
│  🤒 Cuti Sakit                         │
│  ├─ Perlu daftar di muka: Hari itu bisa│
│  ├─ Kuota tahunan: 30 hari             │
│  └─ Potong gaji: Tidak (30 hari pertama)│
│                                         │
│  👨‍👩‍👧 Cuti Pribadi                   │
│  ├─ Perlu daftar di muka: 1 hari       │
│  ├─ Kuota tahunan: 14 hari             │
│  └─ Potong gaji: Ya                    │
│                                         │
│  💑 Cuti Pernikahan                    │
│  ├─ Perlu daftar di muka: 7 hari       │
│  ├─ Kuota seumur hidup: 8 hari         │
│  └─ Potong gaji: Tidak                 │
│                                         │
│  👶 Cuti Melahirkan/Paternitas         │
│  ├─ Perlu daftar di muka: 14 hari      │
│  ├─ Kuota: 56 hari / 7 hari           │
│  └─ Potong gaji: Tidak                 │
│                                         │
│  [Tambah Tipe Cuti]  [Edit]  [Nonaktifkan]│
│                                         │
└─────────────────────────────────────────┘
```

### Review Permohonan Cuti

Navigasi: **Manajemen Cuti → Permohonan Menunggu Review**

```
┌─────────────────────────────────────────┐
│ Permohonan Cuti Menunggu Review         │
├─────────────────────────────────────────┤
│                                         │
│  【Permohonan #001】                    │
│  Staf: Chef                             │
│  Tipe cuti: Cuti tahunan                │
│  Tanggal: 2025-11-05 ~ 2025-11-07 (3 hari)│
│  Alasan: Liburan keluarga               │
│  Waktu kirim: 2025-10-26 10:30         │
│                                         │
│  【Cek Sistem】                         │
│  ✅ Kuota cuti tahunan tersisa: 7 hari │
│  ✅ Hari daftar di muka: 10 hari (sesuai)│
│  ⚠️ Waktu itu sudah ada 1 koki cuti    │
│                                         │
│  Komentar review: _______________      │
│                                         │
│  [Setuju]  [Tolak]  [Minta Suplemen]   │
│                                         │
└─────────────────────────────────────────┘
```

### Query Kuota Cuti Staf

Navigasi: **Manajemen Cuti → Manajemen Kuota**

```
┌─────────────────────────────────────────────────────┐
│ Gambaran Kuota Cuti Staf                            │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Staf: Chef | Senioritas: 3 tahun                  │
│                                                     │
│  【Kuota Cuti Tahun Ini】                           │
│                                                     │
│  Cuti tahunan: ████████░░░░  Pakai 8 / Total 14 hari│
│  Cuti sakit:   ██░░░░░░░░░░  Pakai 2 / Total 30 hari│
│  Cuti pribadi: ░░░░░░░░░░░░  Pakai 0 / Total 14 hari│
│                                                     │
│  【Riwayat Cuti】                                   │
│  2025-08-15 ~ 2025-08-16  Cuti tahunan  2 hari  (Liburan keluarga)│
│  2025-09-20 ~ 2025-09-23  Cuti tahunan  4 hari  (Kunjungi saudara)│
│  2025-10-10              Cuti sakit    1 hari  (Flu) │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Laporan Statistik Cuti

Navigasi: **Manajemen Cuti → Laporan Statistik**

```
┌───────────────────────────────────────────────┐
│ Statistik Cuti Bulan Ini (2025-10)           │
├───────────────────────────────────────────────┤
│                                               │
│  Total hari cuti: 23 hari                    │
│  Total orang cuti: 12 orang                  │
│                                               │
│  Distribusi tipe cuti:                        │
│  ████████████░░░░░░ Cuti tahunan (15 hari, 65%)│
│  ████░░░░░░░░░░░░░░ Cuti sakit (5 hari, 22%)│
│  ██░░░░░░░░░░░░░░░░ Cuti pribadi (3 hari, 13%)│
│                                               │
│  Staf paling banyak cuti:                     │
│  1. Server Li (5 hari)                       │
│  2. Chef (4 hari)                            │
│  3. Kasir (3 hari)                           │
│                                               │
└───────────────────────────────────────────────┘
```

---

## 📊 Analitik Bisnis

### Gambaran Dashboard Analitik

Navigasi: **Analitik Bisnis → Dashboard**

```
┌───────────────────────────────────────────────────────┐
│ Dashboard Analitik Bisnis               [2025-10-26]  │
├───────────────────────────────────────────────────────┤
│                                                       │
│  【Data Real-time Hari Ini】                          │
│                                                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│  │ Revenue  │  │ Pesanan  │  │ Avg Value│          │
│  │ $12,450  │  │ 42       │  │ $296     │          │
│  │ ↑ +15%   │  │ ↑ +8%    │  │ ↑ +7%    │          │
│  └──────────┘  └──────────┘  └──────────┘          │
│                                                       │
│  【Trend Minggu Ini】                                 │
│                                                       │
│  Grafik revenue:                                      │
│  $15k ┤                            ⬤                │
│  $12k ┤            ⬤         ⬤                      │
│  $9k  ┤      ⬤         ⬤                            │
│  $6k  ┤ ⬤                                            │
│       └────────────────────────────                 │
│        Sen  Sel  Rab  Kam  Jum  Sab                 │
│                                                       │
└───────────────────────────────────────────────────────┘
```

### Analisis Revenue

Navigasi: **Analitik Bisnis → Laporan Revenue**

#### Analisis Per Jam

```
┌───────────────────────────────────────────────┐
│ Analisis Revenue Per Jam (Bulan Ini)         │
├───────────────────────────────────────────────┤
│                                               │
│  Sarapan (08:00-11:00)                       │
│  ████░░░░░░░░░░░░░░ $12,500 (12%)           │
│                                               │
│  Makan Siang (11:00-14:00)                   │
│  ███████████████░░░░ $45,800 (45%)          │
│                                               │
│  Sore (14:00-17:00)                          │
│  ████████░░░░░░░░░░ $15,200 (15%)           │
│                                               │
│  Makan Malam (17:00-21:00)                   │
│  ████████████░░░░░░ $28,500 (28%)           │
│                                               │
│  Jam terbaik: Siang (11:00-14:00) 💰        │
│  Saran perbaikan: Tingkatkan revenue sarapan 📈│
│                                               │
└───────────────────────────────────────────────┘
```

#### Perbandingan Bulanan

```
┌───────────────────────────────────────────────┐
│ Perbandingan Revenue Bulanan                  │
├───────────────────────────────────────────────┤
│                                               │
│  Trend revenue 2025:                          │
│                                               │
│  $120k ┤                          ⬤          │
│  $100k ┤              ⬤     ⬤                │
│  $80k  ┤        ⬤                             │
│  $60k  ┤   ⬤                                  │
│        └──────────────────────────           │
│         Jul  Agu  Sep  Okt  Nov              │
│                                               │
│  Trend pertumbuhan: ↗ Tumbuh stabil          │
│  Growth MoM: +12%                             │
│  Growth YoY: +28%                             │
│                                               │
└───────────────────────────────────────────────┘
```

### Analisis Penjualan Menu

Navigasi: **Analitik Bisnis → Analisis Menu**

```
┌───────────────────────────────────────────────────────┐
│ Peringkat Menu Terlaris (Bulan Ini)                   │
├───────────────────────────────────────────────────────┤
│                                                       │
│  Rank  Nama Menu         Qty     Revenue   % Share   │
│  ────────────────────────────────────────────────    │
│  🥇   Nasi Goreng Seafood 287   $51,660   18%       │
│  🥈   Tahu Goreng         245   $19,600   7%        │
│  🥉   Teh Wintermelon     423   $12,690   4%        │
│  4    Ayam Tiga Rasa      198   $39,600   14%       │
│  5    Oyster Omelette     176   $26,400   9%        │
│                                                       │
│  【Insight Analisis】                                │
│  • Nasi goreng seafood adalah produk bintang        │
│  • Teh wintermelon qty tinggi tapi harga rendah     │
│  • Ayam tiga rasa revenue tinggi, bisa dipromosikan │
│                                                       │
└───────────────────────────────────────────────────────┘
```

#### Analisis Menu Slow-moving

```
┌───────────────────────────────────────────────┐
│ Menu Slow-moving (Bulan < 10 porsi)          │
├───────────────────────────────────────────────┤
│                                               │
│  Nama Menu        Qty     Rekomendasi         │
│  ────────────────────────────────────         │
│  Bakso Braised    5       Pertimbangkan remove│
│  Salad Jamur      3       Adjust harga        │
│  Es Taro          8       Hanya jual musim panas│
│                                               │
└───────────────────────────────────────────────┘
```

### Analisis Turnover Meja

Navigasi: **Analitik Bisnis → Analisis Meja**

```
┌───────────────────────────────────────────────┐
│ Analisis Efisiensi Penggunaan Meja           │
├───────────────────────────────────────────────┤
│                                               │
│  Meja    Turnover Hari Ini  Waktu Makan Rata │
│  ─────────────────────────────────────       │
│  A1      5 kali          45 mnt  ⭐⭐⭐    │
│  A2      6 kali          38 mnt  ⭐⭐⭐⭐  │
│  A3      3 kali          62 mnt  ⭐⭐      │
│  B1      4 kali          50 mnt  ⭐⭐⭐    │
│                                               │
│  【Grading Efisiensi】                        │
│  ⭐⭐⭐⭐⭐ Excellent (< 40 menit)          │
│  ⭐⭐⭐⭐   Bagus (40-50 menit)             │
│  ⭐⭐⭐     Normal (50-60 menit)            │
│  ⭐⭐       Perlu improve (> 60 menit)      │
│                                               │
│  Saran improve:                               │
│  • Meja A3 waktu makan terlalu lama, cek proses│
│  • Meja A2 efisiensi sangat bagus, bisa jadi benchmark│
│                                               │
└───────────────────────────────────────────────┘
```

### Analisis Pelanggan

Navigasi: **Analitik Bisnis → Analisis Pelanggan**

```
┌───────────────────────────────────────────────┐
│ Analisis Perilaku Konsumsi Pelanggan         │
├───────────────────────────────────────────────┤
│                                               │
│  【Struktur Pelanggan】                       │
│                                               │
│  Pelanggan baru: ██████░░░░ 28% (145 orang)  │
│  Pelanggan kembali: ███████████ 52% (270 orang)│
│  Pelanggan VIP: █████░░░░░ 20% (104 orang)   │
│                                               │
│  【Frekuensi Konsumsi】                       │
│                                               │
│  3+ kali/minggu: ████░░░░░░ 15%             │
│  1-2 kali/minggu: ████████░░ 35%            │
│  1-3 kali/bulan:  ██████████ 40%            │
│  Sesekali:        ██░░░░░░░░ 10%            │
│                                               │
│  【Tingkat Retensi Pelanggan】                │
│  Retensi 30 hari: 68%  ⭐⭐⭐⭐            │
│  Retensi 60 hari: 52%  ⭐⭐⭐              │
│  Retensi 90 hari: 45%  ⭐⭐⭐              │
│                                               │
└───────────────────────────────────────────────┘
```

---

## 🤖 Analitik AI Cerdas

> **Status Fitur**: Backend selesai, UI frontend sudah online
> **Model Didukung**: OpenAI, Anthropic, Google Gemini, Groq

### Arsitektur Sistem Analitik AI

```
┌─────────────────────────────────────────────────────┐
│ Mesin Analitik AI                                    │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Layer Pengumpulan Data                             │
│  ├─ Data pesanan                                   │
│  ├─ Data penjualan menu                            │
│  ├─ Data perilaku pelanggan                        │
│  └─ Data efisiensi operasional                     │
│         ↓                                           │
│  Layer Analisis AI                                  │
│  ├─ Prediksi trend penjualan                       │
│  ├─ Rekomendasi optimasi menu                      │
│  ├─ Analisis preferensi pelanggan                  │
│  └─ Saran efisiensi operasional                    │
│         ↓                                           │
│  Layer Laporan Insight                             │
│  └─ Generate rekomendasi actionable                │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Pengaturan Model AI

Navigasi: **Pengaturan → Pengaturan Analitik AI**

```
┌─────────────────────────────────────────┐
│ Pengaturan Model Analitik AI            │
├─────────────────────────────────────────┤
│                                         │
│  Pilih provider AI:                     │
│  ○ OpenAI (GPT-4)                      │
│  ○ Anthropic (Claude)                  │
│  ○ Google (Gemini Pro)                 │
│  ○ Groq (Llama 3)                      │
│                                         │
│  API Key: ********************         │
│                                         │
│  Frekuensi analisis:                    │
│  ○ Otomatis harian                     │
│  ○ Otomatis mingguan                   │
│  ○ Trigger manual                      │
│                                         │
│  Ruang lingkup analisis:                │
│  □ Analisis penjualan                  │
│  □ Optimasi menu                       │
│  □ Insight pelanggan                   │
│  □ Saran operasional                   │
│                                         │
│  [Simpan Pengaturan]  [Test Koneksi]   │
│                                         │
└─────────────────────────────────────────┘
```

### Laporan Insight AI

Navigasi: **Analitik AI → Laporan Insight**

```
┌───────────────────────────────────────────────────────┐
│ Laporan Insight AI Cerdas               [2025-10-26]  │
├───────────────────────────────────────────────────────┤
│                                                       │
│  【Prediksi Trend Penjualan】🔮                       │
│                                                       │
│  Berdasarkan analisis data 90 hari, AI prediksi:     │
│                                                       │
│  Prediksi revenue minggu depan: $85,000 - $92,000    │
│  Indeks kepercayaan: ⭐⭐⭐⭐⭐ (92%)                 │
│                                                       │
│  Dasar prediksi:                                     │
│  • Revenue terus tumbuh konsisten                    │
│  • Cuaca bagus, diprediksi orang makan luar naik     │
│  • Minggu depan tidak ada event besar, pola stabil   │
│                                                       │
│  ────────────────────────────────────────────        │
│                                                       │
│  【Rekomendasi Optimasi Menu】🍽️                     │
│                                                       │
│  📈 Rekomen dipromosikan:                            │
│  • "Ayam Tiga Rasa" - Profit margin tinggi (42%)     │
│    Saran: Buat foto menarik, taruh di halaman pertama│
│                                                       │
│  • "Mie Sup Seafood" - Biaya turun 20%, bisa naikkan profit│
│    Saran: Sesuaikan strategi harga, dari $150 naik ke $165│
│                                                       │
│  📉 Rekomen disesuaikan:                             │
│  • "Sate Sapi" - Penjualan rendah (bulan 5 porsi)   │
│    Saran: Sementara dihapus atau perbaiki resep     │
│                                                       │
│  ────────────────────────────────────────────        │
│                                                       │
│  【Insight Perilaku Pelanggan】👥                     │
│                                                       │
│  Karakteristik pelanggan high-value:                 │
│  • Prefer waktu makan siang (12:00-13:30)            │
│  • Waktu makan rata-rata 55 menit                    │
│  • Sering pesan produk "paket"                       │
│  • Probabilitas tinggi tambah minuman dan dessert    │
│                                                       │
│  Saran tindakan:                                     │
│  • Launch "Paket Bisnis" untuk waktu makan siang     │
│  • Design combo "Makanan Utama + Minuman + Dessert"  │
│  • Tingkatkan kecepatan service waktu makan siang untuk│
│    kebutuhan pelanggan bisnis                        │
│                                                       │
│  ────────────────────────────────────────────        │
│                                                       │
│  【Saran Efisiensi Operasional】⚡                    │
│                                                       │
│  Optimasi alokasi SDM:                               │
│  • Jumat malam (18:00-20:00) sering kekurangan SDM   │
│    Saran: Tambah 1 chef + 1 server                  │
│                                                       │
│  • Rabu siang (12:00-14:00) SDM berlebih             │
│    Saran: Kurangi 1 server, hemat biaya SDM          │
│                                                       │
│  Efek prediksi:                                      │
│  • Hemat biaya SDM: $4,500/bulan                     │
│  • Tingkatkan kualitas service, kurangi komplain     │
│  • Tingkatkan kepuasan kerja karyawan               │
│                                                       │
└───────────────────────────────────────────────────────┘
```

### Asisten AI Real-time

Navigasi: **Analitik AI → Asisten Cerdas**

```
┌─────────────────────────────────────────┐
│ Asisten AI Cerdas 💬                    │
├─────────────────────────────────────────┤
│                                         │
│  Anda: Kenapa revenue hari ini lebih   │
│        rendah dari kemarin?             │
│                                         │
│  AI: Berdasarkan analisis data, revenue│
│      hari ini lebih rendah karena tiga  │
│      alasan utama:                      │
│                                         │
│      1. Hari ini Rabu, data historis    │
│         menunjukkan revenue Rabu rata-  │
│         rata 12% lebih rendah dari Selasa│
│                                         │
│      2. Hari ini hujan, orang makan di  │
│         luar berkurang sekitar 15-20%   │
│                                         │
│      3. Waktu makan siang hari ini (peak│
│         revenue time) jumlah order      │
│         kurang 8 order dari rata-rata   │
│                                         │
│      Saran: Pada hari hujan launch      │
│             "Promo Delivery" untuk      │
│             kompensasi berkurangnya     │
│             pelanggan dine-in           │
│                                         │
│  [Kirim]  [Clear Chat]                  │
│                                         │
└─────────────────────────────────────────┘
```

### Analisis Kompetitor

Navigasi: **Analitik AI → Analisis Kompetitor**

```
┌───────────────────────────────────────────────┐
│ Analisis Kompetitor Sekitar                   │
├───────────────────────────────────────────────┤
│                                               │
│  Ruang lingkup analisis: Radius 1 km restoran│
│                           tipe sama           │
│  Sumber data: Review publik, media sosial    │
│                                               │
│  【Overview Kompetitor】                      │
│                                               │
│  Rumah Makan Seafood Segar (300m)            │
│  ├─ Rating: ⭐⭐⭐⭐ 4.2/5.0                │
│  ├─ Harga: $$$ (sedikit lebih tinggi dari Anda)│
│  ├─ Keunggulan: Seafood fresh, dekorasi bagus│
│  └─ Kelemahan: Harga mahal, waktu tunggu lama│
│                                               │
│  Warung Makanan Tradisional (150m)            │
│  ├─ Rating: ⭐⭐⭐ 3.8/5.0                  │
│  ├─ Harga: $ (harga rendah)                  │
│  ├─ Keunggulan: Murah, serving cepat         │
│  └─ Kelemahan: Lingkungan biasa, pilihan sedikit│
│                                               │
│  【Posisi Anda】                              │
│  Rating: ⭐⭐⭐⭐⭐ 4.7/5.0                  │
│  Harga: $$ (harga menengah)                   │
│  Keunggulan: Value bagus, service berkualitas,│
│              lingkungan nyaman                │
│                                               │
│  【Saran AI】                                 │
│  • Pertahankan keunggulan value, ini core    │
│    competitiveness Anda                       │
│  • Pertimbangkan launch "Daily Seafood Special"│
│    untuk ambil customer seafood restaurant    │
│  • Pertahankan strategi harga sekarang, bedakan│
│    dari warung murah                          │
│                                               │
└───────────────────────────────────────────────┘
```

---

## ❓ Pertanyaan Umum (FAQ)

### Terkait Login

**Q: Lupa password login bagaimana?**

```
Langkah 1: Klik "Lupa Password" di halaman login
   ↓
Langkah 2: Masukkan Email yang terdaftar
   ↓
Langkah 3: Sistem kirim link reset password ke Email
   ↓
Langkah 4: Klik link, atur password baru
   ↓
Langkah 5: Gunakan password baru untuk login
```

**Q: Bisa banyak orang login akun yang sama?**

A: Bisa. Akun pemilik mendukung login simultan multi-device, memudahkan Anda kelola restoran di kantor dan saat di luar.

---

### Terkait Menu

**Q: Bagaimana cara update harga menu dengan cepat?**

```
Cara 1: Item tunggal
  Ke Manajemen Menu → Pilih menu → Edit harga

Cara 2: Update batch
  Ke Manajemen Menu → Operasi Batch → Pilih menu → Adjust harga seragam
```

**Q: Menu sementara habis bagaimana setting?**

A: Ke **Manajemen Menu → Pilih menu → Ubah status jadi "Habis Sementara"**. Sistem akan otomatis tandai "Hari ini habis" di menu, tapi tidak hapus info menu.

**Q: Bisa setting menu tersedia berdasarkan jam?**

A: Bisa. Ke **Manajemen Menu → Edit Menu → Pengaturan Jam Tersedia**, contoh setting "Bubur Pagi" hanya tersedia 08:00-11:00.

---

### Terkait QR Code

**Q: QR Code rusak bagaimana?**

```
Langkah 1: Ke Manajemen QR Code
   ↓
Langkah 2: Cari QR Code tersebut
   ↓
Langkah 3: Klik "Generate Ulang"
   ↓
Langkah 4: Download QR Code baru
   ↓
Langkah 5: Print dan tempel
   ↓
Catatan: QR Code lama otomatis invalid
```

**Q: Bisa custom tampilan QR Code?**

A: Bisa. Ke **Manajemen QR Code → Desain Template**, bisa pilih:

- QR murni (hitam putih)
- Template brand (dengan Logo dan warna)
- Template panduan (dengan teks instruksi penggunaan)

**Q: Pelanggan scan QR Code muncul pesan error?**

Kemungkinan penyebab:

1. QR Code sudah di-generate ulang (kode lama invalid)
2. Restoran sedang ditutup sementara
3. Meja tersebut sudah dinonaktifkan

Solusi:

- Pastikan status QR Code adalah "Aktif"
- Cek status operasi restoran
- Generate ulang dan tempel QR Code baru

---

### Terkait Pesanan

**Q: Bagaimana handle pelanggan minta cancel?**

```
Langkah 1: Ke halaman detail pesanan
   ↓
Langkah 2: Klik tombol "Cancel Pesanan"
   ↓
Langkah 3: Pilih alasan cancel
   ├─ Permintaan pelanggan
   ├─ Bahan tidak cukup
   ├─ Dapur terlalu sibuk
   └─ Alasan lain
   ↓
Langkah 4: Isi jumlah refund (jika perlu)
   ↓
Langkah 5: Konfirmasi cancel
   ↓
Sistem otomatis notifikasi pelanggan
```

**Q: Order terlalu banyak, tidak sempat handle bagaimana?**

Cara handle yang disarankan:

1. **Pause order**: Ke **Pengaturan Restoran → Pause Penerimaan Order**, sementara tutup order online
2. **Perpanjang waktu serving**: Di halaman order sesuaikan estimasi waktu selesai, beri tahu pelanggan perlu tunggu
3. **Tambah SDM**: Sementara tambah chef atau server

**Q: Bagaimana cara lihat order historis?**

Ke **Manajemen Order → Riwayat Order**, bisa filter by tanggal, meja, status dan lainnya untuk query.

---

### Terkait Pembayaran

**Q: Bagaimana handle pembayaran?**

MakanMakan saat ini support pembayaran offline:

```
Pelanggan selesai makan
   ↓
Ke counter pembayaran
   ↓
Pemilik/Kasir cari pesanan di sistem
   ↓
Klik tombol "Bayar"
   ↓
Pilih metode pembayaran:
├─ Tunai
├─ Kartu kredit
├─ Mobile payment (WeChat, Alipay dll)
└─ Lainnya
   ↓
Input jumlah diterima
   ↓
Print receipt (opsional)
   ↓
Selesai pembayaran
```

**Q: Bisa kasih diskon?**

A: Bisa. Di halaman checkout:

1. Klik "Terapkan Diskon"
2. Pilih tipe diskon:
   - Diskon persen (contoh: 10% off)
   - Diskon nominal fixed (contoh: diskon $50)
3. Isi alasan diskon
4. Konfirmasi dan selesaikan checkout

---

### Terkait Staf

**Q: Bagaimana cara reset password staf?**

```
Cara 1: Pemilik reset
  Manajemen Staf → Pilih staf → Reset Password → Notifikasi staf

Cara 2: Staf reset sendiri
  Halaman login → Lupa Password → Input Email → Terima link reset
```

**Q: Staf resign bagaimana handle akun?**

Cara yang disarankan:

1. Ke **Manajemen Staf → Pilih staf → Nonaktifkan Akun** (tidak disarankan delete, pertahankan riwayat)
2. Sistem akan pertahankan work record staf tersebut (order, jadwal dll)
3. Staf tersebut tidak bisa login sistem lagi

**Q: Bisa batasi staf hanya bisa login pada waktu tertentu?**

A: Saat ini belum support fitur ini, tapi bisa lewat "Manajemen Jadwal" dan "Catatan Kehadiran" untuk monitoring waktu login staf.

---

### Terkait Sistem

**Q: Sistem support device apa saja?**

```
✅ Komputer (Recommended)
├─ Windows 10/11
├─ macOS
└─ Linux

✅ Tablet
├─ iPad
└─ Android Tablet

✅ HP (Fitur lihat saja)
├─ iPhone
└─ Android Phone
```

**Q: Perlu install software?**

A: Tidak perlu. MakanMakan adalah sistem web, cukup ada browser dan internet bisa digunakan.

Browser yang disarankan:

- Google Chrome (Recommended)
- Microsoft Edge
- Safari
- Firefox

**Q: Kalau internet putus bagaimana?**

```
Saat internet putus:
├─ Sistem akan tampilkan warning "Offline Mode"
├─ Bisa lanjut lihat data yang sudah dimuat
└─ Tidak bisa terima order baru

Setelah internet pulih:
└─ Sistem auto sync data, kembali operasi normal
```

**Q: Data akan hilang tidak?**

A: Tidak akan. MakanMakan menggunakan arsitektur cloud, semua data real-time tersimpan di jaringan global Cloudflare, dan ada mekanisme backup berlapis, pastikan data aman.

---

### Terkait Keuangan

**Q: Bagaimana export laporan operasional?**

```
Cara 1: Laporan harian
  Analitik Bisnis → Pilih tanggal → Export Excel

Cara 2: Laporan custom
  Analitik Bisnis → Custom rentang tanggal → Pilih item export → Export

Laporan berisi:
├─ Detail revenue
├─ Detail order
├─ Statistik penjualan menu
├─ Statistik pelanggan
└─ Jam kerja staf
```

**Q: Bisa lihat cost dan profit tiap menu?**

A: Bisa. Ke **Manajemen Menu → Daftar Menu → Analisis Cost**, bisa lihat:

- Cost bahan baku
- Harga jual
- Margin laba
- Sales bulanan
- Total kontribusi profit

---

## 📞 Dukungan Teknis

### Hubungi Kami

```
┌─────────────────────────────────────────┐
│ Butuh Bantuan?                          │
├─────────────────────────────────────────┤
│                                         │
│  📧 Dukungan Email                      │
│  support@makanmakan.com                │
│  (Respon dalam 24-48 jam)              │
│                                         │
│  💬 Live Chat                           │
│  Weekday 09:00-18:00                   │
│  Weekend 10:00-17:00                   │
│                                         │
│  📱 Hotline Darurat                     │
│  0800-123-456 (Jalur gangguan sistem)  │
│  Layanan 24 jam                         │
│                                         │
│  📚 Dokumentasi Online                  │
│  docs.makanmakan.com                   │
│                                         │
└─────────────────────────────────────────┘
```

### Monitor Status Sistem

Lihat status sistem real-time: `status.makanmakan.com`

```
Dashboard Monitor Status Sistem

┌─────────────────────────────────────────┐
│ Semua Sistem Operasi Normal ✅           │
├─────────────────────────────────────────┤
│                                         │
│  Service API:     ✅ Normal             │
│  Database:        ✅ Normal             │
│  Service Gambar:  ✅ Normal             │
│  Real-time:       ✅ Normal             │
│                                         │
│  Kecepatan respon:   85ms (Excellent)   │
│  Availability:       99.98%             │
│                                         │
└─────────────────────────────────────────┘
```

---

## 🎯 Langkah Selanjutnya

### Alur Disarankan untuk Pemilik Baru

```
Minggu 1: Setup Dasar
  ├─ Selesaikan info dasar restoran
  ├─ Buat menu dan upload gambar
  └─ Setup meja dan generate QR Code

Minggu 2: Soft Launch
  ├─ Ajak keluarga teman test alur pesan
  ├─ Tambah akun staf dan training penggunaan
  └─ Sesuaikan menu dan harga

Minggu 3: Operasi Resmi
  ├─ Mulai terima pesanan pelanggan
  ├─ Monitor alur pesanan
  └─ Kumpulkan feedback pelanggan

Minggu 4: Optimasi Penyesuaian
  ├─ Analisis laporan operasi
  ├─ Lihat rekomendasi AI
  └─ Sesuaikan menu dan strategi operasi
```

### Eksplorasi Fitur Advanced

Setelah Anda familiar dengan operasi dasar, bisa eksplorasi fitur advanced ini:

```
✨ Daftar Fitur Advanced

□ Setup sistem poin member
□ Buat campaign voucher promo
□ Aktifkan analitik AI cerdas
□ Setup auto-scheduling
□ Buat evaluasi performa karyawan
□ Integrasi dengan sistem akuntansi
□ Setup manajemen multi-cabang
```

---

## 📝 Log Update

### 2.0.0 (2025-10-26)

- ✨ Interface operasi pemilik baru
- ✨ Analitik AI cerdas online
- ✨ Arsitektur sistem jadwal selesai
- 🔧 Optimasi performa dan perbaikan bug

### 1.5.0 (2025-10-12)

- ✨ Dukungan multi-bahasa (6 bahasa)
- ✨ Fitur QR Code level kursi
- 🔧 Peningkatan keamanan password

### 1.0.0 (2025-09-01)

- 🎉 MakanMakan resmi launch
- ✨ Fitur manajemen restoran dasar
- ✨ Sistem pesan QR Code
- ✨ Sistem manajemen pesanan

---

## ✅ Konfirmasi Selesai Panduan Operasi

Selamat Anda telah selesai membaca panduan operasi pemilik!

```
Cek progress pembelajaran:

□ Paham login sistem dan operasi dasar
□ Bisa setup info dasar restoran
□ Bisa buat dan kelola menu
□ Bisa setup meja dan generate QR Code
□ Bisa handle pesanan dan pembayaran
□ Bisa kelola akun dan izin staf
□ Bisa lihat laporan analitik bisnis
□ Paham fitur analitik AI

Siap mulai gunakan MakanMakan? 🚀
```

---

**Semoga Bisnis Anda Sukses! 🎊**

---

_Panduan ini terus diperbarui. Untuk saran, silakan hubungi kami._
