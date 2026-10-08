# 💰 Sổ Tay Thu Ngân MakanMakan

> **Phiên bản**: 2.0
> **Cập nhật lần cuối**: 2025-10-26
> **Đối tượng mục tiêu**: Thu ngân, Nhân viên quầy

---

## 📚 Mục Lục

1. [Bắt Đầu Nhanh](#bắt-đầu-nhanh)
2. [Tổng Quan Hệ Thống](#tổng-quan-hệ-thống)
3. [Giao Diện Hệ Thống Thu Ngân](#giao-diện-hệ-thống-thu-ngân)
4. [Quy Trình Thanh Toán Đơn Hàng](#quy-trình-thanh-toán-đơn-hàng)
5. [Phương Thức Thanh Toán](#phương-thức-thanh-toán)
6. [Xử Lý Biên Lai](#xử-lý-biên-lai)
7. [Hoàn Tiền & Hủy Đơn](#hoàn-tiền--hủy-đơn)
8. [Đối Soát Hàng Ngày](#đối-soát-hàng-ngày)
9. [Truy Vấn Báo Cáo](#truy-vấn-báo-cáo)
10. [Xử Lý Ngoại Lệ](#xử-lý-ngoại-lệ)
11. [Quản Lý Tiền Mặt](#quản-lý-tiền-mặt)
12. [Hướng Dẫn Bảo Mật](#hướng-dẫn-bảo-mật)
13. [Câu Hỏi Thường Gặp](#câu-hỏi-thường-gặp)

---

## 🚀 Bắt Đầu Nhanh

### Quy Trình Đăng Nhập Hệ Thống

```
┌─────────────────────────────────────────────┐
│ Quy Trình Đăng Nhập Thu Ngân                │
├─────────────────────────────────────────────┤
│                                             │
│  1️⃣ Mở Hệ Thống Thu Ngân                   │
│      ↓                                      │
│  2️⃣ Nhập Thông Tin Đăng Nhập Thu Ngân      │
│      ↓                                      │
│  3️⃣ Hệ Thống Xác Thực Quyền (Role=4)       │
│      ↓                                      │
│  4️⃣ Vào Không Gian Làm Việc Thu Ngân       │
│                                             │
└─────────────────────────────────────────────┘
```

### Danh Sách Kiểm Tra Mở Cửa Hàng Ngày

✅ **Trước Giờ Kinh Doanh**

- [ ] Đăng nhập vào hệ thống thu ngân
- [ ] Kiểm tra số tiền dự trữ trong ngăn kéo tiền
- [ ] Kiểm tra giấy in biên lai
- [ ] Xác nhận kết nối mạng
- [ ] Xem lại mục tiêu doanh số hàng ngày

✅ **Trong Giờ Kinh Doanh**

- [ ] Theo dõi đơn hàng chờ thanh toán
- [ ] Giữ ngăn kéo tiền ngăn nắp
- [ ] Thường xuyên kiểm tra chức năng POS
- [ ] Chú ý cảnh báo giao dịch bất thường

✅ **Sau Giờ Kinh Doanh**

- [ ] Thực hiện đối soát hàng ngày
- [ ] Đếm tiền và so sánh với sổ sách
- [ ] In báo cáo thanh toán hàng ngày
- [ ] Gửi tiền vào két an toàn
- [ ] Đăng xuất khỏi hệ thống

---

## 🏢 Tổng Quan Hệ Thống

### Phạm Vi Quyền Thu Ngân

```
┌─────────────────────────────────────────────────────────┐
│ Chức Năng Có Sẵn Cho Thu Ngân                          │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ✅ Thanh Toán Đơn Hàng   ✅ Xử Lý Thanh Toán          │
│  ✅ In Biên Lai            ✅ Yêu Cầu Hoàn Tiền        │
│  ✅ Thanh Toán Hàng Ngày  ✅ Truy Vấn Báo Cáo          │
│  ✅ Xác Minh Số Tiền      ✅ Báo Cáo Ngoại Lệ         │
│                                                         │
│  ❌ Quản Lý Thực Đơn      ❌ Quản Lý Nhân Viên         │
│  ❌ Sửa Đổi Giá          ❌ Cài Đặt Hệ Thống          │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Sơ Đồ Quy Trình Làm Việc

```
┌────────────────────────────────────────────────────────┐
│            Quy Trình Làm Việc Hàng Ngày Thu Ngân       │
├────────────────────────────────────────────────────────┤
│                                                        │
│  Khách Hàng Dùng Bữa Xong                              │
│       ↓                                                │
│  Truy Vấn Đơn Hàng ────→ Xác Nhận Chi Tiết Đơn        │
│       ↓                                                │
│  Tính Tổng Tiền ──→ Thông Báo Số Tiền Cho Khách       │
│       ↓                                                │
│  Chọn Phương Thức Thanh Toán ─→ Tiền Mặt/Thẻ/Khác     │
│       ↓                                                │
│  Thu Tiền ────→ Xác Minh Số Tiền Chính Xác            │
│       ↓                                                │
│  Hoàn Thành Thanh Toán ────→ In Biên Lai              │
│       ↓                                                │
│  Đưa Biên Lai ────→ Trả Tiền Thừa (nếu cần)           │
│       ↓                                                │
│  Cảm Ơn Khách Hàng ────→ Hẹn Gặp Lại                  │
│                                                        │
└────────────────────────────────────────────────────────┘
```

---

## 💻 Giao Diện Hệ Thống Thu Ngân

### Bảng Điều Khiển Chính

```
┌──────────────────────────────────────────────────────────┐
│                   Bảng Điều Khiển Thu Ngân               │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  ┌────────────────┐  ┌────────────────┐               │
│  │  Đơn Chờ XL    │  │  Doanh Số Hôm  │               │
│  │    12 Đơn      │  │  $25,680       │               │
│  └────────────────┘  └────────────────┘               │
│                                                          │
│  ┌──────────────────────────────────────────┐          │
│  │  Danh Sách Đơn Hàng                      │          │
│  ├──────┬──────┬─────────┬─────────┤          │
│  │ Bàn  │ Giờ  │ Số Tiền │ Trạng Th│          │
│  ├──────┼──────┼─────────┼─────────┤          │
│  │  A1  │ 12:35│  $580   │ Chờ XL  │ [Thanh Toán]│
│  │  B3  │ 12:42│  $820   │ Chờ XL  │ [Thanh Toán]│
│  │  C2  │ 12:50│  $450   │ Chờ XL  │ [Thanh Toán]│
│  └──────┴──────┴─────────┴─────────┘          │
│                                                          │
│  [Tìm Nhanh] [Lọc] [Báo Cáo] [Thanh Toán]             │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### Mô Tả Nút Chức Năng

| Nút                 | Chức Năng            | Mô Tả                                   |
| ------------------- | -------------------- | --------------------------------------- |
| 🔍 **Tìm Nhanh**    | Tìm Đơn Hàng         | Tìm theo bàn, số đơn hoặc số điện thoại |
| 📋 **Chi Tiết Đơn** | Xem Chi Tiết         | Hiển thị nội dung đơn hàng đầy đủ       |
| 💳 **Thanh Toán**   | Xử Lý Thanh Toán     | Vào quy trình thanh toán                |
| 🧾 **In Lại Biên Lai**    | In Lại               | In lại biên lai bị mất hoặc hỏng         |
| 🔄 **Hoàn Tiền**    | Xử Lý Hoàn Tiền      | Đăng ký hoàn tiền đơn hàng              |
| 📊 **Báo Cáo**      | Truy Vấn Báo Cáo     | Xem dữ liệu kinh doanh                  |
| 🔐 **Thanh Toán**   | Thanh Toán Hàng Ngày | Thực hiện đối soát cuối ngày            |

---

## 🧾 Quy Trình Thanh Toán Đơn Hàng

### Các Bước Thanh Toán Chuẩn

#### Bước 1: Truy Vấn Đơn Hàng

**Phương Pháp 1: Truy Vấn Theo Số Bàn**

```
1. Nhấp "Tìm Nhanh"
2. Nhập số bàn (ví dụ: A1, B3)
3. Hệ thống hiển thị tất cả đơn chưa thanh toán của bàn đó
4. Xác nhận đó là đơn hàng của khách
```

**Phương Pháp 2: Truy Vấn Theo Số Đơn Hàng**

```
1. Hỏi khách hàng số đơn hàng
2. Nhập số đơn hàng
3. Hệ thống hiển thị chi tiết đơn hàng
4. Xác nhận nội dung đơn hàng
```

**Phương Pháp 3: Truy Vấn Theo Số Điện Thoại**

```
1. Hỏi khách có phải thành viên không
2. Nhập số điện thoại của khách
3. Hệ thống liệt kê đơn chưa thanh toán của thành viên
4. Yêu cầu khách xác nhận đơn nào cần thanh toán
```

---

#### Bước 2: Xác Nhận Nội Dung Đơn Hàng

```
┌────────────────────────────────────────┐
│ Đơn Hàng #20251026-001                 │
├────────────────────────────────────────┤
│                                        │
│ Bàn: A1           Giờ: 12:35           │
│ Khách: Thành Viên 0912-345-678         │
│                                        │
│ ────────────────────────────────────  │
│                                        │
│ Món Ăn:                                │
│  • Phở Bò Đặc Biệt          x1   $150 │
│  • Phở Bò Kho               x1   $160 │
│  • Đĩa Khai Vị              x1   $ 80 │
│  • Trà Sữa Trân Châu        x2   $120 │
│                                        │
│ ────────────────────────────────────  │
│                                        │
│ Tạm Tính:                      $510    │
│ Phí Phục Vụ (10%):             $ 51    │
│ ────────────────────────────────────  │
│ Tổng Cộng:                     $561    │
│                                        │
└────────────────────────────────────────┘
```

**Điểm Kiểm Tra:**

- ✅ Xác minh số lượng món ăn chính xác
- ✅ Xác minh giá tính toán đúng
- ✅ Xác minh giảm giá đặc biệt được áp dụng
- ✅ Xác minh phí phục vụ có áp dụng

---

#### Bước 3: Chọn Phương Thức Thanh Toán

```
┌────────────────────────────────────────┐
│ Vui Lòng Chọn Phương Thức Thanh Toán   │
├────────────────────────────────────────┤
│                                        │
│  ┌──────────┐  ┌──────────┐          │
│  │ 💵 Tiền  │  │ 💳 Thẻ   │          │
│  │    Mặt   │  │          │          │
│  └──────────┘  └──────────┘          │
│                                        │
│  ┌──────────┐  ┌──────────┐          │
│  │ 📱 Ví    │  │ 🎫 Phiếu │          │
│  │    Điện  │  │    Giảm  │          │
│  └──────────┘  └──────────┘          │
│                                        │
│  ┌──────────────────────────┐        │
│  │    ⚡ Thanh Toán Kết Hợp  │        │
│  └──────────────────────────┘        │
│                                        │
└────────────────────────────────────────┘
```

---

#### Bước 4: Xử Lý Thanh Toán

**Quy Trình Thanh Toán Tiền Mặt:**

```
1️⃣ Thông báo tổng số tiền cho khách
   "Tổng cộng là $561"

2️⃣ Nhận tiền mặt
   Khách thanh toán: $1,000

3️⃣ Nhập số tiền nhận được
   Hệ thống tự động tính tiền thừa: $439

4️⃣ Xác nhận số tiền và nhấp "Hoàn Thành Thanh Toán"

5️⃣ Chuẩn bị tiền thừa
   - $400: 4 × tờ $100
   - $ 30: 3 × đồng $10
   - $  9: 1 × $5 + 4 × đồng $1

6️⃣ Nhắc lại số tiền thừa
   "Tiền thừa của quý khách là $439, cảm ơn"
```

**Quy Trình Thanh Toán Thẻ Tín Dụng:**

```
1️⃣ Chọn thanh toán "Thẻ Tín Dụng"
2️⃣ Nhập số tiền thanh toán: $561
3️⃣ Đưa/chạm thẻ tín dụng
4️⃣ Chờ xác thực...
5️⃣ Khách nhập mã PIN/ký tên
6️⃣ Giao dịch thành công ✅
7️⃣ In bản sao của người bán (cần ký tên)
8️⃣ Khách ký để xác nhận
9️⃣ Lưu biên lai đã ký
```

**Quy Trình Thanh Toán Ví Điện Tử:**

```
1️⃣ Chọn "Thanh Toán Ví Điện Tử"
2️⃣ Chọn nền tảng thanh toán
   • LINE Pay
   • Street Payment
   • Apple Pay
   • Google Pay

3️⃣ Hiển thị mã QR thanh toán
4️⃣ Khách quét mã QR
5️⃣ Chờ xác nhận thanh toán...
6️⃣ Thanh toán thành công ✅
7️⃣ Tự động hoàn thành thanh toán
```

---

#### Bước 5: In Biên Lai

```
┌────────────────────────────────────────┐
│          Nhà Hàng MakanMakan           │
│       MST: 12345678                    │
│   Địa chỉ: Số 7, Đường Tín Nghĩa, TP  │
│       Điện thoại: (02) 2345-6789       │
│                                        │
├────────────────────────────────────────┤
│                                        │
│ Ngày: 2025/10/26      Giờ: 12:45      │
│ Bàn: A1           Thu Ngân: Mary       │
│ Số Đơn: 20251026-001                   │
│                                        │
│ ────────────────────────────────────  │
│                                        │
│ Phở Bò Đặc Biệt        x1      $150    │
│ Phở Bò Kho             x1      $160    │
│ Đĩa Khai Vị            x1      $ 80    │
│ Trà Sữa Trân Châu      x2      $120    │
│                                        │
│ ────────────────────────────────────  │
│                                        │
│ Tạm Tính:                      $510    │
│ Phí Phục Vụ (10%):             $ 51    │
│ ────────────────────────────────────  │
│ Tổng Cộng:                     $561    │
│                                        │
│ Phương Thức: Tiền Mặt                  │
│ Số Tiền Nhận: $1,000                   │
│ Tiền Thừa: $439                        │
│                                        │
│ ────────────────────────────────────  │
│                                        │
│    Cảm ơn, hẹn gặp lại quý khách!      │
│                                        │
│         MakanMakan.com                 │
│                                        │
└────────────────────────────────────────┘
```

---

#### Bước 6: Hoàn Thành Giao Dịch

```
✅ Danh Sách Kiểm Tra Xác Nhận Cuối Cùng

1. [ ] Biên lai đã in
2. [ ] Số tiền thừa chính xác
3. [ ] Biên lai thẻ tín dụng đã ký (nếu có)
4. [ ] Đưa biên lai cho khách
5. [ ] Cảm ơn khách lịch sự
```

**Lời Chào Chuẩn:**

```
"Đây là biên lai và $439 tiền thừa của quý khách,
 vui lòng giữ cẩn thận. Cảm ơn quý khách đã dùng bữa,
 hẹn gặp lại!"
```

---

## 💳 Phương Thức Thanh Toán

### Thanh Toán Tiền Mặt

#### Hướng Dẫn Xử Lý Tiền Mặt

```
┌─────────────────────────────────────────────┐
│ Quy Trình Thu Tiền Mặt Chuẩn                │
├─────────────────────────────────────────────┤
│                                             │
│  1️⃣ Nói rõ số tiền                         │
│     "Tổng cộng là $561"                     │
│                                             │
│  2️⃣ Xác nhận mệnh giá nhận được            │
│     "Nhận $1,000"                           │
│                                             │
│  3️⃣ Đặt tiền lên quầy thu ngân (tránh tranh chấp) │
│                                             │
│  4️⃣ Nhập số tiền nhận trong hệ thống       │
│                                             │
│  5️⃣ Xác minh số tiền thừa chính xác        │
│     Hệ thống hiển thị: Tiền thừa $439      │
│                                             │
│  6️⃣ Đếm tiền thừa                          │
│     - Tờ lớn trước (trăm)                  │
│     - Sau đó xu (chục, đồng)               │
│                                             │
│  7️⃣ Nhắc lại số tiền thừa                  │
│     "Tiền thừa của quý khách là $439"      │
│                                             │
│  8️⃣ Cất tiền nhận vào ngăn kéo             │
│                                             │
└─────────────────────────────────────────────┘
```

#### Phát Hiện Tiền Giả

**Điểm Kiểm Tra:**

| Tờ Tiền      | Phương Pháp Xác Minh             |
| ------------ | -------------------------------- |
| 💵 **$1000** | Lá đổi màu, in chìm, sợi bảo mật |
| 💵 **$500**  | Số "500" ẩn, hình mờ hoa mận     |
| 💵 **$100**  | Mực đổi màu, chấm chữ nổi        |

**Xử Lý Tiền Nghi Ngờ:**

```
1. Đừng cáo buộc trực tiếp khách hàng
2. Lịch sự nói: "Xin lỗi, tờ tiền này có vẻ có vấn đề, quý khách có thể dùng tờ khác không?"
3. Nếu khách khăng khăng, yêu cầu trợ giúp quản lý
4. Giữ lại tờ tiền nghi ngờ, đưa cho quản lý hoặc cảnh sát
```

---

### Thanh Toán Thẻ Tín Dụng

#### Vận Hành Máy Quẹt Thẻ

```
┌─────────────────────────────────────────────┐
│ Quy Trình Giao Dịch Thẻ Tín Dụng           │
├─────────────────────────────────────────────┤
│                                             │
│  Quẹt/Đưa/Chạm Thẻ                          │
│       ↓                                     │
│  Nhập Số Tiền Giao Dịch                     │
│       ↓                                     │
│  Chờ Xác Thực (5-10 giây)                   │
│       ↓                                     │
│  ┌──────────┐  ┌──────────┐               │
│  │ Chấp Nhận│  │  Từ Chối │               │
│  └──────────┘  └──────────┘               │
│       ↓              ↓                      │
│  In Biên Lai    Thử Phương Thức Khác       │
│       ↓                                     │
│  Khách Ký Tên                               │
│       ↓                                     │
│  Xác Minh Chữ Ký                            │
│       ↓                                     │
│  Giao Dịch Hoàn Tất ✅                     │
│                                             │
└─────────────────────────────────────────────┘
```

#### Xử Lý Giao Dịch Thất Bại

| Thông Báo Lỗi               | Nguyên Nhân                | Giải Pháp                                                 |
| --------------------------- | -------------------------- | --------------------------------------------------------- |
| ❌ **Không Đủ Tiền**        | Vượt hạn mức tín dụng      | Yêu cầu khách dùng thẻ khác hoặc phương thức khác         |
| ❌ **Thẻ Hết Hạn**          | Thẻ quá hạn sử dụng        | Sử dụng thẻ còn hiệu lực                                  |
| ❌ **Giao Dịch Bị Từ Chối** | Ngân hàng từ chối xác thực | Đề nghị liên hệ ngân hàng phát hành hoặc phương thức khác |
| ❌ **Kết Nối Thất Bại**     | Vấn đề mạng                | Thử lại thẻ hoặc dùng tiền mặt                            |
| ❌ **Lỗi Đọc Thẻ**          | Vạch từ/chip hỏng          | Lau thẻ và thử lại hoặc dùng thẻ khác                     |

---

### Thanh Toán Ví Điện Tử

#### Nền Tảng Thanh Toán Được Hỗ Trợ

```
┌─────────────────────────────────────────┐
│ Thanh Toán Di Động Hỗ Trợ MakanMakan    │
├─────────────────────────────────────────┤
│                                         │
│  📱 LINE Pay          ✅ Hỗ Trợ        │
│  📱 Street Pay        ✅ Hỗ Trợ        │
│  📱 Apple Pay         ✅ Hỗ Trợ        │
│  📱 Google Pay        ✅ Hỗ Trợ        │
│  📱 EasyCard Pay      ✅ Hỗ Trợ        │
│  📱 Taiwan Pay        ✅ Hỗ Trợ        │
│                                         │
└─────────────────────────────────────────┘
```

#### Quy Trình Thanh Toán QR Code

```
1️⃣ Chọn "Thanh Toán Ví Điện Tử" trong hệ thống thu ngân
2️⃣ Chọn nền tảng thanh toán của khách
3️⃣ Hệ thống tạo mã QR thanh toán
4️⃣ Khách mở ứng dụng để quét mã QR
5️⃣ Khách xác nhận số tiền và hoàn thành thanh toán
6️⃣ Hệ thống nhận thông báo thanh toán (3-5 giây)
7️⃣ Hiển thị "Thanh Toán Thành Công" ✅
8️⃣ Tự động in biên lai
```

---

### Thanh Toán Kết Hợp

Khi khách sử dụng nhiều phương thức thanh toán:

```
Ví dụ: Tổng số tiền $1,200

Khách muốn dùng:
  • Phiếu giảm giá: $500
  • Thẻ tín dụng: Số tiền còn lại

Thủ tục:
1️⃣ Chọn "Thanh Toán Kết Hợp"
2️⃣ Xử lý phiếu giảm giá trước
   - Chọn "Phiếu Giảm Giá"
   - Nhập hoặc quét số phiếu
   - Hệ thống xác thực và trừ $500

3️⃣ Hệ thống hiển thị số tiền còn lại: $700
4️⃣ Xử lý số tiền còn lại
   - Chọn "Thẻ Tín Dụng"
   - Tính phí $700 vào thẻ

5️⃣ Giao dịch hoàn tất ✅
```

---

## Xử Lý Biên Lai

Hệ thống hiện chỉ in biên lai và không phát hành hóa đơn điện tử. Mỗi cửa hàng xử lý hóa đơn theo quy trình hiện có của mình.

---

## 🔄 Hoàn Tiền & Hủy Đơn

### Chính Sách Hoàn Tiền

```
┌─────────────────────────────────────────────┐
│ Chính Sách Hoàn Tiền MakanMakan             │
├─────────────────────────────────────────────┤
│                                             │
│  ✅ Hoàn Tiền Toàn Bộ:                      │
│     • Món ăn chưa chuẩn bị                 │
│     • Vấn đề chất lượng món ăn             │
│     • Món ăn sai                           │
│     • Lỗi dịch vụ nghiêm trọng             │
│                                             │
│  ⚠️ Hoàn Tiền Một Phần:                     │
│     • Một số món có vấn đề                 │
│     • Trải nghiệm ăn uống kém              │
│                                             │
│  ❌ Không Hoàn Tiền:                        │
│     • Đã dùng bữa xong                     │
│     • Chỉ là sở thích cá nhân              │
│     • Quá thời hạn hoàn tiền               │
│                                             │
└─────────────────────────────────────────────┘
```

---

### Quy Trình Xử Lý Hoàn Tiền

```
┌─────────────────────────────────────────────┐
│ Thủ Tục Hoàn Tiền Chuẩn                     │
├─────────────────────────────────────────────┤
│                                             │
│  Khách Yêu Cầu Hoàn Tiền                    │
│       ↓                                     │
│  Tìm Hiểu Lý Do Hoàn Tiền                   │
│       ↓                                     │
│  Kiểm Tra Đáp Ứng Chính Sách Hoàn Tiền      │
│       ↓                                     │
│  ┌──────────┐  ┌──────────┐               │
│  │Đáp Ứng   │  │Không ĐC  │               │
│  └──────────┘  └──────────┘               │
│       ↓              ↓                      │
│  Báo Quản Lý   Giải Thích Lịch Sự & Xin Lỗi │
│  Để Phê Duyệt                               │
│       ↓                                     │
│  Quản Lý Phê Duyệt                          │
│       ↓                                     │
│  Đăng Ký Hoàn Tiền Trong Hệ Thống           │
│       ↓                                     │
│  Hoàn Tiền Qua Phương Thức Thanh Toán Gốc   │
│       ↓                                     │
│  In Biên Lai Hoàn Tiền                      │
│       ↓                                     │
│  Khách Ký Xác Nhận                          │
│       ↓                                     │
│  Hoàn Tiền Xong ✅                          │
│                                             │
└─────────────────────────────────────────────┘
```

---

### Xử Lý Phương Thức Hoàn Tiền

#### Hoàn Tiền Mặt

```
1️⃣ Xác nhận đơn gốc là thanh toán tiền mặt
2️⃣ Tính số tiền hoàn
3️⃣ Lấy tiền từ ngăn kéo
4️⃣ Nhắc lại số tiền hoàn
5️⃣ Đưa tiền cho khách
6️⃣ Khách đếm và ký xác nhận
7️⃣ Hoàn thành ghi nhận hoàn tiền trong hệ thống
```

#### Hoàn Tiền Thẻ Tín Dụng

```
1️⃣ Xác nhận đơn gốc là thanh toán thẻ tín dụng
2️⃣ Chọn "Hoàn Tiền Thẻ Tín Dụng"
3️⃣ Hệ thống tự động đọc dữ liệu giao dịch gốc
4️⃣ Nhập số tiền hoàn
5️⃣ Máy quẹt thẻ thực hiện giao dịch hoàn tiền
6️⃣ Chờ ngân hàng xác thực (5-10 giây)
7️⃣ Hoàn tiền thành công ✅
8️⃣ In biên lai hoàn tiền
9️⃣ Thông báo khách: "Số tiền hoàn sẽ xuất hiện trong tài khoản trong 3-7 ngày làm việc"
```

#### Hoàn Tiền Ví Điện Tử

```
1️⃣ Chọn "Hoàn Tiền Ví Điện Tử"
2️⃣ Chọn nền tảng thanh toán gốc
3️⃣ Nhập số tiền hoàn
4️⃣ Hệ thống tự động thực hiện hoàn tiền
5️⃣ Hoàn tiền thành công ✅
6️⃣ Thông báo khách: "Số tiền hoàn sẽ được trả về tài khoản ngay lập tức"
```

---

### Ví Dụ Biên Lai Hoàn Tiền

```
┌────────────────────────────────────────┐
│         Biên Lai Hoàn Tiền MakanMakan  │
├────────────────────────────────────────┤
│                                        │
│ Ngày: 2025/10/26    Giờ: 14:30        │
│ Đơn Gốc: 20251026-001                 │
│ Lý Do Hoàn: Vấn đề chất lượng món ăn   │
│                                        │
│ ────────────────────────────────────  │
│                                        │
│ Số Tiền Gốc:             $561          │
│ Số Tiền Hoàn:            $561          │
│ Phương Thức Hoàn:        Tiền Mặt      │
│                                        │
│ ────────────────────────────────────  │
│                                        │
│ Thu Ngân: Mary                         │
│ Quản Lý Phê Duyệt: John                │
│                                        │
│ Chữ Ký Khách: ________________         │
│                                        │
│ Ngày: ____/____/____                   │
│                                        │
└────────────────────────────────────────┘
```

---

## 📊 Đối Soát Hàng Ngày

### Thời Gian Thanh Toán Cuối Ngày

```
✅ Khi nào thực hiện thanh toán cuối ngày?

1. Sau giờ kinh doanh kết thúc
2. Tất cả đơn hàng đã được thanh toán
3. Xác nhận không có hoàn tiền chờ xử lý
4. Sẵn sàng đếm tiền
```

---

### Quy Trình Thanh Toán Chuẩn

```
┌─────────────────────────────────────────────┐
│ Các Bước Thanh Toán Cuối Ngày               │
├─────────────────────────────────────────────┤
│                                             │
│  1️⃣ Đăng nhập vào hệ thống thu ngân        │
│      ↓                                      │
│  2️⃣ Chọn chức năng "Thanh Toán Hàng Ngày"  │
│      ↓                                      │
│  3️⃣ Hệ thống tự động tổng hợp dữ liệu hôm nay │
│      • Tổng doanh số                       │
│      • Số lượng giao dịch                  │
│      • Số tiền mỗi phương thức thanh toán  │
│      • Số tiền hoàn                        │
│      ↓                                      │
│  4️⃣ Đếm tiền thực tế trong ngăn kéo        │
│      ↓                                      │
│  5️⃣ Nhập số tiền đếm được thực tế          │
│      ↓                                      │
│  6️⃣ Hệ thống so sánh sổ sách với thực tế   │
│      ↓                                      │
│  ┌──────────┐  ┌──────────┐               │
│  │  Khớp    │  │ Chênh Lệch│               │
│  └──────────┘  └──────────┘               │
│      ↓              ↓                       │
│  7️⃣ In báo cáo     Tìm nguyên nhân         │
│      ↓              ↓                       │
│  8️⃣ Quản lý ký     Điền báo cáo chênh lệch │
│      ↓              ↓                       │
│  9️⃣ Gửi tiền       Quản lý xem xét         │
│      ↓                                      │
│  🔟 Thanh toán xong ✅                      │
│                                             │
└─────────────────────────────────────────────┘
```

---

### Báo Cáo Kinh Doanh Hàng Ngày

```
┌────────────────────────────────────────────────────┐
│           Báo Cáo Hàng Ngày MakanMakan             │
│           Ngày: 2025/10/26                         │
├────────────────────────────────────────────────────┤
│                                                    │
│ 【Tóm Tắt Kinh Doanh】                             │
│                                                    │
│  Giờ Kinh Doanh: 10:00 - 22:00                    │
│  Tổng Giao Dịch: 156                              │
│  Trung Bình/Giao Dịch: $428                       │
│  Tổng Doanh Số: $66,768                           │
│                                                    │
├────────────────────────────────────────────────────┤
│                                                    │
│ 【Thống Kê Phương Thức Thanh Toán】                │
│                                                    │
│  💵 Tiền Mặt:       $28,500  (42.7%)              │
│     Giao Dịch: 72                                 │
│                                                    │
│  💳 Thẻ Tín Dụng:   $26,890  (40.3%)              │
│     Giao Dịch: 58                                 │
│                                                    │
│  📱 Ví Điện Tử:     $11,378  (17.0%)              │
│     Giao Dịch: 26                                 │
│     └ LINE Pay:     $6,200                        │
│     └ Street Pay:   $3,450                        │
│     └ Khác:         $1,728                        │
│                                                    │
├────────────────────────────────────────────────────┤
│                                                    │
│ 【Đối Soát Tiền Mặt】                             │
│                                                    │
│  Tiền Dự Trữ Mở Đầu:               $5,000         │
│  Doanh Thu Tiền Mặt:              $28,500         │
│  Chi Tiền Mặt (Hoàn Tiền):          $450         │
│  ─────────────────────────────────              │
│  Số Tiền Sổ Sách:                 $33,050         │
│  Số Tiền Đếm Thực Tế:             $33,050         │
│  ─────────────────────────────────              │
│  Chênh Lệch:                          $0  ✅      │
│                                                    │
├────────────────────────────────────────────────────┤
│                                                    │
│ 【Thống Kê Hoàn Tiền】                            │
│                                                    │
│  Số Lần Hoàn: 3                                   │
│  Số Tiền Hoàn: $450                               │
│  Lý Do Hoàn:                                      │
│    • Vấn Đề Món Ăn: 2 ($320)                     │
│    • Hủy Đơn: 1 ($130)                           │
│                                                    │
├────────────────────────────────────────────────────┤
│                                                    │
│ 【Ngoại Lệ】                                       │
│                                                    │
│  ✅ Không có ngoại lệ ghi nhận                     │
│                                                    │
├────────────────────────────────────────────────────┤
│                                                    │
│ Thu Ngân: Mary              Chữ Ký: _________     │
│ Quản Lý: John               Chữ Ký: _________     │
│                                                    │
│ Thời Gian Thanh Toán: 2025/10/26 22:30            │
│                                                    │
└────────────────────────────────────────────────────┘
```

---

### Phiếu Đếm Tiền

```
┌────────────────────────────────────────┐
│        Phiếu Đếm Tiền                  │
│        Ngày: 2025/10/26                │
├────────────────────────────────────────┤
│                                        │
│ 【Tiền Giấy】                          │
│                                        │
│  $1,000  ×  20 tờ = $20,000            │
│  $  500  ×   8 tờ = $ 4,000            │
│  $  100  ×  82 tờ = $ 8,200            │
│                                        │
│  Tổng Tiền Giấy:     $32,200           │
│                                        │
│ ────────────────────────────────────  │
│                                        │
│ 【Tiền Xu】                            │
│                                        │
│  $   50  ×   8 đồng = $   400          │
│  $   10  ×  25 đồng = $   250          │
│  $    5  ×  20 đồng = $   100          │
│  $    1  × 100 đồng = $   100          │
│                                        │
│  Tổng Tiền Xu:       $   850           │
│                                        │
│ ────────────────────────────────────  │
│                                        │
│ 【Tổng Cộng】                          │
│                                        │
│  Đếm Thực Tế:        $33,050           │
│  Số Sổ Sách:         $33,050           │
│  Chênh Lệch:         $     0  ✅       │
│                                        │
│ ────────────────────────────────────  │
│                                        │
│ Người Đếm: Mary        Giờ: 22:25      │
│ Người Kiểm: John       Giờ: 22:30      │
│                                        │
└────────────────────────────────────────┘
```

---

### Xử Lý Chênh Lệch

**Khi số sổ sách không khớp với thực tế:**

```
Trường Hợp 1: Thực tế nhiều hơn sổ sách (Thừa)

1️⃣ Ghi nhận số tiền thừa
2️⃣ Đếm lại để xác nhận
3️⃣ Kiểm tra giao dịch chưa ghi nhận
4️⃣ Điền "Báo Cáo Chênh Lệch"
5️⃣ Quản lý xem xét
6️⃣ Để riêng số tiền thừa
7️⃣ Chờ đối soát ngày hôm sau


Trường Hợp 2: Thực tế ít hơn sổ sách (Thiếu)

1️⃣ Ghi nhận số tiền thiếu
2️⃣ Đếm lại để xác nhận
3️⃣ Nhớ lại quy trình giao dịch, tìm nguyên nhân:
   • Trả tiền thừa sai
   • Nhận tiền giả
   • Quên thu tiền
   • Nhập sai số tiền
4️⃣ Điền "Báo Cáo Chênh Lệch"
5️⃣ Quản lý xem xét
6️⃣ Xử lý theo chính sách công ty (bồi thường hoặc ghi nhận)
```

---

## 📈 Truy Vấn Báo Cáo

### Các Loại Báo Cáo Có Sẵn

```
┌─────────────────────────────────────────────┐
│ Báo Cáo Hệ Thống Thu Ngân                   │
├─────────────────────────────────────────────┤
│                                             │
│  📊 Báo Cáo Hàng Ngày                       │
│     • Tóm tắt kinh doanh hàng ngày         │
│     • Thống kê phương thức thanh toán      │
│     • Phân tích theo thời gian             │
│                                             │
│  📊 Báo Cáo Hàng Tuần                       │
│     • Xu hướng kinh doanh theo tuần        │
│     • So sánh tuần với tuần                │
│                                             │
│  📊 Báo Cáo Hàng Tháng                      │
│     • Thống kê kinh doanh tháng            │
│     • Xếp hạng doanh số tháng              │
│                                             │
│  📊 Chi Tiết Giao Dịch                      │
│     • Truy vấn giao dịch đơn lẻ            │
│     • Lịch sử giao dịch                    │
│                                             │
│  📊 Hồ Sơ Hoàn Tiền                         │
│     • Thống kê hoàn tiền                   │
│     • Phân tích lý do hoàn                 │
│                                             │
│  📊 Hiệu Suất Cá Nhân                       │
│     • Thống kê hiệu suất thu ngân          │
│     • Đánh giá dịch vụ                     │
│                                             │
└─────────────────────────────────────────────┘
```

---

### Các Bước Truy Vấn Báo Cáo

```
1️⃣ Đăng nhập vào hệ thống thu ngân
2️⃣ Nhấp "Truy Vấn Báo Cáo"
3️⃣ Chọn loại báo cáo
4️⃣ Đặt tham số truy vấn
   • Khoảng thời gian
   • Phương thức thanh toán
   • Trạng thái giao dịch
5️⃣ Nhấp "Truy Vấn"
6️⃣ Xem xét nội dung báo cáo
7️⃣ Tùy chọn "In" hoặc "Xuất"
```

---

### Truy Vấn Hiệu Suất Cá Nhân

```
┌────────────────────────────────────────┐
│     Hiệu Suất Tháng Của Mary           │
│     Tháng 10/2025                      │
├────────────────────────────────────────┤
│                                        │
│ Ngày Làm Việc: 22 ngày                 │
│ Tổng Giao Dịch: 867                    │
│ Tổng Số Tiền Giao Dịch: $346,890       │
│ Trung Bình Hàng Ngày: $15,768          │
│ Trung Bình/Giao Dịch: $400             │
│                                        │
│ ────────────────────────────────────  │
│                                        │
│ Phân Bổ Phương Thức Thanh Toán:        │
│  💵 Tiền Mặt: 45%                      │
│  💳 Thẻ Tín Dụng: 38%                  │
│  📱 Ví Điện Tử: 17%                    │
│                                        │
│ ────────────────────────────────────  │
│                                        │
│ Đánh Giá Dịch Vụ:                      │
│  ⭐⭐⭐⭐⭐  Hiệu Quả: 4.8/5.0          │
│  ⭐⭐⭐⭐⭐  Chính Xác: 4.9/5.0          │
│  ⭐⭐⭐⭐⭐  Thái Độ Phục Vụ: 5.0/5.0    │
│                                        │
│ ────────────────────────────────────  │
│                                        │
│ Hồ Sơ Ngoại Lệ:                        │
│  • Chênh Lệch Tiền: 0 lần ✅           │
│  • Khiếu Nại Khách: 0 lần ✅           │
│  • Đến Muộn: 0 lần ✅                  │
│                                        │
│ Xếp Hạng Tháng: 2/8 thu ngân           │
│                                        │
└────────────────────────────────────────┘
```

---

## ⚠️ Xử Lý Ngoại Lệ

### Các Trường Hợp Ngoại Lệ Thường Gặp

#### 1. Hệ Thống Treo

```
Triệu chứng: Hệ thống thu ngân không khởi động hoặc đóng đột ngột

Các bước:
1️⃣ Giữ bình tĩnh, xin lỗi khách hàng
2️⃣ Thông báo khách: "Hệ thống tạm thời không khả dụng, vui lòng đợi"
3️⃣ Ngay lập tức thông báo nhân viên IT hoặc quản lý
4️⃣ Thử khởi động lại hệ thống
5️⃣ Nếu không sửa được ngay:
   • Tạm thời dùng biên lai viết tay
   • Ghi nhận thông tin giao dịch
   • Nhập sau khi hệ thống phục hồi
6️⃣ Duy trì giao tiếp với khách, giảm lo lắng chờ đợi
```

---

#### 2. Máy In Biên Lai Trục Trặc

```
Triệu chứng: Không in được biên lai, kẹt giấy, in không rõ

Các bước:
1️⃣ Xác định nguyên nhân trục trặc
   • Hết giấy? → Thay cuộn giấy mới
   • Kẹt giấy? → Mở máy và lấy ra
   • In không rõ? → Vệ sinh đầu in

2️⃣ Nếu không sửa được ngay
   • Viết tay biên lai tạm thời
   • Ghi chú số đơn hàng
   • Thông báo khách in lại sau

3️⃣ Thông báo nhân viên bảo trì
4️⃣ Điền phiếu sửa chữa thiết bị
```

**Các Bước Thay Giấy In:**

```
1. Mở nắp trên máy in biên lai
2. Lấy ra cuộn cũ (nếu còn)
3. Đặt cuộn mới vào
4. Kéo giấy ra khoảng 10cm
5. Đóng nắp trên
6. Nhấn nút "Feed" để kiểm tra
```

---

#### 3. Máy Quẹt Thẻ Trục Trặc

```
Triệu chứng: Không đọc được thẻ, kết nối thất bại, giao dịch bất thường

Các bước:
1️⃣ Kiểm tra cơ bản
   • Xác nhận cáp nguồn đã cắm
   • Kiểm tra kết nối mạng
   • Thử khởi động lại

2️⃣ Nếu không sửa được ngay
   • Lịch sự thông báo khách: "Máy quẹt thẻ tạm thời không khả dụng"
   • Đề xuất phương thức thay thế:
     ✓ Tiền mặt
     ✓ Ví điện tử
     ✓ Trả sau

3️⃣ Thông báo quản lý và dịch vụ khách hàng ngân hàng
4️⃣ Điền báo cáo ngoại lệ thiết bị
```

---

#### 4. Mất Mạng

```
Triệu chứng: Không kết nối được, giao dịch thất bại, dữ liệu không tải lên

Các bước:
1️⃣ Xác nhận mất mạng hoàn toàn
   • Kiểm tra thiết bị khác có bình thường
   • Hỏi đồng nghiệp về tình hình

2️⃣ Chuyển sang chế độ ngoại tuyến (nếu có)
   • Dùng chức năng cục bộ
   • Ghi nhận thông tin giao dịch
   • Đồng bộ sau khi mạng phục hồi

3️⃣ Thông báo quản trị viên mạng
4️⃣ Nếu cần xử lý khẩn cấp:
   • Dùng điểm phát sóng di động
   • Viết tay ghi nhận giao dịch

5️⃣ Sau khi mạng phục hồi
   • Đồng bộ dữ liệu giao dịch ngoại tuyến
   • Xác nhận tính toàn vẹn dữ liệu
```

---

#### 5. Không Đủ Tiền Lẻ

```
Triệu chứng: Ngăn kéo tiền thiếu mệnh giá nhất định để trả lại

Các bước:
1️⃣ Lịch sự thông báo khách: "Xin lỗi, hiện tại thiếu tờ nhỏ"
2️⃣ Đưa ra phương án thay thế:
   • "Tôi có thể đưa quý khách mệnh giá khác được không?"
   • "Quý khách có thể dùng thẻ hoặc ví điện tử không?"
   • "Tôi sẽ lấy tiền lẻ từ quầy khác, vui lòng đợi"

3️⃣ Nhanh chóng mượn từ quầy khác
4️⃣ Hoàn thành trả lại
5️⃣ Xin lỗi và cảm ơn đã đợi
6️⃣ Ghi nhận nhu cầu tiền lẻ, thông báo quản lý bổ sung
```

---

#### 6. Nghi Ngờ Tiền Giả

```
Nguyên tắc xử lý: Giữ bình tĩnh, xử lý lịch sự, bảo vệ cả hai bên

Các bước:
1️⃣ Không cáo buộc trực tiếp khách hàng
2️⃣ Dùng thiết bị phát hiện để xác minh
3️⃣ Nếu thật sự nghi ngờ, lịch sự nói:
   "Xin lỗi, tờ tiền này có vẻ có vấn đề,
    tôi cần quản lý xác nhận,
    hoặc quý khách có thể dùng tờ khác?"

4️⃣ Ngay lập tức thông báo quản lý
5️⃣ Quản lý quyết định sau khi đánh giá:
   • Trả lại cho khách, yêu cầu đổi tờ khác
   • Giữ lại và báo cảnh sát

6️⃣ Giữ lịch sự suốt quá trình, tránh xung đột
7️⃣ Điền báo cáo ngoại lệ sau đó
```

---

#### 7. Khách Tranh Chấp Số Tiền

```
Triệu chứng: Khách cho rằng tính sai, tính nhiều

Các bước:
1️⃣ Giữ bình tĩnh và lịch sự
2️⃣ Nói: "Để tôi xác minh lại"
3️⃣ Kéo chi tiết đơn hàng
4️⃣ Giải thích từng món cho khách:
   "Đơn của quý khách là:
    • Phở OO $150
    • Cơm OO $120
    • Đồ uống $50
    Tổng là $320"

5️⃣ Nếu thật sự tính sai:
   • Chân thành xin lỗi
   • Ngay lập tức sửa
   • Hoàn lại tiền tính thừa hoặc thu thêm chênh lệch

6️⃣ Nếu số tiền đúng:
   • Kiên nhẫn giải thích
   • Xuất trình bảng giá
   • Yêu cầu quản lý hỗ trợ nếu cần

7️⃣ Điền hồ sơ khiếu nại khách hàng
```

---

#### 8. Hệ Thống Hiển Thị Số Tiền Bất Thường

```
Triệu chứng: Hệ thống hiển thị số tiền rõ ràng không hợp lý

Các bước:
1️⃣ Không thu theo số tiền hệ thống
2️⃣ Tính toán thủ công số tiền chính xác
3️⃣ Giải thích cho khách: "Hệ thống có vẻ sai, để tôi tính"
4️⃣ Thu đúng số tiền
5️⃣ Ghi chú ngoại lệ trên đơn hàng
6️⃣ Thông báo quản lý và nhân viên IT
7️⃣ Điền báo cáo ngoại lệ hệ thống
8️⃣ Chờ xác nhận sửa chữa
```

---

## 💵 Quản Lý Tiền Mặt

### Hướng Dẫn Quản Lý Ngăn Kéo Tiền

```
┌─────────────────────────────────────────────┐
│ Nguyên Tắc Vàng Ngăn Kéo Tiền              │
├─────────────────────────────────────────────┤
│                                             │
│  1️⃣ Ngăn kéo phải luôn khóa                │
│                                             │
│  2️⃣ Đóng ngăn kéo khi rời chỗ ngồi         │
│                                             │
│  3️⃣ Tờ lớn nhanh chóng vào két             │
│                                             │
│  4️⃣ Đếm thường xuyên, đảm bảo sổ khớp thực tế │
│                                             │
│  5️⃣ Tiền trong ngăn kéo không vượt hạn mức │
│     (Đề nghị không quá $50,000)            │
│                                             │
│  6️⃣ Mệnh giá khác nhau ở các ngăn, giữ gọn gàng │
│                                             │
│  7️⃣ Tờ lớn không đặt vào ngăn kéo trước (tránh tranh chấp) │
│                                             │
│  8️⃣ Không bao giờ đặt đồ cá nhân trong ngăn kéo │
│                                             │
└─────────────────────────────────────────────┘
```

---

### Cấu Hình Ngăn Kéo Tiền Chuẩn

```
┌─────────────────────────────────────────────────┐
│              Thiết Lập Ngăn Kéo Chuẩn           │
├─────────────────────────────────────────────────┤
│                                                 │
│  【Ngăn Tiền Giấy】                             │
│  ┌─────┬─────┬─────┬─────┬─────┐            │
│  │1000 │ 500 │ 200 │ 100 │Trống│            │
│  │     │     │     │     │     │            │
│  └─────┴─────┴─────┴─────┴─────┘            │
│                                                 │
│  【Ngăn Tiền Xu】                               │
│  ┌────┬────┬────┬────┬────┬────┐           │
│  │ 50 │ 10 │  5 │  1 │Trống│Trống│         │
│  │    │    │    │    │     │     │         │
│  └────┴────┴────┴────┴────┴────┘           │
│                                                 │
│  【Cấu Hình Tiền Dự Trữ Đề Nghị】               │
│  • $1000: 5 tờ = $5,000                        │
│  • $ 500: 4 tờ = $2,000                        │
│  • $ 100: 30 tờ = $3,000                       │
│  • $  50: 10 đồng = $  500                     │
│  • $  10: 30 đồng = $  300                     │
│  • $   5: 20 đồng = $  100                     │
│  • $   1: 100 đồng = $ 100                     │
│  ─────────────────────────────────            │
│  Tổng Dự Trữ:        $11,000                   │
│                                                 │
└─────────────────────────────────────────────────┘
```

---

### Thao Tác Gửi Tiền

**Khi nào gửi tiền?**

```
1️⃣ Tiền trong ngăn kéo vượt hạn mức ($50,000)
2️⃣ Quá nhiều tờ lớn ($1,000+)
3️⃣ Giữa ngày kinh doanh (giờ nghỉ trưa hoặc chiều)
4️⃣ Cuối ngày kinh doanh
```

**Quy Trình Gửi:**

```
1️⃣ Chuẩn bị túi gửi tiền
2️⃣ Đếm tiền cần gửi
3️⃣ Điền phiếu gửi
   • Ngày
   • Số tiền
   • Người gửi
   • Giờ
4️⃣ Đặt tiền và phiếu vào túi
5️⃣ Niêm phong túi gửi
6️⃣ Thông báo quản lý hoặc người được chỉ định
7️⃣ Hai người cùng giao tiền đến két
8️⃣ Ghi nhận gửi tiền trong hệ thống
9️⃣ Giữ biên lai gửi tiền
```

---

### Đếm Tiền

**Thời Điểm Đếm:**

- Trước khi bắt đầu kinh doanh hàng ngày
- Trong ca thay đổi
- Sau khi kết thúc kinh doanh hàng ngày
- Kiểm tra đột xuất của quản lý

**Các Bước Đếm:**

```
1️⃣ Dừng thu tiền (treo biển "Tạm Đóng")
2️⃣ Chuẩn bị phiếu đếm
3️⃣ Đếm bắt đầu từ mệnh giá lớn
   • $1000 × ____ = $ _____
   • $ 500 × ____ = $ _____
   • $ 100 × ____ = $ _____
   • $  50 × ____ = $ _____
   • $  10 × ____ = $ _____
   • $   5 × ____ = $ _____
   • $   1 × ____ = $ _____

4️⃣ Tính tổng số tiền
5️⃣ So sánh với số sổ sách hệ thống
6️⃣ Nếu chênh lệch, đếm lại
7️⃣ Ghi nhận kết quả đếm
8️⃣ Quản lý ký xác nhận
```

---

## 🔐 Hướng Dẫn Bảo Mật

### Bảo Mật Thông Tin

```
┌─────────────────────────────────────────────┐
│ Quy Tắc Bảo Mật Thông Tin Hệ Thống Thu Ngân │
├─────────────────────────────────────────────┤
│                                             │
│  🔒 Quản Lý Mật Khẩu                        │
│     • Không chia sẻ thông tin tài khoản    │
│     • Thay đổi mật khẩu thường xuyên (3 tháng) │
│     • Không viết mật khẩu lên giấy hay điện thoại │
│     • Phải đăng xuất khi rời chỗ           │
│                                             │
│  🔒 Bảo Vệ Thông Tin Khách Hàng             │
│     • Không tiết lộ thông tin cá nhân khách│
│     • Không chụp hoặc ghi thông tin thẻ    │
│     • Dữ liệu khách chỉ dùng cho kinh doanh│
│     • Không lấy ra hoặc chia sẻ bên ngoài  │
│                                             │
│  🔒 Sử Dụng Hệ Thống                        │
│     • Không dùng tài khoản người khác      │
│     • Không sửa cài đặt hệ thống           │
│     • Không cài phần mềm trái phép         │
│     • Báo cáo bất thường ngay lập tức      │
│                                             │
└─────────────────────────────────────────────┘
```

---

### Bảo Mật Tài Chính

```
┌─────────────────────────────────────────────┐
│ Biện Pháp Bảo Vệ An Toàn Tiền Bạc           │
├─────────────────────────────────────────────┤
│                                             │
│  💰 Biện Pháp Phòng Ngừa                    │
│                                             │
│  1️⃣ Cảnh giác với giao dịch lớn           │
│     • Xác minh tính xác thực tờ lớn        │
│     • Xác nhận người dùng thẻ là chủ thẻ   │
│     • Thông báo quản lý về giao dịch nghi ngờ │
│                                             │
│  2️⃣ Quản Lý Ngăn Kéo                       │
│     • Khóa ngăn kéo kịp thời               │
│     • Tiền lớn gửi kịp thời                │
│     • Không để người khác gần ngăn kéo     │
│                                             │
│  3️⃣ Phòng Chống Gian Lận                   │
│     • Không chấp nhận phương thức nghi ngờ │
│     • Không tuân theo thao tác bất thường  │
│     • Yêu cầu chuyển tiền qua điện thoại luôn là lừa đảo │
│                                             │
│  4️⃣ Bảo Vệ Giám Sát                        │
│     • Biết vị trí camera                   │
│     • Đảm bảo tình huống bất thường được ghi │
│     • Không che camera                     │
│                                             │
└─────────────────────────────────────────────┘
```

---

### An Toàn Cá Nhân

```
┌─────────────────────────────────────────────┐
│ Lưu Ý An Toàn Cá Nhân Thu Ngân              │
├─────────────────────────────────────────────┤
│                                             │
│  🚨 Khi Bị Đe Dọa Hoặc Cướp                 │
│                                             │
│  1️⃣ Giữ bình tĩnh, tuân theo yêu cầu       │
│  2️⃣ An toàn tính mạng quan trọng nhất, tiền thứ hai │
│  3️⃣ Không chống cự hoặc khiêu khích        │
│  4️⃣ Nhớ đặc điểm (chiều cao, giọng, dấu hiệu) │
│  5️⃣ Quan sát hướng thoát                   │
│  6️⃣ Gọi cảnh sát sau khi đảm bảo an toàn   │
│  7️⃣ Bảo toàn hiện trường, đợi cảnh sát     │
│  8️⃣ Hợp tác điều tra cảnh sát              │
│                                             │
│  ⚠️ Phương Pháp Trợ Giúp Khẩn Cấp           │
│                                             │
│  • Cảnh Sát: 110                           │
│  • Quản Lý Cửa Hàng: [Điện Thoại]          │
│  • Bảo Vệ: [Điện Thoại]                    │
│  • Vị Trí Nút Khẩn Cấp: [Vị Trí]           │
│                                             │
└─────────────────────────────────────────────┘
```

---

### Phòng Chống Lừa Đảo

**Phương Thức Lừa Đảo Thường Gặp:**

```
❌ Loại Lừa Đảo 1: Dịch Vụ Khách Hàng Giả
   "Tôi là dịch vụ khách hàng trụ sở, hệ thống có vấn đề,
    cần bạn giúp kiểm tra chức năng hoàn tiền..."

   → Không bao giờ tuân theo yêu cầu qua điện thoại
   → Cúp máy, liên hệ quản lý trực tiếp để xác minh


❌ Loại Lừa Đảo 2: Đổi Tờ Tiền
   Khách sau khi thanh toán nói: "Tôi muốn đổi tờ tiền đó"
   Nhân cơ hội đổi hoặc lấy thêm tiền

   → Tiền nhận ngay lập tức vào ngăn kéo
   → Không chấp nhận yêu cầu đổi tờ tiền


❌ Loại Lừa Đảo 3: Nhầm Lẫn Số Tiền
   "Tôi vừa đưa bạn $1000, tiền thừa sai rồi"
   Thực tế đưa $500

   → Đặt tờ lớn lên quầy thu ngân trước
   → Lớn tiếng nhắc lại "Nhận $1000"
   → Cất tờ tiền vào ngăn kéo sau khi đưa tiền thừa


❌ Loại Lừa Đảo 4: Màn Hình Thanh Toán Giả
   Điện thoại hiển thị thanh toán xong, thực tế chưa

   → Phải xác nhận hệ thống nhận thanh toán
   → Không chỉ xem màn hình điện thoại khách
   → Đợi xác nhận hệ thống trước khi hoàn thành thanh toán
```

---

## ❓ Câu Hỏi Thường Gặp

### Q1: Khách nói quên tiền thì sao?

```
A: Xử lý lịch sự

1️⃣ Giữ thân thiện
   "Không sao, quý khách có phương thức thanh toán khác không?"

2️⃣ Đưa ra tùy chọn
   • "Quý khách có thể dùng thẻ tín dụng hoặc ví điện tử không?"
   • "Gần đây có ATM, quý khách muốn rút tiền? Chúng tôi có thể giữ đơn"
   • "Bạn của quý khách có thể giúp chuyển tiền không?"

3️⃣ Giải pháp cuối cùng
   • Thông báo quản lý
   • Quản lý quyết định có:
     → Để khách để lại thông tin liên hệ, trả sau
     → Ghi nhận thông tin ID
     → Báo cảnh sát (nếu thái độ kém hoặc tái phạm)
```

---

### Q2: Khách yêu cầu giảm giá thì sao?

```
A: Phản hồi chuẩn

1️⃣ Lịch sự giải thích
   "Xin lỗi, giá do công ty quy định,
    tôi không có quyền thay đổi"

2️⃣ Đưa ra phương án thay thế
   • "Chúng tôi có ưu đãi thành viên, đăng ký để lần sau giảm giá"
   • "Khuyến mãi hiện tại là..."
   • "Quý khách có phiếu giảm giá không?"

3️⃣ Nếu khách khăng khăng
   • "Để tôi gọi quản lý hỗ trợ"
   • Quản lý quyết định có cho giảm giá

⚠️ Lưu ý:
   Thu ngân không thể tự ý giảm giá
   Mọi điều chỉnh giá cần quản lý phê duyệt
```

---

### Q3: Biên lai bị mất hoặc in không rõ thì sao?

Xác nhận số đơn hàng và hồ sơ thanh toán, sau đó in lại biên lai và đưa cho khách. Nhờ quản lý hỗ trợ nếu không thể in lại.

---

### Q4: Khách nói đã trả nhưng hệ thống không có?

```
A: Xử lý tranh chấp thanh toán

1️⃣ Giữ bình tĩnh và lịch sự
   "Để tôi xác minh cho quý khách"

2️⃣ Kiểm tra hồ sơ hệ thống
   • Truy vấn trạng thái đơn hàng
   • Xác nhận hồ sơ thanh toán
   • Kiểm tra thời gian giao dịch

3️⃣ Nếu thanh toán ví điện tử
   • Yêu cầu khách xuất trình màn hình thành công
   • Xác minh số giao dịch
   • Xác nhận số tiền và thông tin người bán

4️⃣ Nếu thật sự đã trả nhưng hệ thống chưa cập nhật
   • Ngay lập tức thông báo quản lý và IT
   • Không thu lại
   • Đợi đồng bộ hệ thống

5️⃣ Nếu không xác nhận được
   • Yêu cầu quản lý hỗ trợ
   • Kiểm tra sao kê ngân hàng
   • Xem lại camera giám sát (nếu cần)
```

---

### Q5: Phát hiện thiếu tiền sau khi đóng cửa?

```
A: Xử lý thiếu tiền

1️⃣ Ngay lập tức đếm lại
   Đảm bảo không có lỗi tính toán

2️⃣ Điền "Báo Cáo Chênh Lệch"
   • Ghi nhận số tiền thiếu
   • Giải thích nguyên nhân có thể
   • Nhớ lại giao dịch nghi ngờ

3️⃣ Thông báo quản lý
   • Báo cáo tình hình
   • Hợp tác điều tra

4️⃣ Xem lại camera
   • Kiểm tra quy trình giao dịch
   • Tìm nguyên nhân có thể

5️⃣ Theo dõi
   • Bồi thường hoặc ghi nhận theo chính sách công ty
   • Cải thiện biện pháp phòng ngừa
   • Tăng cường quản lý tiền mặt

Phòng ngừa:
✅ Cẩn thận xác minh mỗi giao dịch
✅ Thường xuyên đếm ngăn kéo
✅ Đặc biệt chú ý giao dịch lớn
✅ Đếm khi thay ca
```

---

### Q6: Khách nói không nhận được biên lai thẻ?

```
A: Xử lý in lại biên lai

1️⃣ Xác nhận giao dịch đã hoàn thành
   • Kiểm tra hồ sơ hệ thống
   • Xác nhận thanh toán đã thanh toán

2️⃣ In lại biên lai
   • Vào hồ sơ giao dịch
   • Chọn giao dịch đó
   • Nhấp "In Lại Biên Lai"
   • Đánh dấu "BẢN SAO"

3️⃣ Khách ký
   • Xác minh chữ ký khớp mặt sau thẻ
   • Lưu biên lai để lưu trữ

4️⃣ Ghi nhận lý do in lại
   • Ghi chú trong hệ thống
   • Tránh xử lý trùng lặp
```

---

### Q7: Gặp khách khó hoặc khiếu nại thì sao?

```
A: Nguyên tắc xử lý khiếu nại

1️⃣ Giữ chuyên nghiệp và bình tĩnh
   • Không tranh cãi với khách
   • Không phản ứng cảm xúc
   • Luôn giữ lịch sự

2️⃣ Lắng nghe quan tâm của khách
   "Tôi hiểu cảm giác của quý khách, vui lòng cho biết chuyện gì xảy ra"

3️⃣ Thông cảm và xin lỗi
   "Tôi xin lỗi vì sự bất tiện"

4️⃣ Đề xuất giải pháp
   • Xử lý trong quyền hạn
   • Yêu cầu quản lý nếu vượt quyền

5️⃣ Ghi nhận nội dung khiếu nại
   • Điền phiếu khiếu nại
   • Mô tả sự việc
   • Ghi nhận giải quyết

6️⃣ Theo dõi
   • Xác nhận vấn đề đã giải quyết
   • Theo dõi với khách nếu cần

Nguyên tắc quan trọng:
⚠️ Không bao giờ xung đột với khách
⚠️ Tìm kiếm trợ giúp ngay lập tức nếu bị xúc phạm hoặc đe dọa
⚠️ An toàn cá nhân quan trọng nhất
```

---

### Q8: Tôi có thể giảm giá cho bạn khi họ đến không?

```
A: Không ❌

Giải thích:
1. Điều này vi phạm chính sách công ty
2. Lạm dụng quyền hạn
3. Có thể dẫn đến:
   • Cảnh cáo bằng văn bản
   • Khấu trừ lương
   • Chấm dứt hợp đồng

Cách tiếp cận đúng:
✅ Bạn bè phải trả bình thường
✅ Nếu có ưu đãi nhân viên, áp dụng theo chính sách
✅ Không tự ý giảm giá
✅ Mọi giảm giá cần quản lý phê duyệt
```

---

### Q9: Tôi có thể ứng tiền cho khách không?

```
A: Không khuyến khích ⚠️

Lý do:
1. Gây nhầm lẫn kế toán
2. Có thể không thu hồi được
3. Vi phạm quy tắc quản lý dòng tiền

Trường hợp ngoại lệ (cần quản lý phê duyệt):
• Khách quen tạm quên tiền
• Số tiền rất nhỏ
• Quản lý đồng ý và ghi nhận

Quy trình đúng:
1️⃣ Không tự ý ứng
2️⃣ Hỏi ý kiến quản lý
3️⃣ Nếu được phê duyệt ứng:
   • Điền phiếu ứng
   • Ghi nhận thông tin liên hệ khách
   • Đặt thời hạn hoàn trả
   • Quản lý ký
4️⃣ Theo dõi thu hồi
```

---

### Q10: Hết ca nhưng còn khách cần thanh toán?

```
A: Hoàn thành dịch vụ trước khi đi

Đạo đức nghề nghiệp:
✅ Phục vụ khách cuối cùng
✅ Hoàn thành bàn giao ca
✅ Đảm bảo tài khoản chính xác
✅ Không để lộn xộn cho ca sau

Cách tiếp cận đúng:
1️⃣ Tiếp tục phục vụ khách
2️⃣ Duy trì thái độ tốt (không tỏ ra thiếu kiên nhẫn)
3️⃣ Sau khi thanh toán xong:
   • Đếm ngăn kéo tiền
   • In báo cáo ca
   • Bàn giao cho nhân viên ca sau
   • Có thể đi sau khi quản lý ký

Nếu thật sự có việc gấp:
• Thông báo quản lý trước
• Nhờ đồng nghiệp giúp
• Hoàn thành bàn giao cơ bản
```

---

## 📞 Thông Tin Liên Hệ

### Liên Hệ Nội Bộ

```
┌─────────────────────────────────────────┐
│ Cửa Sổ Liên Hệ Liên Quan Thu Ngân       │
├─────────────────────────────────────────┤
│                                         │
│  👔 Quản Lý Cửa Hàng                    │
│     Máy Lẻ: 101                         │
│     Di Động: [Điện Thoại]               │
│     Xử lý: Nhân sự, khiếu nại, khẩn cấp │
│                                         │
│  💻 Nhân Viên IT                        │
│     Máy Lẻ: 201                         │
│     Di Động: [Điện Thoại]               │
│     Xử lý: Vấn đề hệ thống, mạng        │
│                                         │
│  🔧 Nhân Viên Bảo Trì                   │
│     Máy Lẻ: 301                         │
│     Di Động: [Điện Thoại]               │
│     Xử lý: Trục trặc thiết bị, phần cứng │
│                                         │
│  📊 Phòng Kế Toán                       │
│     Máy Lẻ: 102                         │
│     Email: accounting@makanmakan.com    │
│     Xử lý: Kế toán, vấn đề biên lai     │
│                                         │
└─────────────────────────────────────────┘
```

---

### Liên Hệ Bên Ngoài

```
┌─────────────────────────────────────────┐
│ Liên Hệ Hỗ Trợ Bên Ngoài                │
├─────────────────────────────────────────┤
│                                         │
│  🏦 Dịch Vụ Khách Hàng Ngân Hàng        │
│     Máy quẹt thẻ, câu hỏi giao dịch     │
│     [Tên Ngân Hàng]: 0800-XXX-XXX      │
│                                         │
│  📱 Dịch Vụ KH Thanh Toán Di Động       │
│     LINE Pay:                          │
│     Street Pay:                         │
│     Nền Tảng Khác:                      │
│                                         │
│  🚨 Trợ Giúp Khẩn Cấp                   │
│     Cảnh Sát: 110                      │
│     Cứu Hỏa: 119                       │
│     Bảo Vệ: [Điện Thoại]               │
│                                         │
│  🛠️ Nhà Cung Cấp Thiết Bị               │
│     Hệ Thống POS: [Điện Thoại]         │
│     Máy Quẹt Thẻ: [Điện Thoại]         │
│                                         │
└─────────────────────────────────────────┘
```

---

## 🎓 Phụ Lục

### A. Cụm Từ Chuẩn Thu Ngân

**Chào Hỏi:**

```
"Xin chào, chào mừng quý khách!"
"Xin chào, ăn tại chỗ hay mang đi?"
```

**Trong Lúc Thanh Toán:**

```
"Xin chào, quý khách sẵn sàng thanh toán chưa?"
"Tổng cộng là $XXX"
"Quý khách muốn thanh toán bằng gì?"
"Nhận $XXX"
"Tiền thừa của quý khách là $XXX, vui lòng kiểm tra"
```

**Đưa Biên Lai:**

```
"Đây là biên lai của quý khách, vui lòng giữ"
"Cảm ơn đã dùng bữa, hẹn gặp lại!"
```

**Gặp Vấn Đề:**

```
"Xin lỗi, vui lòng đợi một chút"
"Xin lỗi đã để quý khách đợi"
"Cảm ơn sự kiên nhẫn của quý khách"
```

---

### B. Phím Tắt

| Chức Năng     | Phím Tắt   |
| ------------- | ---------- |
| Tìm Nhanh     | F1         |
| Thanh Toán    | F2         |
| Hủy           | ESC        |
| In Biên Lai    | Ctrl+P     |
| In Lại        | Ctrl+R     |
| Hoàn Tiền     | Ctrl+Alt+R |
| Khóa Màn Hình | Ctrl+L     |
| Đăng Xuất     | Ctrl+Q     |
| Trợ Giúp      | F12        |

---

### C. Tiêu Chuẩn Hiệu Suất Thu Ngân

```
┌────────────────────────────────────────┐
│        Đánh Giá Hiệu Suất Thu Ngân     │
├────────────────────────────────────────┤
│                                        │
│ 📊 Độ Chính Xác Giao Dịch (30%)       │
│    • Tần suất chênh lệch tiền         │
│    • Số lần lỗi                       │
│    • Tần suất lỗi biên lai            │
│                                        │
│ ⚡ Hiệu Quả Dịch Vụ (25%)              │
│    • Thời gian thanh toán trung bình  │
│    • Số khách hàng hàng ngày          │
│    • Tốc độ xử lý                     │
│                                        │
│ 😊 Thái Độ Dịch Vụ (25%)              │
│    • Độ hài lòng khách hàng           │
│    • Lịch sự và phản hồi              │
│    • Khả năng giải quyết vấn đề       │
│                                        │
│ 📋 Tuân Thủ (20%)                     │
│    • Hồ sơ chuyên cần                 │
│    • Tính đúng đắn quy trình          │
│    • Tuân thủ an toàn                 │
│    • Diện mạo đồng phục               │
│                                        │
└────────────────────────────────────────┘
```

---

### D. Con Đường Phát Triển Nghề Nghiệp

```
Con Đường Phát Triển Sự Nghiệp Thu Ngân

Thu Ngân Cấp Cơ Bản
    ↓
Thu Ngân Cao Cấp (6 tháng-1 năm)
    ↓
Trưởng Nhóm Thu Ngân (1-2 năm)
    ↓
Giám Sát Quầy (2-3 năm)
    ↓
Quản Lý Tầng (3-5 năm)
    ↓
Quản Lý Cửa Hàng/Quản Lý Vận Hành (5+ năm)

Kỹ Năng Cần Nâng Cao:
• Kỹ năng chuyên môn nâng cao
• Lãnh đạo và quản lý
• Khả năng giải quyết vấn đề
• Khả năng phân tích kinh doanh
• Khả năng đào tạo nhân viên
```

---

## 📝 Lịch Sử Phiên Bản

| Phiên Bản | Ngày       | Cập Nhật          |
| --------- | ---------- | ----------------- |
| 2.0       | 2025-10-26 | Phát hành ban đầu |
| -         | -          | Sẽ cập nhật       |

---

## 🙏 Kết Luận

Cảm ơn bạn đã chọn trở thành thu ngân MakanMakan!

Công việc thu ngân có vẻ đơn giản nhưng mang trách nhiệm lớn. Bạn là điểm tiếp xúc cuối cùng khách hàng có ở cửa hàng, và là người chính để lại ấn tượng cuối cùng.

**Vui Lòng Nhớ:**

- 💰 **Chính xác** là nguyên tắc đầu tiên của công việc thu ngân
- 😊 **Lịch sự** là yêu cầu cơ bản của dịch vụ chất lượng
- 🔒 **Trung thực** là giá trị cốt lõi của đạo đức nghề nghiệp
- 📚 **Học hỏi** là con đường duy nhất để phát triển chuyên nghiệp

Hy vọng cuốn sổ tay này giúp bạn bắt đầu nhanh chóng và trở thành thu ngân xuất sắc!

Đối với bất kỳ câu hỏi hoặc đề xuất nào, vui lòng liên hệ với chúng tôi bất cứ lúc nào.

---

<div align="center">

**Sổ Tay Thu Ngân MakanMakan**

Được xây dựng với ❤️ cho thu ngân của chúng tôi

**Phiên Bản 2.0** | **2025-10-26**

© 2025 MakanMakan. Bảo lưu mọi quyền.

</div>
