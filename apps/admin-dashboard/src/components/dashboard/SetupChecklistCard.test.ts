// @vitest-environment jsdom

import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SetupChecklistCard from "./SetupChecklistCard.vue";

const router = vi.hoisted(() => ({ push: vi.fn() }));
const authState = vi.hoisted(() => ({
  user: { id: 10, role: 1 },
  restaurantId: "shop-1" as string | null,
  hasRestaurantContext: true,
}));
const api = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("vue-router", () => ({ useRouter: () => router }));
vi.mock("@/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("@/stores/auth", () => ({
  useAuthStore: () => authState,
}));
vi.mock("@/services/api", () => ({
  api,
  unwrapApiPayload: (payload: { data?: unknown }) => payload.data ?? payload,
  unwrapApiList: (payload: unknown) => {
    const value = payload as { data?: unknown } | unknown[];
    if (Array.isArray(value)) return value;
    return Array.isArray(value.data) ? value.data : [];
  },
}));

const completeProfile = {
  name: "Shop",
  address: "1 Main Street",
  city: "Kuala Lumpur",
  district: "Bukit Bintang",
  businessHours: { monday: { open: "08:00", close: "22:00" } },
  isAvailable: true,
  settings: { allowGuestOrders: true },
};

function mockChecklistRequests(options?: {
  profile?: Record<string, unknown>;
  menuItems?: Array<{ isAvailable?: boolean }>;
  tables?: unknown[];
  staff?: Array<{ role: number }>;
  rejectedRequest?: number;
}) {
  const responses = [
    { data: { data: options?.profile ?? completeProfile } },
    {
      data: {
        data: { menuItems: options?.menuItems ?? [{ isAvailable: true }] },
      },
    },
    { data: { data: options?.tables ?? [{}] } },
    { data: { data: options?.staff ?? [] } },
  ];

  responses.forEach((response, index) => {
    if (index === options?.rejectedRequest) {
      vi.mocked(api.get).mockRejectedValueOnce(new Error("request failed"));
    } else {
      vi.mocked(api.get).mockResolvedValueOnce(response);
    }
  });
}

async function mountCard() {
  const wrapper = mount(SetupChecklistCard);
  await flushPromises();
  return wrapper;
}

describe("SetupChecklistCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    authState.user = { id: 10, role: 1 };
    authState.restaurantId = "shop-1";
    authState.hasRestaurantContext = true;
  });

  it("keeps a placeholder address incomplete", async () => {
    mockChecklistRequests({
      profile: {
        ...completeProfile,
        address: "Onboarding GPS 3.1390, 101.6869",
        district: "onboarding-shop-1",
      },
    });

    const wrapper = await mountCard();

    expect(
      wrapper
        .get('[data-testid="setup-checklist-profile"]')
        .attributes("data-status"),
    ).toBe("incomplete");
  });

  it("marks guest orders complete only when the restaurant is available and allows them", async () => {
    mockChecklistRequests({ tables: [] });

    const wrapper = await mountCard();

    expect(
      wrapper
        .get('[data-testid="setup-checklist-guest-orders"]')
        .attributes("data-status"),
    ).toBe("complete");
  });

  it("keeps a failed check visible as unable to verify while preserving other results", async () => {
    mockChecklistRequests({
      profile: { ...completeProfile, isAvailable: false },
      rejectedRequest: 2,
    });

    const wrapper = await mountCard();

    expect(
      wrapper
        .get('[data-testid="setup-checklist-tables"]')
        .attributes("data-status"),
    ).toBe("unknown");
    expect(wrapper.text()).toContain("dashboard.setupChecklist.unableToVerify");
    expect(
      wrapper
        .get('[data-testid="setup-checklist-guest-orders"]')
        .attributes("data-status"),
    ).toBe("incomplete");
  });

  it("requires business hours before treating the shop profile as complete", async () => {
    mockChecklistRequests({
      profile: { ...completeProfile, businessHours: {} },
    });

    const wrapper = await mountCard();

    expect(
      wrapper
        .get('[data-testid="setup-checklist-profile"]')
        .attributes("data-status"),
    ).toBe("incomplete");
  });

  it("opens table setup instead of the reservations tab", async () => {
    mockChecklistRequests({ tables: [] });

    const wrapper = await mountCard();
    await wrapper
      .get('[data-testid="setup-checklist-tables-action"]')
      .trigger("click");

    expect(router.push).toHaveBeenCalledWith("/dashboard/seating/table-setup");
  });

  it("remembers a manual dismissal per restaurant", async () => {
    mockChecklistRequests({ tables: [] });

    const wrapper = await mountCard();
    await wrapper
      .get('[data-testid="setup-checklist-dismiss"]')
      .trigger("click");

    expect(
      localStorage.getItem("makanmasak:setup-checklist-dismissed:shop-1"),
    ).toBe("1");
    expect(wrapper.find('[data-testid="owner-setup-checklist"]').exists()).toBe(
      false,
    );
  });

  it("does not render after all essential setup is complete", async () => {
    mockChecklistRequests();

    const wrapper = await mountCard();

    expect(wrapper.find('[data-testid="owner-setup-checklist"]').exists()).toBe(
      false,
    );
  });
});
