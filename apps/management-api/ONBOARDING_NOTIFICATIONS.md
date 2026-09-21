# Onboarding platform notifications

`POST /api/v1/onboarding/applications` is publicly accessible but is limited to five accepted requests per Cloudflare client IP in each fixed one-hour window. A successful submission schedules platform notification work with `waitUntil`; a Slack or email provider error is logged but never changes the applicant's `201` response.

The worker tries every configured channel:

- `SLACK_WEBHOOK_URL` is the existing Slack incoming-webhook channel.
- `ONBOARDING_NOTIFICATION_EMAIL` is a Cloudflare Email Service fallback. It is active only when both `PLATFORM_NOTIFICATION_EMAIL` and `PLATFORM_NOTIFICATION_EMAIL_FROM` are set.

Neither channel sends applicant contact name, email address, or phone number. The alert contains only the business name, application ID, and the internal review URL.

## Production enablement

Do not add a contact address or a webhook URL to `wrangler.toml`. Configure them through the Cloudflare secret store so source control does not become the operator address book.

### Slack

Create an incoming webhook for the platform-operations channel, then set `SLACK_WEBHOOK_URL` for the `production` environment.

### Cloudflare Email Service fallback

1. In Cloudflare Email Service, onboard the sender domain and complete its SPF and DKIM validation. The configured sender must be on that domain.
2. Under **Email Routing → Destination Addresses**, add and verify the platform operator inbox. Email Routing destinations are account-scoped.
3. Deploy the `send_email` binding in `wrangler.toml` to production. Named environments do not inherit bindings, so the production binding is declared separately.
4. Set `PLATFORM_NOTIFICATION_EMAIL` to the verified operator inbox and `PLATFORM_NOTIFICATION_EMAIL_FROM` to the validated sender address.
5. Submit one controlled application from a non-production test environment or with an approved production test record. Confirm the email has only the business name, application ID, and review link, then remove the test record through the ordinary application-review workflow.

Cloudflare requires the sender domain to be onboarded even though sends to verified Email Routing destinations are free. Do not treat destination verification alone as sufficient.

## Closing #380

Code verification is complete only after one production notification is received through Slack or the Email Service fallback, and the sidebar displays the submitted count to a platform administrator. Configuring providers and sending that production test require an operator with Cloudflare account access; they are intentionally outside the worker code change.
