# Locale draft review checklist (2026-09-29)

Cells in the handoff CSV whose target text is identical to the zh-TW source and
contains no CJK. Most are probably proper nouns, units or codes; mark each as
`ok` (legitimately identical) or `fix` before approving the draft. Not covered:
admin-dashboard `ja-JP` (149 identical cells are shared kanji such as 現金 and
警告, plausible as-is), and general machine-translation tone, which needs a
native reader — e.g. admin `accountManagement.createdAtCol` ja-JP renders
"Created" as the past tense 作成されました.

| app | key | locale | value | verdict |
|---|---|---|---|---|
| admin-dashboard | `accountManagement.email` | en-US | Email | |
| admin-dashboard | `accountManagement.emailCol` | en-US | Email | |
| admin-dashboard | `accountManagement.emailPlaceholder` | en-US | user{'@'}example.com | |
| admin-dashboard | `accountManagement.emailPlaceholder` | vi-VN | user{'@'}example.com | |
| admin-dashboard | `charts.workHours.hoursUnit` | en-US | h | |
| admin-dashboard | `charts.workHours.hoursUnit` | vi-VN | h | |
| admin-dashboard | `exportReport.formatExcel` | en-US | Excel (xlsx) | |
| admin-dashboard | `exportReport.formatExcel` | vi-VN | Excel (xlsx) | |
| admin-dashboard | `exportReport.formatExcel` | id-ID | Excel (xlsx) | |
| admin-dashboard | `members.reveal.email` | en-US | Email | |
| admin-dashboard | `members.reveal.email` | vi-VN | Email | |
| admin-dashboard | `members.reveal.email` | id-ID | Email | |
| admin-dashboard | `monitoring.createRule.alertTypes.slack` | en-US | Slack | |
| admin-dashboard | `monitoring.createRule.alertTypes.webhook` | en-US | Webhook | |
| admin-dashboard | `monitoring.createRule.alertTypes.webhook` | vi-VN | Webhook | |
| admin-dashboard | `monitoring.createRule.webhookUrl` | en-US | Webhook URL | |
| admin-dashboard | `monitoring.createRule.webhookUrlPlaceholder` | en-US | https://hooks.slack.com/... | |
| admin-dashboard | `monitoring.createRule.webhookUrlPlaceholder` | vi-VN | https://hooks.slack.com/... | |
| admin-dashboard | `monitoring.createRule.webhookUrlPlaceholder` | id-ID | https://hooks.slack.com/... | |
| admin-dashboard | `monitoring.export.formats.excel` | en-US | Excel (xlsx) | |
| admin-dashboard | `monitoring.export.formats.excel` | vi-VN | Excel (xlsx) | |
| admin-dashboard | `monitoring.export.formats.excel` | id-ID | Excel (xlsx) | |
| admin-dashboard | `platformCustomers.reveal.email` | en-US | Email | |
| admin-dashboard | `platformCustomers.reveal.email` | vi-VN | Email | |
| admin-dashboard | `platformCustomers.reveal.email` | id-ID | Email | |
| admin-dashboard | `platformOnboarding.deliveryChannel.email` | en-US | Email | |
| admin-dashboard | `platformOnboarding.deliveryChannel.email` | vi-VN | Email | |
| admin-dashboard | `platformOnboarding.deliveryChannel.email` | id-ID | Email | |
| admin-dashboard | `shopWallet.providers.grabpay.name` | en-US | GrabPay | |
| admin-dashboard | `shopWallet.providers.grabpay.name` | vi-VN | GrabPay | |
| admin-dashboard | `shopWallet.providers.grabpay.name` | id-ID | GrabPay | |
| admin-dashboard | `shopWallet.providers.tng.name` | en-US | Touch 'n Go eWallet | |
| admin-dashboard | `shopWallet.providers.tng.name` | vi-VN | Touch 'n Go eWallet | |
| admin-dashboard | `shopWallet.providers.tng.name` | id-ID | Touch 'n Go eWallet | |
| admin-dashboard | `usage.columnMeter` | en-US | Meter | |
| admin-dashboard | `usage.columnMeter` | id-ID | Meter | |
| admin-dashboard | `users.modal.emailLabel` | en-US | Email | |
| admin-dashboard | `users.modal.emailLabel` | vi-VN | Email | |
| admin-dashboard | `users.modal.emailLabel` | id-ID | Email | |
| kitchen-display | `performance.p95` | vi-VN | P95 | |
| kitchen-display | `performance.p95` | ms-MY | P95 | |
| kitchen-display | `platform.foodpanda` | vi-VN | Foodpanda | |
| kitchen-display | `platform.foodpanda` | ms-MY | Foodpanda | |
| kitchen-display | `platform.grabFood` | vi-VN | GrabFood | |
| kitchen-display | `platform.grabFood` | ms-MY | GrabFood | |
| kitchen-display | `platform.uberEats` | ms-MY | Uber Eats | |
| onboarding-app | `apply.form.contactEmail.label` | vi-VN | Email | |
| onboarding-app | `apply.form.contactEmail.placeholder` | vi-VN | your@email.com | |
| onboarding-app | `apply.form.contactEmail.placeholder` | ms-MY | your@email.com | |
| management-portal | `common.appName` | vi-VN | MakanMasak | |
| management-portal | `common.appName` | id-ID | MakanMasak | |
| management-portal | `common.appName` | ms-MY | MakanMasak | |
| management-portal | `health.column.api` | vi-VN | API | |
| management-portal | `health.column.api` | id-ID | API | |
| management-portal | `health.column.api` | ms-MY | API | |
| management-portal | `tenants.createModal.field.contactEmailPlaceholder` | vi-VN | owner@restaurant.com | |
| management-portal | `tenants.createModal.field.contactEmailPlaceholder` | ms-MY | owner@restaurant.com | |
| management-portal | `tenants.createModal.field.subdomainSuffix` | vi-VN | .makanmasak.com | |
| management-portal | `tenants.createModal.field.subdomainSuffix` | id-ID | .makanmasak.com | |
| management-portal | `tenants.createModal.field.subdomainSuffix` | ms-MY | .makanmasak.com | |
