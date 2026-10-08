# 💰 MakanMakan Gabay para sa Cashier

> **Bersyon**: 2.0
> **Huling Nag-update**: 2025-10-26
> **Target na Audience**: Mga Cashier, Tauhan sa Counter

---

## 📚 Talaan ng Nilalaman

1. [Mabilis na Pagsisimula](#mabilis-na-pagsisimula)
2. [Pangkalahatang Tingin sa Sistema](#pangkalahatang-tingin-sa-sistema)
3. [Interface ng Cashier System](#interface-ng-cashier-system)
4. [Proseso ng Pagbabayad ng Order](#proseso-ng-pagbabayad-ng-order)
5. [Mga Paraan ng Pagbabayad](#mga-paraan-ng-pagbabayad)
6. [Paghawak ng Resibo](#paghawak-ng-resibo)
7. [Mga Refund at Cancellation](#mga-refund-at-cancellation)
8. [Arawang Reconciliation](#arawang-reconciliation)
9. [Mga Query sa Ulat](#mga-query-sa-ulat)
10. [Paghawak ng Exception](#paghawak-ng-exception)
11. [Pamamahala ng Cash](#pamamahala-ng-cash)
12. [Mga Alituntunin sa Seguridad](#mga-alituntunin-sa-seguridad)
13. [FAQ](#faq)

---

## 🚀 Mabilis na Pagsisimula

### Proseso ng Pag-login sa Sistema

```
┌─────────────────────────────────────────────┐
│ Daloy ng Pag-login ng Cashier              │
├─────────────────────────────────────────────┤
│                                             │
│  1️⃣ Buksan ang Cashier System              │
│      ↓                                      │
│  2️⃣ Ilagay ang Cashier Credentials         │
│      ↓                                      │
│  3️⃣ Pinapatunayan ng Sistema ang Permission (Role=4) │
│      ↓                                      │
│  4️⃣ Pumasok sa Cashier Workspace           │
│                                             │
└─────────────────────────────────────────────┘
```

### Checklist sa Pagbubukas ng Araw

✅ **Bago Magbukas ang Negosyo**

- [ ] Mag-login sa cashier system
- [ ] I-verify ang halaga ng cash drawer float
- [ ] Suriin ang supply ng papel ng resibo
- [ ] Kumpirmahin ang koneksyon sa network
- [ ] Repasuhin ang arawang target sa benta

✅ **Habang Bukas ang Negosyo**

- [ ] Bantayan ang mga naghihintay na bayaran
- [ ] Panatilihing organisado ang cash drawer
- [ ] Regular na i-verify ang functionality ng POS
- [ ] Bantayan ang mga kakaibang alerto sa transaksyon

✅ **Pagkatapos ng Oras ng Negosyo**

- [ ] Isagawa ang arawang reconciliation
- [ ] Bilangin ang cash at ihambing sa mga talaan
- [ ] I-print ang arawang settlement report
- [ ] Ideposito ang cash sa safe
- [ ] Mag-logout sa sistema

---

## 🏢 Pangkalahatang Tingin sa Sistema

### Saklaw ng Permiso ng Cashier

```
┌─────────────────────────────────────────────────────────┐
│ Mga Available na Function ng Cashier                   │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ✅ Pagbabayad ng Order  ✅ Pagproseso ng Bayad        │
│  ✅ Pag-print ng Resibo  ✅ Mga Kahilingan ng Refund   │
│  ✅ Arawang Settlement   ✅ Mga Query sa Ulat          │
│  ✅ Verification ng Halaga ✅ Pag-report ng Exception  │
│                                                         │
│  ❌ Pamamahala ng Menu   ❌ Pamamahala ng Staff        │
│  ❌ Pagbabago ng Presyo  ❌ Mga Setting ng Sistema     │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Diagram ng Workflow

```
┌────────────────────────────────────────────────────────┐
│            Arawang Workflow ng Cashier                 │
├────────────────────────────────────────────────────────┤
│                                                        │
│  Tapos na Kumain ang Customer                          │
│       ↓                                                │
│  Mag-query ng Order ────→ Kumpirmahin ang Detalye     │
│       ↓                                                │
│  Kalkulahin ang Kabuuan ──→ Sabihin sa Customer       │
│       ↓                                                │
│  Pumili ng Paraan ng Bayad ─→ Cash/Card/Iba           │
│       ↓                                                │
│  Kolektahin ang Bayad ────→ I-verify na Tama          │
│       ↓                                                │
│  Tapusin ang Checkout ────→ I-print ang Resibo        │
│       ↓                                                │
│  Ibigay ang Resibo ────→ Magbigay ng Sukli (kung kailangan) │
│       ↓                                                │
│  Magpasalamat sa Customer ────→ Bumalik Muli           │
│                                                        │
└────────────────────────────────────────────────────────┘
```

---

## 💻 Interface ng Cashier System

### Pangunahing Dashboard

```
┌──────────────────────────────────────────────────────────┐
│                   Dashboard ng Cashier System            │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  ┌────────────────┐  ┌────────────────┐               │
│  │  Pending Orders│  │  Benta Ngayon  │               │
│  │    12 Orders   │  │  $25,680       │               │
│  └────────────────┘  └────────────────┘               │
│                                                          │
│  ┌──────────────────────────────────────────┐          │
│  │  Listahan ng Order                       │          │
│  ├──────┬──────┬─────────┬─────────┤          │
│  │ Mesa │ Oras │ Halaga  │ Status  │          │
│  ├──────┼──────┼─────────┼─────────┤          │
│  │  A1  │ 12:35│  $580   │ Pending │ [Checkout]│
│  │  B3  │ 12:42│  $820   │ Pending │ [Checkout]│
│  │  C2  │ 12:50│  $450   │ Pending │ [Checkout]│
│  └──────┴──────┴─────────┴─────────┘          │
│                                                          │
│  [Mabilis na Hanap] [Filter] [Mga Ulat] [Settlement]  │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### Paglalarawan ng Function Button

| Button                           | Function             | Paglalarawan                                   |
| -------------------------------- | -------------------- | ---------------------------------------------- |
| 🔍 **Mabilis na Hanap**          | Maghanap ng Orders   | Maghanap gamit ang mesa, order number, o phone |
| 📋 **Detalye ng Order**          | Tingnan ang Detalye  | Ipakita ang kumpletong nilalaman ng order      |
| 💳 **Checkout**                  | Magproseso ng Bayad  | Pumasok sa daloy ng pagbabayad                 |
| 🧾 **Muling I-print ang Resibo** | Muling I-print       | Muling i-print ang nawala o nasirang resibo    |
| 🔄 **Refund**                    | Magproseso ng Refund | Mag-apply para sa refund ng order              |
| 📊 **Mga Ulat**                  | Mag-query ng Ulat    | Tingnan ang data ng negosyo                    |
| 🔐 **Settlement**                | Arawang Settlement   | Isagawa ang end-of-day reconciliation          |

---

## 🧾 Proseso ng Pagbabayad ng Order

### Mga Hakbang sa Standard na Checkout

#### Hakbang 1: Mag-query ng Order

**Paraan 1: Query gamit ang Numero ng Mesa**

```
1. I-click ang "Mabilis na Hanap"
2. Ilagay ang numero ng mesa (hal., A1, B3)
3. Ipapakita ng sistema ang lahat ng hindi pa bayad na order para sa mesang iyon
4. Kumpirmahin na ito ang order ng customer
```

**Paraan 2: Query gamit ang Order Number**

```
1. Tanungin ang customer ng order number
2. Ilagay ang order number
3. Ipapakita ng sistema ang detalye ng order
4. Kumpirmahin ang nilalaman ng order
```

**Paraan 3: Query gamit ang Phone Number**

```
1. Tanungin kung miyembro ang customer
2. Ilagay ang phone number ng customer
3. Ilista ng sistema ang mga hindi pa bayad na order ng miyembro
4. Tanungin ang customer na kumpirmahin kung aling order ang babayaran
```

---

#### Hakbang 2: Kumpirmahin ang Nilalaman ng Order

```
┌────────────────────────────────────────┐
│ Order #20251026-001                    │
├────────────────────────────────────────┤
│                                        │
│ Mesa: A1          Oras: 12:35          │
│ Customer: Miyembro 0912-345-678        │
│                                        │
│ ────────────────────────────────────  │
│                                        │
│ Mga Item:                              │
│  • Signature Beef Noodles x1   $150   │
│  • Braised Beef Noodles    x1   $160  │
│  • Appetizer Platter       x1   $ 80  │
│  • Pearl Milk Tea          x2   $120  │
│                                        │
│ ────────────────────────────────────  │
│                                        │
│ Subtotal:                      $510    │
│ Service Charge (10%):          $ 51    │
│ ────────────────────────────────────  │
│ Kabuuan:                       $561    │
│                                        │
└────────────────────────────────────────┘
```

**Mga Punto na Susuriin:**

- ✅ I-verify na tama ang dami ng mga item
- ✅ I-verify na tama ang pagkakalkula ng presyo
- ✅ I-verify na naka-apply ang mga espesyal na diskwento
- ✅ I-verify kung applicable ang service charge

---

#### Hakbang 3: Pumili ng Paraan ng Pagbabayad

```
┌────────────────────────────────────────┐
│ Mangyaring Pumili ng Paraan ng Bayad   │
├────────────────────────────────────────┤
│                                        │
│  ┌──────────┐  ┌──────────┐          │
│  │ 💵 Cash  │  │ 💳 Card  │          │
│  └──────────┘  └──────────┘          │
│                                        │
│  ┌──────────┐  ┌──────────┐          │
│  │ 📱 Mobile│  │ 🎫 Voucher│          │
│  └──────────┘  └──────────┘          │
│                                        │
│  ┌──────────────────────────┐        │
│  │    ⚡ Split Payment       │        │
│  └──────────────────────────┘        │
│                                        │
└────────────────────────────────────────┘
```

---

#### Hakbang 4: Magproseso ng Bayad

**Daloy ng Cash Payment:**

```
1️⃣ Sabihin sa customer ang kabuuang halaga
   "Ang kabuuan ay $561"

2️⃣ Tanggapin ang cash
   Nagbayad ang customer: $1,000

3️⃣ Ilagay ang halagang natanggap
   Awtomatikong kakalkulahin ng sistema ang sukli: $439

4️⃣ Kumpirmahin ang halaga at i-click ang "Tapusin ang Bayad"

5️⃣ Ihanda ang sukli
   - $400: 4 × $100 bills
   - $ 30: 3 × $10 barya
   - $  9: 1 × $5 + 4 × $1 barya

6️⃣ Ulitin ang halaga ng sukli
   "Ang sukli mo ay $439, salamat"
```

**Daloy ng Credit Card Payment:**

```
1️⃣ Piliin ang "Credit Card" payment
2️⃣ Ilagay ang halaga ng bayad: $561
3️⃣ Ipasok/i-tap ang credit card
4️⃣ Maghintay para sa authorization...
5️⃣ Ilagay ng customer ang PIN/pumirma
6️⃣ Matagumpay ang transaksyon ✅
7️⃣ I-print ang merchant copy (kailangan ng pirma)
8️⃣ Pumirma ang customer para sa kumpirmasyon
9️⃣ I-file ang nilagdaang resibo
```

**Daloy ng Mobile Payment:**

```
1️⃣ Piliin ang "Mobile Payment"
2️⃣ Piliin ang platform ng pagbabayad
   • LINE Pay
   • Street Payment
   • Apple Pay
   • Google Pay

3️⃣ Ipakita ang QR code ng pagbabayad
4️⃣ I-scan ng customer ang QR code
5️⃣ Maghintay para sa kumpirmasyon ng bayad...
6️⃣ Matagumpay ang bayad ✅
7️⃣ Awtomatikong tapusin ang checkout
```

---

#### Hakbang 5: I-print ang Resibo

```
┌────────────────────────────────────────┐
│          MakanMakan Restaurant         │
│       Tax ID: 12345678                 │
│   Address: No. 7, Xinyi Rd., Taipei   │
│       Phone: (02) 2345-6789            │
│                                        │
├────────────────────────────────────────┤
│                                        │
│ Petsa: 2025/10/26     Oras: 12:45      │
│ Mesa: A1           Cashier: Mary       │
│ Order Number: 20251026-001             │
│                                        │
│ ────────────────────────────────────  │
│                                        │
│ Signature Beef Noodles x1      $150    │
│ Braised Beef Noodles   x1      $160    │
│ Appetizer Platter      x1      $ 80    │
│ Pearl Milk Tea         x2      $120    │
│                                        │
│ ────────────────────────────────────  │
│                                        │
│ Subtotal:                      $510    │
│ Service Charge (10%):          $ 51    │
│ ────────────────────────────────────  │
│ Kabuuan:                       $561    │
│                                        │
│ Paraan ng Bayad: Cash                  │
│ Halagang Natanggap: $1,000             │
│ Sukli: $439                            │
│                                        │
│ ────────────────────────────────────  │
│                                        │
│    Salamat, bumalik kayo!              │
│                                        │
│         MakanMakan.com                 │
│                                        │
└────────────────────────────────────────┘
```

---

#### Hakbang 6: Tapusin ang Transaksyon

```
✅ Checklist ng Panghuling Kumpirmasyon

1. [ ] Naka-print ang resibo
2. [ ] Tama ang halaga ng sukli
3. [ ] Nilagdaan ang resibo ng credit card (kung applicable)
4. [ ] Ibigay ang resibo sa customer
5. [ ] Magalang na magpasalamat sa customer
```

**Standard na Bati:**

```
"Narito ang iyong resibo at $439 sukli,
 pakiingatan po. Salamat sa pagkain sa amin,
 bumalik kayo!"
```

---

## 💳 Mga Paraan ng Pagbabayad

### Cash Payment

#### Mga Alituntunin sa Paghawak ng Cash

```
┌─────────────────────────────────────────────┐
│ Standard na Proseso ng Pagkolekta ng Cash   │
├─────────────────────────────────────────────┤
│                                             │
│  1️⃣ Malinaw na sabihin ang halaga          │
│     "Ang kabuuan ay $561"                   │
│                                             │
│  2️⃣ Kumpirmahin ang natanggap na denominasyon │
│     "Nakatanggap ng $1,000"                 │
│                                             │
│  3️⃣ Ilagay ang bill sa ibabaw ng register (iwasan ang alitan) │
│                                             │
│  4️⃣ Ilagay sa sistema ang halagang natanggap │
│                                             │
│  5️⃣ I-verify na tama ang halaga ng sukli   │
│     Ipinapakita ng sistema: Sukli $439     │
│                                             │
│  6️⃣ Bilangin ang sukli                     │
│     - Malalaking bills muna (hundreds)     │
│     - Tapos ang mga barya (tens, ones)     │
│                                             │
│  7️⃣ Ulitin ang halaga ng sukli             │
│     "Ang sukli mo ay $439"                 │
│                                             │
│  8️⃣ Ilagay ang natanggap na bill sa cash drawer │
│                                             │
└─────────────────────────────────────────────┘
```

#### Deteksyon ng Pekeng Pera

**Mga Punto na Susuriin:**

| Bill         | Paraan ng Pag-verify                                    |
| ------------ | ------------------------------------------------------- |
| 💵 **$1000** | Color-shifting foil, intaglio printing, security thread |
| 💵 **$500**  | Nakatagong "500", plum blossom watermark                |
| 💵 **$100**  | Color-shifting ink, braille dots                        |

**Paghawak ng Kahina-hinalang Bill:**

```
1. Huwag direktang akusahan ang customer
2. Magalang na sabihin: "Pasensya na, mukhang may problema ang bill na ito, pwede bang gumamit ng iba?"
3. Kung mapilit ang customer, hingin ang tulong ng manager
4. Panatilihin ang kahina-hinalang bill, ibigay sa manager o pulis
```

---

### Credit Card Payment

#### Operasyon ng Card Terminal

```
┌─────────────────────────────────────────────┐
│ Daloy ng Credit Card Transaction            │
├─────────────────────────────────────────────┤
│                                             │
│  I-swipe/Ipasok/I-tap ang Card              │
│       ↓                                     │
│  Ilagay ang Halaga ng Transaksyon           │
│       ↓                                     │
│  Maghintay para sa Authorization (5-10 sec) │
│       ↓                                     │
│  ┌──────────┐  ┌──────────┐               │
│  │ Approved │  │ Declined │               │
│  └──────────┘  └──────────┘               │
│       ↓              ↓                      │
│  I-print ang Resibo  Subukan ang Ibang Paraan │
│       ↓                                     │
│  Pumirma ang Customer                       │
│       ↓                                     │
│  I-verify ang Pirma                         │
│       ↓                                     │
│  Tapos na ang Transaksyon ✅               │
│                                             │
└─────────────────────────────────────────────┘
```

#### Paghawak ng Nabigong Transaksyon

| Mensahe ng Error            | Sanhi                        | Solusyon                                                         |
| --------------------------- | ---------------------------- | ---------------------------------------------------------------- |
| ❌ **Insufficient Funds**   | Lumagpas sa credit limit     | Tanungin ang customer na gumamit ng ibang card o paraan ng bayad |
| ❌ **Card Expired**         | Lampas na ang petsa ng card  | Gumamit ng valid na card                                         |
| ❌ **Transaction Declined** | Tumanggi ang bangko          | Magrekomenda na kontakin ang nagbigay na bangko o ibang paraan   |
| ❌ **Connection Failed**    | May problema sa network      | Ulitin ang card o gumamit ng cash                                |
| ❌ **Card Read Error**      | Sira ang magnetic strip/chip | Linisin ang card at ulitin o gumamit ng ibang card               |

---

### Mobile Payment

#### Mga Suportadong Platform ng Pagbabayad

```
┌─────────────────────────────────────────┐
│ MakanMakan Suportadong Mobile Payments  │
├─────────────────────────────────────────┤
│                                         │
│  📱 LINE Pay          ✅ Suportado      │
│  📱 Street Pay        ✅ Suportado      │
│  📱 Apple Pay         ✅ Suportado      │
│  📱 Google Pay        ✅ Suportado      │
│  📱 EasyCard Pay      ✅ Suportado      │
│  📱 Taiwan Pay        ✅ Suportado      │
│                                         │
└─────────────────────────────────────────┘
```

#### Daloy ng QR Code Payment

```
1️⃣ Piliin ang "Mobile Payment" sa cashier system
2️⃣ Piliin ang platform ng pagbabayad ng customer
3️⃣ Gumawa ang sistema ng QR code ng pagbabayad
4️⃣ Buksan ng customer ang mobile app para i-scan ang QR code
5️⃣ Kumpirmahin ng customer ang halaga at tapusin ang bayad
6️⃣ Makatanggap ang sistema ng notification ng bayad (3-5 sec)
7️⃣ Ipakita ang "Matagumpay ang Bayad" ✅
8️⃣ Awtomatikong i-print ang resibo
```

---

### Split Payment

Kapag gumamit ang customer ng maraming paraan ng pagbabayad:

```
Halimbawa: Kabuuang halaga $1,200

Gusto ng customer na gumamit ng:
  • Voucher: $500
  • Credit Card: Natitirang halaga

Pamamaraan:
1️⃣ Piliin ang "Split Payment"
2️⃣ Iproseso muna ang voucher
   - Piliin ang "Voucher"
   - Ilagay o i-scan ang numero ng voucher
   - I-validate at ibawas ng sistema ang $500

3️⃣ Ipapakita ng sistema ang natitirang halaga: $700
4️⃣ Iproseso ang natitirang halaga
   - Piliin ang "Credit Card"
   - I-charge ang $700 sa card

5️⃣ Tapos na ang transaksyon ✅
```

---

## Paghawak ng Resibo

Sa kasalukuyan, resibo ang ini-print ng sistema at hindi ito nag-iisyu ng elektronikong invoice. Ang bawat tindahan ay humahawak ng mga invoice gamit ang dati nitong proseso.

---

## 🔄 Mga Refund at Cancellation

### Patakaran sa Refund

```
┌─────────────────────────────────────────────┐
│ Patakaran sa Refund ng MakanMakan           │
├─────────────────────────────────────────────┤
│                                             │
│  ✅ Mga Kaso ng Buong Refund:               │
│     • Hindi pa inihanda ang pagkain        │
│     • May problema sa kalidad ng pagkain   │
│     • Maling pagkain ang inilabas          │
│     • Malubhang pagkabigo sa serbisyo      │
│                                             │
│  ⚠️ Mga Kaso ng Partial Refund:             │
│     • May problema sa ilang item           │
│     • Hindi magandang karanasan sa pagkain │
│                                             │
│  ❌ Mga Kaso ng Walang Refund:              │
│     • Nakain na ang pagkain                │
│     • Personal na panlasa lamang            │
│     • Lampas na sa deadline ng refund      │
│                                             │
└─────────────────────────────────────────────┘
```

---

### Daloy ng Pagproseso ng Refund

```
┌─────────────────────────────────────────────┐
│ Standard na Pamamaraan ng Refund            │
├─────────────────────────────────────────────┤
│                                             │
│  Humingi ng Refund ang Customer             │
│       ↓                                     │
│  Maintindihan ang Dahilan ng Refund         │
│       ↓                                     │
│  Suriin kung Sumusunod sa Patakaran         │
│       ↓                                     │
│  ┌──────────┐  ┌──────────┐               │
│  │Sumusunod  │  │Hindi     │               │
│  │sa Patakaran│ │Karapat-  │               │
│  │           │  │dapat     │               │
│  └──────────┘  └──────────┘               │
│       ↓              ↓                      │
│  Sabihan ang Manager Magalang na Ipaliwanag │
│  para sa Approval    at Humingi ng Paumanhin│
│       ↓                                     │
│  Nag-approve ang Manager                    │
│       ↓                                     │
│  Mag-apply ng Refund sa Sistema             │
│       ↓                                     │
│  I-refund gamit ang Orihinal na Paraan      │
│       ↓                                     │
│  I-print ang Resibo ng Refund               │
│       ↓                                     │
│  Pumirma ang Customer ng Kumpirmasyon       │
│       ↓                                     │
│  Tapos na ang Refund ✅                    │
│                                             │
└─────────────────────────────────────────────┘
```

---

### Pagproseso ng Paraan ng Refund

#### Cash Refund

```
1️⃣ Kumpirmahin na cash payment ang orihinal na order
2️⃣ Kalkulahin ang halaga ng refund
3️⃣ Kumuha ng cash mula sa drawer
4️⃣ Ulitin ang halaga ng refund
5️⃣ Ibigay ang cash sa customer
6️⃣ Bilangin ng customer at pumirma ng kumpirmasyon
7️⃣ Tapusin ang talaan ng refund sa sistema
```

#### Credit Card Refund

```
1️⃣ Kumpirmahin na credit card payment ang orihinal na order
2️⃣ Piliin ang "Credit Card Refund"
3️⃣ Awtomatikong basahin ng sistema ang orihinal na data ng transaksyon
4️⃣ Ilagay ang halaga ng refund
5️⃣ Isagawa ng card terminal ang transaksyon ng refund
6️⃣ Maghintay para sa authorization ng bangko (5-10 sec)
7️⃣ Matagumpay ang refund ✅
8️⃣ I-print ang resibo ng refund
9️⃣ Sabihan ang customer: "Ang refund ay lalabas sa inyong account sa loob ng 3-7 na araw ng negosyo"
```

#### Mobile Payment Refund

```
1️⃣ Piliin ang "Mobile Payment Refund"
2️⃣ Piliin ang orihinal na platform ng pagbabayad
3️⃣ Ilagay ang halaga ng refund
4️⃣ Awtomatikong isagawa ng sistema ang refund
5️⃣ Matagumpay ang refund ✅
6️⃣ Sabihan ang customer: "Ang refund ay ibabalik sa inyong account kaagad"
```

---

### Halimbawa ng Resibo ng Refund

```
┌────────────────────────────────────────┐
│         Resibo ng Refund ng MakanMakan │
├────────────────────────────────────────┤
│                                        │
│ Petsa: 2025/10/26    Oras: 14:30       │
│ Orihinal na Order: 20251026-001        │
│ Dahilan ng Refund: Problema sa kalidad │
│                    ng pagkain          │
│                                        │
│ ────────────────────────────────────  │
│                                        │
│ Orihinal na Halaga:       $561         │
│ Halaga ng Refund:         $561         │
│ Paraan ng Refund:         Cash         │
│                                        │
│ ────────────────────────────────────  │
│                                        │
│ Cashier: Mary                          │
│ Nag-approve na Manager: John           │
│                                        │
│ Pirma ng Customer: ________________    │
│                                        │
│ Petsa: ____/____/____                  │
│                                        │
└────────────────────────────────────────┘
```

---

## 📊 Arawang Reconciliation

### Oras ng End-of-Day Settlement

```
✅ Kailan isagawa ang end-of-day settlement?

1. Pagkatapos ng oras ng negosyo
2. Lahat ng order ay na-checkout na
3. Kumpirmahin na walang naghihintay na refund
4. Handa nang bilangin ang cash
```

---

### Standard na Proseso ng Settlement

```
┌─────────────────────────────────────────────┐
│ Mga Hakbang sa End-of-Day Settlement        │
├─────────────────────────────────────────────┤
│                                             │
│  1️⃣ Mag-login sa cashier system            │
│      ↓                                      │
│  2️⃣ Piliin ang function na "Arawang Settlement" │
│      ↓                                      │
│  3️⃣ Awtomatikong bilangin ng sistema ang data ngayon │
│      • Kabuuang benta                      │
│      • Bilang ng transaksyon               │
│      • Halaga ng bawat paraan ng bayad     │
│      • Halaga ng refund                    │
│      ↓                                      │
│  4️⃣ Bilangin ang aktwal na cash sa drawer  │
│      ↓                                      │
│  5️⃣ Ilagay ang aktwal na nabibilang na halaga │
│      ↓                                      │
│  6️⃣ Ihambing ng sistema ang libro vs aktwal │
│      ↓                                      │
│  ┌──────────┐  ┌──────────┐               │
│  │  Tugma   │  │  Hindi   │               │
│  │          │  │  Tugma   │               │
│  └──────────┘  └──────────┘               │
│      ↓              ↓                       │
│  7️⃣ I-print ang ulat Hanapin ang dahilan   │
│      ↓              ↓                       │
│  8️⃣ Pumirma ang Manager Punuin ang variance report │
│      ↓              ↓                       │
│  9️⃣ Ideposito ang cash I-review ng Manager │
│      ↓                                      │
│  🔟 Tapos na ang Settlement ✅              │
│                                             │
└─────────────────────────────────────────────┘
```

---

### Arawang Ulat ng Negosyo

```
┌────────────────────────────────────────────────────┐
│           Arawang Ulat ng MakanMakan               │
│           Petsa: 2025/10/26                        │
├────────────────────────────────────────────────────┤
│                                                    │
│ 【Buod ng Negosyo】                                │
│                                                    │
│  Oras ng Negosyo: 10:00 - 22:00                   │
│  Kabuuang Transaksyon: 156                        │
│  Average na Transaksyon: $428                     │
│  Kabuuang Benta: $66,768                          │
│                                                    │
├────────────────────────────────────────────────────┤
│                                                    │
│ 【Estadistika ng Paraan ng Bayad】                │
│                                                    │
│  💵 Cash:           $28,500  (42.7%)              │
│     Mga Transaksyon: 72                           │
│                                                    │
│  💳 Credit Card:    $26,890  (40.3%)              │
│     Mga Transaksyon: 58                           │
│                                                    │
│  📱 Mobile Payment: $11,378  (17.0%)              │
│     Mga Transaksyon: 26                           │
│     └ LINE Pay:     $6,200                        │
│     └ Street Pay:   $3,450                        │
│     └ Iba:          $1,728                        │
│                                                    │
├────────────────────────────────────────────────────┤
│                                                    │
│ 【Reconciliation ng Cash】                        │
│                                                    │
│  Opening Float:                    $5,000         │
│  Kita sa Cash:                    $28,500         │
│  Mga Disbursement sa Cash (Refunds): $450         │
│  ─────────────────────────────────              │
│  Halaga sa Libro:                 $33,050         │
│  Aktwal na Bilang:                $33,050         │
│  ─────────────────────────────────              │
│  Variance:                            $0  ✅      │
│                                                    │
├────────────────────────────────────────────────────┤
│                                                    │
│ 【Estadistika ng Refund】                         │
│                                                    │
│  Bilang ng Refund: 3                              │
│  Halaga ng Refund: $450                           │
│  Mga Dahilan ng Refund:                           │
│    • Problema sa Pagkain: 2 ($320)                │
│    • Kinansela ang Order: 1 ($130)                │
│                                                    │
├────────────────────────────────────────────────────┤
│                                                    │
│ 【Mga Exception】                                  │
│                                                    │
│  ✅ Walang naitala na exception                    │
│                                                    │
├────────────────────────────────────────────────────┤
│                                                    │
│ Cashier: Mary               Pirma: _________       │
│ Manager: John               Pirma: _________       │
│                                                    │
│ Oras ng Settlement: 2025/10/26 22:30              │
│                                                    │
└────────────────────────────────────────────────────┘
```

---

### Sheet ng Pagbilang ng Cash

```
┌────────────────────────────────────────┐
│        Sheet ng Pagbilang ng Cash      │
│        Petsa: 2025/10/26               │
├────────────────────────────────────────┤
│                                        │
│ 【Mga Bill】                           │
│                                        │
│  $1,000  ×  20 pcs = $20,000          │
│  $  500  ×   8 pcs = $ 4,000          │
│  $  100  ×  82 pcs = $ 8,200          │
│                                        │
│  Subtotal ng Bills:  $32,200          │
│                                        │
│ ────────────────────────────────────  │
│                                        │
│ 【Mga Barya】                          │
│                                        │
│  $   50  ×   8 pcs = $   400          │
│  $   10  ×  25 pcs = $   250          │
│  $    5  ×  20 pcs = $   100          │
│  $    1  × 100 pcs = $   100          │
│                                        │
│  Subtotal ng Barya:  $   850          │
│                                        │
│ ────────────────────────────────────  │
│                                        │
│ 【Kabuuan】                            │
│                                        │
│  Aktwal na Bilang:   $33,050          │
│  Halaga sa Libro:    $33,050          │
│  Variance:           $     0  ✅      │
│                                        │
│ ────────────────────────────────────  │
│                                        │
│ Binilang ni: Mary      Oras: 22:25    │
│ Na-verify ni: John     Oras: 22:30    │
│                                        │
└────────────────────────────────────────┘
```

---

### Paghawak ng Variance

**Kapag hindi tugma ang halaga sa libro at aktwal:**

```
Kaso 1: Mas mataas ang aktwal kaysa libro (Overage)

1️⃣ I-record ang halaga ng overage
2️⃣ Muling bilangin para kumpirmahin
3️⃣ Suriin kung may hindi naitala na transaksyon
4️⃣ Punuin ang "Variance Report"
5️⃣ I-review ng manager
6️⃣ Ihiwalay ang overage amount
7️⃣ Maghintay para sa reconciliation bukas


Kaso 2: Mas mababa ang aktwal kaysa libro (Shortage)

1️⃣ I-record ang halaga ng shortage
2️⃣ Muling bilangin para kumpirmahin
3️⃣ Alalahanin ang proseso ng transaksyon, hanapin ang posibleng dahilan:
   • Mali ang sukli na ibinigay
   • Nakatanggap ng pekeng bill
   • Nakalimutang kolektahin ang bayad
   • Mali ang halagang inilagay
4️⃣ Punuin ang "Variance Report"
5️⃣ I-review ng manager
6️⃣ Hawakan ayon sa patakaran ng kumpanya (bayaran o i-record)
```

---

## 📈 Mga Query sa Ulat

### Mga Available na Uri ng Ulat

```
┌─────────────────────────────────────────────┐
│ Mga Ulat ng Cashier System                  │
├─────────────────────────────────────────────┤
│                                             │
│  📊 Mga Arawang Ulat                        │
│     • Buod ng arawang negosyo              │
│     • Estadistika ng paraan ng bayad       │
│     • Pagsusuri ng panahon                 │
│                                             │
│  📊 Mga Lingguhang Ulat                     │
│     • Mga trend ng lingguhang negosyo      │
│     • Paghahambing ng linggo-sa-linggo     │
│                                             │
│  📊 Mga Buwanang Ulat                       │
│     • Estadistika ng buwanang negosyo      │
│     • Mga ranking ng buwanang benta        │
│                                             │
│  📊 Mga Detalye ng Transaksyon              │
│     • Query ng isang transaksyon           │
│     • Kasaysayan ng transaksyon            │
│                                             │
│  📊 Mga Talaan ng Refund                    │
│     • Estadistika ng refund                │
│     • Pagsusuri ng dahilan ng refund       │
│                                             │
│  📊 Personal na Performance                 │
│     • Mga stats ng performance ng cashier  │
│     • Rating ng serbisyo                   │
│                                             │
└─────────────────────────────────────────────┘
```

---

### Mga Hakbang sa Query ng Ulat

```
1️⃣ Mag-login sa cashier system
2️⃣ I-click ang "Query ng Ulat"
3️⃣ Piliin ang uri ng ulat
4️⃣ I-set ang mga parameter ng query
   • Saklaw ng petsa
   • Paraan ng bayad
   • Status ng transaksyon
5️⃣ I-click ang "Query"
6️⃣ Repasuhin ang nilalaman ng ulat
7️⃣ Opsyon na "I-print" o "I-export"
```

---

### Query ng Personal na Performance

```
┌────────────────────────────────────────┐
│     Buwanang Performance ni Mary       │
│     Oktubre 2025                       │
├────────────────────────────────────────┤
│                                        │
│ Mga Araw ng Serbisyo: 22 araw          │
│ Kabuuang Transaksyon: 867              │
│ Kabuuang Halaga ng Transaksyon: $346,890 │
│ Arawang Average: $15,768               │
│ Average na Transaksyon: $400           │
│                                        │
│ ────────────────────────────────────  │
│                                        │
│ Distribusyon ng Paraan ng Bayad:      │
│  💵 Cash: 45%                          │
│  💳 Credit Card: 38%                   │
│  📱 Mobile Payment: 17%                │
│                                        │
│ ────────────────────────────────────  │
│                                        │
│ Rating ng Serbisyo:                    │
│  ⭐⭐⭐⭐⭐  Kahusayan: 4.8/5.0          │
│  ⭐⭐⭐⭐⭐  Katumpakan: 4.9/5.0         │
│  ⭐⭐⭐⭐⭐  Ugali sa Serbisyo: 5.0/5.0  │
│                                        │
│ ────────────────────────────────────  │
│                                        │
│ Mga Talaan ng Exception:               │
│  • Variance sa Cash: 0 beses ✅        │
│  • Mga Reklamo ng Customer: 0 beses ✅ │
│  • Mga Late: 0 beses ✅                │
│                                        │
│ Ranking sa Buwan: 2nd / 8 cashiers    │
│                                        │
└────────────────────────────────────────┘
```

---

## ⚠️ Paghawak ng Exception

### Mga Karaniwang Kaso ng Exception

#### 1. Pag-crash ng Sistema

```
Sintomas: Hindi magsisimula o biglaang magsasara ang cashier system

Mga Hakbang:
1️⃣ Manatiling kalmado, humingi ng paumanhin sa customer
2️⃣ Sabihan ang customer: "Pansamantalang hindi available ang sistema, pakihintay po"
3️⃣ Kaagad na sabihan ang IT staff o manager
4️⃣ Subukang i-restart ang sistema
5️⃣ Kung hindi kaagad maayos:
   • Pansamantalang gumamit ng handwritten receipts
   • I-record ang impormasyon ng transaksyon
   • Ilagay pagkatapos bumalik ang sistema
6️⃣ Panatilihing komunikasyon sa customer, bawasan ang pagkabalisa sa paghihintay
```

---

#### 2. Hindi Gumagana ang Receipt Printer

```
Sintomas: Hindi maka-print ng resibo, nag-jam ang papel, hindi malinaw ang print

Mga Hakbang:
1️⃣ Tukuyin ang sanhi ng sira
   • Ubos ang papel? → Palitan ang roll ng resibo
   • Nag-jam ang papel? → Buksan ang makina at alisin
   • Hindi malinaw ang print? → Linisin ang print head

2️⃣ Kung hindi kaagad maayos
   • Magsulat ng pansamantalang resibo
   • Markahan ang order number
   • Sabihan ang customer ng muling pag-print mamaya

3️⃣ Sabihan ang maintenance staff
4️⃣ Punuin ang equipment repair form
```

**Mga Hakbang sa Pagpapalit ng Papel ng Resibo:**

```
1. Buksan ang top cover ng receipt printer
2. Alisin ang lumang roll (kung mayroon pa)
3. Ipasok ang bagong roll
4. Hilahin ang papel ng mga 10cm
5. Isara ang top cover
6. Pindutin ang button na "Feed" para subukan
```

---

#### 3. Hindi Gumagana ang Card Terminal

```
Sintomas: Hindi makabasa ng card, nabigo ang koneksyon, abnormal na transaksyon

Mga Hakbang:
1️⃣ Mga basic na pagsusuri
   • Kumpirmahin na nakakabit ang power cable
   • Suriin ang koneksyon sa network
   • Subukang mag-restart

2️⃣ Kung hindi kaagad maayos
   • Magalang na sabihan ang customer: "Pansamantalang hindi available ang card terminal"
   • Magrekomenda ng alternatibong paraan ng bayad:
     ✓ Cash
     ✓ Mobile payment
     ✓ Magbayad mamaya

3️⃣ Sabihan ang manager at customer service ng bangko
4️⃣ Punuin ang equipment exception report
```

---

#### 4. Nawalan ng Network

```
Sintomas: Hindi makakonekta, nabigo ang transaksyon, hindi ma-upload ang data

Mga Hakbang:
1️⃣ Kumpirmahin kung kumpletong outage
   • Suriin kung normal ang ibang devices
   • Tanungin ang ibang kasamahan tungkol sa sitwasyon

2️⃣ Lumipat sa offline mode (kung available)
   • Gamitin ang mga lokal na function
   • I-record ang impormasyon ng transaksyon
   • I-sync pagkatapos bumalik ang network

3️⃣ Sabihan ang network administrator
4️⃣ Kung kailangan ng emergency handling:
   • Gumamit ng mobile hotspot
   • Magsulat ng mga talaan ng transaksyon

5️⃣ Pagkatapos bumalik ang network
   • I-sync ang offline transaction data
   • Kumpirmahin ang integridad ng data
```

---

#### 5. Kulang ang Sukli

```
Sintomas: Walang sapat na denominasyon sa cash drawer para sa sukli

Mga Hakbang:
1️⃣ Magalang na sabihan ang customer: "Pasensya na, kulang kami sa maliit na bills"
2️⃣ Magbigay ng mga alternatibo:
   • "Pwede ko ba kayong bigyan ng ibang denominasyon?"
   • "Pwede ba kayong gumamit ng card o mobile payment?"
   • "Kukuha ako ng sukli sa ibang register, pakihintay po"

3️⃣ Mabilis na humiram mula sa ibang registers
4️⃣ Tapusin ang pagbibigay ng sukli
5️⃣ Humingi ng paumanhin at magpasalamat sa paghihintay
6️⃣ I-record ang pangangailangan ng sukli, sabihan ang manager na mag-replenish
```

---

#### 6. Pinaghihinalaang Pekeng Bill

```
Prinsipyo sa Paghawak: Manatiling kalmado, hawakan nang magalang, protektahan ang dalawang partido

Mga Hakbang:
1️⃣ Huwag direktang akusahan ang customer
2️⃣ Gamitin ang detection equipment para i-verify
3️⃣ Kung talagang kahina-hinala, magalang na sabihin:
   "Pasensya na po, mukhang may problema ang bill na ito,
    kailangan kong kumpirmahin sa manager,
    o pwede ba kayong gumamit ng iba?"

4️⃣ Kaagad na sabihan ang manager
5️⃣ Magpasya ang manager pagkatapos ng paghatol:
   • Ibalik sa customer, hilingin na magpalit ng bill
   • Panatilihin at i-report sa pulis

6️⃣ Manatiling magalang sa buong proseso, iwasan ang konfliktó
7️⃣ Punuin ang exception report pagkatapos
```

---

#### 7. Inaangal ng Customer ang Halaga

```
Sintomas: Naniniwala ang customer na mali ang kalkulasyon ng halaga, sobra ang singil

Mga Hakbang:
1️⃣ Manatiling kalmado at magalang
2️⃣ Sabihin: "I-verify ko po muli"
3️⃣ Kunin ang mga detalye ng order
4️⃣ Ipaliwanag isa-isa sa customer:
   "Ang order ninyo ay:
    • OO Noodles $150
    • OO Rice $120
    • Inumin $50
    Ang kabuuan ay $320"

5️⃣ Kung talagang mali ang kalkulasyon:
   • Taos-pusong humingi ng paumanhin
   • Kaagad na itama
   • I-refund ang sobra o singilin ang kulang

6️⃣ Kung tama ang halaga:
   • Pasensyosong ipaliwanag
   • Ipakita ang price list
   • Hingin ang tulong ng manager kung kailangan

7️⃣ Punuin ang customer complaint record
```

---

#### 8. Abnormal ang Ipinakitang Halaga ng Sistema

```
Sintomas: Ipinakikita ng sistema ang halatang hindi makatwirang halaga

Mga Hakbang:
1️⃣ Huwag singilin ayon sa halaga ng sistema
2️⃣ Mano-manong kalkulahin ang tamang halaga
3️⃣ Ipaliwanag sa customer: "Mukhang mali ang sistema, kalkulahin ko po"
4️⃣ Singilin ang tamang halaga
5️⃣ Markahan ang exception sa order
6️⃣ Sabihan ang manager at IT staff
7️⃣ Punuin ang system exception report
8️⃣ Maghintay para sa kumpirmasyon ng pag-aayos
```

---

## 💵 Pamamahala ng Cash

### Mga Alituntunin sa Pamamahala ng Cash Drawer

```
┌─────────────────────────────────────────────┐
│ Mga Gintong Alituntunin ng Cash Drawer      │
├─────────────────────────────────────────────┤
│                                             │
│  1️⃣ Dapat laging nakalock ang drawer       │
│                                             │
│  2️⃣ Isara ang drawer kapag umaalis sa upuan │
│                                             │
│  3️⃣ Malalaking bills kaagad sa safe         │
│                                             │
│  4️⃣ Regular na bilang, siguruhing tugma ang libro at aktwal │
│                                             │
│  5️⃣ Ang cash sa drawer ay hindi dapat lumampas sa limit │
│     (Inirerekomenda na hindi lalampas sa $50,000) │
│                                             │
│  6️⃣ Iba't ibang denominasyon sa mga slots, panatilihing maayos │
│                                             │
│  7️⃣ Huwag munang ilagay ang malalaking bills sa drawer (iwasan ang alitan) │
│                                             │
│  8️⃣ Huwag kailanman maglagay ng personal na gamit sa drawer │
│                                             │
└─────────────────────────────────────────────┘
```

---

### Standard na Configurasyon ng Cash Drawer

```
┌─────────────────────────────────────────────────┐
│              Standard na Setup ng Drawer        │
├─────────────────────────────────────────────────┤
│                                                 │
│  【Mga Compartment ng Bill】                    │
│  ┌─────┬─────┬─────┬─────┬─────┐            │
│  │1000 │ 500 │ 200 │ 100 │Empty│            │
│  │     │     │     │     │     │            │
│  └─────┴─────┴─────┴─────┴─────┘            │
│                                                 │
│  【Mga Compartment ng Barya】                   │
│  ┌────┬────┬────┬────┬────┬────┐           │
│  │ 50 │ 10 │  5 │  1 │Empty│Empty│         │
│  │    │    │    │    │     │     │         │
│  └────┴────┴────┴────┴────┴────┘           │
│                                                 │
│  【Inirerekomendang Configurasyon ng Float】    │
│  • $1000: 5 pcs = $5,000                       │
│  • $ 500: 4 pcs = $2,000                       │
│  • $ 100: 30 pcs = $3,000                      │
│  • $  50: 10 pcs = $  500                      │
│  • $  10: 30 pcs = $  300                      │
│  • $   5: 20 pcs = $  100                      │
│  • $   1: 100 pcs = $ 100                      │
│  ─────────────────────────────────────        │
│  Kabuuang Float:     $11,000                   │
│                                                 │
└─────────────────────────────────────────────────┘
```

---

### Mga Operasyon sa Pag-deposito ng Cash

**Kailan mag-deposito ng cash?**

```
1️⃣ Ang cash sa drawer ay lumampas sa limit ($50,000)
2️⃣ Masyadong maraming malalaking bills ($1,000+)
3️⃣ Gitna ng araw ng negosyo (lunch o hapon na break)
4️⃣ Katapusan ng arawang negosyo
```

**Proseso ng Pag-deposito:**

```
1️⃣ Ihanda ang deposit bag
2️⃣ Bilangin ang cash na ide-deposito
3️⃣ Punuin ang deposit slip
   • Petsa
   • Halaga
   • Nag-deposito
   • Oras
4️⃣ Ilagay ang cash at slip sa deposit bag
5️⃣ I-seal ang deposit bag
6️⃣ Sabihan ang manager o itinalagang tao
7️⃣ Dalhin ng dalawang tao ang cash sa safe
8️⃣ I-record ang deposito sa sistema
9️⃣ Panatilihin ang resibo ng deposito
```

---

### Pagbilang ng Cash

**Mga Oras ng Pagbilang:**

- Bago magsimula ang arawang negosyo
- Sa panahon ng pagpapalit ng shift
- Pagkatapos ng arawang negosyo
- Mga spot check ng manager

**Mga Hakbang sa Pagbilang:**

```
1️⃣ Ihinto ang mga koleksyon (magkabit ng sign na "Pansamantalang Sarado")
2️⃣ Ihanda ang count sheet
3️⃣ Bilangin mula sa malalaking denominasyon
   • $1000 × ____ = $ _____
   • $ 500 × ____ = $ _____
   • $ 100 × ____ = $ _____
   • $  50 × ____ = $ _____
   • $  10 × ____ = $ _____
   • $   5 × ____ = $ _____
   • $   1 × ____ = $ _____

4️⃣ Kalkulahin ang kabuuang halaga
5️⃣ Ihambing sa halaga sa libro ng sistema
6️⃣ Kung may variance, muling bilangin
7️⃣ I-record ang mga resulta ng pagbilang
8️⃣ Pumirma ang manager ng kumpirmasyon
```

---

## 🔐 Mga Alituntunin sa Seguridad

### Seguridad ng Impormasyon

```
┌─────────────────────────────────────────────┐
│ Mga Alituntunin sa Seguridad ng Impormasyon │
│ ng Cashier System                            │
├─────────────────────────────────────────────┤
│                                             │
│  🔒 Pamamahala ng Password                  │
│     • Huwag ibahagi ang account credentials│
│     • Regular na baguhin ang password (tuwing 3 buwan) │
│     • Huwag isulat ang password sa papel o phone │
│     • Dapat mag-logout kapag umaalis sa upuan │
│                                             │
│  🔒 Proteksyon ng Impormasyon ng Customer   │
│     • Huwag ibunyag ang personal na impormasyon │
│     • Huwag kunan ng larawan o i-record ang card info │
│     • Ang customer data ay para sa negosyo lamang │
│     • Huwag alisin o ibahagi sa labas      │
│                                             │
│  🔒 Paggamit ng Sistema                     │
│     • Huwag gumamit ng account ng iba      │
│     • Huwag baguhin ang mga setting ng sistema │
│     • Huwag mag-install ng hindi awtorisadong software │
│     • I-report kaagad ang mga abnormalidad │
│                                             │
└─────────────────────────────────────────────┘
```

---

### Seguridad sa Pananalapi

```
┌─────────────────────────────────────────────┐
│ Mga Hakbang sa Proteksyon ng Seguridad ng Pera │
├─────────────────────────────────────────────┤
│                                             │
│  💰 Mga Hakbang sa Pag-iwas                 │
│                                             │
│  1️⃣ Mag-alerto para sa malalaking transaksyon │
│     • I-verify ang katotohanan ng malaking bill │
│     • Kumpirmahin na ang gumagamit ng card ay may-ari │
│     • Sabihan ang manager ng kahina-hinalang transaksyon │
│                                             │
│  2️⃣ Pamamahala ng Drawer                   │
│     • Kaagad na i-lock ang drawer          │
│     • Kaagad na ideposito ang malaking cash │
│     • Huwag palapitan ang iba sa drawer    │
│                                             │
│  3️⃣ Pag-iwas sa Pandaraya                  │
│     • Huwag tumanggap ng kahina-hinalang paraan ng bayad │
│     • Huwag sumunod sa abnormal na operasyon │
│     • Ang mga kahilingan sa telepono para sa transfer ay palaging scam │
│                                             │
│  4️⃣ Proteksyon ng Surveillance              │
│     • Alamin ang mga lokasyon ng camera    │
│     • Siguruhing naitala ang mga abnormal na sitwasyon │
│     • Huwag harangin ang mga camera        │
│                                             │
└─────────────────────────────────────────────┘
```

---

### Personal na Kaligtasan

```
┌─────────────────────────────────────────────┐
│ Mga Paalala sa Personal na Kaligtasan ng Cashier │
├─────────────────────────────────────────────┤
│                                             │
│  🚨 Kapag Pinagbantaan o Ninakawan          │
│                                             │
│  1️⃣ Manatiling kalmado, sumunod sa mga hinihingi │
│  2️⃣ Ang kaligtasan ng buhay ay pinakaimportante, pangalawa ang pera │
│  3️⃣ Huwag labanan o probokahin             │
│  4️⃣ Tandaan ang mga katangian (taas, accent, mga marka) │
│  5️⃣ Obserbahan ang direksyon ng pagtakas   │
│  6️⃣ Tumawag sa pulis pagkatapos siguruhing ligtas │
│  7️⃣ Panatilihin ang scene, maghintay sa pulis │
│  8️⃣ Makipagtulungan sa imbestigasyon ng pulis │
│                                             │
│  ⚠️ Mga Paraan ng Emergency Help            │
│                                             │
│  • Pulis: 110                              │
│  • Store Manager: [Phone]                  │
│  • Security: [Phone]                       │
│  • Lokasyon ng Emergency Button: [Location] │
│                                             │
└─────────────────────────────────────────────┘
```

---

### Pag-iwas sa Pandaraya

**Mga Karaniwang Paraan ng Scam:**

```
❌ Uri ng Scam 1: Pekeng Customer Service
   "Ako ay mula sa customer service ng headquarters, may problema sa sistema,
    kailangan ninyong tumulong sa pag-test ng refund function..."

   → Huwag kailanman sumunod sa mga operasyon na hinihiling sa telepono
   → Ibaba, kontakin ang direktang manager para i-verify


❌ Uri ng Scam 2: Scam sa Pagpapalit ng Bill
   Ang customer pagkatapos ng bayad ay nagsabi: "Gusto kong palitan ang bill na iyon"
   Ginagamit ang pagkakataon para magpalit o kumuha ng extra na pera

   → Kaagad na ilagay sa drawer ang mga natanggap na bill
   → Huwag tanggapin ang mga kahilingan sa pagpapalit ng bill


❌ Uri ng Scam 3: Kalituhan sa Halaga
   "Binigay ko lang $1000, mali ang sukli ninyo"
   Sa totoo ay nagbigay ng $500

   → Ilagay muna ang malalaking bills sa ibabaw ng register
   → Malakas na ulitin "Nakatanggap ng $1000"
   → Ilagay ang bill sa drawer pagkatapos magbigay ng sukli


❌ Uri ng Scam 4: Pekeng Payment Screen
   Ipinakikita ng phone na tapos na ang bayad, pero hindi naman

   → Dapat kumpirmahin ng sistema na natanggap ang bayad
   → Hindi maaaring tumingin lang sa screen ng phone ng customer
   → Maghintay para sa kumpirmasyon ng sistema bago tapusin ang checkout
```

---

## ❓ FAQ

### Q1: Paano kung nagsabi ang customer na nakalimutan ang pera?

```
A: Magalang na paghawak

1️⃣ Manatiling friendly
   "Walang problema, may iba ba kayong paraan ng bayad?"

2️⃣ Magbigay ng mga opsyon
   • "Pwede ba kayong gumamit ng credit card o mobile payment?"
   • "May ATM malapit, gusto ninyong mag-withdraw? Pwede naming hawakan ang order ninyo"
   • "Pwede bang tumulong ang kaibigan na mag-transfer ng bayad?"

3️⃣ Huling solusyon
   • Sabihan ang manager
   • Magpasya ang manager kung:
     → Hayaang mag-iwan ng contact info ang customer, magbayad mamaya
     → I-record ang ID information
     → I-report sa pulis (kung masamang ugali o umuulit na nagkakasala)
```

---

### Q2: Paano kung humihiling ng diskwento ang customer?

```
A: Standard na sagot

1️⃣ Magalang na ipaliwanag
   "Pasensya na, ang mga presyo ay itinakda ng kumpanya,
    wala akong awtoridad na baguhin ang mga ito"

2️⃣ Magbigay ng mga alternatibo
   • "Mayroon kaming member benefits, mag-register para sa susunod na diskwento"
   • "Ang kasalukuyang promotion ay..."
   • "May coupon ba kayo?"

3️⃣ Kung mapilit ang customer
   • "Kunin ko ang manager ko para tumulong"
   • Magpasya ang manager kung bibigyan ng diskwento

⚠️ Paalala:
   Ang mga cashier ay hindi maaaring magbigay ng diskwento nang mag-isa
   Lahat ng pagbabago sa presyo ay kailangan ng approval ng manager
```

---

### Q3: Paano kung nawala o hindi malinaw ang resibo?

Kumpirmahin ang numero ng order at talaan ng bayad, pagkatapos ay muling i-print ang resibo at ibigay sa customer. Humingi ng tulong sa manager kung hindi ito ma-print muli.

---

### Q4: Ang customer ay nagsabi na nagbayad na pero walang talaan ang sistema?

```
A: Paghawak ng alitan sa pagbabayad

1️⃣ Manatiling kalmado at magalang
   "I-verify ko po para sa inyo"

2️⃣ Suriin ang mga talaan ng sistema
   • Mag-query ng status ng order
   • Kumpirmahin ang talaan ng bayad
   • Suriin ang oras ng transaksyon

3️⃣ Kung mobile payment
   • Tanungin ang customer na ipakita ang screen ng matagumpay na bayad
   • I-verify ang numero ng transaksyon
   • Kumpirmahin ang halaga at merchant info

4️⃣ Kung talagang nagbayad pero hindi na-update ang sistema
   • Kaagad na sabihan ang manager at IT
   • Huwag singilin muli
   • Maghintay para sa sync ng sistema

5️⃣ Kung hindi makumpirma
   • Hingin ang tulong ng manager
   • Suriin ang bank statements
   • Repasuhin ang surveillance footage (kung kailangan)
```

---

### Q5: Paano kung natuklasan ang shortage sa cash pagkatapos ng pagsasara?

```
A: Paghawak ng shortage sa cash

1️⃣ Kaagad na muling bilangin
   Siguruhing walang error sa kalkulasyon

2️⃣ Punuin ang "Variance Report"
   • I-record ang halaga ng shortage
   • Ipaliwanag ang mga posibleng dahilan
   • Alalahanin ang mga kahina-hinalang transaksyon

3️⃣ Sabihan ang manager
   • I-report ang sitwasyon
   • Makipagtulungan sa imbestigasyon

4️⃣ Repasuhin ang footage
   • Suriin ang proseso ng transaksyon
   • Hanapin ang mga posibleng sanhi

5️⃣ Follow-up
   • Bayaran o i-record ayon sa patakaran ng kumpanya
   • Pagbutihin ang mga hakbang sa pag-iwas
   • Palakasin ang pamamahala ng cash

Pag-iwas:
✅ Maingat na i-verify ang bawat transaksyon
✅ Regular na bilangin ang drawer
✅ Bigyang-pansin ang malalaking transaksyon
✅ Bilangin sa panahon ng pagpapalit ng shift
```

---

### Q6: Ang customer ay nagsabi na hindi nakatanggap ng card receipt?

```
A: Paghawak ng muling pag-print ng resibo

1️⃣ Kumpirmahin na natapos ang transaksyon
   • Suriin ang mga talaan ng sistema
   • Kumpirmahin na settled ang bayad

2️⃣ Muling i-print ang resibo
   • Pumasok sa mga talaan ng transaksyon
   • Piliin ang transaksyong iyon
   • I-click ang "Muling I-print ang Resibo"
   • Markahan ng "REPRINT"

3️⃣ Pumirma ang customer
   • I-verify na tugma ang pirma sa likod ng card
   • I-file ang resibo para sa mga talaan

4️⃣ I-record ang dahilan ng muling pag-print
   • Markahan sa sistema
   • Iwasan ang duplicate na pagproseso
```

---

### Q7: Paano kung nakasalamuha ng mahirap na customer o reklamo?

```
A: Mga prinsipyo sa paghawak ng reklamo

1️⃣ Manatiling propesyonal at kalmado
   • Huwag makipagtalo sa customer
   • Huwag tumugon nang emosyonal
   • Palaging manatiling magalang

2️⃣ Makinig sa mga alalahanin ng customer
   "Naiintindihan ko ang inyong nararamdaman, pakisabi sa akin kung ano ang nangyari"

3️⃣ Makiisa at humingi ng paumanhin
   "Pasensya na po sa abala"

4️⃣ Magmungkahi ng solusyon
   • Hawakan sa loob ng awtoridad
   • Hingin ang manager kung lampas sa awtoridad

5️⃣ I-record ang nilalaman ng reklamo
   • Punuin ang complaint form
   • Ilarawan ang insidente
   • I-record ang resolusyon

6️⃣ Follow-up
   • Kumpirmahin na nalutas ang problema
   • Mag-follow up sa customer kung kailangan

Mga importanteng prinsipyo:
⚠️ Huwag kailanman makipag-konfliktó sa customer
⚠️ Humingi kaagad ng tulong kung nainsulto o pinagbantaan
⚠️ Ang personal na kaligtasan ay pinakaimportante
```

---

### Q8: Pwede ko bang bigyan ng diskwento ang mga kaibigan kapag bumisita?

```
A: Hindi ❌

Paliwanag:
1. Lumalabag ito sa patakaran ng kumpanya
2. Pag-abuso ng awtoridad
3. Maaaring magresulta sa:
   • Nakasulat na babala
   • Pagbawas sa suweldo
   • Pagtanggal sa trabaho

Tamang pamamaraan:
✅ Dapat normal na magbayad ang mga kaibigan
✅ Kung may employee benefits, mag-apply ayon sa patakaran
✅ Huwag magbigay ng anumang diskwento nang mag-isa
✅ Lahat ng diskwento ay kailangan ng approval ng manager
```

---

### Q9: Pwede ko bang mag-advance ng bayad para sa mga customer?

```
A: Hindi inirerekomenda ⚠️

Mga dahilan:
1. Nagiging sanhi ng kalituhan sa accounting
2. Maaaring hindi mabawi ang bayad
3. Lumalabag sa mga alituntunin sa pamamahala ng cash flow

Mga exception na kaso (kailangan ng approval ng manager):
• Regular na customer na nakalimutang magdala ng pera
• Napakaliit na halaga
• Sumasang-ayon ang manager at nag-record

Tamang proseso:
1️⃣ Huwag mag-advance nang mag-isa
2️⃣ Konsultahin ang manager
3️⃣ Kung aprubado na mag-advance:
   • Punuin ang advance form
   • I-record ang contact info ng customer
   • I-set ang deadline ng pagbabayad
   • Pumirma ang manager
4️⃣ Subaybayan ang pagbawi ng bayad
```

---

### Q10: Tapos na ang shift pero may customer pa ring babayaran?

```
A: Tapusin ang serbisyo bago umalis

Propesyonal na etika:
✅ Paglingkuran ang huling customer
✅ Tapusin ang shift handover
✅ Siguruhing tumpak ang mga account
✅ Hindi maaaring mag-iwan ng gulo para sa susunod na shift

Tamang pamamaraan:
1️⃣ Ipagpatuloy ang paglilingkod sa mga customer
2️⃣ Panatilihing mabuting ugali (huwag magpakita ng pagkainis)
3️⃣ Pagkatapos matapos ang checkout:
   • Bilangin ang cash drawer
   • I-print ang shift report
   • Ibigay sa paparating na staff
   • Maaaring umalis pagkatapos pumirma ang manager

Kung talagang may emergency na bagay:
• Sabihan ang manager nang maaga
• Hilingin sa kasamahan na tumulong
• Tapusin ang basic na handover
```

---

## 📞 Impormasyon sa Pakikipag-ugnayan

### Mga Internal na Contact

```
┌─────────────────────────────────────────┐
│ Mga Contact Window na Kaugnay ng Cashier │
├─────────────────────────────────────────┤
│                                         │
│  👔 Store Manager                       │
│     Extension: 101                      │
│     Mobile: [Phone]                     │
│     Hawak: HR, reklamo, emergency       │
│                                         │
│  💻 IT Staff                            │
│     Extension: 201                      │
│     Mobile: [Phone]                     │
│     Hawak: Mga problema sa sistema, network │
│                                         │
│  🔧 Maintenance Staff                   │
│     Extension: 301                      │
│     Mobile: [Phone]                     │
│     Hawak: Sira ng equipment, hardware  │
│                                         │
│  📊 Accounting Department               │
│     Extension: 102                      │
│     Email: accounting@makanmakan.com    │
│     Hawak: Accounting, mga isyu sa resibo │
│                                         │
└─────────────────────────────────────────┘
```

---

### Mga External na Contact

```
┌─────────────────────────────────────────┐
│ Mga External Support Contact            │
├─────────────────────────────────────────┤
│                                         │
│  🏦 Customer Service ng Bangko          │
│     Card terminal, mga tanong sa transaksyon │
│     [Pangalan ng Bangko]: 0800-XXX-XXX │
│                                         │
│  📱 Customer Service ng Mobile Payment  │
│     LINE Pay:                          │
│     Street Pay:                         │
│     Ibang Platforms:                    │
│                                         │
│  🚨 Emergency Help                      │
│     Pulis: 110                         │
│     Bumbero: 119                       │
│     Security: [Phone]                  │
│                                         │
│  🛠️ Mga Vendor ng Equipment             │
│     POS System: [Phone]                │
│     Card Terminal: [Phone]             │
│                                         │
└─────────────────────────────────────────┘
```

---

## 🎓 Appendix

### A. Standard na Mga Parirala ng Cashier

**Bati:**

```
"Kumusta, maligayang pagdating!"
"Kumusta, dine-in o takeout?"
```

**Sa Panahon ng Checkout:**

```
"Kumusta, handa na ba kayong magbayad?"
"Ang kabuuan ay $XXX"
"Anong paraan ng bayad ang gusto ninyo?"
"Nakatanggap ng $XXX"
"Ang sukli ninyo ay $XXX, pakisuri po"
```

**Pagbibigay ng Resibo:**

```
"Narito ang inyong resibo, pakiingatan po"
"Salamat sa pagkain, bumalik kayo!"
```

**Nakatagpo ng Mga Problema:**

```
"Pasensya na po, sandali lang po"
"Pasensya na po sa paghihintay"
"Salamat po sa inyong pasensya"
```

---

### B. Mga Keyboard Shortcut

| Function            | Shortcut   |
| ------------------- | ---------- |
| Mabilis na Hanap    | F1         |
| Checkout            | F2         |
| Kanselahin          | ESC        |
| I-print ang Resibo | Ctrl+P     |
| Muling I-print      | Ctrl+R     |
| Refund              | Ctrl+Alt+R |
| I-lock ang Screen   | Ctrl+L     |
| Mag-logout          | Ctrl+Q     |
| Tulong              | F12        |

---

### C. Mga Pamantayan sa Performance ng Cashier

```
┌────────────────────────────────────────┐
│        Pagsusuri ng Performance ng Cashier │
├────────────────────────────────────────┤
│                                        │
│ 📊 Katumpakan ng Transaksyon (30%)    │
│    • Dalas ng variance sa cash        │
│    • Bilang ng error                  │
│    • Dalas ng error sa resibo        │
│                                        │
│ ⚡ Kahusayan sa Serbisyo (25%)        │
│    • Average na oras ng checkout      │
│    • Arawang bilang ng customer       │
│    • Bilis ng pagproseso              │
│                                        │
│ 😊 Ugali sa Serbisyo (25%)            │
│    • Kasiyahan ng customer            │
│    • Kagalangan at tugon              │
│    • Kakayahang malutas ang problema  │
│                                        │
│ 📋 Pagsunod (20%)                     │
│    • Talaan ng pagdalo                │
│    • Katumpakan ng pamamaraan         │
│    • Pagsunod sa kaligtasan           │
│    • Kaayusan ng uniporme             │
│                                        │
└────────────────────────────────────────┘
```

---

### D. Landas ng Propesyonal na Pag-unlad

```
Landas ng Pag-unlad ng Karera ng Cashier

Entry-Level Cashier
    ↓
Senior Cashier (6 buwan-1 taon)
    ↓
Cashier Team Leader (1-2 taon)
    ↓
Counter Supervisor (2-3 taon)
    ↓
Floor Manager (3-5 taon)
    ↓
Store Manager/Operations Manager (5+ taon)

Mga Kailangang Pagpapahusay sa Kasanayan:
• Pagpapahusay ng propesyonal na kasanayan
• Pamumuno at pamamahala
• Kakayahang malutas ang problema
• Kakayahan sa pagsusuri ng negosyo
• Kakayahang magsanay ng staff
```

---

## 📝 Kasaysayan ng Bersyon

| Bersyon | Petsa      | Mga Update  |
| ------- | ---------- | ----------- |
| 2.0     | 2025-10-26 | Unang labas |
| -       | -          | Ina-update  |

---

## 🙏 Konklusyon

Salamat sa pagpili na maging cashier ng MakanMakan!

Ang trabaho ng cashier ay mukhang simple pero may malaking responsibilidad. Kayo ang huling punto ng pakikipag-ugnayan ng mga customer sa tindahan, at ang pangunahing tao na nag-iiwan ng huling impresyon.

**Mangyaring Tandaan:**

- 💰 **Katumpakan** ang pangunahing prinsipyo ng trabaho ng cashier
- 😊 **Kagalangan** ang basic na kinakailangan ng de-kalidad na serbisyo
- 🔒 **Integridad** ang pangunahing halaga ng propesyonal na etika
- 📚 **Pag-aaral** ang tanging landas sa propesyonal na paglaki

Umaasa na tutulungan kayo ng manual na ito na magsimula nang mabilis at maging kahusay na cashier!

Para sa anumang mga tanong o mungkahi, huwag mag-atubiling makipag-ugnayan sa amin anumang oras.

---

<div align="center">

**Gabay para sa Cashier ng MakanMakan**

Ginawa with ❤️ para sa aming mga cashier

**Bersyon 2.0** | **2025-10-26**

© 2025 MakanMakan. Lahat ng karapatan ay nakalaan.

</div>
