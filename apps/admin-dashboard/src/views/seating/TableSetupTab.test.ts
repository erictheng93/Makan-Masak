// @vitest-environment jsdom

import { defineComponent, ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TableSetupTab from "./TableSetupTab.vue";
import { api } from "@/services/api";
import type { PrintableQRCode } from "@/utils/qrPrintSheet";

// restaurants.id is a TEXT UUID v7 — the whole point of this suite is that it
// must reach the API as a string, never coerced through Number().
const RESTAURANT_ID = "019469a0-0099-7000-8000-000000000099";

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}));

const confirmMock = vi.hoisted(() => vi.fn());

vi.mock("@/stores/auth", () => ({
  useAuthStore: () => ({ restaurantId: RESTAURANT_ID }),
}));

vi.mock("vue-router", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useRoute: () => ({ query: {} }),
}));

vi.mock("@/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key, locale: ref("zh-TW") }),
}));

vi.mock("vue-toastification", () => ({
  useToast: () => toastMock,
}));

vi.mock("@/composables/useConfirmModal", () => ({
  useConfirmModal: () => ({ confirm: confirmMock }),
}));

const printQRCodeSheetMock = vi.hoisted(() =>
  vi.fn((_title: string, _qrCodes: PrintableQRCode[]) => true),
);
const printQRCodeSheetInWindowMock = vi.hoisted(() =>
  vi.fn((_window: Window, _title: string, _qrCodes: PrintableQRCode[]) => true),
);
const toPrintableDataUrlMock = vi.hoisted(() =>
  vi.fn(async (content: string) => `data:image/png;base64,${content}`),
);

vi.mock("@/utils/qrPrintSheet", () => ({
  printQRCodeSheet: printQRCodeSheetMock,
  printQRCodeSheetInWindow: printQRCodeSheetInWindowMock,
  toPrintableDataUrl: toPrintableDataUrlMock,
}));

vi.mock("@/services/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  unwrapApiList: (data: unknown) => (Array.isArray(data) ? data : []),
}));

const QRCodeRendererStub = defineComponent({
  name: "QRCodeRenderer",
  props: {
    content: { type: String, required: true },
    size: { type: Number, default: 0 },
    padding: { type: Number, default: 0 },
    containerClass: { type: String, default: "" },
  },
  template: `<div data-testid="qr-renderer" :data-content="content" />`,
});

function buildTable(overrides: Record<string, unknown> = {}) {
  return {
    id: 11,
    number: "A1",
    name: "Window",
    capacity: 4,
    location: "1F",
    isActive: true,
    isOccupied: false,
    qrCode: `qr-${(overrides as { id?: number }).id ?? 11}`,
    ...overrides,
  };
}

async function mountTab(tables: Record<string, unknown>[] = []) {
  vi.mocked(api.get).mockResolvedValue({
    data: { success: true, data: tables },
  } as never);

  const wrapper = mount(TableSetupTab, {
    global: {
      stubs: { QRModeSelector: true, QRCodeRenderer: QRCodeRendererStub },
    },
  });
  await flushPromises();
  return wrapper;
}

