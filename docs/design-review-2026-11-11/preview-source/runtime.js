const REVIEW_ASSETS = REVIEW.assets;
for (const page of REVIEW.pages) for (const capture of page.captures) capture.image = REVIEW.images[capture.screenshot];
let previewCart = null;
const APPS = {
  "customer-app": { title: "顧客點餐", short: "點餐", accent: "#2563EB", soft: "#E0EFFF", nav: [["首頁", "HomeView"], ["探索美食", "DiscoveryView"], ["夜市與商圈", "MarketsView"], ["我的訂單", "OrderHistoryView"], ["個人中心", "ProfileView"]] },
  "admin-dashboard": { title: "餐廳後台", short: "餐廳營運", accent: "#B7440A", soft: "#FFF2E0", nav: [["營運總覽", "OwnerView"], ["訂單管理", "OrdersView"], ["菜單管理", "MenuView"], ["座位與候位", "SeatingManagementView"], ["員工管理", "EmployeeManagementView"], ["營運分析", "AnalyticsView"], ["系統設定", "SettingsView"]] },
  "kitchen-display": { title: "廚房看板", short: "廚房", accent: "#084E9D", soft: "#E0EFFF", nav: [["訂單看板", "EnhancedKitchenDashboard"], ["歷史訂單", "HistoryView"], ["我的班表", "MyShiftsView"], ["系統設定", "SettingsView"]] },
  "management-portal": { title: "平台管理", short: "平台管理", accent: "#15803D", soft: "#E7F8EB", nav: [["平台總覽", "DashboardView"], ["租戶管理", "TenantsView"], ["部署管理", "DeploymentsView"], ["健康監控", "HealthView"], ["授權管理", "LicensesView"], ["市場管理", "MarketsView"], ["地區政策", "PoliciesView"]] },
  "onboarding-app": { title: "開店申請", short: "開店申請", accent: "#B04F09", soft: "#FFF2E0", nav: [["了解服務", "HomeView"], ["填寫申請", "ApplyView"], ["找回申請", "FindApplicationView"]] },
};
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const svg = (name, size = 20) => {
  const paths = {
    arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
    back: '<path d="m14 6-6 6 6 6"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    bag: '<path d="M5 7h14l1 13H4L5 7Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    scan: '<path d="M3 8V3h5m8 0h5v5M3 16v5h5m8 0h5v-5M3 12h18"/><rect x="7" y="7" width="3" height="3"/><rect x="14" y="7" width="3" height="3"/><path d="M7 15h3v2H7m7-2h3v2h-3"/>',
    home: '<path d="m3 10 9-7 9 7M5 9v12h14V9M9 21v-8h6v8"/>',
    users: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m1-16a3 3 0 0 1 0 6m2 3a6 6 0 0 1 3 5v2"/>',
    gear: '<circle cx="12" cy="12" r="4"/><path d="M10 2h4l1 3 3 1 3 3v5l-3 1-1 3-3 3h-4l-1-3-3-1-3-3v-4l3-1 1-3 3-3Z"/>',
    bell: '<path d="M5 17h14l-2-3V9a5 5 0 0 0-10 0v5l-2 3Zm5 3h4"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    chart: '<path d="M4 3v17h17M8 15l4-5 4 3 5-8"/>',
    pin: '<path d="M19 10c0 6-7 11-7 11S5 16 5 10a7 7 0 0 1 14 0Z"/><circle cx="12" cy="10" r="2.5"/>',
    document: '<path d="M14 3H5v18h14V8l-5-5Zm0 0v5h5M8 12h8m-8 4h6"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 1v3m0 16v3M1 12h3m16 0h3M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2"/>',
  };
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.document}</svg>`;
};
const button = (text, options = "") => `<button class="button" ${options}>${esc(text)}${svg("arrow", 16)}</button>`;
const badge = (text, tone = "blue") => `<span class="badge ${tone}">${esc(text)}</span>`;
const field = (label, type = "text", value = "", options = "") => `<label class="field"><span>${esc(label)}</span><input type="${type}" value="${esc(value)}" ${options} /></label>`;
const pageLeaf = (page) => page.file.split("/").pop().replace(".vue", "");
const sections = (page) => page.proposal.sections || [];
const contentValues = (page) => sections(page).flatMap((section) => section.content || []);

const PREVIEW_CSS = `
[hidden]{display:none!important}.stack,.card,.two-col>*{min-width:0}.metric-list dt,.metric-list dd{overflow-wrap:anywhere}.state-control{position:static!important;width:max-content;max-width:100%;margin:20px auto 110px}.state-control button{min-height:44px!important}.wordmark .mark{font-size:18px;letter-spacing:0}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
:root{font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang TC","Noto Sans TC",sans-serif;--bg:#F2F2F7;--paper:#fff;--ink:#1C1C1E;--muted:rgba(28,28,30,.66);--line:#E5E5EA;--blue:#084E9D;--green:#267B3D;--orange:#9B5E09;--red:#9B2A25;font-synthesis:none;color:var(--ink);background:var(--bg);font-size:14px;line-height:1.6}*{box-sizing:border-box}body{margin:0}button,input,select,textarea{font:inherit}button,a,input,select,summary{touch-action:manipulation}button{cursor:pointer}a{color:var(--accent);text-underline-offset:4px}button{color:inherit}button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,summary:focus-visible{outline:3px solid #2563EB;outline-offset:3px}::selection{background:var(--soft);color:var(--accent)}::-webkit-scrollbar{width:6px;height:6px}::-webkit-scrollbar-thumb{background:#b9b9be;border-radius:8px}input,select,textarea{caret-color:var(--accent);max-width:100%}h1,h2,h3,p{margin:0}h1{font-size:30px;font-weight:730;letter-spacing:-.035em;line-height:1.35;text-wrap:balance}h2{font-size:19px;line-height:1.4;font-weight:680;letter-spacing:-.02em}h3{font-size:15px;font-weight:650}small,.muted{color:var(--muted)}small{font-size:12px}button svg{flex:none}.app-header{height:76px;padding:0 32px;background:white;display:flex;align-items:center;justify-content:space-between;gap:16px;position:sticky;top:0;z-index:4}.wordmark{display:flex;align-items:center;gap:10px;font-size:17px;letter-spacing:-.025em;font-weight:750;white-space:nowrap}.mark{height:34px;width:34px;display:grid;place-items:center;background:var(--accent);color:white;border-radius:11px;font-size:21px;letter-spacing:-.05em}.wordmark small{font-size:11px;font-weight:500;letter-spacing:0;margin-left:5px}.header-actions{display:flex;gap:14px;align-items:center}.subtle{border:0;background:transparent;min-height:44px;padding:0 8px;color:var(--muted);display:inline-flex;align-items:center;gap:8px;font-size:12px}.sample{font-size:10px;color:var(--muted);white-space:nowrap}.avatar{height:32px;width:32px;display:grid;place-items:center;border-radius:50%;background:var(--soft);font-size:12px;color:var(--accent)}.header-menu{display:none;border:0;background:transparent;height:44px;width:44px;align-items:center;justify-content:center}.shell{display:grid;grid-template-columns:186px minmax(0,1fr);min-height:calc(100vh - 76px)}.app-sidebar{background:#fff;padding:28px 14px;display:flex;flex-direction:column;gap:5px}.app-sidebar button{display:flex;align-items:center;gap:11px;min-height:46px;border:0;background:transparent;border-radius:12px;text-align:left;font-size:12px;padding:10px 13px;color:var(--muted)}.app-sidebar button.active{color:var(--accent);background:var(--soft);font-weight:650}.app-sidebar .sidebar-bottom{margin-top:auto;padding-top:45px;font-size:10px;color:var(--muted);padding-left:14px}.main{padding:35px 32px 48px;min-width:0}.page-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;margin-bottom:28px}.page-heading p{font-size:12px;line-height:1.9;margin-top:8px;color:var(--muted);max-width:65ch}.heading-actions{display:flex;gap:10px;flex-shrink:0;align-items:center}.button{display:inline-flex;align-items:center;justify-content:center;gap:10px;border:0;background:var(--accent);color:#fff;min-height:44px;border-radius:50px;padding:11px 21px;font-size:12px;font-weight:650;white-space:normal;text-align:center;line-height:1.5;transition:background .15s,transform .15s;text-decoration:none}.button:hover{filter:brightness(.94)}.button:active{transform:translateY(1px)}.button.secondary{background:#fff;color:var(--ink);box-shadow:0 2px 8px #0000000a}.button.soft{color:var(--accent);background:var(--soft)}.button.danger{color:#9B2A25;background:#FFE7E6}.button.green{background:#267B3D}.button:disabled{color:var(--muted);background:var(--line);cursor:not-allowed;filter:none}.icon-button{min-width:44px;height:44px;border:0;border-radius:50%;background:var(--bg);display:inline-flex;align-items:center;justify-content:center;flex:none}.card{background:white;border-radius:16px;padding:24px;box-shadow:0 4px 16px #00000008}.card-head{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:20px}.card-head h2{font-size:16px}.card-head a,.card-head button.link{font-size:12px}.link{border:0;background:transparent;min-height:44px;padding:8px 0;color:var(--accent);font-size:12px;text-decoration:underline;text-underline-offset:4px}.stack{display:flex;flex-direction:column;gap:20px}.two-col{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(0,1fr);gap:20px}.equal-cols{display:grid;grid-template-columns:1fr 1fr;gap:20px}.badge{display:inline-flex;align-items:center;gap:6px;border-radius:50px;padding:5px 10px;font-size:11px;line-height:1.4;font-weight:600;white-space:nowrap}.badge.blue{background:#E0EFFF;color:#084E9D}.badge.green{background:#E7F8EB;color:#267B3D}.badge.orange{background:#FFF2E0;color:#9B5E09}.badge.red{background:#FFE7E6;color:#9B2A25}.badge.neutral{background:var(--bg);color:var(--muted)}.stats-strip{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));padding:22px 0;background:#fff;border-radius:16px;margin-bottom:24px;box-shadow:0 4px 16px #00000006}.stat{padding:0 24px}.stat+.stat{border-left:1px solid var(--line)}.stat dt{font-size:11px;color:var(--muted);margin:0 0 7px}.stat dd{font-size:26px;font-weight:720;letter-spacing:-.025em;margin:0;font-variant-numeric:tabular-nums;line-height:1.4}.stat small{font-size:10px}.stat .trend{color:#267B3D}.section-note{font-size:11px;color:var(--muted);margin:18px 0 0;line-height:1.8}.tabs{display:flex;gap:22px;border-bottom:1px solid var(--line);overflow:auto;margin-bottom:20px}.tabs button{border:0;background:transparent;font-size:12px;min-height:46px;color:var(--muted);padding:0 1px;white-space:nowrap}.tabs button[aria-selected=true]{color:var(--accent);box-shadow:inset 0 -2px var(--accent);font-weight:650}.filters{display:flex;gap:10px;align-items:end;flex-wrap:wrap;margin:0 0 20px}.search-field{display:flex;align-items:center;gap:9px;min-width:180px;flex:1;background:var(--bg);padding:0 14px;border-radius:10px}.search-field input{height:44px;border:0;background:transparent;width:100%;min-width:0;font-size:12px;color:var(--ink)}.filters select,.filters input[type=date]{border:0;background:var(--bg);border-radius:10px;padding:0 12px;height:44px;font-size:12px;min-width:110px}.field{display:flex;flex-direction:column;gap:8px;font-size:12px;color:var(--ink);margin-bottom:20px;min-width:0}.field>span{font-weight:600}.field input,.field select,.field textarea{width:100%;border:0;border-radius:9px;background:var(--bg);min-height:46px;padding:11px 13px;font-size:13px;color:var(--ink)}.field input::placeholder{color:var(--muted)}.field textarea{height:110px;resize:vertical}.field small{font-size:11px}.table-scroll{overflow-x:auto;margin:0 -2px}table{width:100%;border-collapse:collapse;text-align:left;font-size:12px;white-space:nowrap}th{font-weight:500;color:var(--muted);font-size:10px;padding:13px 12px;background:var(--bg)}td{padding:15px 12px;border-bottom:1px solid var(--line);font-variant-numeric:tabular-nums}tbody tr:last-child td{border:0}td:first-child{font-weight:600}th:first-child{border-radius:6px 0 0 6px}th:last-child{border-radius:0 6px 6px 0}.row-action{border:0;background:transparent;min-height:44px;color:var(--accent);padding:0 6px;font-size:11px}.table-footer{display:flex;justify-content:space-between;align-items:center;margin-top:14px;font-size:11px;color:var(--muted)}.table-footer button{background:var(--bg);color:var(--ink);border:0;border-radius:50%;height:38px;width:38px}.mono{font-family:"SFMono-Regular",Consolas,monospace;font-variant-numeric:tabular-nums}.metric-list{margin:0}.metric-list>div{display:flex;justify-content:space-between;align-items:center;padding:13px 0;gap:20px;border-bottom:1px solid var(--line)}.metric-list>div:last-child{border:0}.metric-list dt{font-size:12px;color:var(--muted)}.metric-list dd{margin:0;font-size:13px;font-weight:600}.chart{height:200px;display:flex;align-items:end;gap:17px;padding:20px 4px 28px;position:relative;border-bottom:1px solid var(--line)}.chart-bar{flex:1;background:var(--soft);border-radius:5px 5px 0 0;position:relative;min-width:6px}.chart-bar.today{background:var(--accent)}.chart-bar span{position:absolute;bottom:-25px;left:50%;transform:translateX(-50%);font-size:9px;color:var(--muted);white-space:nowrap}.chart-label{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px}.chart-label strong{font-size:26px;letter-spacing:-.03em;font-variant-numeric:tabular-nums}.chart-label small{font-size:10px}.task-row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:15px 0;border-bottom:1px solid var(--line)}.task-row:last-child{border:0}.task-row p{font-size:12px;font-weight:600}.task-row small{display:block;font-size:10px;margin-top:3px}.status-dot{display:inline-block;width:6px;height:6px;background:#267B3D;border-radius:50%;margin-right:7px}.mobile-main{max-width:760px;margin:0 auto;padding:30px 28px 100px}.mobile-main .page-heading{margin-bottom:24px}.mobile-main h1{font-size:29px}.bottom-nav{display:flex;justify-content:space-around;background:white;box-shadow:0 -4px 16px #00000006;position:fixed;bottom:0;left:0;right:0;z-index:4;padding:9px max(12px,env(safe-area-inset-right)) max(9px,env(safe-area-inset-bottom))}.bottom-nav button{border:0;background:transparent;min-height:46px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;color:var(--muted);font-size:9px;min-width:55px}.bottom-nav button.active{color:var(--accent)}.home-welcome{padding:15px 0 30px}.home-welcome h1{font-size:39px;line-height:1.3;letter-spacing:-.04em}.home-welcome p{color:var(--muted);font-size:13px;margin-top:14px;line-height:1.9}.scan-panel{padding:28px;background:white;border-radius:24px;box-shadow:0 4px 16px #00000008}.scan-graphic{height:142px;display:flex;align-items:center;justify-content:center;color:var(--accent);margin-bottom:20px}.scan-graphic>svg{width:116px;height:116px;stroke-width:.9}.scan-panel h2{font-size:23px}.scan-panel p{font-size:12px;line-height:1.9;color:var(--muted);margin:9px 0 21px}.scan-panel .button{width:100%;min-height:50px}.home-alternatives{margin:18px 0;display:grid;grid-template-columns:1fr 1fr;gap:12px}.choice{border:0;background:#fff;border-radius:16px;padding:20px;text-align:left;min-height:120px;display:flex;flex-direction:column;align-items:flex-start;gap:8px;box-shadow:0 2px 8px #00000006}.choice svg{color:var(--accent)}.choice strong{font-size:13px}.choice small{font-size:10px;line-height:1.6}.chip-row{display:flex;gap:9px;overflow:auto;padding-bottom:4px;margin:20px 0}.chip{border:0;background:#fff;border-radius:50px;min-height:44px;padding:10px 17px;white-space:nowrap;font-size:12px}.chip[aria-pressed=true]{background:var(--accent);color:#fff}.restaurant-row{padding:20px 0;display:grid;grid-template-columns:72px 1fr auto;align-items:center;gap:17px;border-bottom:1px solid var(--line)}.restaurant-row:last-child{border:0}.restaurant-mark{height:72px;width:72px;border-radius:18px;background:var(--soft);color:var(--accent);display:grid;place-items:center;font-size:25px;font-weight:650}.restaurant-row h3{font-size:16px}.restaurant-row p{font-size:11px;color:var(--muted);margin-top:5px}.menu-hero{background:#fff;padding:26px;border-radius:24px;margin-bottom:24px;box-shadow:0 4px 16px #00000006}.menu-hero h1{font-size:30px;margin-bottom:12px}.menu-hero p{color:var(--muted);font-size:12px;margin-top:10px}.dish{display:flex;align-items:center;gap:18px;padding:22px 0;border-bottom:1px solid var(--line)}.dish:last-child{border:0}.dish-body{flex:1;min-width:0}.dish h3{font-size:16px;margin-bottom:5px}.dish p{font-size:11px;color:var(--muted);margin-bottom:10px;line-height:1.8}.dish strong{font-size:15px;font-variant-numeric:tabular-nums}.dish-add{height:44px;width:44px;border:0;border-radius:50%;background:var(--soft);color:var(--accent);display:grid;place-items:center;flex:none}.floating-cart{position:fixed;bottom:22px;left:24px;right:24px;z-index:5;display:flex;justify-content:space-between;align-items:center;background:var(--accent);color:white;border:0;border-radius:50px;padding:15px 22px;min-height:54px;box-shadow:0 8px 30px #00000014;font-size:13px;font-weight:650}.floating-cart span{font-variant-numeric:tabular-nums}.cart-line{display:flex;gap:15px;padding:20px 0;border-bottom:1px solid var(--line)}.cart-line>div:first-child{flex:1}.cart-line p{font-size:14px;font-weight:650}.cart-line small{display:block;margin:4px 0 15px;font-size:11px}.stepper{display:flex;align-items:center;gap:4px;background:var(--bg);border-radius:50px;max-width:130px}.stepper button{width:44px;height:44px;display:grid;place-items:center;border:0;background:transparent}.stepper span{min-width:20px;text-align:center;font-size:12px;font-variant-numeric:tabular-nums}.receipt-row{display:flex;align-items:center;justify-content:space-between;font-size:12px;margin:13px 0;font-variant-numeric:tabular-nums}.receipt-row.total{font-size:18px;font-weight:700;margin-top:18px;padding-top:18px;border-top:1px solid var(--line)}.cart-checkout{position:fixed;bottom:0;left:0;right:0;background:white;padding:18px 26px max(18px,env(safe-area-inset-bottom));box-shadow:0 -4px 16px #00000008;display:flex;justify-content:space-between;align-items:center;gap:24px}.cart-checkout strong{display:block;font-size:22px;font-variant-numeric:tabular-nums}.cart-checkout small{font-size:10px}.cart-body{padding-bottom:160px}.timeline{list-style:none;padding:0;margin:20px 0 0}.timeline li{position:relative;display:flex;gap:15px;padding:0 0 28px}.timeline li:not(:last-child):before{content:"";position:absolute;left:15px;top:34px;bottom:3px;width:1px;background:var(--line)}.timeline .step-dot{width:32px;height:32px;display:grid;place-items:center;border-radius:50%;background:var(--bg);color:var(--muted);flex:none}.timeline .done .step-dot{background:#E7F8EB;color:#267B3D}.timeline .current .step-dot{background:var(--accent);color:white}.timeline h3{font-size:13px;margin:3px 0 5px}.timeline p{font-size:11px;color:var(--muted)}.tracking-summary{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px}.tracking-summary strong{font-size:38px;letter-spacing:-.03em;line-height:1.2}.tracking-summary small{display:block;margin:10px 0 0;font-size:11px}.queue-number{font-size:65px;font-weight:730;letter-spacing:-.04em;line-height:1.3;font-variant-numeric:tabular-nums}.queue-display{text-align:center;padding:35px 0 28px}.queue-display p{color:var(--muted);font-size:12px;margin:12px 0 18px}.auth-wrap{min-height:calc(100vh - 76px);display:grid;grid-template-columns:1fr 1fr;align-items:center;gap:60px;max-width:980px;padding:65px 30px;margin:auto}.auth-story h1{font-size:44px;letter-spacing:-.04em;line-height:1.35;margin-bottom:22px}.auth-story p{font-size:14px;color:var(--muted);max-width:30ch;line-height:2}.auth-story .auth-illustration{margin-top:40px;color:var(--accent);background:var(--soft);border-radius:24px;padding:25px;display:flex;align-items:center;gap:24px}.auth-illustration strong{display:block;font-size:13px}.auth-illustration small{font-size:10px}.auth-form{background:#fff;border-radius:24px;padding:34px;box-shadow:0 4px 16px #00000008}.auth-form h2{font-size:26px;margin-bottom:12px}.auth-form>p{font-size:12px;color:var(--muted);margin-bottom:24px;line-height:1.9}.auth-form .button{width:100%;margin-top:5px}.auth-form .tabs{gap:30px}.auth-links{display:flex;justify-content:space-between;flex-wrap:wrap;gap:12px;font-size:11px;margin-top:23px}.form-success{font-size:12px;color:#267B3D;background:#E7F8EB;padding:14px;border-radius:10px;margin-top:16px}.form-success:empty{display:none}.onboarding-main{max-width:1010px;margin:auto;padding:55px 40px}.onboarding-hero{display:grid;grid-template-columns:1fr 1fr;gap:50px;align-items:center;margin:15px 0 75px}.onboarding-hero h1{font-size:49px;font-weight:730;letter-spacing:-.04em;line-height:1.28}.onboarding-hero h1 span{color:var(--accent)}.onboarding-hero p{color:var(--muted);font-size:13px;line-height:2;margin:22px 0 28px;max-width:36ch}.hero-links{display:flex;gap:18px;align-items:center;flex-wrap:wrap}.demo-device{background:#fff;box-shadow:0 8px 30px #00000010;border-radius:24px;padding:21px;transform:rotate(-2deg)}.demo-device .demo-top{display:flex;align-items:center;justify-content:space-between;font-size:11px;margin-bottom:22px}.demo-device .mini-total{font-size:34px;letter-spacing:-.035em;margin-top:5px;font-weight:730}.mini-orders{margin-top:18px}.mini-orders .task-row{padding:14px 0}.journey{margin:30px 0;display:grid;grid-template-columns:repeat(4,1fr);gap:25px}.journey h3{font-size:13px;margin:16px 0 8px}.journey p{font-size:11px;color:var(--muted);line-height:1.9}.journey svg{color:var(--accent)}.onboarding-form-wrap{max-width:860px;margin:0 auto;padding:40px 25px 70px}.onboarding-progress{display:flex;align-items:center;gap:16px;font-size:12px;color:var(--muted);margin-bottom:32px}.onboarding-progress span{height:30px;width:30px;border-radius:50%;background:var(--soft);color:var(--accent);display:grid;place-items:center;font-weight:600}.onboarding-progress .active{font-weight:650;color:var(--accent);display:flex;align-items:center;gap:10px}.form-section{background:white;border-radius:18px;padding:30px;margin-top:20px;box-shadow:0 4px 16px #00000006}.form-section h2{font-size:18px;margin-bottom:24px}.form-help{font-size:11px;color:var(--muted);line-height:1.9}.form-actions{display:flex;justify-content:space-between;align-items:center;gap:20px;margin-top:26px}.checks{display:flex;align-items:start;gap:10px;font-size:12px;color:var(--muted);line-height:1.8}.checks input{min-width:20px;height:20px;accent-color:var(--accent)}.notice{display:flex;align-items:flex-start;gap:12px;background:var(--soft);color:var(--accent);border-radius:12px;padding:16px 18px;font-size:12px;line-height:1.9}.notice svg{flex:none;margin-top:2px}.notice.warning{background:#FFF2E0;color:#9B5E09}.empty-state{text-align:center;max-width:540px;margin:70px auto;padding:36px}.empty-icon{width:70px;height:70px;border-radius:24px;background:var(--soft);color:var(--accent);display:grid;place-items:center;margin:0 auto 25px}.empty-state h1{font-size:31px}.empty-state p{font-size:13px;color:var(--muted);line-height:1.9;margin:15px 0 25px}.legal{max-width:740px;background:#fff;border-radius:20px;padding:40px;margin:auto}.legal h2{margin:32px 0 12px;font-size:19px}.legal p,.legal li{font-size:13px;line-height:2;color:var(--muted)}.legal .legal-toc{background:var(--bg);border-radius:12px;padding:16px 20px;margin:30px 0}.legal-toc a{display:block;margin:5px 0;min-height:36px;font-size:12px}.settings-layout{display:grid;grid-template-columns:164px minmax(0,1fr);gap:20px}.settings-nav{display:flex;flex-direction:column;gap:4px;align-self:start}.settings-nav button{min-height:44px;text-align:left;border:0;border-radius:9px;background:transparent;padding:11px 14px;font-size:12px;color:var(--muted)}.settings-nav button[aria-selected=true]{background:#fff;color:var(--accent);font-weight:600}.toggle-row{display:flex;justify-content:space-between;align-items:center;gap:25px;padding:18px 0;border-bottom:1px solid var(--line)}.toggle-row h3{font-size:13px}.toggle-row p{font-size:11px;color:var(--muted);margin-top:6px}.switch{display:flex;align-items:center;justify-content:center;min-width:56px;height:44px;border:0;background:transparent;padding:7px}.switch-track{width:42px;height:26px;border-radius:50px;background:#E5E5EA;position:relative}.switch-track:after{content:"";position:absolute;top:3px;left:3px;width:20px;height:20px;background:white;border-radius:50%;box-shadow:0 2px 8px #0000000a;transition:left .15s}.switch[aria-checked=true] .switch-track{background:#267B3D}.switch[aria-checked=true] .switch-track:after{left:19px}.kitchen-main{padding:26px}.kitchen-main h1{font-size:25px}.kitchen-summary{display:flex;justify-content:space-between;gap:20px;align-items:center;margin:0 0 23px}.kitchen-counters{display:flex;gap:25px;font-size:12px;align-items:center}.kitchen-counters strong{font-size:25px;font-variant-numeric:tabular-nums;margin-right:6px}.kanban{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px}.kanban-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;padding:0 3px}.kanban-heading h2{font-size:16px}.kanban-count{font-size:12px;color:var(--muted)}.kitchen-ticket{background:white;border-radius:20px;padding:22px;margin-bottom:16px;box-shadow:0 4px 16px #00000008}.ticket-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:18px}.ticket-number{font-size:24px;font-weight:750;letter-spacing:-.025em}.ticket-timer{font-family:"SFMono-Regular",Consolas,monospace;font-size:14px;font-weight:650;color:#9B5E09;background:#FFF2E0;padding:6px 9px;border-radius:50px}.ticket-timer.urgent{color:#9B2A25;background:#FFE7E6}.ticket-meta{display:flex;gap:10px;align-items:center;margin-bottom:14px}.ticket-meta small{font-size:11px}.ticket-items{list-style:none;margin:0 0 14px;padding:0}.ticket-items li{display:flex;gap:13px;font-size:16px;font-weight:600;padding:10px 0;border-bottom:1px solid var(--line);line-height:1.6}.ticket-items strong{font-family:monospace;font-size:15px;min-width:16px}.ticket-note{font-size:12px;color:#9B5E09;background:#FFF2E0;border-radius:9px;padding:10px 12px;margin:15px 0}.kitchen-ticket .button{width:100%;min-height:54px;font-size:14px}.calendar-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:22px}.calendar{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:7px}.calendar-day-name{font-size:11px;color:var(--muted);text-align:center;padding:8px}.calendar-cell{min-height:95px;padding:9px;background:var(--bg);border-radius:9px;font-size:11px;font-variant-numeric:tabular-nums}.calendar-cell.today{background:var(--soft);color:var(--accent)}.shift-block{display:block;background:white;color:var(--accent);border-radius:5px;padding:4px 5px;margin-top:9px;font-size:9px;line-height:1.6}.profile-head{display:flex;align-items:center;gap:19px;margin-bottom:28px}.profile-avatar{width:72px;height:72px;background:var(--soft);color:var(--accent);border-radius:50%;font-size:25px;font-weight:650;display:grid;place-items:center}.profile-head h1{font-size:26px}.profile-head p{font-size:12px;color:var(--muted);margin-top:7px}.profile-link{display:flex;width:100%;border:0;background:transparent;text-align:left;align-items:center;justify-content:space-between;padding:18px 0;min-height:60px;border-bottom:1px solid var(--line);font-size:13px}.profile-link:last-child{border:0}.profile-link span{display:flex;align-items:center;gap:13px}.profile-link svg{color:var(--accent)}.seat-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}.seat{border:0;border-radius:18px;min-height:140px;background:var(--bg);padding:22px;text-align:left;display:flex;flex-direction:column;justify-content:space-between}.seat strong{font-size:26px;letter-spacing:-.03em}.seat small{font-size:11px}.seat.occupied{background:var(--soft);color:var(--accent)}.status-list{display:flex;flex-direction:column;gap:0}.health-service{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:19px 0;border-bottom:1px solid var(--line)}.health-service:last-child{border:0}.health-service strong{display:block;font-size:13px}.health-service small{font-size:10px;display:block;margin-top:4px}.health-bars{display:flex;gap:3px;margin:12px 0}.health-bars i{height:23px;flex:1;border-radius:3px;background:#CAF0D4}.health-bars i.warn{background:#FFD08F}.invoice-total{font-size:39px;font-weight:720;letter-spacing:-.035em;margin:16px 0;font-variant-numeric:tabular-nums}.progress-track{height:6px;border-radius:50px;background:var(--bg);margin:13px 0}.progress-track span{display:block;width:62%;height:100%;border-radius:50px;background:var(--accent)}.toast{position:fixed;bottom:30px;left:50%;transform:translateX(-50%);max-width:calc(100% - 40px);background:var(--ink);color:white;border-radius:14px;padding:13px 20px;font-size:12px;box-shadow:0 8px 30px #00000014;z-index:15;display:none;text-align:center}.toast.show{display:block}dialog{border:0;border-radius:24px;width:min(480px,calc(100% - 32px));padding:28px;color:var(--ink);box-shadow:0 8px 30px #00000014}dialog::backdrop{background:#1C1C1E66}.dialog-head{display:flex;justify-content:space-between;align-items:center;gap:20px;margin-bottom:18px}.dialog-head h2{font-size:20px}.dialog-copy{font-size:12px;color:var(--muted);line-height:1.9}.preview-empty,.preview-error,.preview-loading{background:white;border-radius:18px;padding:50px 25px;text-align:center;max-width:650px;margin:40px auto}.preview-empty svg,.preview-error svg{color:var(--accent);margin-bottom:16px}.preview-error{background:#FFF3F3}.preview-error h2{color:#9B2A25}.preview-empty p,.preview-error p,.preview-loading p{font-size:12px;color:var(--muted);line-height:1.9;margin:12px 0 24px}.loader{height:5px;width:180px;margin:20px auto;background:var(--bg);overflow:hidden;border-radius:50px}.loader:after{content:"";display:block;width:60%;height:100%;background:var(--accent);animation:loading 1.4s infinite ease-out}@keyframes loading{from{transform:translateX(-100%)}to{transform:translateX(180%)}}.reveal{animation:reveal .4s cubic-bezier(.16,1,.3,1) both}@keyframes reveal{from{clip-path:inset(0 0 6% 0);filter:blur(2px)}to{clip-path:inset(0);filter:blur(0)}}.back-link{display:inline-flex;align-items:center;gap:4px;min-height:44px;border:0;background:transparent;color:var(--muted);font-size:11px;margin-bottom:12px;padding:0}.full-width{width:100%}.state-control{position:fixed;right:10px;bottom:10px;z-index:8;display:flex;gap:3px;background:white;border-radius:50px;box-shadow:0 2px 8px #0000000a;padding:3px}.state-control button{background:transparent;border:0;padding:4px 8px;min-height:32px;border-radius:50px;font-size:9px;color:var(--muted)}.state-control button[aria-pressed=true]{background:var(--soft);color:var(--accent)}.state-control.hide{display:none}
@media(max-width:700px){.app-header{height:65px;padding:0 20px}.wordmark{font-size:15px}.wordmark small{display:none}.mark{width:30px;height:30px;font-size:19px}.header-actions{gap:6px}.header-actions .sample{font-size:9px}.header-menu{display:flex}.shell{display:block;min-height:calc(100vh - 65px)}.app-sidebar{display:none;position:fixed;inset:65px auto 0 0;width:230px;z-index:5;box-shadow:0 8px 30px #00000014}.app-sidebar.open{display:flex}.main{padding:25px 19px 70px}.page-heading{flex-wrap:wrap;gap:17px;margin-bottom:23px}h1{font-size:27px}.page-heading p{font-size:11px;line-height:1.9}.heading-actions{flex-wrap:wrap;gap:8px}.button{padding:11px 17px;font-size:12px}.stats-strip{grid-template-columns:repeat(2,minmax(0,1fr));padding:6px 0;row-gap:0}.stat{padding:16px 19px}.stat:nth-child(3){border-left:0;border-top:1px solid var(--line)}.stat:nth-child(4){border-top:1px solid var(--line)}.stat dd{font-size:25px}.stat dt{font-size:11px}.two-col,.equal-cols{grid-template-columns:1fr}.card{padding:21px;border-radius:16px}.chart{gap:10px;height:190px}.mobile-main{padding:24px 21px 110px}.mobile-main h1{font-size:29px}.home-welcome h1{font-size:38px}.home-welcome{padding:8px 0 25px}.scan-panel{padding:25px}.home-alternatives{gap:11px}.choice{padding:18px;min-height:125px}.mobile-main .page-heading{margin-bottom:22px}.auth-wrap{display:block;padding:30px 21px 60px}.auth-story{display:none}.auth-form{padding:26px 24px}.auth-form h2{font-size:26px}.onboarding-main{padding:30px 22px 70px}.onboarding-hero{display:block;margin:10px 0 45px}.onboarding-hero h1{font-size:39px;line-height:1.35}.onboarding-hero p{font-size:12px;margin:18px 0 22px}.demo-device{margin:36px 3px 0;padding:22px;transform:none}.journey{grid-template-columns:1fr 1fr;gap:27px 20px;margin-top:26px}.journey h3{margin-top:12px}.onboarding-form-wrap{padding:25px 18px 70px}.onboarding-progress{gap:9px;font-size:10px;overflow:auto;white-space:nowrap}.onboarding-progress span{width:25px;height:25px}.form-section{padding:23px 20px}.form-section h2{font-size:17px}.form-actions{align-items:flex-start;flex-direction:column}.form-actions .button{width:100%}.field{margin-bottom:18px}.auth-links{font-size:11px}.settings-layout{display:block}.settings-nav{flex-direction:row;overflow:auto;gap:5px;margin-bottom:20px}.settings-nav button{white-space:nowrap;min-height:44px}.kitchen-main{padding:22px 16px}.kitchen-summary{flex-wrap:wrap;gap:15px}.kitchen-counters{gap:18px}.kitchen-counters strong{font-size:21px}.kitchen-counters span{font-size:10px}.kanban{grid-template-columns:1fr}.kitchen-ticket{padding:23px}.ticket-items li{font-size:17px}.ticket-number{font-size:28px}.kitchen-ticket .button{min-height:56px}.kanban-column{margin-bottom:14px}.calendar{gap:3px}.calendar-cell{min-height:90px;padding:5px;font-size:10px}.shift-block{font-size:8px;padding:3px}.calendar-day-name{font-size:10px;padding:8px 0}.calendar-head h2{font-size:15px}.calendar-head{gap:8px}.calendar-head .button{font-size:10px;padding:8px 12px}.seat-grid{grid-template-columns:repeat(2,1fr);gap:12px}.seat{padding:19px;min-height:130px}.seat strong{font-size:24px}.legal{padding:25px 23px}.legal h1{font-size:28px}.legal p,.legal li{font-size:12px}.tracking-summary strong{font-size:34px}.cart-body{padding-bottom:170px}.cart-checkout{padding:16px 21px max(16px,env(safe-area-inset-bottom));gap:16px}.cart-checkout .button{min-height:48px}.cart-checkout strong{font-size:21px}.empty-state{margin:45px auto;padding:25px 22px}.empty-state h1{font-size:28px}.restaurant-row{grid-template-columns:60px minmax(0,1fr) auto;gap:12px}.restaurant-mark{height:60px;width:60px;font-size:22px;border-radius:15px}.restaurant-row h3{font-size:14px}.restaurant-row p{font-size:10px}.sample.hide-mobile{display:none}.state-control{bottom:7px;right:7px}.state-control button{padding:4px 6px;font-size:8px}.field-grid{display:block}.field-grid .field{width:100%}}
@media(prefers-reduced-motion:reduce){*,*:before,*:after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
`;

function header(page) {
  const app = APPS[page.app];
  return `<header class="app-header"><div class="wordmark"><button class="header-menu" aria-label="開啟選單" data-menu>${svg("menu")}</button><span class="mark">M</span>MakanMasak<small>${esc(app.short)}</small></div><div class="header-actions"><span class="sample">範例資料</span><button class="subtle" data-demo="語言選擇">繁體中文</button>${page.app === "customer-app" || page.app === "onboarding-app" ? "" : '<span class="avatar" aria-label="示範使用者">林</span>'}</div></header>`;
}
function sidebar(page) {
  return `<aside class="app-sidebar">${APPS[page.app].nav.map(([label, leaf], index) => `<button class="${pageLeaf(page) === leaf ? "active" : ""}" data-nav="${leaf}">${svg(["grid", "bag", "document", "users", "chart", "gear"][index % 6], 17)}${esc(label)}</button>`).join("")}<div class="sidebar-bottom">MakanMasak<br/>本機設計提案</div></aside>`;
}
function heading(page, action = true) {
  return `<div class="page-heading"><div><h1>${esc(page.proposal.title || page.title)}</h1><p>${esc(page.proposal.subtitle || page.purpose)}</p></div>${action && page.proposal.primaryAction ? `<div class="heading-actions">${button(page.proposal.primaryAction, `data-demo="${esc(page.proposal.primaryAction)}"`)}</div>` : ""}</div>`;
}
function tabs(labels, attribute = "data-tab") {
  return `<div class="tabs" role="tablist">${labels.map((label, index) => `<button role="tab" aria-selected="${index === 0}" ${attribute}="${index}">${esc(label)}</button>`).join("")}</div>`;
}
function stats(items) {
  return `<dl class="stats-strip">${items.map(([label, value, note]) => `<div class="stat"><dt>${esc(label)}</dt><dd>${esc(value)}</dd><small>${esc(note || "範例資料")}</small></div>`).join("")}</dl>`;
}
function barChart(title = "營業額趨勢") {
  const values = [38, 61, 48, 79, 55, 92, 73];
  return `<section class="card"><div class="card-head"><h2>${esc(title)}</h2>${badge("最近 7 天", "neutral")}</div><div class="chart-label"><strong>NT$ 32,480</strong><small>範例營業額</small></div><div class="chart" role="img" aria-label="七天範例營業額：週一 3800、週二6100、週三4800、週四7900、週五5500、週六9200、週日7300"><span class="sr-only"></span>${values.map((value, i) => `<div class="chart-bar ${i === 6 ? "today" : ""}" style="height:${value}%"><span>${["週一", "週二", "週三", "週四", "週五", "週六", "週日"][i]}</span></div>`).join("")}</div><p class="section-note">精確數值與比較區間保留在圖表旁，閱讀不只依賴顏色。</p></section>`;
}
function sectionCards(page) {
  return sections(page).map((section) => `<section class="card"><div class="card-head"><h2>${esc(section.title)}</h2></div><dl class="metric-list">${(section.content || []).map((text, index) => `<div><dt>${esc(text)}</dt><dd>${index % 2 ? badge("範例", "neutral") : '<button class="row-action" data-demo="檢視內容">檢視</button>'}</dd></div>`).join("")}</dl></section>`).join("");
}
function dashboard(page) {
  const portal = page.app === "management-portal";
  const figures = portal ? [["租戶總數", "24", "範例租戶"], ["服務正常", "23", "依目前狀態分類"], ["待處理部署", "2", "範例部署"], ["需要關注", "1", "先處理異常"]] : [["今日營業額", "NT$ 32,480", "範例資料 · 今日"], ["進行中訂單", "12", "待接單 4 · 製作中 8"], ["已完成訂單", "68", "範例資料 · 今日"], ["平均客單價", "NT$ 478", "依已完成訂單計算"]];
  return `${heading(page, false)}${stats(figures)}<div class="two-col"><div class="stack">${portal ? healthPanel() : barChart()}<section class="card"><div class="card-head"><h2>${portal ? "最近部署" : "需要處理的訂單"}</h2><button class="link" data-nav="${portal ? "DeploymentsView" : "OrdersView"}">查看全部</button></div>${portal ? sampleTable(page, ["租戶", "版本", "狀態", "時間"], [["示範餐廳 A", "v2.1.0", "部署中", "14:32"], ["示範餐廳 B", "v2.0.9", "已完成", "14:18"]]) : ordersTable(page, true)}</section></div><div class="stack"><section class="card"><div class="card-head"><h2>優先處理</h2>${badge(portal ? "1 項" : "3 項", "orange")}</div>${[[portal ? "一個服務需要確認" : "新訂單尚未接單", portal ? "查看服務狀態與最後檢查時間" : "#1042 · A03 桌 · 已等候 8 分鐘"], [portal ? "檢查部署佇列" : "查看餐點供應狀態", portal ? "示範餐廳 A · 等待部署" : "菜單管理與餐點庫存"]].map(([title, description]) => `<div class="task-row"><div><p>${esc(title)}</p><small>${esc(description)}</small></div><button class="icon-button" data-nav="${portal ? "HealthView" : "OrdersView"}" aria-label="${esc(title)}">${svg("arrow", 17)}</button></div>`).join("")}</section><section class="card"><h2>${portal ? "平台資訊" : "營業中"}</h2><dl class="metric-list"><div><dt>${portal ? "資料來源" : "示範餐廳"}</dt><dd>${portal ? "本機範例" : "A 店"}</dd></div><div><dt>顯示資料</dt><dd>設計預覽</dd></div><div><dt>連線狀態</dt><dd>${badge("示意", "neutral")}</dd></div></dl></section></div></div>${sections(page).length ? `<div class="stack" style="margin-top:20px">${sectionCards(page)}</div>` : ""}`;
}
function sampleTable(page, columns, rows) {
  return `<div class="table-scroll"><table><thead><tr>${columns.map((column) => `<th scope="col">${esc(column)}</th>`).join("")}<th scope="col">操作</th></tr></thead><tbody>${rows.map((row, index) => `<tr data-record="${esc(row.join(" "))}">${columns.map((_, columnIndex) => `<td>${columnIndex === columns.length - 2 && /狀態|情況/.test(columns[columnIndex]) ? badge(row[columnIndex] || "示範", index % 2 ? "green" : "blue") : esc(row[columnIndex] ?? "—")}</td>`).join("")}<td><button class="row-action" data-detail="${esc(row[0])}">查看</button></td></tr>`).join("")}</tbody></table></div>`;
}
function ordersTable(page, compact = false) {
  const columns = compact ? ["訂單", "桌號", "狀態", "金額"] : ["訂單編號", "用餐方式", "餐點", "狀態", "金額", "建立時間"];
  const rows = compact ? [["#1042", "A03", "待接單", "NT$ 580"], ["#1041", "B02", "製作中", "NT$ 320"], ["#1040", "外帶", "已完成", "NT$ 450"]] : [["#1042", "內用 · A03", "3 份餐點", "待接單", "NT$ 580", "14:32"], ["#1041", "內用 · B02", "2 份餐點", "製作中", "NT$ 320", "14:28"], ["#1040", "外帶", "4 份餐點", "已完成", "NT$ 450", "14:20"], ["#1039", "內用 · A01", "2 份餐點", "已完成", "NT$ 290", "14:15"], ["#1038", "外帶", "1 份餐點", "待接單", "NT$ 160", "14:12"]];
  return sampleTable(page, columns, rows);
}
function orders(page) {
  return `${heading(page)}${stats([["待接單", "4", "優先確認新訂單"], ["製作中", "8", "廚房正在準備"], ["已完成", "68", "範例資料 · 今日"], ["已取消", "2", "範例資料 · 今日"]])}<section class="card">${tabs(["全部訂單", "待接單", "製作中", "已完成"])}<div class="filters"><label class="search-field">${svg("search", 17)}<input type="search" aria-label="搜尋訂單" placeholder="搜尋訂單編號或桌號" data-filter /></label><select aria-label="用餐方式"><option>所有用餐方式</option><option>內用</option><option>外帶</option></select><input type="date" aria-label="訂單日期" value="2026-11-11" /></div>${ordersTable(page)}<div class="table-footer"><span data-result-count>範例訂單，共 5 筆</span><div><button aria-label="上一頁" data-demo="上一頁">←</button>　1　<button aria-label="下一頁" data-demo="下一頁">→</button></div></div></section>`;
}
function generalList(page) {
  const sourceColumns = page.proposal.columns || [];
  const columns = sourceColumns.length ? sourceColumns.slice(0, 6) : ["名稱", "狀態", "更新時間"];
  const labels = contentValues(page);
  const names = [labels[0] || page.title, labels[1] || "範例項目 B", labels[2] || "範例項目 C", labels[3] || "範例項目 D"];
  const rows = names.map((name, rowIndex) => columns.map((column, colIndex) => {
    if (colIndex === 0) return name;
    if (/狀態|啟用/.test(column)) return rowIndex === 1 ? "待確認" : "已啟用";
    if (/日期|時間|更新/.test(column)) return "2026/11/11";
    if (/金額|價格|費用|營業額/.test(column)) return `NT$ ${[580, 320, 450, 290][rowIndex]}`;
    if (/數|量|人|容量/.test(column)) return String([12, 8, 24, 6][rowIndex]);
    if (/email|郵件|信箱/i.test(column)) return "demo@example.test";
    return "範例資料";
  }));
  return `${heading(page)}<section class="card">${tabs(sections(page).slice(0, 4).map((section) => section.title).length > 1 ? sections(page).slice(0, 4).map((section) => section.title) : ["全部資料", "需要關注"])}<div class="filters"><label class="search-field">${svg("search", 17)}<input type="search" aria-label="搜尋${esc(page.title)}" placeholder="輸入名稱或關鍵字" data-filter /></label><select aria-label="狀態篩選"><option>所有狀態</option><option>已啟用</option><option>待確認</option></select></div>${sampleTable(page, columns, rows)}<div class="table-footer"><span data-result-count>範例資料，共 4 筆</span><span>每頁 10 筆</span></div></section><div class="stack" style="margin-top:20px">${sectionCards(page)}</div>`;
}
function customerHome(page) {
  return `<div class="home-welcome"><h1>歡迎來到<br/>MakanMasak</h1><p>掃描桌上 QR Code，<br/>從這裡開始點餐。</p></div><section class="scan-panel"><div class="scan-graphic">${svg("scan", 116)}</div><h2>掃一下，開始點餐。</h2><p>掃描餐廳桌上的 QR Code，<br/>查看菜單與訂單進度。</p>${button("掃描 QR Code", 'data-nav="QRScanView"')}</section><div class="home-alternatives"><button class="choice" data-detail="手動輸入餐廳與桌號">${svg("document", 24)}<strong>手動輸入</strong><small>輸入餐廳與桌號</small></button><button class="choice" data-nav="DiscoveryView">${svg("pin", 24)}<strong>探索美食</strong><small>看看附近的餐廳與服務</small></button></div><button class="profile-link" data-nav="MarketsView"><span>${svg("pin")}夜市與商圈</span>${svg("arrow", 17)}</button>`;
}
function discovery(page) {
  const leaf = pageLeaf(page);
  const market = /Market/.test(leaf);
  return `${heading(page, false)}<label class="search-field" style="background:white">${svg("search", 18)}<input type="search" placeholder="${market ? "搜尋夜市或商圈" : "想吃什麼？搜尋餐點或店家"}" aria-label="搜尋" data-filter /></label><div class="chip-row">${["全部", "餐飲", "服務", "營業中"].map((label, index) => `<button class="chip" aria-pressed="${index === 0}" data-chip>${label}</button>`).join("")}</div><section class="card"><div class="card-head"><h2>${market ? "夜市與商圈" : "探索附近"}</h2>${badge("範例店家", "neutral")}</div>${(market ? [["示範夜市", "夜市攤位與服務", "夜"], ["示範商圈", "商圈餐廳與服務", "街"], ["示範市集", "查看市場店家", "市"]] : [["示範餐廳 A", "餐飲 · 可外帶", "A"], ["示範餐廳 B", "餐飲 · 可內用", "B"], ["示範店家 C", "生活服務 · 可預約", "C"]]).map(([name, description, mark]) => `<article class="restaurant-row" data-record="${name} ${description}"><div class="restaurant-mark">${mark}</div><div><h3>${name}</h3><p>${description}</p>${badge("範例資料", "neutral")}</div><button class="icon-button" data-nav="${market ? "MarketDetailView" : "ShopMenuView"}" aria-label="查看${name}">${svg("arrow", 17)}</button></article>`).join("")}</section><div class="stack" style="margin-top:20px">${sectionCards(page)}</div>`;
}
const DISHES = [["招牌雞肉飯", "雞肉、時蔬，附例湯", 160], ["季節蔬菜", "當季時蔬，清爽配菜", 90], ["紅茶", "冰飲，甜度可調整", 50]];
function menuPage(page) {
  return `<button class="back-link" data-nav="DiscoveryView">${svg("back", 16)}返回探索</button><section class="menu-hero"><h1>示範餐廳</h1>${badge("內用 · A03 桌", "blue")}<p>${esc(page.proposal.subtitle || page.purpose)}</p></section><div class="chip-row">${["全部餐點", "主餐", "配菜", "飲品"].map((label, i) => `<button class="chip" aria-pressed="${i === 0}" data-menu-chip="${i}">${label}</button>`).join("")}</div><section class="card"><div class="card-head"><h2>${esc(sections(page)[0]?.title || "餐點菜單")}</h2><small>範例菜色</small></div>${DISHES.map(([name, description, price], i) => `<article class="dish" data-dish="${i}"><div class="dish-body"><h3>${name}</h3><p>${description}</p><strong>NT$ ${price}</strong></div><button class="dish-add" data-add="${price}" data-add-name="${name}" aria-label="加入${name}">${svg("plus")}</button></article>`).join("")}</section><div class="stack" style="margin-top:20px">${sectionCards(page)}</div><button class="floating-cart" data-nav="CartView"><span data-cart-count>查看購物車 · 0 份</span><span data-cart-total>NT$ 0　→</span></button>`;
}
function cart(page) {
  const items = previewCart ?? DISHES.slice(0, 2).map(([name, description, price], i) => ({name, description, price, quantity: i ? 1 : 2}));
  const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  return `<div class="cart-body">${heading(page, false)}<div class="notice">${svg("info", 18)}<span>示範餐廳 · 內用 A03 桌<br/>請確認餐點與數量，再送出訂單。</span></div><section class="card" style="margin-top:20px"><h2>你的餐點</h2>${items.map(({name, description, price, quantity}, i) => `<div class="cart-line" data-index="${i}" data-price="${price}"><div><p>${name}</p><small>${description}</small><div class="stepper"><button data-step="-1" aria-label="減少${name}">${svg("minus", 16)}</button><span data-quantity>${quantity}</span><button data-step="1" aria-label="增加${name}">${svg("plus", 16)}</button></div></div><strong data-line-total>NT$ ${price * quantity}</strong></div>`).join("")}</section><section class="card" style="margin-top:20px"><h2 style="margin-bottom:20px">訂單備註</h2><label class="field"><span>需要留意的地方（選填）</span><textarea placeholder="例如：不要香菜"></textarea></label><label class="field"><span>優惠碼（選填）</span><input type="text" placeholder="輸入優惠碼" /></label><div class="receipt-row"><span>餐點小計</span><span data-subtotal>NT$ ${total}</span></div><div class="receipt-row total"><span>合計</span><span data-grandtotal>NT$ ${total}</span></div></section></div><div class="cart-checkout"><div><small>訂單合計</small><strong data-checkout-total>NT$ ${total}</strong></div>${button("確認送出訂單", 'data-submit-order')}</div>`;
}
function tracking(page) {
  const application = page.app === "onboarding-app";
  return `${heading(page, false)}<section class="card"><div class="tracking-summary"><div><strong>${application ? "審核中" : "製作中"}</strong><small>${application ? "申請編號 DEMO-001" : "訂單 #1042 · A03 桌"}</small></div>${badge(application ? "已收到申請" : "廚房已接單", "blue")}</div><p class="muted" style="font-size:12px;line-height:1.9">${application ? "我們已收到你的申請資料，可在這裡查看審核進度。" : "你的餐點正在準備，完成後會更新訂單狀態。"}</p><ol class="timeline">${(application ? [["申請已送出", "已收到申請資料"], ["團隊審核中", "請留意申請時填寫的 Email"], ["系統開通", "審核通過後由團隊聯繫"]] : [["訂單已確認", "14:32 · 訂單已送至廚房"], ["正在製作", "14:35 · 廚房開始準備餐點"], ["餐點準備完成", "完成後會更新狀態"]]).map(([title, description], i) => `<li class="${i === 0 ? "done" : i === 1 ? "current" : ""}"><span class="step-dot">${svg(i === 0 ? "check" : "clock", 16)}</span><div><h3>${title}</h3><p>${description}</p></div></li>`).join("")}</ol></section><div class="stack" style="margin-top:20px">${sectionCards(page)}</div>`;
}
function queue(page) {
  const leaf = pageLeaf(page);
  if (/Join/.test(leaf)) return `${heading(page, false)}<form class="card" data-preview-form>${field("用餐人數", "number", "2", 'min="1" max="30" required')}${field("聯絡電話", "tel", "", 'autocomplete="tel" required')}<p class="form-help" style="margin-bottom:20px">請確認人數與電話，以便店家通知候位進度。</p><button class="button full-width" type="submit">加入候位${svg("arrow", 16)}</button><p class="form-success" role="status"></p></form>`;
  return `${heading(page, false)}<section class="card"><div class="queue-display">${badge("候位中", "orange")}<div class="queue-number">A028</div><p>示範餐廳 · 2 位用餐</p><div class="receipt-row"><span>前面等候組數</span><strong>4 組</strong></div><div class="receipt-row"><span>狀態更新</span><strong>範例資料</strong></div></div><div class="notice">${svg("info", 17)}<span>請留意店家叫號；實際入座依現場安排。</span></div><button class="button secondary full-width" style="margin-top:22px" data-demo="更新候位狀態">更新候位狀態</button><button class="link full-width" data-detail="取消候位確認">取消候位</button></section>`;
}
function auth(page) {
  const leaf = pageLeaf(page);
  const register = leaf === "RegisterView";
  const reset = /Reset/.test(leaf);
  const forgot = /Forgot|FindApplication/.test(leaf);
  const verify = /VerifyEmail/.test(leaf);
  const customer = page.app === "customer-app";
  const labels = register ? [["姓名", "text"], ["手機號碼", "tel"], ["Email", "email"], ["設定密碼", "password"]] : reset ? [["新密碼", "password"], ["再次輸入新密碼", "password"]] : forgot ? [["Email", "email"]] : verify ? [["Email", "email"]] : customer ? [["手機號碼", "tel"]] : [["帳號", "text"], ["密碼", "password"]];
  return `<div class="auth-wrap"><div class="auth-story"><h1>${customer ? "你的下一餐，<br/>從這裡開始。" : page.app === "kitchen-display" ? "掌握每一單，<br/>專注每一道。" : "每一天的營運，<br/>清楚在掌握。"}</h1><p>${esc(page.purpose)}</p><div class="auth-illustration">${svg(customer ? "bag" : "grid", 42)}<div><strong>${esc(APPS[page.app].title)}</strong><small>MakanMasak · 本機設計提案</small></div></div></div><form class="auth-form" data-preview-form><h2>${esc(page.proposal.title || page.title)}</h2><p>${esc(page.proposal.subtitle || page.purpose)}</p>${customer && !register && !forgot && !reset && !verify ? tabs(["簡訊驗證碼", "密碼登入"], "data-auth-tab") : ""}${labels.map(([label, type]) => field(label, type, "", `required autocomplete="${type === "password" ? reset || register ? "new-password" : "current-password" : type === "tel" ? "tel" : type === "email" ? "email" : "username"}"`)).join("")}<div data-password-field hidden>${field("密碼", "password", "", 'autocomplete="current-password"')}</div><button class="button" type="submit">${esc(page.proposal.primaryAction || (forgot ? "寄送重設連結" : reset ? "更新密碼" : customer && !register ? "取得驗證碼" : "登入"))}${svg("arrow", 16)}</button><p class="form-success" role="status"></p><div class="auth-links"><button class="link" type="button" data-nav="${forgot ? "LoginView" : "ForgotPasswordView"}">${forgot ? "返回登入" : "忘記密碼？"}</button><button class="link" type="button" data-nav="${customer ? register ? "LoginView" : "RegisterView" : "HomeView"}">${customer ? register ? "已有帳號？登入" : "還沒有帳號？註冊" : "返回首頁"}</button></div></form></div>`;
}
function onboardingHome(page) {
  return `<div class="onboarding-main"><section class="onboarding-hero"><div><h1>為您的餐廳打造<br/><span>專屬管理系統。</span></h1><p>平台代管 · 資料安全 · 專人審核開通<br/>從客人點餐，到廚房出餐，<br/>讓每一個環節，都清楚接上。</p><div class="hero-links">${button("立即申請", 'data-nav="ApplyView"')}<button class="link" data-scroll="tour">看看怎麼運作</button></div><button class="link" data-nav="FindApplicationView" style="margin-top:12px">找回申請狀態連結</button></div><div class="demo-device"><div class="demo-top"><strong>示範餐廳 · 營運總覽</strong>${badge("範例資料", "neutral")}</div><small>今日營業額</small><div class="mini-total">NT$ 32,480</div><div class="chart" style="height:135px;gap:15px">${[35, 58, 44, 78, 63, 91, 73].map((value, index) => `<div class="chart-bar ${index === 6 ? "today" : ""}" style="height:${value}%"></div>`).join("")}</div><div class="mini-orders"><div class="task-row"><div><p>#1042 · A03 桌</p><small>雞肉飯 ×2 · 季節蔬菜 ×1</small></div>${badge("製作中", "blue")}</div><div class="task-row"><div><p>#1041 · 外帶</p><small>訂單狀態一目了然</small></div>${badge("已完成", "green")}</div></div></div></section><section id="tour"><h2>從點餐到出餐，一次看懂。</h2><p class="section-note">顧客、廚房與餐廳後台，各自清楚，也彼此相連。</p><div class="journey">${[["scan", "客人掃碼點餐", "掃描桌上的 QR Code，開啟菜單與點餐。"], ["bag", "廚房即時收單", "待處理、製作中、準備完成，清楚排列。"], ["clock", "客人看得到進度", "在手機上查看訂單準備狀態。"], ["chart", "老闆掌握營運", "查看營業額、訂單與營運狀況。"]].map(([icon, title, description]) => `<div>${svg(icon, 27)}<h3>${title}</h3><p>${description}</p></div>`).join("")}</div></section><div class="notice" style="margin-top:45px">${svg("info", 19)}<span>填寫申請資料後，平台團隊會進行審核並與您聯繫。</span></div></div>`;
}
function applicationForm(page) {
  return `<div class="onboarding-form-wrap"><div class="onboarding-progress"><div class="active"><span>1</span>填寫申請</div><span style="background:none;color:var(--muted)">→</span><div>2　團隊審核</div><span style="background:none;color:var(--muted)">→</span><div>3　開通系統</div></div>${heading(page, false)}<form data-preview-form><section class="form-section"><h2>店家與聯絡資料</h2><div class="equal-cols">${field("餐廳名稱", "text", "", 'required placeholder="例如：御膳房" autocomplete="organization"')}${field("聯絡人姓名", "text", "", 'required autocomplete="name"')}</div><div class="equal-cols">${field("Email", "email", "", 'required autocomplete="email"')}${field("聯絡電話", "tel", "", 'required autocomplete="tel"')}</div><p class="form-help">審核與開通訊息會寄到此 Email，請確認可以正常收信。</p></section><section class="form-section"><h2>營業資訊</h2><div class="equal-cols"><label class="field"><span>營業地區</span><select required><option value="">請選擇地區</option>台灣</option>馬來西亞</option><option>其他地區</option></select></label>${field("店家地址", "text", "", 'required autocomplete="street-address"')}</div><label class="field"><span>補充說明（選填）</span><textarea placeholder="告訴我們你的店家與使用需求"></textarea></label></section><div class="form-actions"><label class="checks"><input type="checkbox" required /><span>我已閱讀並同意申請相關條款與資料處理說明。</span></label><button class="button" type="submit">提交申請${svg("arrow", 17)}</button></div><p class="form-success" role="status"></p></form></div>`;
}
function kitchen(page) {
  const ticket = (id, table, items, time, stage, urgent = false) => `<article class="kitchen-ticket" data-ticket><div class="ticket-top"><strong class="ticket-number">#${id}</strong><span class="ticket-timer ${urgent ? "urgent" : ""}">${time}</span></div><div class="ticket-meta">${badge(table, "neutral")}<small>${stage === 0 ? "待處理" : stage === 1 ? "製作中" : "準備完成"}</small></div><ul class="ticket-items">${items.map(([quantity, name]) => `<li><strong>${quantity}</strong><span>${name}</span></li>`).join("")}</ul>${urgent ? '<p class="ticket-note">備註：不要香菜</p>' : ""}<button class="button ${stage === 1 ? "green" : stage === 2 ? "soft" : ""}" data-move-ticket="${stage}">${stage === 0 ? "開始製作" : stage === 1 ? "標記完成" : "確認出餐"}${svg(stage === 0 ? "arrow" : "check", 18)}</button></article>`;
  return `<div class="kitchen-summary"><div><h1>訂單看板</h1><p class="section-note"><span class="status-dot"></span>示範餐廳 · 範例資料 · 最新狀態</p></div><div class="kitchen-counters"><span><strong>3</strong>待處理</span><span><strong>2</strong>製作中</span><span><strong>1</strong>已完成</span></div></div><div class="kanban"><section class="kanban-column" data-column="0"><div class="kanban-heading"><h2>待處理</h2><span class="kanban-count">3</span></div>${ticket(1042, "A03 桌", [[2, "招牌雞肉飯"], [1, "季節蔬菜"]], "08:24", 0, true)}${ticket(1043, "外帶", [[1, "招牌雞肉飯"], [1, "紅茶"]], "03:12", 0)}${ticket(1044, "B01 桌", [[2, "季節蔬菜"]], "01:45", 0)}</section><section class="kanban-column" data-column="1"><div class="kanban-heading"><h2>製作中</h2><span class="kanban-count">2</span></div>${ticket(1040, "A01 桌", [[3, "招牌雞肉飯"], [2, "紅茶"]], "06:18", 1)}${ticket(1041, "B02 桌", [[1, "招牌雞肉飯"]], "04:09", 1)}</section><section class="kanban-column" data-column="2"><div class="kanban-heading"><h2>準備完成</h2><span class="kanban-count">1</span></div>${ticket(1039, "外帶", [[2, "招牌雞肉飯"], [1, "季節蔬菜"]], "02:03", 2)}<p class="section-note">請確認餐點與桌號，再完成出餐。</p></section></div>`;
}
function settings(page) {
  const items = sections(page).length ? sections(page) : [{ title: "基本設定", content: ["顯示設定", "通知設定"] }, { title: "通知設定", content: ["訂單通知", "提示音"] }];
  return `${heading(page, false)}<div class="settings-layout"><div class="settings-nav" role="tablist" aria-label="設定分類">${items.map((section, i) => `<button role="tab" aria-selected="${i === 0}" data-settings-tab="${i}">${esc(section.title)}</button>`).join("")}</div><form class="card" data-preview-form><h2 data-setting-title>${esc(items[0].title)}</h2><p class="section-note" style="margin-bottom:20px">更改完成後儲存。此處僅示範顯示與操作。</p><div data-settings-fields>${settingsFields(items[0])}</div><div class="form-actions"><small>僅套用於本機預覽</small><button type="submit" class="button">儲存設定${svg("check", 16)}</button></div><p class="form-success" role="status"></p></form></div>`;
}
function settingsFields(section) {
  return (section.content || []).map((text, i) => /啟用|通知|聲|音|自動|顯示|連線|切換/.test(text) ? `<div class="toggle-row"><div><h3>${esc(text)}</h3><p>依照實際工作環境調整。</p></div><button type="button" class="switch" role="switch" aria-label="${esc(text)}" aria-checked="${i % 2 === 0}"><span class="switch-track"></span></button></div>` : field(text, /密碼/.test(text) ? "password" : "text", "", 'placeholder="請輸入設定值"')).join("");
}
function schedule(page) {
  return `${heading(page)}<section class="card"><div class="calendar-head"><h2>2026 年 11 月</h2><div><button class="icon-button" aria-label="上個月" data-demo="上個月">${svg("back", 17)}</button><button class="button soft" data-demo="回到今天">今天</button><button class="icon-button" aria-label="下個月" data-demo="下個月">${svg("arrow", 17)}</button></div></div><div class="calendar">${["一", "二", "三", "四", "五", "六", "日"].map((day) => `<div class="calendar-day-name">${day}</div>`).join("")}${Array.from({ length: 28 }, (_, i) => `<div class="calendar-cell ${i === 10 ? "today" : ""}">${i + 1}${[1, 3, 5, 8, 10, 12, 15, 17, 19, 22, 24, 26].includes(i) ? `<span class="shift-block">${i % 2 ? "早班" : "晚班"}<br/>${i % 2 ? "09:00–17:00" : "14:00–22:00"}</span>` : ""}</div>`).join("")}</div><p class="section-note">班表為範例資料；手機保留完整星期與班別標籤。</p></section><div class="stack" style="margin-top:20px">${sectionCards(page)}</div>`;
}
function profile(page) {
  return `<div class="profile-head"><div class="profile-avatar">林</div><div><h1>個人中心</h1><p>管理你的資料與用餐紀錄</p></div></div><section class="card">${[["bag", "我的訂單", "OrderHistoryView"], ["users", "個人資料", "ProfileView"], ["clock", "候位紀錄", "WaitingListHistoryView"], ["pin", "追蹤店家", "DiscoveryView"]].map(([icon, label, nav]) => `<button class="profile-link" data-nav="${nav}"><span>${svg(icon)}${label}</span>${svg("arrow", 17)}</button>`).join("")}</section><div class="stack" style="margin-top:20px">${sectionCards(page)}</div><button class="button secondary full-width" style="margin-top:20px" data-demo="登出">登出</button>`;
}
function healthPanel() {
  return `<section class="card"><div class="card-head"><h2>服務健康狀態</h2>${badge("範例監控", "neutral")}</div><div class="status-list">${[["API 服務", "範例狀態 · 回應 124 ms", "正常", "green"], ["即時通訊", "範例狀態 · 連線正常", "正常", "green"], ["影像處理", "範例狀態 · 需要檢查", "注意", "orange"]].map(([name, detail, status, tone]) => `<div class="health-service"><div><strong>${name}</strong><small>${detail}</small></div>${badge(status, tone)}</div>`).join("")}</div><div class="health-bars" role="img" aria-label="最近監控範例：大部分正常，兩個時段需注意">${Array.from({ length: 36 }, (_, i) => `<i class="${i === 22 || i === 23 ? "warn" : ""}"></i>`).join("")}</div><div class="table-footer"><span>最近 24 小時</span><span>現在</span></div></section>`;
}
function health(page) {
  return `${heading(page)}<div class="notice warning" style="margin-bottom:24px">${svg("info", 19)}<span>先確認異常，再檢查影響範圍。以下為示範狀態，非正式平台監控資料。</span></div>${healthPanel()}<div class="stack" style="margin-top:20px">${sectionCards(page)}</div>`;
}
function billing(page) {
  return `${heading(page)}<div class="two-col"><section class="card"><div class="card-head"><h2>本期帳務</h2>${badge("範例帳務", "neutral")}</div><p class="section-note">2026 年 11 月</p><div class="invoice-total">NT$ 2,480</div><dl class="metric-list"><div><dt>帳單狀態</dt><dd>${badge("待付款", "orange")}</dd></div><div><dt>付款期限</dt><dd>2026/11/30</dd></div></dl><button class="button" style="margin-top:24px" data-detail="帳務明細">查看帳務明細${svg("arrow", 16)}</button></section><section class="card"><h2>使用情況</h2><div class="receipt-row" style="margin-top:30px"><span>本期訂單</span><strong>620 / 1,000</strong></div><div class="progress-track"><span></span></div><p class="section-note">範例方案與用量；實際權限與費用依正式訂閱。</p></section></div><div class="stack" style="margin-top:20px">${sectionCards(page)}</div>`;
}
function seating(page) {
  return `${heading(page)}${tabs(["桌位總覽", "預約", "候位"])}<section class="card"><div class="card-head"><h2>桌位狀態</h2><div>${badge("使用中", "blue")} ${badge("空桌", "neutral")}</div></div><div class="seat-grid">${["A01", "A02", "A03", "A04", "B01", "B02", "B03", "B04"].map((table, i) => `<button class="seat ${[0, 2, 5].includes(i) ? "occupied" : ""}" data-detail="桌位 ${table}"><strong>${table}</strong><small>${[0, 2, 5].includes(i) ? "使用中 · 4 人桌" : "空桌 · 4 人桌"}</small></button>`).join("")}</div></section><div class="stack" style="margin-top:20px">${sectionCards(page)}</div>`;
}
function legal(page) {
  return `<article class="legal">${heading(page, false)}<div class="legal-toc">${sections(page).map((section, i) => `<a href="#legal-${i}">${esc(section.title)}</a>`).join("")}</div><p>以下展示閱讀層級與段落編排；正式條文於實作時保留原文，不以本提案內容替換。</p>${sections(page).map((section, i) => `<section id="legal-${i}"><h2>${esc(section.title)}</h2>${(section.content || []).map((text) => `<p>${esc(text)}</p>`).join("")}</section>`).join("")}</article>`;
}
function errorPage(page) {
  const success = /SuccessView/.test(page.file);
  const scan = /QRScan/.test(page.file);
  const signed = /SignedOrder/.test(page.file);
  return `<section class="empty-state"><div class="empty-icon">${svg(success ? "check" : scan ? "scan" : "info", 32)}</div><h1>${esc(page.proposal.title || page.title)}</h1><p>${esc(page.proposal.subtitle || page.purpose)}</p>${scan ? '<div style="height:220px;background:var(--ink);color:white;border-radius:20px;display:grid;place-items:center;margin:25px 0">相機掃碼區域 · 預覽不啟用相機</div>' : ""}${success ? '<div class="notice" style="text-align:left;margin-bottom:25px">申請狀態與通知以正式系統提供的資訊為準。此處示範成功頁的資訊層級。</div>' : ""}${button(page.proposal.primaryAction || "返回首頁", `data-nav="${success ? "ApplicationStatusView" : signed ? "HomeView" : scan ? "HomeView" : "HomeView"}"`)}${sections(page).length ? `<div style="text-align:left;margin-top:30px">${sections(page).map((section) => `<h3 style="margin:20px 0 8px">${esc(section.title)}</h3><p style="font-size:12px;margin:0">${esc((section.content || []).join(" · "))}</p>`).join("")}</div>` : ""}</section>`;
}
function formPage(page) {
  const items = contentValues(page).slice(0, 10);
  return `${heading(page, false)}<form class="card" style="max-width:760px" data-preview-form>${sections(page).map((section, i) => `<section style="margin-bottom:25px"><h2 style="font-size:17px;margin-bottom:22px">${esc(section.title)}</h2>${(section.content || []).map((text) => /說明|提示|注意|規則|狀態/.test(text) ? `<p class="form-help" style="margin-bottom:18px">${esc(text)}</p>` : field(text, /日期/.test(text) ? "date" : /時間/.test(text) ? "time" : /email|郵件|信箱/i.test(text) ? "email" : /人數|數量/.test(text) ? "number" : /電話|手機/.test(text) ? "tel" : "text", "", "")).join("")}</section>`).join("")}${!items.length ? field("內容", "text", "") : ""}<div class="form-actions"><span class="form-help">此為介面提案，送出後不會寫入正式資料。</span><button type="submit" class="button">${esc(page.proposal.primaryAction || "確認送出")}${svg("arrow", 16)}</button></div><p class="form-success" role="status"></p></form>`;
}
function pageContent(page) {
  const specialized = specialCustomerPage(page) ?? specialOperationsPage(page);
  if (specialized !== null && specialized !== undefined) return specialized;
  const leaf = pageLeaf(page);
  if (page.kind === "auth" || /^(Login|Register|ForgotPassword|ResetPassword|VerifyEmail|FindApplication)View$/.test(leaf)) return auth(page);
  if (page.app === "onboarding-app" && leaf === "HomeView") return onboardingHome(page);
  if (page.app === "onboarding-app" && leaf === "ApplyView") return applicationForm(page);
  if (/^(Error|NotFound|Unauthorized|QRScan|SignedOrderEntry|Success)View$/.test(leaf) || page.kind === "error") return errorPage(page);
  if (page.kind === "legal" || /^(Terms|Privacy|About)View$/.test(leaf)) return legal(page);
  if (page.app === "customer-app") {
    if (leaf === "HomeView") return customerHome(page);
    if (leaf === "CartView") return cart(page);
    if (/^(Menu|ShopMenu)View$/.test(leaf)) return menuPage(page);
    if (/^(Discovery|Markets|MarketDetail)View$/.test(leaf)) return discovery(page);
    if (leaf === "ProfileView") return profile(page);
    if (/^(OrderTracking|MarketCheckoutTracking)View$/.test(leaf)) return tracking(page);
    if (/JoinWaitingList|MyWaitingTicket/.test(leaf)) return queue(page);
    if (/Reservation|ServiceBooking|GroupOrderJoin/.test(leaf) || page.kind === "form") return formPage(page);
    if (leaf === "OrderTypeLandingView") return `${heading(page, false)}<section class="card"><h2>選擇用餐方式</h2><p class="section-note">確認方式後，再進入菜單。</p><div class="home-alternatives"><button class="choice" data-nav="MenuView">${svg("users", 26)}<strong>內用</strong><small>在店內用餐</small></button><button class="choice" data-nav="ShopMenuView">${svg("bag", 26)}<strong>外帶</strong><small>點餐後到店取餐</small></button></div></section><div class="stack" style="margin-top:20px">${sectionCards(page)}</div>`;
  }
  if (page.app === "onboarding-app" && leaf === "ApplicationStatusView") return tracking(page);
  if (leaf === "EnhancedKitchenDashboard" || (page.app === "admin-dashboard" && leaf === "KitchenView")) return kitchen(page);
  if (/^SettingsView$|AIProviderConfig/.test(leaf) || page.kind === "settings") return settings(page);
  if (/Shifts|Schedule|Scheduling|Attendance/.test(leaf) || page.kind === "schedule") return schedule(page);
  if (/^(DashboardView|OwnerView|PlatformOverview)$/.test(leaf) || page.kind === "dashboard") return dashboard(page);
  if (leaf === "OrdersView") return orders(page);
  if (/HealthView|MonitoringView/.test(leaf)) return health(page);
  if (/BillingView|SubscriptionsView/.test(leaf) || page.kind === "billing") return billing(page);
  if (/TableSetupTab|SeatingManagementView|TableDetailView/.test(leaf)) return seating(page);
  if (page.kind === "analytics") return `${heading(page)}${barChart(sections(page)[0]?.title || page.title)}<div class="stack" style="margin-top:20px">${sectionCards(page)}</div>`;
  if (page.kind === "form") return formPage(page);
  if (page.kind === "detail") return `${heading(page)}<div class="stack">${sectionCards(page)}</div>`;
  return generalList(page);
}

function previewDocument(page) {
  const app = APPS[page.app];
  const special = page.kind === "auth" || /^(Login|Register|ForgotPassword|ResetPassword|VerifyEmail|FindApplication)View$/.test(pageLeaf(page)) || page.app === "onboarding-app";
  const customer = page.app === "customer-app" && !special;
  const kds = pageLeaf(page) === "EnhancedKitchenDashboard";
  const content = pageContent(page);
  const nav = customer && !["MenuView", "ShopMenuView", "CartView"].includes(pageLeaf(page)) ? `<nav class="bottom-nav" aria-label="顧客導覽">${app.nav.slice(0, 4).map(([label, leaf], index) => `<button class="${leaf === pageLeaf(page) ? "active" : ""}" data-nav="${leaf}">${svg(["home", "search", "pin", "bag"][index], 20)}${esc(label)}</button>`).join("")}</nav>` : "";
  const body = special ? `<div id="page-content">${content}</div>` : customer ? `<main class="mobile-main" id="page-content">${content}</main>${nav}` : kds ? `<main class="kitchen-main" id="page-content">${content}</main>` : `<div class="shell">${sidebar(page)}<main class="main" id="page-content">${content}</main></div>`;
  const settingsData = JSON.stringify(sections(page)).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${PREVIEW_CSS}</style></head><body style="--accent:${app.accent};--soft:${app.soft}">${header(page)}${body}<div class="state-control" role="group" aria-label="示意資料狀態"><button data-state="normal" aria-pressed="true">一般</button><button data-state="empty" aria-pressed="false">空狀態</button><button data-state="error" aria-pressed="false">錯誤</button><button data-state="loading" aria-pressed="false">載入</button></div><div class="toast" role="status"></div><dialog id="detail-dialog"><div class="dialog-head"><h2></h2><button class="icon-button" aria-label="關閉詳情" data-close>×</button></div><div class="dialog-copy"></div></dialog><script>const CART_STATE=${JSON.stringify(previewCart || []).replace(/</g, "\\u003c")};const SETTINGS=${settingsData};const ICON_INFO=${JSON.stringify(svg("info", 32))};const ICON_BAG=${JSON.stringify(svg("bag", 32))};const SETTINGS_FIELDS=${settingsFields.toString()};const esc=${esc.toString()};const field=${field.toString()};(${previewInteractions.toString()})();<\/script></body></html>`;
}

function previewInteractions() {
  const initialCounter=document.querySelector("[data-cart-count]");
  const initialTotal=document.querySelector("[data-cart-total]");
  if(initialCounter) initialCounter.textContent=`查看購物車 · ${CART_STATE.reduce((n,i)=>n+i.quantity,0)} 份`;
  if(initialTotal) initialTotal.textContent=`NT$ ${CART_STATE.reduce((n,i)=>n+i.quantity*i.price,0)}　→`;
  let toastTimer;
  let cartItems = [...CART_STATE];
  let cartCount = cartItems.reduce((n, item) => n + item.quantity, 0);
  let cartTotal = cartItems.reduce((n, item) => n + item.quantity * item.price, 0);
  const initialContent = document.querySelector("#page-content").innerHTML;
  const toast = (message) => {
    const el = document.querySelector(".toast");
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 3000);
  };
  const recalculate = () => {
    let total = 0;
    document.querySelectorAll(".cart-line").forEach((line) => {
      const sum = Number(line.dataset.price) * Number(line.querySelector("[data-quantity]").textContent);
      line.querySelector("[data-line-total]").textContent = `NT$ ${sum}`;
      total += sum;
    });
    document.querySelectorAll("[data-subtotal],[data-grandtotal],[data-checkout-total]").forEach((el) => el.textContent = `NT$ ${total}`);
  };
  document.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.specificAuthTab) {
      const mode = button.dataset.specificAuthTab;
      document.querySelectorAll("[data-specific-auth-tab]").forEach((tab) => { tab.setAttribute("aria-selected", String(tab === button)); tab.tabIndex = tab === button ? 0 : -1; });
      document.querySelectorAll("[data-auth-panel]").forEach((panel) => {
        panel.hidden = panel.dataset.authPanel !== mode;
        panel.querySelectorAll("input,fieldset,button").forEach((control) => { control.disabled = panel.hidden; });
      });
    }
    if (button.hasAttribute("data-request-otp")) {
      const panel = button.closest("[data-auth-panel]");
      const phone = panel.querySelector('input[type="tel"]');
      if (!phone.reportValidity()) return;
      panel.querySelector("[data-otp-panel]").hidden = false;
      panel.querySelector("[data-otp-panel] input").required = true;
      toast("驗證碼步驟示意；未發送簡訊。");
    }
    if (button.dataset.bookingSlot || button.dataset.fulfillment) {
      const key = button.dataset.bookingSlot ? "bookingSlot" : "fulfillment";
      const selector = key === "bookingSlot" ? "[data-booking-slot]" : "[data-fulfillment]";
      document.querySelectorAll(selector).forEach((el) => el.setAttribute("aria-pressed", String(el === button)));
      toast(`已選擇：${button.textContent.trim()}`);
    }
    if (button.dataset.marketTab) {
      document.querySelectorAll("[data-market-tab]").forEach((el) => {el.setAttribute("aria-selected", String(el === button));el.tabIndex=el===button?0:-1;});
      document.querySelectorAll("[data-market-panel]").forEach((panel) => panel.hidden = panel.dataset.marketPanel !== button.dataset.marketTab);
    }
    if (button.dataset.nav) parent.postMessage({ type: "review-navigation", leaf: button.dataset.nav }, "*");
    if (button.hasAttribute("data-menu")) document.querySelector(".app-sidebar")?.classList.toggle("open");
    if (button.dataset.demo) toast(`示意操作：${button.dataset.demo}。未寫入正式資料。`);
    if (button.hasAttribute("data-close")) document.querySelector("#detail-dialog").close();
    if (button.dataset.detail) {
      const dialog = document.querySelector("#detail-dialog");
      dialog.querySelector("h2").textContent = button.dataset.detail;
      dialog.querySelector(".dialog-copy").innerHTML = button.dataset.detail.includes("手動輸入") ? '<form data-preview-form><label class="field"><span>餐廳代碼</span><input required></label><label class="field"><span>桌號</span><input required></label><button type="submit" class="button">確認進入菜單</button><p class="form-success" role="status"></p></form>' : '<p>這裡示範詳細資料的閱讀與確認層級。</p><dl class="metric-list"><div><dt>資料來源</dt><dd>本機範例</dd></div><div><dt>操作狀態</dt><dd>尚未寫入正式資料</dd></div></dl><button class="button full-width" style="margin-top:24px" data-close>確認並返回</button>';
      dialog.showModal();
    }
    if (button.matches(".switch")) button.setAttribute("aria-checked", String(button.getAttribute("aria-checked") !== "true"));
    if (button.hasAttribute("data-tab") || button.hasAttribute("data-auth-tab")) {
      button.closest(".tabs").querySelectorAll("button").forEach((el) => el.setAttribute("aria-selected", String(el === button)));
      if (button.hasAttribute("data-auth-tab")) {
        const password = document.querySelector("[data-password-field]");
        password.hidden = button.dataset.authTab === "0";
        password.querySelector("input").required = !password.hidden;
      } else toast(`已選擇${button.textContent}；列表為範例資料。`);
    }
    if (button.hasAttribute("data-settings-tab")) {
      document.querySelectorAll("[data-settings-tab]").forEach((el) => el.setAttribute("aria-selected", String(el === button)));
      const section = SETTINGS[Number(button.dataset.settingsTab)];
      if (section) {
        document.querySelector("[data-setting-title]").textContent = section.title;
        document.querySelector("[data-settings-fields]").innerHTML = SETTINGS_FIELDS(section);
      }
    }
    if (button.hasAttribute("data-chip") || button.hasAttribute("data-menu-chip")) {
      button.closest(".chip-row").querySelectorAll("button").forEach((el) => el.setAttribute("aria-pressed", String(el === button)));
      if (button.hasAttribute("data-menu-chip")) {
        document.querySelectorAll("[data-dish]").forEach((el) => el.hidden = button.dataset.menuChip !== "0" && Number(el.dataset.dish) !== Number(button.dataset.menuChip) - 1);
      } else toast(`篩選：${button.textContent}。顯示範例內容。`);
    }
    if (button.dataset.add) {
      const existing = cartItems.find((item) => item.name === button.dataset.addName);
      if (existing) existing.quantity += 1;
      else cartItems.push({name:button.dataset.addName,description:"範例餐點",price:Number(button.dataset.add),quantity:1});
      parent.postMessage({type:"review-cart",items:cartItems}, "*");
      cartCount += 1;
      cartTotal += Number(button.dataset.add);
      document.querySelector("[data-cart-count]").textContent = `查看購物車 · ${cartCount} 份`;
      document.querySelector("[data-cart-total]").textContent = `NT$ ${cartTotal}　→`;
      toast("已加入範例購物車");
    }
    if (button.dataset.step) {
      const quantity = button.closest(".stepper").querySelector("[data-quantity]");
      quantity.textContent = String(Math.max(0, Number(quantity.textContent) + Number(button.dataset.step)));
      recalculate();
      const changedItems = [...document.querySelectorAll(".cart-line[data-index]")].map((line) => ({name:line.querySelector("p").textContent,description:line.querySelector("small").textContent,price:Number(line.dataset.price),quantity:Number(line.querySelector("[data-quantity]").textContent)}));
      if (changedItems.length) parent.postMessage({type:"review-cart",items:changedItems}, "*");
    }
    if (button.hasAttribute("data-submit-order")) toast("訂單送出示範完成；此預覽不會產生正式訂單。");
    if (button.hasAttribute("data-scroll")) document.getElementById(button.dataset.scroll)?.scrollIntoView({ behavior: "smooth" });
    if (button.hasAttribute("data-move-ticket")) {
      const stage = Number(button.dataset.moveTicket);
      const ticket = button.closest("[data-ticket]");
      const nextColumn = document.querySelector(`[data-column="${stage + 1}"]`);
      if (nextColumn) {
        nextColumn.appendChild(ticket);
        button.dataset.moveTicket = String(stage + 1);
        button.className = `button ${stage === 0 ? "green" : "soft"}`;
        button.textContent = stage === 0 ? "標記完成" : "確認出餐";
        ticket.querySelector(".ticket-meta small").textContent = stage === 0 ? "製作中" : "準備完成";
      } else ticket.remove();
      document.querySelectorAll("[data-column]").forEach((column) => column.querySelector(".kanban-count").textContent = column.querySelectorAll("[data-ticket]").length);
      document.querySelectorAll(".kitchen-counters strong").forEach((counter, index) => counter.textContent = document.querySelector(`[data-column="${index}"]`).querySelectorAll("[data-ticket]").length);
      toast("已更新範例訂單狀態");
    }
    if (button.dataset.state) {
      document.querySelectorAll("[data-state]").forEach((el) => el.setAttribute("aria-pressed", String(el === button)));
      const content = document.querySelector("#page-content");
      const state = button.dataset.state;
      content.innerHTML = state === "normal" ? initialContent : state === "empty" ? `<section class="preview-empty">${ICON_BAG}<h2>目前沒有符合的資料</h2><p>請調整篩選條件，或稍後回來查看。<br/>這是通用空狀態提案。</p><button class="button" data-state="normal">返回一般畫面</button></section>` : state === "error" ? `<section class="preview-error">${ICON_INFO}<h2>暫時無法載入資料</h2><p>連線未完成，請稍後再試。<br/>保留畫面位置，讓你知道如何繼續。</p><button class="button" data-state="normal">重新載入示範內容</button></section>` : '<section class="preview-loading"><h2>正在載入資料</h2><div class="loader" role="progressbar" aria-label="載入中"></div><p>顯示目前狀態，避免不確定的等待。</p></section>';
    }
  });
  document.addEventListener("input", (event) => {
    if (event.target.matches("[data-filter]")) {
      const query = event.target.value.toLocaleLowerCase();
      let visible = 0;
      document.querySelectorAll("[data-record]").forEach((row) => { row.hidden = !row.dataset.record.toLocaleLowerCase().includes(query); if (!row.hidden) visible++; });
      const count = document.querySelector("[data-result-count]");
      if (count) count.textContent = `範例資料，符合 ${visible} 筆`;
    }
  });
  document.addEventListener("change", (event) => {
    if (event.target.matches("[data-onboarding-country]")) {
      const city = document.querySelector("[data-onboarding-city]");
      const country = event.target.value;
      const options = country === "台灣" ? ["台北市", "台中市", "台南市", "高雄市"] : ["吉隆坡", "檳城", "柔佛"];
      city.innerHTML = '<option value="">請選擇縣市</option>' + options.map((option) => `<option>${option}</option>`).join("");
      city.disabled = !country;
    }
    if (event.target.matches("[data-onboarding-market]")) {
      document.querySelector("[data-onboarding-stall]").hidden = event.target.selectedIndex === 0;
    }
  });
  document.addEventListener("submit", (event) => {
    if (!event.target.matches("[data-preview-form]")) return;
    event.preventDefault();
    const success = event.target.querySelector(".form-success");
    if (success) success.textContent = "範例操作完成。資料只用於本頁示意，沒有送往正式系統。";
  });
  document.addEventListener("keydown", (event) => {
    if (event.target.getAttribute("role") === "tab" && ["ArrowLeft", "ArrowRight"].includes(event.key)) {
      event.preventDefault();
      const group = [...event.target.parentElement.querySelectorAll('[role="tab"]')];
      const index = group.indexOf(event.target);
      const next = group[(index + (event.key === "ArrowRight" ? 1 : group.length - 1)) % group.length];
      next.click(); next.focus();
    }
  });
}

let appFilter = "";
let query = "";
let currentPage;
let selectedDevice = "desktop";
let selectedView = "compare";
const pages = REVIEW.pages;
const $ = (selector) => document.querySelector(selector);
const captures = (page) => page.captures.filter((capture) => capture.image && !["blocked", "redirect", "layout"].includes(capture.status));
function filteredPages() {
  return pages.filter((page) => (!appFilter || page.app === appFilter) && (!query || `${page.title} ${page.file} ${page.routes.join(" ")} ${page.issues.map((issue) => issue.finding).join(" ")}`.toLocaleLowerCase().includes(query)));
}
function renderCatalog() {
  const filtered = filteredPages();
  $("#page-count").textContent = `${filtered.length} / ${pages.length} 個頁面`;
  $("#catalog").innerHTML = Object.entries(APPS).map(([app, config]) => {
    const entries = filtered.filter((page) => page.app === app);
    if (!entries.length) return "";
    return `<section class="app-group" style="--app-accent:${config.accent};--app-soft:${config.soft}"><div class="app-heading"><button data-app="${app}">${config.title}</button><span>${entries.length}</span></div>${entries.map((page) => `<button class="page-link" data-page="${esc(page.id)}" aria-current="${currentPage?.id === page.id ? "page" : "false"}" title="${esc(page.file)}"><span class="nav-dot"></span><span>${esc(page.title)}</span>${captures(page).length ? '<span class="capture-indicator" title="有實際截圖"></span>' : ""}</button>`).join("")}</section>`;
  }).join("") || '<p class="empty-search">沒有符合的頁面。試試其他名稱或路徑。</p>';
}
function resizePreview() {
  const container = $(".proposal-viewport");
  const iframe = $("#proposal");
  const width = selectedDevice === "mobile" ? 390 : 1100;
  const available = container.clientWidth - 12;
  const scale = Math.min(1, available / width);
  iframe.style.width = `${width}px`;
  iframe.style.height = `${Math.ceil(container.clientHeight / scale)}px`;
  iframe.style.transform = `scale(${scale})`;
}
function selectPage(page, updateHash = true) {
  if (!page) return;
  currentPage = page;
  const app = APPS[page.app];
  document.documentElement.style.setProperty("--app-accent", app.accent);
  document.documentElement.style.setProperty("--app-soft", app.soft);
  const kindNames = {landing:"首頁",discovery:"探索",menu:"菜單",cart:"購物車",tracking:"進度",list:"紀錄",detail:"詳細資訊",form:"表單",auth:"帳號驗證",legal:"閱讀頁",error:"狀態頁",queue:"候位與服務",profile:"個人資料",dashboard:"營運總覽",orders:"訂單",table:"管理清單",schedule:"員工工作",settings:"設定",analytics:"分析",kitchen:"廚房",billing:"帳務與收銀"};
  $("#breadcrumb").innerHTML = `<span>${esc(app.title)}</span>／<span style="color:var(--muted);font-weight:400">${esc(kindNames[page.kind] || "介面")}</span>`;
  $("#page-title").textContent = page.title;
  $("#page-purpose").textContent = page.purpose;
  $("#page-route").textContent = page.routes.length ? page.routes.join("　·　") : "共用或巢狀頁面，非獨立路由";
  const validCaptures = captures(page);
  const capture = validCaptures.find((item) => item.origin === "live") || validCaptures.find((item) => item.status === "captured") || validCaptures[0];
  const captureSelector = $("#capture-selector");
  captureSelector.innerHTML = validCaptures.map((item, index) => `<option value="${index}">${esc(item.origin === "live" ? `部署版本 · ${item.role || "實際登入"}` : item.variant ? `本機原版 · ${item.variant}` : `本機原版 · ${item.name || index + 1}`)}</option>`).join("");
  captureSelector.value = String(validCaptures.indexOf(capture));
  captureSelector.hidden = validCaptures.length < 2;
  $("#evidence-status").textContent = capture ? capture.status === "error-state" ? "已擷取原版 · 包含錯誤／空資料狀態" : "已擷取原版 · 本機範例資料" : "原始碼已審視 · 畫面擷取待補";
  $("#before-note").textContent = capture ? `${capture.viewport.width} × ${capture.viewport.height} · ${capture.note || "隔離本機範例資料；實際原始元件。"}` : "本頁沒有有效的原版截圖；下方是原始碼結構摘要，不是原版重繪。";
  $("#original-content").className = `original-content ${capture?.viewport.width < 700 ? "mobile-capture" : ""}`;
  $("#original-content").innerHTML = capture ? `<img src="${capture.image}" alt="${esc(page.title)}的原版介面；${esc(capture.note)}" width="${capture.viewport.width}" height="${capture.viewport.height}" />` : `<div class="source-fallback"><span class="source-label">原版畫面待補</span><h3>${esc(page.title)}</h3><p>${esc(page.original.layout)}</p><h4>原始介面的內容依據</h4><ul>${(page.original.facts || []).map((fact) => `<li>${esc(fact)}</li>`).join("")}</ul><h4>來源</h4><code>${esc(page.file)}</code>${page.captures.some((capture) => capture.status === "blocked") ? '<p style="margin-top:25px">原始頁面被資料驗證或登入流程阻擋；未把導向後的畫面當作本頁原版。</p>' : ""}</div>`;
  if (capture?.origin === "live") $("#evidence-status").textContent = "已補看實際部署版本 · 測試帳號";
  $("#proposal-note").textContent = "提案使用獨立範例資料，僅比較介面與操作；非原版營運數據。";
  $("#proposal").srcdoc = previewDocument(page);
  $("#proposal").title = `${page.title} — 優化提案互動預覽`;
  $("#issues").innerHTML = page.issues.map((issue) => `<article class="issue"><span class="severity ${issue.severity}">${({ high: "優先", medium: "改善", low: "細節" })[issue.severity] || "改善"}</span><p>${esc(issue.finding)}<small>原始檔第 ${issue.line} 行</small></p><p class="issue-fix">${esc(issue.fix)}</p></article>`).join("");
  $("#issue-count").textContent = `${page.issues.length} 項具體調整`;
  $("#source-facts").innerHTML = `<h3>原版結構</h3><p>${esc(page.original.layout)}</p><ul>${(page.original.facts || []).map((fact) => `<li>${esc(fact)}</li>`).join("")}</ul><h3>這頁的提案內容</h3>${sections(page).map((section) => `<p><strong>${esc(section.title)}</strong> · ${esc((section.content || []).join("、"))}</p>`).join("")}`;
  $("#source-path").textContent = page.file;
  const filtered = filteredPages();
  const index = filtered.indexOf(page);
  $("#position").textContent = `${index >= 0 ? index + 1 : pages.indexOf(page) + 1} / ${index >= 0 ? filtered.length : pages.length}`;
  $("#announcement").textContent = `${app.title}，${page.title}，${page.issues.length} 項調整。`;
  document.title = `${page.title} — MakanMasak 介面審視`;
  if (updateHash) history.replaceState(null, "", `#${encodeURIComponent(page.id)}`);
  renderCatalog();
  resizePreview();
}
function stepPage(offset) {
  const filtered = filteredPages();
  if (!filtered.length) return;
  const current = filtered.indexOf(currentPage);
  selectPage(filtered[(Math.max(current, 0) + offset + filtered.length) % filtered.length]);
}
$("#page-search").addEventListener("input", (event) => { query = event.target.value.trim().toLocaleLowerCase(); renderCatalog(); });
$("#catalog").addEventListener("click", (event) => {
  const page = event.target.closest("[data-page]");
  if (page) selectPage(pages.find((item) => item.id === page.dataset.page));
  const app = event.target.closest("[data-app]");
  if (app) { appFilter = app.dataset.app; renderCatalog(); selectPage(filteredPages()[0]); }
});
$("#all-apps").addEventListener("click", () => { appFilter = ""; query = ""; $("#page-search").value = ""; renderCatalog(); });
$("#prev").addEventListener("click", () => stepPage(-1));
$("#next").addEventListener("click", () => stepPage(1));
$("#capture-selector").addEventListener("change", (event) => {
  const capture = captures(currentPage)[Number(event.target.value)];
  if (!capture) return;
  $("#before-note").textContent = `${capture.viewport.width} × ${capture.viewport.height} · ${capture.note}`;
  $("#original-content").className = `original-content ${capture.viewport.width < 700 ? "mobile-capture" : ""}`;
  $("#original-content").innerHTML = `<img src="${capture.image}" alt="${esc(currentPage.title)}原版；${esc(capture.note)}" width="${capture.viewport.width}" height="${capture.viewport.height}" />`;
  $("#evidence-status").textContent = capture.origin === "live" ? "已補看實際部署版本 · 測試帳號" : capture.status === "error-state" ? "已擷取本機原版 · 包含 API 不可用狀態" : "已擷取本機原版 · 範例資料";
});
document.querySelectorAll("[data-device]").forEach((button) => button.addEventListener("click", () => {
  selectedDevice = button.dataset.device;
  document.querySelectorAll("[data-device]").forEach((el) => el.setAttribute("aria-pressed", String(el === button)));
  $("#proposal-note").textContent = `${selectedDevice === "mobile" ? "390 px 手機" : "1100 px 桌面"}提案 · 左側原版維持標註的實際擷取尺寸。`;
  resizePreview();
}));
document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => {
  selectedView = button.dataset.view;
  $("#comparison").dataset.view = selectedView;
  document.querySelectorAll("[data-view]").forEach((el) => el.setAttribute("aria-pressed", String(el === button)));
  resizePreview();
}));
const methodDialog = $("#method-dialog");
for (const id of ["method-button", "footer-method"]) $(`#${id}`).addEventListener("click", (event) => { event.preventDefault(); methodDialog.showModal(); });
$("#close-method").addEventListener("click", () => methodDialog.close());
const captureCount = pages.filter((page) => captures(page).length).length;
$("#method-stats").innerHTML = `<div><strong>${pages.length}</strong><span>逐頁原始碼審視</span></div><div><strong>${captureCount}</strong><span>有效原版畫面</span></div><div><strong>${pages.reduce((count, page) => count + page.issues.length, 0)}</strong><span>具體問題與建議</span></div>`;
$("#limitations").textContent = `${pages.length - captureCount} 頁目前尚無有效原版畫面。原版擷取使用本機範例身份與攔截的範例 API；部分頁面是資料不可用、空狀態或錯誤狀態。右側是依功能類型整理的視覺與互動提案，尚未逐項實作原頁面的完整控制項、權限、全部資料狀態、正式條文及商業流程；狀態切換器是通用示意。原版擷取尺寸固定，不代表已完成所有頁面的雙裝置原版檢驗。`;
window.addEventListener("message", (event) => {
  if (event.source !== $("#proposal").contentWindow) return;
  if (event.data?.type === "review-cart" && Array.isArray(event.data.items)) {
    previewCart = event.data.items.filter((item) => typeof item.name === "string" && Number.isFinite(item.price) && item.price >= 0 && Number.isInteger(item.quantity) && item.quantity >= 0);
    return;
  }
  if (event.data?.type !== "review-navigation" || typeof event.data.leaf !== "string") return;
  const target = pages.find((page) => page.app === currentPage.app && pageLeaf(page) === event.data.leaf);
  if (target) selectPage(target);
});
window.addEventListener("resize", resizePreview);
new ResizeObserver(resizePreview).observe($(".proposal-viewport"));
window.addEventListener("hashchange", () => selectPage(pages.find((page) => page.id === decodeURIComponent(location.hash.slice(1))), false));
const initial = pages.find((page) => page.id === decodeURIComponent(location.hash.slice(1))) || pages.find((page) => page.app === "admin-dashboard" && pageLeaf(page) === "OwnerView") || pages[0];
selectPage(initial, false);
