import { describe, expect, it } from "vitest";
import {
  buildMenuItemImportRetryText,
  buildMenuItemImportTemplate,
  parseMenuItemImport,
} from "./menuItemImport";

const categories = [
  { id: 1, name: "主食", sortOrder: 0 },
  { id: 2, name: "飲料", sortOrder: 1 },
];

describe("menu item import parsing", () => {
  it("parses CSV rows into create menu item inputs", () => {
    const result = parseMenuItemImport(
      [
        "name,category,price,description,imageUrl,isFeatured,isAvailable,sortOrder,catalogType,tags,keywords",
        '"蚵仔煎","主食",70,"招牌小吃",,true,true,1,menu_item,"小吃;招牌","蚵仔煎 夜市"',
        '"手機殼","2",25,"現貨配件",https://example.com/case.jpg,false,true,2,product,"配件",""',
      ].join("\n"),
      categories,
    );

    expect(result.errors).toEqual([]);
    expect(result.items).toEqual([
      {
        name: "蚵仔煎",
        categoryId: 1,
        price: 70,
        description: "招牌小吃",
        isFeatured: true,
        isAvailable: true,
        sortOrder: 1,
        catalogType: "menu_item",
        tags: ["小吃", "招牌"],
        keywords: "蚵仔煎 夜市",
      },
      {
        name: "手機殼",
        categoryId: 2,
        price: 25,
        description: "現貨配件",
        imageUrl: "https://example.com/case.jpg",
        isFeatured: false,
        isAvailable: true,
        sortOrder: 2,
        catalogType: "product",
        tags: ["配件"],
        keywords: "配件",
      },
    ]);
  });

  it("reports row-level errors before import", () => {
    const result = parseMenuItemImport(
      [
        "name,category,price,imageUrl,sortOrder",
        ",不存在,-1,not-a-url,-1",
      ].join("\n"),
      categories,
    );

    expect(result.items).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.rows[0]).toEqual(
      expect.objectContaining({
        line: 2,
        errors: [
          "名稱沒有填。",
          "找不到分類「不存在」，請先在左邊新增這個分類。",
          "價格「-1」不是有效的金額。",
          "圖片網址不是有效的網址。",
          "排序必須是 0 以上的整數。",
        ],
      }),
    );
  });

  it("takes sen for an MYR shop but whole dollars for a TWD one", () => {
    const csv = ["name,category,price", "椰漿飯,主食,12.50"].join("\n");

    const myr = parseMenuItemImport(csv, categories, "MYR");
    expect(myr.errors).toEqual([]);
    expect(myr.items[0]).toEqual(expect.objectContaining({ price: 12.5 }));

    const twd = parseMenuItemImport(csv, categories, "TWD");
    expect(twd.items).toEqual([]);
    expect(twd.rows[0].errors).toEqual(["價格不能有小數（TWD）。"]);
  });

  it("reports invalid catalog types before import", () => {
    const result = parseMenuItemImport(
      ["name,category,price,catalogType", '"紀念品","主食",1000,invalid'].join(
        "\n",
      ),
      categories,
    );

    expect(result.items).toEqual([]);
    expect(result.rows[0].errors).toEqual(["類型只能填「餐點」或「商品」。"]);
  });

  it("builds a template that parses back cleanly", () => {
    const template = buildMenuItemImportTemplate("主食");

    expect(template.split("\n")[0]).toBe("名稱\t價格\t分類\t說明\t搜尋關鍵字");
    const result = parseMenuItemImport(template, categories);
    expect(result.errors).toEqual([]);
    expect(result.items.map((item) => item.name)).toEqual(["蚵仔煎", "紅茶"]);
  });

  it("reads a table pasted from Excel with Chinese headers", () => {
    const result = parseMenuItemImport(
      [
        "品名\t售價\t分類\t推薦\t類型",
        "滷肉飯\tNT$1,200\t主食\t是\t餐點",
        "紀念杯\t350元\t飲料\t\t商品",
      ].join("\n"),
      categories,
    );

    expect(result.errors).toEqual([]);
    expect(result.items).toEqual([
      expect.objectContaining({
        name: "滷肉飯",
        price: 1200,
        categoryId: 1,
        isFeatured: true,
        catalogType: "menu_item",
      }),
      expect.objectContaining({
        name: "紀念杯",
        price: 350,
        categoryId: 2,
        isFeatured: false,
        catalogType: "product",
      }),
    ]);
  });

  it("puts rows without a category into the selected one", () => {
    const result = parseMenuItemImport(
      "名稱,價格\n紅茶,25",
      categories,
      "TWD",
      2,
    );

    expect(result.items).toEqual([
      expect.objectContaining({ name: "紅茶", categoryId: 2 }),
    ]);
    expect(result.rows[0].categoryName).toBe("飲料");
  });

  it("asks for a category when several exist and none is selected", () => {
    const result = parseMenuItemImport("名稱,價格\n紅茶,25", categories);

    expect(result.items).toEqual([]);
    expect(result.rows[0].errors).toEqual([
      "分類沒有填（或先在左邊選好分類再貼上）。",
    ]);
  });

  it("requires a price", () => {
    const result = parseMenuItemImport("名稱,分類\n紅茶,飲料", categories);

    expect(result.rows[0].errors).toEqual(["價格沒有填。"]);
  });

  it("imports the valid rows and hands back the rest to fix", () => {
    const result = parseMenuItemImport(
      ["名稱\t價格\t分類", "紅茶\t25\t飲料", "綠茶\t\t飲料"].join("\n"),
      categories,
    );

    expect(result.items).toEqual([expect.objectContaining({ name: "紅茶" })]);
    expect(result.rows.map((row) => row.errors.length)).toEqual([0, 1]);

    const retry = buildMenuItemImportRetryText(result.rows);
    expect(retry).toBe("名稱\t分類\t價格\r\n綠茶\t飲料\t");
    expect(parseMenuItemImport(retry, categories).rows).toEqual([
      expect.objectContaining({ name: "綠茶", errors: ["價格沒有填。"] }),
    ]);
  });

  it("explains a paste that has no header row", () => {
    const result = parseMenuItemImport("紅茶\t25\n綠茶\t30", categories);

    expect(result.items).toEqual([]);
    expect(result.errors[0]).toContain("表頭");
  });

  it("flags a row whose description contains an unquoted comma", () => {
    const result = parseMenuItemImport(
      "名稱,價格,分類,說明\n紅茶,25,飲料,好喝,便宜",
      categories,
    );

    expect(result.items).toEqual([]);
    expect(result.rows[0].errors[0]).toContain("欄位比表頭多");
  });

  it("adds market keywords to the spreadsheet template when provided", () => {
    expect(buildMenuItemImportTemplate("主食", "逢甲夜市")).toContain(
      "蚵仔煎 夜市 逢甲夜市",
    );
  });
});
