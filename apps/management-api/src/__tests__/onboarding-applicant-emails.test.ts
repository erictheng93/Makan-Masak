import { describe, expect, it } from "vitest";
import { ONBOARDING_LOCALES } from "@makanmasak/shared-types";
import {
  APPLICANT_EMAILS,
  applicantEmails,
} from "../services/onboarding-applicant-emails";

const applicant = { contactName: "Tan Mei", businessName: "Laksa <Bar>" };
const link = "https://onboarding.example.test/status/APP-1#onb_secret";

function render(locale: (typeof ONBOARDING_LOCALES)[number]) {
  const emails = APPLICANT_EMAILS[locale];
  return {
    received: emails.received({ ...applicant, statusLink: link }),
    rejected: emails.rejected({ ...applicant, reason: "Incomplete address" }),
    setupPassword: emails.setupPassword({
      ...applicant,
      username: "tan-mei",
      setupLink: "https://admin.example.test/reset-password?token=t",
      expiresAt: "2026-10-23T00:00:00.000Z",
    }),
    alreadyPending: emails.alreadyPending({ ...applicant, statusLink: link }),
    statusLink: emails.statusLink({ ...applicant, statusLink: link }),
  };
}

describe("applicant emails", () => {
  it.each(ONBOARDING_LOCALES)(
    "%s has every email, each naming the shop and carrying its link",
    (locale) => {
      const rendered = render(locale);
      expect(Object.keys(rendered).sort()).toEqual(
        Object.keys(APPLICANT_EMAILS["zh-TW"]).sort(),
      );
      for (const email of Object.values(rendered)) {
        expect(email.subject).toContain("Laksa <Bar>");
        expect(email.text).toContain("Tan Mei");
      }
      expect(rendered.received.text).toContain(link);
      expect(rendered.alreadyPending.text).toContain(link);
      expect(rendered.statusLink.text).toContain(link);
      expect(rendered.rejected.text).toContain("Incomplete address");
      expect(rendered.setupPassword.text).toContain("token=t");
    },
  );

  it("writes in a distinct language per locale", () => {
    const subjects = ONBOARDING_LOCALES.map(
      (locale) => render(locale).alreadyPending.subject,
    );
    expect(new Set(subjects).size).toBe(ONBOARDING_LOCALES.length);
  });

  it("falls back to zh-TW for legacy rows and unknown values", () => {
    expect(applicantEmails(undefined)).toBe(APPLICANT_EMAILS["zh-TW"]);
    expect(applicantEmails(null)).toBe(APPLICANT_EMAILS["zh-TW"]);
    expect(applicantEmails("fr-FR")).toBe(APPLICANT_EMAILS["zh-TW"]);
    expect(applicantEmails("ms-MY")).toBe(APPLICANT_EMAILS["ms-MY"]);
  });
});
