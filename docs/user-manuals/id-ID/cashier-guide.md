# 💰 Manual Kasir MakanMakan

> **Versi**: 2.0
> **Terakhir Diperbarui**: 2025-10-26
> **Target Audiens**: Kasir, Staf Konter

---

## 📚 Daftar Isi

1. [Panduan Cepat](#panduan-cepat)
2. [Gambaran Sistem](#gambaran-sistem)
3. [Antarmuka Sistem Kasir](#antarmuka-sistem-kasir)
4. [Proses Pembayaran Pesanan](#proses-pembayaran-pesanan)
5. [Metode Pembayaran](#metode-pembayaran)
6. [Penanganan Struk](#penanganan-struk)
7. [Pengembalian Dana & Pembatalan](#pengembalian-dana--pembatalan)
8. [Rekonsiliasi Harian](#rekonsiliasi-harian)
9. [Query Laporan](#query-laporan)
10. [Penanganan Pengecualian](#penanganan-pengecualian)
11. [Manajemen Kas](#manajemen-kas)
12. [Panduan Keamanan](#panduan-keamanan)
13. [FAQ](#faq)

---

## 🚀 Panduan Cepat

### Proses Login Sistem

```
┌─────────────────────────────────────────────┐
│ Alur Login Kasir                            │
├─────────────────────────────────────────────┤
│                                             │
│  1️⃣ Buka Sistem Kasir                      │
│      ↓                                      │
│  2️⃣ Masukkan Kredensial Kasir              │
│      ↓                                      │
│  3️⃣ Sistem Validasi Izin (Role=4)          │
│      ↓                                      │
│  4️⃣ Masuk Ruang Kerja Kasir                │
│                                             │
└─────────────────────────────────────────────┘
```

### Daftar Periksa Pembukaan Harian

✅ **Sebelum Jam Operasional**

- [ ] Login ke sistem kasir
- [ ] Verifikasi jumlah uang awal laci kas
- [ ] Periksa persediaan kertas struk
- [ ] Konfirmasi konektivitas jaringan
- [ ] Tinjau target penjualan harian

✅ **Selama Jam Operasional**

- [ ] Pantau pesanan yang menunggu pembayaran
- [ ] Jaga laci kas tetap teratur
- [ ] Verifikasi fungsi POS secara berkala
- [ ] Perhatikan peringatan transaksi yang tidak biasa

✅ **Setelah Jam Operasional**

- [ ] Lakukan rekonsiliasi harian
- [ ] Hitung kas dan bandingkan dengan catatan
- [ ] Cetak laporan penutupan harian
- [ ] Simpan kas di brankas
- [ ] Logout dari sistem

---

## 🏢 Gambaran Sistem

### Ruang Lingkup Izin Kasir

```
┌─────────────────────────────────────────────────────────┐
│ Fungsi yang Tersedia untuk Kasir                       │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ✅ Pembayaran Pesanan  ✅ Proses Pembayaran           │
│  ✅ Cetak Struk        ✅ Permintaan Pengembalian      │
│  ✅ Penutupan Harian    ✅ Query Laporan               │
│  ✅ Verifikasi Jumlah   ✅ Laporan Pengecualian        │
│                                                         │
│  ❌ Manajemen Menu      ❌ Manajemen Staf              │
│  ❌ Modifikasi Harga    ❌ Pengaturan Sistem           │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Diagram Alur Kerja

```
┌────────────────────────────────────────────────────────┐
│            Alur Kerja Harian Kasir                     │
├────────────────────────────────────────────────────────┤
│                                                        │
│  Pelanggan Selesai Makan                               │
│       ↓                                                │
│  Query Pesanan ────→ Konfirmasi Detail Pesanan        │
│       ↓                                                │
│  Hitung Total ──→ Beritahu Pelanggan Jumlah           │
│       ↓                                                │
│  Pilih Metode Pembayaran ─→ Tunai/Kartu/Lainnya       │
│       ↓                                                │
│  Terima Pembayaran ────→ Verifikasi Jumlah Benar      │
│       ↓                                                │
│  Selesaikan Pembayaran ────→ Cetak Struk              │
│       ↓                                                │
│  Serahkan Struk ────→ Berikan Kembalian (jika perlu)  │
│       ↓                                                │
│  Ucapkan Terima Kasih ────→ Sampai Jumpa Lagi         │
│                                                        │
└────────────────────────────────────────────────────────┘
```

---

## 💻 Antarmuka Sistem Kasir

### Dashboard Utama

```
┌──────────────────────────────────────────────────────────┐
│                   Dashboard Sistem Kasir                 │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  ┌────────────────┐  ┌────────────────┐               │
│  │ Pesanan Tertunda│  │ Penjualan Hari Ini │          │
│  │   12 Pesanan   │  │  $25,680       │               │
│  └────────────────┘  └────────────────┘               │
│                                                          │
│  ┌──────────────────────────────────────────┐          │
│  │  Daftar Pesanan                          │          │
│  ├──────┬──────┬─────────┬─────────┤          │
│  │ Meja │ Waktu│ Jumlah  │ Status  │          │
│  ├──────┼──────┼─────────┼─────────┤          │
│  │  A1  │ 12:35│  $580   │ Tertunda│ [Bayar]  │
│  │  B3  │ 12:42│  $820   │ Tertunda│ [Bayar]  │
│  │  C2  │ 12:50│  $450   │ Tertunda│ [Bayar]  │
│  └──────┴──────┴─────────┴─────────┘          │
│                                                          │
│  [Cari Cepat] [Filter] [Laporan] [Penutupan]           │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### Deskripsi Tombol Fungsi

| Tombol                    | Fungsi              | Deskripsi                                          |
| ------------------------- | ------------------- | -------------------------------------------------- |
| 🔍 **Cari Cepat**         | Cari Pesanan        | Cari berdasarkan meja, nomor pesanan, atau telepon |
| 📋 **Detail Pesanan**     | Lihat Detail        | Tampilkan konten pesanan lengkap                   |
| 💳 **Bayar**              | Proses Pembayaran   | Masuk ke alur pembayaran                           |
| 🧾 **Cetak Ulang Struk** | Cetak Ulang         | Cetak ulang struk yang hilang atau rusak          |
| 🔄 **Pengembalian Dana**  | Proses Pengembalian | Ajukan pengembalian dana pesanan                   |
| 📊 **Laporan**            | Query Laporan       | Lihat data bisnis                                  |
| 🔐 **Penutupan**          | Penutupan Harian    | Lakukan rekonsiliasi akhir hari                    |

---

## 🧾 Proses Pembayaran Pesanan

### Langkah Pembayaran Standar

#### Langkah 1: Query Pesanan

**Metode 1: Query Nomor Meja**

```
1. Klik "Cari Cepat"
2. Masukkan nomor meja (misal, A1, B3)
3. Sistem menampilkan semua pesanan yang belum dibayar untuk meja tersebut
4. Konfirmasi ini adalah pesanan pelanggan
```

**Metode 2: Query Nomor Pesanan**

```
1. Tanyakan nomor pesanan kepada pelanggan
2. Masukkan nomor pesanan
3. Sistem menampilkan detail pesanan
4. Konfirmasi konten pesanan
```

**Metode 3: Query Nomor Telepon**

```
1. Tanyakan apakah pelanggan adalah anggota
2. Masukkan nomor telepon pelanggan
3. Sistem menampilkan daftar pesanan yang belum dibayar anggota
4. Minta pelanggan konfirmasi pesanan mana yang akan dibayar
```

---

#### Langkah 2: Konfirmasi Konten Pesanan

```
┌────────────────────────────────────────┐
│ Pesanan #20251026-001                  │
├────────────────────────────────────────┤
│                                        │
│ Meja: A1          Waktu: 12:35         │
│ Pelanggan: Anggota 0912-345-678        │
│                                        │
│ ────────────────────────────────────  │
│                                        │
│ Item:                                  │
│  • Mie Sapi Signature      x1   $150  │
│  • Mie Sapi Braised        x1   $160  │
│  • Piring Appetizer        x1   $ 80  │
│  • Teh Susu Mutiara        x2   $120  │
│                                        │
│ ────────────────────────────────────  │
│                                        │
│ Subtotal:                      $510    │
│ Biaya Layanan (10%):           $ 51    │
│ ────────────────────────────────────  │
│ Total:                         $561    │
│                                        │
└────────────────────────────────────────┘
```

**Poin Pemeriksaan:**

- ✅ Verifikasi jumlah item benar
- ✅ Verifikasi harga dihitung dengan benar
- ✅ Verifikasi diskon khusus diterapkan
- ✅ Verifikasi biaya layanan berlaku

---

#### Langkah 3: Pilih Metode Pembayaran

```
┌────────────────────────────────────────┐
│ Silakan Pilih Metode Pembayaran       │
├────────────────────────────────────────┤
│                                        │
│  ┌──────────┐  ┌──────────┐          │
│  │ 💵 Tunai │  │ 💳 Kartu │          │
│  └──────────┘  └──────────┘          │
│                                        │
│  ┌──────────┐  ┌──────────┐          │
│  │ 📱 Mobile│  │ 🎫 Voucher│          │
│  └──────────┘  └──────────┘          │
│                                        │
│  ┌──────────────────────────┐        │
│  │    ⚡ Pembayaran Split    │        │
│  └──────────────────────────┘        │
│                                        │
└────────────────────────────────────────┘
```

---

#### Langkah 4: Proses Pembayaran

**Alur Pembayaran Tunai:**

```
1️⃣ Beritahu pelanggan jumlah total
   "Totalnya adalah $561"

2️⃣ Terima uang tunai
   Pelanggan membayar: $1,000

3️⃣ Masukkan jumlah yang diterima
   Sistem otomatis menghitung kembalian: $439

4️⃣ Konfirmasi jumlah dan klik "Selesaikan Pembayaran"

5️⃣ Siapkan kembalian
   - $400: 4 × lembar $100
   - $ 30: 3 × koin $10
   - $  9: 1 × $5 + 4 × koin $1

6️⃣ Ulangi jumlah kembalian
   "Kembalian Anda adalah $439, terima kasih"
```

**Alur Pembayaran Kartu Kredit:**

```
1️⃣ Pilih pembayaran "Kartu Kredit"
2️⃣ Masukkan jumlah pembayaran: $561
3️⃣ Masukkan/tap kartu kredit
4️⃣ Tunggu otorisasi...
5️⃣ Pelanggan masukkan PIN/tanda tangan
6️⃣ Transaksi berhasil ✅
7️⃣ Cetak salinan merchant (perlu tanda tangan)
8️⃣ Pelanggan tanda tangan untuk konfirmasi
9️⃣ Simpan struk yang ditandatangani
```

**Alur Pembayaran Mobile:**

```
1️⃣ Pilih "Pembayaran Mobile"
2️⃣ Pilih platform pembayaran
   • LINE Pay
   • Street Payment
   • Apple Pay
   • Google Pay

3️⃣ Tampilkan kode QR pembayaran
4️⃣ Pelanggan scan kode QR
5️⃣ Tunggu konfirmasi pembayaran...
6️⃣ Pembayaran berhasil ✅
7️⃣ Otomatis selesaikan pembayaran
```

---

#### Langkah 5: Cetak Struk

```
┌────────────────────────────────────────┐
│          Restoran MakanMakan           │
│       NPWP: 12345678                   │
│   Alamat: Jl. Xinyi No. 7, Taipei     │
│       Telepon: (02) 2345-6789          │
│                                        │
├────────────────────────────────────────┤
│                                        │
│ Tanggal: 2025/10/26   Waktu: 12:45     │
│ Meja: A1            Kasir: Mary        │
│ Nomor Pesanan: 20251026-001            │
│                                        │
│ ────────────────────────────────────  │
│                                        │
│ Mie Sapi Signature     x1      $150    │
│ Mie Sapi Braised       x1      $160    │
│ Piring Appetizer       x1      $ 80    │
│ Teh Susu Mutiara       x2      $120    │
│                                        │
│ ────────────────────────────────────  │
│                                        │
│ Subtotal:                      $510    │
│ Biaya Layanan (10%):           $ 51    │
│ ────────────────────────────────────  │
│ Total:                         $561    │
│                                        │
│ Metode Pembayaran: Tunai               │
│ Jumlah Diterima: $1,000                │
│ Kembalian: $439                        │
│                                        │
│ ────────────────────────────────────  │
│                                        │
│    Terima kasih, sampai jumpa lagi!    │
│                                        │
│         MakanMakan.com                 │
│                                        │
└────────────────────────────────────────┘
```

---

#### Langkah 6: Selesaikan Transaksi

```
✅ Daftar Periksa Konfirmasi Akhir

1. [ ] Struk dicetak
2. [ ] Jumlah kembalian benar
3. [ ] Struk kartu kredit ditandatangani (jika berlaku)
4. [ ] Serahkan struk ke pelanggan
5. [ ] Ucapkan terima kasih dengan sopan
```

**Ucapan Standar:**

```
"Ini struk dan kembalian Anda $439,
 mohon disimpan dengan baik. Terima kasih telah makan di tempat kami,
 sampai jumpa lagi!"
```

---

## 💳 Metode Pembayaran

### Pembayaran Tunai

#### Panduan Penanganan Tunai

```
┌─────────────────────────────────────────────┐
│ Proses Pengumpulan Tunai Standar            │
├─────────────────────────────────────────────┤
│                                             │
│  1️⃣ Nyatakan jumlah dengan jelas           │
│     "Totalnya adalah $561"                  │
│                                             │
│  2️⃣ Konfirmasi denominasi yang diterima    │
│     "Diterima $1,000"                       │
│                                             │
│  3️⃣ Letakkan uang di atas kasir (hindari sengketa) │
│                                             │
│  4️⃣ Masukkan jumlah yang diterima di sistem│
│                                             │
│  5️⃣ Verifikasi jumlah kembalian benar      │
│     Sistem menunjukkan: Kembalian $439     │
│                                             │
│  6️⃣ Hitung kembalian                       │
│     - Uang besar dulu (ratusan)            │
│     - Kemudian koin (puluhan, satuan)      │
│                                             │
│  7️⃣ Ulangi jumlah kembalian                │
│     "Kembalian Anda adalah $439"           │
│                                             │
│  8️⃣ Letakkan uang yang diterima di laci kas│
│                                             │
└─────────────────────────────────────────────┘
```

#### Deteksi Uang Palsu

**Poin Pemeriksaan:**

| Uang         | Metode Verifikasi                                        |
| ------------ | -------------------------------------------------------- |
| 💵 **$1000** | Foil yang berubah warna, cetak intaglio, benang keamanan |
| 💵 **$500**  | Angka "500" tersembunyi, tanda air bunga plum            |
| 💵 **$100**  | Tinta yang berubah warna, titik braille                  |

**Penanganan Uang Mencurigakan:**

```
1. Jangan langsung menuduh pelanggan
2. Dengan sopan katakan: "Permisi, uang ini sepertinya bermasalah, bisa gunakan yang lain?"
3. Jika pelanggan bersikeras, minta bantuan manajer
4. Simpan uang mencurigakan, serahkan ke manajer atau polisi
```

---

### Pembayaran Kartu Kredit

#### Operasi Terminal Kartu

```
┌─────────────────────────────────────────────┐
│ Alur Transaksi Kartu Kredit                 │
├─────────────────────────────────────────────┤
│                                             │
│  Gesek/Masukkan/Tap Kartu                   │
│       ↓                                     │
│  Masukkan Jumlah Transaksi                  │
│       ↓                                     │
│  Tunggu Otorisasi (5-10 detik)             │
│       ↓                                     │
│  ┌──────────┐  ┌──────────┐               │
│  │ Disetujui│  │ Ditolak  │               │
│  └──────────┘  └──────────┘               │
│       ↓              ↓                      │
│  Cetak Struk     Coba Metode Lain          │
│       ↓                                     │
│  Pelanggan Tanda Tangan                     │
│       ↓                                     │
│  Verifikasi Tanda Tangan                    │
│       ↓                                     │
│  Transaksi Selesai ✅                      │
│                                             │
└─────────────────────────────────────────────┘
```

#### Penanganan Kegagalan Transaksi

| Pesan Error              | Penyebab                           | Solusi                                                         |
| ------------------------ | ---------------------------------- | -------------------------------------------------------------- |
| ❌ **Dana Tidak Cukup**  | Limit kredit terlampaui            | Minta pelanggan gunakan kartu lain atau metode pembayaran lain |
| ❌ **Kartu Kedaluwarsa** | Kartu melewati tanggal kadaluwarsa | Gunakan kartu yang valid                                       |
| ❌ **Transaksi Ditolak** | Bank menolak otorisasi             | Sarankan hubungi bank penerbit atau metode alternatif          |
| ❌ **Koneksi Gagal**     | Masalah jaringan                   | Coba lagi kartu atau gunakan tunai                             |
| ❌ **Error Baca Kartu**  | Strip magnetik/chip rusak          | Bersihkan kartu dan coba lagi atau gunakan kartu berbeda       |

---

### Pembayaran Mobile

#### Platform Pembayaran yang Didukung

```
┌─────────────────────────────────────────┐
│ Pembayaran Mobile Didukung MakanMakan   │
├─────────────────────────────────────────┤
│                                         │
│  📱 LINE Pay          ✅ Didukung       │
│  📱 Street Pay        ✅ Didukung       │
│  📱 Apple Pay         ✅ Didukung       │
│  📱 Google Pay        ✅ Didukung       │
│  📱 EasyCard Pay      ✅ Didukung       │
│  📱 Taiwan Pay        ✅ Didukung       │
│                                         │
└─────────────────────────────────────────┘
```

#### Alur Pembayaran Kode QR

```
1️⃣ Pilih "Pembayaran Mobile" di sistem kasir
2️⃣ Pilih platform pembayaran pelanggan
3️⃣ Sistem menghasilkan kode QR pembayaran
4️⃣ Pelanggan buka aplikasi mobile untuk scan kode QR
5️⃣ Pelanggan konfirmasi jumlah dan selesaikan pembayaran
6️⃣ Sistem menerima notifikasi pembayaran (3-5 detik)
7️⃣ Tampilkan "Pembayaran Berhasil" ✅
8️⃣ Otomatis cetak struk
```

---

### Pembayaran Split

Ketika pelanggan menggunakan beberapa metode pembayaran:

```
Contoh: Total jumlah $1,200

Pelanggan ingin menggunakan:
  • Voucher: $500
  • Kartu Kredit: Jumlah sisanya

Prosedur:
1️⃣ Pilih "Pembayaran Split"
2️⃣ Proses voucher terlebih dahulu
   - Pilih "Voucher"
   - Masukkan atau scan nomor voucher
   - Sistem validasi dan kurangi $500

3️⃣ Sistem menampilkan jumlah sisa: $700
4️⃣ Proses jumlah sisa
   - Pilih "Kartu Kredit"
   - Tagih $700 ke kartu

5️⃣ Transaksi selesai ✅
```

---

## Penanganan Struk

Sistem saat ini mencetak struk dan tidak menerbitkan faktur elektronik. Setiap toko menangani faktur melalui prosedur yang sudah berlaku.

---

## 🔄 Pengembalian Dana & Pembatalan

### Kebijakan Pengembalian Dana

```
┌─────────────────────────────────────────────┐
│ Kebijakan Pengembalian Dana MakanMakan      │
├─────────────────────────────────────────────┤
│                                             │
│  ✅ Kasus Pengembalian Dana Penuh:          │
│     • Makanan belum disiapkan              │
│     • Masalah kualitas makanan             │
│     • Makanan yang disajikan salah         │
│     • Kegagalan layanan serius             │
│                                             │
│  ⚠️ Kasus Pengembalian Dana Sebagian:       │
│     • Beberapa item bermasalah             │
│     • Pengalaman makan yang buruk          │
│                                             │
│  ❌ Kasus Tanpa Pengembalian Dana:          │
│     • Makanan sudah dikonsumsi             │
│     • Hanya preferensi rasa pribadi        │
│     • Melewati batas waktu pengembalian    │
│                                             │
└─────────────────────────────────────────────┘
```

---

### Alur Proses Pengembalian Dana

```
┌─────────────────────────────────────────────┐
│ Prosedur Pengembalian Dana Standar          │
├─────────────────────────────────────────────┤
│                                             │
│  Pelanggan Meminta Pengembalian Dana        │
│       ↓                                     │
│  Pahami Alasan Pengembalian Dana            │
│       ↓                                     │
│  Periksa apakah Memenuhi Kebijakan          │
│       ↓                                     │
│  ┌──────────┐  ┌──────────┐               │
│  │Memenuhi  │  │Tidak Memenuhi│            │
│  └──────────┘  └──────────┘               │
│       ↓              ↓                      │
│  Beritahu Manajer   Jelaskan dengan Sopan & Minta Maaf │
│  untuk Persetujuan                          │
│       ↓                                     │
│  Manajer Menyetujui                         │
│       ↓                                     │
│  Ajukan Pengembalian di Sistem             │
│       ↓                                     │
│  Pengembalian via Metode Pembayaran Asli   │
│       ↓                                     │
│  Cetak Struk Pengembalian                   │
│       ↓                                     │
│  Pelanggan Tanda Tangan Konfirmasi          │
│       ↓                                     │
│  Pengembalian Dana Selesai ✅              │
│                                             │
└─────────────────────────────────────────────┘
```

---

### Proses Metode Pengembalian Dana

#### Pengembalian Dana Tunai

```
1️⃣ Konfirmasi pesanan asli adalah pembayaran tunai
2️⃣ Hitung jumlah pengembalian
3️⃣ Ambil uang dari laci
4️⃣ Ulangi jumlah pengembalian
5️⃣ Serahkan uang ke pelanggan
6️⃣ Pelanggan hitung dan tanda tangan konfirmasi
7️⃣ Selesaikan catatan pengembalian di sistem
```

#### Pengembalian Dana Kartu Kredit

```
1️⃣ Konfirmasi pesanan asli adalah pembayaran kartu kredit
2️⃣ Pilih "Pengembalian Dana Kartu Kredit"
3️⃣ Sistem otomatis baca data transaksi asli
4️⃣ Masukkan jumlah pengembalian
5️⃣ Terminal kartu lakukan transaksi pengembalian
6️⃣ Tunggu otorisasi bank (5-10 detik)
7️⃣ Pengembalian berhasil ✅
8️⃣ Cetak struk pengembalian
9️⃣ Beritahu pelanggan: "Pengembalian akan muncul di akun Anda dalam 3-7 hari kerja"
```

#### Pengembalian Dana Pembayaran Mobile

```
1️⃣ Pilih "Pengembalian Dana Pembayaran Mobile"
2️⃣ Pilih platform pembayaran asli
3️⃣ Masukkan jumlah pengembalian
4️⃣ Sistem otomatis lakukan pengembalian
5️⃣ Pengembalian berhasil ✅
6️⃣ Beritahu pelanggan: "Pengembalian akan dikembalikan ke akun Anda segera"
```

---

### Contoh Struk Pengembalian Dana

```
┌────────────────────────────────────────┐
│      Struk Pengembalian Dana MakanMakan│
├────────────────────────────────────────┤
│                                        │
│ Tanggal: 2025/10/26    Waktu: 14:30    │
│ Pesanan Asli: 20251026-001             │
│ Alasan Pengembalian: Masalah kualitas makanan │
│                                        │
│ ────────────────────────────────────  │
│                                        │
│ Jumlah Asli:             $561          │
│ Jumlah Pengembalian:     $561          │
│ Metode Pengembalian:     Tunai         │
│                                        │
│ ────────────────────────────────────  │
│                                        │
│ Kasir: Mary                            │
│ Disetujui oleh Manajer: John           │
│                                        │
│ Tanda Tangan Pelanggan: ______________ │
│                                        │
│ Tanggal: ____/____/____                │
│                                        │
└────────────────────────────────────────┘
```

---

## 📊 Rekonsiliasi Harian

### Waktu Penutupan Akhir Hari

```
✅ Kapan melakukan penutupan akhir hari?

1. Setelah jam operasional berakhir
2. Semua pesanan telah dibayar
3. Konfirmasi tidak ada pengembalian yang tertunda
4. Siap untuk menghitung kas
```

---

### Proses Penutupan Standar

```
┌─────────────────────────────────────────────┐
│ Langkah Penutupan Akhir Hari                │
├─────────────────────────────────────────────┤
│                                             │
│  1️⃣ Login ke sistem kasir                  │
│      ↓                                      │
│  2️⃣ Pilih fungsi "Penutupan Harian"        │
│      ↓                                      │
│  3️⃣ Sistem otomatis hitung data hari ini   │
│      • Total penjualan                     │
│      • Jumlah transaksi                    │
│      • Jumlah setiap metode pembayaran     │
│      • Jumlah pengembalian dana            │
│      ↓                                      │
│  4️⃣ Hitung uang tunai aktual di laci       │
│      ↓                                      │
│  5️⃣ Masukkan jumlah yang dihitung aktual   │
│      ↓                                      │
│  6️⃣ Sistem bandingkan catatan vs aktual    │
│      ↓                                      │
│  ┌──────────┐  ┌──────────┐               │
│  │  Cocok   │  │Perbedaan │               │
│  └──────────┘  └──────────┘               │
│      ↓              ↓                       │
│  7️⃣ Cetak laporan  Cari alasan             │
│      ↓              ↓                       │
│  8️⃣ Manajer tanda tangan  Isi laporan varians │
│      ↓              ↓                       │
│  9️⃣ Simpan kas     Manajer tinjau          │
│      ↓                                      │
│  🔟 Penutupan selesai ✅                    │
│                                             │
└─────────────────────────────────────────────┘
```

---

### Laporan Bisnis Harian

```
┌────────────────────────────────────────────────────┐
│           Laporan Harian MakanMakan                │
│           Tanggal: 2025/10/26                      │
├────────────────────────────────────────────────────┤
│                                                    │
│ 【Ringkasan Bisnis】                               │
│                                                    │
│  Jam Operasional: 10:00 - 22:00                   │
│  Total Transaksi: 156                             │
│  Rata-rata Transaksi: $428                        │
│  Total Penjualan: $66,768                         │
│                                                    │
├────────────────────────────────────────────────────┤
│                                                    │
│ 【Statistik Metode Pembayaran】                   │
│                                                    │
│  💵 Tunai:           $28,500  (42.7%)             │
│     Transaksi: 72                                 │
│                                                    │
│  💳 Kartu Kredit:    $26,890  (40.3%)             │
│     Transaksi: 58                                 │
│                                                    │
│  📱 Pembayaran Mobile: $11,378  (17.0%)           │
│     Transaksi: 26                                 │
│     └ LINE Pay:     $6,200                        │
│     └ Street Pay:   $3,450                        │
│     └ Lainnya:      $1,728                        │
│                                                    │
├────────────────────────────────────────────────────┤
│                                                    │
│ 【Rekonsiliasi Kas】                              │
│                                                    │
│  Uang Awal:                        $5,000         │
│  Pendapatan Tunai:                $28,500         │
│  Pengeluaran Tunai (Pengembalian):  $450         │
│  ─────────────────────────────────              │
│  Jumlah Catatan:                  $33,050         │
│  Jumlah Aktual:                   $33,050         │
│  ─────────────────────────────────              │
│  Varians:                             $0  ✅      │
│                                                    │
├────────────────────────────────────────────────────┤
│                                                    │
│ 【Statistik Pengembalian Dana】                   │
│                                                    │
│  Jumlah Pengembalian: 3                           │
│  Jumlah Pengembalian: $450                        │
│  Alasan Pengembalian:                             │
│    • Masalah Makanan: 2 ($320)                   │
│    • Pesanan Dibatalkan: 1 ($130)                │
│                                                    │
├────────────────────────────────────────────────────┤
│                                                    │
│ 【Pengecualian】                                   │
│                                                    │
│  ✅ Tidak ada pengecualian yang dicatat            │
│                                                    │
├────────────────────────────────────────────────────┤
│                                                    │
│ Kasir: Mary               Tanda Tangan: _________ │
│ Manajer: John             Tanda Tangan: _________ │
│                                                    │
│ Waktu Penutupan: 2025/10/26 22:30                 │
│                                                    │
└────────────────────────────────────────────────────┘
```

---

### Lembar Perhitungan Kas

```
┌────────────────────────────────────────┐
│        Lembar Perhitungan Kas          │
│        Tanggal: 2025/10/26             │
├────────────────────────────────────────┤
│                                        │
│ 【Uang Kertas】                        │
│                                        │
│  $1,000  ×  20 lembar = $20,000       │
│  $  500  ×   8 lembar = $ 4,000       │
│  $  100  ×  82 lembar = $ 8,200       │
│                                        │
│  Subtotal Uang Kertas:  $32,200       │
│                                        │
│ ────────────────────────────────────  │
│                                        │
│ 【Koin】                               │
│                                        │
│  $   50  ×   8 keping = $   400       │
│  $   10  ×  25 keping = $   250       │
│  $    5  ×  20 keping = $   100       │
│  $    1  × 100 keping = $   100       │
│                                        │
│  Subtotal Koin:         $   850       │
│                                        │
│ ────────────────────────────────────  │
│                                        │
│ 【Total】                              │
│                                        │
│  Jumlah Aktual:         $33,050       │
│  Jumlah Catatan:        $33,050       │
│  Varians:               $     0  ✅   │
│                                        │
│ ────────────────────────────────────  │
│                                        │
│ Dihitung oleh: Mary    Waktu: 22:25   │
│ Diverifikasi oleh: John Waktu: 22:30  │
│                                        │
└────────────────────────────────────────┘
```

---

### Penanganan Varians

**Ketika jumlah catatan tidak cocok dengan aktual:**

```
Kasus 1: Aktual melebihi catatan (Kelebihan)

1️⃣ Catat jumlah kelebihan
2️⃣ Hitung ulang untuk konfirmasi
3️⃣ Periksa transaksi yang tidak tercatat
4️⃣ Isi "Laporan Varians"
5️⃣ Peninjauan manajer
6️⃣ Sisihkan jumlah kelebihan secara terpisah
7️⃣ Tunggu rekonsiliasi hari berikutnya


Kasus 2: Aktual kurang dari catatan (Kekurangan)

1️⃣ Catat jumlah kekurangan
2️⃣ Hitung ulang untuk konfirmasi
3️⃣ Ingat proses transaksi, temukan kemungkinan alasan:
   • Kembalian yang diberikan salah
   • Menerima uang palsu
   • Lupa mengumpulkan pembayaran
   • Memasukkan jumlah yang salah
4️⃣ Isi "Laporan Varians"
5️⃣ Peninjauan manajer
6️⃣ Tangani sesuai kebijakan perusahaan (kompensasi atau catat)
```

---

## 📈 Query Laporan

### Jenis Laporan yang Tersedia

```
┌─────────────────────────────────────────────┐
│ Laporan Sistem Kasir                        │
├─────────────────────────────────────────────┤
│                                             │
│  📊 Laporan Harian                          │
│     • Ringkasan bisnis harian              │
│     • Statistik metode pembayaran          │
│     • Analisis periode waktu               │
│                                             │
│  📊 Laporan Mingguan                        │
│     • Tren bisnis mingguan                 │
│     • Perbandingan minggu ke minggu        │
│                                             │
│  📊 Laporan Bulanan                         │
│     • Statistik bisnis bulanan             │
│     • Peringkat penjualan bulanan          │
│                                             │
│  📊 Detail Transaksi                        │
│     • Query transaksi tunggal              │
│     • Riwayat transaksi                    │
│                                             │
│  📊 Catatan Pengembalian Dana               │
│     • Statistik pengembalian dana          │
│     • Analisis alasan pengembalian         │
│                                             │
│  📊 Kinerja Pribadi                         │
│     • Statistik kinerja kasir              │
│     • Peringkat layanan                    │
│                                             │
└─────────────────────────────────────────────┘
```

---

### Langkah Query Laporan

```
1️⃣ Login ke sistem kasir
2️⃣ Klik "Query Laporan"
3️⃣ Pilih jenis laporan
4️⃣ Atur parameter query
   • Rentang tanggal
   • Metode pembayaran
   • Status transaksi
5️⃣ Klik "Query"
6️⃣ Tinjau konten laporan
7️⃣ Opsi untuk "Cetak" atau "Ekspor"
```

---

### Query Kinerja Pribadi

```
┌────────────────────────────────────────┐
│     Kinerja Bulanan Mary               │
│     Oktober 2025                       │
├────────────────────────────────────────┤
│                                        │
│ Hari Layanan: 22 hari                  │
│ Total Transaksi: 867                   │
│ Total Jumlah Transaksi: $346,890       │
│ Rata-rata Harian: $15,768              │
│ Rata-rata Transaksi: $400              │
│                                        │
│ ────────────────────────────────────  │
│                                        │
│ Distribusi Metode Pembayaran:          │
│  💵 Tunai: 45%                         │
│  💳 Kartu Kredit: 38%                  │
│  📱 Pembayaran Mobile: 17%             │
│                                        │
│ ────────────────────────────────────  │
│                                        │
│ Peringkat Layanan:                     │
│  ⭐⭐⭐⭐⭐  Efisiensi: 4.8/5.0          │
│  ⭐⭐⭐⭐⭐  Akurasi: 4.9/5.0            │
│  ⭐⭐⭐⭐⭐  Sikap Layanan: 5.0/5.0      │
│                                        │
│ ────────────────────────────────────  │
│                                        │
│ Catatan Pengecualian:                  │
│  • Varians Kas: 0 kali ✅              │
│  • Keluhan Pelanggan: 0 kali ✅        │
│  • Keterlambatan: 0 kali ✅            │
│                                        │
│ Peringkat Bulanan: 2 dari 8 kasir     │
│                                        │
└────────────────────────────────────────┘
```

---

## ⚠️ Penanganan Pengecualian

### Kasus Pengecualian Umum

#### 1. Crash Sistem

```
Gejala: Sistem kasir tidak mau start atau tiba-tiba menutup

Langkah:
1️⃣ Tetap tenang, minta maaf ke pelanggan
2️⃣ Beritahu pelanggan: "Sistem sedang tidak tersedia, mohon tunggu"
3️⃣ Segera beritahu staf IT atau manajer
4️⃣ Coba restart sistem
5️⃣ Jika tidak bisa diperbaiki segera:
   • Sementara gunakan struk tulisan tangan
   • Catat informasi transaksi
   • Input setelah sistem pulih
6️⃣ Pertahankan komunikasi dengan pelanggan, kurangi kecemasan menunggu
```

---

#### 2. Kerusakan Printer Struk

```
Gejala: Tidak bisa cetak struk, kertas macet, cetakan tidak jelas

Langkah:
1️⃣ Tentukan penyebab kerusakan
   • Kehabisan kertas? → Ganti gulungan struk
   • Kertas macet? → Buka mesin dan bersihkan
   • Cetakan tidak jelas? → Bersihkan kepala cetak

2️⃣ Jika tidak bisa diperbaiki segera
   • Tulis struk sementara dengan tangan
   • Catat nomor pesanan
   • Beritahu pelanggan tentang cetak ulang nanti

3️⃣ Beritahu staf pemeliharaan
4️⃣ Isi formulir perbaikan peralatan
```

**Langkah Penggantian Kertas Struk:**

```
1. Buka penutup atas printer struk
2. Lepas gulungan lama (jika tersisa)
3. Masukkan gulungan baru
4. Tarik kertas keluar sekitar 10cm
5. Tutup penutup atas
6. Tekan tombol "Feed" untuk tes
```

---

#### 3. Kerusakan Terminal Kartu

```
Gejala: Tidak bisa baca kartu, koneksi gagal, transaksi abnormal

Langkah:
1️⃣ Pemeriksaan dasar
   • Konfirmasi kabel daya terpasang
   • Periksa koneksi jaringan
   • Coba restart

2️⃣ Jika tidak bisa diperbaiki segera
   • Dengan sopan beritahu pelanggan: "Terminal kartu sementara tidak tersedia"
   • Sarankan metode pembayaran alternatif:
     ✓ Tunai
     ✓ Pembayaran mobile
     ✓ Bayar nanti

3️⃣ Beritahu manajer dan layanan pelanggan bank
4️⃣ Isi laporan pengecualian peralatan
```

---

#### 4. Gangguan Jaringan

```
Gejala: Tidak bisa terhubung, transaksi gagal, data tidak bisa diupload

Langkah:
1️⃣ Konfirmasi apakah gangguan total
   • Periksa apakah perangkat lain normal
   • Tanyakan situasi ke kolega lain

2️⃣ Beralih ke mode offline (jika tersedia)
   • Gunakan fungsi lokal
   • Catat informasi transaksi
   • Sinkronisasi setelah jaringan pulih

3️⃣ Beritahu administrator jaringan
4️⃣ Jika perlu penanganan darurat:
   • Gunakan hotspot mobile
   • Tulis catatan transaksi dengan tangan

5️⃣ Setelah jaringan pulih
   • Sinkronisasi data transaksi offline
   • Konfirmasi integritas data
```

---

#### 5. Kekurangan Kembalian

```
Gejala: Laci kas kekurangan denominasi tertentu untuk kembalian

Langkah:
1️⃣ Dengan sopan beritahu pelanggan: "Maaf, saat ini kekurangan uang kecil"
2️⃣ Berikan alternatif:
   • "Bisa saya berikan denominasi lain?"
   • "Bisa gunakan kartu atau pembayaran mobile?"
   • "Saya akan ambil kembalian dari kasir lain, mohon tunggu"

3️⃣ Cepat pinjam dari kasir lain
4️⃣ Selesaikan kembalian
5️⃣ Minta maaf dan ucapkan terima kasih atas kesabaran
6️⃣ Catat kebutuhan kembalian, beritahu manajer untuk mengisi
```

---

#### 6. Dugaan Uang Palsu

```
Prinsip Penanganan: Tetap tenang, tangani dengan sopan, lindungi kedua pihak

Langkah:
1️⃣ Jangan langsung menuduh pelanggan
2️⃣ Gunakan peralatan deteksi untuk verifikasi
3️⃣ Jika memang mencurigakan, dengan sopan katakan:
   "Permisi, uang ini sepertinya bermasalah,
    saya perlu konfirmasi manajer,
    atau bisa gunakan yang lain?"

4️⃣ Segera beritahu manajer
5️⃣ Manajer memutuskan setelah penilaian:
   • Kembalikan ke pelanggan, minta ganti uang
   • Simpan dan laporkan ke polisi

6️⃣ Tetap sopan sepanjang waktu, hindari konflik
7️⃣ Isi laporan pengecualian setelahnya
```

---

#### 7. Pelanggan Mempermasalahkan Jumlah

```
Gejala: Pelanggan percaya jumlah dihitung salah, ditagih berlebihan

Langkah:
1️⃣ Tetap tenang dan sopan
2️⃣ Katakan: "Biar saya verifikasi lagi"
3️⃣ Tarik detail pesanan
4️⃣ Jelaskan item per item ke pelanggan:
   "Pesanan Anda adalah:
    • Mie OO $150
    • Nasi OO $120
    • Minuman $50
    Totalnya adalah $320"

5️⃣ Jika memang dihitung salah:
   • Minta maaf dengan tulus
   • Segera perbaiki
   • Kembalikan kelebihan atau tagih selisih

6️⃣ Jika jumlah benar:
   • Jelaskan dengan sabar
   • Tunjukkan daftar harga
   • Minta bantuan manajer jika perlu

7️⃣ Isi catatan keluhan pelanggan
```

---

#### 8. Tampilan Jumlah Sistem Abnormal

```
Gejala: Sistem menampilkan jumlah yang jelas tidak wajar

Langkah:
1️⃣ Jangan tagih sesuai jumlah sistem
2️⃣ Hitung jumlah yang benar secara manual
3️⃣ Jelaskan ke pelanggan: "Sistem sepertinya salah, biar saya hitung"
4️⃣ Tagih jumlah yang benar
5️⃣ Catat pengecualian pada pesanan
6️⃣ Beritahu manajer dan staf IT
7️⃣ Isi laporan pengecualian sistem
8️⃣ Tunggu konfirmasi perbaikan
```

---

## 💵 Manajemen Kas

### Panduan Manajemen Laci Kas

```
┌─────────────────────────────────────────────┐
│ Aturan Emas Laci Kas                        │
├─────────────────────────────────────────────┤
│                                             │
│  1️⃣ Laci harus selalu terkunci             │
│                                             │
│  2️⃣ Tutup laci saat meninggalkan tempat duduk │
│                                             │
│  3️⃣ Uang besar segera ke brankas           │
│                                             │
│  4️⃣ Hitung secara berkala, pastikan catatan cocok dengan aktual │
│                                             │
│  5️⃣ Kas di laci tidak boleh melebihi batas │
│     (Disarankan tidak lebih dari $50,000)  │
│                                             │
│  6️⃣ Denominasi berbeda di slot, jaga kerapian │
│                                             │
│  7️⃣ Uang besar jangan taruh di laci dulu (cegah sengketa) │
│                                             │
│  8️⃣ Jangan pernah letakkan barang pribadi di laci │
│                                             │
└─────────────────────────────────────────────┘
```

---

### Konfigurasi Laci Kas Standar

```
┌─────────────────────────────────────────────────┐
│              Setup Laci Standar                 │
├─────────────────────────────────────────────────┤
│                                                 │
│  【Kompartemen Uang Kertas】                    │
│  ┌─────┬─────┬─────┬─────┬─────┐            │
│  │1000 │ 500 │ 200 │ 100 │Kosong│           │
│  │     │     │     │     │     │            │
│  └─────┴─────┴─────┴─────┴─────┘            │
│                                                 │
│  【Kompartemen Koin】                           │
│  ┌────┬────┬────┬────┬────┬────┐           │
│  │ 50 │ 10 │  5 │  1 │Kosong│Kosong│       │
│  │    │    │    │    │     │     │         │
│  └────┴────┴────┴────┴────┴────┘           │
│                                                 │
│  【Konfigurasi Uang Awal yang Disarankan】      │
│  • $1000: 5 lembar = $5,000                    │
│  • $ 500: 4 lembar = $2,000                    │
│  • $ 100: 30 lembar = $3,000                   │
│  • $  50: 10 keping = $  500                   │
│  • $  10: 30 keping = $  300                   │
│  • $   5: 20 keping = $  100                   │
│  • $   1: 100 keping = $ 100                   │
│  ─────────────────────────────────            │
│  Total Uang Awal:    $11,000                   │
│                                                 │
└─────────────────────────────────────────────────┘
```

---

### Operasi Penyimpanan Kas

**Kapan menyimpan kas?**

```
1️⃣ Kas laci melebihi batas ($50,000)
2️⃣ Terlalu banyak uang besar ($1,000+)
3️⃣ Tengah hari operasional (makan siang atau istirahat sore)
4️⃣ Akhir operasional harian
```

**Proses Penyimpanan:**

```
1️⃣ Siapkan tas penyimpanan
2️⃣ Hitung kas yang akan disimpan
3️⃣ Isi slip penyimpanan
   • Tanggal
   • Jumlah
   • Penyimpan
   • Waktu
4️⃣ Letakkan kas dan slip di tas penyimpanan
5️⃣ Segel tas penyimpanan
6️⃣ Beritahu manajer atau orang yang ditunjuk
7️⃣ Dua orang antar kas ke brankas bersama
8️⃣ Catat penyimpanan di sistem
9️⃣ Simpan tanda terima penyimpanan
```

---

### Perhitungan Kas

**Waktu Perhitungan:**

- Sebelum operasional harian dimulai
- Selama pergantian shift
- Setelah operasional harian berakhir
- Pemeriksaan spot manajer

**Langkah Perhitungan:**

```
1️⃣ Hentikan pengumpulan (pasang tanda "Sementara Tutup")
2️⃣ Siapkan lembar perhitungan
3️⃣ Hitung mulai dari denominasi besar
   • $1000 × ____ = $ _____
   • $ 500 × ____ = $ _____
   • $ 100 × ____ = $ _____
   • $  50 × ____ = $ _____
   • $  10 × ____ = $ _____
   • $   5 × ____ = $ _____
   • $   1 × ____ = $ _____

4️⃣ Hitung jumlah total
5️⃣ Bandingkan dengan jumlah catatan sistem
6️⃣ Jika ada varians, hitung ulang
7️⃣ Catat hasil perhitungan
8️⃣ Manajer tanda tangan konfirmasi
```

---

## 🔐 Panduan Keamanan

### Keamanan Informasi

```
┌─────────────────────────────────────────────┐
│ Aturan Keamanan Informasi Sistem Kasir      │
├─────────────────────────────────────────────┤
│                                             │
│  🔒 Manajemen Kata Sandi                    │
│     • Jangan bagikan kredensial akun       │
│     • Ganti kata sandi secara berkala (setiap 3 bulan) │
│     • Jangan tulis kata sandi di kertas atau telepon │
│     • Harus logout saat meninggalkan tempat duduk │
│                                             │
│  🔒 Perlindungan Informasi Pelanggan        │
│     • Jangan ungkapkan info pribadi pelanggan │
│     • Jangan foto atau rekam info kartu    │
│     • Data pelanggan hanya untuk penggunaan bisnis │
│     • Jangan hapus atau bagikan secara eksternal │
│                                             │
│  🔒 Penggunaan Sistem                       │
│     • Jangan gunakan akun orang lain       │
│     • Jangan modifikasi pengaturan sistem  │
│     • Jangan instal software yang tidak diotorisasi │
│     • Laporkan abnormalitas segera         │
│                                             │
└─────────────────────────────────────────────┘
```

---

### Keamanan Keuangan

```
┌─────────────────────────────────────────────┐
│ Tindakan Perlindungan Keamanan Uang         │
├─────────────────────────────────────────────┤
│                                             │
│  💰 Tindakan Pencegahan                     │
│                                             │
│  1️⃣ Waspada untuk transaksi besar          │
│     • Verifikasi keaslian uang besar       │
│     • Konfirmasi pengguna kartu adalah pemegang kartu │
│     • Beritahu manajer tentang transaksi mencurigakan │
│                                             │
│  2️⃣ Manajemen Laci                         │
│     • Kunci laci dengan segera             │
│     • Kas besar disimpan tepat waktu       │
│     • Jangan biarkan orang lain dekat laci │
│                                             │
│  3️⃣ Pencegahan Penipuan                    │
│     • Jangan terima metode pembayaran mencurigakan │
│     • Jangan patuhi operasi abnormal       │
│     • Permintaan transfer via telepon selalu penipuan │
│                                             │
│  4️⃣ Perlindungan Pengawasan                │
│     • Ketahui lokasi kamera                │
│     • Pastikan situasi abnormal terekam    │
│     • Jangan halangi kamera                │
│                                             │
└─────────────────────────────────────────────┘
```

---

### Keselamatan Pribadi

```
┌─────────────────────────────────────────────┐
│ Catatan Keselamatan Pribadi Kasir           │
├─────────────────────────────────────────────┤
│                                             │
│  🚨 Saat Diancam atau Dirampok              │
│                                             │
│  1️⃣ Tetap tenang, patuhi tuntutan          │
│  2️⃣ Keselamatan hidup paling penting, uang sekunder │
│  3️⃣ Jangan melawan atau memprovokasi       │
│  4️⃣ Ingat ciri-ciri (tinggi, aksen, tanda) │
│  5️⃣ Amati arah pelarian                    │
│  6️⃣ Panggil polisi setelah memastikan keselamatan │
│  7️⃣ Pertahankan tempat kejadian, tunggu polisi │
│  8️⃣ Kerja sama dengan penyelidikan polisi  │
│                                             │
│  ⚠️ Metode Bantuan Darurat                  │
│                                             │
│  • Polisi: 110                             │
│  • Manajer Toko: [Telepon]                 │
│  • Keamanan: [Telepon]                     │
│  • Lokasi Tombol Darurat: [Lokasi]         │
│                                             │
└─────────────────────────────────────────────┘
```

---

### Pencegahan Penipuan

**Metode Penipuan Umum:**

```
❌ Jenis Penipuan 1: Layanan Pelanggan Palsu
   "Saya dari layanan pelanggan kantor pusat, ada masalah sistem,
    perlu Anda bantu tes fungsi pengembalian dana..."

   → Jangan pernah patuhi operasi yang diminta via telepon
   → Tutup, hubungi manajer langsung untuk verifikasi


❌ Jenis Penipuan 2: Penipuan Tukar Uang
   Pelanggan setelah pembayaran bilang: "Saya mau tukar uang itu"
   Ambil kesempatan untuk tukar atau ambil uang ekstra

   → Uang yang diterima segera masuk laci
   → Jangan terima permintaan tukar uang


❌ Jenis Penipuan 3: Kebingungan Jumlah
   "Saya tadi kasih $1000, kembalian Anda salah"
   Sebenarnya kasih $500

   → Letakkan uang besar di atas kasir dulu
   → Ulangi dengan keras "Diterima $1000"
   → Taruh uang di laci setelah kasih kembalian


❌ Jenis Penipuan 4: Layar Pembayaran Palsu
   Telepon menunjukkan pembayaran selesai, sebenarnya tidak

   → Harus konfirmasi sistem menerima pembayaran
   → Tidak bisa hanya lihat layar telepon pelanggan
   → Tunggu konfirmasi sistem sebelum selesaikan pembayaran
```

---

## ❓ FAQ

### Q1: Bagaimana jika pelanggan bilang lupa bawa uang?

```
A: Penanganan yang sopan

1️⃣ Tetap ramah
   "Tidak masalah, apakah ada metode pembayaran lain?"

2️⃣ Berikan opsi
   • "Bisa gunakan kartu kredit atau pembayaran mobile?"
   • "Ada ATM terdekat, mau tarik tunai? Kami bisa simpan pesanan Anda"
   • "Bisa teman bantu transfer pembayaran?"

3️⃣ Solusi akhir
   • Beritahu manajer
   • Manajer memutuskan apakah:
     → Biarkan pelanggan tinggalkan info kontak, bayar nanti
     → Catat informasi ID
     → Laporkan ke polisi (jika sikap buruk atau pelanggar berulang)
```

---

### Q2: Bagaimana jika pelanggan minta diskon?

```
A: Respon standar

1️⃣ Jelaskan dengan sopan
   "Maaf, harga ditetapkan oleh perusahaan,
    saya tidak punya wewenang untuk mengubahnya"

2️⃣ Berikan alternatif
   • "Kami punya benefit anggota, daftar untuk diskon berikutnya"
   • "Promosi saat ini adalah..."
   • "Apakah punya kupon?"

3️⃣ Jika pelanggan bersikeras
   • "Biar saya panggil manajer untuk membantu"
   • Manajer memutuskan apakah memberikan diskon

⚠️ Catatan:
   Kasir tidak bisa memberikan diskon secara independen
   Semua penyesuaian harga perlu persetujuan manajer
```

---

### Q3: Bagaimana jika struk hilang atau tidak jelas?

Konfirmasikan nomor pesanan dan catatan pembayaran, lalu cetak ulang struk dan serahkan kepada pelanggan. Minta bantuan manajer jika cetak ulang tidak tersedia.

---

### Q4: Pelanggan bilang sudah bayar tapi sistem tidak ada catatan?

```
A: Penanganan sengketa pembayaran

1️⃣ Tetap tenang dan sopan
   "Biar saya verifikasi untuk Anda"

2️⃣ Periksa catatan sistem
   • Query status pesanan
   • Konfirmasi catatan pembayaran
   • Periksa waktu transaksi

3️⃣ Jika pembayaran mobile
   • Minta pelanggan tunjukkan layar sukses pembayaran
   • Verifikasi nomor transaksi
   • Konfirmasi jumlah dan info merchant

4️⃣ Jika memang dibayar tapi sistem belum update
   • Segera beritahu manajer dan IT
   • Jangan tagih lagi
   • Tunggu sinkronisasi sistem

5️⃣ Jika tidak bisa konfirmasi
   • Minta bantuan manajer
   • Periksa laporan bank
   • Tinjau rekaman pengawasan (jika perlu)
```

---

### Q5: Bagaimana jika kekurangan kas ditemukan setelah tutup?

```
A: Penanganan kekurangan kas

1️⃣ Segera hitung ulang
   Pastikan tidak ada kesalahan perhitungan

2️⃣ Isi "Laporan Varians"
   • Catat jumlah kekurangan
   • Jelaskan kemungkinan alasan
   • Ingat transaksi mencurigakan

3️⃣ Beritahu manajer
   • Laporkan situasi
   • Kerja sama dengan penyelidikan

4️⃣ Tinjau rekaman
   • Periksa proses transaksi
   • Temukan kemungkinan penyebab

5️⃣ Tindak lanjut
   • Kompensasi atau catat sesuai kebijakan perusahaan
   • Tingkatkan tindakan pencegahan
   • Perkuat manajemen kas

Pencegahan:
✅ Verifikasi dengan hati-hati setiap transaksi
✅ Hitung laci secara berkala
✅ Perhatikan khusus transaksi besar
✅ Hitung saat pergantian shift
```

---

### Q6: Pelanggan bilang tidak menerima struk kartu?

```
A: Penanganan cetak ulang struk

1️⃣ Konfirmasi transaksi selesai
   • Periksa catatan sistem
   • Konfirmasi pembayaran diselesaikan

2️⃣ Cetak ulang struk
   • Masuk catatan transaksi
   • Pilih transaksi itu
   • Klik "Cetak Ulang Struk"
   • Tandai "CETAK ULANG"

3️⃣ Pelanggan tanda tangan
   • Verifikasi tanda tangan cocok dengan belakang kartu
   • Simpan struk untuk catatan

4️⃣ Catat alasan cetak ulang
   • Catat di sistem
   • Hindari pemrosesan ganda
```

---

### Q7: Bagaimana jika menghadapi pelanggan sulit atau keluhan?

```
A: Prinsip penanganan keluhan

1️⃣ Tetap profesional dan tenang
   • Jangan berdebat dengan pelanggan
   • Jangan merespons secara emosional
   • Selalu tetap sopan

2️⃣ Dengarkan kekhawatiran pelanggan
   "Saya mengerti perasaan Anda, mohon ceritakan apa yang terjadi"

3️⃣ Berempati dan minta maaf
   "Saya minta maaf atas ketidaknyamanannya"

4️⃣ Usulkan solusi
   • Tangani dalam wewenang
   • Minta manajer jika di luar wewenang

5️⃣ Catat konten keluhan
   • Isi formulir keluhan
   • Jelaskan insiden
   • Catat penyelesaian

6️⃣ Tindak lanjut
   • Konfirmasi masalah teratasi
   • Tindak lanjut dengan pelanggan jika perlu

Prinsip penting:
⚠️ Jangan pernah konflik dengan pelanggan
⚠️ Cari bantuan segera jika dihina atau diancam
⚠️ Keselamatan pribadi paling penting
```

---

### Q8: Bolehkah saya memberikan diskon saat teman berkunjung?

```
A: Tidak ❌

Penjelasan:
1. Ini melanggar kebijakan perusahaan
2. Penyalahgunaan wewenang
3. Dapat mengakibatkan:
   • Peringatan tertulis
   • Pemotongan gaji
   • Pemecatan

Pendekatan yang benar:
✅ Teman harus membayar normal
✅ Jika ada benefit karyawan, terapkan sesuai kebijakan
✅ Jangan berikan diskon apapun secara independen
✅ Semua diskon perlu persetujuan manajer
```

---

### Q9: Bolehkah saya memajukan pembayaran untuk pelanggan?

```
A: Tidak disarankan ⚠️

Alasan:
1. Menyebabkan kebingungan akuntansi
2. Mungkin tidak bisa pulihkan pembayaran
3. Melanggar aturan manajemen arus kas

Kasus pengecualian (perlu persetujuan manajer):
• Pelanggan reguler sementara lupa uang
• Jumlah sangat kecil
• Manajer setuju dan catat

Proses yang benar:
1️⃣ Jangan majukan secara independen
2️⃣ Konsultasi manajer
3️⃣ Jika disetujui untuk memajukan:
   • Isi formulir uang muka
   • Catat info kontak pelanggan
   • Tetapkan batas waktu pengembalian
   • Manajer tanda tangan
4️⃣ Lacak pemulihan pembayaran
```

---

### Q10: Akhir shift tapi masih ada pelanggan yang perlu bayar?

```
A: Selesaikan layanan sebelum pergi

Etika profesional:
✅ Layani pelanggan terakhir
✅ Selesaikan handover shift
✅ Pastikan akun akurat
✅ Tidak bisa tinggalkan kekacauan untuk shift berikutnya

Pendekatan yang benar:
1️⃣ Lanjutkan melayani pelanggan
2️⃣ Pertahankan sikap yang baik (jangan tunjukkan ketidaksabaran)
3️⃣ Setelah pembayaran selesai:
   • Hitung laci kas
   • Cetak laporan shift
   • Serahkan ke staf yang masuk
   • Bisa pergi setelah manajer tanda tangan

Jika benar-benar ada urusan mendesak:
• Beritahu manajer sebelumnya
• Minta kolega untuk membantu
• Selesaikan handover dasar
```

---

## 📞 Informasi Kontak

### Kontak Internal

```
┌─────────────────────────────────────────┐
│ Jendela Kontak Terkait Kasir            │
├─────────────────────────────────────────┤
│                                         │
│  👔 Manajer Toko                        │
│     Ekstensi: 101                       │
│     Mobile: [Telepon]                   │
│     Tangani: HR, keluhan, darurat       │
│                                         │
│  💻 Staf IT                             │
│     Ekstensi: 201                       │
│     Mobile: [Telepon]                   │
│     Tangani: Masalah sistem, jaringan   │
│                                         │
│  🔧 Staf Pemeliharaan                   │
│     Ekstensi: 301                       │
│     Mobile: [Telepon]                   │
│     Tangani: Kerusakan peralatan, hardware │
│                                         │
│  📊 Departemen Akuntansi                │
│     Ekstensi: 102                       │
│     Email: accounting@makanmakan.com    │
│     Tangani: Akuntansi, masalah struk   │
│                                         │
└─────────────────────────────────────────┘
```

---

### Kontak Eksternal

```
┌─────────────────────────────────────────┐
│ Kontak Dukungan Eksternal               │
├─────────────────────────────────────────┤
│                                         │
│  🏦 Layanan Pelanggan Bank              │
│     Terminal kartu, pertanyaan transaksi│
│     [Nama Bank]: 0800-XXX-XXX          │
│                                         │
│  📱 Layanan Pelanggan Pembayaran Mobile │
│     LINE Pay:                          │
│     Street Pay:                         │
│     Platform Lain:                      │
│                                         │
│  🚨 Bantuan Darurat                     │
│     Polisi: 110                        │
│     Pemadam Kebakaran: 119             │
│     Keamanan: [Telepon]                │
│                                         │
│  🛠️ Vendor Peralatan                    │
│     Sistem POS: [Telepon]              │
│     Terminal Kartu: [Telepon]          │
│                                         │
└─────────────────────────────────────────┘
```

---

## 🎓 Lampiran

### A. Frasa Kasir Standar

**Salam:**

```
"Halo, selamat datang!"
"Halo, makan di tempat atau bawa pulang?"
```

**Selama Pembayaran:**

```
"Halo, siap untuk bayar?"
"Totalnya adalah $XXX"
"Metode pembayaran apa yang Anda inginkan?"
"Diterima $XXX"
"Kembalian Anda adalah $XXX, mohon periksa"
```

**Menyerahkan Struk:**

```
"Ini struk Anda, mohon disimpan"
"Terima kasih telah makan, sampai jumpa lagi!"
```

**Menghadapi Masalah:**

```
"Permisi, mohon tunggu sebentar"
"Maaf atas penantiannya"
"Terima kasih atas kesabaran Anda"
```

---

### B. Pintasan Keyboard

| Fungsi            | Pintasan   |
| ----------------- | ---------- |
| Cari Cepat        | F1         |
| Bayar             | F2         |
| Batal             | ESC        |
| Cetak Struk      | Ctrl+P     |
| Cetak Ulang       | Ctrl+R     |
| Pengembalian Dana | Ctrl+Alt+R |
| Kunci Layar       | Ctrl+L     |
| Logout            | Ctrl+Q     |
| Bantuan           | F12        |

---

### C. Standar Kinerja Kasir

```
┌────────────────────────────────────────┐
│        Tinjauan Kinerja Kasir          │
├────────────────────────────────────────┤
│                                        │
│ 📊 Akurasi Transaksi (30%)            │
│    • Frekuensi varians kas            │
│    • Jumlah kesalahan                 │
│    • Frekuensi kesalahan struk        │
│                                        │
│ ⚡ Efisiensi Layanan (25%)            │
│    • Waktu pembayaran rata-rata       │
│    • Jumlah pelanggan harian          │
│    • Kecepatan pemrosesan             │
│                                        │
│ 😊 Sikap Layanan (25%)                │
│    • Kepuasan pelanggan               │
│    • Kesopanan dan respon             │
│    • Kemampuan pemecahan masalah      │
│                                        │
│ 📋 Kepatuhan (20%)                    │
│    • Catatan kehadiran                │
│    • Kebenaran prosedur               │
│    • Kepatuhan keselamatan            │
│    • Penampilan seragam               │
│                                        │
└────────────────────────────────────────┘
```

---

### D. Jalur Pengembangan Profesional

```
Jalur Pengembangan Karir Kasir

Kasir Tingkat Pemula
    ↓
Kasir Senior (6 bulan-1 tahun)
    ↓
Pemimpin Tim Kasir (1-2 tahun)
    ↓
Supervisor Konter (2-3 tahun)
    ↓
Manajer Lantai (3-5 tahun)
    ↓
Manajer Toko/Manajer Operasi (5+ tahun)

Peningkatan Keterampilan yang Diperlukan:
• Kemajuan keterampilan profesional
• Kepemimpinan dan manajemen
• Kemampuan pemecahan masalah
• Kemampuan analisis bisnis
• Kemampuan pelatihan staf
```

---

## 📝 Riwayat Versi

| Versi | Tanggal    | Pembaruan       |
| ----- | ---------- | --------------- |
| 2.0   | 2025-10-26 | Rilis awal      |
| -     | -          | Akan diperbarui |

---

## 🙏 Kesimpulan

Terima kasih telah memilih menjadi kasir MakanMakan!

Pekerjaan kasir tampak sederhana tetapi membawa tanggung jawab besar. Anda adalah titik kontak terakhir yang dimiliki pelanggan di toko, dan orang kunci yang meninggalkan kesan akhir.

**Harap Ingat:**

- 💰 **Akurasi** adalah prinsip utama pekerjaan kasir
- 😊 **Kesopanan** adalah persyaratan dasar layanan berkualitas
- 🔒 **Integritas** adalah nilai inti etika profesional
- 📚 **Pembelajaran** adalah satu-satunya jalan menuju pertumbuhan profesional

Semoga manual ini membantu Anda memulai dengan cepat dan menjadi kasir yang sangat baik!

Untuk pertanyaan atau saran, silakan hubungi kami kapan saja.

---

<div align="center">

**Manual Kasir MakanMakan**

Dibuat dengan ❤️ untuk kasir kami

**Versi 2.0** | **2025-10-26**

© 2025 MakanMakan. Semua hak dilindungi undang-undang.

</div>
