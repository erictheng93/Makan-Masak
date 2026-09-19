import { describe, expect, it } from "vitest";
import {
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
    expect(result.errors).toEqual([
      "第 2 列：name 必填。",
      "第 2 列：category 找不到對應分類。",
      "第 2 列：price 必須是 0 以上的金額。",
      "第 2 列：imageUrl 必須是有效 URL。",
      "第 2 列：sortOrder 必須是 0 以上整數。",
    ]);
  });

  it("takes sen for an MYR shop but whole dollars for a TWD one", () => {
    const csv = ["name,category,price", "椰漿飯,主食,12.50"].join("\n");

    const myr = parseMenuItemImport(csv, categories, "MYR");
    expect(myr.errors).toEqual([]);
    expect(myr.items[0]).toEqual(expect.objectContaining({ price: 12.5 }));

    const twd = parseMenuItemImport(csv, categories, "TWD");
    expect(twd.items).toEqual([]);
    expect(twd.errors).toEqual(["第 2 列：price 在 TWD 必須是整數。"]);
  });

  it("reports invalid catalog types before import", () => {
    const result = parseMenuItemImport(
      ["name,category,price,catalogType", '"紀念品","主食",1000,invalid'].join(
        "\n",
      ),
      categories,
    );

    expect(result.items).toEqual([]);
    expect(result.errors).toEqual([
      "第 2 列：catalogType 必須是 menu_item 或 product。",
    ]);
  });

  it("builds a spreadsheet-friendly CSV template", () => {
    const template = buildMenuItemImportTemplate("主食");

    expect(template).toContain(
      "name,category,price,description,imageUrl,isFeatured,isAvailable,sortOrder,catalogType,tags,keywords",
    );
    expect(template).toContain("蚵仔煎");
    expect(template).toContain("主食");
    expect(template).toContain("蚵仔煎,主食,70,");
    expect(template).toContain("紅茶,主食,25,");
  });

  it("adds market keywords to the spreadsheet template when provided", () => {
    expect(buildMenuItemImportTemplate("主食", "逢甲夜市")).toContain(
      "蚵仔煎 夜市 逢甲夜市",
    );
  });
});
