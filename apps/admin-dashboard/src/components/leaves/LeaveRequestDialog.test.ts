// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import LeaveRequestDialog from "./LeaveRequestDialog.vue";
import type { LeaveRequestFormData } from "./LeaveRequestDialog.vue";

vi.mock("@/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

// Only the fields the dialog reads (its props are a Pick of LeaveType, #330).
function buildLeaveType(overrides = {}) {
  return {
    id: 1,
    name: "病假",
    minNoticeDays: 0,
    requiresDocumentation: true,
    allowHalfDay: true,
    ...overrides,
  };
}

function mountDialog(requiresDocumentation = true) {
  return mount(LeaveRequestDialog, {
    props: {
      isOpen: true,
      leaveTypes: [buildLeaveType({ requiresDocumentation })],
      balances: [{ leaveTypeId: 1, remainingDays: 14 }],
    },
  });
}

// Fills everything except the attachment, so the only thing left holding the
// submit button is the documentation requirement.
async function fillRequiredFields(
  wrapper: ReturnType<typeof mountDialog>,
): Promise<void> {
  await wrapper.get("select").setValue(1);
  const dates = wrapper.findAll('input[type="date"]');
  await dates[0].setValue("2026-10-01");
  await dates[1].setValue("2026-10-01");
  await wrapper.get("textarea").setValue("需要證明文件的病假申請");
}

const submitButton = (wrapper: ReturnType<typeof mountDialog>) =>
  wrapper.get(".btn-submit");

// The first mount of this dialog in a worker, and the first `setValue` on top
// of it, are one-offs that used to land in whichever timed body reached them
// first -- here the very first `it`, which is why that body was the package's
// slowest at 2,116ms in the #351 sweep while doing the least work of the four
// (#360). Instrumented alone on a loaded 4-core box, its 452ms broke down as
// mount 259ms + fill 164ms + assert 20ms, and inside the fill the first
// `select` setValue alone cost 104ms against 3-78ms on later bodies.
//
// Vue render warm-up, jsdom's first DOM build for this tree and the first DOM
// event dispatch are re-usable state rather than per-test work, so a
// `beforeAll` pays them once under the hook's own budget, going through the
// same `mountDialog` + `fillRequiredFields` path the bodies use. Do not
// replace this with a raised testTimeout: the point is that the timed bodies
// stop containing one-off costs at all.
beforeAll(async () => {
  const warmup = mountDialog();
  await fillRequiredFields(warmup);
  warmup.unmount();
}, 30_000);

describe("LeaveRequestDialog documentation requirement (#343)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("asks for a link rather than a file, because that is all the column holds", async () => {
    const wrapper = mountDialog();
    await fillRequiredFields(wrapper);

    // The old dialog offered <input type="file"> and stored File[] that no
    // caller could ever transmit.
    expect(wrapper.find('input[type="file"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="leave-attachment-url"]').exists()).toBe(
      true,
    );
  });

  it("keeps submit disabled until the link is a real http(s) URL", async () => {
    const wrapper = mountDialog();
    await fillRequiredFields(wrapper);

    expect(submitButton(wrapper).attributes("disabled")).toBeDefined();

    // A bare filename or a javascript: URL must not satisfy the requirement —
    // the API rejects both (httpUrlSchema) and the approval card refuses to
    // link them (safeExternalHref).
    const field = wrapper.get('[data-testid="leave-attachment-url"]');
    await field.setValue("medical-certificate.pdf");
    expect(submitButton(wrapper).attributes("disabled")).toBeDefined();

    await field.setValue("javascript:alert(1)");
    expect(submitButton(wrapper).attributes("disabled")).toBeDefined();

    await field.setValue("https://drive.example.com/cert.pdf");
    expect(submitButton(wrapper).attributes("disabled")).toBeUndefined();
  });

  it("emits the link so a caller can forward it", async () => {
    const wrapper = mountDialog();
    await fillRequiredFields(wrapper);
    await wrapper
      .get('[data-testid="leave-attachment-url"]')
      .setValue("https://drive.example.com/cert.pdf");
    await wrapper.get("form").trigger("submit");

    const emitted = wrapper.emitted("submit");
    expect(emitted).toHaveLength(1);
    expect(emitted?.[0][0]).toEqual(
      expect.objectContaining({
        leaveTypeId: 1,
        attachmentUrl: "https://drive.example.com/cert.pdf",
      }),
    );
  });

  it("omits the key entirely when the leave type needs no document", async () => {
    const wrapper = mountDialog(false);
    await fillRequiredFields(wrapper);

    // No field is rendered, so nothing can be typed — and "" would fail the
    // API's z.url() rather than being treated as absent.
    expect(wrapper.find('[data-testid="leave-attachment-url"]').exists()).toBe(
      false,
    );
    expect(submitButton(wrapper).attributes("disabled")).toBeUndefined();

    await wrapper.get("form").trigger("submit");
    const payload = wrapper.emitted("submit")?.[0][0] as LeaveRequestFormData;
    expect(payload.attachmentUrl).toBeUndefined();
  });
});
