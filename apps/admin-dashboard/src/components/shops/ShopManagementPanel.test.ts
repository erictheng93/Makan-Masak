// @vitest-environment jsdom

import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ShopManagementPanel from "./ShopManagementPanel.vue";
import { api } from "@/services/api";
import { useConfirmModal } from "@/composables/useConfirmModal";

const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock("@/i18n", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key} ${JSON.stringify(params)}` : key,
  }),
}));
vi.mock("vue-toastification", () => ({
  useToast: () => ({ success: toastSuccess, error: toastError }),
}));
vi.mock("@/services/api", () => ({
  api: { get: vi.fn(), delete: vi.fn() },
  unwrapApiList: (p: unknown) => (Array.isArray(p) ? p : []),
}));

function buildShop(overrides = {}) {
  return {
    id: "shop-1",
    name: "Makan House",
    loginSlug: "makan",
    isActive: false,
    isDemo: false,
    ...overrides,
  };
}

function buildPreview(overrides = {}) {
  return {
    restaurant: { id: "shop-1", name: "Makan House" },
    tables: [{ table: "orders", rows: 3 }],
    totalRows: 3,
    hasFinancialRecords: false,
    blockers: [],
    ...overrides,
  };
}

function apiError(status: number, code: string) {
  return { response: { status, data: { error: { code } } } };
}

async function mountPanel(shops: unknown[], canManage = true, preview = {}) {
  vi.mocked(api.get).mockImplementation(async (url: string) =>
    url.endsWith("/deletion-preview")
      ? ({ data: { success: true, data: buildPreview(preview) } } as never)
      : ({ data: { success: true, data: shops } } as never),
  );
  const wrapper = mount(ShopManagementPanel, {
    props: { canManage },
    attachTo: document.body,
  });
  await flushPromises();
  return wrapper;
}

const byId = (id: string) => document.querySelector(`[data-testid="${id}"]`);

async function openDelete(wrapper: Awaited<ReturnType<typeof mountPanel>>) {
  await wrapper.find('[data-testid="shop-delete-shop-1"]').trigger("click");
  await flushPromises();
}

async function type(el: Element | null, value: string) {
  (el as HTMLInputElement).value = value;
  el!.dispatchEvent(new Event("input"));
  await flushPromises();
}

describe("ShopManagementPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
  });

  it("asks for deactivated shops too and shows them", async () => {
    const wrapper = await mountPanel([buildShop()]);

    expect(api.get).toHaveBeenCalledWith("/restaurants", {
      params: { includeInactive: true, limit: 100 },
    });
    expect(
      wrapper.find('[data-testid="shop-row-shop-1"]').attributes(),
    ).toMatchObject({ "data-status": "inactive" });
    expect(wrapper.text()).toContain("makan");
  });

  it("hides every action for a non-administrator tier", async () => {
    const wrapper = await mountPanel(
      [buildShop(), buildShop({ id: "shop-2", isActive: true })],
      false,
    );

    expect(wrapper.find('[data-testid="shop-delete-shop-1"]').exists()).toBe(
      false,
    );
    expect(
      wrapper.find('[data-testid="shop-deactivate-shop-2"]').exists(),
    ).toBe(false);
  });

  it("offers no actions for the demo shop", async () => {
    const wrapper = await mountPanel([buildShop({ isDemo: true })]);
    expect(wrapper.find('[data-testid="shop-delete-shop-1"]').exists()).toBe(
      false,
    );
  });

  it("deactivates an active shop after confirmation", async () => {
    vi.mocked(api.delete).mockResolvedValue({
      data: { success: true },
    } as never);
    const wrapper = await mountPanel([buildShop({ isActive: true })]);
    const { modalState, close } = useConfirmModal();

    await wrapper
      .find('[data-testid="shop-deactivate-shop-1"]')
      .trigger("click");
    expect(api.delete).not.toHaveBeenCalled();
    expect(modalState.value).not.toBeNull();
    close(true);
    await flushPromises();

    expect(api.delete).toHaveBeenCalledOnce();
    expect(api.delete).toHaveBeenCalledWith("/restaurants/shop-1");
    expect(wrapper.find('[data-testid="shop-delete-shop-1"]').exists()).toBe(
      true,
    );
  });

  it("keeps confirm disabled until the exact name is typed", async () => {
    const wrapper = await mountPanel([buildShop()]);
    await openDelete(wrapper);

    const confirm = () => byId("permanent-delete-confirm") as HTMLButtonElement;
    expect(byId("permanent-delete-total")?.textContent).toContain("3");
    expect(confirm().disabled).toBe(true);
    await type(byId("permanent-delete-name"), "makan house");
    expect(confirm().disabled).toBe(true);
    await type(byId("permanent-delete-name"), "Makan House");
    expect(confirm().disabled).toBe(false);
  });

  it("also requires the acknowledgement when financial records exist", async () => {
    const wrapper = await mountPanel([buildShop()], true, {
      hasFinancialRecords: true,
    });
    await openDelete(wrapper);
    await type(byId("permanent-delete-name"), "Makan House");

    const confirm = byId("permanent-delete-confirm") as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    const ack = byId("permanent-delete-ack") as HTMLInputElement;
    ack.checked = true;
    ack.dispatchEvent(new Event("change"));
    await flushPromises();
    expect(confirm.disabled).toBe(false);
  });

  it("deletes with the typed name, removes the row and reports the count", async () => {
    vi.mocked(api.delete).mockResolvedValue({
      data: { success: true, data: { totalRows: 3 } },
    } as never);
    const wrapper = await mountPanel([buildShop()], true, {
      hasFinancialRecords: true,
    });
    await openDelete(wrapper);
    await type(byId("permanent-delete-name"), "Makan House");
    const ack = byId("permanent-delete-ack") as HTMLInputElement;
    ack.checked = true;
    ack.dispatchEvent(new Event("change"));
    await flushPromises();

    byId("permanent-delete-confirm")!
      .closest("form")!
      .dispatchEvent(new Event("submit"));
    await flushPromises();

    expect(api.delete).toHaveBeenCalledOnce();
    expect(api.delete).toHaveBeenCalledWith("/restaurants/shop-1/permanent", {
      confirmName: "Makan House",
      acknowledgeFinancialRecords: true,
    });
    expect(toastSuccess).toHaveBeenCalledWith(
      expect.stringContaining('"count":3'),
    );
    expect(wrapper.find('[data-testid="shop-row-shop-1"]').exists()).toBe(
      false,
    );
  });

  it("maps RESTAURANT_STILL_ACTIVE to its message and keeps the row", async () => {
    vi.mocked(api.delete).mockRejectedValue(
      apiError(409, "RESTAURANT_STILL_ACTIVE"),
    );
    const wrapper = await mountPanel([buildShop()]);
    await openDelete(wrapper);
    await type(byId("permanent-delete-name"), "Makan House");

    byId("permanent-delete-confirm")!
      .closest("form")!
      .dispatchEvent(new Event("submit"));
    await flushPromises();

    expect(byId("permanent-delete-error")?.textContent).toContain(
      "shopManagement.delete.errors.stillActive",
    );
    expect(wrapper.find('[data-testid="shop-row-shop-1"]').exists()).toBe(true);
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});
