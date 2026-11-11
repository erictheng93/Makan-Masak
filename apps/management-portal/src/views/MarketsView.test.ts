import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MarketsView from "./MarketsView.vue";
import { marketsApi } from "@/services/api";

vi.mock("vue-toastification", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("@/services/api", () => ({
  marketsApi: {
    list: vi.fn(),
    listJoinRequests: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
    addVendor: vi.fn(),
    removeVendor: vi.fn(),
    listVendorCandidates: vi.fn(),
    approveJoinRequest: vi.fn(),
    rejectJoinRequest: vi.fn(),
    importVendors: vi.fn(),
  },
}));

describe("MarketsView", () => {
  beforeEach(() => {
    vi.mocked(marketsApi.list).mockResolvedValue({
      markets: [
        {
          id: "market-1",
          slug: "fengjia",
          name: "逢甲夜市",
          type: "night_market",
          city: "台中市",
          district: "西屯區",
          address: "文華路",
          latitude: 24.179,
          longitude: 120.646,
          isActive: true,
        },
      ],
      total: 1,
      page: 1,
      limit: 50,
    });
    vi.mocked(marketsApi.listJoinRequests).mockResolvedValue([]);
    vi.mocked(marketsApi.importVendors).mockReset();
  });

  it("previews and imports market vendors from CSV", async () => {
    vi.mocked(marketsApi.importVendors)
      .mockResolvedValueOnce({
        dryRun: true,
        wouldCreateRestaurants: 1,
        wouldAttachVendors: 2,
        skipped: 0,
        issueCount: 0,
        blockingIssueCount: 0,
        warningIssueCount: 0,
        publicReadiness: {
          ready: false,
          score: 71,
          completedCount: 5,
          totalCount: 7,
          issues: [{ key: "products", severity: "required" }],
        },
        results: [],
      })
      .mockResolvedValueOnce({
        createdRestaurants: 1,
        attachedVendors: 2,
        skipped: 0,
        publicReadiness: {
          ready: false,
          score: 71,
          completedCount: 5,
          totalCount: 7,
          issues: [{ key: "products", severity: "required" }],
        },
        catalogReadiness: {
          searchableProductCount: 4,
          publicServiceCount: 1,
          vendorsWithSearchableProducts: 2,
          vendorsMissingSearchableProducts: 1,
          vendorsWithPublicServices: 1,
          vendorsMissingPublicServices: 2,
          vendorsMissingStallNumbers: 1,
          vendorsMissingSearchEntrypoints: 1,
          missingProductVendors: [
            {
              restaurantId: "restaurant-456",
              name: "缺商品攤",
              stallNumber: "C-01",
              locationLabel: null,
            },
          ],
          missingServiceVendors: [],
          missingStallNumberVendors: [
            {
              restaurantId: "restaurant-789",
              name: "缺攤號攤",
              stallNumber: null,
              locationLabel: null,
            },
          ],
          missingSearchEntrypointVendors: [
            {
              restaurantId: "restaurant-456",
              name: "缺商品攤",
              stallNumber: "C-01",
              locationLabel: null,
            },
          ],
        },
        results: [],
      });

    const wrapper = mount(MarketsView);

    await vi.waitFor(() => {
      expect(wrapper.text()).toContain("逢甲夜市");
    });
    const editButton = wrapper
      .findAll("button")
      .find((button) => button.text() === "Edit");
    expect(editButton).toBeDefined();
    await editButton!.trigger("click");
    await wrapper
      .get('[data-testid="market-vendor-import-text"]')
      .setValue(
        [
          "restaurantId,name,address,district,city,stallNumber,isPrimary",
          ",逢甲雞排攤,台中市西屯區文華路100號,西屯區,台中市,A-18,true",
          "restaurant-123,,,,,B-02,false",
        ].join("\n"),
      );
    await wrapper
      .get('[data-testid="market-vendor-import-preview"]')
      .trigger("click");

    await vi.waitFor(() => {
      expect(marketsApi.importVendors).toHaveBeenCalledWith("market-1", {
        dryRun: true,
        vendors: [
          {
            name: "逢甲雞排攤",
            address: "台中市西屯區文華路100號",
            district: "西屯區",
            city: "台中市",
            stallNumber: "A-18",
            locationLabel: null,
            isPrimary: true,
          },
          {
            restaurantId: "restaurant-123",
            stallNumber: "B-02",
            locationLabel: null,
            isPrimary: false,
          },
        ],
      });
    });
    expect(
      wrapper.get('[data-testid="market-vendor-import-result"]').text(),
    ).toContain("Would create 1 restaurants and attach 2 vendors");
    expect(
      wrapper.get('[data-testid="market-vendor-import-result"]').text(),
    ).toContain("Projected public page needs setup (71%).");

    await wrapper
      .get('[data-testid="market-vendor-import-submit"]')
      .trigger("click");

    await vi.waitFor(() => {
      expect(marketsApi.importVendors).toHaveBeenLastCalledWith("market-1", {
        dryRun: false,
        vendors: expect.any(Array),
      });
    });
    expect(
      wrapper.get('[data-testid="market-vendor-import-result"]').text(),
    ).toContain("Created 1 restaurants and attached 2 vendors");
    expect(
      wrapper.get('[data-testid="market-vendor-import-result"]').text(),
    ).toContain("Public page needs setup (71%).");
    const readiness = wrapper.get(
      '[data-testid="market-vendor-catalog-readiness"]',
    );
    expect(readiness.text()).toContain("Searchable items 4");
    expect(readiness.text()).toContain("Public services1");
    expect(readiness.text()).toContain("Missing searchable items 1");
    expect(readiness.text()).toContain("Missing services2");
    expect(readiness.text()).toContain("Missing stall numbers 1");
    expect(readiness.text()).toContain("No search entrypoint 1");
    expect(readiness.text()).toContain("缺商品攤");
    expect(
      wrapper
        .get('[data-testid="manage-products-restaurant-456"]')
        .attributes("href"),
    ).toBe(
      "/dashboard/menu?adminRestaurantId=restaurant-456&adminRestaurantName=%E7%BC%BA%E5%95%86%E5%93%81%E6%94%A4",
    );
    expect(
      wrapper
        .get('[data-testid="manage-services-restaurant-456"]')
        .attributes("href"),
    ).toBe(
      "/dashboard/settings?adminRestaurantId=restaurant-456&adminRestaurantName=%E7%BC%BA%E5%95%86%E5%93%81%E6%94%A4&tab=contact",
    );
  });
});

it("retains visible names for every market metadata field after typing", async () => {
  const wrapper = mount(MarketsView);
  const form = wrapper.get("form");
  for (const control of form.findAll(
    "input:not([type=time]):not([type=checkbox]), select, textarea",
  )) {
    const id = control.attributes("id");
    expect(id).toBeTruthy();
    expect(form.find(`label[for="${id}"]`).exists()).toBe(true);
  }
});
