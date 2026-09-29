# Locale draft review checklist (2026-09-29)

Reviewed 2026-09-29 by Claude (Sonnet 5.5) on the maintainer's instruction: all 60
cells are `ok` — product/brand names (GrabPay, Foodpanda, Slack, Excel), units
and codes (h, P95, API), email/URL placeholders, and "Email"/"Meter", which are
standard loanwords in vi-VN and id-ID. No `fix` verdicts. This covers only the
listed cells, not native-speaker review of the machine translation.

Cells in the handoff CSV whose target text is identical to the zh-TW source and
contains no CJK. Most are probably proper nouns, units or codes; mark each as
`ok` (legitimately identical) or `fix` before approving the draft. Not covered:
admin-dashboard `ja-JP` (149 identical cells are shared kanji such as 現金 and
警告, plausible as-is), and general machine-translation tone, which needs a
native reader — e.g. admin `accountManagement.createdAtCol` ja-JP renders
"Created" as the past tense 作成されました.

| app | key | locale | value | verdict |
|---|---|---|---|---|
| admin-dashboard | `accountManagement.email` | en-US | Email | ok |
| admin-dashboard | `accountManagement.emailCol` | en-US | Email | ok |
| admin-dashboard | `accountManagement.emailPlaceholder` | en-US | user{'@'}example.com | ok |
| admin-dashboard | `accountManagement.emailPlaceholder` | vi-VN | user{'@'}example.com | ok |
| admin-dashboard | `charts.workHours.hoursUnit` | en-US | h | ok |
| admin-dashboard | `charts.workHours.hoursUnit` | vi-VN | h | ok |
| admin-dashboard | `exportReport.formatExcel` | en-US | Excel (xlsx) | ok |
| admin-dashboard | `exportReport.formatExcel` | vi-VN | Excel (xlsx) | ok |
| admin-dashboard | `exportReport.formatExcel` | id-ID | Excel (xlsx) | ok |
| admin-dashboard | `members.reveal.email` | en-US | Email | ok |
| admin-dashboard | `members.reveal.email` | vi-VN | Email | ok |
| admin-dashboard | `members.reveal.email` | id-ID | Email | ok |
| admin-dashboard | `monitoring.createRule.alertTypes.slack` | en-US | Slack | ok |
| admin-dashboard | `monitoring.createRule.alertTypes.webhook` | en-US | Webhook | ok |
| admin-dashboard | `monitoring.createRule.alertTypes.webhook` | vi-VN | Webhook | ok |
| admin-dashboard | `monitoring.createRule.webhookUrl` | en-US | Webhook URL | ok |
| admin-dashboard | `monitoring.createRule.webhookUrlPlaceholder` | en-US | https://hooks.slack.com/... | ok |
| admin-dashboard | `monitoring.createRule.webhookUrlPlaceholder` | vi-VN | https://hooks.slack.com/... | ok |
| admin-dashboard | `monitoring.createRule.webhookUrlPlaceholder` | id-ID | https://hooks.slack.com/... | ok |
| admin-dashboard | `monitoring.export.formats.excel` | en-US | Excel (xlsx) | ok |
| admin-dashboard | `monitoring.export.formats.excel` | vi-VN | Excel (xlsx) | ok |
| admin-dashboard | `monitoring.export.formats.excel` | id-ID | Excel (xlsx) | ok |
| admin-dashboard | `platformCustomers.reveal.email` | en-US | Email | ok |
| admin-dashboard | `platformCustomers.reveal.email` | vi-VN | Email | ok |
| admin-dashboard | `platformCustomers.reveal.email` | id-ID | Email | ok |
| admin-dashboard | `platformOnboarding.deliveryChannel.email` | en-US | Email | ok |
| admin-dashboard | `platformOnboarding.deliveryChannel.email` | vi-VN | Email | ok |
| admin-dashboard | `platformOnboarding.deliveryChannel.email` | id-ID | Email | ok |
| admin-dashboard | `shopWallet.providers.grabpay.name` | en-US | GrabPay | ok |
| admin-dashboard | `shopWallet.providers.grabpay.name` | vi-VN | GrabPay | ok |
| admin-dashboard | `shopWallet.providers.grabpay.name` | id-ID | GrabPay | ok |
| admin-dashboard | `shopWallet.providers.tng.name` | en-US | Touch 'n Go eWallet | ok |
| admin-dashboard | `shopWallet.providers.tng.name` | vi-VN | Touch 'n Go eWallet | ok |
| admin-dashboard | `shopWallet.providers.tng.name` | id-ID | Touch 'n Go eWallet | ok |
| admin-dashboard | `usage.columnMeter` | en-US | Meter | ok |
| admin-dashboard | `usage.columnMeter` | id-ID | Meter | ok |
| admin-dashboard | `users.modal.emailLabel` | en-US | Email | ok |
| admin-dashboard | `users.modal.emailLabel` | vi-VN | Email | ok |
| admin-dashboard | `users.modal.emailLabel` | id-ID | Email | ok |
| kitchen-display | `performance.p95` | vi-VN | P95 | ok |
| kitchen-display | `performance.p95` | ms-MY | P95 | ok |
| kitchen-display | `platform.foodpanda` | vi-VN | Foodpanda | ok |
| kitchen-display | `platform.foodpanda` | ms-MY | Foodpanda | ok |
| kitchen-display | `platform.grabFood` | vi-VN | GrabFood | ok |
| kitchen-display | `platform.grabFood` | ms-MY | GrabFood | ok |
| kitchen-display | `platform.uberEats` | ms-MY | Uber Eats | ok |
| onboarding-app | `apply.form.contactEmail.label` | vi-VN | Email | ok |
| onboarding-app | `apply.form.contactEmail.placeholder` | vi-VN | your@email.com | ok |
| onboarding-app | `apply.form.contactEmail.placeholder` | ms-MY | your@email.com | ok |
| management-portal | `common.appName` | vi-VN | MakanMasak | ok |
| management-portal | `common.appName` | id-ID | MakanMasak | ok |
| management-portal | `common.appName` | ms-MY | MakanMasak | ok |
| management-portal | `health.column.api` | vi-VN | API | ok |
| management-portal | `health.column.api` | id-ID | API | ok |
| management-portal | `health.column.api` | ms-MY | API | ok |
| management-portal | `tenants.createModal.field.contactEmailPlaceholder` | vi-VN | owner@restaurant.com | ok |
| management-portal | `tenants.createModal.field.contactEmailPlaceholder` | ms-MY | owner@restaurant.com | ok |
| management-portal | `tenants.createModal.field.subdomainSuffix` | vi-VN | .makanmasak.com | ok |
| management-portal | `tenants.createModal.field.subdomainSuffix` | id-ID | .makanmasak.com | ok |
| management-portal | `tenants.createModal.field.subdomainSuffix` | ms-MY | .makanmasak.com | ok |
