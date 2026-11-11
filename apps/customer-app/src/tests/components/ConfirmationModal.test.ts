import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import { mount, VueWrapper, DOMWrapper, flushPromises } from "@vue/test-utils";
import ConfirmationModal from "@/components/ConfirmationModal.vue";

// Headless UI observes dialog visibility; jsdom has no layout observer.
beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterAll(() => vi.unstubAllGlobals());

describe("ConfirmationModal.vue", () => {
  let wrapper: VueWrapper<unknown>;

  const defaultProps = {
    show: true,
    title: "確認操作",
    message: "您確定要執行此操作嗎？",
    confirmText: "確認",
    cancelText: "取消",
    loading: false,
  };

  beforeEach(async () => {
    wrapper = mount(ConfirmationModal, {
      props: defaultProps,
      attachTo: document.body,
    });
    await flushPromises();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    document.body.innerHTML = "";
  });

  const content = () =>
    new DOMWrapper(
      document.querySelector('[data-testid="confirmation-panel"]') ??
        document.createElement("div"),
    );

  describe("dialog keyboard interaction", () => {
    it("names and describes the dialog and initially focuses Cancel", async () => {
      const dialog = document.querySelector('[role="dialog"]');
      expect(dialog).not.toBeNull();
      expect(
        document
          .getElementById(dialog!.getAttribute("aria-labelledby")!)
          ?.textContent?.trim(),
      ).toBe(defaultProps.title);
      expect(
        document
          .getElementById(dialog!.getAttribute("aria-describedby")!)
          ?.textContent?.trim(),
      ).toBe(defaultProps.message);
      await vi.waitFor(() =>
        expect(document.activeElement).toBe(
          document.querySelector('[data-testid="confirmation-cancel"]'),
        ),
      );
    });

    it("Escape cancels and restores the actual opener after closing", async () => {
      await wrapper.setProps({ show: false });
      const opener = document.createElement("button");
      opener.innerHTML = "<span>Place order</span>";
      document.body.append(opener);
      opener.focus();
      const label = new DOMWrapper(opener.firstElementChild!);
      await label.trigger("mousedown");
      await label.trigger("click");
      await wrapper.setProps({ show: true });
      await flushPromises();
      document
        .querySelector('[data-testid="confirmation-cancel"]')!
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
      await flushPromises();
      expect(wrapper.emitted("cancel")).toEqual([[]]);
      await wrapper.setProps({ show: false });
      await flushPromises();
      expect(document.activeElement).toBe(opener);
    });

    it("does not dismiss a loading confirmation through Escape or the backdrop", async () => {
      await wrapper.setProps({ show: false, loading: true });
      await wrapper.setProps({ show: true });
      await flushPromises();
      await vi.waitFor(() =>
        expect(document.activeElement).toBe(
          document.querySelector('[data-testid="confirmation-panel"]'),
        ),
      );
      document
        .querySelector('[data-testid="confirmation-modal"]')!
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
      const backdrop = new DOMWrapper(
        document.querySelector('[data-testid="confirmation-backdrop"]') ??
          document.querySelector('[data-testid="confirmation-modal"]')!,
      );
      await backdrop.trigger("mousedown");
      await backdrop.trigger("click");
      await flushPromises();
      expect(wrapper.emitted("cancel")).toBeUndefined();
    });
  });

  describe("基本渲染", () => {
    it("應該正確渲染標題", () => {
      expect(content().text()).toContain("確認操作");
    });

    it("應該正確渲染訊息", () => {
      expect(content().text()).toContain("您確定要執行此操作嗎？");
    });

    it("應該正確渲染確認按鈕文字", () => {
      const confirmBtn = content().findAll("button")[0];
      expect(confirmBtn.text()).toContain("確認");
    });

    it("應該正確渲染取消按鈕文字", () => {
      const buttons = content().findAll("button");
      const cancelBtn = buttons[1];
      expect(cancelBtn.text()).toContain("取消");
    });
  });

  describe("模態框控制", () => {
    it("當 show 為 true 時應該顯示模態框", () => {
      expect(content().text()).toContain("確認操作");
      expect(content().text()).toContain("您確定要執行此操作嗎？");
    });

    it("當 show 為 false 時應該隱藏模態框", async () => {
      await wrapper.setProps({ show: false });

      expect(content().text()).toBe("");
    });

    it("應該有模態框背景遮罩", () => {
      // The root element serves as backdrop and handles cancel on click
      const rootDiv = content().find("div");
      expect(rootDiv.exists()).toBe(true);
    });
  });

  describe("按鈕內容", () => {
    it("確認按鈕應該顯示確認文字", () => {
      const confirmBtn = content().findAll("button")[0];
      expect(confirmBtn.text()).toContain("確認");
    });

    it("取消按鈕應該顯示取消文字", () => {
      const buttons = content().findAll("button");
      const cancelBtn = buttons[1];
      expect(cancelBtn.text()).toContain("取消");
    });
  });

  describe("事件處理", () => {
    it("點擊確認按鈕應該觸發 confirm 事件", async () => {
      const confirmBtn = content().findAll("button")[0];
      await confirmBtn.trigger("click");

      expect(wrapper.emitted("confirm")).toBeTruthy();
      expect(wrapper.emitted("confirm")).toHaveLength(1);
    });

    it("點擊取消按鈕應該觸發 cancel 事件", async () => {
      const buttons = content().findAll("button");
      const cancelBtn = buttons[1];
      await cancelBtn.trigger("click");

      expect(wrapper.emitted("cancel")).toBeTruthy();
      expect(wrapper.emitted("cancel")).toHaveLength(1);
    });

    it("點擊背景遮罩應該觸發 cancel 事件", async () => {
      const backdrop = new DOMWrapper(
        document.querySelector('[data-testid="confirmation-backdrop"]')!,
      );
      await backdrop.trigger("mousedown");
      await backdrop.trigger("click");

      expect(wrapper.emitted("cancel")).toBeTruthy();
    });
  });

  describe("載入狀態", () => {
    it("應該支援載入狀態", async () => {
      await wrapper.setProps({ loading: true });

      const confirmBtn = content().findAll("button")[0];
      expect(confirmBtn.attributes("disabled")).toBeDefined();
    });

    it("載入時取消按鈕應該被禁用", async () => {
      await wrapper.setProps({ loading: true });

      const buttons = content().findAll("button");
      const cancelBtn = buttons[1];
      expect(cancelBtn.attributes("disabled")).toBeDefined();
    });

    it("載入狀態時確認按鈕仍然顯示確認文字", async () => {
      await wrapper.setProps({ loading: true });

      const confirmBtn = content().findAll("button")[0];
      expect(confirmBtn.text()).toContain("確認");
      expect(confirmBtn.attributes("disabled")).toBeDefined();
    });
  });

  describe("圖標顯示", () => {
    it("應該顯示預設問號圖標", () => {
      const icon = content().find("svg");
      expect(icon.exists()).toBe(true);
    });
  });

  describe("結構", () => {
    it("應該渲染模態框容器", () => {
      expect(content().text()).toContain("確認操作");
      expect(content().findAll("button")).toHaveLength(2);
    });
  });

  describe("內容區域", () => {
    it("標題應該渲染為 h3 元素", () => {
      const title = content().find("h3");
      expect(title.exists()).toBe(true);
      expect(title.text()).toBe("確認操作");
    });

    it("訊息應該渲染為 p 元素", () => {
      const message = content().find("p");
      expect(message.exists()).toBe(true);
      expect(message.text()).toBe("您確定要執行此操作嗎？");
    });
  });

  describe("按鈕區域", () => {
    it("應該有兩個按鈕", () => {
      const buttons = content().findAll("button");
      expect(buttons).toHaveLength(2);
    });

    it("確認按鈕應該在取消按鈕之前", () => {
      const buttons = content().findAll("button");
      expect(buttons.length).toBe(2);

      // 確認按鈕是第一個
      expect(buttons[0].text()).toContain("確認");
      // 取消按鈕是第二個
      expect(buttons[1].text()).toContain("取消");
    });
  });

  describe("邊界情況", () => {
    it("應該處理空的標題", async () => {
      await wrapper.setProps({ title: "" });

      const title = content().find("h3");
      expect(title.exists()).toBe(true);
      expect(title.text()).toBe("");
    });

    it("應該處理空的訊息", async () => {
      await wrapper.setProps({ message: "" });

      const message = content().find("p");
      expect(message.exists()).toBe(true);
      expect(message.text()).toBe("");
    });

    it("應該處理長文本", async () => {
      const longMessage = "這是一個非常長的確認訊息".repeat(10);
      await wrapper.setProps({ message: longMessage });

      const message = content().find("p");
      expect(message.text()).toContain(longMessage);
    });
  });

  describe("結構完整性", () => {
    it("應該包含標題、訊息和兩個按鈕", () => {
      expect(content().find("h3").exists()).toBe(true);
      expect(content().find("p").exists()).toBe(true);
      expect(content().findAll("button")).toHaveLength(2);
    });
  });

  describe("可存取性", () => {
    it("按鈕應該是按鈕類型", () => {
      const buttons = content().findAll("button");

      buttons.forEach((button) => {
        expect(button.element.tagName).toBe("BUTTON");
      });
    });

    it("模態框應該阻止背景點擊冒泡", async () => {
      await content().trigger("mousedown");
      await content().trigger("click");

      // 不應該觸發 cancel 事件
      expect(wrapper.emitted("cancel")).toBeFalsy();
    });
  });
});
