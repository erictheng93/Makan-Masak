export type BillingTemplateKind =
  | "trial_3d"
  | "trial_1d"
  | "trial_0d"
  | "payment_failed"
  | "quota_hard";

const SUBJECTS: Record<BillingTemplateKind, string> = {
  trial_3d: "Your MakanMasak trial ends in 3 days",
  trial_1d: "Your MakanMasak trial ends tomorrow",
  trial_0d: "Your MakanMasak trial has ended",
  payment_failed: "MakanMasak billing payment failed",
  quota_hard: "MakanMasak usage quota exceeded",
};

export interface BillingTemplateData {
  restaurantName?: string;
  actionUrl?: string;
  meterKey?: string;
  current?: number;
  hardLimit?: number;
}

export function renderBillingEmail(
  kind: BillingTemplateKind,
  data: BillingTemplateData = {},
) {
  const restaurantName = data.restaurantName ?? "your restaurant";
  const action = data.actionUrl ? `\nManage billing: ${data.actionUrl}` : "";

  if (kind === "payment_failed") {
    return {
      subject: SUBJECTS[kind],
      text: `We could not complete billing for ${restaurantName}. Please update the payment method to keep modules active.${action}`,
    };
  }

  if (kind === "quota_hard") {
    const meter = data.meterKey ?? "usage";
    const usage =
      data.current !== undefined && data.hardLimit !== undefined
        ? ` (${data.current}/${data.hardLimit})`
        : "";
    return {
      subject: SUBJECTS[kind],
      text: `${restaurantName} reached the hard limit for ${meter}${usage}. Upgrade the plan to continue using this feature.${action}`,
    };
  }

  if (kind === "trial_0d") {
    return {
      subject: SUBJECTS[kind],
      text: `The MakanMasak trial for ${restaurantName} has ended. Everything keeps working, but please choose a plan to support MakanMasak.${action}`,
    };
  }

  if (kind === "trial_1d") {
    return {
      subject: SUBJECTS[kind],
      text: `The MakanMasak trial for ${restaurantName} ends tomorrow. Everything keeps working after that, but please choose a plan to support MakanMasak.${action}`,
    };
  }

  return {
    subject: SUBJECTS[kind],
    text: `The MakanMasak trial for ${restaurantName} ends in 3 days.${action}`,
  };
}
