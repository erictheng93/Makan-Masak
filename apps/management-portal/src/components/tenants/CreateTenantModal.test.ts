import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CreateTenantModal from "./CreateTenantModal.vue";
import { tenantsApi } from "@/services/api";

vi.mock("@/services/api", () => ({
  tenantsApi: { create: vi.fn(), list: vi.fn() },
  deploymentsApi: {},
  healthApi: {},
  licensesApi: {},
}));

async function mountFilled() {
  const wrapper = mount(CreateTenantModal, {
    props: { show: false },
    global: { stubs: { teleport: true } },
  });
  await wrapper.setProps({ show: true });
  const fill = (id: string, value: string) =>
    wrapper.find(`[data-testid="management-tenant-${id}"]`).setValue(value);
  await fill("business-name", "Demo Noodles");
  await fill("contact-name", "Demo Owner");
  await fill("contact-email", "owner@example.com");
  await fill("contact-phone", "0912345678");
  await fill("country", "TW");
  await fill("city", "台中市");
  await fill("latitude", "24.15");
  await fill("longitude", "120.67");
  await wrapper
    .find('[data-testid="management-tenant-license-professional"]')
    .setValue(true);
  return wrapper;
}

const submit = async (wrapper: Awaited<ReturnType<typeof mountFilled>>) => {
  await wrapper
    .find('[data-testid="management-tenant-create-submit"]')
    .trigger("click");
  await flushPromises();
};

describe("CreateTenantModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
    vi.mocked(tenantsApi.list).mockResolvedValue({
      data: [],
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 0,
    });
  });

  it("files an approved onboarding application and shows the owner setup link", async () => {
    vi.mocked(tenantsApi.create).mockResolvedValue({
      application: { id: "app-1", status: "completed" },
      approval: {
        tenantId: "tenant-1",
        restaurantId: "rest-1",
        subdomain: "demo-noodles",
        status: "completed",
        ownerAccount: {
          restaurantId: "rest-1",
          userId: "user-1",
          username: "demo-owner",
          setupPasswordLink: "https://admin.example.com/setup?token=abc",
          setupPasswordExpiresAt: "2026-10-29T00:00:00.000Z",
        },
        credentialDelivery: {
          id: "d-1",
          channel: "email",
          status: "sent",
          recipientEmail: "owner@example.com",
          recipientName: "Demo Owner",
          setupPasswordExpiresAt: "2026-10-29T00:00:00.000Z",
        },
      },
    });
    const wrapper = await mountFilled();

    await submit(wrapper);

    expect(tenantsApi.create).toHaveBeenCalledOnce();
    expect(tenantsApi.create).toHaveBeenCalledWith(
      expect.objectContaining({
        contactName: "Demo Owner",
        countryCode: "TW",
        city: "台中市",
        latitude: 24.15,
        longitude: 120.67,
        planId: "professional",
        approveImmediately: true,
      }),
    );
    expect(
      wrapper
        .find('[data-testid="management-tenant-create-result"]')
        .attributes("data-status"),
    ).toBe("approved");
    expect(
      (
        wrapper.find('[data-testid="management-tenant-setup-link"]')
          .element as HTMLInputElement
      ).value,
    ).toBe("https://admin.example.com/setup?token=abc");
    expect(
      wrapper
        .find('[data-testid="management-tenant-credential-delivery"]')
        .text(),
    ).toContain("owner@example.com");

    await wrapper
      .find('[data-testid="management-tenant-create-done"]')
      .trigger("click");
    expect(wrapper.emitted("success")).toHaveLength(1);
  });

  it("shows the approval error when the application was filed but not approved", async () => {
    vi.mocked(tenantsApi.create).mockResolvedValue({
      application: { id: "app-2", status: "submitted" },
      approval: null,
      approvalError: { code: "APPROVAL_FAILED", message: "Platform down" },
    });
    const wrapper = await mountFilled();

    await submit(wrapper);

    expect(
      wrapper.find('[data-testid="management-tenant-approval-error"]').text(),
    ).toContain("Platform down");
    await wrapper
      .find('[data-testid="management-tenant-create-done"]')
      .trigger("click");
    expect(wrapper.emitted("success")).toBeUndefined();
    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  it("blocks submit without coordinates", async () => {
    const wrapper = await mountFilled();
    await wrapper
      .find('[data-testid="management-tenant-latitude"]')
      .setValue("");

    await submit(wrapper);

    expect(tenantsApi.create).not.toHaveBeenCalled();
  });

  it("writes to the owner in the country's language unless the operator picks one", async () => {
    vi.mocked(tenantsApi.create).mockResolvedValue({
      application: { id: "app-3", status: "submitted" },
      approval: null,
    });
    const wrapper = await mountFilled();
    const language = () =>
      (
        wrapper.find('[data-testid="management-tenant-email-language"]')
          .element as HTMLSelectElement
      ).value;
    expect(language()).toBe("zh-TW");

    await wrapper
      .find('[data-testid="management-tenant-country"]')
      .setValue("MY");
    await flushPromises();
    expect(language()).toBe("ms-MY");
    await wrapper
      .find('[data-testid="management-tenant-city"]')
      .setValue("Kuala Lumpur");
    await submit(wrapper);

    expect(tenantsApi.create).toHaveBeenCalledOnce();
    expect(tenantsApi.create).toHaveBeenCalledWith(
      expect.objectContaining({ countryCode: "MY", locale: "ms-MY" }),
    );
  });
});