describe("TableSetupTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, "open").mockReturnValue({} as Window);
    confirmMock.mockResolvedValue(true);
  });

  it("follows table occupancy in the background, quietly, until it is left", async () => {
    vi.useFakeTimers();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    try {
      const wrapper = await mountTab([buildTable()]);
      const tableLoads = () =>
        vi.mocked(api.get).mock.calls.filter(([url]) => url === "/tables")
          .length;
      expect(tableLoads()).toBe(1);

      vi.mocked(api.get).mockRejectedValueOnce(new Error("network"));
      await vi.advanceTimersByTimeAsync(30_000);
      expect(tableLoads()).toBe(2);
      expect(toastMock.error).not.toHaveBeenCalled();

      wrapper.unmount();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(tableLoads()).toBe(2);
    } finally {
      consoleError.mockRestore();
      vi.useRealTimers();
    }
  });

  it("sends restaurantId as a string when creating a table", async () => {
    const wrapper = await mountTab();
    vi.mocked(api.post).mockResolvedValue({ data: { success: true } } as never);

    const vm = wrapper.vm as unknown as {
      tableForm: { tableNumber: string; capacity: number };
      saveTable: () => Promise<void>;
    };
    vm.tableForm.tableNumber = "A1";
    vm.tableForm.capacity = 4;
    await vm.saveTable();
    await flushPromises();

    expect(api.post).toHaveBeenCalledWith(
      "/tables",
      expect.objectContaining({ restaurantId: RESTAURANT_ID, number: "A1" }),
    );
    // Regression guard: Number(uuid) is NaN, which JSON-serialises to null and
    // the API rejects with VALIDATION_ERROR.
    const payload = vi.mocked(api.post).mock.calls[0][1] as {
      restaurantId: unknown;
    };
    expect(typeof payload.restaurantId).toBe("string");
    expect(toastMock.success).toHaveBeenCalled();
  });

  it("sends seat mode configuration when creating a table", async () => {
    const wrapper = await mountTab();
    vi.mocked(api.post).mockResolvedValue({
      data: {
        success: true,
        data: { ...buildTable(), qrMode: "seat", seatCount: 4 },
      },
    } as never);

    const vm = wrapper.vm as unknown as {
      tableForm: {
        tableNumber: string;
        capacity: number;
        qrMode: "table" | "seat";
        seatConfig: {
          count: number;
          numberingStyle: "numeric" | "alphabetic";
        };
      };
      saveTable: () => Promise<void>;
    };
    vm.tableForm.tableNumber = "A1";
    vm.tableForm.capacity = 4;
    vm.tableForm.qrMode = "seat";
    vm.tableForm.seatConfig = {
      count: 4,
      numberingStyle: "alphabetic",
    };

    await vm.saveTable();
    await flushPromises();

    expect(api.post).toHaveBeenCalledWith(
      "/tables",
      expect.objectContaining({
        qrMode: "seat",
        seatCount: 4,
        seatNumberingStyle: "alphabetic",
      }),
    );
    expect(api.post).not.toHaveBeenCalledWith(
      "/seats/batch-create",
      expect.anything(),
    );
  });

  it("maps persisted seat settings back into the edit form", async () => {
    const wrapper = await mountTab([
      buildTable({
        qrMode: "seat",
        seatCount: 3,
        seatNumberingStyle: "alphabetic",
      }),
    ]);

    const vm = wrapper.vm as unknown as {
      tables: Array<Record<string, unknown>>;
      tableForm: {
        qrMode: "table" | "seat";
        seatConfig: { count: number; numberingStyle: string };
      };
      editTable: (table: Record<string, unknown>) => void;
    };
    vm.editTable(vm.tables[0]);

    expect(vm.tableForm.qrMode).toBe("seat");
    expect(vm.tableForm.seatConfig).toEqual({
      count: 3,
      numberingStyle: "alphabetic",
    });
  });

  it("requests up to 100 tables and retains pagination metadata", async () => {
    const wrapper = await mountTab();
    vi.mocked(api.get).mockResolvedValue({
      data: {
        success: true,
        data: [buildTable()],
        pagination: { page: 1, limit: 100, total: 101, totalPages: 2 },
      },
    } as never);

    await (
      wrapper.vm as unknown as { fetchTables: () => Promise<void> }
    ).fetchTables();
    await flushPromises();

    expect(api.get).toHaveBeenLastCalledWith("/tables", {
      restaurantId: RESTAURANT_ID,
      limit: 100,
    });
    expect(
      (wrapper.vm as unknown as { tablePagination: { total: number } })
        .tablePagination.total,
    ).toBe(101);
    expect(wrapper.text()).toContain("tables.listTruncated");
  });

  it("does not send seatCount when editing an existing seat-mode table", async () => {
    const wrapper = await mountTab([
      buildTable({ qrMode: "seat", seatCount: 4, capacity: 4 }),
    ]);
    vi.mocked(api.put).mockResolvedValue({ data: { success: true } } as never);

    const vm = wrapper.vm as unknown as {
      tables: Array<Record<string, unknown>>;
      tableForm: { capacity: number };
      editTable: (table: Record<string, unknown>) => void;
      saveTable: () => Promise<void>;
    };
    vm.editTable(vm.tables[0]);
    vm.tableForm.capacity = 5;
    await vm.saveTable();

    const payload = vi.mocked(api.put).mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(payload).not.toHaveProperty("seatCount");
  });

  it("sends restaurantId as a string when bulk-generating QR codes", async () => {
    const wrapper = await mountTab([buildTable()]);
    vi.mocked(api.post).mockResolvedValue({ data: { success: true } } as never);

    await (
      wrapper.vm as unknown as { generateAllQRCodes: () => Promise<void> }
    ).generateAllQRCodes();
    await flushPromises();

    expect(api.post).toHaveBeenCalledWith("/tables/bulk-qr", {
      restaurantId: RESTAURANT_ID,
      tableIds: [11],
    });
  });

  it("omits orderId when manually marking an available table occupied", async () => {
    const wrapper = await mountTab([buildTable()]);
    vi.mocked(api.post).mockResolvedValue({ data: { success: true } } as never);

    await (
      wrapper.vm as unknown as {
        changeTableStatus: (t: unknown) => Promise<void>;
      }
    ).changeTableStatus({ id: 11, status: "available" });
    await flushPromises();

    // orderId: 0 fails occupyTableSchema (positive number | non-empty string)
    expect(api.post).toHaveBeenCalledWith("/tables/11/occupy", {
      occupiedBy: "manual",
    });
    const payload = vi.mocked(api.post).mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(payload).not.toHaveProperty("orderId");
  });

  it("surfaces a toast instead of failing silently when saving fails", async () => {
    const wrapper = await mountTab();
    vi.mocked(api.post).mockRejectedValue(new Error("400"));

    const vm = wrapper.vm as unknown as {
      tableForm: { tableNumber: string };
      saveTable: () => Promise<void>;
    };
    vm.tableForm.tableNumber = "A1";
    await vm.saveTable();
    await flushPromises();

    expect(toastMock.error).toHaveBeenCalledWith("tables.alert.saveFailed");
  });

  it("surfaces a toast when a status change fails", async () => {
    const wrapper = await mountTab([buildTable()]);
    vi.mocked(api.post).mockRejectedValue(new Error("400"));

    await (
      wrapper.vm as unknown as {
        changeTableStatus: (t: unknown) => Promise<void>;
      }
    ).changeTableStatus({ id: 11, status: "available" });
    await flushPromises();

    expect(toastMock.error).toHaveBeenCalledWith(
      "tables.alert.statusChangeFailed",
    );
  });

  it("deletes an available table after confirmation", async () => {
    const wrapper = await mountTab([buildTable()]);
    vi.mocked(api.delete).mockResolvedValue({
      data: { success: true },
    } as never);

    await (
      wrapper.vm as unknown as {
        deleteTable: (table: Record<string, unknown>) => Promise<void>;
      }
    ).deleteTable({
      id: 11,
      tableNumber: "A1",
      status: "available",
      currentOrderId: null,
    });
    await flushPromises();

    expect(confirmMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "danger",
        title: "tables.confirm.deleteTitle",
        confirmLabel: "tables.confirm.deleteAction",
      }),
    );
    expect(api.delete).toHaveBeenCalledWith("/tables/11");
    expect(toastMock.success).toHaveBeenCalledWith(
      "tables.alert.deleteSuccess",
    );
  });

  it("opens the QR modal by clicking the QR preview itself", async () => {
    const wrapper = await mountTab([buildTable({ id: 11 })]);

    // The dedicated "view QR" button is gone — the code is the affordance.
    expect(
      wrapper.findAll("button").some((b) => b.text() === "tables.viewQR"),
    ).toBe(false);

    await wrapper.get('[data-testid="open-qr-11"]').trigger("click");

    const vm = wrapper.vm as unknown as {
      showQRModal: boolean;
      selectedTable: { id: number } | null;
    };
    expect(vm.showQRModal).toBe(true);
    expect(vm.selectedTable?.id).toBe(11);
  });

  it("still opens the QR modal for a table whose code is not ready", async () => {
    // The modal is the only place to regenerate, so a not-ready code must not
    // make the preview inert.
    const wrapper = await mountTab([
      buildTable({ id: 11, qrCode: "pending:019469" }),
    ]);

    await wrapper.get('[data-testid="open-qr-11"]').trigger("click");

    expect(
      (wrapper.vm as unknown as { showQRModal: boolean }).showQRModal,
    ).toBe(true);
  });

  it("disables deleting an occupied table from the table card", async () => {
    const wrapper = await mountTab([
      buildTable({ isOccupied: true, currentOrderId: "order-1" }),
    ]);

    const deleteButton = wrapper
      .findAll("button")
      .find((button) => button.text() === "common.delete");

    expect(deleteButton?.attributes("disabled")).toBeDefined();
    expect(deleteButton?.attributes("title")).toBe("tables.deleteBlocked");
  });
});

