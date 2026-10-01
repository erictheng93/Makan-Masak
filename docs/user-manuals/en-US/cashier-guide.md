# 💰 MakanMakan Cashier Manual

> **Version**: 2.0
> **Last Updated**: 2025-10-26
> **Target Audience**: Cashiers, Counter Staff

---

## 📚 Table of Contents

1. [Quick Start](#quick-start)
2. [System Overview](#system-overview)
3. [Cashier System Interface](#cashier-system-interface)
4. [Order Checkout Process](#order-checkout-process)
5. [Payment Methods](#payment-methods)
6. [Receipt Handling](#receipt-handling)
7. [Refunds & Cancellations](#refunds--cancellations)
8. [Daily Reconciliation](#daily-reconciliation)
9. [Report Queries](#report-queries)
10. [Exception Handling](#exception-handling)
11. [Cash Management](#cash-management)
12. [Security Guidelines](#security-guidelines)
13. [FAQ](#faq)

---

## 🚀 Quick Start

### System Login Process

```
┌─────────────────────────────────────────────┐
│ Cashier Login Flow                          │
├─────────────────────────────────────────────┤
│                                             │
│  1️⃣ Open Cashier System                    │
│      ↓                                      │
│  2️⃣ Enter Cashier Credentials              │
│      ↓                                      │
│  3️⃣ System Validates Permission (Role=4)   │
│      ↓                                      │
│  4️⃣ Enter Cashier Workspace                │
│                                             │
└─────────────────────────────────────────────┘
```

### Daily Opening Checklist

✅ **Before Business Hours**

- [ ] Login to cashier system
- [ ] Verify cash drawer float amount
- [ ] Check receipt paper supply
- [ ] Confirm network connectivity
- [ ] Review daily sales targets

✅ **During Business Hours**

- [ ] Monitor pending checkout orders
- [ ] Keep cash drawer organized
- [ ] Regularly verify POS functionality
- [ ] Watch for unusual transaction alerts

✅ **After Business Hours**

- [ ] Execute daily reconciliation
- [ ] Count cash and compare with records
- [ ] Print daily settlement report
- [ ] Deposit cash in safe
- [ ] Logout from system

---

## 🏢 System Overview

### Cashier Permission Scope

```
┌─────────────────────────────────────────────────────────┐
│ Cashier Available Functions                            │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ✅ Order Checkout      ✅ Payment Processing          │
│  ✅ Receipt Printing    ✅ Refund Requests             │
│  ✅ Daily Settlement    ✅ Report Queries              │
│  ✅ Amount Verification ✅ Exception Reporting         │
│                                                         │
│  ❌ Menu Management     ❌ Staff Management            │
│  ❌ Price Modification  ❌ System Settings             │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Workflow Diagram

```
┌────────────────────────────────────────────────────────┐
│            Cashier Daily Workflow                      │
├────────────────────────────────────────────────────────┤
│                                                        │
│  Customer Finishes Meal                                │
│       ↓                                                │
│  Query Order ────→ Confirm Order Details              │
│       ↓                                                │
│  Calculate Total ──→ Inform Customer Amount           │
│       ↓                                                │
│  Select Payment Method ─→ Cash/Card/Other             │
│       ↓                                                │
│  Collect Payment ────→ Verify Amount Correct          │
│       ↓                                                │
│  Complete Checkout ────→ Print Receipt                │
│       ↓                                                │
│  Hand Over Receipt ────→ Give Change (if needed)      │
│       ↓                                                │
│  Thank Customer ────→ Welcome Back                     │
│                                                        │
└────────────────────────────────────────────────────────┘
```

---

## 💻 Cashier System Interface

### Main Dashboard

```
┌──────────────────────────────────────────────────────────┐
│                   Cashier System Dashboard               │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  ┌────────────────┐  ┌────────────────┐               │
│  │  Pending Orders│  │  Today's Sales │               │
│  │    12 Orders   │  │  $25,680       │               │
│  └────────────────┘  └────────────────┘               │
│                                                          │
│  ┌──────────────────────────────────────────┐          │
│  │  Order List                              │          │
│  ├──────┬──────┬─────────┬─────────┤          │
│  │ Table│ Time │ Amount  │ Status  │          │
│  ├──────┼──────┼─────────┼─────────┤          │
│  │  A1  │ 12:35│  $580   │ Pending │ [Checkout]│
│  │  B3  │ 12:42│  $820   │ Pending │ [Checkout]│
│  │  C2  │ 12:50│  $450   │ Pending │ [Checkout]│
│  └──────┴──────┴─────────┴─────────┘          │
│                                                          │
│  [Quick Search] [Filter] [Reports] [Settlement]        │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### Function Button Description

| Button                 | Function         | Description                             |
| ---------------------- | ---------------- | --------------------------------------- |
| 🔍 **Quick Search**    | Search Orders    | Search by table, order number, or phone |
| 📋 **Order Details**   | View Details     | Display complete order content          |
| 💳 **Checkout**        | Process Payment  | Enter payment flow                      |
| 🧾 **Reprint Receipt** | Reprint          | Reprint lost or damaged receipts        |
| 🔄 **Refund**          | Process Refund   | Apply for order refund                  |
| 📊 **Reports**         | Query Reports    | View business data                      |
| 🔐 **Settlement**      | Daily Settlement | Execute end-of-day reconciliation       |

---

## 🧾 Order Checkout Process

### Standard Checkout Steps

#### Step 1: Query Order

**Method 1: Table Number Query**

```
1. Click "Quick Search"
2. Enter table number (e.g., A1, B3)
3. System displays all unpaid orders for that table
4. Confirm it's the customer's order
```

**Method 2: Order Number Query**

```
1. Ask customer for order number
2. Enter order number
3. System displays order details
4. Confirm order content
```

**Method 3: Phone Number Query**

```
1. Ask if customer is a member
2. Enter customer's phone number
3. System lists member's unpaid orders
4. Ask customer to confirm which order to pay
```

---

#### Step 2: Confirm Order Content

```
┌────────────────────────────────────────┐
│ Order #20251026-001                    │
├────────────────────────────────────────┤
│                                        │
│ Table: A1         Time: 12:35          │
│ Customer: Member 0912-345-678          │
│                                        │
│ ────────────────────────────────────  │
│                                        │
│ Items:                                 │
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
│ Total:                         $561    │
│                                        │
└────────────────────────────────────────┘
```

**Check Points:**

- ✅ Verify item quantities are correct
- ✅ Verify prices are calculated correctly
- ✅ Verify special discounts are applied
- ✅ Verify service charge is applicable

---

#### Step 3: Select Payment Method

```
┌────────────────────────────────────────┐
│ Please Select Payment Method           │
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

#### Step 4: Process Payment

**Cash Payment Flow:**

```
1️⃣ Inform customer of total amount
   "The total is $561"

2️⃣ Receive cash
   Customer pays: $1,000

3️⃣ Enter amount received
   System automatically calculates change: $439

4️⃣ Confirm amount and click "Complete Payment"

5️⃣ Prepare change
   - $400: 4 × $100 bills
   - $ 30: 3 × $10 coins
   - $  9: 1 × $5 + 4 × $1 coins

6️⃣ Repeat change amount
   "Your change is $439, thank you"
```

**Credit Card Payment Flow:**

```
1️⃣ Select "Credit Card" payment
2️⃣ Enter payment amount: $561
3️⃣ Insert/tap credit card
4️⃣ Wait for authorization...
5️⃣ Customer enters PIN/signs
6️⃣ Transaction successful ✅
7️⃣ Print merchant copy (requires signature)
8️⃣ Customer signs for confirmation
9️⃣ File signed receipt
```

**Mobile Payment Flow:**

```
1️⃣ Select "Mobile Payment"
2️⃣ Select payment platform
   • LINE Pay
   • Street Payment
   • Apple Pay
   • Google Pay

3️⃣ Display payment QR code
4️⃣ Customer scans QR code
5️⃣ Wait for payment confirmation...
6️⃣ Payment successful ✅
7️⃣ Automatically complete checkout
```

---

#### Step 5: Print Receipt

```
┌────────────────────────────────────────┐
│          MakanMakan Restaurant         │
│       Tax ID: 12345678                 │
│   Address: No. 7, Xinyi Rd., Taipei   │
│       Phone: (02) 2345-6789            │
│                                        │
├────────────────────────────────────────┤
│                                        │
│ Date: 2025/10/26      Time: 12:45      │
│ Table: A1           Cashier: Mary      │
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
│ Total:                         $561    │
│                                        │
│ Payment Method: Cash                   │
│ Amount Received: $1,000                │
│ Change: $439                           │
│                                        │
│ ────────────────────────────────────  │
│                                        │
│    Thank you, please come again!       │
│                                        │
│         MakanMakan.com                 │
│                                        │
└────────────────────────────────────────┘
```

---

#### Step 6: Complete Transaction

```
✅ Final Confirmation Checklist

1. [ ] Receipt printed
2. [ ] Change amount correct
3. [ ] Credit card receipt signed (if applicable)
4. [ ] Hand receipt to customer
5. [ ] Thank customer politely
```

**Standard Greeting:**

```
"Here's your receipt and $439 change,
 please keep them safe. Thank you for dining with us,
 welcome back!"
```

---

## 💳 Payment Methods

### Cash Payment

#### Cash Handling Guidelines

```
┌─────────────────────────────────────────────┐
│ Standard Cash Collection Process            │
├─────────────────────────────────────────────┤
│                                             │
│  1️⃣ Clearly state the amount               │
│     "The total is $561"                     │
│                                             │
│  2️⃣ Confirm the denomination received      │
│     "Received $1,000"                       │
│                                             │
│  3️⃣ Place bill on top of register (avoid disputes) │
│                                             │
│  4️⃣ Enter amount received in system        │
│                                             │
│  5️⃣ Verify change amount correct           │
│     System shows: Change $439              │
│                                             │
│  6️⃣ Count out change                       │
│     - Large bills first (hundreds)         │
│     - Then coins (tens, ones)              │
│                                             │
│  7️⃣ Repeat change amount                   │
│     "Your change is $439"                  │
│                                             │
│  8️⃣ Place received bill in cash drawer    │
│                                             │
└─────────────────────────────────────────────┘
```

#### Counterfeit Detection

**Check Points:**

| Bill         | Verification Method                                     |
| ------------ | ------------------------------------------------------- |
| 💵 **$1000** | Color-shifting foil, intaglio printing, security thread |
| 💵 **$500**  | Hidden "500", plum blossom watermark                    |
| 💵 **$100**  | Color-shifting ink, braille dots                        |

**Suspicious Bill Handling:**

```
1. Don't directly accuse customer
2. Politely say: "Excuse me, this bill seems problematic, could you use another?"
3. If customer insists, request manager assistance
4. Retain suspicious bill, hand to manager or police
```

---

### Credit Card Payment

#### Card Terminal Operation

```
┌─────────────────────────────────────────────┐
│ Credit Card Transaction Flow                │
├─────────────────────────────────────────────┤
│                                             │
│  Swipe/Insert/Tap Card                      │
│       ↓                                     │
│  Enter Transaction Amount                   │
│       ↓                                     │
│  Wait for Authorization (5-10 sec)          │
│       ↓                                     │
│  ┌──────────┐  ┌──────────┐               │
│  │ Approved │  │ Declined │               │
│  └──────────┘  └──────────┘               │
│       ↓              ↓                      │
│  Print Receipt    Try Other Method         │
│       ↓                                     │
│  Customer Signs                             │
│       ↓                                     │
│  Verify Signature                           │
│       ↓                                     │
│  Transaction Complete ✅                   │
│                                             │
└─────────────────────────────────────────────┘
```

#### Transaction Failure Handling

| Error Message               | Cause                       | Solution                                            |
| --------------------------- | --------------------------- | --------------------------------------------------- |
| ❌ **Insufficient Funds**   | Credit limit exceeded       | Ask customer to use another card or payment method  |
| ❌ **Card Expired**         | Card past expiration        | Use valid card                                      |
| ❌ **Transaction Declined** | Bank refused authorization  | Suggest contacting issuing bank or alternate method |
| ❌ **Connection Failed**    | Network issue               | Retry card or use cash                              |
| ❌ **Card Read Error**      | Damaged magnetic strip/chip | Clean card and retry or use different card          |

---

### Mobile Payment

#### Supported Payment Platforms

```
┌─────────────────────────────────────────┐
│ MakanMakan Supported Mobile Payments    │
├─────────────────────────────────────────┤
│                                         │
│  📱 LINE Pay          ✅ Supported      │
│  📱 Street Pay        ✅ Supported      │
│  📱 Apple Pay         ✅ Supported      │
│  📱 Google Pay        ✅ Supported      │
│  📱 EasyCard Pay      ✅ Supported      │
│  📱 Taiwan Pay        ✅ Supported      │
│                                         │
└─────────────────────────────────────────┘
```

#### QR Code Payment Flow

```
1️⃣ Select "Mobile Payment" in cashier system
2️⃣ Select customer's payment platform
3️⃣ System generates payment QR code
4️⃣ Customer opens mobile app to scan QR code
5️⃣ Customer confirms amount and completes payment
6️⃣ System receives payment notification (3-5 sec)
7️⃣ Display "Payment Successful" ✅
8️⃣ Automatically print receipt
```

---

### Split Payment

When customer uses multiple payment methods:

```
Example: Total amount $1,200

Customer wants to use:
  • Voucher: $500
  • Credit Card: Remaining amount

Procedure:
1️⃣ Select "Split Payment"
2️⃣ Process voucher first
   - Select "Voucher"
   - Enter or scan voucher number
   - System validates and deducts $500

3️⃣ System displays remaining amount: $700
4️⃣ Process remaining amount
   - Select "Credit Card"
   - Charge $700 to card

5️⃣ Transaction complete ✅
```

---

## Receipt Handling

The system currently prints receipts and does not issue electronic invoices. Each store handles invoices through its existing process.

---

## 🔄 Refunds & Cancellations

### Refund Policy

```
┌─────────────────────────────────────────────┐
│ MakanMakan Refund Policy                    │
├─────────────────────────────────────────────┤
│                                             │
│  ✅ Full Refund Cases:                      │
│     • Food not yet prepared                │
│     • Food quality issues                  │
│     • Wrong food served                    │
│     • Serious service failure              │
│                                             │
│  ⚠️ Partial Refund Cases:                   │
│     • Some items problematic               │
│     • Poor dining experience               │
│                                             │
│  ❌ No Refund Cases:                        │
│     • Already consumed meal                │
│     • Personal taste preferences only      │
│     • Past refund deadline                 │
│                                             │
└─────────────────────────────────────────────┘
```

---

### Refund Processing Flow

```
┌─────────────────────────────────────────────┐
│ Standard Refund Procedure                   │
├─────────────────────────────────────────────┤
│                                             │
│  Customer Requests Refund                   │
│       ↓                                     │
│  Understand Refund Reason                   │
│       ↓                                     │
│  Check if Meets Refund Policy               │
│       ↓                                     │
│  ┌──────────┐  ┌──────────┐               │
│  │Meets Policy│ │Not Eligible│             │
│  └──────────┘  └──────────┘               │
│       ↓              ↓                      │
│  Notify Manager   Politely Explain & Apologize │
│  for Approval                                │
│       ↓                                     │
│  Manager Approves                           │
│       ↓                                     │
│  Apply Refund in System                     │
│       ↓                                     │
│  Refund via Original Payment Method         │
│       ↓                                     │
│  Print Refund Receipt                       │
│       ↓                                     │
│  Customer Signs Confirmation                │
│       ↓                                     │
│  Refund Complete ✅                        │
│                                             │
└─────────────────────────────────────────────┘
```

---

### Refund Method Processing

#### Cash Refund

```
1️⃣ Confirm original order was cash payment
2️⃣ Calculate refund amount
3️⃣ Take cash from drawer
4️⃣ Repeat refund amount
5️⃣ Hand cash to customer
6️⃣ Customer counts and signs confirmation
7️⃣ Complete refund record in system
```

#### Credit Card Refund

```
1️⃣ Confirm original order was credit card payment
2️⃣ Select "Credit Card Refund"
3️⃣ System auto-reads original transaction data
4️⃣ Enter refund amount
5️⃣ Card terminal executes refund transaction
6️⃣ Wait for bank authorization (5-10 sec)
7️⃣ Refund successful ✅
8️⃣ Print refund receipt
9️⃣ Inform customer: "Refund will appear in your account in 3-7 business days"
```

#### Mobile Payment Refund

```
1️⃣ Select "Mobile Payment Refund"
2️⃣ Select original payment platform
3️⃣ Enter refund amount
4️⃣ System auto-executes refund
5️⃣ Refund successful ✅
6️⃣ Inform customer: "Refund will be returned to your account immediately"
```

---

### Refund Receipt Example

```
┌────────────────────────────────────────┐
│         MakanMakan Refund Receipt      │
├────────────────────────────────────────┤
│                                        │
│ Date: 2025/10/26    Time: 14:30        │
│ Original Order: 20251026-001           │
│ Refund Reason: Food quality issue      │
│                                        │
│ ────────────────────────────────────  │
│                                        │
│ Original Amount:         $561          │
│ Refund Amount:           $561          │
│ Refund Method:           Cash          │
│                                        │
│ ────────────────────────────────────  │
│                                        │
│ Cashier: Mary                          │
│ Approved by Manager: John              │
│                                        │
│ Customer Signature: ________________   │
│                                        │
│ Date: ____/____/____                   │
│                                        │
└────────────────────────────────────────┘
```

---

## 📊 Daily Reconciliation

### End-of-Day Settlement Timing

```
✅ When to execute end-of-day settlement?

1. After business hours end
2. All orders have been checked out
3. Confirm no pending refunds
4. Ready to count cash
```

---

### Standard Settlement Process

```
┌─────────────────────────────────────────────┐
│ End-of-Day Settlement Steps                 │
├─────────────────────────────────────────────┤
│                                             │
│  1️⃣ Login to cashier system                │
│      ↓                                      │
│  2️⃣ Select "Daily Settlement" function     │
│      ↓                                      │
│  3️⃣ System auto-tallies today's data       │
│      • Total sales                         │
│      • Transaction count                   │
│      • Each payment method amount          │
│      • Refund amount                       │
│      ↓                                      │
│  4️⃣ Count actual cash in drawer            │
│      ↓                                      │
│  5️⃣ Enter actual counted amount            │
│      ↓                                      │
│  6️⃣ System compares book vs actual         │
│      ↓                                      │
│  ┌──────────┐  ┌──────────┐               │
│  │  Match   │  │Discrepancy│               │
│  └──────────┘  └──────────┘               │
│      ↓              ↓                       │
│  7️⃣ Print report   Find reason             │
│      ↓              ↓                       │
│  8️⃣ Manager signs  Fill variance report    │
│      ↓              ↓                       │
│  9️⃣ Deposit cash   Manager reviews         │
│      ↓                                      │
│  🔟 Settlement complete ✅                  │
│                                             │
└─────────────────────────────────────────────┘
```

---

### Daily Business Report

```
┌────────────────────────────────────────────────────┐
│           MakanMakan Daily Report                  │
│           Date: 2025/10/26                         │
├────────────────────────────────────────────────────┤
│                                                    │
│ 【Business Summary】                               │
│                                                    │
│  Business Hours: 10:00 - 22:00                    │
│  Total Transactions: 156                          │
│  Average Transaction: $428                        │
│  Total Sales: $66,768                             │
│                                                    │
├────────────────────────────────────────────────────┤
│                                                    │
│ 【Payment Method Statistics】                     │
│                                                    │
│  💵 Cash:           $28,500  (42.7%)              │
│     Transactions: 72                              │
│                                                    │
│  💳 Credit Card:    $26,890  (40.3%)              │
│     Transactions: 58                              │
│                                                    │
│  📱 Mobile Payment: $11,378  (17.0%)              │
│     Transactions: 26                              │
│     └ LINE Pay:     $6,200                        │
│     └ Street Pay:   $3,450                        │
│     └ Other:        $1,728                        │
│                                                    │
├────────────────────────────────────────────────────┤
│                                                    │
│ 【Cash Reconciliation】                           │
│                                                    │
│  Opening Float:                    $5,000         │
│  Cash Revenue:                    $28,500         │
│  Cash Disbursements (Refunds):      $450         │
│  ─────────────────────────────────              │
│  Book Amount:                     $33,050         │
│  Actual Count:                    $33,050         │
│  ─────────────────────────────────              │
│  Variance:                            $0  ✅      │
│                                                    │
├────────────────────────────────────────────────────┤
│                                                    │
│ 【Refund Statistics】                             │
│                                                    │
│  Refund Count: 3                                  │
│  Refund Amount: $450                              │
│  Refund Reasons:                                  │
│    • Food Issues: 2 ($320)                       │
│    • Order Canceled: 1 ($130)                    │
│                                                    │
├────────────────────────────────────────────────────┤
│                                                    │
│ 【Exceptions】                                     │
│                                                    │
│  ✅ No exceptions recorded                         │
│                                                    │
├────────────────────────────────────────────────────┤
│                                                    │
│ Cashier: Mary               Signature: _________  │
│ Manager: John               Signature: _________  │
│                                                    │
│ Settlement Time: 2025/10/26 22:30                 │
│                                                    │
└────────────────────────────────────────────────────┘
```

---

### Cash Count Sheet

```
┌────────────────────────────────────────┐
│        Cash Count Sheet                │
│        Date: 2025/10/26                │
├────────────────────────────────────────┤
│                                        │
│ 【Bills】                              │
│                                        │
│  $1,000  ×  20 pcs = $20,000          │
│  $  500  ×   8 pcs = $ 4,000          │
│  $  100  ×  82 pcs = $ 8,200          │
│                                        │
│  Bills Subtotal:     $32,200          │
│                                        │
│ ────────────────────────────────────  │
│                                        │
│ 【Coins】                              │
│                                        │
│  $   50  ×   8 pcs = $   400          │
│  $   10  ×  25 pcs = $   250          │
│  $    5  ×  20 pcs = $   100          │
│  $    1  × 100 pcs = $   100          │
│                                        │
│  Coins Subtotal:     $   850          │
│                                        │
│ ────────────────────────────────────  │
│                                        │
│ 【Total】                              │
│                                        │
│  Actual Count:       $33,050          │
│  Book Amount:        $33,050          │
│  Variance:           $     0  ✅      │
│                                        │
│ ────────────────────────────────────  │
│                                        │
│ Counted by: Mary       Time: 22:25    │
│ Verified by: John      Time: 22:30    │
│                                        │
└────────────────────────────────────────┘
```

---

### Variance Handling

**When book amount doesn't match actual:**

```
Case 1: Actual exceeds book (Overage)

1️⃣ Record overage amount
2️⃣ Recount to confirm
3️⃣ Check for unrecorded transactions
4️⃣ Fill "Variance Report"
5️⃣ Manager review
6️⃣ Set aside overage amount separately
7️⃣ Wait for next day reconciliation


Case 2: Actual less than book (Shortage)

1️⃣ Record shortage amount
2️⃣ Recount to confirm
3️⃣ Recall transaction process, find possible reasons:
   • Incorrect change given
   • Received counterfeit bill
   • Forgot to collect payment
   • Entered wrong amount
4️⃣ Fill "Variance Report"
5️⃣ Manager review
6️⃣ Handle per company policy (compensate or record)
```

---

## 📈 Report Queries

### Available Report Types

```
┌─────────────────────────────────────────────┐
│ Cashier System Reports                      │
├─────────────────────────────────────────────┤
│                                             │
│  📊 Daily Reports                           │
│     • Daily business summary               │
│     • Payment method statistics            │
│     • Time period analysis                 │
│                                             │
│  📊 Weekly Reports                          │
│     • Weekly business trends               │
│     • Week-over-week comparison            │
│                                             │
│  📊 Monthly Reports                         │
│     • Monthly business statistics          │
│     • Monthly sales rankings               │
│                                             │
│  📊 Transaction Details                     │
│     • Single transaction query             │
│     • Transaction history                  │
│                                             │
│  📊 Refund Records                          │
│     • Refund statistics                    │
│     • Refund reason analysis               │
│                                             │
│  📊 Personal Performance                    │
│     • Cashier performance stats            │
│     • Service rating                       │
│                                             │
└─────────────────────────────────────────────┘
```

---

### Report Query Steps

```
1️⃣ Login to cashier system
2️⃣ Click "Report Query"
3️⃣ Select report type
4️⃣ Set query parameters
   • Date range
   • Payment method
   • Transaction status
5️⃣ Click "Query"
6️⃣ Review report content
7️⃣ Option to "Print" or "Export"
```

---

### Personal Performance Query

```
┌────────────────────────────────────────┐
│     Mary's Monthly Performance         │
│     October 2025                       │
├────────────────────────────────────────┤
│                                        │
│ Service Days: 22 days                  │
│ Total Transactions: 867                │
│ Total Transaction Amount: $346,890     │
│ Daily Average: $15,768                 │
│ Average Transaction: $400              │
│                                        │
│ ────────────────────────────────────  │
│                                        │
│ Payment Method Distribution:           │
│  💵 Cash: 45%                          │
│  💳 Credit Card: 38%                   │
│  📱 Mobile Payment: 17%                │
│                                        │
│ ────────────────────────────────────  │
│                                        │
│ Service Rating:                        │
│  ⭐⭐⭐⭐⭐  Efficiency: 4.8/5.0         │
│  ⭐⭐⭐⭐⭐  Accuracy: 4.9/5.0           │
│  ⭐⭐⭐⭐⭐  Service Attitude: 5.0/5.0   │
│                                        │
│ ────────────────────────────────────  │
│                                        │
│ Exception Records:                     │
│  • Cash Variance: 0 times ✅           │
│  • Customer Complaints: 0 times ✅     │
│  • Late Arrivals: 0 times ✅           │
│                                        │
│ Monthly Ranking: 2nd / 8 cashiers     │
│                                        │
└────────────────────────────────────────┘
```

---

## ⚠️ Exception Handling

### Common Exception Cases

#### 1. System Crash

```
Symptom: Cashier system won't start or suddenly closes

Steps:
1️⃣ Stay calm, apologize to customer
2️⃣ Inform customer: "System temporarily unavailable, please wait"
3️⃣ Immediately notify IT staff or manager
4️⃣ Try restarting system
5️⃣ If can't fix immediately:
   • Temporarily use handwritten receipts
   • Record transaction information
   • Input after system recovery
6️⃣ Maintain communication with customer, reduce wait anxiety
```

---

#### 2. Receipt Printer Malfunction

```
Symptom: Can't print receipt, paper jam, print unclear

Steps:
1️⃣ Determine malfunction cause
   • Out of paper? → Replace receipt roll
   • Paper jam? → Open machine and clear
   • Print unclear? → Clean print head

2️⃣ If can't fix immediately
   • Handwrite temporary receipt
   • Note order number
   • Inform customer of later reprint

3️⃣ Notify maintenance staff
4️⃣ Fill equipment repair form
```

**Receipt Paper Replacement Steps:**

```
1. Open receipt printer top cover
2. Remove old roll (if remaining)
3. Insert new roll
4. Pull paper out about 10cm
5. Close top cover
6. Press "Feed" button to test
```

---

#### 3. Card Terminal Malfunction

```
Symptom: Can't read card, connection failed, transaction abnormal

Steps:
1️⃣ Basic checks
   • Confirm power cable plugged in
   • Check network connection
   • Try restarting

2️⃣ If can't fix immediately
   • Politely inform customer: "Card terminal temporarily unavailable"
   • Suggest alternate payment methods:
     ✓ Cash
     ✓ Mobile payment
     ✓ Pay later

3️⃣ Notify manager and bank customer service
4️⃣ Fill equipment exception report
```

---

#### 4. Network Outage

```
Symptom: Can't connect, transaction failed, data can't upload

Steps:
1️⃣ Confirm if complete outage
   • Check if other devices normal
   • Ask other colleagues about situation

2️⃣ Switch to offline mode (if available)
   • Use local functions
   • Record transaction information
   • Sync after network recovery

3️⃣ Notify network administrator
4️⃣ If emergency handling needed:
   • Use mobile hotspot
   • Handwrite transaction records

5️⃣ After network recovery
   • Sync offline transaction data
   • Confirm data integrity
```

---

#### 5. Insufficient Change

```
Symptom: Cash drawer lacks certain denomination for change

Steps:
1️⃣ Politely inform customer: "Sorry, currently short on small bills"
2️⃣ Provide alternatives:
   • "Can I give you other denominations?"
   • "Can you use card or mobile payment?"
   • "I'll get change from another register, please wait"

3️⃣ Quickly borrow from other registers
4️⃣ Complete change
5️⃣ Apologize and thank for waiting
6️⃣ Record change needs, notify manager to replenish
```

---

#### 6. Suspected Counterfeit Bill

```
Handling Principle: Stay composed, handle politely, protect both parties

Steps:
1️⃣ Don't directly accuse customer
2️⃣ Use detection equipment to verify
3️⃣ If indeed suspicious, politely say:
   "Excuse me, this bill seems problematic,
    I need manager confirmation,
    or could you use another?"

4️⃣ Immediately notify manager
5️⃣ Manager decides after judgment:
   • Return to customer, ask to change bill
   • Retain and report to police

6️⃣ Stay polite throughout, avoid conflict
7️⃣ Fill exception report afterward
```

---

#### 7. Customer Disputes Amount

```
Symptom: Customer believes amount calculated wrong, overcharged

Steps:
1️⃣ Stay calm and polite
2️⃣ Say: "Let me verify again"
3️⃣ Pull up order details
4️⃣ Explain item by item to customer:
   "Your order is:
    • OO Noodles $150
    • OO Rice $120
    • Drink $50
    Total is $320"

5️⃣ If indeed calculated wrong:
   • Sincerely apologize
   • Immediately correct
   • Refund overcharge or charge difference

6️⃣ If amount correct:
   • Patiently explain
   • Show price list
   • Request manager assistance if needed

7️⃣ Fill customer complaint record
```

---

#### 8. System Amount Display Abnormal

```
Symptom: System displays obviously unreasonable amount

Steps:
1️⃣ Don't charge according to system amount
2️⃣ Manually calculate correct amount
3️⃣ Explain to customer: "System seems incorrect, let me calculate"
4️⃣ Charge correct amount
5️⃣ Note exception on order
6️⃣ Notify manager and IT staff
7️⃣ Fill system exception report
8️⃣ Wait for repair confirmation
```

---

## 💵 Cash Management

### Cash Drawer Management Guidelines

```
┌─────────────────────────────────────────────┐
│ Cash Drawer Golden Rules                    │
├─────────────────────────────────────────────┤
│                                             │
│  1️⃣ Drawer should always be locked         │
│                                             │
│  2️⃣ Close drawer when leaving seat         │
│                                             │
│  3️⃣ Large bills promptly to safe           │
│                                             │
│  4️⃣ Count regularly, ensure book matches actual │
│                                             │
│  5️⃣ Cash in drawer shouldn't exceed limit  │
│     (Suggest not over $50,000)             │
│                                             │
│  6️⃣ Different denominations in slots, keep tidy │
│                                             │
│  7️⃣ Large bills don't put in drawer first (prevent disputes) │
│                                             │
│  8️⃣ Never place personal items in drawer   │
│                                             │
└─────────────────────────────────────────────┘
```

---

### Standard Cash Drawer Configuration

```
┌─────────────────────────────────────────────────┐
│              Standard Drawer Setup              │
├─────────────────────────────────────────────────┤
│                                                 │
│  【Bill Compartments】                          │
│  ┌─────┬─────┬─────┬─────┬─────┐            │
│  │1000 │ 500 │ 200 │ 100 │Empty│            │
│  │     │     │     │     │     │            │
│  └─────┴─────┴─────┴─────┴─────┘            │
│                                                 │
│  【Coin Compartments】                          │
│  ┌────┬────┬────┬────┬────┬────┐           │
│  │ 50 │ 10 │  5 │  1 │Empty│Empty│         │
│  │    │    │    │    │     │     │         │
│  └────┴────┴────┴────┴────┴────┘           │
│                                                 │
│  【Recommended Float Configuration】            │
│  • $1000: 5 pcs = $5,000                       │
│  • $ 500: 4 pcs = $2,000                       │
│  • $ 100: 30 pcs = $3,000                      │
│  • $  50: 10 pcs = $  500                      │
│  • $  10: 30 pcs = $  300                      │
│  • $   5: 20 pcs = $  100                      │
│  • $   1: 100 pcs = $ 100                      │
│  ─────────────────────────────────            │
│  Total Float:        $11,000                   │
│                                                 │
└─────────────────────────────────────────────────┘
```

---

### Cash Deposit Operations

**When to deposit cash?**

```
1️⃣ Drawer cash exceeds limit ($50,000)
2️⃣ Too many large bills ($1,000+)
3️⃣ Mid-business day (lunch or afternoon break)
4️⃣ Daily business end
```

**Deposit Process:**

```
1️⃣ Prepare deposit bag
2️⃣ Count cash to be deposited
3️⃣ Fill deposit slip
   • Date
   • Amount
   • Depositor
   • Time
4️⃣ Place cash and slip in deposit bag
5️⃣ Seal deposit bag
6️⃣ Notify manager or designated person
7️⃣ Two people deliver cash to safe together
8️⃣ Record deposit in system
9️⃣ Retain deposit receipt
```

---

### Cash Counting

**Counting Times:**

- Before daily business start
- During shift change
- After daily business end
- Manager spot checks

**Counting Steps:**

```
1️⃣ Stop collections (hang "Temporarily Closed" sign)
2️⃣ Prepare count sheet
3️⃣ Count starting with large denominations
   • $1000 × ____ = $ _____
   • $ 500 × ____ = $ _____
   • $ 100 × ____ = $ _____
   • $  50 × ____ = $ _____
   • $  10 × ____ = $ _____
   • $   5 × ____ = $ _____
   • $   1 × ____ = $ _____

4️⃣ Calculate total amount
5️⃣ Compare with system book amount
6️⃣ If variance, recount
7️⃣ Record counting results
8️⃣ Manager signs confirmation
```

---

## 🔐 Security Guidelines

### Information Security

```
┌─────────────────────────────────────────────┐
│ Cashier System Information Security Rules   │
├─────────────────────────────────────────────┤
│                                             │
│  🔒 Password Management                     │
│     • Don't share account credentials      │
│     • Change password regularly (every 3 months) │
│     • Don't write password on paper or phone│
│     • Must logout when leaving seat        │
│                                             │
│  🔒 Customer Information Protection         │
│     • Don't disclose customer personal info│
│     • Don't photograph or record card info │
│     • Customer data for business use only  │
│     • Don't remove or share externally     │
│                                             │
│  🔒 System Usage                            │
│     • Don't use others' accounts           │
│     • Don't modify system settings         │
│     • Don't install unauthorized software  │
│     • Report abnormalities immediately     │
│                                             │
└─────────────────────────────────────────────┘
```

---

### Financial Security

```
┌─────────────────────────────────────────────┐
│ Money Security Protection Measures          │
├─────────────────────────────────────────────┤
│                                             │
│  💰 Prevention Measures                     │
│                                             │
│  1️⃣ Be alert for large transactions        │
│     • Verify large bill authenticity       │
│     • Confirm card user is cardholder      │
│     • Notify manager of suspicious transactions │
│                                             │
│  2️⃣ Drawer Management                      │
│     • Lock drawer promptly                 │
│     • Large cash deposited timely          │
│     • Don't let others near drawer         │
│                                             │
│  3️⃣ Fraud Prevention                       │
│     • Don't accept suspicious payment methods │
│     • Don't comply with abnormal operations│
│     • Phone requests for transfers are always scams │
│                                             │
│  4️⃣ Surveillance Protection                │
│     • Know camera locations                │
│     • Ensure abnormal situations recorded  │
│     • Don't block cameras                  │
│                                             │
└─────────────────────────────────────────────┘
```

---

### Personal Safety

```
┌─────────────────────────────────────────────┐
│ Cashier Personal Safety Notes               │
├─────────────────────────────────────────────┤
│                                             │
│  🚨 When Threatened or Robbed               │
│                                             │
│  1️⃣ Stay calm, comply with demands         │
│  2️⃣ Life safety most important, money secondary │
│  3️⃣ Don't resist or provoke                │
│  4️⃣ Remember features (height, accent, marks) │
│  5️⃣ Observe escape direction               │
│  6️⃣ Call police after ensuring safety      │
│  7️⃣ Preserve scene, wait for police        │
│  8️⃣ Cooperate with police investigation    │
│                                             │
│  ⚠️ Emergency Help Methods                  │
│                                             │
│  • Police: 110                             │
│  • Store Manager: [Phone]                  │
│  • Security: [Phone]                       │
│  • Emergency Button Location: [Location]   │
│                                             │
└─────────────────────────────────────────────┘
```

---

### Fraud Prevention

**Common Scam Methods:**

```
❌ Scam Type 1: Fake Customer Service
   "I'm from headquarters customer service, system problem,
    need you to help test refund function..."

   → Never comply with phone requested operations
   → Hang up, contact direct manager to verify


❌ Scam Type 2: Bill Swapping Scam
   Customer after payment says: "I want to change that bill"
   Takes opportunity to swap or take extra money

   → Received bills immediately into drawer
   → Don't accept bill exchange requests


❌ Scam Type 3: Amount Confusion
   "I just gave you $1000, your change is wrong"
   Actually gave $500

   → Place large bills on top of register first
   → Loudly repeat "Received $1000"
   → Put bill in drawer after giving change


❌ Scam Type 4: Fake Payment Screen
   Phone shows payment complete, actually not

   → Must confirm system received payment
   → Can't just look at customer's phone screen
   → Wait for system confirmation before completing checkout
```

---

## ❓ FAQ

### Q1: What if customer says they forgot money?

```
A: Polite handling

1️⃣ Stay friendly
   "No problem, do you have another payment method?"

2️⃣ Provide options
   • "Can you use credit card or mobile payment?"
   • "There's an ATM nearby, want to withdraw? We can hold your order"
   • "Can a friend help transfer payment?"

3️⃣ Final solution
   • Notify manager
   • Manager decides whether to:
     → Let customer leave contact info, pay later
     → Record ID information
     → Report to police (if attitude poor or repeat offender)
```

---

### Q2: What if customer requests discount?

```
A: Standard response

1️⃣ Politely explain
   "Sorry, prices are set by company,
    I don't have authority to change them"

2️⃣ Provide alternatives
   • "We have member benefits, register for next time discount"
   • "Current promotion is..."
   • "Do you have coupons?"

3️⃣ If customer insists
   • "Let me get my manager to assist"
   • Manager decides whether to grant discount

⚠️ Note:
   Cashiers cannot give discounts independently
   All price adjustments need manager approval
```

---

### Q3: What if a receipt is lost or unclear?

Confirm the order number and payment record, then reprint the receipt and give it to the customer. Ask a manager for help if reprinting is unavailable.

---

### Q4: Customer says paid but system has no record?

```
A: Payment dispute handling

1️⃣ Stay calm and polite
   "Let me verify for you"

2️⃣ Check system records
   • Query order status
   • Confirm payment record
   • Check transaction time

3️⃣ If mobile payment
   • Ask customer to show payment success screen
   • Verify transaction number
   • Confirm amount and merchant info

4️⃣ If indeed paid but system not updated
   • Immediately notify manager and IT
   • Don't charge again
   • Wait for system sync

5️⃣ If can't confirm
   • Request manager assistance
   • Check bank statements
   • Review surveillance footage (if needed)
```

---

### Q5: What if cash shortage discovered after closing?

```
A: Cash shortage handling

1️⃣ Immediately recount
   Ensure no calculation error

2️⃣ Fill "Variance Report"
   • Record shortage amount
   • Explain possible reasons
   • Recall suspicious transactions

3️⃣ Notify manager
   • Report situation
   • Cooperate with investigation

4️⃣ Review footage
   • Check transaction process
   • Find possible causes

5️⃣ Follow-up
   • Compensate or record per company policy
   • Improve prevention measures
   • Strengthen cash management

Prevention:
✅ Carefully verify each transaction
✅ Regularly count drawer
✅ Pay special attention to large transactions
✅ Count during shift change
```

---

### Q6: Customer says didn't receive card receipt?

```
A: Receipt reprint handling

1️⃣ Confirm transaction completed
   • Check system records
   • Confirm payment settled

2️⃣ Reprint receipt
   • Enter transaction records
   • Select that transaction
   • Click "Reprint Receipt"
   • Mark "REPRINT"

3️⃣ Customer signs
   • Verify signature matches card back
   • File receipt for records

4️⃣ Record reprint reason
   • Note in system
   • Avoid duplicate processing
```

---

### Q7: What if encountering difficult customer or complaint?

```
A: Complaint handling principles

1️⃣ Stay professional and calm
   • Don't argue with customer
   • Don't respond emotionally
   • Always stay polite

2️⃣ Listen to customer concerns
   "I understand your feelings, please tell me what happened"

3️⃣ Empathize and apologize
   "I'm sorry for the inconvenience"

4️⃣ Propose solution
   • Handle within authority
   • Request manager if beyond authority

5️⃣ Record complaint content
   • Fill complaint form
   • Describe incident
   • Record resolution

6️⃣ Follow-up
   • Confirm problem resolved
   • Follow up with customer if needed

Important principles:
⚠️ Never conflict with customer
⚠️ Seek help immediately if insulted or threatened
⚠️ Personal safety most important
```

---

### Q8: Can I give friends discount when they visit?

```
A: No ❌

Explanation:
1. This violates company policy
2. Abuse of authority
3. May result in:
   • Written warning
   • Salary deduction
   • Termination

Correct approach:
✅ Friends must pay normally
✅ If employee benefits exist, apply per policy
✅ Don't give any discounts independently
✅ All discounts need manager approval
```

---

### Q9: Can I advance payment for customers?

```
A: Not recommended ⚠️

Reasons:
1. Causes accounting confusion
2. May not recover payment
3. Violates cash flow management rules

Exception cases (need manager approval):
• Regular customer temporarily forgot money
• Very small amount
• Manager agrees and records

Correct process:
1️⃣ Don't advance independently
2️⃣ Consult manager
3️⃣ If approved to advance:
   • Fill advance form
   • Record customer contact info
   • Set repayment deadline
   • Manager signs
4️⃣ Track payment recovery
```

---

### Q10: End of shift but still customers to check out?

```
A: Complete service before leaving

Professional ethics:
✅ Serve last customer
✅ Complete shift handover
✅ Ensure accounts accurate
✅ Can't leave mess for next shift

Correct approach:
1️⃣ Continue serving customers
2️⃣ Maintain good attitude (don't show impatience)
3️⃣ After checkout completed:
   • Count cash drawer
   • Print shift report
   • Hand over to incoming staff
   • Can leave after manager signs

If truly urgent matter:
• Inform manager in advance
• Ask colleague to help
• Complete basic handover
```

---

## 📞 Contact Information

### Internal Contacts

```
┌─────────────────────────────────────────┐
│ Cashier-Related Contact Windows         │
├─────────────────────────────────────────┤
│                                         │
│  👔 Store Manager                       │
│     Extension: 101                      │
│     Mobile: [Phone]                     │
│     Handle: HR, complaints, emergencies │
│                                         │
│  💻 IT Staff                            │
│     Extension: 201                      │
│     Mobile: [Phone]                     │
│     Handle: System issues, network      │
│                                         │
│  🔧 Maintenance Staff                   │
│     Extension: 301                      │
│     Mobile: [Phone]                     │
│     Handle: Equipment malfunction, hardware │
│                                         │
│  📊 Accounting Department               │
│     Extension: 102                      │
│     Email: accounting@makanmakan.com    │
│     Handle: Accounting, receipt issues  │
│                                         │
└─────────────────────────────────────────┘
```

---

### External Contacts

```
┌─────────────────────────────────────────┐
│ External Support Contacts               │
├─────────────────────────────────────────┤
│                                         │
│  🏦 Bank Customer Service               │
│     Card terminal, transaction questions│
│     [Bank Name]: 0800-XXX-XXX          │
│                                         │
│  📱 Mobile Payment Customer Service     │
│     LINE Pay:                          │
│     Street Pay:                         │
│     Other Platforms:                    │
│                                         │
│  🚨 Emergency Help                      │
│     Police: 110                        │
│     Fire Dept: 119                     │
│     Security: [Phone]                  │
│                                         │
│  🛠️ Equipment Vendors                   │
│     POS System: [Phone]                │
│     Card Terminal: [Phone]             │
│                                         │
└─────────────────────────────────────────┘
```

---

## 🎓 Appendix

### A. Standard Cashier Phrases

**Greeting:**

```
"Hello, welcome!"
"Hello, dine-in or takeout?"
```

**During Checkout:**

```
"Hello, ready to check out?"
"The total is $XXX"
"What payment method would you like?"
"Received $XXX"
"Your change is $XXX, please check"
```

**Handing Receipt:**

```
"Here's your receipt, please keep it"
"Thank you for dining, welcome back!"
```

**Encountering Issues:**

```
"Excuse me, please wait a moment"
"Sorry for the wait"
"Thank you for your patience"
```

---

### B. Keyboard Shortcuts

| Function      | Shortcut   |
| ------------- | ---------- |
| Quick Search  | F1         |
| Checkout      | F2         |
| Cancel        | ESC        |
| Print Receipt | Ctrl+P     |
| Reprint       | Ctrl+R     |
| Refund        | Ctrl+Alt+R |
| Lock Screen   | Ctrl+L     |
| Logout        | Ctrl+Q     |
| Help          | F12        |

---

### C. Cashier Performance Standards

```
┌────────────────────────────────────────┐
│        Cashier Performance Review      │
├────────────────────────────────────────┤
│                                        │
│ 📊 Transaction Accuracy (30%)         │
│    • Cash variance frequency          │
│    • Error count                      │
│    • Receipt error frequency          │
│                                        │
│ ⚡ Service Efficiency (25%)           │
│    • Average checkout time            │
│    • Daily customer count             │
│    • Processing speed                 │
│                                        │
│ 😊 Service Attitude (25%)             │
│    • Customer satisfaction            │
│    • Courtesy and response            │
│    • Problem-solving ability          │
│                                        │
│ 📋 Compliance (20%)                   │
│    • Attendance record                │
│    • Procedure correctness            │
│    • Safety compliance                │
│    • Uniform appearance               │
│                                        │
└────────────────────────────────────────┘
```

---

### D. Professional Development Path

```
Cashier Career Development Path

Entry-Level Cashier
    ↓
Senior Cashier (6 months-1 year)
    ↓
Cashier Team Leader (1-2 years)
    ↓
Counter Supervisor (2-3 years)
    ↓
Floor Manager (3-5 years)
    ↓
Store Manager/Operations Manager (5+ years)

Required Skill Enhancements:
• Professional skill advancement
• Leadership and management
• Problem-solving ability
• Business analysis capability
• Staff training ability
```

---

## 📝 Version History

| Version | Date       | Updates         |
| ------- | ---------- | --------------- |
| 2.0     | 2025-10-26 | Initial release |
| -       | -          | To be updated   |

---

## 🙏 Conclusion

Thank you for choosing to become a MakanMakan cashier!

Cashier work seems simple but carries great responsibility. You are the last point of contact customers have in the store, and the key person leaving the final impression.

**Please Remember:**

- 💰 **Accuracy** is the primary principle of cashier work
- 😊 **Courtesy** is the basic requirement of quality service
- 🔒 **Integrity** is the core value of professional ethics
- 📚 **Learning** is the only path to professional growth

Hope this manual helps you get started quickly and become an excellent cashier!

For any questions or suggestions, please feel free to contact us anytime.

---

<div align="center">

**MakanMakan Cashier Manual**

Built with ❤️ for our cashiers

**Version 2.0** | **2025-10-26**

© 2025 MakanMakan. All rights reserved.

</div>
