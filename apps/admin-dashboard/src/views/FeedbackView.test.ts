// @vitest-environment jsdom

import { flushPromises, mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FeedbackView from "./FeedbackView.vue";
import type { FeedbackFilters, FeedbackItem } from "@/composables/useFeedback";

const feedbackApi = vi.hoisted(() => ({
  fetchFeedback: vi.fn(),
  fetchFeedbackById: vi.fn(),
  fetchStats: vi.fn(),
}));

vi.mock("@/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock("@/stores/auth", () => ({
  useAuthStore: () => ({ user: { id: 10, role: 1 } }),
}));

vi.mock("@/composables/useFeedback", () => ({
  useFeedback: () => ({
    isLoading: false,
    ...feedbackApi,
  }),
}));

function feedback(overrides: Partial<FeedbackItem> = {}): FeedbackItem {
  return {
    id: 1,
    restaurantId: "restaurant-1",
    userId: "019469a1-0010-7000-8000-000000000010",
    category: "bug_report",
    priority: "medium",
    status: "resolved",
    relatedModule: "orders",
    subject: "Resolved ticket",
    description: "A resolved support ticket",
    attachmentUrls: [],
    createdAt: "2026-08-28T00:00:00.000Z",
    updatedAt: "2026-08-28T00:00:00.000Z",
    resolvedAt: "2026-08-28T01:00:00.000Z",
    resolvedBy: "019469a1-0099-7000-8000-000000000099",
    ...overrides,
  };
}

function mountView() {
  return mount(FeedbackView, {
    global: {
      stubs: {
        FeedbackForm: {
          name: "FeedbackForm",
          template: '<div data-testid="feedback-form" />',
        },
        FeedbackDetail: true,
        FeedbackStats: true,
      },
    },
  });
}

describe("FeedbackView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    feedbackApi.fetchFeedback.mockImplementation(
      async (filters: FeedbackFilters = {}) => ({
        feedback: [feedback()],
        pagination: {
          page: filters.page ?? 1,
          limit: 20,
          total: 40,
          totalPages: 2,
        },
      }),
    );
    feedbackApi.fetchFeedbackById.mockImplementation(async (id: number) =>
      feedback({ id }),
    );
    feedbackApi.fetchStats.mockResolvedValue({
      total: 1,
      byStatus: { resolved: 1 },
      byCategory: { bug_report: 1 },
      byPriority: { medium: 1 },
      avgResolutionTimeMs: 3_600_000,
    });
  });

  afterEach(() => vi.useRealTimers());

  it("resets pagination before applying select and search filters", async () => {
    const wrapper = mountView();
    await flushPromises();

    async function goToSecondPage() {
      const next = wrapper
        .findAll("button")
        .find((button) => button.text() === "common.next");
      await next!.trigger("click");
      await flushPromises();
    }

    await goToSecondPage();
    await wrapper.findAll("select")[0].setValue("resolved");
    await flushPromises();
    expect(feedbackApi.fetchFeedback).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 1, status: "resolved" }),
    );

    await goToSecondPage();
    await wrapper.findAll("select")[1].setValue("bug_report");
    await flushPromises();
    expect(feedbackApi.fetchFeedback).toHaveBeenLastCalledWith(
      expect.objectContaining({
        page: 1,
        status: "resolved",
        category: "bug_report",
      }),
    );

    await goToSecondPage();
    await wrapper.findAll("select")[2].setValue("high");
    await flushPromises();
    expect(feedbackApi.fetchFeedback).toHaveBeenLastCalledWith(
      expect.objectContaining({
        page: 1,
        status: "resolved",
        category: "bug_report",
        priority: "high",
      }),
    );

    await goToSecondPage();
    vi.useFakeTimers();
    await wrapper.find("input").setValue("payment");
    await vi.advanceTimersByTimeAsync(400);
    await flushPromises();
    expect(feedbackApi.fetchFeedback).toHaveBeenLastCalledWith(
      expect.objectContaining({
        page: 1,
        search: "payment",
        status: "resolved",
        category: "bug_report",
        priority: "high",
      }),
    );
  });

  it("clears all active filters and returns to the first page", async () => {
    const wrapper = mountView();
    await flushPromises();
    await wrapper.findAll("select")[0].setValue("resolved");
    await flushPromises();
    await wrapper
      .get('[data-testid="clear-feedback-filters"]')
      .trigger("click");
    await flushPromises();
    expect(feedbackApi.fetchFeedback).toHaveBeenLastCalledWith({
      page: 1,
      limit: 20,
    });
    expect(
      (wrapper.findAll("select")[0].element as HTMLSelectElement).value,
    ).toBe("");
  });

  it("reloads the active filtered list after an owner submits feedback", async () => {
    const wrapper = mountView();
    await flushPromises();
    await wrapper.findAll("select")[0].setValue("resolved");
    await flushPromises();

    const submitButton = wrapper
      .findAll("button")
      .find((button) => button.text() === "feedback.submit");
    await submitButton!.trigger("click");
    await nextTick();

    wrapper.findComponent({ name: "FeedbackForm" }).vm.$emit(
      "submitted",
      feedback({
        id: 2,
        status: "open",
        subject: "New open ticket",
        resolvedAt: null,
        resolvedBy: null,
      }),
    );
    await flushPromises();

    expect(feedbackApi.fetchFeedback).toHaveBeenCalledTimes(3);
    expect(feedbackApi.fetchFeedback).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 1, status: "resolved" }),
    );
    expect(wrapper.text()).not.toContain("New open ticket");
  });
});
