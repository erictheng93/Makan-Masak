import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OrderReviewSection from "@/components/reviews/OrderReviewSection.vue";
import { orderApi } from "@/services/orderApi";
import type { OrderReview } from "@/services/orderApi";

vi.mock("@/services/orderApi", () => ({
  orderApi: {
    getOrderReview: vi.fn(),
    submitOrderReview: vi.fn(),
  },
}));

vi.mock("vue-toastification", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

vi.mock("@/composables/useI18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    tWithParams: (key: string, params: Record<string, unknown>) =>
      `${key}:${Object.values(params).join(",")}`,
  }),
}));

/**
 * The two order-item rows for dish 42 are deliberate: an order may list the
 * same dish twice, and the contract ratings are keyed on `menuItemId`, so the
 * form must offer one row for it.
 */
interface OrderLineItem {
  id: number;
  menuItemId: number;
  name: string;
  quantity: number;
}

function buildOrderItems(
  overrides: OrderLineItem[] | null = null,
): OrderLineItem[] {
  return (
    overrides ?? [
      { id: 1, menuItemId: 42, name: "章魚燒", quantity: 1 },
      { id: 2, menuItemId: 42, name: "章魚燒", quantity: 2 },
      { id: 3, menuItemId: 77, name: "珍珠奶茶", quantity: 1 },
    ]
  );
}

function buildReview(overrides: Partial<OrderReview> = {}): OrderReview {
  return {
    id: "review-1",
    orderId: "order-1",
    restaurantId: "restaurant-1",
    rating: 4,
    content: "餐點很好吃",
    createdAt: 1_757_000_000_000,
    updatedAt: 1_757_000_000_000,
    reply: null,
    items: [{ menuItemId: 42, menuItemName: "章魚燒", rating: 5 }],
    ...overrides,
  };
}

function mountSection(props: Record<string, unknown> = {}) {
  return mount(OrderReviewSection, {
    props: {
      orderId: "order-1",
      orderStatus: "delivered",
      items: buildOrderItems(),
      ...props,
    },
  });
}

