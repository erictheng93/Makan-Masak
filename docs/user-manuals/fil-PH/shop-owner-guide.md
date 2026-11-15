# 🏪 Gabay sa Paggamit ng MakanMakan para sa May-ari ng Restaurant

> **Bersyon**: 2.0
> **Huling Na-update**: 2025-10-26
> **Para sa**: May-ari ng Restaurant, Manager
> **Mga plano, trial at paggamit**: Ang may-ari ng tindahan mismo ang nagpapalit ng plano sa "Plan & Usage" ng admin dashboard (agad ang upgrade, sa katapusan ng period ang downgrade, walang online payment). Tingnan ang [Plans, trial and usage (English)](../en-US/plans-and-usage.html).

---

## 📚 Talaan ng Nilalaman

1. [Mabilis na Pagsisimula](#mabilis-na-pagsisimula)
2. [Pangkalahatang-tanaw ng Sistema](#pangkalahatang-tanaw-ng-sistema)
3. [Pangunahing Pagse-setup](#pangunahing-pagse-setup)
4. [Pamamahala ng Menu](#pamamahala-ng-menu)
5. [Pamamahala ng Mesa at Upuan](#pamamahala-ng-mesa-at-upuan)
6. [Sistema ng QR Code](#sistema-ng-qr-code)
7. [Pamamahala ng Order](#pamamahala-ng-order)
8. [Pamamahala ng Staff](#pamamahala-ng-staff)
9. [Pamamahala ng Customer](#pamamahala-ng-customer)
10. [Sistema ng Iskedyul](#sistema-ng-iskedyul)
11. [Pamamahala ng Leave](#pamamahala-ng-leave)
12. [Pagsusuri ng Negosyo](#pagsusuri-ng-negosyo)
13. [AI Analytics](#ai-analytics)
14. [Mga Madalas Itanong](#mga-madalas-itanong)

---

## 🚀 Mabilis na Pagsisimula

### Proseso ng Pag-login

```
┌─────────────────────────────────────────────┐
│ Proseso ng Pag-login                        │
├─────────────────────────────────────────────┤
│                                             │
│  1️⃣ Buksan ang Admin Dashboard             │
│      ↓                                      │
│  2️⃣ Ilagay ang Username at Password        │
│      ↓                                      │
│  3️⃣ Mag-authenticate ang Sistema           │
│      ↓                                      │
│  4️⃣ Pumasok sa Owner Dashboard             │
│                                             │
└─────────────────────────────────────────────┘
```

### Unang Pag-login Checklist

✅ **Hakbang 1: Kumpletuhin ang Profile ng Restaurant**

- Pangalan ng restaurant, address, contact
- I-setup ang oras ng operasyon
- Mag-upload ng larawan ng restaurant

✅ **Hakbang 2: Buuin ang Istruktura ng Menu**

- Magdagdag ng kategorya ng menu
- Mag-upload ng impormasyon ng pagkain
- Itakda ang presyo at larawan

✅ **Hakbang 3: I-setup ang mga Mesa**

- Lumikha ng impormasyon ng mesa
- Gumawa ng QR code
- Mag-print at mag-display

✅ **Hakbang 4: Magdagdag ng Staff Account**

- Lumikha ng rekord ng empleyado
- Mag-assign ng mga karapatan
- Magpadala ng login credentials

✅ **Hakbang 5: Simulan ang Operasyon**

- Subukan ang ordering flow
- Kumpirmahin ang pagtanggap ng order
- Bantayan ang operasyon

---

## 🏢 Pangkalahatang-tanaw ng Sistema

### Saklaw ng Karapatan ng May-ari

```
┌─────────────────────────────────────────────────────────┐
│ Mga Puwedeng Pamahalaan ng May-ari                      │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌──────────────┐    ┌──────────────┐                 │
│  │  Mga Setting │───→│  Pamamahala  │                 │
│  │  ng Restaurant│    │  ng Menu     │                 │
│  └──────────────┘    └──────────────┘                 │
│         ↓                    ↓                         │
│  ┌──────────────┐    ┌──────────────┐                 │
│  │  Pamamahala  │───→│  Sistema ng  │                 │
│  │  ng Mesa     │    │  QR Code     │                 │
│  └──────────────┘    └──────────────┘                 │
│         ↓                    ↓                         │
│  ┌──────────────┐    ┌──────────────┐                 │
│  │  Pamamahala  │───→│  Pamamahala  │                 │
│  │  ng Order    │    │  ng Staff    │                 │
│  └──────────────┘    └──────────────┘                 │
│         ↓                    ↓                         │
│  ┌──────────────┐    ┌──────────────┐                 │
│  │  Pagsusuri   │───→│  AI          │                 │
│  │  ng Negosyo  │    │  Analytics   │                 │
│  └──────────────┘    └──────────────┘                 │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Multi-Role Collaboration Mode

```
    May-ari (Ikaw)
           │
    ┌──────┼──────┬──────┐
    ↓      ↓      ↓      ↓
  Chef  Server Cashier Customer
    │      │      │      │
    └──────┴──────┴──────┘
           │
   Real-time Platform
```

**Paliwanag**:

- **May-ari**: Kumpletong karapatan, makikita lahat ng data
- **Chef**: Tumanggap ng order, i-update ang status ng pagluluto
- **Server**: Kumpirmahin ang delivery, i-update ang progress
- **Cashier**: Proseso ng bayad, tingnan ang kita
- **Customer**: Mag-scan ng QR para mag-order, subaybayan ang order

---

## ⚙️ Pangunahing Pagse-setup

### Pamamahala ng Impormasyon ng Restaurant

Pumunta sa: **Dashboard → Restaurant Settings → Basic Info**

#### Kinakailangang Impormasyon

| Field                  | Deskripsyon                           | Halimbawa                                 |
| ---------------------- | ------------------------------------- | ----------------------------------------- |
| Pangalan ng Restaurant | Pangalan na makikita ng customer      | Masarap na Seafood Restaurant             |
| Address                | Kumpletong address kasama postal code | 123 EDSA, Makati City, Metro Manila       |
| Telepono               | Customer service o reservation line   | 02-1234-5678                              |
| Oras ng Operasyon      | Araw-araw na oras ng pagbubukas       | 11:00-14:00, 17:00-21:00                  |
| Deskripsyon            | Maikling pakilala, espesyalidad       | Sariwang seafood at tradisyonal na lutuin |

#### Konpigurasyon ng Oras ng Operasyon

```
┌─────────────────────────────────────────┐
│ Halimbawa ng Oras ng Operasyon          │
├─────────────────────────────────────────┤
│                                         │
│  Lunes - Biyernes:                      │
│  ├─ Tanghalian: 11:00 - 14:00          │
│  └─ Hapunan: 17:00 - 21:00             │
│                                         │
│  Sabado - Linggo:                       │
│  └─ Buong Araw: 11:00 - 21:00          │
│                                         │
│  Sarado: Bawat Miyerkules               │
│                                         │
└─────────────────────────────────────────┘
```

### Pag-upload ng Larawan ng Restaurant

Suportadong format: JPG, PNG, WebP
Inirerekomendang laki: 1920x1080 pixels
Laki ng file: Maximum 5MB

**Mga Hakbang sa Pag-upload**:

1. I-click ang "Upload Photo"
2. Pumili ng larawan ng labas o signature dish
3. Awtomatikong i-compress at gumawa ng iba't ibang laki
4. I-preview at i-save

---

## 🍽️ Pamamahala ng Menu

### Istruktura ng Menu

```
Menu ng Restaurant
  │
  ├── Kategorya 1: Pampagana
  │    ├── Pagkain A
  │    ├── Pagkain B
  │    └── Pagkain C
  │
  ├── Kategorya 2: Pangunahing Ulam
  │    ├── Pagkain D
  │    ├── Pagkain E
  │    └── Pagkain F
  │
  └── Kategorya 3: Panghimagas
       ├── Pagkain G
       └── Pagkain H
```

### Magdagdag ng Kategorya

Pumunta sa: **Pamamahala ng Menu → Pamamahala ng Kategorya → Magdagdag ng Kategorya**

#### Mga Setting ng Kategorya

| Setting               | Deskripsyon                       | Halimbawa           |
| --------------------- | --------------------------------- | ------------------- |
| Pangalan ng Kategorya | Titulo na makikita sa menu        | Mga Pagkaing-dagat  |
| Icon                  | Simbolo ng icon (opsyonal)        | 🦐                  |
| Pagkakasunod-sunod    | Pagkakasunod-sunod ng pagpapakita | 1, 2, 3...          |
| Status                | Ipakita sa menu                   | Aktibo/Hindi Aktibo |

#### Best Practice sa Pamamahala ng Kategorya

```
┌─────────────────────────────────────────┐
│ Inirerekomendang Istruktura ng Kategorya│
├─────────────────────────────────────────┤
│                                         │
│  1. 🥗 Pampagana / Appetizer           │
│  2. 🥘 Pangunahing Ulam / Espesyal     │
│  3. 🍜 Pancit at Kanin                 │
│  4. 🥤 Inumin                          │
│  5. 🍰 Panghimagas                     │
│  6. ⭐ Espesyal Ngayong Araw           │
│                                         │
└─────────────────────────────────────────┘
```

### Magdagdag ng Menu Item

Pumunta sa: **Pamamahala ng Menu → Listahan ng Item → Magdagdag ng Item**

#### Form ng Impormasyon ng Item

```
┌──────────────────────────────────────────────┐
│ Form ng Pag-input ng Menu Item               │
├──────────────────────────────────────────────┤
│                                              │
│  【Pangunahing Info】                        │
│  ├─ Pangalan ng Pagkain: _____________      │
│  ├─ Kategorya: [Piliin]                     │
│  ├─ Presyo: ₱______                         │
│  └─ Deskripsyon: ___________________        │
│                                              │
│  【Pag-upload ng Larawan】                   │
│  └─ [I-click para Mag-upload] o I-drag Dito│
│                                              │
│  【Status ng Availability】                  │
│  ├─ ✅ Available Ngayon                     │
│  ├─ ⏸️ Pansamantalang Ubos                 │
│  └─ ❌ Hindi Available                      │
│                                              │
│  【Iba Pang Setting】                        │
│  ├─ 🌶️ Antas ng Anghang                   │
│  ├─ 🥬 Vegetarian Option                   │
│  └─ ⏱️ Oras ng Paghahanda                  │
│                                              │
└──────────────────────────────────────────────┘
```

#### Mga Kinakailangan sa Larawan

| Item                  | Kinakailangan                                               |
| --------------------- | ----------------------------------------------------------- |
| Format                | JPG, PNG, WebP                                              |
| Inirerekomendang Laki | 800x600 pixels                                              |
| Laki ng File          | Maximum 3MB                                                 |
| Tips sa Pagkuha       | Maliwanag na ilaw, malinaw na focus, magandang presentation |

**Proseso ng Pag-optimize ng Larawan**:

```
Mag-upload ng Orihinal na Larawan
     ↓
Awtomatikong I-compress
     ↓
Gumawa ng Iba't Ibang Laki
 ├─ Thumbnail (200x150)
 ├─ Medium (400x300)
 └─ Orihinal (800x600)
     ↓
I-save sa Cloud (Cloudflare R2)
     ↓
Mabilis na Global Delivery (CDN)
```

### Batch Management

#### Batch Price Update

Pumunta sa: **Pamamahala ng Menu → Batch Operations → Pag-adjust ng Presyo**

Mga kaso ng paggamit:

- Seasonal price adjustment
- Pag-adjust dahil sa pagtaas ng gastos
- Pag-set ng promo pricing

**Mga Hakbang**:

1. Pumili ng mga item na ia-adjust (multi-select)
2. I-set ang paraan ng pag-adjust:
   - Fixed amount (hal: +₱10)
   - Percentage (hal: +5%)
3. I-preview ang resulta
4. Kumpirmahin at ilapat

#### Batch Enable/Disable

Mabilis na aksyon:

- ✅ I-enable ang mga napiling item sa isang click
- ⏸️ I-pause ang mga napiling item sa isang click
- ❌ I-disable ang mga napiling item sa isang click

---

## 🪑 Pamamahala ng Mesa at Upuan

### Arkitektura ng Sistema ng Mesa

```
┌─────────────────────────────────────────────────────┐
│ Arkitektura ng Sistema ng Pamamahala ng Mesa        │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Restaurant                                         │
│   │                                                 │
│   ├─ Area 1: Dining Area                          │
│   │   ├─ Mesa A (4-seater)                        │
│   │   │   ├─ Upuan A1                             │
│   │   │   ├─ Upuan A2                             │
│   │   │   ├─ Upuan A3                             │
│   │   │   └─ Upuan A4                             │
│   │   │                                            │
│   │   └─ Mesa B (6-seater)                        │
│   │       └─ [6 upuan]                            │
│   │                                                │
│   └─ Area 2: Outdoor Area                         │
│       └─ Mesa C (2-seater)                        │
│           └─ [2 upuan]                            │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Magdagdag ng Mesa

Pumunta sa: **Pamamahala ng Mesa → Magdagdag ng Mesa**

#### Form ng Pagse-setup ng Mesa

```
┌─────────────────────────────────────────┐
│ Konpigurasyon ng Mesa                   │
├─────────────────────────────────────────┤
│                                         │
│  Numero ng Mesa: [A1] [A2] [A3]...     │
│  Pangalan ng Mesa: _______________     │
│  Bilang ng Upuan: [4]                  │
│  Area: [Dining Area ▼]                 │
│  Status: ○ Aktibo  ○ Hindi Aktibo     │
│                                         │
│  [Gumawa ng QR]  [I-save ang Setting]  │
│                                         │
└─────────────────────────────────────────┘
```

#### Mga Mungkahi sa Pagpangalan ng Mesa

```
Pagpangalan base sa area:
  DiningArea-A1, A2, A3...
  OutdoorArea-B1, B2, B3...
  PrivateRoom-VIP1, VIP2...

Pagpangalan base sa palapag:
  1F-01, 1F-02, 1F-03...
  2F-01, 2F-02, 2F-03...

Pagpangalan base sa function:
  Bar-1, Bar-2...
  Sofa-1, Sofa-2...
  Window-1, Window-2...
```

### Pamamahala ng Upuan (Dual Mode)

Sinusuportahan ng MakanMakan ang dalawang mode ng pamamahala ng upuan:

#### Mode 1: Table-Level QR Code

```
┌─────────────────────────────────────┐
│  Mesa A1 (4-seater)                 │
│                                     │
│    [Isang QR Code sa Gitna ng Mesa]│
│                                     │
│  Mga Kaso ng Paggamit:              │
│  • Grupo na kumakain nang sama-sama│
│  • Pamilya, barkada                │
│  • Sama-samang bayad                │
│                                     │
└─────────────────────────────────────┘
```

#### Mode 2: Seat-Level QR Code

```
┌─────────────────────────────────────┐
│  Mesa B1 (4-seater)                 │
│                                     │
│  [QR-1]     [QR-2]                 │
│   Upuan 1    Upuan 2               │
│                                     │
│  [QR-3]     [QR-4]                 │
│   Upuan 3    Upuan 4               │
│                                     │
│  Mga Kaso ng Paggamit:              │
│  • Indibidwal na order, hiwalay bayad│
│  • Fast food, food court           │
│  • Business lunch                  │
│                                     │
└─────────────────────────────────────┘
```

#### Gabay sa Pagpili ng Mode

| Uri ng Negosyo            | Inirerekomendang Mode | Dahilan                                                           |
| ------------------------- | --------------------- | ----------------------------------------------------------------- |
| Tradisyonal na Restaurant | Table-level           | Karaniwan ay grupo ang kumakain                                   |
| Hotpot Restaurant         | Table-level           | Shared pot, group ordering                                        |
| Fast Food                 | Seat-level            | Individual order, mabilis na turnover                             |
| Food Court                | Seat-level            | Hindi magkakilalang nagshare ng mesa, hiwalay bayad               |
| Café                      | Mixed                 | Malalaking mesa ay table-level, indibidwal na upuan ay seat-level |

---

## 📱 Sistema ng QR Code

### Tatlong Mode ng QR Code

Nag-aalok ang MakanMakan ng tatlong mode ng QR code para sa iba't ibang sitwasyon ng negosyo:

```
┌─────────────────────────────────────────────────────┐
│ Arkitektura ng Sistema ng QR Code                   │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Mode 1: Shop-Level QR                             │
│  ┌──────────────────────────────┐                 │
│  │  Isang QR → Buong Restaurant │                 │
│  │  Para sa: Takeout, Delivery  │                 │
│  └──────────────────────────────┘                 │
│                 │                                   │
│  Mode 2: Table-Level QR                            │
│  ┌──────────────────────────────┐                 │
│  │  Isang QR bawat Mesa         │                 │
│  │  Para sa: Tradisyonal Dine-in│                 │
│  └──────────────────────────────┘                 │
│                 │                                   │
│  Mode 3: Seat-Level QR                             │
│  ┌──────────────────────────────┐                 │
│  │  Indibidwal na QR bawat Upuan│                 │
│  │  Para sa: Hiwalay Order      │                 │
│  └──────────────────────────────┘                 │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Mode 1: Shop-Level QR

**Mga Sitwasyon ng Paggamit**:

- ✅ Takeout/delivery shop
- ✅ Walang upuan (nakatayo habang kumakain, roadside stall)
- ✅ Mobile food truck
- ✅ Pop-up store, market stall

**Paraan ng Pag-generate**:

Pumunta sa: **Pamamahala ng QR Code → Shop QR → Gumawa ng Shop QR Code**

```
┌─────────────────────────────────────┐
│ Setting ng Shop QR Code             │
├─────────────────────────────────────┤
│                                     │
│  Uri ng QR Code: Shop-level        │
│  Paraan ng paggamit: Customer scan │
│                 direkta sa menu     │
│                                     │
│  Mga suhestiyon sa lagyan:          │
│  ├─ Poster sa pintuan ng tindahan  │
│  ├─ Sa harap ng counter            │
│  ├─ Share sa social media          │
│  └─ Link sa delivery platform      │
│                                     │
│  [Generate QR Code]  [Download]    │
│                                     │
└─────────────────────────────────────┘
```

**Flow ng Pag-order ng Customer**:

```
Mag-scan ng shop QR code
     ↓
Pumasok sa menu
     ↓
Pumili ng pagkain
     ↓
Punan ang pickup info
     ↓
Kumpirmahin ang order
     ↓
Hintayin ang pickup notification
```

### Mode 2: Table-Level QR

**Mga Sitwasyon ng Paggamit**:

- ✅ Tradisyonal na dine-in restaurant
- ✅ Isang mesa, sama-samang order
- ✅ Pamilya, barkada na kumakain
- ✅ Sama-samang bayad mode

**Paraan ng Pag-generate**:

Pumunta sa: **Pamamahala ng Mesa → Pumili ng Mesa → Generate QR Code**

```
┌─────────────────────────────────────┐
│ Setting ng Table QR Code            │
├─────────────────────────────────────┤
│                                     │
│  Numero ng mesa: A1                 │
│  Uri ng QR Code: Table-level        │
│                                     │
│  Mga opsyon ng setting:             │
│  □ Payagan ang dagdag order        │
│  □ Ipakita ang info ng mesa        │
│  □ Auto-fill ng numero ng mesa     │
│                                     │
│  [Generate Single QR]  [Batch Generate]│
│                                     │
└─────────────────────────────────────┘
```

**Batch Generate ng Table QR Code**:

```
Pumili ng ilang mesa
     ↓
I-set ang uniform parameter
     ↓
One-click generate lahat ng QR Code
     ↓
I-download ang ZIP file
     ↓
I-unzip tapos i-print at idikit
```

**Flow ng Pag-order ng Customer**:

```
Umupo → Mag-scan ng QR sa mesa
          ↓
     Pumasok sa ordering page
     (Auto-fill numero ng mesa)
          ↓
     Pumili ng pagkain
          ↓
     Ipadala ang order
          ↓
     Hintayin ang pagkain
```

### Mode 3: Seat-Level QR

**Mga Sitwasyon ng Paggamit**:

- ✅ Fast food, food court
- ✅ Business lunch
- ✅ Hindi magkakilalang magkatabi sa mesa
- ✅ Indibidwal order, hiwalay bayad

**Paraan ng Pag-generate**:

Pumunta sa: **Pamamahala ng Mesa → Pumili ng Mesa → Pamamahala ng Upuan → Batch Generate Seat QR**

```
┌─────────────────────────────────────┐
│ Batch Generate ng Seat QR Code      │
├─────────────────────────────────────┤
│                                     │
│  Mesa: A1                           │
│  Bilang ng upuan: [4]               │
│                                     │
│  Auto-generate ng numero ng upuan:  │
│  ├─ A1-Upuan1                      │
│  ├─ A1-Upuan2                      │
│  ├─ A1-Upuan3                      │
│  └─ A1-Upuan4                      │
│                                     │
│  [Batch Generate QR]  [Download All]│
│                                     │
└─────────────────────────────────────┘
```

**Halimbawa ng Seat Label**:

```
        Mesa A1 (4-seater)
┌───────────┬───────────┐
│   [QR-1]  │   [QR-2]  │
│   Upuan 1 │   Upuan 2 │
├───────────┼───────────┤
│   [QR-3]  │   [QR-4]  │
│   Upuan 3 │   Upuan 4 │
└───────────┴───────────┘
```

**Flow ng Pag-order ng Customer**:

```
Umupo sa upuan → Mag-scan ng QR ng upuan
                     ↓
                Pumasok sa ordering page
                (Auto-fill mesa + numero ng upuan)
                     ↓
                Pumili ng sariling pagkain
                     ↓
                Ipadala ang individual order
                     ↓
                Hintayin ang pagkain
                     ↓
                Magbayad nang hiwalay
```

---

### Disenyo at Pagpi-print ng QR Code

#### Mga Rekomendasyon sa Laki ng QR Code

| Lugar ng Paglalagay   | Inirerekomendang Laki | Distansya ng Pag-scan |
| --------------------- | --------------------- | --------------------- |
| Standing sign sa mesa | 5cm x 5cm             | 20-30cm               |
| Sticker sa mesa       | 3cm x 3cm             | 10-20cm               |
| Poster sa dingding    | 15cm x 15cm           | 50-100cm              |
| Electronic screen     | Variable              | 20-50cm               |

#### Mga Template ng Disenyo ng QR Code

Pumunta sa: **Pamamahala ng QR Code → Design Template → Pumili ng Template**

```
┌─────────────────────────────────────────┐
│ Mga Opsyon ng Disenyo ng QR Code       │
├─────────────────────────────────────────┤
│                                         │
│  Template 1: Minimalist                 │
│  ├─ Purong QR code                     │
│  └─ Black and white                    │
│                                         │
│  Template 2: Branded                    │
│  ├─ May logo ng restaurant             │
│  ├─ Brand colors                       │
│  └─ Numero ng mesa/upuan               │
│                                         │
│  Template 3: Guided                     │
│  ├─ QR code + instruction text         │
│  ├─ "Scan para Mag-order" hint         │
│  └─ Step-by-step guide                 │
│                                         │
└─────────────────────────────────────────┘
```

#### Mga Suhestiyon sa Pag-print

**Mga Materyales**:

- 🏆 **Recommended**: Waterproof sticker, PVC material
- ✅ **Pwedeng gamitin**: Glossy paper, photo paper
- ❌ **Hindi inirerekomenda**: Ordinary copy paper (madaling masira)

**Mga Opsyon sa Laminating**:

- Paggamit sa mesa: Inirerekomenda ang laminating o acrylic standing
- Outdoor use: Kailangan ng waterproof treatment
- Pansamantalang gamit: Pwedeng gumamit ng transparent tape para protektahan

### Mga Function ng Pamamahala ng QR Code

#### Real-time Monitoring

Pumunta sa: **Pamamahala ng QR Code → Usage Statistics**

```
┌─────────────────────────────────────────┐
│ Real-time Monitor ng QR Code Usage      │
├─────────────────────────────────────────┤
│                                         │
│  Bilang ng scan ngayong araw: 127 beses│
│                                         │
│  Usage rate ng bawat QR Code:          │
│  ├─ Mesa A1: ████████░░ 85%            │
│  ├─ Mesa A2: ██████░░░░ 62%            │
│  ├─ Mesa B1: ██████████ 100%           │
│  └─ Mesa B2: ████░░░░░░ 45%            │
│                                         │
│  Anomaly alert:                         │
│  ⚠️ Mesa C3 walang scan ng 2 oras      │
│                                         │
└─────────────────────────────────────────┘
```

#### Mabilis na QR Code Reset

**Mga Sitwasyon ng Paggamit**:

- Nasira ang QR code kailangan i-print ulit
- Security consideration kailangan palitan
- Reconfiguration ng table layout

**Mga Hakbang sa Operation**:

1. Pumunta sa: **Pamamahala ng QR Code → Pumili ng Target QR Code**
2. I-click ang "Generate Ulit"
3. I-download ang bagong QR Code
4. Awtomatikong ma-invalid ang lumang QR Code

---

## 📋 Pamamahala ng Order

### Lifecycle ng Order

```
┌─────────────────────────────────────────────────────┐
│ Kumpletong Workflow ng Order                        │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Customer Mag-scan QR → Buksan ang Menu            │
│         ↓                                           │
│  Pumili ng Item → Idagdag sa Cart                  │
│         ↓                                           │
│  Kumpirmahin ang Order → Ipadala                   │
│         ↓                                           │
│  ⏰ Status: Pending (Naghihintay ng Kumpirmasyon)  │
│         ↓                                           │
│  👨‍🍳 Chef Makatanggap ng Notif → Kumpirmahin      │
│         ↓                                           │
│  ⏰ Status: Preparing (Niluluto)                   │
│         ↓                                           │
│  👨‍🍳 Chef Natapos Magluto → I-update Status      │
│         ↓                                           │
│  ⏰ Status: Ready (Handa nang Ihatid)              │
│         ↓                                           │
│  🚶 Server Kunin → Ihatid sa Mesa                 │
│         ↓                                           │
│  ⏰ Status: Delivered (Naihatid na)                │
│         ↓                                           │
│  💳 Customer Tapos na → Magbayad sa Cashier       │
│         ↓                                           │
│  ⏰ Status: Completed (Tapos na)                   │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Real-time Monitoring ng Order

Pumunta sa: **Dashboard → Order Monitor**

```
┌───────────────────────────────────────────────────────┐
│ Real-time Order Monitor             [2025-10-26 14:30]│
├───────────────────────────────────────────────────────┤
│                                                       │
│  【Pending】(3 orders)                                │
│  ├─ #A-001 | Mesa A1 | 2 items | 2 minuto na        │
│  ├─ #A-002 | Mesa B2 | 5 items | 5 minuto na        │
│  └─ #S-001 | Shop | 3 items | 1 minuto na           │
│                                                       │
│  【Preparing】(5 orders) 👨‍🍳                         │
│  ├─ #A-003 | Mesa A3 | Nagluluto 8 minuto           │
│  ├─ #A-004 | Mesa C1 | Nagluluto 12 minuto          │
│  └─ ...                                              │
│                                                       │
│  【Ready】(2 orders) 🔔                               │
│  ├─ #A-005 | Mesa D2 | Handa nang ihatid!           │
│  └─ #A-006 | Mesa A1 | Handa nang ihatid!           │
│                                                       │
│  【Delivered】(8 orders) ✅                           │
│  Kumakain ang mga customer...                        │
│                                                       │
└───────────────────────────────────────────────────────┘
```

### Detalyadong Impormasyon ng Order

I-click ang anumang order para makita ang kumpletong info:

```
┌─────────────────────────────────────────┐
│ Detalyadong Info ng Order #1234         │
├─────────────────────────────────────────┤
│                                         │
│  【Basic Info】                         │
│  Mesa: A3                               │
│  Oras: 2025-10-26 12:35                │
│  Status: 🟡 Niluluto                    │
│  Estimated finish: 12:50 (8 minuto pa) │
│                                         │
│  【Order Details】                      │
│  1. Seafood Fried Rice x1   $180       │
│  2. Wintermelon Tea x2      $60        │
│  3. Fried Tofu x1           $80        │
│                                         │
│  Subtotal:           $320              │
│  Service Charge (10%): $32             │
│  Total:              $352              │
│                                         │
│  【Notes】                              │
│  "Fried rice less oil, tofu extra      │
│   crispy"                               │
│                                         │
│  [Update Status]  [Print]  [Cancel]    │
│                                         │
└─────────────────────────────────────────┘
```

### Dashboard ng Mga Order Ngayong Araw

Pumunta sa: **Pamamahala ng Order → Overview Ngayong Araw**

```
┌───────────────────────────────────────────────────────┐
│ Overview ng Mga Order Ngayong Araw      [2025-10-26]  │
├───────────────────────────────────────────────────────┤
│                                                       │
│  Need handle: 🔴 3 orders  │  Preparing: 🟡 5 orders│
│  Tapos na: 🟢 42 orders    │  Total kita: $12,450   │
│                                                       │
├───────────────────────────────────────────────────────┤
│                                                       │
│  【New Order Notification】                           │
│  ┌───────────────────────────────────────┐          │
│  │ 🔔 Mesa A3 - Order #1234              │          │
│  │ Oras: 12:35                           │          │
│  │ Items: Seafood Fried Rice x1, Tea x2 │          │
│  │ [Kumpirmahin Order]  [Tingnan Details]│          │
│  └───────────────────────────────────────┘          │
│                                                       │
└───────────────────────────────────────────────────────┘
```

### Proseso ng Pag-operate ng Order

#### Kumpirmasyon ng Bagong Order

```
Makatanggap ng bagong order notification
     ↓
Tingnan ang nilalaman ng order
     ↓
Kaya bang gawin?
     │
     ├─ Oo → I-click ang "Kumpirmahin Order"
     │            ↓
     │        Ipasok sa kusina
     │            ↓
     │        Chef magsimulang magluto
     │
     └─ Hindi → I-click ang "Hindi Matatanggap"
                       ↓
                   Punan ang dahilan
                       ↓
                   Abisuhan ang customer
```

#### I-update ang Status ng Order

**Lugar ng Operation**: Order details page → Update status button

```
┌─────────────────────────────┐
│ I-update ang Status ng Order│
├─────────────────────────────┤
│                             │
│  Kasalukuyang status: Niluluto│
│                             │
│  Pumili ng bagong status:   │
│  ○ Tapos na (Handa na)     │
│  ○ Naihatid (Naihatid na)  │
│  ○ Bayad na                │
│                             │
│  [Kumpirmahin Update]       │
│                             │
└─────────────────────────────┘
```

### Pamamahala ng Dagdag Order

Pwedeng mag-add ang customer ng pagkain sa orihinal na order:

```
Orihinal na Order #1234
├─ Seafood Fried Rice x1
├─ Wintermelon Tea x2
└─ (12:35 ipinadala)

【Dagdag Order #1234-A】
├─ Fried Tofu x1
└─ (12:45 ipinadala)
     ↓
Awtomatikong pagsamahin
     ↓
Kumpletong Order #1234
├─ Seafood Fried Rice x1
├─ Wintermelon Tea x2
└─ Fried Tofu x1 [Bago]
```

**Paraan ng Pagpapakita**:

- May label na "Bago" ang bagong item
- Pagkakaiba ng kulay: Orihinal order (puti), dagdag (dilaw)
- May timeline na nagpapakita ng oras ng bawat item

### Paghanap at Filter ng Order

Pumunta sa: **Pamamahala ng Order → Order History**

#### Mga Kondisyon ng Filter

```
┌─────────────────────────────────────────┐
│ Maghanap ng Order                       │
├─────────────────────────────────────────┤
│                                         │
│  Saklaw ng petsa: [2025-10-20] ~ [2025-10-26]│
│                                         │
│  Status ng order:                       │
│  ☑ Lahat    □ Pending   □ In Progress │
│  □ Tapos    □ Cancelled                │
│                                         │
│  Filter ng mesa: [Lahat ng Mesa ▼]     │
│                                         │
│  Saklaw ng halaga: $ [100] ~ $ [1000]  │
│                                         │
│  [Maghanap]  [I-reset]  [Export Report]│
│                                         │
└─────────────────────────────────────────┘
```

### Report ng Statistics ng Order

Pumunta sa: **Pamamahala ng Order → Statistics Report**

```
┌───────────────────────────────────────────────┐
│ Order Statistics Linggong Ito (2025-10-20~26)│
├───────────────────────────────────────────────┤
│                                               │
│  Kabuuang orders: 287 orders                 │
│  Average order value: $345                   │
│  Total kita: $99,015                         │
│                                               │
│  Daily order trend:                           │
│  ████████████████░░░░░░ Lunes (42)          │
│  ██████████████████████ Martes (53)         │
│  ███████████████░░░░░░░ Miyerkules (38)     │
│  ████████████████████░░ Huwebes (48)        │
│  ██████████████████████ Biyernes (54)       │
│  ████████████████░░░░░░ Sabado (52) ⭐      │
│                                               │
│  Peak hours:                                  │
│  🥇 Tanghalian (12:00-14:00): 45%            │
│  🥈 Hapunan (18:00-20:00): 38%               │
│  🥉 Meryenda (15:00-17:00): 17%              │
│                                               │
└───────────────────────────────────────────────┘
```

---

## 👥 Pamamahala ng Staff

### Magdagdag ng Staff Account

Pumunta sa: **Pamamahala ng Staff → Listahan ng Staff → Magdagdag ng Staff**

```
┌─────────────────────────────────────────┐
│ Magdagdag ng Staff Account              │
├─────────────────────────────────────────┤
│                                         │
│  Pangalan: _____________________________│
│  Email: ____________________________    │
│  Telepono: __________________________   │
│                                         │
│  Role:                                  │
│  ○ May-ari - Kumpletong access         │
│  ○ Chef - Tingnan orders, update kusina│
│  ○ Server - Tingnan orders, mag-deliver│
│  ○ Cashier - Handle payment, view kita │
│                                         │
│  [I-save]  [Kanselahin]                │
│                                         │
└─────────────────────────────────────────┘
```

### Permission Matrix ng Staff

| Function              | May-ari | Chef | Server | Cashier |
| --------------------- | ------- | ---- | ------ | ------- |
| Tingnan orders        | ✅      | ✅   | ✅     | ✅      |
| I-update order status | ✅      | ✅   | ✅     | ✅      |
| Pamahalaan menu       | ✅      | ❌   | ❌     | ❌      |
| Pamahalaan mesa       | ✅      | ❌   | ❌     | ❌      |
| Tingnan kita          | ✅      | ❌   | ❌     | ✅      |
| Tingnan gastos        | ✅      | ❌   | ❌     | ❌      |
| Pamahalaan staff      | ✅      | ❌   | ❌     | ❌      |
| Handle payment        | ✅      | ❌   | ❌     | ✅      |
| Refund/Discount       | ✅      | ❌   | ❌     | ✅      |
| Tingnan analytics     | ✅      | ❌   | ❌     | ❌      |

### Pamamahala ng Schedule ng Staff

Pumunta sa: **Pamamahala ng Staff → Schedule Management**

#### Tingnan ang Linggong Schedule

```
┌──────────────────────────────────────────────────────────┐
│ Schedule Linggong Ito (2025-10-20 ~ 2025-10-26)          │
├──────────────────────────────────────────────────────────┤
│                                                          │
│         Lun   Mar   Miy   Huw   Biy   Sab   Lin         │
│                                                          │
│  Chef      AM    AM    Off   PM    PM    AM    Off      │
│  Server Li PM    PM    AM    AM    Off   PM    PM       │
│  Cashier   PM    Off   PM    PM    PM    PM    AM       │
│                                                          │
│  [Magdagdag ng Shift]  [Export]  [Print]                │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

#### Mga Setting ng Shift

```
Setting ng uri ng shift:

Morning Shift: 08:00 - 16:00 (8 oras)
Afternoon Shift: 12:00 - 20:00 (8 oras)
Evening Shift: 16:00 - 24:00 (8 oras)
Full Day: 10:00 - 22:00 (12 oras)

Pwedeng i-customize ang oras ng shift
```

### Record ng Attendance

Pumunta sa: **Pamamahala ng Staff → Attendance Management**

```
┌─────────────────────────────────────────┐
│ Record ng Attendance                    │
├─────────────────────────────────────────┤
│                                         │
│  Ngayong araw (2025-10-26)              │
│                                         │
│  Chef                                   │
│  ├─ Time in: 08:05 ✅                  │
│  └─ Time out: Naghihintay...           │
│                                         │
│  Server Li                              │
│  ├─ Time in: 11:58 ✅                  │
│  └─ Time out: Naghihintay...           │
│                                         │
│  Cashier                                │
│  ├─ Time in: Hindi pa nag-time in ⚠️  │
│  └─ Naka-schedule na shift: 16:00      │
│                                         │
└─────────────────────────────────────────┘
```

### I-track ang Performance ng Staff

Pumunta sa: **Pamamahala ng Staff → Performance Report**

```
┌───────────────────────────────────────────────┐
│ Staff Performance Buwang Ito (2025-10)       │
├───────────────────────────────────────────────┤
│                                               │
│  Chef (Cook)                                  │
│  ├─ Naproseso ang orders: 523 orders         │
│  ├─ Average completion time: 15 minuto       │
│  ├─ Customer rating: ⭐⭐⭐⭐⭐ (4.8/5.0)    │
│  └─ Attendance rate: 96%                     │
│                                               │
│  Server Li (Server)                           │
│  ├─ Naihatid na pagkain: 487 beses           │
│  ├─ Average delivery time: 3 minuto          │
│  ├─ Customer rating: ⭐⭐⭐⭐⭐ (4.9/5.0)    │
│  └─ Attendance rate: 100%                    │
│                                               │
└───────────────────────────────────────────────┘
```

---

## 👨‍👩‍👧‍👦 Pamamahala ng Customer

### Mga Mode ng Customer Registration

Sinusuportahan ng MakanMakan ang dalawang mode ng paggamit para sa mga customer:

```
┌─────────────────────────────────────────┐
│ Mga Mode ng Customer Usage              │
├─────────────────────────────────────────┤
│                                         │
│  Mode 1: Guest (Walang Registration)   │
│  ├─ Mag-scan QR direktang mag-order    │
│  ├─ Hindi kailangan mag-sign up/login  │
│  ├─ Para sa walk-in guests             │
│  └─ Walang member points accumulation  │
│                                         │
│  Mode 2: Member (Kailangan Registration)│
│  ├─ Mag-sign up para ma-track orders   │
│  ├─ Mag-accumulate ng consumption points│
│  ├─ Tingnan ang order history          │
│  └─ Makatanggap ng member benefits     │
│                                         │
└─────────────────────────────────────────┘
```

### Tingnan ang Customer Data

Pumunta sa: **Pamamahala ng Customer → Customer List**

```
┌────────────────────────────────────────────────────────────┐
│ Customer List                         [Maghanap: ____]     │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  Pangalan    Telepono      Sign-up Date  Orders  Total    │
│  ──────────────────────────────────────────────────────    │
│  Juan D      0917-123-4567  2025-08-15   15      $4,500   │
│  Maria S     0928-234-5678  2025-09-01   8       $2,800   │
│  Pedro R     0939-345-6789  2025-10-10   3       $1,200   │
│                                                            │
│  [Export Data]  [Magpadala ng Voucher]                    │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

### Customer Segmentation

Pumunta sa: **Pamamahala ng Customer → Customer Segmentation**

#### Mga Criteria ng Automatic Segmentation

```
┌─────────────────────────────────────────┐
│ Automatic Customer Segmentation         │
├─────────────────────────────────────────┤
│                                         │
│  🥇 VIP Customers (52 tao)             │
│  └─ Criteria: Total spend > $5,000     │
│                                         │
│  🥈 Active Customers (138 tao)         │
│  └─ Criteria: 3+ orders sa 30 days    │
│                                         │
│  🥉 Regular Customers (245 tao)        │
│  └─ Criteria: Naka-sign up, < 3 orders│
│                                         │
│  😴 Sleeping Customers (87 tao)        │
│  └─ Criteria: 60+ days walang order   │
│                                         │
│  🆕 New Customers (34 tao)             │
│  └─ Criteria: Sign-up < 30 days       │
│                                         │
└─────────────────────────────────────────┘
```

### Customer Details

I-click ang pangalan ng customer para makita ang detalyadong info:

```
┌─────────────────────────────────────────┐
│ Customer Profile: Juan D                 │
├─────────────────────────────────────────┤
│                                         │
│  【Basic Info】                         │
│  Telepono: 0917-123-4567               │
│  Email: juan@example.com               │
│  Birthday: 1990-05-15                  │
│  Sign-up date: 2025-08-15              │
│                                         │
│  【Consumption Statistics】             │
│  Total orders: 15                      │
│  Total spend: $4,500                   │
│  Average order value: $300             │
│  Last visit: 2025-10-20                │
│                                         │
│  【Member Points】                      │
│  Current points: 450 points            │
│  Pwedeng i-redeem: $45 discount        │
│                                         │
│  【Preference Analysis】                │
│  Madalas na-order:                      │
│  1. Seafood Fried Rice (8 beses)       │
│  2. Fried Tofu (6 beses)               │
│  3. Wintermelon Tea (12 beses)         │
│                                         │
│  Usual visit time: Tanghali (12:00-14:00)│
│  Favorite seating: Malapit sa bintana  │
│                                         │
│  [Magpadala ng Promo]  [Tingnan History]│
│                                         │
└─────────────────────────────────────────┘
```

### Magpadala ng Voucher

Pumunta sa: **Pamamahala ng Customer → Voucher Management**

```
┌─────────────────────────────────────────┐
│ Gumawa ng Promo Campaign                │
├─────────────────────────────────────────┤
│                                         │
│  Pangalan ng campaign: _______________  │
│                                         │
│  Uri ng promo:                          │
│  ○ Discount (hal: 10%, 20% off)        │
│  ○ Cash voucher (hal: ₱50 off)         │
│  ○ Buy 1 Get 1                         │
│  ○ Spend & Get (hal: Spend ₱500 get ₱50)│
│                                         │
│  Target customers:                      │
│  □ VIP Customers                       │
│  □ Active Customers                    │
│  □ Sleeping Customers                  │
│  □ New Customers                       │
│                                         │
│  Validity period:                       │
│  Simula: [2025-11-01]                  │
│  Hanggang: [2025-11-30]                │
│                                         │
│  [Preview]  [Ipadala Ngayon]  [I-schedule]│
│                                         │
└─────────────────────────────────────────┘
```

---

## 📅 Sistema ng Iskedyul

> **Development Progress**: 43% Tapos na
> **Status**: Database schema kumpleto, service layer sa pag-develop pa

### Arkitektura ng Sistema ng Iskedyul

```
┌─────────────────────────────────────────────────────┐
│ Sistema ng Iskedyul - Arkitektura                   │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Pamamahala ng Shift Template                       │
│  ├─ Lumikha ng uri ng shift                        │
│  ├─ Itakda ang oras ng trabaho                     │
│  └─ Tukuyin ang pangangailangan sa manpower        │
│                                                     │
│  Pag-iskedyul ng Empleyado                          │
│  ├─ Lingguhang iskedyul                            │
│  ├─ Buwanang iskedyul                              │
│  ├─ Awtomatikong mungkahi sa pag-iskedyul         │
│  └─ Pagtuklas ng salungatan                        │
│                                                     │
│  Pag-adjust ng Iskedyul                             │
│  ├─ Aplikasyon para sa swap ng shift              │
│  ├─ Aplikasyon para sa pamalit                    │
│  └─ Biglaan na overtime                            │
│                                                     │
│  Mga Ulat Estadistika                               │
│  ├─ Estadistika ng oras ng trabaho                │
│  ├─ Kalkulasyon ng sahod                          │
│  └─ Pagsusuri ng gastos sa manpower               │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Pag-set up ng Shift Template

Pumunta sa: **Pamamahala ng Iskedyul → Shift Templates**

```
┌─────────────────────────────────────────┐
│ Pamamahala ng Shift Template            │
├─────────────────────────────────────────┤
│                                         │
│  【Umaga na Shift】                     │
│  Oras: 08:00 - 16:00 (8 oras)          │
│  Kinakailangang Manpower:               │
│  ├─ Kusinero: 2 tao                    │
│  ├─ Server: 1 tao                      │
│  └─ Cashier: 1 tao                     │
│                                         │
│  【Tanghali na Shift】                  │
│  Oras: 12:00 - 20:00 (8 oras)          │
│  Kinakailangang Manpower:               │
│  ├─ Kusinero: 3 tao                    │
│  ├─ Server: 2 tao                      │
│  └─ Cashier: 1 tao                     │
│                                         │
│  【Gabi na Shift】                      │
│  Oras: 16:00 - 24:00 (8 oras)          │
│  Kinakailangang Manpower:               │
│  ├─ Kusinero: 2 tao                    │
│  ├─ Server: 1 tao                      │
│  └─ Cashier: 1 tao                     │
│                                         │
│  [Magdagdag ng Template]  [I-edit]  [Tanggalin]│
│                                         │
└─────────────────────────────────────────┘
```

### Awtomatikong Pag-iskedyul

```
Mga Salik na Isinasaalang-alang sa Auto-Scheduling:

┌─────────────────────────────────────────┐
│ AI Intelligent Scheduling               │
├─────────────────────────────────────────┤
│                                         │
│  1️⃣ Kagustuhan ng Empleyado            │
│  ├─ Preferred na oras                  │
│  └─ Pangangailangan sa day-off         │
│                                         │
│  2️⃣ Mga Batas sa Paggawa               │
│  ├─ Maximum na oras bawat linggo       │
│  ├─ Sunod-sunod na araw ng trabaho     │
│  └─ Mga regulasyon sa pahinga          │
│                                         │
│  3️⃣ Pangangailangan sa Operasyon       │
│  ├─ Manpower sa peak hours             │
│  ├─ Pag-adjust sa off-peak             │
│  └─ Alokasyon para sa special events   │
│                                         │
│  4️⃣ Pagkontrol ng Gastos               │
│  ├─ Pag-minimize ng overtime pay       │
│  ├─ Pag-optimize ng manpower cost      │
│  └─ Pag-maximize ng efficiency         │
│                                         │
└─────────────────────────────────────────┘
```

### Pagtuklas ng Salungatan sa Iskedyul

Awtomatikong tinutuklas ng sistema ang mga sumusunod na salungatan:

```
⚠️ Mga Uri ng Salungatan sa Iskedyul:

1. Duplicate scheduling sa parehong oras
   └─ Awtomatikong nagpapakita ng alerto at red highlight

2. Lumampas sa maximum na oras bawat linggo
   └─ Nagpapakita ng babala at mungkahi sa pag-adjust

3. Masyadong mahaba ang sunod-sunod na araw ng trabaho
   └─ Nagmumungkahi ng day-off

4. Salungatan sa leave application
   └─ Awtomatikong hindi isinasama ang nag-leave na empleyado

5. Kulang sa manpower requirement
   └─ Nagpapaalala na punan ang kulang sa tao
```

---

## 🏖️ Pamamahala ng Leave

> **Development Progress**: Kumpleto ang Design
> **Status**: Naghihintay ng Implementation

### Arkitektura ng Leave System

```
┌─────────────────────────────────────────────────────┐
│ Daloy ng Pamamahala ng Leave                        │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Empleyado ay nagsumite ng leave application        │
│         ↓                                           │
│  May-ari ay nakatanggap ng notification             │
│         ↓                                           │
│  Pag-review ng leave application                    │
│    ├─ Aprubahan → I-update ang iskedyul           │
│    └─ Tanggihan → Abisuhan at ipaliwanag          │
│         ↓                                           │
│  Sistema ay awtomatikong mag-adjust ng schedule     │
│         ↓                                           │
│  Ibawas ang vacation/leave quota                    │
│         ↓                                           │
│  Gumawa ng leave record                             │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Pag-set up ng Uri ng Leave

Pumunta sa: **Pamamahala ng Leave → Mga Setting ng Uri ng Leave**

```
┌─────────────────────────────────────────┐
│ Pamamahala ng Uri ng Leave              │
├─────────────────────────────────────────┤
│                                         │
│  🏖️ Vacation Leave (Annual Leave)      │
│  ├─ Advance notice: 3 araw             │
│  ├─ Taunang quota: 7-14 araw (base sa tenure)│
│  └─ May kaltas ba sa sahod: Hindi      │
│                                         │
│  🤒 Sick Leave                          │
│  ├─ Advance notice: Pwedeng same day   │
│  ├─ Taunang quota: 30 araw             │
│  └─ May kaltas ba sa sahod: Hindi (unang 30 araw)│
│                                         │
│  👨‍👩‍👧 Personal/Emergency Leave         │
│  ├─ Advance notice: 1 araw             │
│  ├─ Taunang quota: 14 araw             │
│  └─ May kaltas ba sa sahod: Oo         │
│                                         │
│  💑 Marriage Leave                      │
│  ├─ Advance notice: 7 araw             │
│  ├─ Lifetime quota: 8 araw             │
│  └─ May kaltas ba sa sahod: Hindi      │
│                                         │
│  👶 Maternity/Paternity Leave           │
│  ├─ Advance notice: 14 araw            │
│  ├─ Quota: 56 araw / 7 araw            │
│  └─ May kaltas ba sa sahod: Hindi      │
│                                         │
│  [Magdagdag ng Uri]  [I-edit]  [I-disable]│
│                                         │
└─────────────────────────────────────────┘
```

### Pag-apruba ng Leave Application

Pumunta sa: **Pamamahala ng Leave → Pending Applications**

```
┌─────────────────────────────────────────┐
│ Mga Pending na Leave Application        │
├─────────────────────────────────────────┤
│                                         │
│  【Application #001】                   │
│  Empleyado: Zhang (Kusinero)            │
│  Uri ng Leave: Vacation Leave           │
│  Petsa: 2025-11-05 ~ 2025-11-07 (3 araw)│
│  Dahilan: Pamilyang bakasyon            │
│  Petsa ng aplikasyon: 2025-10-26 10:30  │
│                                         │
│  【System Check】                       │
│  ✅ Natitirang vacation quota: 7 araw  │
│  ✅ Advance notice: 10 araw (qualified) │
│  ⚠️ May 1 kusinero na nag-leave na sa dates na yan│
│                                         │
│  Review comments: _______________       │
│                                         │
│  [Aprubahan]  [Tanggihan]  [Humingi ng clarification]│
│                                         │
└─────────────────────────────────────────┘
```

### Pagcheck ng Leave Quota ng Empleyado

Pumunta sa: **Pamamahala ng Leave → Quota Management**

```
┌─────────────────────────────────────────────────────┐
│ Overview ng Leave Quota ng Empleyado                │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Empleyado: Zhang (Kusinero) | Tenure: 3 taon      │
│                                                     │
│  【Leave Quota ngayong Taon】                       │
│                                                     │
│  Vacation: ████████░░░░  Ginamit 8 / Total 14 araw │
│  Sick:     ██░░░░░░░░░░  Ginamit 2 / Total 30 araw │
│  Personal: ░░░░░░░░░░░░  Ginamit 0 / Total 14 araw │
│                                                     │
│  【Leave History】                                  │
│  2025-08-15 ~ 2025-08-16  Vacation  2 araw  (Pamilya)│
│  2025-09-20 ~ 2025-09-23  Vacation  4 araw  (Visit) │
│  2025-10-10              Sick      1 araw  (Sipon)  │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Mga Ulat Estadistika ng Leave

Pumunta sa: **Pamamahala ng Leave → Mga Ulat Estadistika**

```
┌───────────────────────────────────────────────┐
│ Leave Statistics ngayong Buwan (2025-10)     │
├───────────────────────────────────────────────┤
│                                               │
│  Total leave days: 23 araw                    │
│  Total employees na nag-leave: 12 tao        │
│                                               │
│  Distribution ng Uri ng Leave:                │
│  ████████████░░░░░░ Vacation (15 araw, 65%)  │
│  ████░░░░░░░░░░░░░░ Sick (5 araw, 22%)       │
│  ██░░░░░░░░░░░░░░░░ Personal (3 araw, 13%)   │
│                                               │
│  Empleyado na pinaka-maraming leave:          │
│  1. Li (Server) (5 araw)                     │
│  2. Zhang (Kusinero) (4 araw)                │
│  3. Wang (Cashier) (3 araw)                  │
│                                               │
└───────────────────────────────────────────────┘
```

---

## 📊 Pagsusuri ng Negosyo

### Overview ng Analytics Dashboard

Pumunta sa: **Pagsusuri ng Negosyo → Dashboard**

```
┌───────────────────────────────────────────────────────┐
│ Business Analytics Dashboard          [2025-10-26]   │
├───────────────────────────────────────────────────────┤
│                                                       │
│  【Real-time Data Ngayon】                           │
│                                                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│  │ Revenue   │  │ Orders    │  │ Avg Check │          │
│  │ ₱12,450  │  │ 42 orders│  │ ₱296     │          │
│  │ ↑ +15%   │  │ ↑ +8%    │  │ ↑ +7%    │          │
│  └──────────┘  └──────────┘  └──────────┘          │
│                                                       │
│  【Trend ngayong Linggo】                            │
│                                                       │
│  Trend ng Revenue:                                    │
│  ₱15k ┤                            ⬤                │
│  ₱12k ┤            ⬤         ⬤                      │
│  ₱9k  ┤      ⬤         ⬤                            │
│  ₱6k  ┤ ⬤                                            │
│       └────────────────────────────                 │
│        Lun   Mar   Miy   Huw   Biy   Sab            │
│                                                       │
└───────────────────────────────────────────────────────┘
```

### Pagsusuri ng Revenue

Pumunta sa: **Pagsusuri ng Negosyo → Mga Ulat ng Revenue**

#### Pagsusuri ayon sa Oras

```
┌───────────────────────────────────────────────┐
│ Revenue Analysis by Time Period (Ngayong Buwan)│
├───────────────────────────────────────────────┤
│                                               │
│  Almusal (08:00-11:00)                        │
│  ████░░░░░░░░░░░░░░ ₱12,500 (12%)           │
│                                               │
│  Tanghalian (11:00-14:00)                     │
│  ███████████████░░░░ ₱45,800 (45%)          │
│                                               │
│  Merienda (14:00-17:00)                       │
│  ████████░░░░░░░░░░ ₱15,200 (15%)           │
│                                               │
│  Hapunan (17:00-21:00)                        │
│  ████████████░░░░░░ ₱28,500 (28%)           │
│                                               │
│  Pinakamahusay na oras: Tanghalian (11:00-14:00) 💰│
│  Mungkahi: Pataas ang revenue sa almusal 📈  │
│                                               │
└───────────────────────────────────────────────┘
```

#### Paghahambing ng Buwanan

```
┌───────────────────────────────────────────────┐
│ Monthly Revenue Comparison                    │
├───────────────────────────────────────────────┤
│                                               │
│  Trend ng Revenue taong 2025:                 │
│                                               │
│  ₱120k ┤                          ⬤          │
│  ₱100k ┤              ⬤     ⬤                │
│  ₱80k  ┤        ⬤                             │
│  ₱60k  ┤   ⬤                                  │
│        └──────────────────────────           │
│         Hul  Ago  Set  Okt  Nob              │
│                                               │
│  Growth trend: ↗ Stable na pagtaas           │
│  Month-on-month: +12%                         │
│  Year-on-year: +28%                           │
│                                               │
└───────────────────────────────────────────────┘
```

### Pagsusuri ng Pagbebenta ng Menu Items

Pumunta sa: **Pagsusuri ng Negosyo → Menu Analysis**

```
┌───────────────────────────────────────────────────────┐
│ Best-Selling Menu Items (Ngayong Buwan)               │
├───────────────────────────────────────────────────────┤
│                                                       │
│  Rank  Item Name         Quantity  Revenue   Share   │
│  ────────────────────────────────────────────────    │
│  🥇   Seafood Fried Rice   287    ₱51,660   18%     │
│  🥈   Fried Tofu           245    ₱19,600   7%      │
│  🥉   Winter Melon Tea     423    ₱12,690   4%      │
│  4    Three-Cup Chicken    198    ₱39,600   14%     │
│  5    Oyster Omelette      176    ₱26,400   9%      │
│                                                       │
│  【Insights】                                        │
│  • Seafood Fried Rice ay absolute star product      │
│  • Winter Melon Tea ay mataas ang sales pero mababa │
│    ang presyo, isaalang-alang ang iba pang inumin   │
│  • Three-Cup Chicken ay mataas ang revenue, pwedeng │
│    gawing featured item                              │
│                                                       │
└───────────────────────────────────────────────────────┘
```

#### Pagsusuri ng Slow-Moving Items

```
┌───────────────────────────────────────────────┐
│ Slow-Moving Items (Buwanang sales < 10)       │
├───────────────────────────────────────────────┤
│                                               │
│  Item Name            Qty    Mungkahi        │
│  ────────────────────────────────────         │
│  Braised Lion's Head   5     Alisin o baguhin│
│  Cold Wood Ear Salad   3     Adjust price o promo│
│  Taro Sago Dessert     8     Summer season lang│
│                                               │
└───────────────────────────────────────────────┘
```

### Pagsusuri ng Table Turnover Rate

Pumunta sa: **Pagsusuri ng Negosyo → Pagsusuri ng Mesa**

```
┌───────────────────────────────────────────────┐
│ Pagsusuri ng Efficiency ng Paggamit ng Mesa  │
├───────────────────────────────────────────────┤
│                                               │
│  Mesa    Turnover Ngayon    Avg Dining Time  │
│  ─────────────────────────────────────       │
│  A1      5 times            45 min  ⭐⭐⭐  │
│  A2      6 times            38 min  ⭐⭐⭐⭐│
│  A3      3 times            62 min  ⭐⭐    │
│  B1      4 times            50 min  ⭐⭐⭐  │
│                                               │
│  【Rating ng Efficiency】                     │
│  ⭐⭐⭐⭐⭐ Excellent (< 40 min)            │
│  ⭐⭐⭐⭐   Good (40-50 min)                │
│  ⭐⭐⭐     Average (50-60 min)             │
│  ⭐⭐       Needs improvement (> 60 min)    │
│                                               │
│  Mga Mungkahi:                                │
│  • Mesa A3 ay masyadong matagal, suriin ang  │
│    service process                            │
│  • Mesa A2 ay napakahusay, gawin itong benchmark│
│                                               │
└───────────────────────────────────────────────┘
```

### Pagsusuri ng Customer Behavior

Pumunta sa: **Pagsusuri ng Negosyo → Customer Analysis**

```
┌───────────────────────────────────────────────┐
│ Pagsusuri ng Behavior ng Customer            │
├───────────────────────────────────────────────┤
│                                               │
│  【Customer Structure】                       │
│                                               │
│  Bagong Customer: ██████░░░░ 28% (145 tao)   │
│  Returning:       ███████████ 52% (270 tao)  │
│  VIP:             █████░░░░░ 20% (104 tao)   │
│                                               │
│  【Consumption Frequency】                    │
│                                               │
│  3+ beses/linggo: ████░░░░░░ 15%             │
│  1-2 beses/linggo:████████░░ 35%             │
│  1-3 beses/buwan: ██████████ 40%             │
│  Paminsan-minsan: ██░░░░░░░░ 10%             │
│                                               │
│  【Customer Retention】                       │
│  30-day retention: 68%  ⭐⭐⭐⭐              │
│  60-day retention: 52%  ⭐⭐⭐                │
│  90-day retention: 45%  ⭐⭐⭐                │
│                                               │
└───────────────────────────────────────────────┘
```

---

## 🤖 AI Intelligent Analysis

> **Status ng Feature**: Backend complete, Frontend UI live na
> **Supported Models**: OpenAI, Anthropic, Google Gemini, Groq

### Arkitektura ng AI Analysis System

```
┌─────────────────────────────────────────────────────┐
│ AI Analysis Engine                                  │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Data Collection Layer                              │
│  ├─ Order data                                     │
│  ├─ Menu sales data                                │
│  ├─ Customer behavior data                         │
│  └─ Operations efficiency data                     │
│         ↓                                           │
│  AI Analysis Layer                                  │
│  ├─ Sales trend prediction                         │
│  ├─ Menu optimization recommendations              │
│  ├─ Customer preference analysis                   │
│  └─ Operations efficiency suggestions              │
│         ↓                                           │
│  Insights Report Layer                              │
│  └─ Generate actionable recommendations            │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Pag-set up ng AI Model

Pumunta sa: **Settings → AI Analysis Settings**

```
┌─────────────────────────────────────────┐
│ Pag-configure ng AI Analysis Model      │
├─────────────────────────────────────────┤
│                                         │
│  Pumili ng AI Provider:                 │
│  ○ OpenAI (GPT-4)                      │
│  ○ Anthropic (Claude)                  │
│  ○ Google (Gemini Pro)                 │
│  ○ Groq (Llama 3)                      │
│                                         │
│  API Key: ********************          │
│                                         │
│  Analysis Frequency:                    │
│  ○ Araw-araw na automatic analysis     │
│  ○ Lingguhang automatic analysis       │
│  ○ Manual trigger lang                 │
│                                         │
│  Saklaw ng Analysis:                    │
│  □ Sales analysis                      │
│  □ Menu optimization                   │
│  □ Customer insights                   │
│  □ Operations suggestions              │
│                                         │
│  [I-save ang Settings]  [Test Connection]│
│                                         │
└─────────────────────────────────────────┘
```

### AI Insights Report

Pumunta sa: **AI Analysis → Insights Report**

```
┌───────────────────────────────────────────────────────┐
│ AI Intelligent Insights Report       [2025-10-26]    │
├───────────────────────────────────────────────────────┤
│                                                       │
│  【Sales Trend Prediction】🔮                        │
│                                                       │
│  Base sa data ng nakaraang 90 araw, AI prediction:   │
│                                                       │
│  Predicted revenue next week: ₱85,000 - ₱92,000     │
│  Confidence level: ⭐⭐⭐⭐⭐ (92%)                 │
│                                                       │
│  Basis ng prediction:                                 │
│  • Patuloy na pagtaas ng revenue recently            │
│  • Weather forecast ay maganda, mas maraming tao    │
│    ang kakain sa labas                               │
│  • Walang malaking event next week, stable pattern  │
│                                                       │
│  ────────────────────────────────────────────        │
│                                                       │
│  【Menu Optimization Recommendations】🍽️             │
│                                                       │
│  📈 Recommended to promote:                          │
│  • "Three-Cup Chicken" - Mataas ang profit (42%)    │
│    pero 15% lang ang order rate                      │
│    Suggestion: Gumawa ng magandang photo, ilagay    │
│    sa featured section ng menu                       │
│                                                       │
│  • "Seafood Soup Noodles" - Cost down 20%, pwede   │
│    pataasan ang profit                               │
│    Suggestion: Adjust pricing from ₱150 to ₱165     │
│                                                       │
│  📉 Recommended to adjust:                           │
│  • "Braised Lion's Head" - Mababa ang sales (5/mo)  │
│    Suggestion: Temporary removal, o improve recipe   │
│                                                       │
│  ────────────────────────────────────────────        │
│                                                       │
│  【Customer Behavior Insights】👥                    │
│                                                       │
│  High-value customer characteristics:                │
│  • Prefers lunch time (12:00-13:30)                 │
│  • Average stay: 55 minutes                          │
│  • Usually orders "combo meals"                      │
│  • High chance of ordering drinks and desserts      │
│                                                       │
│  Recommended actions:                                │
│  • Launch "Business Lunch Set" for lunchtime        │
│  • Design "Meal+Drink+Dessert" combo deals          │
│  • Improve lunch service speed for business clients │
│                                                       │
│  ────────────────────────────────────────────        │
│                                                       │
│  【Operations Efficiency Suggestions】⚡              │
│                                                       │
│  Manpower allocation optimization:                   │
│  • Friday dinner (18:00-20:00) kulang lagi sa tao  │
│    Suggestion: +1 chef + 1 server                    │
│                                                       │
│  • Wednesday lunch (12:00-14:00) sobra ang tao      │
│    Suggestion: -1 server, reduce manpower cost       │
│                                                       │
│  Expected benefits:                                  │
│  • Save manpower cost: ₱4,500/month                 │
│  • Improve service quality, less complaints         │
│  • Increase employee satisfaction                   │
│                                                       │
└───────────────────────────────────────────────────────┘
```

### Real-time AI Assistant

Pumunta sa: **AI Analysis → Smart Assistant**

```
┌─────────────────────────────────────────┐
│ AI Smart Assistant 💬                   │
├─────────────────────────────────────────┤
│                                         │
│  Ikaw: Bakit mas mababa ang revenue    │
│        ngayon kumpara kahapon?          │
│                                         │
│  AI: Base sa data analysis, mas mababa  │
│      ang revenue ngayon dahil sa 3     │
│      pangunahing dahilan:               │
│                                         │
│      1. Ngayon ay Wednesday, historical│
│         data shows na Wednesday revenue│
│         ay average 12% lower than Tuesday│
│                                         │
│      2. Umuulan ngayon, nabawasan ang  │
│         customers na kumakain sa labas │
│         ng around 15-20%                │
│                                         │
│      3. Lunch period ngayon (main      │
│         revenue period) ay 8 orders    │
│         kulang vs average               │
│                                         │
│      Suggestion: Launch "delivery      │
│      discount" sa rainy days para      │
│      compensate sa bawas na dine-in    │
│                                         │
│  [Send]  [Clear Conversation]          │
│                                         │
└─────────────────────────────────────────┘
```

### Competitor Analysis

Pumunta sa: **AI Analysis → Competitor Analysis**

```
┌───────────────────────────────────────────────┐
│ Pagsusuri ng Nearby Competitors               │
├───────────────────────────────────────────────┤
│                                               │
│  Analysis scope: 1km radius, same type        │
│  Data source: Public reviews, social media    │
│                                               │
│  【Competitor Overview】                      │
│                                               │
│  Delicious Seafood Restaurant (300m)          │
│  ├─ Rating: ⭐⭐⭐⭐ 4.2/5.0                │
│  ├─ Price: $$$ (slightly higher than you)    │
│  ├─ Strengths: Fresh seafood, nice ambiance  │
│  └─ Weaknesses: High price, long wait time   │
│                                               │
│  Traditional Snack Shop (150m)                │
│  ├─ Rating: ⭐⭐⭐ 3.8/5.0                  │
│  ├─ Price: $ (budget-friendly)               │
│  ├─ Strengths: Low price, fast service       │
│  └─ Weaknesses: Basic environment, few choices│
│                                               │
│  【Your Position】                            │
│  Rating: ⭐⭐⭐⭐⭐ 4.7/5.0                  │
│  Price: $$ (mid-range)                        │
│  Strengths: Good value, quality service       │
│                                               │
│  【AI Recommendations】                       │
│  • Keep your value-for-money advantage       │
│  • Consider "daily seafood special" to       │
│    compete with seafood restaurant           │
│  • Maintain current pricing strategy to      │
│    differentiate from budget shops           │
│                                               │
└───────────────────────────────────────────────┘
```

---

## ❓ Mga Madalas Itanong (FAQ)

### Tungkol sa Login

**Q: Nakalimutan ko ang login password, ano gagawin?**

```
Step 1: I-click ang "Forgot Password" sa login page
   ↓
Step 2: Ilagay ang registered Email
   ↓
Step 3: Sistema ay magpapadala ng password reset link sa Email
   ↓
Step 4: I-click ang link, set ng bagong password
   ↓
Step 5: Gamitin ang bagong password para mag-login
```

**Q: Pwede bang multiple users ang mag-login sa same account?**

A: Oo, pwede. Ang shop owner account ay supports multiple device login, convenient para sa office at pag-manage habang wala sa shop.

---

### Tungkol sa Menu

**Q: Paano mag-update ng menu item prices nang mabilis?**

```
Method 1: Single item
  Menu Management → Select item → Edit price

Method 2: Batch update
  Menu Management → Batch Operations → Select items → Uniform price change
```

**Q: Paano i-set ang temporarily out-of-stock items?**

A: Pumunta sa **Menu Management → Select item → Change status to "Temporarily Out of Stock"**. Sistema ay automatic na mag-mark ng "Sold Out Today" sa menu, pero hindi matatanggal ang item info.

**Q: Pwede bang mag-set ng limited-time available items?**

A: Oo, pwede. Pumunta sa **Menu Management → Edit Item → Serving Time Settings**, halimbawa set na "Breakfast Congee" ay available lang from 08:00-11:00.

---

### Tungkol sa QR Code

**Q: Nasira ang QR code, ano gagawin?**

```
Step 1: Pumunta sa QR Code Management
   ↓
Step 2: Hanapin ang QR code
   ↓
Step 3: I-click ang "Regenerate"
   ↓
Step 4: I-download ang bagong QR code
   ↓
Step 5: I-print at i-post
   ↓
Note: Luma na QR code ay automatic na invalid
```

**Q: Pwede bang customize ang appearance ng QR code?**

A: Oo. Pumunta sa **QR Code Management → Design Templates**, pwedeng piliin:

- Plain QR code (black & white)
- Branded style (with Logo and colors)
- Instructional style (with usage instructions text)

**Q: Customer scanned QR code pero may error message?**

Possible reasons:

1. QR code ay na-regenerate na (old code invalid)
2. Restaurant ay temporarily closed
3. Table ay disabled na

Solution:

- Confirm na QR code status ay "Active"
- Check restaurant operating status
- Regenerate at post new QR code

---

### Tungkol sa Orders

**Q: Paano mag-handle ng customer request to cancel order?**

```
Step 1: Pumunta sa Order Details page
   ↓
Step 2: I-click ang "Cancel Order" button
   ↓
Step 3: Select cancellation reason
   ├─ Customer request
   ├─ Insufficient ingredients
   ├─ Kitchen too busy
   └─ Other reasons
   ↓
Step 4: Fill refund amount (kung may refund)
   ↓
Step 5: Confirm cancellation
   ↓
Sistema ay automatic na mag-notify sa customer
```

**Q: Maraming orders, hindi makapag-process, ano gagawin?**

Recommended handling:

1. **Pause orders**: Pumunta sa **Restaurant Settings → Pause Orders**, temporary close online ordering
2. **Extend prep time**: Sa order page adjust estimated completion time, para aware customers na kailangan maghintay
3. **Add staff**: Temporary call additional chef or server

**Q: Paano mag-view ng historical orders?**

Pumunta sa **Order Management → Order History**, pwedeng mag-filter by date, table, status, etc.

---

### Tungkol sa Employees

**Q: Paano mag-reset ng employee password?**

```
Method 1: Owner reset
  Employee Management → Select employee → Reset password → Notify employee

Method 2: Employee self-reset
  Login page → Forgot password → Enter Email → Receive reset link
```

**Q: Employee resigned, paano i-handle ang account?**

Recommended approach:

1. Pumunta sa **Employee Management → Select employee → Disable account** (hindi recommended na delete, para retain historical records)
2. Sistema ay mag-keep ng employee work records (orders, schedules, etc.)
3. Employee ay hindi na makakapag-login sa system

**Q: Pwede bang i-restrict ang employee login sa specific times lang?**

A: Hindi pa supported ang feature na ito, pero pwedeng gamitin ang "Schedule Management" at "Attendance Records" para monitor employee login times.

---

### Tungkol sa Payment

**Q: Paano mag-process ng checkout?**

MakanMakan currently supports offline payment:

```
Customer finished dining
   ↓
Go to counter para mag-checkout
   ↓
Owner/Cashier find order sa system
   ↓
Click "Checkout" button
   ↓
Select payment method:
├─ Cash
├─ Credit Card
├─ Mobile payment (GCash, PayMaya, etc.)
└─ Others
   ↓
Enter received amount
   ↓
Print receipt (optional)
   ↓
Complete checkout
```

**Q: Pwede bang mag-offer ng discount?**

A: Oo, pwede. Sa checkout page:

1. I-click ang "Apply Discount"
2. Select discount type:
   - Percentage discount (e.g., 10% off)
   - Fixed amount discount (e.g., ₱50 off)
3. Fill discount reason
4. Confirm at complete checkout

---

### Tungkol sa System

**Q: Anong devices ang supported ng system?**

```
✅ Desktop (recommended)
├─ Windows 10/11
├─ macOS
└─ Linux

✅ Tablets
├─ iPad
└─ Android tablets

✅ Mobile phones (viewing functions)
├─ iPhone
└─ Android phones
```

**Q: Kailangan ba ng software installation?**

A: Hindi. MakanMakan ay web-based system, kailangan lang ng browser at internet connection.

Recommended browsers:

- Google Chrome (recommended)
- Microsoft Edge
- Safari
- Firefox

**Q: Pag nawala ang internet connection, ano mangyayari?**

```
Pag nawala internet:
├─ Sistema ay mag-display ng "Offline Mode" warning
├─ Pwede pa rin tingnan ang loaded data
└─ Hindi makakatanggap ng new orders

Pag bumalik internet:
└─ Sistema ay automatic mag-sync ng data, back to normal
```

**Q: Mawawala ba ang data?**

A: Hindi. MakanMakan uses cloud architecture, lahat ng data ay real-time saved sa Cloudflare global network, with multiple backup mechanisms para ensure data security.

---

### Tungkol sa Financial Reports

**Q: Paano mag-export ng sales reports?**

```
Method 1: Daily report
  Business Analysis → Select date → Export Excel

Method 2: Custom report
  Business Analysis → Custom date range → Select export items → Export

Report includes:
├─ Revenue details
├─ Order details
├─ Menu sales statistics
├─ Customer statistics
└─ Employee work hours
```

**Q: Pwede bang makita ang cost at profit per dish?**

A: Oo. Pumunta sa **Menu Management → Menu List → Cost Analysis**, pwedeng makita:

- Ingredient cost
- Selling price
- Gross profit margin
- Monthly sales volume
- Total profit contribution

---

## 📞 Technical Support

### Makipag-ugnayan sa Amin

```
┌─────────────────────────────────────────┐
│ Kailangan ng Tulong?                    │
├─────────────────────────────────────────┤
│                                         │
│  📧 Email Support                       │
│  support@makanmakan.com                │
│  (24-48 hours response time)           │
│                                         │
│  💬 Online Customer Service             │
│  Weekdays 09:00-18:00                  │
│  Weekends 10:00-17:00                  │
│                                         │
│  📱 Emergency Hotline                   │
│  0800-123-456 (System issues)          │
│  24 hours service                       │
│                                         │
│  📚 Online Documentation                │
│  docs.makanmakan.com                   │
│                                         │
└─────────────────────────────────────────┘
```

### System Status Monitoring

Real-time view ng system status: `status.makanmakan.com`

```
System Status Monitoring Dashboard

┌─────────────────────────────────────────┐
│ Lahat ng Systems Operational ✅         │
├─────────────────────────────────────────┤
│                                         │
│  API Service:     ✅ Normal             │
│  Database:        ✅ Normal             │
│  Image Service:   ✅ Normal             │
│  Real-time Comms: ✅ Normal             │
│                                         │
│  Response time:   85ms (excellent)     │
│  Service uptime:  99.98%               │
│                                         │
└─────────────────────────────────────────┘
```

---

## 🎯 Mga Susunod na Hakbang

### Recommended Flow para sa Bagong Shop Owners

```
Week 1: Basic Setup
  ├─ Complete restaurant basic information
  ├─ Create menu at upload images
  └─ Setup tables at generate QR codes

Week 2: Trial Operations
  ├─ Invite family/friends to test ordering
  ├─ Add employee accounts at training
  └─ Adjust menu at prices

Week 3: Official Launch
  ├─ Start accepting customer orders
  ├─ Monitor order flow
  └─ Collect customer feedback

Week 4: Optimization
  ├─ Analyze sales reports
  ├─ Review AI recommendations
  └─ Adjust menu at operations strategy
```

### Advanced Features to Explore

Pag familiar ka na sa basic operations, pwede mong i-explore ang advanced features:

```
✨ Advanced Features Checklist

□ Setup member points system
□ Create voucher campaigns
□ Enable AI intelligent analysis
□ Setup automated scheduling
□ Create employee performance evaluation
□ Integrate with accounting system
□ Setup multi-branch management
```

---

## 📝 Version Update Log

### 2.0.0 (2025-10-26)

- ✨ Brand new shop owner interface
- ✨ AI intelligent analysis live
- ✨ Scheduling system architecture complete
- 🔧 Performance optimization at bug fixes

### 1.5.0 (2025-10-12)

- ✨ Multi-language support (6 languages)
- ✨ Seat-level QR code feature
- 🔧 Enhanced password security

### 1.0.0 (2025-09-01)

- 🎉 MakanMakan official launch
- ✨ Basic restaurant management features
- ✨ QR code ordering system
- ✨ Order management system

---

## ✅ Operation Manual Completion Checklist

Congratulations sa pag-complete ng Shop Owner Operation Manual!

```
Learning Progress Check:

□ Naiintindihan na ang system login at basic operations
□ Alam ko na paano mag-setup ng restaurant basic info
□ Alam ko na paano gumawa at mag-manage ng menu
□ Alam ko na paano mag-setup ng tables at generate QR codes
□ Alam ko na paano mag-handle ng orders at checkout
□ Alam ko na paano mag-manage ng employee accounts at permissions
□ Alam ko na paano mag-view ng business analytics reports
□ Naiintindihan ko na ang AI analysis features

Handa ka na bang gumamit ng MakanMakan? 🚀
```

---

**Nawa'y Maging Matagumpay ang Iyong Negosyo! 🎊**

---

_Patuloy na ina-update ang gabay na ito. Para sa mga mungkahi, mangyaring makipag-ugnayan sa amin._
