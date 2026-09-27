import {
  BILLING_NOTIFICATION_KINDS,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_DISPATCH_STATUSES,
  createEmailProvider,
  type BillingNotificationKind,
  type NotificationChannel,
  type NotificationDispatchStatus,
} from "@makanmasak/database";
import { generateUUID } from "@makanmasak/utils";
import type { Env } from "../../../types/env";

interface DispatchInput {
  restaurantId?: string | null;
  kind: BillingNotificationKind;
  dedupKey: string;
  channel: NotificationChannel;
  recipient?: string | null;
  subject?: string;
  text: string;
  payload?: Record<string, unknown>;
}

export interface DispatchResult {
  status: NotificationDispatchStatus;
  duplicate: boolean;
}

function encodePayload(payload: Record<string, unknown> | undefined) {
  return payload ? JSON.stringify(payload) : null;
}

export class BillingNotificationService {
  constructor(private readonly env: Env) {}

  async send(input: DispatchInput): Promise<DispatchResult> {
    const duplicate = await this.hasDispatch(input);
    if (duplicate) {
      return {
        status: NOTIFICATION_DISPATCH_STATUSES.SKIPPED_DUPLICATE,
        duplicate: true,
      };
    }

    if (input.channel === NOTIFICATION_CHANNELS.SLACK) {
      return await this.sendSlack(input);
    }

    return await this.sendEmail(input);
  }

  private async hasDispatch(input: DispatchInput) {
    const row = await this.env.DB.prepare(
      `SELECT id
         FROM notification_dispatch_log
        WHERE restaurant_id IS ?
          AND kind = ?
          AND dedup_key = ?
          AND channel = ?
        LIMIT 1`,
    )
      .bind(
        input.restaurantId ?? null,
        input.kind,
        input.dedupKey,
        input.channel,
      )
      .first<{ id: string }>();

    return Boolean(row);
  }

  private async sendSlack(input: DispatchInput): Promise<DispatchResult> {
    if (!this.env.SLACK_WEBHOOK_URL) {
      await this.record(
        input,
        NOTIFICATION_DISPATCH_STATUSES.SKIPPED_PROVIDER_UNCONFIGURED,
      );
      return {
        status: NOTIFICATION_DISPATCH_STATUSES.SKIPPED_PROVIDER_UNCONFIGURED,
        duplicate: false,
      };
    }

    try {
      const response = await fetch(this.env.SLACK_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: input.text }),
      });

      if (!response.ok) {
        throw new Error(`Slack webhook failed: ${response.status}`);
      }

      await this.record(input, NOTIFICATION_DISPATCH_STATUSES.SENT);
      return { status: NOTIFICATION_DISPATCH_STATUSES.SENT, duplicate: false };
    } catch (error) {
      await this.record(
        input,
        NOTIFICATION_DISPATCH_STATUSES.FAILED,
        error instanceof Error ? error.message : String(error),
      );
      return {
        status: NOTIFICATION_DISPATCH_STATUSES.FAILED,
        duplicate: false,
      };
    }
  }

  private async sendEmail(input: DispatchInput): Promise<DispatchResult> {
    const from =
      this.env.BILLING_EMAIL_FROM ??
      this.env.NOTIFICATION_FROM_EMAIL ??
      "notifications@makanmasak.com";
    const provider = createEmailProvider(this.env, from);
    if (!provider || !input.recipient) {
      await this.record(
        input,
        NOTIFICATION_DISPATCH_STATUSES.SKIPPED_PROVIDER_UNCONFIGURED,
      );
      return {
        status: NOTIFICATION_DISPATCH_STATUSES.SKIPPED_PROVIDER_UNCONFIGURED,
        duplicate: false,
      };
    }

    try {
      const result = await provider.sendEmail({
        to: input.recipient,
        subject: input.subject ?? "MakanMasak billing notification",
        text: input.text,
        html: `<pre>${input.text
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;")
          .replaceAll("'", "&#39;")}</pre>`,
      });
      if (!result.success)
        throw new Error(result.error ?? "Email delivery failed");

      await this.record(
        input,
        NOTIFICATION_DISPATCH_STATUSES.SENT,
        null,
        result.messageId ?? null,
      );
      return { status: NOTIFICATION_DISPATCH_STATUSES.SENT, duplicate: false };
    } catch (error) {
      await this.record(
        input,
        NOTIFICATION_DISPATCH_STATUSES.FAILED,
        error instanceof Error ? error.message : String(error),
      );
      return {
        status: NOTIFICATION_DISPATCH_STATUSES.FAILED,
        duplicate: false,
      };
    }
  }

  private async record(
    input: DispatchInput,
    status: NotificationDispatchStatus,
    errorMessage: string | null = null,
    providerMessageId: string | null = null,
  ) {
    await this.env.DB.prepare(
      `INSERT OR IGNORE INTO notification_dispatch_log (
          id, restaurant_id, kind, dedup_key, channel, status, recipient,
          provider_message_id, error_message, payload, created_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        generateUUID(),
        input.restaurantId ?? null,
        input.kind,
        input.dedupKey,
        input.channel,
        status,
        input.recipient ?? null,
        providerMessageId,
        errorMessage,
        encodePayload(input.payload),
        Date.now(),
      )
      .run();
  }
}

interface TrialReminderRow {
  restaurant_id: string;
  restaurant_name: string;
  email: string | null;
  trial_ends_at_ms: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export class BillingReminderService {
  constructor(private readonly env: Env) {}

  async sendTrialEndingReminders(now = Date.now()) {
    const trial3d = await this.sendTrialReminderWindow(
      now,
      3,
      BILLING_NOTIFICATION_KINDS.TRIAL_3D,
    );
    const trial1d = await this.sendTrialReminderWindow(
      now,
      1,
      BILLING_NOTIFICATION_KINDS.TRIAL_1D,
    );

    return { attempted: trial3d.attempted + trial1d.attempted };
  }

  private async sendTrialReminderWindow(
    now: number,
    daysBeforeEnd: 1 | 3,
    kind: BillingNotificationKind,
  ) {
    const from = now + daysBeforeEnd * DAY_MS;
    const to = from + DAY_MS;
    const rows = await this.env.DB.prepare(
      `SELECT s.restaurant_id, r.name AS restaurant_name, r.email,
              s.trial_ends_at_ms
         FROM shop_subscriptions s
         JOIN restaurants r ON r.id = s.restaurant_id
        WHERE s.is_active = 1
          AND s.plan_tier = 'trial'
          AND s.trial_ends_at_ms >= ?
          AND s.trial_ends_at_ms < ?
        LIMIT 250`,
    )
      .bind(from, to)
      .all<TrialReminderRow>();

    let attempted = 0;
    for (const row of rows.results ?? []) {
      attempted++;
      await new BillingNotificationService(this.env).send({
        restaurantId: row.restaurant_id,
        kind,
        dedupKey: `${kind}:${row.restaurant_id}:${row.trial_ends_at_ms}`,
        channel: NOTIFICATION_CHANNELS.EMAIL,
        recipient: row.email,
        subject: `Your MakanMasak trial ends in ${daysBeforeEnd} day${daysBeforeEnd === 1 ? "" : "s"}`,
        text: `The MakanMasak trial for ${row.restaurant_name} ends in ${daysBeforeEnd} day${daysBeforeEnd === 1 ? "" : "s"}.`,
        payload: { trialEndsAt: row.trial_ends_at_ms },
      });
    }

    return { attempted };
  }
}

export { BILLING_NOTIFICATION_KINDS, NOTIFICATION_CHANNELS };
