// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import LeaveDecisionCard from "./LeaveDecisionCard.vue";
import type { LeaveBalance, LeaveRequest } from "@makanmasak/shared-types";

vi.mock("@/i18n", () => ({
  t: (key: string) => key,
  useI18n: () => ({ t: (key: string) => key }),
}));

function buildRequest(overrides: Partial<LeaveRequest> = {}): LeaveRequest {
  return {
    id: 7,
    restaurantId: "11111111-1111-7111-8111-111111111111",
    employeeId: "22222222-2222-7222-8222-222222222222",
    leaveTypeId: 1,
    startDate: "2026-06-08",
    endDate: "2026-06-09",
    startPeriod: "full",
    endPeriod: "full",
    totalDays: 2,
    reason: "Family event",
    attachmentUrl: null,
    emergencyContact: null,
    status: "pending",
    approvalChain: "[]",
    currentApprovalLevel: 0,
    finalApproverId: null,
    finalApprovedAt: null,
    rejectedBy: null,
    rejectedAt: null,
    rejectionReason: null,
    cancelledBy: null,
    cancelledAt: null,
    cancellationReason: null,
    affectedScheduleIds: null,
    replacementNotified: false,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    submittedAt: "2026-06-01T00:00:00.000Z",
    deletedAt: null,
    employee: {
      id: "22222222-2222-7222-8222-222222222222",
      fullName: "Shop Owner",
      email: null,
      role: 1,
    },
    leaveType: {
      id: 1,
      code: "ANNUAL",
      name: "Annual Leave",
      isPaid: true,
      color: null,
    },
    ...overrides,
  };
}

function mountCard(
  balance: LeaveBalance | null = null,
  requestOverrides: Partial<LeaveRequest> = {},
) {
  return mount(LeaveDecisionCard, {
    props: {
      request: buildRequest(requestOverrides),
      balance,
      teamLeaves: [],
    },
  });
}

// rejectLeaveRequestSchema requires a non-empty reason. The field used to be
// labelled 可選 and emitted `undefined` when blank, so JSON dropped the key and
// the reject came back 400 with the card just saying it failed.
describe("LeaveDecisionCard reject", () => {
  it("keeps the confirm button disabled until a reason is typed", async () => {
    const wrapper = mountCard();

    await wrapper.get('[data-testid="leave-reject-open"]').trigger("click");
    const confirm = wrapper.get('[data-testid="leave-reject-confirm"]');
    expect(confirm.attributes("disabled")).toBeDefined();

    await wrapper.get('[data-testid="leave-reject-reason"]').setValue("   ");
    expect(confirm.attributes("disabled")).toBeDefined();

    await wrapper
      .get('[data-testid="leave-reject-reason"]')
      .setValue("Not enough cover");
    expect(confirm.attributes("disabled")).toBeUndefined();
  });

  it("emits the trimmed reason, never undefined", async () => {
    const wrapper = mountCard();

    await wrapper.get('[data-testid="leave-reject-open"]').trigger("click");
    await wrapper
      .get('[data-testid="leave-reject-reason"]')
      .setValue("  Not enough cover  ");
    await wrapper.get('[data-testid="leave-reject-confirm"]').trigger("click");

    expect(wrapper.emitted("reject")).toBeTruthy();
    expect(wrapper.emitted("reject")![0]).toEqual([7, "Not enough cover"]);
  });
});

// This card is the only approval UI a user can reach, and it had no attachment
// row at all -- so even a stored proof document was invisible to the approver
// (#343). The URL is employee-supplied, so it must not reach an href unchecked.
describe("LeaveDecisionCard attachment", () => {
  const linkOf = (wrapper: ReturnType<typeof mountCard>) =>
    wrapper.find('[data-testid="leave-attachment-link"]');

  async function expand(attachmentUrl: string | null) {
    const wrapper = mountCard(null, { attachmentUrl });
    await wrapper.get('[data-testid="leave-expand-toggle"]').trigger("click");
    return wrapper;
  }

  it("links the proof document the employee supplied", async () => {
    const wrapper = await expand("https://drive.example.com/cert.pdf");

    expect(linkOf(wrapper).attributes("href")).toBe(
      "https://drive.example.com/cert.pdf",
    );
    // Opened in a new tab without handing the document the opener reference.
    expect(linkOf(wrapper).attributes("rel")).toBe("noopener noreferrer");
    expect(linkOf(wrapper).text()).toContain("drive.example.com");
  });

  it("renders no row when the request has no document", async () => {
    const wrapper = await expand(null);

    expect(linkOf(wrapper).exists()).toBe(false);
  });

  it("refuses to link a non-http scheme", async () => {
    for (const hostile of [
      "javascript:alert(document.domain)",
      "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
      "not-a-url-at-all",
    ]) {
      const wrapper = await expand(hostile);
      expect(linkOf(wrapper).exists()).toBe(false);
    }
  });
});
