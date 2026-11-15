# 🏪 Hướng Dẫn Sử Dụng MakanMakan Cho Chủ Nhà Hàng

> **Phiên bản**: 2.0
> **Cập nhật**: 2025-10-26
> **Đối tượng**: Chủ nhà hàng, Quản lý
> **Gói, dùng thử và mức dùng**: Chủ cửa hàng tự đổi gói tại "Gói & Mức dùng" trong trang quản trị (nâng cấp có hiệu lực ngay, hạ cấp có hiệu lực vào cuối kỳ, không cần thanh toán trực tuyến). Xem [Gói, dùng thử và mức dùng](../vi-VN/plans-and-usage.html).

---

## 📚 Mục Lục

1. [Bắt Đầu Nhanh](#bắt-đầu-nhanh)
2. [Tổng Quan Hệ Thống](#tổng-quan-hệ-thống)
3. [Cài Đặt Cơ Bản](#cài-đặt-cơ-bản)
4. [Quản Lý Thực Đơn](#quản-lý-thực-đơn)
5. [Quản Lý Bàn & Ghế](#quản-lý-bàn--ghế)
6. [Hệ Thống Mã QR](#hệ-thống-mã-qr)
7. [Quản Lý Đơn Hàng](#quản-lý-đơn-hàng)
8. [Quản Lý Nhân Viên](#quản-lý-nhân-viên)
9. [Quản Lý Khách Hàng](#quản-lý-khách-hàng)
10. [Hệ Thống Lịch Làm Việc](#hệ-thống-lịch-làm-việc)
11. [Quản Lý Nghỉ Phép](#quản-lý-nghỉ-phép)
12. [Phân Tích Kinh Doanh](#phân-tích-kinh-doanh)
13. [Phân Tích AI](#phân-tích-ai)
14. [Câu Hỏi Thường Gặp](#câu-hỏi-thường-gặp)

---

## 🚀 Bắt Đầu Nhanh

### Quy Trình Đăng Nhập

```
┌─────────────────────────────────────────────┐
│ Quy Trình Đăng Nhập                         │
├─────────────────────────────────────────────┤
│                                             │
│  1️⃣ Mở Trang Quản Trị                      │
│      ↓                                      │
│  2️⃣ Nhập Tài Khoản & Mật Khẩu              │
│      ↓                                      │
│  3️⃣ Hệ Thống Xác Thực                      │
│      ↓                                      │
│  4️⃣ Vào Bảng Điều Khiển                    │
│                                             │
└─────────────────────────────────────────────┘
```

### Danh Sách Kiểm Tra Lần Đầu

✅ **Bước 1: Hoàn Thành Thông Tin Nhà Hàng**

- Tên nhà hàng, địa chỉ, thông tin liên hệ
- Cài đặt giờ làm việc
- Tải ảnh nhà hàng

✅ **Bước 2: Xây Dựng Thực Đơn**

- Thêm danh mục món ăn
- Tải thông tin món ăn
- Đặt giá và hình ảnh

✅ **Bước 3: Thiết Lập Bàn**

- Tạo thông tin bàn
- Tạo mã QR
- In và dán mã QR

✅ **Bước 4: Thêm Tài Khoản Nhân Viên**

- Tạo hồ sơ nhân viên
- Phân quyền vai trò
- Gửi thông tin đăng nhập

✅ **Bước 5: Bắt Đầu Hoạt Động**

- Kiểm tra quy trình đặt hàng
- Xác nhận nhận đơn hàng
- Giám sát hoạt động

---

## 🏢 Tổng Quan Hệ Thống

### Phạm Vi Quyền Chủ Nhà Hàng

```
┌─────────────────────────────────────────────────────────┐
│ Chức Năng Quản Lý Của Chủ Nhà Hàng                      │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌──────────────┐    ┌──────────────┐                 │
│  │  Cài Đặt     │───→│  Quản Lý     │                 │
│  │  Nhà Hàng    │    │  Thực Đơn    │                 │
│  └──────────────┘    └──────────────┘                 │
│         ↓                    ↓                         │
│  ┌──────────────┐    ┌──────────────┐                 │
│  │  Quản Lý Bàn │───→│  Hệ Thống    │                 │
│  │              │    │  Mã QR       │                 │
│  └──────────────┘    └──────────────┘                 │
│         ↓                    ↓                         │
│  ┌──────────────┐    ┌──────────────┐                 │
│  │  Quản Lý     │───→│  Quản Lý     │                 │
│  │  Đơn Hàng    │    │  Nhân Viên   │                 │
│  └──────────────┘    └──────────────┘                 │
│         ↓                    ↓                         │
│  ┌──────────────┐    ┌──────────────┐                 │
│  │  Phân Tích   │───→│  Phân Tích   │                 │
│  │  Kinh Doanh  │    │  AI          │                 │
│  └──────────────┘    └──────────────┘                 │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Chế Độ Cộng Tác Nhiều Vai Trò

```
     Chủ Nhà Hàng (Bạn)
           │
    ┌──────┼──────┬──────┐
    ↓      ↓      ↓      ↓
  Đầu bếp Phục vụ Thu ngân Khách
    │      │      │      │
    └──────┴──────┴──────┘
           │
    Nền tảng Thời gian Thực
```

**Giải thích**:

- **Chủ**: Quyền quản lý đầy đủ, xem tất cả dữ liệu
- **Đầu bếp**: Nhận đơn, cập nhật trạng thái nấu
- **Phục vụ**: Xác nhận giao món, cập nhật tiến độ
- **Thu ngân**: Xử lý thanh toán, xem doanh thu
- **Khách**: Quét QR đặt món, theo dõi đơn hàng

---

## ⚙️ Cài Đặt Cơ Bản

### Quản Lý Thông Tin Nhà Hàng

Đi tới: **Bảng Điều Khiển → Cài Đặt Nhà Hàng → Thông Tin Cơ Bản**

#### Thông Tin Bắt Buộc

| Trường       | Mô Tả                          | Ví Dụ                                |
| ------------ | ------------------------------ | ------------------------------------ |
| Tên Nhà Hàng | Tên hiển thị cho khách         | Nhà Hàng Hải Sản Ngon                |
| Địa Chỉ      | Địa chỉ đầy đủ với mã bưu điện | 123 Đường Nguyễn Huệ, Quận 1, TP.HCM |
| Điện Thoại   | Đường dây dịch vụ khách hàng   | 028-1234-5678                        |
| Giờ Làm Việc | Giờ hoạt động hàng ngày        | 11:00-14:00, 17:00-21:00             |
| Mô Tả        | Giới thiệu, đặc điểm           | Hải sản tươi và món truyền thống     |

#### Cấu Hình Giờ Làm Việc

```
┌─────────────────────────────────────────┐
│ Ví Dụ Giờ Làm Việc                      │
├─────────────────────────────────────────┤
│                                         │
│  Thứ Hai - Thứ Sáu:                     │
│  ├─ Bữa trưa: 11:00 - 14:00            │
│  └─ Bữa tối: 17:00 - 21:00             │
│                                         │
│  Thứ Bảy - Chủ Nhật:                    │
│  └─ Cả ngày: 11:00 - 21:00             │
│                                         │
│  Ngày nghỉ: Thứ Tư hàng tuần           │
│                                         │
└─────────────────────────────────────────┘
```

### Tải Ảnh Nhà Hàng

Định dạng hỗ trợ: JPG, PNG, WebP
Kích thước đề xuất: 1920x1080 pixels
Kích thước file: Tối đa 5MB

**Các Bước Tải Lên**:

1. Nhấp "Tải Ảnh Lên"
2. Chọn ảnh ngoại thất hoặc món ăn đặc trưng
3. Hệ thống tự động nén và tạo nhiều kích thước
4. Xem trước và lưu

---

## 🍽️ Quản Lý Thực Đơn

### Cấu Trúc Thực Đơn

```
Thực Đơn Nhà Hàng
  │
  ├── Danh Mục 1: Khai Vị
  │    ├── Món A
  │    ├── Món B
  │    └── Món C
  │
  ├── Danh Mục 2: Món Chính
  │    ├── Món D
  │    ├── Món E
  │    └── Món F
  │
  └── Danh Mục 3: Tráng Miệng
       ├── Món G
       └── Món H
```

### Thêm Danh Mục

Đi tới: **Quản Lý Thực Đơn → Quản Lý Danh Mục → Thêm Danh Mục**

#### Cài Đặt Danh Mục

| Cài Đặt      | Mô Tả                          | Ví Dụ         |
| ------------ | ------------------------------ | ------------- |
| Tên Danh Mục | Tiêu đề hiển thị trên thực đơn | Món Hải Sản   |
| Biểu Tượng   | Ký hiệu biểu tượng (tùy chọn)  | 🦐            |
| Thứ Tự       | Thứ tự hiển thị                | 1, 2, 3...    |
| Trạng Thái   | Hiển thị trên thực đơn         | Hoạt động/Tắt |

#### Thực Hành Tốt Nhất Quản Lý Danh Mục

```
┌─────────────────────────────────────────┐
│ Cấu Trúc Danh Mục Đề Xuất               │
├─────────────────────────────────────────┤
│                                         │
│  1. 🥗 Khai Vị / Món Khai Vị           │
│  2. 🥘 Món Chính / Đặc Biệt            │
│  3. 🍜 Mì & Cơm                        │
│  4. 🥤 Đồ Uống                         │
│  5. 🍰 Tráng Miệng                     │
│  6. ⭐ Đặc Biệt Hôm Nay                │
│                                         │
└─────────────────────────────────────────┘
```

### Thêm Món Ăn

Đi tới: **Quản Lý Thực Đơn → Danh Sách Món → Thêm Món**

#### Biểu Mẫu Thông Tin Món

```
┌──────────────────────────────────────────────┐
│ Biểu Mẫu Nhập Món Ăn                         │
├──────────────────────────────────────────────┤
│                                              │
│  【Thông Tin Cơ Bản】                        │
│  ├─ Tên Món: ___________________            │
│  ├─ Danh Mục: [Chọn]                        │
│  ├─ Giá: $______                            │
│  └─ Mô Tả: ___________________              │
│                                              │
│  【Tải Ảnh Lên】                             │
│  └─ [Nhấp Tải Lên] hoặc Kéo Ảnh Vào Đây    │
│                                              │
│  【Trạng Thái Cung Cấp】                     │
│  ├─ ✅ Hiện Có                              │
│  ├─ ⏸️ Tạm Hết                              │
│  └─ ❌ Ngừng Cung Cấp                       │
│                                              │
│  【Cài Đặt Khác】                            │
│  ├─ 🌶️ Độ Cay                              │
│  ├─ 🥬 Chay                                 │
│  └─ ⏱️ Thời Gian Chuẩn Bị                  │
│                                              │
└──────────────────────────────────────────────┘
```

#### Yêu Cầu Hình Ảnh

| Mục                | Yêu Cầu                               |
| ------------------ | ------------------------------------- |
| Định Dạng          | JPG, PNG, WebP                        |
| Kích Thước Đề Xuất | 800x600 pixels                        |
| Kích Thước File    | Tối đa 3MB                            |
| Gợi Ý Chụp         | Ánh sáng tốt, lấy nét rõ, bày trí đẹp |

**Quy Trình Tối Ưu Hóa Ảnh**:

```
Tải Ảnh Gốc Lên
     ↓
Tự Động Nén
     ↓
Tạo Nhiều Kích Thước
 ├─ Thumbnail (200x150)
 ├─ Trung bình (400x300)
 └─ Gốc (800x600)
     ↓
Lưu Lên Cloud (Cloudflare R2)
     ↓
Phân Phối Toàn Cầu Nhanh (CDN)
```

### Quản Lý Hàng Loạt

#### Cập Nhật Giá Hàng Loạt

Đi tới: **Quản Lý Thực Đơn → Thao Tác Hàng Loạt → Điều Chỉnh Giá**

Trường hợp sử dụng:

- Điều chỉnh giá theo mùa
- Điều chỉnh tăng chi phí
- Đặt giá khuyến mãi

**Các Bước**:

1. Chọn món cần điều chỉnh (chọn nhiều)
2. Đặt phương pháp điều chỉnh:
   - Số tiền cố định (ví dụ: +$10)
   - Phần trăm (ví dụ: +5%)
3. Xem trước kết quả
4. Xác nhận và áp dụng

#### Kích Hoạt/Vô Hiệu Hóa Hàng Loạt

Thao tác nhanh:

- ✅ Kích hoạt món đã chọn
- ⏸️ Tạm dừng món đã chọn
- ❌ Vô hiệu hóa món đã chọn

---

## 🪑 Quản Lý Bàn & Ghế

### Kiến Trúc Hệ Thống Bàn

```
┌─────────────────────────────────────────────────────┐
│ Kiến Trúc Hệ Thống Quản Lý Bàn                      │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Nhà Hàng                                           │
│   │                                                 │
│   ├─ Khu Vực 1: Khu Ăn Uống                       │
│   │   ├─ Bàn A (4 chỗ)                            │
│   │   │   ├─ Ghế A1                               │
│   │   │   ├─ Ghế A2                               │
│   │   │   ├─ Ghế A3                               │
│   │   │   └─ Ghế A4                               │
│   │   │                                            │
│   │   └─ Bàn B (6 chỗ)                            │
│   │       └─ [6 ghế]                              │
│   │                                                │
│   └─ Khu Vực 2: Khu Ngoài Trời                    │
│       └─ Bàn C (2 chỗ)                            │
│           └─ [2 ghế]                              │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Thêm Bàn

Đi tới: **Quản Lý Bàn → Thêm Bàn**

#### Biểu Mẫu Cài Đặt Bàn

```
┌─────────────────────────────────────────┐
│ Cấu Hình Bàn                            │
├─────────────────────────────────────────┤
│                                         │
│  Số Bàn: [A1] [A2] [A3]...             │
│  Tên Bàn: _______________              │
│  Số Ghế: [4]                           │
│  Khu Vực: [Khu Ăn ▼]                   │
│  Trạng Thái: ○ Hoạt động ○ Tắt        │
│                                         │
│  [Tạo QR]  [Lưu Cài Đặt]               │
│                                         │
└─────────────────────────────────────────┘
```

#### Gợi Ý Đặt Tên Bàn

```
Đặt tên theo khu vực:
  KhuĂn-A1, A2, A3...
  NgoàiTrời-B1, B2, B3...
  PhòngRiêng-VIP1, VIP2...

Đặt tên theo tầng:
  T1-01, T1-02, T1-03...
  T2-01, T2-02, T2-03...

Đặt tên theo chức năng:
  Quầy-1, Quầy-2...
  Sofa-1, Sofa-2...
  CửaSổ-1, CửaSổ-2...
```

### Quản Lý Ghế (Chế Độ Kép)

MakanMakan hỗ trợ hai chế độ quản lý ghế:

#### Chế Độ 1: Mã QR Cấp Bàn

```
┌─────────────────────────────────────┐
│  Bàn A1 (4 chỗ)                     │
│                                     │
│    [Một Mã QR Ở Giữa Bàn]          │
│                                     │
│  Trường Hợp Sử Dụng:                │
│  • Nhóm ăn cùng nhau                │
│  • Bữa ăn gia đình, bạn bè          │
│  • Thanh toán chung                 │
│                                     │
└─────────────────────────────────────┘
```

#### Chế Độ 2: Mã QR Cấp Ghế

```
┌─────────────────────────────────────┐
│  Bàn B1 (4 chỗ)                     │
│                                     │
│  [QR-1]     [QR-2]                 │
│   Ghế 1      Ghế 2                 │
│                                     │
│  [QR-3]     [QR-4]                 │
│   Ghế 3      Ghế 4                 │
│                                     │
│  Trường Hợp Sử Dụng:                │
│  • Đặt món riêng, tính tiền riêng  │
│  • Đồ ăn nhanh, khu ẩm thực        │
│  • Bữa trưa công sở                │
│                                     │
└─────────────────────────────────────┘
```

#### Hướng Dẫn Chọn Chế Độ

| Loại Hình Kinh Doanh  | Chế Độ Đề Xuất | Lý Do                                      |
| --------------------- | -------------- | ------------------------------------------ |
| Nhà Hàng Truyền Thống | Cấp bàn        | Thường ăn nhóm                             |
| Nhà Hàng Lẩu          | Cấp bàn        | Nồi chung, đặt món chung                   |
| Đồ Ăn Nhanh           | Cấp ghế        | Đặt món riêng, xoay bàn nhanh              |
| Khu Ẩm Thực           | Cấp ghế        | Người lạ ngồi chung, tính riêng            |
| Quán Cà Phê           | Hỗn hợp        | Bàn lớn dùng cấp bàn, ghế đơn dùng cấp ghế |

### Tạo Ghế

Đi tới: **Quản Lý Bàn → Chọn Bàn → Cấu Hình Ghế**

**Tạo Ghế Hàng Loạt**:

```
Chọn Bàn → Đặt Số Ghế → Tự Động Tạo Số
                              ↓
                    Ghế 1, Ghế 2, Ghế 3, Ghế 4
                              ↓
                      Hệ Thống Tự Động Tạo QR
```

---

## 📱 Hệ Thống Mã QR

### Ba Chế Độ Mã QR

MakanMakan cung cấp ba chế độ mã QR cho các tình huống kinh doanh khác nhau:

```
┌─────────────────────────────────────────────────────┐
│ Kiến Trúc Hệ Thống Mã QR                            │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Chế Độ 1: QR Cấp Cửa Hàng                         │
│  ┌──────────────────────────────┐                 │
│  │  Một QR → Toàn Bộ Nhà Hàng   │                 │
│  │  Cho: Mang đi, Giao hàng      │                 │
│  └──────────────────────────────┘                 │
│                 │                                   │
│  Chế Độ 2: QR Cấp Bàn                              │
│  ┌──────────────────────────────┐                 │
│  │  Một QR Mỗi Bàn              │                 │
│  │  Cho: Ăn tại chỗ truyền thống│                 │
│  └──────────────────────────────┘                 │
│                 │                                   │
│  Chế Độ 3: QR Cấp Ghế                              │
│  ┌──────────────────────────────┐                 │
│  │  QR Riêng Mỗi Ghế            │                 │
│  │  Cho: Đặt riêng, Tính riêng  │                 │
│  └──────────────────────────────┘                 │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Chế Độ 1: Mã QR Cấp Cửa Hàng

**Trường Hợp Sử Dụng**:

- ✅ Cửa hàng mang đi/giao hàng
- ✅ Không có chỗ ngồi (đứng ăn, xe đẩy)
- ✅ Xe ăn di động
- ✅ Cửa hàng tạm thời, gian hàng chợ

**Phương Pháp Tạo**:

Đi tới: **Quản Lý QR → QR Cửa Hàng → Tạo QR Cửa Hàng**

```
┌─────────────────────────────────────┐
│ Cài Đặt QR Cửa Hàng                 │
├─────────────────────────────────────┤
│                                     │
│  Loại QR: Cấp cửa hàng              │
│  Cách dùng: Vào thực đơn sau khi quét│
│                                     │
│  Vị Trí Đề Xuất:                    │
│  ├─ Poster cửa hàng                │
│  ├─ Khu vực quầy                   │
│  ├─ Chia sẻ mạng xã hội            │
│  └─ Liên kết nền tảng giao hàng    │
│                                     │
│  [Tạo QR]  [Tải Ảnh]               │
│                                     │
└─────────────────────────────────────┘
```

**Quy Trình Đặt Món Khách Hàng**:

```
Quét QR Cửa Hàng
     ↓
Vào Thực Đơn
     ↓
Chọn Món
     ↓
Điền Thông Tin Lấy Món
     ↓
Xác Nhận Đơn
     ↓
Chờ Thông Báo
```

### Chế Độ 2: Mã QR Cấp Bàn

**Trường Hợp Sử Dụng**:

- ✅ Nhà hàng ăn tại chỗ truyền thống
- ✅ Đặt món nhóm
- ✅ Bữa ăn gia đình, bạn bè
- ✅ Chế độ thanh toán chung

**Phương Pháp Tạo**:

Đi tới: **Quản Lý Bàn → Chọn Bàn → Tạo QR**

```
┌─────────────────────────────────────┐
│ Cài Đặt QR Bàn                      │
├─────────────────────────────────────┤
│                                     │
│  Số Bàn: A1                         │
│  Loại QR: Cấp bàn                   │
│                                     │
│  Cài Đặt:                           │
│  □ Cho phép đặt thêm               │
│  □ Hiện thông tin bàn              │
│  □ Tự động điền số bàn             │
│                                     │
│  [Tạo Đơn]  [Tạo Hàng Loạt]        │
│                                     │
└─────────────────────────────────────┘
```

**Tạo QR Bàn Hàng Loạt**:

```
Chọn Nhiều Bàn
     ↓
Đặt Tham Số Chung
     ↓
Tạo Tất Cả QR Một Lần
     ↓
Tải File ZIP
     ↓
Giải Nén và In
```

**Quy Trình Đặt Món Khách**:

```
Ngồi Xuống → Quét QR Trên Bàn
          ↓
     Vào Trang Đặt Món
     (Tự động điền số bàn)
          ↓
     Chọn Món
          ↓
     Gửi Đơn
          ↓
     Chờ Phục Vụ
```

### Chế Độ 3: Mã QR Cấp Ghế

**Trường Hợp Sử Dụng**:

- ✅ Đồ ăn nhanh, khu ẩm thực
- ✅ Bữa trưa công sở
- ✅ Người lạ ngồi chung bàn
- ✅ Đặt món riêng, tính tiền riêng

**Phương Pháp Tạo**:

Đi tới: **Quản Lý Bàn → Chọn Bàn → Quản Lý Ghế → Tạo QR Ghế Hàng Loạt**

```
┌─────────────────────────────────────┐
│ Tạo QR Ghế Hàng Loạt                │
├─────────────────────────────────────┤
│                                     │
│  Bàn: A1                            │
│  Số Ghế: [4]                        │
│                                     │
│  Số Ghế Tự Động Tạo:                │
│  ├─ A1-Ghế1                        │
│  ├─ A1-Ghế2                        │
│  ├─ A1-Ghế3                        │
│  └─ A1-Ghế4                        │
│                                     │
│  [Tạo Hàng Loạt]  [Tải Tất Cả]     │
│                                     │
└─────────────────────────────────────┘
```

**Ví Dụ Nhãn Ghế**:

```
        Bàn A1 (4 chỗ)
┌───────────┬───────────┐
│   [QR-1]  │   [QR-2]  │
│   Ghế 1   │   Ghế 2   │
├───────────┼───────────┤
│   [QR-3]  │   [QR-4]  │
│   Ghế 3   │   Ghế 4   │
└───────────┴───────────┘
```

### Thiết Kế & In Mã QR

#### Đề Xuất Kích Thước QR

| Vị Trí Hiển Thị  | Kích Thước Đề Xuất | Khoảng Cách Quét |
| ---------------- | ------------------ | ---------------- |
| Giá Để Bàn       | 5cm x 5cm          | 20-30cm          |
| Nhãn Dán Bàn     | 3cm x 3cm          | 10-20cm          |
| Poster Tường     | 15cm x 15cm        | 50-100cm         |
| Màn Hình Điện Tử | Thay đổi           | 20-50cm          |

#### Mẫu Thiết Kế QR

Đi tới: **Quản Lý QR → Mẫu Thiết Kế → Chọn Mẫu**

```
┌─────────────────────────────────────────┐
│ Tùy Chọn Thiết Kế QR                    │
├─────────────────────────────────────────┤
│                                         │
│  Mẫu 1: Tối Giản                        │
│  ├─ QR Đơn Giản                        │
│  └─ Đen Trắng                          │
│                                         │
│  Mẫu 2: Thương Hiệu                     │
│  ├─ Có Logo Nhà Hàng                   │
│  ├─ Màu Thương Hiệu                    │
│  └─ Số Bàn/Ghế                         │
│                                         │
│  Mẫu 3: Hướng Dẫn                       │
│  ├─ QR + Văn Bản Giải Thích            │
│  ├─ Lời Nhắc "Quét Để Đặt"             │
│  └─ Hướng Dẫn Từng Bước                │
│                                         │
└─────────────────────────────────────────┘
```

#### Đề Xuất In Ấn

**Vật Liệu Giấy**:

- 🏆 **Đề Xuất**: Nhãn dán chống nước, PVC
- ✅ **Có Thể Dùng**: Giấy phủ, giấy ảnh
- ❌ **Không Đề Xuất**: Giấy photocopy thông thường (dễ hỏng)

**Tùy Chọn Ép Plastic**:

- Sử dụng trên bàn: Đề xuất ép plastic hoặc giá acrylic
- Sử dụng ngoài trời: Phải xử lý chống nước
- Sử dụng tạm thời: Có thể dùng băng dính trong bảo vệ

### Tính Năng Quản Lý QR

#### Giám Sát Thời Gian Thực

Đi tới: **Quản Lý QR → Thống Kê Sử Dụng**

```
┌─────────────────────────────────────────┐
│ Giám Sát Sử Dụng QR Thời Gian Thực      │
├─────────────────────────────────────────┤
│                                         │
│  Lượt Quét Hôm Nay: 127 lần            │
│                                         │
│  Tỷ Lệ Sử Dụng QR:                      │
│  ├─ Bàn A1: ████████░░ 85%             │
│  ├─ Bàn A2: ██████░░░░ 62%             │
│  ├─ Bàn B1: ██████████ 100%            │
│  └─ Bàn B2: ████░░░░░░ 45%             │
│                                         │
│  Cảnh Báo:                              │
│  ⚠️ Bàn C3: Không quét 2 giờ           │
│                                         │
└─────────────────────────────────────────┘
```

#### Đặt Lại QR Nhanh

**Trường Hợp Sử Dụng**:

- QR bị hỏng, cần in lại
- Cân nhắc bảo mật, cần thay thế
- Cấu hình lại bàn

**Các Bước**:

1. Đi tới: **Quản Lý QR → Chọn QR Mục Tiêu**
2. Nhấp "Tạo Lại"
3. Tải QR mới
4. QR cũ tự động vô hiệu

---

## 📦 Quản Lý Đơn Hàng

### Chu Kỳ Đơn Hàng

```
┌────────────────────────────────────────────────────┐
│ Quy Trình Đơn Hàng Hoàn Chỉnh                      │
├────────────────────────────────────────────────────┤
│                                                    │
│  1️⃣ Đơn Mới     → Khách gửi đơn                   │
│      ↓                                             │
│  2️⃣ Đã Xác Nhận → Nhà hàng xác nhận                │
│      ↓                                             │
│  3️⃣ Đang Nấu    → Bếp bắt đầu chuẩn bị             │
│      ↓                                             │
│  4️⃣ Hoàn Thành  → Món ăn đã sẵn sàng               │
│      ↓                                             │
│  5️⃣ Đã Giao     → Phục vụ giao đến bàn             │
│      ↓                                             │
│  6️⃣ Đã Thanh Toán → Khách hoàn tất thanh toán      │
│                                                    │
└────────────────────────────────────────────────────┘
```

### Giám Sát Đơn Hàng Thời Gian Thực

Đi tới: **Quản Lý Đơn → Đơn Trực Tiếp**

#### Giao Diện Bảng Điều Khiển Đơn

```
┌─────────────────────────────────────────────────────┐
│ Tổng Quan Đơn Hàng Hôm Nay          [2025-10-26]   │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Chờ Xử Lý: 🔴 3  │  Đang Nấu: 🟡 5              │
│  Hoàn Thành: 🟢 42│  Tổng Doanh Thu: $12,450     │
│                                                     │
├─────────────────────────────────────────────────────┤
│                                                     │
│  【Cảnh Báo Đơn Mới】                              │
│  ┌───────────────────────────────────────┐        │
│  │ 🔔 Bàn A3 - Đơn #1234                │        │
│  │ Thời gian: 12:35                      │        │
│  │ Món: Cơm Chiên Hải Sản x1, Trà x2   │        │
│  │ [Xác Nhận]  [Xem Chi Tiết]          │        │
│  └───────────────────────────────────────┘        │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Chi Tiết Đơn Hàng

Nhấp vào bất kỳ đơn hàng nào để xem thông tin đầy đủ:

```
┌─────────────────────────────────────────┐
│ Chi Tiết Đơn #1234                      │
├─────────────────────────────────────────┤
│                                         │
│  【Thông Tin Cơ Bản】                   │
│  Bàn: A3                                │
│  Thời gian: 2025-10-26 12:35           │
│  Trạng thái: 🟡 Đang Nấu               │
│  Dự kiến xong: 12:50 (còn 8 phút)     │
│                                         │
│  【Món Đặt】                            │
│  1. Cơm Chiên Hải Sản x1    $180       │
│  2. Trà Bí Đao x2           $60        │
│  3. Đậu Hũ Chiên x1         $80        │
│                                         │
│  Tạm tính:           $320              │
│  Phí dịch vụ (10%):  $32               │
│  Tổng cộng:          $352              │
│                                         │
│  【Ghi Chú】                            │
│  "Cơm ít dầu, đậu hũ giòn"            │
│                                         │
│  [Cập Nhật]  [In]  [Hủy]               │
│                                         │
└─────────────────────────────────────────┘
```

### Quy Trình Thao Tác Đơn

#### Xác Nhận Đơn Mới

```
Nhận Cảnh Báo Đơn Mới
     ↓
Kiểm Tra Nội Dung Đơn
     ↓
Có Thể Chuẩn Bị?
     │
     ├─ Có → Nhấp "Xác Nhận"
     │         ↓
     │     Gửi Đơn Đến Bếp
     │         ↓
     │     Đầu Bếp Bắt Đầu
     │
     └─ Không → Nhấp "Không Thể Nhận"
               ↓
           Điền Lý Do
               ↓
           Thông Báo Khách
```

#### Cập Nhật Trạng Thái Đơn

**Vị Trí**: Chi Tiết Đơn → Nút Cập Nhật

```
┌─────────────────────────────┐
│ Cập Nhật Trạng Thái Đơn     │
├─────────────────────────────┤
│                             │
│  Trạng thái hiện tại: Nấu   │
│                             │
│  Chọn trạng thái mới:       │
│  ○ Hoàn thành (Sẵn sàng)    │
│  ○ Đã giao (Đến bàn)        │
│  ○ Đã thanh toán            │
│                             │
│  [Xác Nhận Cập Nhật]        │
│                             │
└─────────────────────────────┘
```

### Quản Lý Đặt Thêm

Khách có thể thêm món vào đơn hiện có:

```
Đơn Gốc #1234
├─ Cơm Chiên Hải Sản x1
├─ Trà Bí Đao x2
└─ (Gửi lúc 12:35)

【Đơn Đặt Thêm #1234-A】
├─ Đậu Hũ Chiên x1
└─ (Gửi lúc 12:45)
     ↓
Hệ Thống Tự Động Gộp
     ↓
Đơn Hoàn Chỉnh #1234
├─ Cơm Chiên Hải Sản x1
├─ Trà Bí Đao x2
└─ Đậu Hũ Chiên x1 [MỚI]
```

**Cách Hiển Thị**:

- Món mới đánh dấu "MỚI"
- Mã màu: Gốc (trắng), Thêm (vàng)
- Dòng thời gian hiển thị thời gian gửi từng món

### Tìm Kiếm & Lọc Đơn

Đi tới: **Quản Lý Đơn → Lịch Sử Đơn**

#### Tiêu Chí Lọc

```
┌─────────────────────────────────────────┐
│ Tìm Kiếm Đơn                            │
├─────────────────────────────────────────┤
│                                         │
│  Phạm vi ngày: [2025-10-20] đến [2025-10-26]│
│                                         │
│  Trạng thái đơn:                        │
│  ☑ Tất cả  □ Chờ    □ Đang xử lý      │
│  □ Hoàn thành  □ Đã hủy                │
│                                         │
│  Lọc bàn: [Tất cả bàn ▼]               │
│                                         │
│  Phạm vi giá: $ [100] ~ $ [1000]       │
│                                         │
│  [Tìm]  [Đặt lại]  [Xuất báo cáo]     │
│                                         │
└─────────────────────────────────────────┘
```

### Báo Cáo Thống Kê Đơn

Đi tới: **Quản Lý Đơn → Báo Cáo Thống Kê**

```
┌───────────────────────────────────────────────┐
│ Thống Kê Đơn Tuần (2025-10-20 ~ 10-26)       │
├───────────────────────────────────────────────┤
│                                               │
│  Tổng đơn: 287                                │
│  Giá trị trung bình: $345                     │
│  Tổng doanh thu: $99,015                      │
│                                               │
│  Xu hướng đơn hàng ngày:                      │
│  ████████████████░░░░░░ Thứ 2 (42)          │
│  ██████████████████████ Thứ 3 (53)          │
│  ███████████████░░░░░░░ Thứ 4 (38)          │
│  ████████████████████░░ Thứ 5 (48)          │
│  ██████████████████████ Thứ 6 (54)          │
│  ████████████████░░░░░░ Thứ 7 (52) ⭐       │
│                                               │
│  Giờ cao điểm:                                │
│  🥇 Trưa (12:00-14:00): 45%                  │
│  🥈 Tối (18:00-20:00): 38%                   │
│  🥉 Chiều (15:00-17:00): 17%                 │
│                                               │
└───────────────────────────────────────────────┘
```

---

(Tiếp tục với các phần còn lại... Do giới hạn độ dài, tôi sẽ tạo file hoàn chỉnh)

## 👥 Quản Lý Nhân Viên

### Vai Trò Nhân Viên

```
┌─────────────────────────────────────────────────────┐
│ Vai Trò & Quyền Nhân Viên                           │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Vai trò 0: Quản trị viên hệ thống                 │
│  └─ Quyền đầy đủ, tất cả nhà hàng                  │
│                                                     │
│  Vai trò 1: Chủ nhà hàng (Bạn)                     │
│  └─ Quyền quản lý đầy đủ, xem tất cả dữ liệu       │
│                                                     │
│  Vai trò 2: Đầu bếp                                │
│  ├─ Xem đơn hàng                                   │
│  ├─ Cập nhật trạng thái nấu                        │
│  └─ Không xem doanh thu                            │
│                                                     │
│  Vai trò 3: Phục vụ                                │
│  ├─ Xem đơn hoàn thành                             │
│  ├─ Cập nhật trạng thái giao                       │
│  └─ Không xem thông tin chi phí                    │
│                                                     │
│  Vai trò 4: Thu ngân                               │
│  ├─ Xử lý thanh toán                               │
│  ├─ Xem doanh thu ngày                             │
│  └─ Không sửa thực đơn                             │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Thêm Tài Khoản Nhân Viên

Đi tới: **Quản Lý Nhân Viên → Danh Sách Nhân Viên → Thêm Nhân Viên**

#### Biểu Mẫu Thông Tin Nhân Viên

```
┌─────────────────────────────────────────┐
│ Thêm Nhân Viên                          │
├─────────────────────────────────────────┤
│                                         │
│  【Thông Tin Cơ Bản】                   │
│  Họ tên: _______________               │
│  Điện thoại: _______________           │
│  Email: ______________                 │
│  CMND/Hộ chiếu: _________              │
│                                         │
│  【Cài Đặt Tài Khoản】                  │
│  Tài khoản đăng nhập: ___________      │
│  Mật khẩu ban đầu: ___________         │
│                                         │
│  【Thông Tin Chức Vụ】                  │
│  Chức vụ: [Đầu bếp ▼]                  │
│  Ngày bắt đầu: [2025-10-26]            │
│  Lương giờ/tháng: $________            │
│                                         │
│  【Cài Đặt Quyền】                      │
│  ○ Đầu bếp - Xem đơn, cập nhật nấu     │
│  ○ Phục vụ - Xem đơn xong, giao món    │
│  ○ Thu ngân - Xử lý thanh toán, xem thu│
│                                         │
│  [Lưu]  [Hủy]                          │
│                                         │
└─────────────────────────────────────────┘
```

### Ma Trận Quyền Nhân Viên

| Chức năng               | Chủ | Đầu bếp | Phục vụ | Thu ngân |
| ----------------------- | --- | ------- | ------- | -------- |
| Xem đơn hàng            | ✅  | ✅      | ✅      | ✅       |
| Cập nhật trạng thái đơn | ✅  | ✅      | ✅      | ✅       |
| Quản lý thực đơn        | ✅  | ❌      | ❌      | ❌       |
| Quản lý bàn             | ✅  | ❌      | ❌      | ❌       |
| Xem doanh thu           | ✅  | ❌      | ❌      | ✅       |
| Xem chi phí             | ✅  | ❌      | ❌      | ❌       |
| Quản lý nhân viên       | ✅  | ❌      | ❌      | ❌       |
| Xử lý thanh toán        | ✅  | ❌      | ❌      | ✅       |
| Hoàn đơn/Giảm giá       | ✅  | ❌      | ❌      | ✅       |
| Xem báo cáo phân tích   | ✅  | ❌      | ❌      | ❌       |

### Quản Lý Lịch Làm Việc Nhân Viên

Đi tới: **Quản Lý Nhân Viên → Quản Lý Lịch**

#### Xem Lịch Tuần

```
┌──────────────────────────────────────────────────────────┐
│ Lịch Tuần Này (2025-10-20 ~ 2025-10-26)                  │
├──────────────────────────────────────────────────────────┤
│                                                          │
│         T2    T3    T4    T5    T6    T7    CN          │
│                                                          │
│  Bếp Trưởng  Sáng Sáng Nghỉ  Chiều Chiều Sáng  Nghỉ    │
│  Phục Vụ Li  Chiều Chiều Sáng Sáng  Nghỉ  Chiều Chiều  │
│  Thu Ngân    Tối  Nghỉ  Tối  Tối   Tối   Tối   Sáng    │
│                                                          │
│  [Thêm Ca]  [Xuất]  [In]                                │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

#### Cài Đặt Ca Làm

```
Cài đặt loại ca:

Ca sáng: 08:00 - 16:00 (8 giờ)
Ca chiều: 12:00 - 20:00 (8 giờ)
Ca tối: 16:00 - 24:00 (8 giờ)
Cả ngày: 10:00 - 22:00 (12 giờ)

Có thể tùy chỉnh thời gian ca
```

### Ghi Chép Chấm Công

Đi tới: **Quản Lý Nhân Viên → Quản Lý Chấm Công**

```
┌─────────────────────────────────────────┐
│ Ghi Chép Chấm Công                      │
├─────────────────────────────────────────┤
│                                         │
│  Hôm nay (2025-10-26)                   │
│                                         │
│  Bếp Trưởng                             │
│  ├─ Vào ca: 08:05 ✅                    │
│  └─ Tan ca: Đang chờ...                │
│                                         │
│  Phục Vụ Li                             │
│  ├─ Vào ca: 11:58 ✅                    │
│  └─ Tan ca: Đang chờ...                │
│                                         │
│  Thu Ngân                               │
│  ├─ Vào ca: Chưa chấm ⚠️               │
│  └─ Ca dự kiến: 16:00                  │
│                                         │
└─────────────────────────────────────────┘
```

### Theo Dõi Hiệu Suất Nhân Viên

Đi tới: **Quản Lý Nhân Viên → Báo Cáo Hiệu Suất**

```
┌───────────────────────────────────────────────┐
│ Hiệu Suất Nhân Viên Tháng Này (2025-10)      │
├───────────────────────────────────────────────┤
│                                               │
│  Bếp Trưởng (Đầu bếp)                        │
│  ├─ Đơn xử lý: 523 đơn                       │
│  ├─ Thời gian hoàn thành TB: 15 phút         │
│  ├─ Đánh giá khách: ⭐⭐⭐⭐⭐ (4.8/5.0)     │
│  └─ Tỷ lệ đi làm: 96%                        │
│                                               │
│  Phục Vụ Li (Phục vụ)                        │
│  ├─ Lần giao món: 487 lần                    │
│  ├─ Thời gian giao TB: 3 phút                │
│  ├─ Đánh giá khách: ⭐⭐⭐⭐⭐ (4.9/5.0)     │
│  └─ Tỷ lệ đi làm: 100%                       │
│                                               │
└───────────────────────────────────────────────┘
```

---

## 👨‍👩‍👧‍👦 Quản Lý Khách Hàng

### Chế Độ Đăng Ký Khách Hàng

MakanMakan hỗ trợ hai chế độ sử dụng cho khách hàng:

```
┌─────────────────────────────────────────┐
│ Chế Độ Sử Dụng Khách Hàng               │
├─────────────────────────────────────────┤
│                                         │
│  Chế độ 1: Khách (Không cần đăng ký)   │
│  ├─ Quét QR đặt món trực tiếp          │
│  ├─ Không cần đăng ký đăng nhập        │
│  ├─ Phù hợp khách vãng lai             │
│  └─ Không tích lũy điểm thành viên     │
│                                         │
│  Chế độ 2: Thành viên (Cần đăng ký)    │
│  ├─ Đăng ký để theo dõi đơn            │
│  ├─ Tích lũy điểm tiêu dùng            │
│  ├─ Xem lịch sử đơn hàng               │
│  └─ Hưởng ưu đãi thành viên            │
│                                         │
└─────────────────────────────────────────┘
```

### Xem Dữ Liệu Khách Hàng

Đi tới: **Quản Lý Khách Hàng → Danh Sách Khách Hàng**

#### Bảng Dữ Liệu Khách Hàng

```
┌────────────────────────────────────────────────────────────┐
│ Danh Sách Khách Hàng                   [Tìm kiếm: ____]   │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  Tên        SĐT           Ngày ĐK     Số đơn   Tổng chi   │
│  ───────────────────────────────────────────────────────  │
│  Nguyễn A   0912-345-678  2025-08-15   15      $4,500    │
│  Trần B     0923-456-789  2025-09-01   8       $2,800    │
│  Lê C       0934-567-890  2025-10-10   3       $1,200    │
│                                                            │
│  [Xuất Dữ Liệu]  [Gửi Phiếu Giảm Giá]                   │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

### Chi Tiết Khách Hàng

Nhấp tên khách để xem thông tin chi tiết:

```
┌─────────────────────────────────────────┐
│ Hồ Sơ Khách Hàng: Nguyễn A              │
├─────────────────────────────────────────┤
│                                         │
│  【Thông Tin Cơ Bản】                   │
│  SĐT: 0912-345-678                     │
│  Email: nguyen@example.com             │
│  Sinh nhật: 1990-05-15                 │
│  Ngày đăng ký: 2025-08-15              │
│                                         │
│  【Thống Kê Tiêu Dùng】                 │
│  Tổng số đơn: 15                       │
│  Tổng chi tiêu: $4,500                 │
│  Giá trị đơn TB: $300                  │
│  Lần cuối: 2025-10-20                  │
│                                         │
│  【Điểm Thành Viên】                    │
│  Điểm hiện tại: 450 điểm               │
│  Có thể đổi: $45 giảm giá              │
│                                         │
│  【Phân Tích Sở Thích】                 │
│  Món thường gọi:                        │
│  1. Cơm Chiên Hải Sản (8 lần)          │
│  2. Đậu Hũ Chiên (6 lần)               │
│  3. Trà Bí Đao (12 lần)                │
│                                         │
│  Giờ thường đến: Trưa (12:00-14:00)    │
│  Chỗ ngồi ưa thích: Gần cửa sổ         │
│                                         │
│  [Gửi Ưu Đãi]  [Xem Lịch Sử Đơn]       │
│                                         │
└─────────────────────────────────────────┘
```

### Phân Nhóm Khách Hàng

Đi tới: **Quản Lý Khách Hàng → Phân Nhóm Khách**

#### Tiêu Chí Phân Nhóm Tự Động

```
┌─────────────────────────────────────────┐
│ Phân Nhóm Khách Tự Động                │
├─────────────────────────────────────────┤
│                                         │
│  🥇 Khách VIP (52 người)                │
│  └─ Tiêu chí: Tổng chi > $5,000        │
│                                         │
│  🥈 Khách Tích Cực (138 người)          │
│  └─ Tiêu chí: 3+ đơn trong 30 ngày     │
│                                         │
│  🥉 Khách Thường (245 người)            │
│  └─ Tiêu chí: Đã đăng ký, < 3 đơn      │
│                                         │
│  😴 Khách Ngủ Đông (87 người)           │
│  └─ Tiêu chí: Hơn 60 ngày không mua    │
│                                         │
│  🆕 Khách Mới (34 người)                │
│  └─ Tiêu chí: Đăng ký dưới 30 ngày     │
│                                         │
└─────────────────────────────────────────┘
```

### Phát Hành Phiếu Giảm Giá

Đi tới: **Quản Lý Khách Hàng → Quản Lý Phiếu Giảm Giá**

```
┌─────────────────────────────────────────┐
│ Tạo Chiến Dịch Khuyến Mãi              │
├─────────────────────────────────────────┤
│                                         │
│  Tên chiến dịch: ___________________   │
│                                         │
│  Loại ưu đãi:                           │
│  ○ Giảm giá (VD: 10%, 20% off)         │
│  ○ Phiếu tiền mặt (VD: giảm $50)       │
│  ○ Mua 1 Tặng 1                        │
│  ○ Chi & Nhận (VD: chi $500 nhận $50)  │
│                                         │
│  Đối tượng:                             │
│  □ Khách VIP                           │
│  □ Khách Tích Cực                      │
│  □ Khách Ngủ Đông                      │
│  □ Khách Mới                           │
│                                         │
│  Thời hạn:                              │
│  Bắt đầu: [2025-11-01]                 │
│  Kết thúc: [2025-11-30]                │
│                                         │
│  [Xem trước]  [Gửi Ngay]  [Lên lịch]   │
│                                         │
└─────────────────────────────────────────┘
```

---

## 📅 Hệ Thống Lịch Làm Việc

> **Tiến độ phát triển**: 43% hoàn thành
> **Trạng thái**: Cấu trúc cơ sở dữ liệu hoàn thành, đang phát triển lớp dịch vụ

### Kiến Trúc Hệ Thống Lịch Làm Việc

```
┌─────────────────────────────────────────────────────┐
│ Kiến Trúc Chức Năng Hệ Thống Lịch                  │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Quản Lý Mẫu Ca Làm                                 │
│  ├─ Tạo loại ca làm                                │
│  ├─ Cài đặt giờ làm việc                           │
│  └─ Xác định nhu cầu nhân lực                      │
│                                                     │
│  Xếp Lịch Nhân Viên                                │
│  ├─ Lịch tuần                                      │
│  ├─ Lịch tháng                                     │
│  ├─ Đề xuất tự động                                │
│  └─ Phát hiện xung đột                             │
│                                                     │
│  Điều Chỉnh Lịch                                   │
│  ├─ Yêu cầu đổi ca                                 │
│  ├─ Yêu cầu thay ca                                │
│  └─ Tăng ca tạm thời                               │
│                                                     │
│  Báo Cáo Thống Kê                                  │
│  ├─ Thống kê giờ công                              │
│  ├─ Tính lương                                     │
│  └─ Phân tích chi phí nhân công                    │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Cài Đặt Mẫu Ca Làm

Đi tới: **Quản Lý Lịch → Mẫu Ca Làm**

```
┌─────────────────────────────────────────┐
│ Quản Lý Mẫu Ca Làm                      │
├─────────────────────────────────────────┤
│                                         │
│  【Ca Sáng】                            │
│  Thời gian: 08:00 - 16:00 (8 giờ)      │
│  Nhu cầu nhân lực:                      │
│  ├─ Đầu bếp: 2 người                   │
│  ├─ Phục vụ: 1 người                   │
│  └─ Thu ngân: 1 người                  │
│                                         │
│  【Ca Chiều】                           │
│  Thời gian: 12:00 - 20:00 (8 giờ)      │
│  Nhu cầu nhân lực:                      │
│  ├─ Đầu bếp: 3 người                   │
│  ├─ Phục vụ: 2 người                   │
│  └─ Thu ngân: 1 người                  │
│                                         │
│  【Ca Tối】                             │
│  Thời gian: 16:00 - 24:00 (8 giờ)      │
│  Nhu cầu nhân lực:                      │
│  ├─ Đầu bếp: 2 người                   │
│  ├─ Phục vụ: 1 người                   │
│  └─ Thu ngân: 1 người                  │
│                                         │
│  [Thêm Mẫu]  [Sửa]  [Xóa]              │
│                                         │
└─────────────────────────────────────────┘
```

### Chức Năng Tự Động Xếp Lịch

```
Các yếu tố xem xét khi tự động xếp lịch:

┌─────────────────────────────────────────┐
│ AI Xếp Lịch Thông Minh                  │
├─────────────────────────────────────────┤
│                                         │
│  1️⃣ Ưu Tiên Nhân Viên                  │
│  ├─ Khung giờ ưu tiên                  │
│  └─ Nhu cầu nghỉ phép                  │
│                                         │
│  2️⃣ Quy Định Lao Động                  │
│  ├─ Giới hạn giờ làm/tuần              │
│  ├─ Số ngày làm liên tục               │
│  └─ Quy định thời gian nghỉ            │
│                                         │
│  3️⃣ Nhu Cầu Vận Hành                   │
│  ├─ Nhân lực giờ cao điểm              │
│  ├─ Điều chỉnh giờ thấp điểm           │
│  └─ Cấu hình sự kiện đặc biệt          │
│                                         │
│  4️⃣ Kiểm Soát Chi Phí                  │
│  ├─ Giảm thiểu tiền làm thêm           │
│  ├─ Tối ưu chi phí nhân công           │
│  └─ Tối đa hóa hiệu quả                │
│                                         │
└─────────────────────────────────────────┘
```

### Phát Hiện Xung Đột Lịch

Hệ thống tự động phát hiện các xung đột sau:

```
⚠️ Các loại xung đột lịch:

1. Nhân viên xếp trùng ca cùng thời điểm
   └─ Hệ thống tự động nhắc và đánh dấu đỏ

2. Vượt quá giới hạn giờ làm/tuần
   └─ Hiển thị cảnh báo và đề xuất điều chỉnh

3. Làm việc liên tục quá nhiều ngày
   └─ Đề xuất sắp xếp ngày nghỉ

4. Xung đột với đơn xin nghỉ
   └─ Tự động loại trừ nhân viên nghỉ phép

5. Thiếu nhu cầu nhân lực
   └─ Nhắc nhở bổ sung nhân lực
```

---

## 🏖️ Quản Lý Nghỉ Phép

> **Tiến độ phát triển**: Thiết kế hoàn thành
> **Trạng thái**: Đang chờ triển khai

### Kiến Trúc Hệ Thống Nghỉ Phép

```
┌─────────────────────────────────────────────────────┐
│ Quy Trình Quản Lý Nghỉ Phép                        │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Nhân viên gửi đơn xin nghỉ                        │
│         ↓                                           │
│  Chủ nhận thông báo                                │
│         ↓                                           │
│  Duyệt đơn xin nghỉ                                │
│    ├─ Phê duyệt → Cập nhật lịch                   │
│    └─ Từ chối → Thông báo nhân viên và lý do      │
│         ↓                                           │
│  Hệ thống tự động điều chỉnh lịch                  │
│         ↓                                           │
│  Trừ hạn mức phép năm/phép đặc biệt                │
│         ↓                                           │
│  Tạo hồ sơ nghỉ phép                               │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Cài Đặt Loại Nghỉ Phép

Đi tới: **Quản Lý Nghỉ Phép → Cài Đặt Loại Phép**

```
┌─────────────────────────────────────────┐
│ Quản Lý Loại Nghỉ Phép                  │
├─────────────────────────────────────────┤
│                                         │
│  🏖️ Phép Năm (Nghỉ Đặc Biệt)          │
│  ├─ Yêu cầu đăng ký trước: 3 ngày      │
│  ├─ Hạn mức năm: 7-14 ngày (theo thâm) │
│  └─ Có trừ lương: Không                │
│                                         │
│  🤒 Phép Ốm                            │
│  ├─ Yêu cầu đăng ký trước: Ngày hôm đó │
│  ├─ Hạn mức năm: 30 ngày               │
│  └─ Có trừ lương: Không (30 ngày đầu)  │
│                                         │
│  👨‍👩‍👧 Phép Cá Nhân                   │
│  ├─ Yêu cầu đăng ký trước: 1 ngày      │
│  ├─ Hạn mức năm: 14 ngày               │
│  └─ Có trừ lương: Có                   │
│                                         │
│  💑 Phép Cưới                          │
│  ├─ Yêu cầu đăng ký trước: 7 ngày      │
│  ├─ Hạn mức đời: 8 ngày                │
│  └─ Có trừ lương: Không                │
│                                         │
│  👶 Phép Sinh/Thai Sản                 │
│  ├─ Yêu cầu đăng ký trước: 14 ngày     │
│  ├─ Hạn mức: 56 ngày / 7 ngày          │
│  └─ Có trừ lương: Không                │
│                                         │
│  [Thêm Loại Phép]  [Sửa]  [Vô Hiệu]   │
│                                         │
└─────────────────────────────────────────┘
```

### Duyệt Đơn Xin Nghỉ

Đi tới: **Quản Lý Nghỉ Phép → Đơn Chờ Duyệt**

```
┌─────────────────────────────────────────┐
│ Đơn Xin Nghỉ Chờ Duyệt                  │
├─────────────────────────────────────────┤
│                                         │
│  【Đơn #001】                           │
│  Nhân viên: Bếp Trưởng                  │
│  Loại phép: Phép năm                    │
│  Ngày: 2025-11-05 ~ 2025-11-07 (3 ngày)│
│  Lý do: Du lịch gia đình                │
│  Thời gian nộp: 2025-10-26 10:30       │
│                                         │
│  【Kiểm Tra Hệ Thống】                  │
│  ✅ Phép năm còn lại: 7 ngày           │
│  ✅ Đăng ký trước: 10 ngày (đủ quy định)│
│  ⚠️ Thời điểm đó đã có 1 đầu bếp nghỉ  │
│                                         │
│  Ý kiến duyệt: _______________         │
│                                         │
│  [Phê Duyệt]  [Từ Chối]  [Yêu Cầu BS]  │
│                                         │
└─────────────────────────────────────────┘
```

### Tra Cứu Hạn Mức Nghỉ Phép

Đi tới: **Quản Lý Nghỉ Phép → Quản Lý Hạn Mức**

```
┌─────────────────────────────────────────────────────┐
│ Tổng Quan Hạn Mức Nghỉ Phép                        │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Nhân viên: Bếp Trưởng | Thâm niên: 3 năm         │
│                                                     │
│  【Hạn Mức Phép Năm Nay】                          │
│                                                     │
│  Phép năm: ████████░░░░  Đã dùng 8 / Tổng 14 ngày │
│  Phép ốm:  ██░░░░░░░░░░  Đã dùng 2 / Tổng 30 ngày │
│  Phép cá nhân: ░░░░░░░░░░░░  Đã dùng 0 / Tổng 14  │
│                                                     │
│  【Lịch Sử Nghỉ Phép】                             │
│  2025-08-15 ~ 2025-08-16  Phép năm  2 ngày  (Du lịch gia đình)│
│  2025-09-20 ~ 2025-09-23  Phép năm  4 ngày  (Thăm họ hàng)    │
│  2025-10-10              Phép ốm   1 ngày  (Cảm)   │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Báo Cáo Thống Kê Nghỉ Phép

Đi tới: **Quản Lý Nghỉ Phép → Báo Cáo Thống Kê**

```
┌───────────────────────────────────────────────┐
│ Thống Kê Nghỉ Phép Tháng Này (2025-10)       │
├───────────────────────────────────────────────┤
│                                               │
│  Tổng số ngày nghỉ: 23 ngày                  │
│  Tổng số lượt nghỉ: 12 người                 │
│                                               │
│  Phân bố theo loại phép:                      │
│  ████████████░░░░░░ Phép năm (15 ngày, 65%)  │
│  ████░░░░░░░░░░░░░░ Phép ốm (5 ngày, 22%)   │
│  ██░░░░░░░░░░░░░░░░ Phép cá nhân (3 ngày, 13%)│
│                                               │
│  Nhân viên nghỉ nhiều nhất:                   │
│  1. Phục Vụ Li (5 ngày)                      │
│  2. Bếp Trưởng (4 ngày)                      │
│  3. Thu Ngân (3 ngày)                        │
│                                               │
└───────────────────────────────────────────────┘
```

---

## 📊 Phân Tích Kinh Doanh

### Tổng Quan Bảng Phân Tích

Đi tới: **Phân Tích Kinh Doanh → Bảng Điều Khiển**

```
┌───────────────────────────────────────────────────────┐
│ Bảng Điều Khiển Phân Tích Kinh Doanh   [2025-10-26]  │
├───────────────────────────────────────────────────────┤
│                                                       │
│  【Dữ Liệu Thời Gian Thực Hôm Nay】                  │
│                                                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│  │ Doanh thu │  │ Số đơn   │  │ Giá trị TB│          │
│  │ $12,450  │  │ 42 đơn   │  │ $296     │          │
│  │ ↑ +15%   │  │ ↑ +8%    │  │ ↑ +7%    │          │
│  └──────────┘  └──────────┘  └──────────┘          │
│                                                       │
│  【Xu Hướng Tuần Này】                               │
│                                                       │
│  Biểu đồ doanh thu:                                  │
│  $15k ┤                            ⬤                │
│  $12k ┤            ⬤         ⬤                      │
│  $9k  ┤      ⬤         ⬤                            │
│  $6k  ┤ ⬤                                            │
│       └────────────────────────────                 │
│        T2   T3   T4   T5   T6   T7                  │
│                                                       │
└───────────────────────────────────────────────────────┘
```

### Phân Tích Doanh Thu

Đi tới: **Phân Tích Kinh Doanh → Báo Cáo Doanh Thu**

#### Phân Tích Theo Khung Giờ

```
┌───────────────────────────────────────────────┐
│ Phân Tích Doanh Thu Theo Khung Giờ (Tháng)   │
├───────────────────────────────────────────────┤
│                                               │
│  Bữa Sáng (08:00-11:00)                      │
│  ████░░░░░░░░░░░░░░ $12,500 (12%)           │
│                                               │
│  Bữa Trưa (11:00-14:00)                      │
│  ███████████████░░░░ $45,800 (45%)          │
│                                               │
│  Trà Chiều (14:00-17:00)                     │
│  ████████░░░░░░░░░░ $15,200 (15%)           │
│                                               │
│  Bữa Tối (17:00-21:00)                       │
│  ████████████░░░░░░ $28,500 (28%)           │
│                                               │
│  Khung giờ tốt nhất: Trưa (11:00-14:00) 💰  │
│  Đề xuất cải thiện: Nâng cao doanh thu sáng 📈│
│                                               │
└───────────────────────────────────────────────┘
```

#### Đối Chiếu Theo Tháng

```
┌───────────────────────────────────────────────┐
│ Đối Chiếu Doanh Thu Hàng Tháng                │
├───────────────────────────────────────────────┤
│                                               │
│  Xu hướng doanh thu 2025:                     │
│                                               │
│  $120k ┤                          ⬤          │
│  $100k ┤              ⬤     ⬤                │
│  $80k  ┤        ⬤                             │
│  $60k  ┤   ⬤                                  │
│        └──────────────────────────           │
│         T7  T8  T9  T10 T11                  │
│                                               │
│  Xu hướng tăng trưởng: ↗ Tăng ổn định       │
│  Tăng so với tháng trước: +12%               │
│  Tăng so với năm trước: +28%                 │
│                                               │
└───────────────────────────────────────────────┘
```

### Phân Tích Bán Hàng Món Ăn

Đi tới: **Phân Tích Kinh Doanh → Phân Tích Món Ăn**

```
┌───────────────────────────────────────────────────────┐
│ Bảng Xếp Hạng Món Bán Chạy (Tháng)                    │
├───────────────────────────────────────────────────────┤
│                                                       │
│  Hạng  Tên Món           Số Lượng  Doanh Thu  Tỷ Lệ  │
│  ────────────────────────────────────────────────    │
│  🥇   Cơm Chiên Hải Sản  287 phần  $51,660   18%    │
│  🥈   Đậu Hũ Chiên       245 phần  $19,600   7%     │
│  🥉   Trà Bí Đao         423 cốc   $12,690   4%     │
│  4    Gà Ba Chén         198 phần  $39,600   14%    │
│  5    Bánh Hào Chiên     176 phần  $26,400   9%     │
│                                                       │
│  【Phân Tích Hiểu Biết】                             │
│  • Cơm chiên hải sản là sản phẩm ngôi sao tuyệt đối │
│  • Trà bí đao bán nhiều nhưng giá thấp, cần thêm đồ uống khác│
│  • Gà ba chén doanh thu cao, có thể làm sản phẩm chính│
│                                                       │
└───────────────────────────────────────────────────────┘
```

#### Phân Tích Món Bán Chậm

```
┌───────────────────────────────────────────────┐
│ Món Bán Chậm (Tháng < 10 phần)               │
├───────────────────────────────────────────────┤
│                                               │
│  Tên Món          Số Lượng  Đề Xuất          │
│  ────────────────────────────────────         │
│  Sư Tử Đầu        5 phần    Xem xét gỡ bỏ   │
│  Nấm Mộc Nhĩ Trộn 3 phần    Điều chỉnh giá   │
│  Chè Khoai Môn    8 phần    Chỉ bán mùa hè   │
│                                               │
└───────────────────────────────────────────────┘
```

### Phân Tích Tỷ Lệ Lật Bàn

Đi tới: **Phân Tích Kinh Doanh → Phân Tích Bàn**

```
┌───────────────────────────────────────────────┐
│ Phân Tích Hiệu Quả Sử Dụng Bàn                │
├───────────────────────────────────────────────┤
│                                               │
│  Bàn    Số lần lật hôm nay  Thời gian TB     │
│  ─────────────────────────────────────       │
│  A1      5 lần          45 phút  ⭐⭐⭐    │
│  A2      6 lần          38 phút  ⭐⭐⭐⭐  │
│  A3      3 lần          62 phút  ⭐⭐      │
│  B1      4 lần          50 phút  ⭐⭐⭐    │
│                                               │
│  【Xếp Hạng Hiệu Quả】                        │
│  ⭐⭐⭐⭐⭐ Xuất sắc (< 40 phút)            │
│  ⭐⭐⭐⭐   Tốt (40-50 phút)                │
│  ⭐⭐⭐     Bình thường (50-60 phút)        │
│  ⭐⭐       Cần cải thiện (> 60 phút)       │
│                                               │
│  Đề xuất cải thiện:                           │
│  • Bàn A3 thời gian ăn quá lâu, kiểm tra quy trình│
│  • Bàn A2 hiệu quả cực tốt, có thể làm chuẩn │
│                                               │
└───────────────────────────────────────────────┘
```

### Phân Tích Khách Hàng

Đi tới: **Phân Tích Kinh Doanh → Phân Tích Khách Hàng**

```
┌───────────────────────────────────────────────┐
│ Phân Tích Hành Vi Tiêu Dùng Khách             │
├───────────────────────────────────────────────┤
│                                               │
│  【Cấu Trúc Khách Hàng】                      │
│                                               │
│  Khách mới: ██████░░░░ 28% (145 người)       │
│  Khách quay lại: ███████████ 52% (270 người) │
│  Khách VIP: █████░░░░░ 20% (104 người)       │
│                                               │
│  【Tần Suất Tiêu Dùng】                       │
│                                               │
│  Trên 3 lần/tuần: ████░░░░░░ 15%            │
│  1-2 lần/tuần:    ████████░░ 35%            │
│  1-3 lần/tháng:   ██████████ 40%            │
│  Thỉnh thoảng:    ██░░░░░░░░ 10%            │
│                                               │
│  【Tỷ Lệ Giữ Chân Khách】                     │
│  Giữ chân 30 ngày: 68%  ⭐⭐⭐⭐            │
│  Giữ chân 60 ngày: 52%  ⭐⭐⭐              │
│  Giữ chân 90 ngày: 45%  ⭐⭐⭐              │
│                                               │
└───────────────────────────────────────────────┘
```

---

## 🤖 Phân Tích AI Thông Minh

> **Trạng thái chức năng**: Backend hoàn thành, UI frontend đã ra mắt
> **Mô hình hỗ trợ**: OpenAI, Anthropic, Google Gemini, Groq

### Kiến Trúc Hệ Thống Phân Tích AI

```
┌─────────────────────────────────────────────────────┐
│ Công Cụ Phân Tích AI                                │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Tầng Thu Thập Dữ Liệu                              │
│  ├─ Dữ liệu đơn hàng                               │
│  ├─ Dữ liệu bán món                                │
│  ├─ Dữ liệu hành vi khách                          │
│  └─ Dữ liệu hiệu quả vận hành                      │
│         ↓                                           │
│  Tầng Phân Tích AI                                  │
│  ├─ Dự đoán xu hướng bán hàng                      │
│  ├─ Đề xuất tối ưu món ăn                          │
│  ├─ Phân tích sở thích khách                       │
│  └─ Đề xuất hiệu quả vận hành                      │
│         ↓                                           │
│  Tầng Báo Cáo Hiểu Biết                            │
│  └─ Tạo đề xuất có thể thực hiện                   │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Cài Đặt Mô Hình AI

Đi tới: **Cài Đặt → Cài Đặt Phân Tích AI**

```
┌─────────────────────────────────────────┐
│ Cài Đặt Mô Hình Phân Tích AI            │
├─────────────────────────────────────────┤
│                                         │
│  Chọn nhà cung cấp AI:                  │
│  ○ OpenAI (GPT-4)                      │
│  ○ Anthropic (Claude)                  │
│  ○ Google (Gemini Pro)                 │
│  ○ Groq (Llama 3)                      │
│                                         │
│  API Key: ********************         │
│                                         │
│  Tần suất phân tích:                    │
│  ○ Tự động hàng ngày                   │
│  ○ Tự động hàng tuần                   │
│  ○ Kích hoạt thủ công                  │
│                                         │
│  Phạm vi phân tích:                     │
│  □ Phân tích bán hàng                  │
│  □ Tối ưu món ăn                       │
│  □ Hiểu biết khách hàng                │
│  □ Đề xuất vận hành                    │
│                                         │
│  [Lưu Cài Đặt]  [Test Kết Nối]         │
│                                         │
└─────────────────────────────────────────┘
```

### Báo Cáo Hiểu Biết AI

Đi tới: **Phân Tích AI → Báo Cáo Hiểu Biết**

```
┌───────────────────────────────────────────────────────┐
│ Báo Cáo Hiểu Biết Thông Minh AI         [2025-10-26] │
├───────────────────────────────────────────────────────┤
│                                                       │
│  【Dự Đoán Xu Hướng Bán Hàng】🔮                     │
│                                                       │
│  Dựa trên phân tích dữ liệu 90 ngày qua, AI dự đoán: │
│                                                       │
│  Dự đoán doanh thu tuần sau: $85,000 - $92,000       │
│  Chỉ số tin cậy: ⭐⭐⭐⭐⭐ (92%)                     │
│                                                       │
│  Căn cứ dự đoán:                                     │
│  • Doanh thu gần đây liên tục tăng trưởng            │
│  • Dự báo thời tiết tốt, dự kiến số người ăn ngoài tăng│
│  • Tuần sau không có sự kiện lớn, mô hình ăn ổn định │
│                                                       │
│  ────────────────────────────────────────────        │
│                                                       │
│  【Đề Xuất Tối Ưu Món Ăn】🍽️                        │
│                                                       │
│  📈 Đề xuất quảng bá:                                │
│  • "Gà Ba Chén" - Tỷ lệ lợi nhuận cao (42%), nhưng tỷ lệ gọi chỉ 15%│
│    Đề xuất: Làm ảnh đẹp, đặt trang đầu thực đơn     │
│                                                       │
│  • "Mì Hải Sản" - Chi phí giảm 20%, có thể tăng lợi nhuận│
│    Đề xuất: Điều chỉnh giá từ $150 lên $165         │
│                                                       │
│  📉 Đề xuất điều chỉnh:                              │
│  • "Sư Tử Đầu" - Bán chậm (tháng 5 phần)            │
│    Đề xuất: Tạm gỡ, hoặc cải tiến công thức         │
│                                                       │
│  ────────────────────────────────────────────        │
│                                                       │
│  【Hiểu Biết Hành Vi Khách】👥                        │
│                                                       │
│  Đặc điểm khách hàng giá trị cao:                    │
│  • Ưu tiên khung giờ trưa (12:00-13:30)             │
│  • Thời gian lưu lại trung bình 55 phút              │
│  • Thường gọi món "Combo"                            │
│  • Tỷ lệ cao gọi thêm đồ uống và tráng miệng        │
│                                                       │
│  Hành động đề xuất:                                  │
│  • Khung giờ trưa tung ra "Combo Doanh Nhân"         │
│  • Thiết kế "Món Chính + Đồ Uống + Tráng Miệng"     │
│  • Nâng cao tốc độ phục vụ trưa, đáp ứng khách doanh nhân│
│                                                       │
│  ────────────────────────────────────────────        │
│                                                       │
│  【Đề Xuất Hiệu Quả Vận Hành】⚡                      │
│                                                       │
│  Tối ưu cấu hình nhân lực:                           │
│  • Khung giờ tối thứ 6 (18:00-20:00) thường thiếu nhân lực│
│    Đề xuất: Tăng 1 đầu bếp + 1 phục vụ              │
│                                                       │
│  • Khung giờ trưa thứ 4 (12:00-14:00) nhân lực dư thừa│
│    Đề xuất: Giảm 1 phục vụ, giảm chi phí nhân công  │
│                                                       │
│  Lợi ích dự kiến:                                    │
│  • Tiết kiệm chi phí nhân công: $4,500/tháng         │
│  • Nâng cao chất lượng phục vụ, giảm khiếu nại      │
│  • Nâng cao mức độ hài lòng công việc nhân viên     │
│                                                       │
└───────────────────────────────────────────────────────┘
```

### Trợ Lý Thông Minh Hỏi Đáp Thời Gian Thực

Đi tới: **Phân Tích AI → Trợ Lý Thông Minh**

```
┌─────────────────────────────────────────┐
│ Trợ Lý Thông Minh AI 💬                 │
├─────────────────────────────────────────┤
│                                         │
│  Bạn: Tại sao doanh thu hôm nay thấp   │
│       hơn hôm qua?                      │
│                                         │
│  AI: Dựa trên phân tích dữ liệu, doanh thu│
│      hôm nay thấp hơn có 3 nguyên nhân: │
│                                         │
│      1. Hôm nay là thứ 4, dữ liệu lịch sử│
│         cho thấy doanh thu thứ 4 thấp hơn│
│         thứ 3 trung bình 12%            │
│                                         │
│      2. Hôm nay mưa, số người ăn ngoài │
│         giảm khoảng 15-20%              │
│                                         │
│      3. Khung giờ trưa hôm nay (khung giờ│
│         doanh thu chính) số đơn ít hơn 8│
│                                         │
│      Đề xuất: Ngày mưa tung "Ưu Đãi Giao│
│               Hàng" để bù số khách ăn tại│
│               chỗ giảm                   │
│                                         │
│  [Gửi]  [Xóa Đối Thoại]                │
│                                         │
└─────────────────────────────────────────┘
```

### Phân Tích Đối Thủ Cạnh Tranh

Đi tới: **Phân Tích AI → Phân Tích Đối Thủ**

```
┌───────────────────────────────────────────────┐
│ Phân Tích Đối Thủ Cạnh Tranh Xung Quanh      │
├───────────────────────────────────────────────┤
│                                               │
│  Phạm vi phân tích: Nhà hàng cùng loại trong 1km│
│  Nguồn dữ liệu: Đánh giá công khai, mạng xã hội│
│                                               │
│  【Tổng Quan Đối Thủ】                        │
│                                               │
│  Hải Sản Ngon (300m)                          │
│  ├─ Đánh giá: ⭐⭐⭐⭐ 4.2/5.0              │
│  ├─ Giá: $$$ (cao hơn bạn một chút)          │
│  ├─ Ưu điểm: Hải sản tươi, trang trí đẹp     │
│  └─ Nhược điểm: Giá cao, thời gian chờ lâu   │
│                                               │
│  Quán Ăn Truyền Thống (150m)                  │
│  ├─ Đánh giá: ⭐⭐⭐ 3.8/5.0                │
│  ├─ Giá: $ (giá rẻ)                          │
│  ├─ Ưu điểm: Giá rẻ, ra món nhanh            │
│  └─ Nhược điểm: Môi trường bình thường, ít lựa chọn│
│                                               │
│  【Định Vị Của Bạn】                          │
│  Đánh giá: ⭐⭐⭐⭐⭐ 4.7/5.0                │
│  Giá: $$ (giá trung bình)                     │
│  Ưu điểm: CP cao, dịch vụ tốt, môi trường thoải mái│
│                                               │
│  【Đề Xuất AI】                                │
│  • Tiếp tục duy trì lợi thế CP, đây là sức cạnh tranh cốt lõi│
│  • Xem xét tung "Combo Hải Sản Hàng Ngày", tranh khách hải sản│
│  • Duy trì chiến lược giá hiện tại, tách biệt quán ăn rẻ│
│                                               │
└───────────────────────────────────────────────┘
```

---

## ❓ Câu Hỏi Thường Gặp

### Liên Quan Đến Đăng Nhập

**Q: Quên mật khẩu đăng nhập thì làm sao?**

```
Bước 1: Nhấp "Quên Mật Khẩu" tại trang đăng nhập
   ↓
Bước 2: Nhập Email đã đăng ký
   ↓
Bước 3: Hệ thống gửi link đặt lại mật khẩu đến Email
   ↓
Bước 4: Nhấp link, thiết lập mật khẩu mới
   ↓
Bước 5: Dùng mật khẩu mới để đăng nhập
```

**Q: Có thể nhiều người đăng nhập cùng một tài khoản không?**

A: Được. Tài khoản chủ hỗ trợ đăng nhập đồng thời nhiều thiết bị, thuận tiện bạn quản lý nhà hàng ở văn phòng và khi ra ngoài.

---

### Liên Quan Đến Thực Đơn

**Q: Làm sao để cập nhật giá món nhanh chóng?**

```
Cách 1: Món đơn lẻ
  Đi tới Quản Lý Thực Đơn → Chọn món → Sửa giá

Cách 2: Cập nhật hàng loạt
  Đi tới Quản Lý Thực Đơn → Thao Tác Hàng Loạt → Chọn món → Điều chỉnh giá đồng loạt
```

**Q: Món tạm hết hàng thì cài đặt như thế nào?**

A: Đi tới **Quản Lý Thực Đơn → Chọn món → Đổi trạng thái thành "Tạm Hết"**. Hệ thống sẽ tự động đánh dấu "Hôm nay hết" trong thực đơn, nhưng không xóa thông tin món.

**Q: Có thể cài đặt món cung cấp theo khung giờ không?**

A: Được. Đi tới **Quản Lý Thực Đơn → Sửa Món → Cài Đặt Khung Giờ Cung Cấp**, ví dụ cài đặt "Cháo Sáng" chỉ cung cấp 08:00-11:00.

---

### Liên Quan Đến QR Code

**Q: QR Code bị hỏng thì làm sao?**

```
Bước 1: Đi tới Quản Lý QR Code
   ↓
Bước 2: Tìm QR Code đó
   ↓
Bước 3: Nhấp "Tạo Lại"
   ↓
Bước 4: Tải QR Code mới
   ↓
Bước 5: In và dán
   ↓
Lưu ý: QR Code cũ sẽ tự động vô hiệu
```

**Q: Có thể tùy chỉnh ngoại hình QR Code không?**

A: Được. Đi tới **Quản Lý QR Code → Thiết Kế Mẫu**, có thể chọn:

- QR thuần túy (đen trắng)
- Mẫu thương hiệu (có Logo và màu sắc)
- Mẫu hướng dẫn (có văn bản hướng dẫn sử dụng)

**Q: Khách quét QR Code thấy thông báo lỗi?**

Có thể nguyên nhân:

1. QR Code đã được tạo lại (mã cũ vô hiệu)
2. Nhà hàng tạm ngưng hoạt động
3. Bàn đó đã bị vô hiệu

Giải pháp:

- Xác nhận trạng thái QR Code là "Đang Kích Hoạt"
- Kiểm tra trạng thái hoạt động nhà hàng
- Tạo lại và dán QR Code mới

---

### Liên Quan Đến Đơn Hàng

**Q: Làm sao xử lý khách yêu cầu hủy đơn?**

```
Bước 1: Đi tới trang chi tiết đơn hàng
   ↓
Bước 2: Nhấp nút "Hủy Đơn"
   ↓
Bước 3: Chọn lý do hủy
   ├─ Khách yêu cầu hủy
   ├─ Không đủ nguyên liệu
   ├─ Bếp quá bận
   └─ Lý do khác
   ↓
Bước 4: Điền số tiền hoàn (nếu cần)
   ↓
Bước 5: Xác nhận hủy
   ↓
Hệ thống tự động thông báo khách
```

**Q: Đơn quá nhiều, không kịp xử lý thì làm sao?**

Đề xuất xử lý:

1. **Tạm Ngừng Nhận Đơn**: Đi tới **Cài Đặt Nhà Hàng → Tạm Ngừng Nhận Đơn**, tạm thời đóng đặt món online
2. **Kéo Dài Thời Gian Ra Món**: Điều chỉnh thời gian hoàn thành dự kiến tại trang đơn hàng, cho khách biết cần chờ
3. **Tăng Nhân Lực**: Tạm thời điều thêm đầu bếp hoặc phục vụ

**Q: Làm sao xem đơn hàng lịch sử?**

Đi tới **Quản Lý Đơn Hàng → Hồ Sơ Đơn Hàng**, có thể lọc tra cứu theo ngày, bàn, trạng thái.

---

### Liên Quan Đến Nhân Viên

**Q: Làm sao đặt lại mật khẩu nhân viên?**

```
Cách 1: Chủ đặt lại
  Quản Lý Nhân Viên → Chọn nhân viên → Đặt Lại Mật Khẩu → Thông báo nhân viên

Cách 2: Nhân viên tự đặt lại
  Trang đăng nhập → Quên Mật Khẩu → Nhập Email → Nhận link đặt lại
```

**Q: Nhân viên nghỉ việc thì xử lý tài khoản như thế nào?**

Cách làm đề xuất:

1. Đi tới **Quản Lý Nhân Viên → Chọn nhân viên → Vô Hiệu Tài Khoản** (không khuyến nghị xóa, giữ lại hồ sơ lịch sử)
2. Hệ thống sẽ giữ lại hồ sơ công việc nhân viên đó (đơn hàng, lịch làm v.v.)
3. Nhân viên đó sẽ không thể đăng nhập hệ thống nữa

**Q: Có thể giới hạn nhân viên chỉ được đăng nhập trong khung giờ cụ thể không?**

A: Hiện tại chưa hỗ trợ chức năng này, nhưng có thể thông qua "Quản Lý Lịch" và "Hồ Sơ Chấm Công" để giám sát thời gian đăng nhập nhân viên.

---

### Liên Quan Đến Thanh Toán

**Q: Làm sao xử lý thanh toán?**

MakanMakan hiện hỗ trợ thanh toán offline:

```
Khách dùng bữa xong
   ↓
Đi quầy thanh toán
   ↓
Chủ/Thu ngân tìm đơn đó trong hệ thống
   ↓
Nhấp nút "Thanh Toán"
   ↓
Chọn phương thức thanh toán:
├─ Tiền mặt
├─ Thẻ tín dụng
├─ Thanh toán di động (WeChat, Alipay v.v.)
└─ Khác
   ↓
Nhập số tiền thực thu
   ↓
In hóa đơn (tùy chọn)
   ↓
Hoàn thành thanh toán
```

**Q: Có thể giảm giá không?**

A: Được. Tại trang thanh toán:

1. Nhấp "Áp Dụng Giảm Giá"
2. Chọn loại giảm giá:
   - Giảm theo phần trăm (như: 10%, 20% off)
   - Giảm số tiền cố định (như: giảm $50)
3. Điền lý do giảm giá
4. Xác nhận rồi hoàn thành thanh toán

---

### Liên Quan Đến Hệ Thống

**Q: Hệ thống hỗ trợ những thiết bị nào?**

```
✅ Máy Tính (khuyến nghị)
├─ Windows 10/11
├─ macOS
└─ Linux

✅ Máy Tính Bảng
├─ iPad
└─ Android Tablet

✅ Điện Thoại (xem chức năng)
├─ iPhone
└─ Android Phone
```

**Q: Có cần cài phần mềm không?**

A: Không cần. MakanMakan là hệ thống web, chỉ cần có trình duyệt và mạng là có thể sử dụng.

Trình duyệt khuyến nghị:

- Google Chrome (khuyến nghị)
- Microsoft Edge
- Safari
- Firefox

**Q: Nếu mạng bị đứt thì làm sao?**

```
Khi mạng đứt:
├─ Hệ thống hiển thị cảnh báo "Chế Độ Offline"
├─ Vẫn có thể xem dữ liệu đã tải
└─ Không thể nhận đơn mới

Sau khi mạng phục hồi:
└─ Hệ thống tự động đồng bộ dữ liệu, phục hồi hoạt động bình thường
```

**Q: Dữ liệu có bị mất không?**

A: Không. MakanMakan dùng kiến trúc đám mây, tất cả dữ liệu lưu thời gian thực trên mạng toàn cầu Cloudflare, có cơ chế backup nhiều lớp, đảm bảo an toàn dữ liệu.

---

### Liên Quan Đến Tài Vụ

**Q: Làm sao xuất báo cáo hoạt động?**

```
Cách 1: Báo cáo hàng ngày
  Phân Tích Kinh Doanh → Chọn ngày → Xuất Excel

Cách 2: Báo cáo tùy chỉnh
  Phân Tích Kinh Doanh → Tùy chỉnh khoảng ngày → Chọn mục xuất → Xuất

Báo cáo bao gồm:
├─ Chi tiết doanh thu
├─ Chi tiết đơn hàng
├─ Thống kê bán món
├─ Thống kê khách hàng
└─ Giờ công nhân viên
```

**Q: Có thể xem chi phí và lợi nhuận từng món không?**

A: Được. Đi tới **Quản Lý Thực Đơn → Danh Sách Món → Phân Tích Chi Phí**, có thể xem:

- Chi phí nguyên liệu
- Giá bán
- Tỷ lệ lợi nhuận gộp
- Doanh số hàng tháng
- Đóng góp lợi nhuận tổng

---

## 📞 Hỗ Trợ Kỹ Thuật

### Liên Hệ Chúng Tôi

```
┌─────────────────────────────────────────┐
│ Cần Trợ Giúp?                           │
├─────────────────────────────────────────┤
│                                         │
│  📧 Hỗ Trợ Email                        │
│  support@makanmakan.com                │
│  (Phản hồi trong 24-48 giờ)            │
│                                         │
│  💬 Chat Trực Tuyến                     │
│  Ngày thường 09:00-18:00               │
│  Cuối tuần 10:00-17:00                 │
│                                         │
│  📱 Hotline Khẩn Cấp                    │
│  0800-123-456 (Đường dây sự cố hệ thống)│
│  Phục vụ 24 giờ                         │
│                                         │
│  📚 Tài Liệu Trực Tuyến                 │
│  docs.makanmakan.com                   │
│                                         │
└─────────────────────────────────────────┘
```

### Giám Sát Trạng Thái Hệ Thống

Xem trạng thái hệ thống thời gian thực: `status.makanmakan.com`

```
Bảng Điều Khiển Giám Sát Trạng Thái Hệ Thống

┌─────────────────────────────────────────┐
│ Tất Cả Hệ Thống Hoạt Động Bình Thường ✅│
├─────────────────────────────────────────┤
│                                         │
│  Dịch vụ API:     ✅ Bình thường       │
│  Cơ sở dữ liệu:   ✅ Bình thường       │
│  Dịch vụ ảnh:     ✅ Bình thường       │
│  Chat thời gian thực: ✅ Bình thường   │
│                                         │
│  Tốc độ phản hồi: 85ms (xuất sắc)      │
│  Tỷ lệ khả dụng:  99.98%               │
│                                         │
└─────────────────────────────────────────┘
```

---

## 🎯 Bước Tiếp Theo

### Quy Trình Đề Xuất Cho Chủ Mới

```
Tuần 1: Cài Đặt Cơ Bản
  ├─ Hoàn thành thông tin cơ bản nhà hàng
  ├─ Tạo thực đơn và upload ảnh
  └─ Cài đặt bàn và tạo QR Code

Tuần 2: Chạy Thử
  ├─ Mời người thân bạn bè test quy trình đặt món
  ├─ Thêm tài khoản nhân viên và đào tạo sử dụng
  └─ Điều chỉnh thực đơn và giá

Tuần 3: Hoạt Động Chính Thức
  ├─ Bắt đầu nhận đơn khách hàng
  ├─ Giám sát quy trình đơn hàng
  └─ Thu thập phản hồi khách hàng

Tuần 4: Tối Ưu Điều Chỉnh
  ├─ Phân tích báo cáo hoạt động
  ├─ Xem đề xuất AI
  └─ Điều chỉnh thực đơn và chiến lược vận hành
```

### Khám Phá Chức Năng Nâng Cao

Khi bạn đã quen với thao tác cơ bản, có thể khám phá các chức năng nâng cao này:

```
✨ Danh Sách Chức Năng Nâng Cao

□ Cài đặt chế độ tích điểm thành viên
□ Tạo hoạt động phiếu giảm giá
□ Kích hoạt phân tích thông minh AI
□ Cài đặt xếp lịch tự động
□ Tạo đánh giá hiệu suất nhân viên
□ Kết nối hệ thống kế toán
□ Cài đặt quản lý đa chi nhánh
```

---

## 📝 Nhật Ký Cập Nhật

### 2.0.0 (2025-10-26)

- ✨ Giao diện vận hành chủ hoàn toàn mới
- ✨ Phân tích thông minh AI ra mắt
- ✨ Kiến trúc hệ thống lịch hoàn thành
- 🔧 Tối ưu hiệu suất và sửa lỗi

### 1.5.0 (2025-10-12)

- ✨ Hỗ trợ đa ngôn ngữ (6 ngôn ngữ)
- ✨ Chức năng QR Code cấp chỗ ngồi
- 🔧 Nâng cao bảo mật mật khẩu

### 1.0.0 (2025-09-01)

- 🎉 MakanMakan chính thức ra mắt
- ✨ Chức năng quản lý nhà hàng cơ bản
- ✨ Hệ thống đặt món QR Code
- ✨ Hệ thống quản lý đơn hàng

---

## ✅ Xác Nhận Hoàn Thành Hướng Dẫn Vận Hành

Chúc mừng bạn đã hoàn thành đọc hướng dẫn vận hành chủ!

```
Kiểm tra tiến độ học tập:

□ Hiểu đăng nhập hệ thống và thao tác cơ bản
□ Biết cài đặt thông tin cơ bản nhà hàng
□ Biết tạo và quản lý thực đơn
□ Biết cài đặt bàn và tạo QR Code
□ Biết xử lý đơn hàng và thanh toán
□ Biết quản lý tài khoản và quyền nhân viên
□ Biết xem báo cáo phân tích kinh doanh
□ Hiểu chức năng phân tích AI

Sẵn sàng bắt đầu sử dụng MakanMakan chưa? 🚀
```

---

**Chúc Bạn Kinh Doanh Phát Đạt! 🎊**

---

_Hướng dẫn này được cập nhật liên tục. Mọi đóng góp xin liên hệ chúng tôi._
