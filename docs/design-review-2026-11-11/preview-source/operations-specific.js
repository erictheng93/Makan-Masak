// Preview-only domain examples. No production requests or credentials are saved.
function specialOperationsPage(page) {
  if (!["admin-dashboard", "kitchen-display", "management-portal"].includes(page.app)) return null;
  const leaf = page.file.split("/").pop().replace(".vue", "");
  const portal = page.app === "management-portal";
  const kitchenApp = page.app === "kitchen-display";
  const action = (label, detail = label) => button(label, `type="button" data-demo="${esc(detail)}"`);
  const detail = (label, name = label) => button(label, `type="button" data-detail="${esc(name)}"`);
  const nav = (label, target) => `<button class="button secondary" type="button" data-nav="${esc(target)}">${esc(label)}</button>`;
  const card = (title, body) => `<section class="card"><h2 style="margin-bottom:20px">${esc(title)}</h2>${body}</section>`;
  const stack = (body) => `<div class="stack">${body}</div>`;
  const grid = (body) => `<div class="equal-cols">${body}</div>`;
  const row = (title, note, end = "") => `<div class="task-row"><div><h3>${esc(title)}</h3><p class="muted" style="font-size:12px;font-weight:400">${esc(note)}</p></div><div>${end}</div></div>`;
  const select = (label, values, options = "") => `<label class="field"><span>${esc(label)}</span><select ${options}>${values.map((v) => `<option>${esc(v)}</option>`).join("")}</select></label>`;
  const area = (label, placeholder = "", options = "") => `<label class="field"><span>${esc(label)}</span><textarea placeholder="${esc(placeholder)}" ${options}></textarea></label>`;
  const check = (label, checked = false) => `<label style="display:flex;align-items:center;gap:12px;min-height:44px;font-size:13px"><input type="checkbox" ${checked ? "checked" : ""}>${esc(label)}</label>`;
  const submit = (label) => `<div class="form-actions"><small>範例操作，不會寫入正式資料</small><button type="submit" class="button">${esc(label)}</button></div><p class="form-success" role="status"></p>`;
  const form = (body, label) => `<form data-preview-form>${body}${submit(label)}</form>`;
  const metrics = (pairs) => `<dl class="metric-list">${pairs.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>`;
  const table = (columns, records) => `<div class="table-scroll"><table><thead><tr>${columns.map((column) => `<th scope="col">${esc(column)}</th>`).join("")}</tr></thead><tbody>${records.map((record) => `<tr data-record="${esc(record.join(" "))}">${record.map((value) => `<td>${esc(value)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  const tabNav = (items) => `<nav class="tabs" aria-label="工作區導覽">${items.map(([label, target]) => `<button type="button" data-nav="${target}" aria-current="${leaf === target ? "page" : "false"}">${label}</button>`).join("")}</nav>`;
  const note = (text) => `<p class="section-note">${esc(text)}</p>`;
  const title = () => heading(page, false);

  if (leaf === "AccountManagementView") return `${title()}${tabs(["店主帳號", "平台管理員"])}${stack(card("建立店主帳號", form(`${grid(field("使用者名稱", "text", "", 'required autocomplete="username"') + field("初始密碼", "password", "", 'required autocomplete="new-password"'))}${grid(field("姓名", "text", "", "required") + field("電子郵件", "email", "", "required"))}${select("綁定店鋪", ["示範餐廳 A", "示範餐廳 B"])}${field("電話（選填）", "tel")}${note("建立前核對帳號角色與店鋪綁定；此處使用範例資料。")}`, "建立店主帳號")) + card("既有帳號", table(["姓名", "店鋪", "角色", "狀態"], [["示範店主 A", "示範餐廳 A", "店主", "啟用"]]) + detail("重設密碼確認")))}`;
  if (leaf === "BroadcastsView") return `${title()}${stack(card("編寫店鋪推播", form(`${field("推播標題", "text", "", "required")}${area("訊息內文", "輸入給追蹤者的訊息", "required")}${field("連結（選填）", "url", "", 'placeholder="https://example.test"')}${check("包含所屬市場追蹤者")}${note("正式發送前需確認收件範圍及訊息；預覽不發送任何推播。")}`, "確認推播內容")) + card("推播紀錄", table(["標題", "發送時間", "成功", "失敗", "狀態"], [["範例營業公告", "2026/11/10 12:00", "24", "0", "已完成"]])))}`;
  if (leaf === "MarketOpenReportView") return `${title()}${card("市場開店報表", `${select("市場", ["示範市場 A"])}${grid(field("起始日期", "date", "2026-11-05") + field("結束日期", "date", "2026-11-11"))}${tabs(["每日明細", "店鋪彙總"])}${action("匯出 CSV")}${table(["日期", "店鋪", "開店", "關店", "營業時數", "開店人員", "訂單數", "營收"], [["2026/11/11", "示範餐廳 A", "10:00", "18:00", "8 小時", "示範員工 A", "24", "NT$ 3,840"]])}${note("此頁查閱與匯出開店紀錄，不是提交開店狀態的表單。")}`)}`;

  if (["NotFoundView", "UnauthorizedView"].includes(leaf)) {
    const target = kitchenApp ? "LoginView" : "DashboardView";
    return `<section class="empty-state"><div class="empty-icon">${svg("info", 32)}</div><h1>${esc(page.title)}</h1><p>${esc(page.purpose)}</p>${nav(kitchenApp ? "返回登入" : "返回總覽", target)}${!portal && !kitchenApp ? `<div style="margin-top:24px">${nav("訂單管理", "OrdersView")} ${nav("菜單管理", "MenuView")}</div>` : ""}</section>`;
  }

  if (portal && leaf === "LoginView") {
    return `<main style="max-width:480px;margin:64px auto;padding:24px">${title()}${card("管理員驗證", form(`${area("API admin token", "貼上平台管理員 token", 'autocomplete="off" spellcheck="false" required aria-describedby="token-preview-hint"')}<p id="token-preview-hint" class="form-help">正式登入使用 token 換取管理工作階段。預覽不保存或傳送輸入，請使用範例文字。</p>`, "登入管理平台"))}</main>`;
  }
  if (["LoginView", "ForgotPasswordView", "ResetPasswordView"].includes(leaf)) {
    const fields = leaf === "ForgotPasswordView" ? field("電子郵件", "email", "", 'required autocomplete="email"') : leaf === "ResetPasswordView" ? field("新密碼", "password", "", 'required autocomplete="new-password"') + field("確認新密碼", "password", "", 'required autocomplete="new-password"') : field("使用者名稱", "text", "", 'required autocomplete="username"') + field("密碼", "password", "", 'required autocomplete="current-password"');
    return `<main style="max-width:480px;margin:48px auto;padding:24px">${title()}${card(leaf === "LoginView" ? "員工登入" : page.title, form(`${leaf === "LoginView" ? note("示範店鋪；正式入口會顯示所選店鋪脈絡。") : ""}${fields}`, page.proposal.primaryAction || "確認"))}<div style="display:flex;flex-wrap:wrap;gap:12px;margin-top:20px">${leaf !== "LoginView" ? nav("返回登入", "LoginView") : !kitchenApp ? nav("忘記密碼", "ForgotPasswordView") : ""}</div></main>`;
  }

  if (leaf === "KitchenView") {
    return `${title()}${card("廚房顯示器使用狀態", `${badge("功能已包含", "green")}${note("這是管理後台的功能權限入口；實際出餐工作使用獨立廚房顯示器。")}${metrics([["使用範圍", "目前店鋪"], ["工作介面", "獨立廚房顯示器"]])}${action("查看廚房入口說明")}${note("未包含功能時顯示方案說明，並使用既有帳務支援管道。")}${nav("查看訂閱與帳務", "BillingView")}`)}`;
  }

  if (leaf === "BillingView") {
    return `${title()}${stack(card("目前方案", `${badge("試用中", "orange")}${metrics([["方案", "試用方案"], ["試用剩餘時間", "範例：14 天"], ["服務狀態", "已啟用"]])}${nav("聯絡支援調整方案", "FeedbackView")}${note("此頁不提供自助付款；方案調整沿用支援管道。")}`) + card("本期用量", `${metrics([["訂單", "620 / 1,000"], ["統計週期", "2026/11/01 – 2026/11/30"]])}<progress style="width:100%;height:16px;accent-color:var(--accent)" aria-label="本期訂單用量" value="620" max="1000"></progress>`) + card("功能模組", row("廚房顯示器", "目前方案已啟用", badge("已啟用", "green")) + row("AI 分析", "依實際方案提供", badge("未啟用", "neutral"))))}`;
  }
  if (leaf === "SubscriptionsView") {
    return `${title()}${tabs(["訂閱", "用量"])}${stack(card("店鋪訂閱", form(`${row("示範餐廳 A", "店鋪 ID：demo-a", badge("已啟用", "green"))}${select("示範餐廳 A／方案", ["試用", "基本", "專業", "企業"])}${check("廚房顯示器", true)}${check("AI 分析")}${detail("停用訂閱", "停用示範餐廳 A 訂閱")}`, "儲存方案調整")) + card("新增訂閱", form(`${field("店鋪識別碼", "text", "", "required")}${select("訂閱方案", ["試用", "基本", "專業", "企業"])}${field("試用截止日", "date")}`, "建立訂閱")))}`;
  }

  if (["POSView", "CashierView", "POSManagementView"].includes(leaf)) {
    const mode = tabNav([["收銀結帳", "CashierView"], ["收銀管理", "POSManagementView"]]);
    if (leaf === "POSView") return `${title()}${mode}${card("選擇工作模式", `${row("收銀結帳", "核對待結帳訂單、付款方式與找零", nav("進入收銀", "CashierView"))}${row("收銀管理", "管理收銀櫃、班次、現金與交易", nav("進入收銀管理", "POSManagementView"))}`)}`;
    if (leaf === "CashierView") {
      return `${title()}${mode}<div class="notice">${svg("clock", 18)}<span>範例班次 · 09:00 開始 · 收銀櫃 A</span></div><div class="two-col" style="margin-top:20px">${card("待結帳訂單", `${field("搜尋訂單", "search", "", 'placeholder="訂單編號或桌號" data-filter')}${row("#1042 · A03 桌", "3 份餐點 · 待結帳", detail("查看", "訂單 #1042"))}${row("#1041 · 外帶", "2 份餐點 · 待結帳", detail("查看", "訂單 #1041"))}${detail("交班報表")}${detail("退款處理")}`)}${card("訂單 #1042／收款", form(`${metrics([["招牌雞肉飯 ×2", "NT$ 320"], ["季節蔬菜 ×1", "NT$ 90"], ["應收金額", "NT$ 410"]])}${select("付款方式", ["現金", "刷卡", "電子支付"])}${field("實收金額", "number", "500", 'min="0" step="1" required')}${metrics([["範例找零", "NT$ 90"]])}${detail("套用折扣")}`, "確認收款"))}</div>`;
    }
    return `${title()}${mode}${stack(card("收銀櫃與班次", `${row("收銀櫃 A", "範例班次 09:00 – 17:00", badge("使用中", "green"))}${detail("開始班次")}${detail("結束班次")}${detail("現金存入／取出")}${detail("新增收銀櫃")}`) + grid(card("快速付款", form(`${field("訂單編號", "text", "", "required")}${field("付款金額", "number", "", 'min="0" required')}${select("付款方式", ["現金", "刷卡", "電子支付"])}`, "確認付款")) + card("市場聯合付款", form(`${field("市場結帳識別碼", "text", "", "required")}${select("付款方式", ["現金", "刷卡", "電子支付"])}`, "確認市場結帳付款"))) + card("近期交易與促銷", table(["交易", "訂單", "金額", "方式", "時間"], [["TX-DEMO-01", "#1042", "NT$ 410", "現金", "14:32"]]) + detail("管理促銷")))}`;
  }

  if (leaf === "PlatformMarketCheckoutsView") {
    return `${title()}${card("結帳篩選", `${grid(field("市場識別碼", "search", "demo-market") + select("付款狀態", ["全部", "已付款", "待付款", "已退款"]))}${grid(field("起始日期", "date", "2026-11-01") + field("結束日期", "date", "2026-11-11"))}${select("營運異常", ["全部", "需要查單", "退款異常"])}${action("篩選")}`)}<div style="margin-top:20px">${card("跨攤位結帳與對帳", `${table(["結帳", "攤位", "已收", "已退", "平台費", "淨收", "狀態"], [["CHECKOUT-DEMO-01", "2", "NT$ 580", "NT$ 0", "NT$ 12", "NT$ 568", "已付款"]])}${action("匯出結帳 CSV")}${action("匯出攤位對帳")}${action("匯出會計分錄")}${detail("查看子訂單與付款狀態")}${detail("整筆退款確認")}${action("查詢 Provider 狀態")}`)}</div>`;
  }

  const employeeNav = [["員工名單", "EmployeeListTab"], ["出勤", "AttendanceOverviewTab"], ["排班", "SchedulingTab"], ["請假", "LeavesTab"]];
  if (leaf === "EmployeeManagementView") return `${title()}${action("新增員工")}${stats([["在職員工", "12"], ["目前在班", "6"], ["請假中", "1"], ["待審申請", "2"]])}${tabNav(employeeNav)}${card("員工工作區", employeeNav.map(([label, target]) => row(label, "查看這項員工管理工作", nav("開啟", target))).join(""))}`;

  if (["MyAttendanceView", "AttendanceOverviewTab"].includes(leaf)) {
    const panel = card("今日打卡", form(`${leaf === "AttendanceOverviewTab" ? select("打卡對象", ["示範員工 A", "示範員工 B"]) : ""}${metrics([["日期", "2026/11/11"], ["預定班次", "09:00 – 17:00"], ["目前狀態", "尚未打卡"]])}${area("打卡備註（選填）")}`, "上班打卡"));
    return `${title()}${leaf === "AttendanceOverviewTab" ? tabNav(employeeNav) : ""}${stack(panel + card("出勤紀錄", table(["日期", "上班", "下班", "實際工時"], [["2026/11/10", "09:00", "17:00", "8 小時"]])) + (leaf === "AttendanceOverviewTab" ? card("在班與請假", row("示範員工 B", "在班 · 09:00 開始", badge("在班", "green")) + row("示範員工 C", "特別休假", badge("請假", "orange"))) : ""))}`;
  }

  if (["MyShiftsView", "EmployeeScheduleTab"].includes(leaf)) {
    return `${title()}${stack(card("即將到來的班次", row("11 月 12 日（四）", "早班 · 09:00 – 17:00", leaf === "MyShiftsView" ? detail("申請換班", "11 月 12 日換班申請") : badge("已排班", "blue")) + row("11 月 13 日（五）", "晚班 · 14:00 – 22:00", leaf === "MyShiftsView" ? detail("申請換班", "11 月 13 日換班申請") : badge("已排班", "blue"))) + (leaf === "MyShiftsView" ? card("我的換班申請", row("11 月 15 日晚班", "換班 · 一般急迫度 · 範例原因", badge("待審核", "orange"))) + card("換班申請示意", form(`${select("申請類型", ["換班", "代班", "釋出班次"])}${select("急迫程度", ["低", "一般", "高", "緊急"])}${area("申請原因", "說明換班需求", "required maxlength=500")}`, "提交申請")) : card("工時摘要", metrics([["總工時", "範例：32 小時"], ["加班工時", "範例：0 小時"], ["已完成班次", "4"]]))))}`;
  }

  if (["MyLeavesView", "EmployeeLeaveTab", "LeavesTab"].includes(leaf)) {
    return `${title()}${leaf === "LeavesTab" ? tabs(["請假申請", "審核", "假別設定"]) : ""}${stack(card("假期餘額", grid(metrics([["特別休假", "剩餘 5 / 7 天"], ["已使用", "2 天"]]) + metrics([["病假", "剩餘 10 / 10 天"], ["待審核", "1 天"]]))) + card("請假申請", table(["假別", "開始", "結束", "天數", "狀態"], [["特別休假", "2026/11/20", "2026/11/20", "1", "待審核"]])) + (leaf === "EmployeeLeaveTab" ? "" : card(leaf === "LeavesTab" ? "代為申請請假" : "新增請假", form(`${leaf === "LeavesTab" ? select("員工", ["示範員工 A", "示範員工 B"]) : ""}${select("假別", ["特別休假", "病假"])}${grid(field("開始日期", "date", "", "required") + field("結束日期", "date", "", "required"))}${area("請假原因", "", "required")}`, "提交請假申請"))) + (leaf === "LeavesTab" ? card("假別設定", form(`${field("假別代碼", "text", "", 'maxlength="20" required')}${field("假別名稱", "text", "", 'maxlength="50" required')}${select("額度累計方式", ["年度", "每月", "不累計"])}${check("有薪假", true)}${check("需要審核", true)}`, "儲存假別")) : ""))}`;
  }

  if (leaf === "EmployeeDetailView" || leaf === "EmployeeProfileTab") {
    return `${title()}${nav("返回員工列表", "EmployeeListTab")}${tabNav([["基本資料", "EmployeeProfileTab"], ["班表", "EmployeeScheduleTab"], ["請假", "EmployeeLeaveTab"]])}${stack(card("示範員工 A", metrics([["帳號", "demo-staff"], ["角色", "服務人員"], ["狀態", "在職"], ["電子郵件", "staff@example.test"]])) + card("工作摘要", metrics([["即將到來班次", "2"], ["已完成班次", "4"], ["待審請假", "1"]])) + card("近期活動", row("完成班次", "2026/11/10 · 09:00 – 17:00", badge("已完成", "green"))))}`;
  }

  if (["SeatingManagementView", "TableSetupTab", "TableDetailView", "QueueDashboardTab", "WaitingListTab", "ReservationTab"].includes(leaf)) {
    const seatingNav = tabNav([["預約", "ReservationTab"], ["候位清單", "WaitingListTab"], ["候位看板", "QueueDashboardTab"], ["桌台設定", "TableSetupTab"]]);
    if (leaf === "SeatingManagementView") return `${title()}${stats([["桌台", "12"], ["可用桌台", "5"], ["今日預約", "8"], ["候位組數", "4"]])}${seatingNav}${card("座位工作區", row("預約與候位", "管理訂位、現場叫號及入座", nav("查看候位看板", "QueueDashboardTab")) + row("桌台與 QR", "管理桌台、座位數及 QR 啟用", nav("桌台設定", "TableSetupTab")))}`;
    if (["TableSetupTab", "TableDetailView"].includes(leaf)) {
      const tiles = ["A01", "A02", "B01", "B02"].map((name, i) => `<article class="card"><h3>${name} 桌</h3>${metrics([["座位數", "4 位"], ["狀態", i ? "可用" : "使用中"]])}<div style="padding:20px;text-align:center;background:var(--bg);border-radius:12px">${svg("scan", 52)}<p style="font-size:11px">QR 位置示意，不可掃描</p></div><div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:16px">${detail("編輯桌台", name + " 桌編輯")}${action("列印 QR")}${detail("準備 QR 輪替", name + " 桌 QR 輪替")}</div></article>`).join("");
      return `${title()}${seatingNav}${leaf === "TableSetupTab" ? `${action("新增桌台")}${action("批次準備 QR")}${action("啟用已準備 QR")}${field("搜尋桌台", "search", "", 'placeholder="輸入桌號"')}` : `${nav("返回桌台設定", "TableSetupTab")}${card("目前點餐模式", metrics([["桌號", "A01"], ["模式", "桌台點餐"]]) + detail("切換點餐模式"))}`}<div class="equal-cols" style="margin-top:20px">${leaf === "TableDetailView" ? tiles.split('</article>')[0] + '</article>' : tiles}</div>`;
    }
    if (leaf === "ReservationTab") return `${title()}${seatingNav}${card("預約查詢", `${grid(field("日期", "date", "2026-11-11") + select("預約狀態", ["全部", "已確認", "已入座", "已取消"]))}${field("聯絡電話", "tel")}${action("搜尋預約")}${detail("新增預約")}${table(["確認碼", "顧客", "時間", "人數", "狀態", "特殊需求"], [["RS-DEMO-01", "示範顧客 A", "11/11 18:30", "4", "已確認", "兒童椅"]])}`)}`;
    return `${title()}${seatingNav}${card("候位現場", `${action("叫下一組")}${detail("新增候位")}${select("候位狀態", ["等候中", "已叫號", "已入座", "全部"])}${table(["號碼", "顧客", "人數", "等待", "狀態"], [["A028", "示範顧客 A", "2", "8 分鐘", "等候中"], ["A027", "示範顧客 B", "4", "12 分鐘", "已叫號"]])}${detail("安排座位")}`)}${leaf === "QueueDashboardTab" ? `<div style="margin-top:20px">${card("桌台與智慧分配", metrics([["可用桌台", "5"], ["使用中桌台", "7"]]) + check("啟用智慧分配") + action("手動分配座位"))}</div>` : ""}`;
  }

  if (portal && leaf === "DeploymentsView") return `${title()}${stack(card("批次部署", form(`${field("目標版本", "text", "2.1.0", 'placeholder="例如：2.1.0" required')}${check("選取示範餐廳 A，目前版本 2.0.9", true)}${check("選取示範餐廳 B，目前版本 2.0.9")}${note("請確認目標版本及所選租戶；預覽不執行部署。")}`, "部署所選租戶")) + card("最近部署", table(["租戶", "部署類型", "版本", "狀態", "開始時間"], [["示範餐廳 A", "更新", "2.0.8 → 2.0.9", "已完成", "11/10 14:32"]])))}`;
  if (leaf === "OptionGroupsView") return `${title()}${stack(card("共用選項群組", `${row("飲品甜度", "單選 · 必選 · 公開識別碼 sweetness", detail("編輯群組"))}${row("正常甜", "加價 NT$ 0", badge("供應中", "green"))}${row("半糖", "加價 NT$ 0", badge("供應中", "green"))}${detail("新增選項")}`) + card("建立選項群組", form(`${field("群組名稱", "text", "", "required")}${field("公開識別碼", "text", "", 'pattern="[A-Za-z0-9_-]{1,50}" required')}${note("公開識別碼建立後固定；使用英文字母、數字、底線或連字號。")}${select("種類", ["規格", "加購", "客製選項"])}${select("選取方式", ["單選", "多選"])}${check("必選")}${field("最多選取數", "number", "1", 'min="1"')}`, "儲存群組")))}`;
  if (leaf === "PrintAgentsView") return `${title()}${stack(card("列印代理", row("廚房出單機", "範例代理 · 未綁定收銀櫃", badge("已連線", "green")) + detail("撤銷代理確認")) + card("核發代理", form(`${field("代理名稱", "text", "", 'maxlength="100" required')}${select("綁定收銀櫃", ["不綁定（廚房出單）", "收銀櫃 A"])}${note("正式核發結果會顯示一次性憑證。此預覽不產生或保存憑證。")}`, "核發列印代理")))}`;
  if (leaf === "AIProviderConfig") return `${title()}${card("AI 連線設定", form(`${select("AI 供應商", ["Anthropic Claude", "OpenAI GPT", "Google Gemini", "DeepSeek", "自訂相容端點"])}${field("API 金鑰", "password", "", 'autocomplete="off" placeholder="輸入範例金鑰"')}${field("模型", "text", "", 'placeholder="輸入所選供應商的模型名稱"')}${field("自訂端點（適用時）", "url", "", 'placeholder="https://api.example.test"')}${action("測試連線")}${note("金鑰與端點僅供畫面示意，預覽不會傳送連線請求。")}`, "儲存 AI 設定"))}`;
  if (portal && leaf === "PoliciesView") return `${title()}${stack(card("政策適用範圍", grid(select("國家", ["台灣", "馬來西亞"]) + select("市場", ["國家預設", "示範市場 A"]))) + card("付款方式清單", form(`${note("此處示意清單類政策控制；實際選項依已定義政策。")}${check("現金", true)}${check("刷卡", true)}${check("電子支付")}`, "儲存清單政策")) + card("費率政策", form(`${field("費率（%）", "number", "2", 'min="0" max="100" step="0.01" inputmode="decimal"')}${note("示意數值，不代表正式費率。未設定時繼承上層政策。")}${action("清除覆寫")}`, "儲存費率政策")))}`;

  if (kitchenApp && leaf === "SettingsView") {
    const toggle = (label, on) => `<div class="toggle-row"><h3>${label}</h3><button class="switch" type="button" role="switch" aria-label="${label}" aria-checked="${on}" style="min-width:44px;min-height:44px"><span class="switch-track"></span></button></div>`;
    return `${title()}${stack(card("顯示", `${select("顯示字級", ["一般", "大", "特大"])}${toggle("顯示顧客姓名", true)}${toggle("顯示預估時間", true)}`) + card("通知", `${toggle("音效通知", true)}<label class="field"><span>音量</span><input type="range" min="0" max="100" step="5" value="60" aria-label="音量百分比" style="min-height:44px"></label>${select("提示音", ["預設", "清脆", "鈴聲", "提示聲"])}`) + card("工作節奏", `${select("急單門檻（分鐘）", ["5", "10", "15", "20", "30", "45", "60"])}${select("自動更新間隔（秒）", ["5", "10", "15", "30", "60", "120"])}${detail("還原預設設定確認")}${note("正式廚房設定隨選擇即時套用；此處只改變預覽控制。")}`))}`;
  }

  if (leaf === "PlatformOverview" || (portal && leaf === "TenantsView")) {
    return `${title()}${leaf === "PlatformOverview" ? stats([["店鋪總數", "24"], ["啟用店鋪", "23"], ["未啟用", "1"]]) : ""}${card(portal ? "租戶目錄" : "平台店鋪", `${field(portal ? "搜尋租戶" : "搜尋店鋪", "search", "", 'data-filter placeholder="商家名稱或聯絡資料"')}${select("狀態", ["全部", "啟用", "待配置", "已停用"])}${table(portal ? ["商家", "狀態", "聯絡信箱", "子網域", "版本"] : ["店鋪", "地址", "狀態"], portal ? [["示範餐廳 A", "啟用", "owner@example.test", "demo-a", "2.0.9"], ["示範餐廳 B", "待配置", "owner-b@example.test", "demo-b", "尚未部署"]] : [["示範餐廳 A", "範例商圈 A", "啟用"], ["示範餐廳 B", "範例商圈 B", "未啟用"]])}${portal ? nav("查看示範租戶", "TenantDetailView") + detail("建立租戶") : nav("管理店鋪", "DashboardView")}`)}`;
  }

  if (kitchenApp && leaf === "HistoryView") return `${title()}${tabs(["今天", "昨天", "本週"])}${stats([["訂單總數", "24"], ["平均備餐", "12 分鐘"], ["準時率", "96%"]])}${card("出餐紀錄", table(["訂單", "桌台／方式", "品項數", "備餐時間", "狀態", "時間"], [["#1042", "A03 桌", "3", "12 分鐘", "已出餐", "14:32"], ["#1041", "外帶", "2", "8 分鐘", "已出餐", "14:28"]]))}`;

  if (leaf === "ServiceView") return `${title()}${card("待送餐點", `${select("桌號", ["全部桌號", "A03", "B02"])}${select("優先程度", ["全部", "一般", "急單"])}${row("#1042 · A03 桌", "招牌雞肉飯 ×2、季節蔬菜 ×1", detail("開始送餐"))}${row("#1041 · B02 桌", "招牌雞肉飯 ×1", detail("確認送達"))}`)}<div style="margin-top:20px">${card("我的送餐與今日紀錄", metrics([["進行中", "1"], ["今日已送達", "12"]]) + detail("聯絡顧客") + detail("查看送餐時間軸"))}</div>`;

  if (leaf === "MenuView") return `${title()}<div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:20px">${detail("新增品項")}${detail("編輯分類")}${detail("CSV 匯入預覽")}${nav("共用選項群組", "OptionGroupsView")}</div>${card("菜單商品", `${grid(field("搜尋品項", "search", "", 'placeholder="品項名稱" data-filter') + select("分類", ["全部分類", "主餐", "配菜", "飲品"]))}${select("供應狀態", ["全部", "供應中", "已售完"])}${row("招牌雞肉飯", "主餐 · NT$ 160 · 庫存 24", detail("編輯品項", "招牌雞肉飯品項編輯"))}${row("季節蔬菜", "配菜 · NT$ 90 · 庫存 12", detail("編輯品項", "季節蔬菜品項編輯"))}`)}<div style="margin-top:20px">${card("品項編輯示意", form(`${grid(field("品項名稱", "text", "招牌雞肉飯", "required") + field("價格", "number", "160", 'min="1" required'))}${select("分類", ["主餐", "配菜", "飲品"])}${area("商品說明")}${grid(field("庫存數量", "number", "24", 'min="0"') + field("低庫存提醒", "number", "5", 'min="0"'))}${check("供應中", true)}${detail("編輯圖片與選項")}`, "儲存品項"))}</div>`;
  if (leaf === "GroupOrdersView") return `${title()}${stack(card("團體訂單", `${action("建立團體訂單")}${field("搜尋分享碼或桌號", "search", "", "data-filter")}${select("團單狀態", ["全部", "進行中", "已完成", "結帳失敗"])}${table(["分享碼", "桌號", "成員數", "狀態"], [["GROUP-DEMO", "A03", "3", "進行中"]])}`) + card("GROUP-DEMO／團單明細", `${metrics([["桌號", "A03"], ["成員", "3 位"], ["狀態", "進行中"]])}${table(["成員", "品項", "金額", "狀態"], [["示範成員 A", "雞肉飯 ×1", "NT$ 160", "已提交"], ["示範成員 B", "蔬菜 ×1", "NT$ 90", "選購中"]])}${detail("分享團單")}${detail("完成團單確認")}`) + card("結帳失敗復原（狀態示意）", `${select("承擔未結算款項的成員", ["請選擇成員", "示範成員 A", "示範成員 B"])}${detail("重試完成團單")}${metrics([["復原紀錄", "尚無重試紀錄"]])}`))}`;
  if (leaf === "ReviewsView") return `${title()}${stats([["平均評分", "4.6 / 5"], ["評價總數", "24"], ["待回覆", "3"]])}${stack(card("評價篩選", `${select("星等", ["全部", "5 星", "4 星", "3 星", "2 星", "1 星"])}${select("回覆狀態", ["全部", "未回覆", "已回覆"])}${grid(field("起始日期", "date") + field("結束日期", "date"))}`) + card("示範顧客 A／4 星", `<p>範例評語：餐點口味很好，希望備餐時間可以更清楚。</p>${note("訂單 #1042 · 2026/11/11")}${form(area("回覆此評價", "輸入店家回覆", "maxlength=1000 required"), "送出回覆")}`))}`;
  if (leaf === "FeedbackView") return `${title()}${stack(card("支援工單", `${grid(field("搜尋工單", "search", "", "data-filter") + select("工單狀態", ["全部", "待處理", "處理中", "已完成"]))}${grid(select("問題分類", ["全部", "系統問題", "使用建議"]) + select("優先度", ["全部", "一般", "高"]))}${row("範例：列印設定諮詢", "支援工單 · 一般優先度 · 處理中", detail("查看詳情", "列印設定諮詢工單"))}`) + card("提交支援問題", form(`${field("主旨", "text", "", "required")}${select("分類", ["系統問題", "使用建議"])}${select("優先度", ["一般", "高"])}${area("問題內容", "說明遇到的問題", "required")}`, "提交工單")))}`;

  if (portal && leaf === "MarketsView") return `${title()}${stack(card("市場目錄", `${grid(field("城市", "text", "") + field("行政區", "text", ""))}${action("重新整理")}${table(["市場名稱", "區域", "類型"], [["示範市場 A", "範例城市／行政區", "夜市"]])}`) + card("市場公開資料", form(`${grid(field("市場名稱", "text", "", "required") + field("slug", "text", "", 'pattern="[a-z0-9]+(-[a-z0-9]+)*" required'))}${select("市場類型", ["夜市", "商圈", "美食街", "活動場地"])}${grid(field("城市", "text", "", "required") + field("行政區", "text", "", "required"))}${field("地址", "text", "", "required")}${grid(field("緯度", "number", "", 'step="0.000001" required') + field("經度", "number", "", 'step="0.000001" required'))}${grid(field("開店時間", "time", "17:00") + field("關店時間", "time", "23:00"))}${area("市場說明")}`, "儲存市場")) + card("店鋪加入與匯入", `${row("示範餐廳 A／加入申請", "攤位號碼待確認", detail("審核加入申請"))}${field("搜尋既有店鋪", "search")}${action("搜尋店鋪")}${detail("加入／移除店鋪")}${area("店鋪 CSV 匯入", "貼上範例 CSV；先預覽，再確認匯入")}${action("預覽 CSV")}${detail("確認匯入")}`))}`;
  if (portal && leaf === "TenantDetailView") return `${title()}${nav("返回租戶目錄", "TenantsView")}${tabs(["概覽", "資源", "部署", "健康", "授權"])}${stack(card("示範餐廳 A／租戶概覽", metrics([["狀態", "啟用"], ["聯絡信箱", "owner@example.test"], ["子網域", "demo-a.makanmasak.com"], ["目前版本", "2.0.9"]]) + detail("重新部署確認")) + card("資源", table(["類型", "名稱", "識別碼", "狀態"], [["資料庫", "demo-a-db", "resource-demo-01", "已配置"]])) + card("部署紀錄", row("版本更新", "2.0.8 → 2.0.9 · 11/10 14:32", badge("已完成", "green"))) + card("健康檢查", metrics([["狀態", "正常"], ["回應時間", "124 ms"], ["檢查時間", "2026/11/11 14:32"]])) + card("授權", metrics([["等級", "標準"], ["有效期限", "2027/11/10"]])))} `;

  if (leaf === "ForecastView") return `${title()}${stack(card("預測期間", `${grid(field("開始日期", "date", "2026-11-12") + field("結束日期", "date", "2026-11-18"))}${action("重新整理")}${action("產生預測")}${tabs(["需求預測", "準確度", "食材預測"])}`) + card("品項需求預測", table(["品項", "預測數量", "信賴度", "趨勢", "歷史平均"], [["招牌雞肉飯", "42 份", "92%", "增加", "40 份"], ["季節蔬菜", "28 份", "88%", "持平", "28 份"]])) + card("準確度與採購", metrics([["預測準確度", "範例：92%"], ["食材需求", "依食材預測明細"]]) + detail("查看食材預測與採購清單")))}`;
  if (leaf === "SchedulingAnalyticsView") return `${title()}${stats([["在職員工", "12 人"], ["排班總工時", "320 小時"], ["本週班次", "40 班"], ["目前在班", "6 人"]])}${stack(card("工時分析", table(["員工", "預定工時", "實際工時", "加班工時"], [["示範員工 A", "40 小時", "40 小時", "0 小時"], ["示範員工 B", "32 小時", "34 小時", "2 小時"]])) + card("班別分布與趨勢", metrics([["早班", "24 班"], ["晚班", "16 班"], ["本週班次", "40 班"]])) + card("資料洞察", row("範例：加班時數需關注", "核對班次安排與實際出勤差異", detail("查看詳情")) + action("匯出報表")))}`;
  if (leaf === "ProductAnalyticsView") return `${title()}${select("分析期間", ["最近 7 天", "最近 30 天", "最近 90 天"])}${tabs(["流量商品", "熱銷商品", "獲利商品", "待改善商品"])}${stack(card("商品表現", table(["品項", "訂單數", "營收", "轉換率", "利潤率", "趨勢"], [["招牌雞肉飯", "42", "NT$ 6,720", "18%", "32%", "+6%"], ["季節蔬菜", "28", "NT$ 2,520", "12%", "28%", "+2%"]])) + card("指標說明與行動", metrics([["首選次數", "成為訂單第一項的次數"], ["轉換率", "依既有分析資料呈現"], ["利潤率", "以百分比呈現"]]) + detail("查看商品分析建議")))}`;
  if (leaf === "AIInsightsDashboard") return `${title()}${select("分析期間", ["最近 7 天", "最近 30 天"])}${action("重新產生報告")}${nav("AI 服務設定", "AIProviderConfig")}${stack(card("執行摘要", `<p>範例報告展示摘要、洞察及後續行動的閱讀層級；內容不是對真實店鋪的分析。</p>`) + card("營運洞察", row("品項表現", "查看熱銷商品與訂單結構", nav("查看商品分析", "ProductAnalyticsView"))) + card("未來七日預測", table(["日期", "預測訂單", "預測營收"], [["11/12", "42 筆", "NT$ 6,720"], ["11/13", "46 筆", "NT$ 7,360"]])))} `;

  return null;
}