describe("OrderReviewSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(orderApi.getOrderReview).mockResolvedValue(null);
  });

  it("offers no review affordance on an order that has not been served", async () => {
    const wrapper = mountSection({ orderStatus: "preparing" });
    await flushPromises();

    expect(wrapper.find('[data-testid="order-review-cta"]').exists()).toBe(
      false,
    );
    expect(wrapper.find('[data-testid="order-review-card"]').exists()).toBe(
      false,
    );
    // No read either: an unfinished order cannot carry a review, and asking
    // costs a request on every card in the history list.
    expect(orderApi.getOrderReview).not.toHaveBeenCalled();
  });

  it("invites a review on a completed order that has none", async () => {
    const wrapper = mountSection({ orderStatus: "paid" });
    await flushPromises();

    expect(orderApi.getOrderReview).toHaveBeenCalledOnce();
    expect(orderApi.getOrderReview).toHaveBeenCalledWith("order-1");
    expect(wrapper.find('[data-testid="order-review-cta"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-testid="order-review-card"]').exists()).toBe(
      false,
    );
  });

  it("shows an existing review read-only, with the shop's reply and no CTA", async () => {
    vi.mocked(orderApi.getOrderReview).mockResolvedValue(
      buildReview({
        reply: { content: "謝謝您的支持", repliedBy: null, repliedAt: 1 },
      }),
    );

    const wrapper = mountSection();
    await flushPromises();

    const card = wrapper.find('[data-testid="order-review-card"]');
    expect(card.exists()).toBe(true);
    expect(card.text()).toContain("餐點很好吃");
    expect(wrapper.find('[data-testid="order-review-reply"]').text()).toContain(
      "謝謝您的支持",
    );
    expect(wrapper.find('[data-testid="order-review-cta"]').exists()).toBe(
      false,
    );
  });

  it("sends the chosen rating, text and per-dish ratings, then shows the card", async () => {
    vi.mocked(orderApi.submitOrderReview).mockResolvedValue(
      buildReview({ rating: 4, content: "服務很好" }),
    );

    const wrapper = mountSection();
    await flushPromises();

    await wrapper.find('[data-testid="order-review-cta"]').trigger("click");
    expect(wrapper.find('[data-testid="order-review-form"]').exists()).toBe(
      true,
    );

    await wrapper.find('[data-testid="order-review-star-4"]').trigger("click");
    await wrapper
      .find('[data-testid="order-review-content"]')
      .setValue("服務很好");
    await wrapper
      .find('[data-testid="order-review-item-42-star-5"]')
      .trigger("click");
    await wrapper.find('[data-testid="order-review-submit"]').trigger("click");
    await flushPromises();

    expect(orderApi.submitOrderReview).toHaveBeenCalledOnce();
    expect(orderApi.submitOrderReview).toHaveBeenCalledWith(
      "order-1",
      expect.objectContaining({
        rating: 4,
        content: "服務很好",
        items: [expect.objectContaining({ menuItemId: 42, rating: 5 })],
      }),
    );
    expect(wrapper.find('[data-testid="order-review-card"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-testid="order-review-form"]').exists()).toBe(
      false,
    );
  });

  it("keeps submit disabled until a rating is chosen", async () => {
    const wrapper = mountSection();
    await flushPromises();
    await wrapper.find('[data-testid="order-review-cta"]').trigger("click");

    const submit = wrapper.find('[data-testid="order-review-submit"]');
    expect(submit.attributes("disabled")).toBeDefined();

    await wrapper.find('[data-testid="order-review-star-3"]').trigger("click");
    expect(
      wrapper
        .find('[data-testid="order-review-submit"]')
        .attributes("disabled"),
    ).toBeUndefined();
  });

  it("offers one row per dish even when the order lists it twice", async () => {
    const wrapper = mountSection();
    await flushPromises();
    await wrapper.find('[data-testid="order-review-cta"]').trigger("click");

    expect(
      wrapper.findAll('[data-testid="order-review-item-42-star-1"]'),
    ).toHaveLength(1);
    expect(
      wrapper.findAll('[data-testid="order-review-item-77-star-1"]'),
    ).toHaveLength(1);
  });

  it("shows the review that already exists when the server rejects a duplicate", async () => {
    // Two tabs, or a retry after a dropped response. The diner should end up
    // looking at their review, not at a 409.
    vi.mocked(orderApi.submitOrderReview).mockRejectedValue(
      Object.assign(new Error("conflict"), {
        status: 409,
        code: "REVIEW_ALREADY_EXISTS",
      }),
    );
    vi.mocked(orderApi.getOrderReview)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(buildReview({ content: "先前留下的評價" }));

    const wrapper = mountSection();
    await flushPromises();
    await wrapper.find('[data-testid="order-review-cta"]').trigger("click");
    await wrapper.find('[data-testid="order-review-star-5"]').trigger("click");
    await wrapper.find('[data-testid="order-review-submit"]').trigger("click");
    await flushPromises();

    expect(orderApi.getOrderReview).toHaveBeenCalledTimes(2);
    const card = wrapper.find('[data-testid="order-review-card"]');
    expect(card.exists()).toBe(true);
    expect(card.text()).toContain("先前留下的評價");
  });

  it("retires the CTA with a note when the order turns out not to be reviewable", async () => {
    vi.mocked(orderApi.submitOrderReview).mockRejectedValue(
      Object.assign(new Error("conflict"), {
        status: 409,
        code: "ORDER_NOT_REVIEWABLE",
      }),
    );

    const wrapper = mountSection();
    await flushPromises();
    await wrapper.find('[data-testid="order-review-cta"]').trigger("click");
    await wrapper.find('[data-testid="order-review-star-5"]').trigger("click");
    await wrapper.find('[data-testid="order-review-submit"]').trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-testid="order-review-cta"]').exists()).toBe(
      false,
    );
    expect(wrapper.find('[data-testid="order-review-form"]').exists()).toBe(
      false,
    );
    expect(wrapper.text()).toContain("review.notReviewable");
  });

  it("keeps the form open with an inline message on any other failure", async () => {
    vi.mocked(orderApi.submitOrderReview).mockRejectedValue(
      Object.assign(new Error("boom"), { status: 500 }),
    );

    const wrapper = mountSection();
    await flushPromises();
    await wrapper.find('[data-testid="order-review-cta"]').trigger("click");
    await wrapper.find('[data-testid="order-review-star-2"]').trigger("click");
    await wrapper.find('[data-testid="order-review-submit"]').trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-testid="order-review-form"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-testid="order-review-error"]').exists()).toBe(
      true,
    );
  });
});
