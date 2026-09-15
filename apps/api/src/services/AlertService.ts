/**
 * Alert Service
 * Sends notifications for security anomalies and system errors
 * Supports Slack webhooks and email alerts
 */

import type { Env } from "../types/env";
import { ResendEmailProvider } from "@makanmasak/database";

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export type AlertSeverity = "info" | "warning" | "error" | "critical";

export interface Alert {
  title: string;
  message: string;
  severity: AlertSeverity;
  metadata?: Record<string, unknown>;
  timestamp?: Date;
}

export interface AlertChannel {
  sendAlert(alert: Alert): Promise<void>;
}

/**
 * Slack Webhook Alert Channel
 */
export class SlackAlertChannel implements AlertChannel {
  constructor(private webhookUrl: string) {}

  async sendAlert(alert: Alert): Promise<void> {
    const color = this.getSeverityColor(alert.severity);
    const emoji = this.getSeverityEmoji(alert.severity);

    const payload = {
      username: "MakanMasak Security Bot",
      icon_emoji: ":shield:",
      attachments: [
        {
          color,
          title: `${emoji} ${alert.title}`,
          text: alert.message,
          fields: alert.metadata
            ? Object.entries(alert.metadata).map(([key, value]) => ({
                title: key,
                value: String(value),
                short: true,
              }))
            : [],
          footer: "MakanMasak Security System",
          ts: Math.floor((alert.timestamp || new Date()).getTime() / 1000),
        },
      ],
    };

    await fetch(this.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  private getSeverityColor(severity: AlertSeverity): string {
    const colors = {
      info: "#36a64f", // Green
      warning: "#ff9800", // Orange
      error: "#f44336", // Red
      critical: "#9c27b0", // Purple
    };
    return colors[severity];
  }

  private getSeverityEmoji(severity: AlertSeverity): string {
    const emojis = {
      info: "ℹ️",
      warning: "⚠️",
      error: "🚨",
      critical: "🔥",
    };
    return emojis[severity];
  }
}

/**
 * Email Alert Channel
 */
export class EmailAlertChannel implements AlertChannel {
  constructor(
    private toEmail: string,
    private apiKey: string,
    private fromEmail: string = "alerts@makanmasak.com",
  ) {}

  async sendAlert(alert: Alert): Promise<void> {
    const html = this.generateAlertHTML(alert);

    const result = await new ResendEmailProvider(
      this.apiKey,
      this.fromEmail,
    ).sendEmail({
      to: this.toEmail,
      subject: `[${alert.severity.toUpperCase()}] ${alert.title}`,
      html,
    });
    if (!result.success) throw new Error(result.error ?? "Email alert failed");
  }

  private generateAlertHTML(alert: Alert): string {
    const severityColors = {
      info: "#36a64f",
      warning: "#ff9800",
      error: "#f44336",
      critical: "#9c27b0",
    };

    const color = severityColors[alert.severity];

    return `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: ${color}; color: white; padding: 20px; border-radius: 5px 5px 0 0; }
            .content { background: #f9f9f9; padding: 20px; border: 1px solid #ddd; }
            .metadata { background: white; padding: 15px; margin-top: 15px; border-radius: 5px; }
            .metadata-item { margin-bottom: 10px; }
            .metadata-key { font-weight: bold; color: #555; }
            .footer { text-align: center; padding: 20px; color: #888; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h2>🔐 ${escapeHtml(alert.title)}</h2>
              <p style="margin: 0;">Severity: ${alert.severity.toUpperCase()}</p>
            </div>
            <div class="content">
              <p>${escapeHtml(alert.message)}</p>
              ${
                alert.metadata
                  ? `
                <div class="metadata">
                  <h3>Details:</h3>
                  ${Object.entries(alert.metadata)
                    .map(
                      ([key, value]) => `
                    <div class="metadata-item">
                      <span class="metadata-key">${escapeHtml(key)}:</span> ${escapeHtml(value)}
                    </div>
                  `,
                    )
                    .join("")}
                </div>
              `
                  : ""
              }
              <p style="margin-top: 20px; font-size: 12px; color: #888;">
                Time: ${(alert.timestamp || new Date()).toISOString()}
              </p>
            </div>
            <div class="footer">
              <p>MakanMasak Security System</p>
              <p>This is an automated alert. Please do not reply to this email.</p>
            </div>
          </div>
        </body>
      </html>
    `;
  }
}

/**
 * Main Alert Service
 */
export class AlertService {
  private channels: AlertChannel[] = [];

  constructor(private env: Env) {
    this.initializeChannels();
  }

  private initializeChannels() {
    // Slack webhook
    if (this.env.SLACK_WEBHOOK_URL) {
      this.channels.push(new SlackAlertChannel(this.env.SLACK_WEBHOOK_URL));
    }

    // Email alerts
    if (this.env.ALERT_EMAIL_TO && this.env.RESEND_API_KEY) {
      this.channels.push(
        new EmailAlertChannel(
          this.env.ALERT_EMAIL_TO,
          this.env.RESEND_API_KEY,
          this.env.NOTIFICATION_FROM_EMAIL || "alerts@makanmasak.com",
        ),
      );
    }

    if (this.channels.length === 0) {
      console.warn("No alert channels configured");
    }
  }

  async sendAlert(alert: Alert): Promise<void> {
    if (this.channels.length === 0) {
      console.warn("No alert channels available, skipping alert:", alert.title);
      return;
    }

    const alertWithTimestamp = {
      ...alert,
      timestamp: alert.timestamp || new Date(),
    };

    await Promise.allSettled(
      this.channels.map((channel) => channel.sendAlert(alertWithTimestamp)),
    );
  }

  // Convenience methods for common alerts
  async rateLimitExceeded(
    ip: string,
    endpoint: string,
    limit: number,
  ): Promise<void> {
    await this.sendAlert({
      title: "Rate Limit Exceeded",
      message: `IP address ${ip} has exceeded rate limit on ${endpoint}`,
      severity: "warning",
      metadata: {
        IP: ip,
        Endpoint: endpoint,
        Limit: `${limit} requests`,
        Action: "Temporarily blocked",
      },
    });
  }

  async suspiciousActivity(
    activity: string,
    userId?: number,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.sendAlert({
      title: "Suspicious Activity Detected",
      message: activity,
      severity: "error",
      metadata: {
        ...(userId ? { "User ID": userId } : {}),
        ...metadata,
      },
    });
  }

  async passwordResetAttempt(
    email: string,
    ip: string,
    success: boolean,
  ): Promise<void> {
    if (!success) {
      await this.sendAlert({
        title: "Failed Password Reset Attempt",
        message: `Failed password reset attempt for ${email}`,
        severity: "warning",
        metadata: {
          Email: email,
          IP: ip,
          Status: "Failed - User not found",
        },
      });
    }
  }

  async multipleFailedLogins(
    username: string,
    ip: string,
    attemptCount: number,
  ): Promise<void> {
    await this.sendAlert({
      title: "Multiple Failed Login Attempts",
      message: `${attemptCount} failed login attempts detected for ${username}`,
      severity: "warning",
      metadata: {
        Username: username,
        IP: ip,
        Attempts: attemptCount,
        Action: "Account temporarily locked",
      },
    });
  }

  async systemError(error: Error, context?: string): Promise<void> {
    await this.sendAlert({
      title: "System Error",
      message: error.message,
      severity: "error",
      metadata: {
        ...(context ? { Context: context } : {}),
        "Error Name": error.name,
        Stack: error.stack?.split("\n").slice(0, 3).join("\n") || "N/A",
      },
    });
  }

  async databaseConnectionError(error: Error): Promise<void> {
    await this.sendAlert({
      title: "Database Connection Error",
      message: "Critical: Unable to connect to database",
      severity: "critical",
      metadata: {
        Error: error.message,
        "Affected Service": "D1 Database",
      },
    });
  }
}
