// @vitest-environment jsdom

import { defineComponent, nextTick, ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SeatManagement from "./SeatManagement.vue";

// The failure paths below are driven on purpose and the code logs each one.
const silencedConsole: Array<{ mockRestore: () => void }> = [];
beforeEach(() => {
  for (const method of ["error"] as const) {
    silencedConsole.push(
      vi.spyOn(console, method).mockImplementation(() => {}),
    );
  }
});
afterEach(() => {
  silencedConsole.splice(0).forEach((spy) => spy.mockRestore());
});

const qrDataUrl = "data:image/png;base64,c2VhdA==";
const qrToDataUrl = vi.hoisted(() =>
  vi.fn(async (content: string) => `data:image/png;base64,${btoa(content)}`),
);
const toastError = vi.hoisted(() => vi.fn());
const apiMocks = vi.hoisted(() => ({
  delete: vi.fn(),
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
}));

vi.mock("qrcode", () => ({
  default: {
    toDataURL: qrToDataUrl,
  },
}));

vi.mock("@/i18n", () => ({
  useI18n: () => ({
    t: (key: string, params: Record<string, string> = {}) =>
      `${key} ${Object.values(params).join(" ")}`.trim(),
    locale: ref("zh-TW"),
  }),
}));

vi.mock("vue-toastification", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: toastError,
    warning: vi.fn(),
  }),
}));

vi.mock("@/composables/useConfirmModal", () => ({
  useConfirmModal: () => ({ confirm: vi.fn(async () => true) }),
}));

vi.mock("@/services/api", () => ({
  api: apiMocks,
}));

const QRCodeRendererStub = defineComponent({
  name: "QRCodeRenderer",
  props: {
    content: { type: String, required: true },
    label: { type: String, default: "" },
  },
  setup(_props, { expose }) {
    expose({ getDataUrl: () => qrDataUrl });
    return () => null;
  },
});

function buildSeat(
  id: number,
  seatNumber: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    tableId: 11,
    seatNumber,
    qrCode: `https://app.test/order?seat=${seatNumber}`,
    isOccupied: false,
    isActive: true,
    totalUsage: 0,
    ...overrides,
  };
}

function mountSeatManagement(seats = [buildSeat(1, "01"), buildSeat(2, "02")]) {
  return mount(SeatManagement, {
    props: {
      tableId: 11,
      tableNumber: "A1",
      seats,
    },
    global: {
      stubs: {
        SeatGrid: true,
        QRCodeRenderer: QRCodeRendererStub,
      },
    },
  });
}

function createPrintWindow() {
  const printDocument = document.implementation.createHTMLDocument("print");
  return {
    document: printDocument,
    print: vi.fn(),
    close: vi.fn(),
  };
}

describe("SeatManagement QR output", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, "open").mockReturnValue(createPrintWindow() as never);
    apiMocks.get.mockResolvedValue({
      data: {
        success: true,
        data: {
          id: 11,
          capacity: 4,
        },
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the selected seat QR and downloads it as a PNG", async () => {
    const wrapper = mountSeatManagement();
    const seat = buildSeat(1, "01");
    const anchorClick = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);

    (
      wrapper.vm as unknown as {
        handleSeatClick: (selectedSeat: ReturnType<typeof buildSeat>) => void;
      }
    ).handleSeatClick(seat);
    await nextTick();

    const renderer = wrapper.findComponent(QRCodeRendererStub);
    expect(renderer.props("content")).toBe(seat.qrCode);

    (
      wrapper.vm as unknown as { downloadSeatQRCode: () => void }
    ).downloadSeatQRCode();

    expect(anchorClick).toHaveBeenCalledOnce();
    // mock.instances is typed from the spied signature (`click(): void`), so it
    // carries no element type of its own.
    const anchor = anchorClick.mock.instances[0] as HTMLAnchorElement;
    expect(anchor.download).toBe("QR-A1-01.png");
    expect(anchor.href).toBe(qrDataUrl);
  });

  it("prints every active seat QR in one batch", async () => {
    vi.useFakeTimers();
    const wrapper = mountSeatManagement();
    const printWindow = createPrintWindow();
    vi.spyOn(window, "open").mockReturnValue(printWindow as never);

    await (
      wrapper.vm as unknown as { printAllSeatQRCodes: () => Promise<void> }
    ).printAllSeatQRCodes();
    vi.runAllTimers();

    expect(qrToDataUrl).toHaveBeenCalledTimes(2);
    expect(printWindow.document.querySelectorAll("img")).toHaveLength(2);
    expect(printWindow.document.body.textContent).toContain("A1");
    expect(printWindow.document.body.textContent).toContain("01");
    expect(printWindow.document.body.textContent).toContain("02");
    expect(printWindow.print).toHaveBeenCalledOnce();
  });

  it("opens the print window before asynchronously encoding seat QR codes", async () => {
    let finishEncoding: ((dataUrl: string) => void) | undefined;
    qrToDataUrl.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishEncoding = resolve;
        }),
    );
    const wrapper = mountSeatManagement([buildSeat(1, "01")]);
    const printWindow = createPrintWindow();
    const openWindow = vi
      .spyOn(window, "open")
      .mockReturnValue(printWindow as never);

    const printing = (
      wrapper.vm as unknown as { printAllSeatQRCodes: () => Promise<void> }
    ).printAllSeatQRCodes();

    try {
      expect(openWindow).toHaveBeenCalledOnce();
    } finally {
      finishEncoding?.(qrDataUrl);
      await printing;
    }
  });

  it("prints prepared pending seat QR codes before live codes", async () => {
    const wrapper = mountSeatManagement([
      buildSeat(1, "01", { pendingQrCode: "pending-seat-01" }),
      buildSeat(2, "02"),
    ]);

    await (
      wrapper.vm as unknown as { printAllSeatQRCodes: () => Promise<void> }
    ).printAllSeatQRCodes();

    expect(qrToDataUrl.mock.calls.map((call) => call[0])).toEqual([
      "pending-seat-01",
      "https://app.test/order?seat=02",
    ]);
  });

  it("loads table capacity before batch creation and shows API errors", async () => {
    apiMocks.post.mockRejectedValue({
      response: {
        data: {
          error: {
            message:
              "Seat count must be positive and cannot exceed table capacity",
          },
        },
      },
    });
    const wrapper = mountSeatManagement();

    (
      wrapper.vm as unknown as {
        showBatchCreateModal: boolean;
      }
    ).showBatchCreateModal = true;
    await nextTick();
    await flushPromises();

    expect(apiMocks.get).toHaveBeenCalledWith("/tables/11");
    expect(
      (wrapper.vm as unknown as { batchForm: { count: number } }).batchForm
        .count,
    ).toBe(2);

    await (
      wrapper.vm as unknown as { batchCreateSeats: () => Promise<void> }
    ).batchCreateSeats();

    expect(toastError).toHaveBeenCalledWith(
      "Seat count must be positive and cannot exceed table capacity",
    );
  });
});
