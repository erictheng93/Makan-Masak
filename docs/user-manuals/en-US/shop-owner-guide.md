# 🏪 MakanMakan Shop Owner User Guide

> **Version**: 2.0
> **Last Updated**: 2025-10-26
> **Target Audience**: Restaurant Owners, Managers
> **Plans, trial and usage**: Shop owners change plans themselves under "Plan & Usage" in the admin dashboard (upgrades are immediate, downgrades take effect at the end of the period, no online payment). See [Plans, trial and usage](../en-US/plans-and-usage.html).

---

## 📚 Table of Contents

1. [Quick Start](#quick-start)
2. [System Overview](#system-overview)
3. [Restaurant Basic Settings](#restaurant-basic-settings)
4. [Menu Management](#menu-management)
5. [Table & Seat Management](#table--seat-management)
6. [QR Code System](#qr-code-system)
7. [Order Management](#order-management)
8. [Staff Management](#staff-management)
9. [Customer Management](#customer-management)
10. [Scheduling System](#scheduling-system)
11. [Leave Management](#leave-management)
12. [Business Analytics](#business-analytics)
13. [AI Smart Analytics](#ai-smart-analytics)
14. [FAQ](#faq)

---

## 🚀 Quick Start

### System Login Process

```
┌─────────────────────────────────────────────┐
│ Login Process                               │
├─────────────────────────────────────────────┤
│                                             │
│  1️⃣ Open Admin Dashboard                   │
│      ↓                                      │
│  2️⃣ Enter Username & Password              │
│      ↓                                      │
│  3️⃣ System Authenticates                   │
│      ↓                                      │
│  4️⃣ Access Owner Dashboard                 │
│                                             │
└─────────────────────────────────────────────┘
```

### First Login Checklist

✅ **Step 1: Complete Restaurant Profile**

- Restaurant name, address, contact details
- Business hours configuration
- Upload restaurant photos

✅ **Step 2: Build Menu Structure**

- Add menu categories
- Upload dish information
- Set prices and images

✅ **Step 3: Set Up Tables**

- Create table information
- Generate QR codes
- Print and display

✅ **Step 4: Add Staff Accounts**

- Create employee records
- Assign role permissions
- Send login credentials

✅ **Step 5: Start Operations**

- Test ordering flow
- Confirm order reception
- Monitor operations

---

## 🏢 System Overview

### Shop Owner Permissions

```
┌─────────────────────────────────────────────────────────┐
│ Functions Managed by Shop Owner                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌──────────────┐    ┌──────────────┐                 │
│  │  Restaurant  │───→│  Menu Mgmt   │                 │
│  │   Settings   │    │              │                 │
│  └──────────────┘    └──────────────┘                 │
│         ↓                    ↓                         │
│  ┌──────────────┐    ┌──────────────┐                 │
│  │  Table Mgmt  │───→│  QR Code     │                 │
│  │              │    │   System     │                 │
│  └──────────────┘    └──────────────┘                 │
│         ↓                    ↓                         │
│  ┌──────────────┐    ┌──────────────┐                 │
│  │  Order Mgmt  │───→│  Staff Mgmt  │                 │
│  │              │    │              │                 │
│  └──────────────┘    └──────────────┘                 │
│         ↓                    ↓                         │
│  ┌──────────────┐    ┌──────────────┐                 │
│  │  Business    │───→│  AI          │                 │
│  │  Analytics   │    │  Analytics   │                 │
│  └──────────────┘    └──────────────┘                 │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Multi-Role Collaboration Mode

```
        Owner (You)
           │
    ┌──────┼──────┬──────┐
    ↓      ↓      ↓      ↓
  Chef  Server Cashier Customer
    │      │      │      │
    └──────┴──────┴──────┘
           │
   Real-time Platform
```

**Explanation**:

- **Owner**: Full management permissions, view all data
- **Chef**: Receive orders, update cooking status
- **Server**: Confirm delivery, update order progress
- **Cashier**: Process payments, view revenue
- **Customer**: Scan QR to order, track orders

---

## ⚙️ Restaurant Basic Settings

### Restaurant Information Management

Navigate to: **Dashboard → Restaurant Settings → Basic Info**

#### Required Information

| Field           | Description                          | Example                                              |
| --------------- | ------------------------------------ | ---------------------------------------------------- |
| Restaurant Name | Name displayed to customers          | Delicious Seafood Restaurant                         |
| Address         | Complete address with postal code    | No. 7, Section 5, Xinyi Road, Xinyi District, Taipei |
| Contact Phone   | Customer service or reservation line | 02-1234-5678                                         |
| Business Hours  | Daily operating hours                | 11:00-14:00, 17:00-21:00                             |
| Description     | Brief introduction, specialties      | Fresh seafood and traditional cuisine                |

#### Business Hours Configuration

```
┌─────────────────────────────────────────┐
│ Business Hours Example                  │
├─────────────────────────────────────────┤
│                                         │
│  Monday - Friday:                       │
│  ├─ Lunch: 11:00 - 14:00               │
│  └─ Dinner: 17:00 - 21:00              │
│                                         │
│  Saturday - Sunday:                     │
│  └─ All Day: 11:00 - 21:00             │
│                                         │
│  Closed: Every Wednesday                │
│                                         │
└─────────────────────────────────────────┘
```

### Restaurant Photo Upload

Supported formats: JPG, PNG, WebP
Recommended size: 1920x1080 pixels
File size: Maximum 5MB

**Upload Steps**:

1. Click "Upload Photo" button
2. Select restaurant exterior or signature dish photos
3. System automatically compresses and generates multiple sizes
4. Preview and save

---

## 🍽️ Menu Management

### Menu Structure

```
Restaurant Menu
  │
  ├── Category 1: Appetizers
  │    ├── Dish A
  │    ├── Dish B
  │    └── Dish C
  │
  ├── Category 2: Main Dishes
  │    ├── Dish D
  │    ├── Dish E
  │    └── Dish F
  │
  └── Category 3: Desserts
       ├── Dish G
       └── Dish H
```

### Add Menu Category

Navigate to: **Menu Management → Category Management → Add Category**

#### Category Settings

| Setting        | Description             | Example         |
| -------------- | ----------------------- | --------------- |
| Category Name  | Title displayed on menu | Seafood Dishes  |
| Category Icon  | Icon symbol (optional)  | 🦐              |
| Sort Order     | Display order           | 1, 2, 3...      |
| Display Status | Show on menu            | Active/Inactive |

#### Category Management Best Practices

```
┌─────────────────────────────────────────┐
│ Recommended Category Structure          │
├─────────────────────────────────────────┤
│                                         │
│  1. 🥗 Appetizers / Starters           │
│  2. 🥘 Main Dishes / Signatures        │
│  3. 🍜 Noodles & Rice                  │
│  4. 🥤 Beverages                       │
│  5. 🍰 Desserts                        │
│  6. ⭐ Today's Specials                │
│                                         │
└─────────────────────────────────────────┘
```

### Add Menu Item

Navigate to: **Menu Management → Item List → Add Item**

#### Item Information Form

```
┌──────────────────────────────────────────────┐
│ Menu Item Input Form                         │
├──────────────────────────────────────────────┤
│                                              │
│  【Basic Info】                              │
│  ├─ Item Name: ___________________          │
│  ├─ Category: [Dropdown]                    │
│  ├─ Price: $______                          │
│  └─ Description: ___________________        │
│                                              │
│  【Image Upload】                            │
│  └─ [Click to Upload] or Drag Image Here   │
│                                              │
│  【Availability Status】                     │
│  ├─ ✅ Currently Available                  │
│  ├─ ⏸️ Temporarily Out of Stock            │
│  └─ ❌ Discontinued                         │
│                                              │
│  【Other Settings】                          │
│  ├─ 🌶️ Spice Level                         │
│  ├─ 🥬 Vegetarian Option                   │
│  └─ ⏱️ Preparation Time                    │
│                                              │
└──────────────────────────────────────────────┘
```

#### Image Requirements

| Item             | Requirement                                      |
| ---------------- | ------------------------------------------------ |
| Format           | JPG, PNG, WebP                                   |
| Recommended Size | 800x600 pixels                                   |
| File Size        | Maximum 3MB                                      |
| Photography Tips | Bright lighting, sharp focus, attractive plating |

**Image Optimization Process**:

```
Upload Original Image
     ↓
System Auto-Compress
     ↓
Generate Multiple Sizes
 ├─ Thumbnail (200x150)
 ├─ Medium (400x300)
 └─ Original (800x600)
     ↓
Save to Cloud (Cloudflare R2)
     ↓
Fast Global Delivery (CDN)
```

### Batch Item Management

#### Batch Price Update

Navigate to: **Menu Management → Batch Operations → Price Adjustment**

Use Cases:

- Seasonal price adjustments
- Cost increase adjustments
- Promotional pricing

**Steps**:

1. Select items to adjust (multi-select)
2. Set adjustment method:
   - Fixed amount (e.g., +$10)
   - Percentage (e.g., +5%)
3. Preview results
4. Confirm and apply

#### Batch Enable/Disable

Quick actions:

- ✅ One-click enable selected items
- ⏸️ One-click pause selected items
- ❌ One-click disable selected items

---

## 🪑 Table & Seat Management

### Table System Architecture

```
┌─────────────────────────────────────────────────────┐
│ Table Management System Architecture                │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Restaurant                                         │
│   │                                                 │
│   ├─ Area 1: Dining Area                          │
│   │   ├─ Table A (4-seater)                       │
│   │   │   ├─ Seat A1                              │
│   │   │   ├─ Seat A2                              │
│   │   │   ├─ Seat A3                              │
│   │   │   └─ Seat A4                              │
│   │   │                                            │
│   │   └─ Table B (6-seater)                       │
│   │       └─ [6 seats]                            │
│   │                                                │
│   └─ Area 2: Outdoor Area                         │
│       └─ Table C (2-seater)                       │
│           └─ [2 seats]                            │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Add Table

Navigate to: **Table Management → Add Table**

#### Table Settings Form

```
┌─────────────────────────────────────────┐
│ Table Configuration                     │
├─────────────────────────────────────────┤
│                                         │
│  Table Number: [A1] [A2] [A3]...       │
│  Table Name: _______________           │
│  Seat Count: [4]                       │
│  Area: [Dining Area ▼]                 │
│  Status: ○ Active  ○ Inactive         │
│                                         │
│  [Generate QR]  [Save Settings]        │
│                                         │
└─────────────────────────────────────────┘
```

#### Table Naming Suggestions

```
Area-based naming:
  Dining-A1, A2, A3...
  Outdoor-B1, B2, B3...
  Private-VIP1, VIP2...

Floor-based naming:
  1F-01, 1F-02, 1F-03...
  2F-01, 2F-02, 2F-03...

Function-based naming:
  Bar-1, Bar-2...
  Sofa-1, Sofa-2...
  Window-1, Window-2...
```

### Seat Management (Dual Mode)

MakanMakan supports two seat management modes:

#### Mode 1: Table-Level QR Code

```
┌─────────────────────────────────────┐
│  Table A1 (4-seater)                │
│                                     │
│    [One QR Code in Table Center]   │
│                                     │
│  Use Cases:                         │
│  • Group dining together            │
│  • Family meals, friend gatherings  │
│  • Unified billing                  │
│                                     │
└─────────────────────────────────────┘
```

#### Mode 2: Seat-Level QR Code

```
┌─────────────────────────────────────┐
│  Table B1 (4-seater)                │
│                                     │
│  [QR-1]     [QR-2]                 │
│   Seat 1     Seat 2                │
│                                     │
│  [QR-3]     [QR-4]                 │
│   Seat 3     Seat 4                │
│                                     │
│  Use Cases:                         │
│  • Individual orders, split bills   │
│  • Fast food, food courts          │
│  • Business lunches                │
│                                     │
└─────────────────────────────────────┘
```

#### Mode Selection Guide

| Business Type          | Recommended Mode | Reason                                                        |
| ---------------------- | ---------------- | ------------------------------------------------------------- |
| Traditional Restaurant | Table-level      | Usually group dining                                          |
| Hot Pot Restaurant     | Table-level      | Shared pot, group ordering                                    |
| Fast Food              | Seat-level       | Individual orders, quick turnover                             |
| Food Court             | Seat-level       | Strangers sharing, separate bills                             |
| Café                   | Mixed            | Large tables use table-level, individual seats use seat-level |

### Create Seats

Navigate to: **Table Management → Select Table → Seat Configuration**

**Batch Create Seats**:

```
Select Table → Set Seat Count → Auto-Generate Numbers
                              ↓
                    Seat 1, Seat 2, Seat 3, Seat 4
                              ↓
                      System Auto-Generates QR Codes
```

---

## 📱 QR Code System

### Three QR Code Modes

MakanMakan offers three QR code modes for different business scenarios:

```
┌─────────────────────────────────────────────────────┐
│ QR Code System Architecture                         │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Mode 1: Shop-Level QR                             │
│  ┌──────────────────────────────┐                 │
│  │  One QR → Entire Restaurant  │                 │
│  │  For: Takeout, Delivery, No Tables │           │
│  └──────────────────────────────┘                 │
│                 │                                   │
│  Mode 2: Table-Level QR                            │
│  ┌──────────────────────────────┐                 │
│  │  One QR per Table            │                 │
│  │  For: Traditional Dine-in    │                 │
│  └──────────────────────────────┘                 │
│                 │                                   │
│  Mode 3: Seat-Level QR                             │
│  ┌──────────────────────────────┐                 │
│  │  Individual QR per Seat      │                 │
│  │  For: Individual Orders, Split Bills │         │
│  └──────────────────────────────┘                 │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Mode 1: Shop-Level QR Code

**Use Cases**:

- ✅ Takeout/Delivery shops
- ✅ No seating (standing, street food)
- ✅ Food trucks
- ✅ Pop-up stores, market stalls

**Generation Method**:

Navigate to: **QR Code Management → Shop QR → Generate Shop QR**

```
┌─────────────────────────────────────┐
│ Shop QR Code Settings               │
├─────────────────────────────────────┤
│                                     │
│  QR Type: Shop-Level                │
│  Usage: Direct menu access after scan│
│                                     │
│  Suggested Display Locations:       │
│  ├─ Storefront poster              │
│  ├─ Counter area                   │
│  ├─ Social media sharing           │
│  └─ Delivery platform link         │
│                                     │
│  [Generate QR]  [Download Image]   │
│                                     │
└─────────────────────────────────────┘
```

**Customer Ordering Flow**:

```
Scan Shop QR
     ↓
Enter Menu
     ↓
Select Items
     ↓
Fill Pickup Info
     ↓
Confirm Order
     ↓
Wait for Notification
```

### Mode 2: Table-Level QR Code

**Use Cases**:

- ✅ Traditional dine-in restaurants
- ✅ Group dining
- ✅ Family/friend gatherings
- ✅ Unified billing

**Generation Method**:

Navigate to: **Table Management → Select Table → Generate QR**

```
┌─────────────────────────────────────┐
│ Table QR Code Settings              │
├─────────────────────────────────────┤
│                                     │
│  Table Number: A1                   │
│  QR Type: Table-Level               │
│                                     │
│  Settings:                          │
│  □ Allow additional orders         │
│  □ Show table info                 │
│  □ Auto-fill table number          │
│                                     │
│  [Generate Single]  [Batch Generate]│
│                                     │
└─────────────────────────────────────┘
```

**Batch Generate Table QR**:

```
Select Multiple Tables
     ↓
Set Unified Parameters
     ↓
One-Click Generate All QR Codes
     ↓
Download ZIP File
     ↓
Extract and Print
```

**Customer Ordering Flow**:

```
Sit Down → Scan Table QR
          ↓
     Enter Ordering Page
     (Auto-fill table number)
          ↓
     Select Items
          ↓
     Submit Order
          ↓
     Wait for Service
```

### Mode 3: Seat-Level QR Code

**Use Cases**:

- ✅ Fast food, food courts
- ✅ Business lunches
- ✅ Strangers sharing tables
- ✅ Individual orders, split bills

**Generation Method**:

Navigate to: **Table Management → Select Table → Seat Management → Batch Generate Seat QR**

```
┌─────────────────────────────────────┐
│ Batch Generate Seat QR              │
├─────────────────────────────────────┤
│                                     │
│  Table: A1                          │
│  Seat Count: [4]                    │
│                                     │
│  Auto-Generated Seat Numbers:       │
│  ├─ A1-Seat1                       │
│  ├─ A1-Seat2                       │
│  ├─ A1-Seat3                       │
│  └─ A1-Seat4                       │
│                                     │
│  [Batch Generate]  [Download All]  │
│                                     │
└─────────────────────────────────────┘
```

**Seat Label Example**:

```
        Table A1 (4-seater)
┌───────────┬───────────┐
│   [QR-1]  │   [QR-2]  │
│   Seat 1  │   Seat 2  │
├───────────┼───────────┤
│   [QR-3]  │   [QR-4]  │
│   Seat 3  │   Seat 4  │
└───────────┴───────────┘
```

### QR Code Design & Printing

#### QR Code Size Recommendations

| Display Location  | Recommended Size | Scan Distance |
| ----------------- | ---------------- | ------------- |
| Table Stand       | 5cm x 5cm        | 20-30cm       |
| Table Sticker     | 3cm x 3cm        | 10-20cm       |
| Wall Poster       | 15cm x 15cm      | 50-100cm      |
| Electronic Screen | Variable         | 20-50cm       |

#### QR Code Design Templates

Navigate to: **QR Code Management → Design Templates → Select Template**

```
┌─────────────────────────────────────────┐
│ QR Code Design Options                  │
├─────────────────────────────────────────┤
│                                         │
│  Template 1: Minimalist                 │
│  ├─ Pure QR Code                       │
│  └─ Black & White                      │
│                                         │
│  Template 2: Branded                    │
│  ├─ Include Restaurant Logo            │
│  ├─ Brand Colors                       │
│  └─ Table/Seat Number                  │
│                                         │
│  Template 3: Instructional              │
│  ├─ QR + Explanatory Text              │
│  ├─ "Scan to Order" Prompt             │
│  └─ Step-by-step Guide                 │
│                                         │
└─────────────────────────────────────────┘
```

#### Printing Recommendations

**Paper Materials**:

- 🏆 **Recommended**: Waterproof sticker, PVC material
- ✅ **Acceptable**: Coated paper, photo paper
- ❌ **Not Recommended**: Regular copy paper (easily damaged)

**Lamination Options**:

- Table use: Recommend lamination or acrylic stand
- Outdoor use: Must be waterproofed
- Temporary use: Can use transparent tape for protection

### QR Code Management Features

#### Real-time Monitoring

Navigate to: **QR Code Management → Usage Statistics**

```
┌─────────────────────────────────────────┐
│ QR Code Usage Real-time Monitor         │
├─────────────────────────────────────────┤
│                                         │
│  Today's Scans: 127 times               │
│                                         │
│  QR Usage Rate:                         │
│  ├─ Table A1: ████████░░ 85%           │
│  ├─ Table A2: ██████░░░░ 62%           │
│  ├─ Table B1: ██████████ 100%          │
│  └─ Table B2: ████░░░░░░ 45%           │
│                                         │
│  Alerts:                                │
│  ⚠️ Table C3: No scans for 2 hours     │
│                                         │
└─────────────────────────────────────────┘
```

#### Quick QR Reset

**Use Cases**:

- QR code damaged, needs reprint
- Security concerns, needs replacement
- Table reconfiguration

**Steps**:

1. Navigate to: **QR Code Management → Select Target QR**
2. Click "Regenerate"
3. Download new QR code
4. Old QR code automatically deactivated

---

## 📦 Order Management

### Order Lifecycle

```
┌────────────────────────────────────────────────────┐
│ Complete Order Flow                                │
├────────────────────────────────────────────────────┤
│                                                    │
│  1️⃣ New Order   → Customer submits order          │
│      ↓                                             │
│  2️⃣ Confirmed   → Restaurant confirms              │
│      ↓                                             │
│  3️⃣ Cooking     → Kitchen starts preparation       │
│      ↓                                             │
│  4️⃣ Completed   → Dishes ready                     │
│      ↓                                             │
│  5️⃣ Delivered   → Server delivers to table         │
│      ↓                                             │
│  6️⃣ Paid        → Customer completes payment       │
│                                                    │
└────────────────────────────────────────────────────┘
```

### Real-time Order Monitoring

Navigate to: **Order Management → Live Orders**

#### Order Dashboard Interface

```
┌─────────────────────────────────────────────────────┐
│ Today's Order Overview              [2025-10-26]   │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Pending: 🔴 3   │  Cooking: 🟡 5                 │
│  Completed: 🟢 42│  Total Revenue: $12,450        │
│                                                     │
├─────────────────────────────────────────────────────┤
│                                                     │
│  【New Order Alert】                               │
│  ┌───────────────────────────────────────┐        │
│  │ 🔔 Table A3 - Order #1234            │        │
│  │ Time: 12:35                           │        │
│  │ Items: Seafood Fried Rice x1, Tea x2 │        │
│  │ [Confirm]  [View Details]            │        │
│  └───────────────────────────────────────┘        │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Order Details

Click any order to view complete information:

```
┌─────────────────────────────────────────┐
│ Order #1234 Details                     │
├─────────────────────────────────────────┤
│                                         │
│  【Basic Info】                         │
│  Table: A3                              │
│  Time: 2025-10-26 12:35                │
│  Status: 🟡 Cooking                     │
│  Est. Completion: 12:50 (8 min left)   │
│                                         │
│  【Order Items】                        │
│  1. Seafood Fried Rice x1    $180      │
│  2. Winter Melon Tea x2      $60       │
│  3. Fried Tofu x1            $80       │
│                                         │
│  Subtotal:           $320              │
│  Service Fee (10%):  $32               │
│  Total:              $352              │
│                                         │
│  【Notes】                              │
│  "Less oil for rice, crispy tofu"      │
│                                         │
│  [Update Status]  [Print]  [Cancel]    │
│                                         │
└─────────────────────────────────────────┘
```

### Order Operation Flow

#### Confirm New Order

```
Receive New Order Alert
     ↓
Check Order Contents
     ↓
Can Prepare?
     │
     ├─ Yes → Click "Confirm"
     │         ↓
     │     Order Sent to Kitchen
     │         ↓
     │     Chef Starts Cooking
     │
     └─ No → Click "Cannot Accept"
               ↓
           Fill Reason
               ↓
           Notify Customer
```

#### Update Order Status

**Location**: Order Details → Update Status Button

```
┌─────────────────────────────┐
│ Update Order Status         │
├─────────────────────────────┤
│                             │
│  Current Status: Cooking    │
│                             │
│  Select New Status:         │
│  ○ Completed (Ready)        │
│  ○ Delivered (To Table)     │
│  ○ Paid (Payment Done)      │
│                             │
│  [Confirm Update]           │
│                             │
└─────────────────────────────┘
```

### Additional Order Management

Customers can add items to existing orders:

```
Original Order #1234
├─ Seafood Fried Rice x1
├─ Winter Melon Tea x2
└─ (Submitted at 12:35)

【Additional Order #1234-A】
├─ Fried Tofu x1
└─ (Submitted at 12:45)
     ↓
System Auto-Merges
     ↓
Complete Order #1234
├─ Seafood Fried Rice x1
├─ Winter Melon Tea x2
└─ Fried Tofu x1 [NEW]
```

**Display Method**:

- New items marked with "NEW" tag
- Color coding: Original (white), Additional (yellow)
- Timeline shows submission time for each item

### Order Search & Filter

Navigate to: **Order Management → Order History**

#### Filter Criteria

```
┌─────────────────────────────────────────┐
│ Order Search                            │
├─────────────────────────────────────────┤
│                                         │
│  Date Range: [2025-10-20] to [2025-10-26]│
│                                         │
│  Order Status:                          │
│  ☑ All    □ Pending   □ In Progress   │
│  □ Completed  □ Cancelled              │
│                                         │
│  Table Filter: [All Tables ▼]          │
│                                         │
│  Amount Range: $ [100] ~ $ [1000]      │
│                                         │
│  [Search]  [Reset]  [Export Report]    │
│                                         │
└─────────────────────────────────────────┘
```

### Order Statistics Report

Navigate to: **Order Management → Statistics Report**

```
┌───────────────────────────────────────────────┐
│ Weekly Order Statistics (2025-10-20 ~ 10-26) │
├───────────────────────────────────────────────┤
│                                               │
│  Total Orders: 287                            │
│  Avg Order Value: $345                        │
│  Total Revenue: $99,015                       │
│                                               │
│  Daily Order Trend:                           │
│  ████████████████░░░░░░ Mon (42)            │
│  ██████████████████████ Tue (53)            │
│  ███████████████░░░░░░░ Wed (38)            │
│  ████████████████████░░ Thu (48)            │
│  ██████████████████████ Fri (54)            │
│  ████████████████░░░░░░ Sat (52) ⭐         │
│                                               │
│  Peak Hours:                                  │
│  🥇 Lunch (12:00-14:00): 45%                 │
│  🥈 Dinner (18:00-20:00): 38%                │
│  🥉 Afternoon Tea (15:00-17:00): 17%         │
│                                               │
└───────────────────────────────────────────────┘
```

---

## 👥 Staff Management

### Staff Roles

```
┌─────────────────────────────────────────────────────┐
│ Staff Roles & Permissions                           │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Role 0: System Administrator                       │
│  └─ Full system permissions, all restaurants       │
│                                                     │
│  Role 1: Shop Owner (You)                          │
│  └─ Full restaurant management, view all data      │
│                                                     │
│  Role 2: Chef                                       │
│  ├─ View orders                                    │
│  ├─ Update cooking status                          │
│  └─ Cannot view revenue                            │
│                                                     │
│  Role 3: Server                                     │
│  ├─ View completed orders                          │
│  ├─ Update delivery status                         │
│  └─ Cannot view cost info                          │
│                                                     │
│  Role 4: Cashier                                    │
│  ├─ Process payments                               │
│  ├─ View daily revenue                             │
│  └─ Cannot modify menu                             │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Add Staff Account

Navigate to: **Staff Management → Staff List → Add Staff**

#### Staff Information Form

```
┌─────────────────────────────────────────┐
│ Add Staff                               │
├─────────────────────────────────────────┤
│                                         │
│  【Basic Info】                         │
│  Name: _______________                 │
│  Phone: _______________                │
│  Email: ______________                 │
│  ID/Passport: _________                │
│                                         │
│  【Account Settings】                   │
│  Login Account: ___________            │
│  Initial Password: ___________         │
│                                         │
│  【Position Info】                      │
│  Position: [Chef ▼]                    │
│  Start Date: [2025-10-26]              │
│  Hourly/Monthly Salary: $________      │
│                                         │
│  【Permission Settings】                │
│  ○ Chef - View orders, update cooking │
│  ○ Server - View completed, delivery  │
│  ○ Cashier - Process payments, revenue│
│                                         │
│  [Save]  [Cancel]                      │
│                                         │
└─────────────────────────────────────────┘
```

### Staff Permission Matrix

| Function            | Owner | Chef | Server | Cashier |
| ------------------- | ----- | ---- | ------ | ------- |
| View Orders         | ✅    | ✅   | ✅     | ✅      |
| Update Order Status | ✅    | ✅   | ✅     | ✅      |
| Menu Management     | ✅    | ❌   | ❌     | ❌      |
| Table Management    | ✅    | ❌   | ❌     | ❌      |
| View Revenue        | ✅    | ❌   | ❌     | ✅      |
| View Costs          | ✅    | ❌   | ❌     | ❌      |
| Staff Management    | ✅    | ❌   | ❌     | ❌      |
| Process Payments    | ✅    | ❌   | ❌     | ✅      |
| Refund/Discount     | ✅    | ❌   | ❌     | ✅      |
| View Analytics      | ✅    | ❌   | ❌     | ❌      |

### Staff Schedule Management

Navigate to: **Staff Management → Schedule Management**

#### Weekly Schedule View

```
┌──────────────────────────────────────────────────────────┐
│ Weekly Schedule (2025-10-20 ~ 2025-10-26)                │
├──────────────────────────────────────────────────────────┤
│                                                          │
│         Mon   Tue   Wed   Thu   Fri   Sat   Sun        │
│                                                          │
│  Chef Zhang  AM   AM   OFF   PM   PM   AM   OFF        │
│  Server Li   PM   PM   AM    AM   OFF  PM   PM         │
│  Cashier Wang PM  OFF  PM    PM   PM   PM   AM         │
│                                                          │
│  [Add Shift]  [Export]  [Print]                        │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

#### Shift Configuration

```
Shift Types:

Morning: 08:00 - 16:00 (8 hours)
Afternoon: 12:00 - 20:00 (8 hours)
Evening: 16:00 - 24:00 (8 hours)
Full Day: 10:00 - 22:00 (12 hours)

Custom shift times available
```

### Staff Attendance Records

Navigate to: **Staff Management → Attendance Management**

```
┌─────────────────────────────────────────┐
│ Attendance Clock-in Records             │
├─────────────────────────────────────────┤
│                                         │
│  Today (2025-10-26)                     │
│                                         │
│  Chef Zhang                             │
│  ├─ Clock In: 08:05 ✅                 │
│  └─ Clock Out: Waiting...              │
│                                         │
│  Server Li                              │
│  ├─ Clock In: 11:58 ✅                 │
│  └─ Clock Out: Waiting...              │
│                                         │
│  Cashier Wang                           │
│  ├─ Clock In: Not Clocked ⚠️           │
│  └─ Scheduled: 16:00                   │
│                                         │
└─────────────────────────────────────────┘
```

### Staff Performance Tracking

Navigate to: **Staff Management → Performance Reports**

```
┌───────────────────────────────────────────────┐
│ Monthly Staff Performance (2025-10)           │
├───────────────────────────────────────────────┤
│                                               │
│  Chef Zhang (Chef)                            │
│  ├─ Orders Processed: 523                    │
│  ├─ Avg Completion Time: 15 min             │
│  ├─ Customer Rating: ⭐⭐⭐⭐⭐ (4.8/5.0)    │
│  └─ Attendance Rate: 96%                     │
│                                               │
│  Server Li (Server)                           │
│  ├─ Deliveries: 487                          │
│  ├─ Avg Delivery Time: 3 min                │
│  ├─ Customer Rating: ⭐⭐⭐⭐⭐ (4.9/5.0)    │
│  └─ Attendance Rate: 100%                    │
│                                               │
└───────────────────────────────────────────────┘
```

---

## 👨‍👩‍👧‍👦 Customer Management

### Customer Registration Modes

MakanMakan supports two customer modes:

```
┌─────────────────────────────────────────┐
│ Customer Usage Modes                    │
├─────────────────────────────────────────┤
│                                         │
│  Mode 1: Guest Mode (No Registration)  │
│  ├─ Scan QR and order directly         │
│  ├─ No registration required           │
│  ├─ Suitable for walk-in customers     │
│  └─ Cannot accumulate points           │
│                                         │
│  Mode 2: Member Mode (Registration)    │
│  ├─ Track orders after registration    │
│  ├─ Accumulate consumption points      │
│  ├─ View order history                 │
│  └─ Enjoy member benefits              │
│                                         │
└─────────────────────────────────────────┘
```

### Customer Data View

Navigate to: **Customer Management → Customer List**

#### Customer Data Table

```
┌────────────────────────────────────────────────────────────┐
│ Customer List                              [Search: ____] │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  Name       Phone          Reg Date    Orders  Total Spend│
│  ───────────────────────────────────────────────────────  │
│  Wang Ming  0912-345-678   2025-08-15   15      $4,500   │
│  Li Meili   0923-456-789   2025-09-01   8       $2,800   │
│  Zhang Hua  0934-567-890   2025-10-10   3       $1,200   │
│                                                            │
│  [Export Data]  [Send Coupons]                           │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

### Customer Details

Click customer name to view detailed information:

```
┌─────────────────────────────────────────┐
│ Customer Profile: Wang Ming             │
├─────────────────────────────────────────┤
│                                         │
│  【Basic Info】                         │
│  Phone: 0912-345-678                   │
│  Email: wang@example.com               │
│  Birthday: 1990-05-15                  │
│  Registration: 2025-08-15              │
│                                         │
│  【Consumption Stats】                  │
│  Total Orders: 15                      │
│  Total Spent: $4,500                   │
│  Avg Order Value: $300                 │
│  Last Visit: 2025-10-20                │
│                                         │
│  【Member Points】                      │
│  Current Points: 450                   │
│  Redeemable: $45 credit                │
│                                         │
│  【Preference Analysis】                │
│  Popular Items:                         │
│  1. Seafood Fried Rice (8 times)       │
│  2. Fried Tofu (6 times)               │
│  3. Winter Melon Tea (12 times)        │
│                                         │
│  Peak Time: Lunch (12:00-14:00)        │
│  Preferred Seat: Window seats           │
│                                         │
│  [Send Offer]  [View Order History]    │
│                                         │
└─────────────────────────────────────────┘
```

### Customer Segmentation

Navigate to: **Customer Management → Customer Segments**

#### Auto-Segmentation Criteria

```
┌─────────────────────────────────────────┐
│ Customer Auto-Segmentation              │
├─────────────────────────────────────────┤
│                                         │
│  🥇 VIP Customers (52)                  │
│  └─ Criteria: Total spent > $5,000     │
│                                         │
│  🥈 Active Customers (138)              │
│  └─ Criteria: 3+ orders in 30 days     │
│                                         │
│  🥉 Regular Customers (245)             │
│  └─ Criteria: Registered, < 3 orders   │
│                                         │
│  😴 Dormant Customers (87)              │
│  └─ Criteria: No orders for 60+ days   │
│                                         │
│  🆕 New Customers (34)                  │
│  └─ Criteria: Registered < 30 days     │
│                                         │
└─────────────────────────────────────────┘
```

### Coupon Distribution

Navigate to: **Customer Management → Coupon Management**

```
┌─────────────────────────────────────────┐
│ Create Promotion Campaign               │
├─────────────────────────────────────────┤
│                                         │
│  Campaign Name: ___________________    │
│                                         │
│  Offer Type:                            │
│  ○ Discount (e.g., 10%, 20% off)       │
│  ○ Cash Voucher (e.g., $50 off)        │
│  ○ Buy One Get One                     │
│  ○ Spend & Get (e.g., $500 get $50)   │
│                                         │
│  Target Audience:                       │
│  □ VIP Customers                       │
│  □ Active Customers                    │
│  □ Dormant Customers                   │
│  □ New Customers                       │
│                                         │
│  Valid Period:                          │
│  Start: [2025-11-01]                   │
│  End: [2025-11-30]                     │
│                                         │
│  [Preview]  [Send Now]  [Schedule]     │
│                                         │
└─────────────────────────────────────────┘
```

---

## 📅 Scheduling System

> **Development Status**: 43% Complete
> **Status**: Database schema complete, service layer in development

### Scheduling System Architecture

```
┌─────────────────────────────────────────────────────┐
│ Scheduling System Functional Architecture           │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Shift Template Management                          │
│  ├─ Create shift types                             │
│  ├─ Set working hours                              │
│  └─ Define staffing requirements                   │
│                                                     │
│  Staff Scheduling                                   │
│  ├─ Weekly schedule planning                       │
│  ├─ Monthly schedule planning                      │
│  ├─ Auto-schedule suggestions                      │
│  └─ Conflict detection                             │
│                                                     │
│  Schedule Adjustments                               │
│  ├─ Shift swap requests                            │
│  ├─ Substitute requests                            │
│  └─ Overtime requests                              │
│                                                     │
│  Statistical Reports                                │
│  ├─ Working hours statistics                       │
│  ├─ Salary calculations                            │
│  └─ Labor cost analysis                            │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Shift Template Configuration

Navigate to: **Scheduling → Shift Templates**

```
┌─────────────────────────────────────────┐
│ Shift Template Management               │
├─────────────────────────────────────────┤
│                                         │
│  【Morning Shift】                      │
│  Time: 08:00 - 16:00 (8 hours)         │
│  Staffing Needs:                        │
│  ├─ Chefs: 2                           │
│  ├─ Servers: 1                         │
│  └─ Cashiers: 1                        │
│                                         │
│  【Afternoon Shift】                    │
│  Time: 12:00 - 20:00 (8 hours)         │
│  Staffing Needs:                        │
│  ├─ Chefs: 3                           │
│  ├─ Servers: 2                         │
│  └─ Cashiers: 1                        │
│                                         │
│  【Evening Shift】                      │
│  Time: 16:00 - 24:00 (8 hours)         │
│  Staffing Needs:                        │
│  ├─ Chefs: 2                           │
│  ├─ Servers: 1                         │
│  └─ Cashiers: 1                        │
│                                         │
│  [Add Template]  [Edit]  [Delete]      │
│                                         │
└─────────────────────────────────────────┘
```

### Auto-Scheduling Function

```
Auto-scheduling considerations:

┌─────────────────────────────────────────┐
│ AI Smart Scheduling                     │
├─────────────────────────────────────────┤
│                                         │
│  1️⃣ Staff Preferences                  │
│  ├─ Preferred time slots               │
│  └─ Leave requests                     │
│                                         │
│  2️⃣ Labor Regulations                  │
│  ├─ Weekly hour limits                 │
│  ├─ Consecutive work day limits        │
│  └─ Rest time requirements             │
│                                         │
│  3️⃣ Operational Needs                  │
│  ├─ Peak hour staffing                 │
│  ├─ Off-peak adjustments               │
│  └─ Special event coverage             │
│                                         │
│  4️⃣ Cost Control                       │
│  ├─ Minimize overtime                  │
│  ├─ Optimize labor costs               │
│  └─ Maximize efficiency                │
│                                         │
└─────────────────────────────────────────┘
```

### Schedule Conflict Detection

System automatically detects these conflicts:

```
⚠️ Schedule Conflict Types:

1. Double-booking same staff
   └─ System auto-alerts and highlights

2. Exceeding weekly hour limits
   └─ Displays warning and suggests adjustment

3. Too many consecutive work days
   └─ Suggests rest day scheduling

4. Conflicts with leave requests
   └─ Auto-excludes staff on leave

5. Insufficient staffing
   └─ Alerts to fill staffing gap
```

---

## 🏖️ Leave Management

> **Development Status**: Design Complete
> **Status**: Ready for Implementation

### Leave Management System Architecture

```
┌─────────────────────────────────────────────────────┐
│ Leave Management Process                            │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Staff Submits Leave Request                        │
│         ↓                                           │
│  Owner Receives Notification                        │
│         ↓                                           │
│  Review Leave Request                               │
│    ├─ Approve → Update Schedule                    │
│    └─ Reject → Notify Staff with Reason           │
│         ↓                                           │
│  System Auto-Adjusts Schedule                       │
│         ↓                                           │
│  Deduct Annual/Special Leave Balance               │
│         ↓                                           │
│  Generate Leave Record                              │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Leave Type Configuration

Navigate to: **Leave Management → Leave Type Settings**

```
┌─────────────────────────────────────────┐
│ Leave Type Management                   │
├─────────────────────────────────────────┤
│                                         │
│  🏖️ Annual Leave                       │
│  ├─ Advance Notice: 3 days             │
│  ├─ Annual Quota: 7-14 days (by tenure)│
│  └─ Paid: Yes                          │
│                                         │
│  🤒 Sick Leave                         │
│  ├─ Advance Notice: Same day OK        │
│  ├─ Annual Quota: 30 days              │
│  └─ Paid: Yes (first 30 days)         │
│                                         │
│  👨‍👩‍👧 Personal Leave                  │
│  ├─ Advance Notice: 1 day              │
│  ├─ Annual Quota: 14 days              │
│  └─ Paid: No                           │
│                                         │
│  💑 Marriage Leave                     │
│  ├─ Advance Notice: 7 days             │
│  ├─ Lifetime Quota: 8 days             │
│  └─ Paid: Yes                          │
│                                         │
│  👶 Maternity/Paternity Leave          │
│  ├─ Advance Notice: 14 days            │
│  ├─ Quota: 56 days / 7 days            │
│  └─ Paid: Yes                          │
│                                         │
│  [Add Leave Type]  [Edit]  [Disable]   │
│                                         │
└─────────────────────────────────────────┘
```

### Leave Request Review

Navigate to: **Leave Management → Pending Approvals**

```
┌─────────────────────────────────────────┐
│ Pending Leave Requests                  │
├─────────────────────────────────────────┤
│                                         │
│  【Request #001】                       │
│  Staff: Chef Zhang                      │
│  Leave Type: Annual Leave               │
│  Date: 2025-11-05 ~ 2025-11-07 (3 days)│
│  Reason: Family vacation                │
│  Submitted: 2025-10-26 10:30           │
│                                         │
│  【System Check】                       │
│  ✅ Remaining annual leave: 7 days     │
│  ✅ Advance notice: 10 days (compliant)│
│  ⚠️ 1 other chef on leave this period  │
│                                         │
│  Review Comments: _______________      │
│                                         │
│  [Approve]  [Reject]  [Request Info]   │
│                                         │
└─────────────────────────────────────────┘
```

### Staff Leave Balance Query

Navigate to: **Leave Management → Balance Management**

```
┌─────────────────────────────────────────────────────┐
│ Staff Leave Balance Overview                        │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Staff: Chef Zhang | Tenure: 3 years               │
│                                                     │
│  【Annual Leave Balance】                          │
│                                                     │
│  Annual Leave: ████████░░░░  Used 8 / Total 14    │
│  Sick Leave:   ██░░░░░░░░░░  Used 2 / Total 30    │
│  Personal Leave: ░░░░░░░░░░░  Used 0 / Total 14   │
│                                                     │
│  【Leave History】                                  │
│  2025-08-15 ~ 2025-08-16  Annual  2 days  (Vacation)│
│  2025-09-20 ~ 2025-09-23  Annual  4 days  (Family) │
│  2025-10-10              Sick     1 day   (Cold)   │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Leave Statistics Report

Navigate to: **Leave Management → Statistics Report**

```
┌───────────────────────────────────────────────┐
│ Monthly Leave Statistics (2025-10)            │
├───────────────────────────────────────────────┤
│                                               │
│  Total Leave Days: 23                         │
│  Total Leave Requests: 12                     │
│                                               │
│  Leave Type Distribution:                     │
│  ████████████░░░░░░ Annual (15 days, 65%)    │
│  ████░░░░░░░░░░░░░░ Sick (5 days, 22%)       │
│  ██░░░░░░░░░░░░░░░░ Personal (3 days, 13%)   │
│                                               │
│  Top Leave Takers:                            │
│  1. Server Li (5 days)                        │
│  2. Chef Zhang (4 days)                       │
│  3. Cashier Wang (3 days)                     │
│                                               │
└───────────────────────────────────────────────┘
```

---

## 📊 Business Analytics

### Analytics Dashboard Overview

Navigate to: **Business Analytics → Dashboard**

```
┌───────────────────────────────────────────────────────┐
│ Business Analytics Dashboard            [2025-10-26] │
├───────────────────────────────────────────────────────┤
│                                                       │
│  【Today's Real-time Data】                          │
│                                                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│  │ Revenue  │  │ Orders   │  │ Avg Order│          │
│  │ $12,450  │  │ 42       │  │ $296     │          │
│  │ ↑ +15%   │  │ ↑ +8%    │  │ ↑ +7%    │          │
│  └──────────┘  └──────────┘  └──────────┘          │
│                                                       │
│  【Weekly Trend】                                    │
│                                                       │
│  Revenue Trend:                                       │
│  $15k ┤                            ⬤                │
│  $12k ┤            ⬤         ⬤                      │
│  $9k  ┤      ⬤         ⬤                            │
│  $6k  ┤ ⬤                                            │
│       └────────────────────────────                 │
│        Mon  Tue  Wed  Thu  Fri  Sat                │
│                                                       │
└───────────────────────────────────────────────────────┘
```

### Revenue Analysis

Navigate to: **Business Analytics → Revenue Report**

#### Time Slot Analysis

```
┌───────────────────────────────────────────────┐
│ Revenue by Time Slot (This Month)             │
├───────────────────────────────────────────────┤
│                                               │
│  Breakfast (08:00-11:00)                     │
│  ████░░░░░░░░░░░░░░ $12,500 (12%)           │
│                                               │
│  Lunch (11:00-14:00)                         │
│  ███████████████░░░░ $45,800 (45%)          │
│                                               │
│  Afternoon Tea (14:00-17:00)                 │
│  ████████░░░░░░░░░░ $15,200 (15%)           │
│                                               │
│  Dinner (17:00-21:00)                        │
│  ████████████░░░░░░ $28,500 (28%)           │
│                                               │
│  Best Period: Lunch (11:00-14:00) 💰        │
│  Improvement: Boost breakfast revenue 📈     │
│                                               │
└───────────────────────────────────────────────┘
```

#### Monthly Comparison

```
┌───────────────────────────────────────────────┐
│ Monthly Revenue Comparison                    │
├───────────────────────────────────────────────┤
│                                               │
│  2025 Revenue Trend:                          │
│                                               │
│  $120k ┤                          ⬤          │
│  $100k ┤              ⬤     ⬤                │
│  $80k  ┤        ⬤                             │
│  $60k  ┤   ⬤                                  │
│        └──────────────────────────           │
│         Jul  Aug  Sep  Oct  Nov              │
│                                               │
│  Growth Trend: ↗ Steady growth               │
│  MoM Growth: +12%                             │
│  YoY Growth: +28%                             │
│                                               │
└───────────────────────────────────────────────┘
```

### Menu Item Sales Analysis

Navigate to: **Business Analytics → Item Analysis**

```
┌───────────────────────────────────────────────────────┐
│ Top Selling Items (This Month)                        │
├───────────────────────────────────────────────────────┤
│                                                       │
│  Rank  Item Name       Qty    Revenue    Share       │
│  ────────────────────────────────────────────────    │
│  🥇   Seafood Rice    287    $51,660    18%         │
│  🥈   Fried Tofu      245    $19,600    7%          │
│  🥉   Melon Tea       423    $12,690    4%          │
│  4    3-Cup Chicken   198    $39,600    14%         │
│  5    Oyster Omelet   176    $26,400    9%          │
│                                                       │
│  【Insights】                                        │
│  • Seafood Rice is star product, maintain quality   │
│  • Melon Tea high volume but low price, add drinks  │
│  • 3-Cup Chicken high revenue, promote more         │
│                                                       │
└───────────────────────────────────────────────────────┘
```

#### Low-Selling Items Analysis

```
┌───────────────────────────────────────────────┐
│ Low-Selling Items (< 10 orders this month)    │
├───────────────────────────────────────────────┤
│                                               │
│  Item Name           Qty     Suggestion       │
│  ────────────────────────────────────         │
│  Braised Meatball    5       Remove or improve│
│  Wood Ear Salad      3       Adjust price/promo│
│  Taro Sago          8       Summer only       │
│                                               │
└───────────────────────────────────────────────┘
```

### Table Turnover Rate Analysis

Navigate to: **Business Analytics → Table Analysis**

```
┌───────────────────────────────────────────────┐
│ Table Utilization Efficiency                  │
├───────────────────────────────────────────────┤
│                                               │
│  Table   Today's Turns    Avg Dining Time    │
│  ─────────────────────────────────────       │
│  A1      5 times          45 min  ⭐⭐⭐    │
│  A2      6 times          38 min  ⭐⭐⭐⭐  │
│  A3      3 times          62 min  ⭐⭐      │
│  B1      4 times          50 min  ⭐⭐⭐    │
│                                               │
│  【Efficiency Rating】                        │
│  ⭐⭐⭐⭐⭐ Excellent (< 40 min)            │
│  ⭐⭐⭐⭐   Good (40-50 min)                │
│  ⭐⭐⭐     Average (50-60 min)             │
│  ⭐⭐       Needs Improvement (> 60 min)    │
│                                               │
│  Recommendations:                             │
│  • Table A3 too slow, check service flow     │
│  • Table A2 excellent, use as benchmark      │
│                                               │
└───────────────────────────────────────────────┘
```

### Customer Analysis

Navigate to: **Business Analytics → Customer Analysis**

```
┌───────────────────────────────────────────────┐
│ Customer Consumption Behavior                 │
├───────────────────────────────────────────────┤
│                                               │
│  【Customer Structure】                       │
│                                               │
│  New: ██████░░░░ 28% (145)                   │
│  Returning: ███████████ 52% (270)            │
│  VIP: █████░░░░░ 20% (104)                   │
│                                               │
│  【Visit Frequency】                          │
│                                               │
│  3+ times/week: ████░░░░░░ 15%               │
│  1-2 times/week: ████████░░ 35%              │
│  1-3 times/month: ██████████ 40%             │
│  Occasional: ██░░░░░░░░ 10%                  │
│                                               │
│  【Customer Retention】                       │
│  30-day retention: 68%  ⭐⭐⭐⭐             │
│  60-day retention: 52%  ⭐⭐⭐               │
│  90-day retention: 45%  ⭐⭐⭐               │
│                                               │
└───────────────────────────────────────────────┘
```

---

## 🤖 AI Smart Analytics

> **Feature Status**: Backend complete, frontend UI live
> **Supported Models**: OpenAI, Anthropic, Google Gemini, Groq

### AI Analytics System Architecture

```
┌─────────────────────────────────────────────────────┐
│ AI Analytics Engine                                 │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Data Collection Layer                              │
│  ├─ Order data                                     │
│  ├─ Menu sales data                                │
│  ├─ Customer behavior data                         │
│  └─ Operational efficiency data                    │
│         ↓                                           │
│  AI Analysis Layer                                  │
│  ├─ Sales trend forecasting                        │
│  ├─ Menu optimization suggestions                  │
│  ├─ Customer preference analysis                   │
│  └─ Operational efficiency recommendations         │
│         ↓                                           │
│  Insights Report Layer                              │
│  └─ Generate actionable recommendations            │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### AI Model Configuration

Navigate to: **Settings → AI Analytics Settings**

```
┌─────────────────────────────────────────┐
│ AI Analytics Model Settings             │
├─────────────────────────────────────────┤
│                                         │
│  Select AI Provider:                    │
│  ○ OpenAI (GPT-4)                      │
│  ○ Anthropic (Claude)                  │
│  ○ Google (Gemini Pro)                 │
│  ○ Groq (Llama 3)                      │
│                                         │
│  API Key: ********************         │
│                                         │
│  Analysis Frequency:                    │
│  ○ Daily auto-analysis                 │
│  ○ Weekly auto-analysis                │
│  ○ Manual trigger                      │
│                                         │
│  Analysis Scope:                        │
│  □ Sales analysis                      │
│  □ Menu optimization                   │
│  □ Customer insights                   │
│  □ Operational recommendations         │
│                                         │
│  [Save Settings]  [Test Connection]    │
│                                         │
└─────────────────────────────────────────┘
```

### AI Insights Report

Navigate to: **AI Analytics → Insights Report**

```
┌───────────────────────────────────────────────────────┐
│ AI Smart Insights Report              [2025-10-26]   │
├───────────────────────────────────────────────────────┤
│                                                       │
│  【Sales Trend Forecast】🔮                          │
│                                                       │
│  Based on 90-day data analysis, AI predicts:         │
│                                                       │
│  Next Week Revenue Forecast: $85,000 - $92,000       │
│  Confidence Level: ⭐⭐⭐⭐⭐ (92%)                  │
│                                                       │
│  Prediction Basis:                                    │
│  • Recent revenue showing steady growth               │
│  • Weather forecast good, expect higher dine-out     │
│  • No major events, stable dining patterns           │
│                                                       │
│  ────────────────────────────────────────────        │
│                                                       │
│  【Menu Optimization Suggestions】🍽️                 │
│                                                       │
│  📈 Recommend Promoting:                             │
│  • "3-Cup Chicken" - High margin (42%), low order 15%│
│    Suggestion: Create attractive photos, feature it  │
│                                                       │
│  • "Seafood Noodle" - Cost down 20%, can boost margin│
│    Suggestion: Adjust pricing from $150 to $165      │
│                                                       │
│  📉 Recommend Adjusting:                             │
│  • "Braised Meatball" - Low sales (5 orders/month)  │
│    Suggestion: Temporarily remove or improve recipe  │
│                                                       │
│  ────────────────────────────────────────────        │
│                                                       │
│  【Customer Behavior Insights】👥                    │
│                                                       │
│  High-Value Customer Characteristics:                │
│  • Prefer lunch hours (12:00-13:30)                  │
│  • Average stay 55 minutes                           │
│  • Frequently order "Set Meals"                      │
│  • High probability of ordering drinks & desserts    │
│                                                       │
│  Recommended Actions:                                │
│  • Launch "Business Set Meal" for lunch             │
│  • Design "Main+Drink+Dessert" combo offers         │
│  • Speed up lunch service for business customers    │
│                                                       │
│  ────────────────────────────────────────────        │
│                                                       │
│  【Operational Efficiency Suggestions】⚡            │
│                                                       │
│  Staffing Optimization:                              │
│  • Friday dinner (18:00-20:00) often understaffed   │
│    Suggestion: Add 1 chef + 1 server                │
│                                                       │
│  • Wednesday lunch (12:00-14:00) overstaffed        │
│    Suggestion: Reduce 1 server, save labor costs    │
│                                                       │
│  Expected Benefits:                                  │
│  • Save labor costs: $4,500/month                   │
│  • Improve service quality, reduce complaints       │
│  • Increase staff satisfaction                      │
│                                                       │
└───────────────────────────────────────────────────────┘
```

### Real-time Smart Q&A

Navigate to: **AI Analytics → Smart Assistant**

```
┌─────────────────────────────────────────┐
│ AI Smart Assistant 💬                   │
├─────────────────────────────────────────┤
│                                         │
│  You: Why is today's revenue lower than│
│       yesterday?                        │
│                                         │
│  AI: Based on data analysis, lower     │
│      revenue today has three main       │
│      reasons:                           │
│                                         │
│      1. Today is Wednesday, historical │
│         data shows Wednesday revenue   │
│         averages 12% lower than Tuesday│
│                                         │
│      2. Raining today, dine-out        │
│         customers reduced by 15-20%    │
│                                         │
│      3. Today's lunch period (main     │
│         revenue time) had 8 fewer      │
│         orders than average            │
│                                         │
│      Suggestion: Launch "delivery      │
│      promotions" on rainy days to      │
│      offset dine-in customer reduction │
│                                         │
│  [Send]  [Clear Chat]                  │
│                                         │
└─────────────────────────────────────────┘
```

### Competitive Analysis

Navigate to: **AI Analytics → Competitive Analysis**

```
┌───────────────────────────────────────────────┐
│ Nearby Competitor Analysis                    │
├───────────────────────────────────────────────┤
│                                               │
│  Analysis Range: 1km radius, same type       │
│  Data Source: Public reviews, social media   │
│                                               │
│  【Competitor Overview】                      │
│                                               │
│  Delicious Seafood (300m)                     │
│  ├─ Rating: ⭐⭐⭐⭐ 4.2/5.0                  │
│  ├─ Price: $$$ (slightly higher)             │
│  ├─ Strengths: Fresh seafood, atmosphere     │
│  └─ Weaknesses: High prices, long waits      │
│                                               │
│  Traditional Snacks (150m)                    │
│  ├─ Rating: ⭐⭐⭐ 3.8/5.0                    │
│  ├─ Price: $ (budget)                        │
│  ├─ Strengths: Cheap, fast service           │
│  └─ Weaknesses: Basic environment, few items │
│                                               │
│  【Your Positioning】                         │
│  Rating: ⭐⭐⭐⭐⭐ 4.7/5.0                    │
│  Price: $$ (moderate)                         │
│  Strengths: Great value, quality, comfort    │
│                                               │
│  【AI Recommendations】                       │
│  • Maintain value proposition, core strength │
│  • Launch "Daily Seafood Special" to compete │
│  • Keep current pricing, differentiate from  │
│    budget snacks                              │
│                                               │
└───────────────────────────────────────────────┘
```

---

## ❓ FAQ

### Login Related

**Q: Forgot login password?**

```
Step 1: Click "Forgot Password" on login page
   ↓
Step 2: Enter registered email
   ↓
Step 3: System sends password reset link to email
   ↓
Step 4: Click link, set new password
   ↓
Step 5: Login with new password
```

**Q: Can multiple people login to same account?**

A: Yes. Owner account supports multi-device simultaneous login for office and remote management convenience.

---

### Menu Related

**Q: How to quickly update menu item prices?**

```
Method 1: Single item
  Go to Menu Management → Select Item → Edit Price

Method 2: Batch update
  Go to Menu Management → Batch Operations → Select Items → Unified Price Adjustment
```

**Q: How to set item as temporarily out of stock?**

A: Navigate to **Menu Management → Select Item → Change status to "Temporarily Out of Stock"**. System will automatically mark "Sold Out Today" on menu, without deleting item info.

**Q: Can I set limited-time availability for items?**

A: Yes. Navigate to **Menu Management → Item Edit → Availability Time Settings**, e.g., set "Breakfast Porridge" available only 08:00-11:00.

---

### QR Code Related

**Q: What if QR code is damaged?**

```
Step 1: Go to QR Code Management
   ↓
Step 2: Find the QR code
   ↓
Step 3: Click "Regenerate"
   ↓
Step 4: Download new QR code
   ↓
Step 5: Print and display
   ↓
Note: Old QR code automatically deactivated
```

**Q: Can I customize QR code appearance?**

A: Yes. Navigate to **QR Code Management → Design Templates**, choose:

- Pure QR code (black & white)
- Branded (with logo and colors)
- Instructional (with usage guide text)

**Q: Customer sees error message when scanning QR code?**

Possible reasons:

1. QR code regenerated (old code deactivated)
2. Restaurant temporarily closed
3. Table deactivated

Solutions:

- Confirm QR code status is "Active"
- Check restaurant operation status
- Regenerate and display new QR code

---

### Order Related

**Q: How to handle customer cancellation requests?**

```
Step 1: Go to order details page
   ↓
Step 2: Click "Cancel" button
   ↓
Step 3: Select cancellation reason
   ├─ Customer request
   ├─ Ingredient shortage
   ├─ Kitchen busy
   └─ Other reason
   ↓
Step 4: Fill refund amount (if needed)
   ↓
Step 5: Confirm cancellation
   ↓
System auto-notifies customer
```

**Q: Too many orders, cannot handle?**

Suggested handling:

1. **Pause Orders**: Go to **Restaurant Settings → Pause Online Ordering**, temporarily close online ordering
2. **Extend Prep Time**: Adjust estimated completion time on order page, inform customers of wait
3. **Add Staff**: Temporarily assign additional chefs or servers

**Q: How to view historical orders?**

Navigate to **Order Management → Order History**, filter by date, table, status and other criteria.

---

### Staff Related

**Q: How to reset staff password?**

```
Method 1: Owner reset
  Staff Management → Select Staff → Reset Password → Notify Staff

Method 2: Staff self-reset
  Login page → Forgot Password → Enter Email → Receive reset link
```

**Q: How to handle account when staff leaves?**

Recommended approach:

1. Navigate to **Staff Management → Select Staff → Deactivate Account** (don't delete, keep history)
2. System retains staff work records (orders, schedules, etc.)
3. Staff cannot login to system anymore

**Q: Can I restrict staff login to specific times?**

A: Currently not supported, but can monitor staff login times via "Schedule Management" and "Attendance Records".

---

### Payment Related

**Q: How to process checkout?**

MakanMakan currently supports offline payment:

```
Customer finishes dining
   ↓
Go to counter for payment
   ↓
Owner/Cashier finds order in system
   ↓
Click "Checkout" button
   ↓
Select payment method:
├─ Cash
├─ Credit Card
├─ Mobile Payment (WeChat, Alipay, etc.)
└─ Other
   ↓
Enter amount received
   ↓
Print receipt (optional)
   ↓
Complete checkout
```

**Q: Can I offer discounts?**

A: Yes. On checkout page:

1. Click "Apply Discount"
2. Select discount type:
   - Percentage discount (e.g., 10% off)
   - Fixed amount discount (e.g., $50 off)
3. Fill discount reason
4. Confirm and complete checkout

---

### System Related

**Q: Which devices are supported?**

```
✅ Desktop (Recommended)
├─ Windows 10/11
├─ macOS
└─ Linux

✅ Tablet
├─ iPad
└─ Android Tablet

✅ Mobile (View functions)
├─ iPhone
└─ Android Phone
```

**Q: Need to install software?**

A: No. MakanMakan is web-based, only needs browser and internet.

Recommended browsers:

- Google Chrome (Recommended)
- Microsoft Edge
- Safari
- Firefox

**Q: What if internet disconnects?**

```
When offline:
├─ System displays "Offline Mode" warning
├─ Can continue viewing loaded data
└─ Cannot receive new orders

When reconnected:
└─ System auto-syncs data, resumes normal operation
```

**Q: Will data be lost?**

A: No. MakanMakan uses cloud architecture, all data saved in real-time to Cloudflare global network with multiple backups, ensuring data security.

---

### Accounting Related

**Q: How to export business reports?**

```
Method 1: Daily report
  Business Analytics → Select Date → Export Excel

Method 2: Custom report
  Business Analytics → Custom Date Range → Select Export Items → Export

Report includes:
├─ Revenue details
├─ Order details
├─ Menu sales statistics
├─ Customer statistics
└─ Staff hours
```

**Q: Can I see cost and profit for each dish?**

A: Yes. Navigate to **Menu Management → Item List → Cost Analysis**, view:

- Ingredient costs
- Selling price
- Gross margin
- Monthly sales
- Total profit contribution

---

## 📞 Technical Support

### Contact Us

```
┌─────────────────────────────────────────┐
│ Need Assistance?                        │
├─────────────────────────────────────────┤
│                                         │
│  📧 Email Support                       │
│  support@makanmakan.com                │
│  (Reply within 24-48 hours)            │
│                                         │
│  💬 Live Chat                           │
│  Weekdays 09:00-18:00                  │
│  Weekends 10:00-17:00                  │
│                                         │
│  📱 Emergency Hotline                   │
│  0800-123-456 (System Issues)          │
│  24-hour service                        │
│                                         │
│  📚 Online Documentation                │
│  docs.makanmakan.com                   │
│                                         │
└─────────────────────────────────────────┘
```

### System Status Monitor

Real-time system status: `status.makanmakan.com`

```
System Status Dashboard

┌─────────────────────────────────────────┐
│ All Systems Operational ✅              │
├─────────────────────────────────────────┤
│                                         │
│  API Service:     ✅ Normal             │
│  Database:        ✅ Normal             │
│  Image Service:   ✅ Normal             │
│  Real-time:       ✅ Normal             │
│                                         │
│  Response Time:   85ms (Excellent)     │
│  Availability:    99.98%               │
│                                         │
└─────────────────────────────────────────┘
```

---

## 🎯 Next Steps

### Recommended Flow for New Owners

```
Week 1: Basic Setup
  ├─ Complete restaurant profile
  ├─ Build menu and upload images
  └─ Set up tables and generate QR codes

Week 2: Trial Operation
  ├─ Invite friends/family to test ordering
  ├─ Add staff accounts and train
  └─ Adjust menu and pricing

Week 3: Official Operation
  ├─ Start accepting customer orders
  ├─ Monitor order flow
  └─ Collect customer feedback

Week 4: Optimize & Adjust
  ├─ Analyze business reports
  ├─ Review AI recommendations
  └─ Adjust menu and operations
```

### Explore Advanced Features

When familiar with basic operations, explore these advanced features:

```
✨ Advanced Features List

□ Set up member points system
□ Create coupon campaigns
□ Enable AI smart analytics
□ Set up automated scheduling
□ Build staff performance evaluation
□ Integrate accounting system
□ Set up multi-location management
```

---

## 📝 Version Update Log

### 2.0.0 (2025-10-26)

- ✨ New owner operation interface
- ✨ AI smart analytics live
- ✨ Scheduling system architecture complete
- 🔧 Performance optimization and bug fixes

### 1.5.0 (2025-10-12)

- ✨ Multi-language support (6 languages)
- ✨ Seat-level QR code feature
- 🔧 Enhanced password security

### 1.0.0 (2025-09-01)

- 🎉 MakanMakan officially launched
- ✨ Basic restaurant management features
- ✨ QR code ordering system
- ✨ Order management system

---

## ✅ Manual Completion Confirmation

Congratulations on completing the Shop Owner User Guide!

```
Learning Progress Check:

□ Understand system login and basic operations
□ Know how to set restaurant profile
□ Know how to create and manage menu
□ Know how to set tables and generate QR codes
□ Know how to handle orders and checkout
□ Know how to manage staff accounts and permissions
□ Know how to view business analytics reports
□ Understand AI analytics features

Ready to start using MakanMakan? 🚀
```

---

**Wishing You Prosperous Business! 🎊**

---

_This manual is continuously updated. For any suggestions, please contact us._