describe("TableSetupTab QR print selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, "open").mockReturnValue({} as Window);
    confirmMock.mockResolvedValue(true);
  });

  function vmOf(wrapper: Awaited<ReturnType<typeof mountTab>>) {
    return wrapper.vm as unknown as {
      selectedTableIds: number[];
      selectedPrintableCount: number;
      toggleTableSelection: (id: number) => void;
      toggleSelectAllFiltered: () => void;
      allFilteredSelected: boolean;
      printSelectedTableQRCodes: () => Promise<void>;
      printAllTableQRCodes: () => Promise<void>;
      searchQuery: string;
    };
  }

  it("starts with nothing selected", async () => {
    const vm = vmOf(
      await mountTab([
        buildTable({ id: 1, number: "A1" }),
        buildTable({ id: 2, number: "B1" }),
      ]),
    );
    expect(vm.selectedTableIds).toEqual([]);
    expect(vm.selectedPrintableCount).toBe(0);
  });

  it("toggles a single table on and off", async () => {
    const vm = vmOf(await mountTab([buildTable({ id: 1 })]));
    vm.toggleTableSelection(1);
    expect(vm.selectedTableIds).toEqual([1]);
    vm.toggleTableSelection(1);
    expect(vm.selectedTableIds).toEqual([]);
  });

  it("keeps a selection made under one filter when the filter changes", async () => {
    const wrapper = await mountTab([
      buildTable({ id: 1, number: "A1", location: "1F" }),
      buildTable({ id: 2, number: "B1", location: "2F" }),
    ]);
    const vm = vmOf(wrapper);

    vm.searchQuery = "1F";
    await wrapper.vm.$nextTick();
    vm.toggleTableSelection(1);

    // Filtering to another floor must not silently drop what is already picked:
    // building a print run across sections is the point of selecting at all.
    vm.searchQuery = "2F";
    await wrapper.vm.$nextTick();
    vm.toggleTableSelection(2);

    expect([...vm.selectedTableIds].sort()).toEqual([1, 2]);
  });

  it("select-all applies to the filtered set only", async () => {
    const wrapper = await mountTab([
      buildTable({ id: 1, number: "A1", location: "1F" }),
      buildTable({ id: 2, number: "B1", location: "2F" }),
    ]);
    const vm = vmOf(wrapper);

    vm.searchQuery = "1F";
    await wrapper.vm.$nextTick();
    vm.toggleSelectAllFiltered();

    expect(vm.selectedTableIds).toEqual([1]);
    expect(vm.allFilteredSelected).toBe(true);
  });

  it("prints exactly the selected tables, not the filtered ones", async () => {
    const wrapper = await mountTab([
      buildTable({ id: 1, number: "A1" }),
      buildTable({ id: 2, number: "B1" }),
      buildTable({ id: 3, number: "C1" }),
    ]);
    const vm = vmOf(wrapper);

    vm.toggleTableSelection(1);
    vm.toggleTableSelection(3);
    await vm.printSelectedTableQRCodes();

    expect(printQRCodeSheetInWindowMock).toHaveBeenCalledOnce();
    const [, , codes] = printQRCodeSheetInWindowMock.mock.calls[0];
    expect(codes).toHaveLength(2);
    expect(codes.map((code) => code.label)).toEqual([
      "tables.qrModal.title",
      "tables.qrModal.title",
    ]);
    expect(toPrintableDataUrlMock.mock.calls.map((c) => c[0])).toEqual([
      "qr-1",
      "qr-3",
    ]);
  });

  it("prints prepared pending table QR codes before live codes", async () => {
    const wrapper = await mountTab([
      buildTable({
        id: 1,
        number: "A1",
        qrCode: "live-qr-1",
        pendingQrCode: "pending-qr-1",
      }),
    ]);
    const vm = vmOf(wrapper);

    vm.toggleTableSelection(1);
    await vm.printSelectedTableQRCodes();

    expect(toPrintableDataUrlMock).toHaveBeenCalledWith("pending-qr-1");
  });

  it("opens the print window before asynchronously encoding table QR codes", async () => {
    let finishEncoding: ((dataUrl: string) => void) | undefined;
    toPrintableDataUrlMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishEncoding = resolve;
        }),
    );
    const wrapper = await mountTab([buildTable({ id: 1, number: "A1" })]);
    const openWindow = vi.spyOn(window, "open").mockReturnValue({} as Window);

    const printing = vmOf(wrapper).printAllTableQRCodes();

    try {
      expect(openWindow).toHaveBeenCalledOnce();
    } finally {
      finishEncoding?.("data:image/png;base64,qr-1");
      await printing;
    }
  });

  it("excludes placeholder pending table QR codes from selected printing", async () => {
    const wrapper = await mountTab([
      buildTable({ id: 1, number: "A1", qrCode: "pending:019469" }),
      buildTable({ id: 2, number: "B1", qrCode: "qr-2" }),
    ]);
    const vm = vmOf(wrapper);

    vm.toggleTableSelection(1);
    vm.toggleTableSelection(2);

    expect(vm.selectedPrintableCount).toBe(1);

    await vm.printSelectedTableQRCodes();

    expect(toastMock.warning).toHaveBeenCalledWith(
      "qrReadiness.skippedNotReady",
    );
    expect(toPrintableDataUrlMock.mock.calls.map((call) => call[0])).toEqual([
      "qr-2",
    ]);
  });

  it("does not render a scannable QR for placeholder pending codes", async () => {
    const wrapper = await mountTab([
      buildTable({ id: 1, number: "A1", qrCode: "pending:019469" }),
      buildTable({ id: 2, number: "B1", qrCode: "qr-2" }),
    ]);

    const renderedContents = wrapper
      .findAllComponents(QRCodeRendererStub)
      .map((renderer) => renderer.props("content"));

    expect(renderedContents).toEqual(["qr-2"]);
    expect(wrapper.text()).toContain("qrReadiness.notReady");
  });

  it("prints every table despite an active filter", async () => {
    const wrapper = await mountTab([
      buildTable({ id: 1, number: "A1", location: "1F", qrCode: "pending:1" }),
      buildTable({ id: 2, number: "A2", location: "1F", qrCode: "qr-2" }),
      buildTable({ id: 3, number: "B1", location: "2F", qrCode: "qr-3" }),
    ]);
    const vm = vmOf(wrapper);
    vi.spyOn(window, "open").mockReturnValue({} as Window);

    vm.searchQuery = "1F";
    await wrapper.vm.$nextTick();
    await vm.printAllTableQRCodes();

    expect(toastMock.warning).toHaveBeenCalledWith(
      "qrReadiness.skippedNotReady",
    );
    expect(toPrintableDataUrlMock.mock.calls.map((call) => call[0])).toEqual([
      "qr-2",
      "qr-3",
    ]);
  });

  it("warns instead of opening an empty sheet when nothing is selected", async () => {
    const vm = vmOf(await mountTab([buildTable({ id: 1 })]));
    await vm.printSelectedTableQRCodes();
    expect(printQRCodeSheetMock).not.toHaveBeenCalled();
    expect(toastMock.warning).toHaveBeenCalledWith(
      "tables.alert.nothingToPrint",
    );
  });

  it("drops selected ids that no longer exist after a refetch", async () => {
    const wrapper = await mountTab([
      buildTable({ id: 1 }),
      buildTable({ id: 2 }),
    ]);
    const vm = vmOf(wrapper);
    vm.toggleTableSelection(1);
    vm.toggleTableSelection(2);

    // table 2 deleted elsewhere; a stale id would print a QR that no longer exists
    vi.mocked(api.get).mockResolvedValue({
      data: { success: true, data: [buildTable({ id: 1 })] },
    } as never);
    await (
      wrapper.vm as unknown as { fetchTables: () => Promise<void> }
    ).fetchTables();
    await flushPromises();

    expect(vm.selectedTableIds).toEqual([1]);
  });
});
