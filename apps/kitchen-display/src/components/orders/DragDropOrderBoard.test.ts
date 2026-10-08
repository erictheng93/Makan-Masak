import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import DragDropOrderBoard from "./DragDropOrderBoard.vue";
import type { KitchenOrder } from "@/types";

type SortableHandlers = {
  onStart?: (event: { item: HTMLElement }) => void;
  onEnd?: (event: {
    item: HTMLElement;
    from: HTMLElement;
    to: HTMLElement;
  }) => void;
  onMove?: (event: { to: HTMLElement }) => boolean;
};

const sortableHandlers: SortableHandlers[] = [];
const toast = {
  success: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
};

vi.mock("@vueuse/integrations/useSortable", () => ({
  useSortable: vi.fn(
    (_element: HTMLElement, _items: unknown[], handlers: SortableHandlers) => {
      sortableHandlers.push(handlers);
      return {};
    },
  ),
}));

vi.mock("vue-toastification", () => ({
  useToast: () => toast,
}));

const pendingOrder = makeOrder({
  id: 1001,
  orderNumber: "A001",
  status: "pending",
  items: [
    {
      id: 501,
      name: "Noodles",
      quantity: 1,
      status: "pending",
      priority: "normal",
    },
  ],
});

const preparingOrder = makeOrder({
  id: 1002,
  orderNumber: "A002",
  status: "preparing",
  items: [
    {
      id: 601,
      name: "Dumplings",
      quantity: 2,
      status: "preparing",
      priority: "normal",
    },
  ],
});

function makeOrder(overrides: Partial<KitchenOrder>): KitchenOrder {
  return {
    id: 1,
    orderNumber: "A000",
    status: "pending",
    deliveryInfo: { type: "dine_in" },
    items: [],
    createdAt: "2026-06-08T01:00:00.000Z",
    totalItems: 0,
    priority: "normal",
    elapsedTime: 5,
    ...overrides,
  };
}

function mountBoard(props = {}) {
  return mount(DragDropOrderBoard, {
    props: {
      pendingOrders: [pendingOrder],
      preparingOrders: [preparingOrder],
      readyOrders: [],
      ...props,
    },
    global: {
      plugins: [createPinia()],
      stubs: {
        DraggableOrderCard: {
          props: [
            "order",
            "statusType",
            "isDragging",
            "isDragOver",
            "isSelected",
          ],
          emits: [
            "start-cooking",
            "mark-ready",
            "view-details",
            "toggle-selection",
          ],
          template: `
            <article
              :data-testid="'draggable-' + order.id"
              :data-order-id="order.id"
              :data-status-type="statusType"
              :data-dragging="String(isDragging)"
              :data-drag-over="String(isDragOver)"
              :data-selected="String(isSelected)"
            >
              {{ order.orderNumber }}
              <button :data-testid="'start-' + order.id" @click="$emit('start-cooking', order.id, order.items[0].id)" />
              <button :data-testid="'ready-' + order.id" @click="$emit('mark-ready', order.id, order.items[0].id)" />
              <button :data-testid="'details-' + order.id" @click="$emit('view-details', order)" />
              <button :data-testid="'select-' + order.id" @click="$emit('toggle-selection', order.id)" />
            </article>
          `,
        },
      },
    },
  });
}

describe("DragDropOrderBoard", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    sortableHandlers.length = 0;
    toast.success.mockClear();
    toast.info.mockClear();
    toast.error.mockClear();
    document.body.className = "";
  });

  it("renders status columns with counts and empty ready state", async () => {
    const wrapper = mountBoard();
    await nextTick();

    expect(wrapper.text()).toContain("待處理");
    expect(wrapper.text()).toContain("製作中");
    expect(wrapper.text()).toContain("準備完成");
    expect(wrapper.text()).toContain("A001");
    expect(wrapper.text()).toContain("A002");
    expect(wrapper.find('[data-status-type="pending"]').exists()).toBe(true);
    expect(wrapper.find('[data-status-type="preparing"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("目前沒有準備完成的訂單");
  });

  it("switches the active order lane from the mobile status controls", async () => {
    const wrapper = mountBoard();
    const statusButtons = wrapper.findAll("button[aria-pressed]");

    expect(statusButtons).toHaveLength(3);
    expect(
      statusButtons.map((button) => button.attributes("aria-pressed")),
    ).toEqual(["true", "false", "false"]);

    await statusButtons[1].trigger("click");

    expect(
      statusButtons.map((button) => button.attributes("aria-pressed")),
    ).toEqual(["false", "true", "false"]);
  });

  it("forwards card action events and records selected state in the store", async () => {
    const wrapper = mountBoard();

    await wrapper.get('[data-testid="start-1001"]').trigger("click");
    await wrapper.get('[data-testid="ready-1002"]').trigger("click");
    await wrapper.get('[data-testid="details-1001"]').trigger("click");
    await wrapper.get('[data-testid="select-1001"]').trigger("click");
    await nextTick();

    expect(wrapper.emitted("start-cooking")).toEqual([[1001, 501]]);
    expect(wrapper.emitted("mark-ready")).toEqual([[1002, 601]]);
    expect(wrapper.emitted("view-details")).toEqual([[pendingOrder]]);
    expect(wrapper.emitted("toggle-selection")).toEqual([[1001]]);
    expect(
      wrapper.get('[data-testid="draggable-1001"]').attributes("data-selected"),
    ).toBe("true");
  });

  it("emits batch status events and toast feedback after drag transitions", async () => {
    const wrapper = mountBoard();
    await nextTick();

    const dragged = document.createElement("article");
    dragged.dataset.orderId = "1001";
    const from = document.createElement("section");
    from.dataset.status = "pending";
    const to = document.createElement("section");
    to.dataset.status = "preparing";

    sortableHandlers[0].onStart?.({ item: dragged });
    await nextTick();

    expect(document.body.classList.contains("dragging-order")).toBe(true);
    expect(
      wrapper.get('[data-testid="draggable-1001"]').attributes("data-dragging"),
    ).toBe("true");

    expect(sortableHandlers[0].onMove?.({ to })).toBe(true);
    await nextTick();

    expect(
      wrapper
        .get('[data-testid="draggable-1002"]')
        .attributes("data-drag-over"),
    ).toBe("true");

    sortableHandlers[0].onEnd?.({ item: dragged, from, to });
    await nextTick();

    expect(wrapper.emitted("order-status-changed")).toEqual([
      [1001, "preparing"],
    ]);
    expect(wrapper.emitted("batch-start-order")).toEqual([[1001]]);
    expect(toast.success).toHaveBeenCalledWith("訂單已開始製作！");
    expect(document.body.classList.contains("dragging-order")).toBe(false);
    expect(
      wrapper.get('[data-testid="draggable-1001"]').attributes("data-dragging"),
    ).toBe("false");
  });
});
