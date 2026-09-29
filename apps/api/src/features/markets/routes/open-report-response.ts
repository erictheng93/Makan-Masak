import type { Context } from "hono";
import type { MarketOpenReportQuery } from "../schemas/validation";
import type { MarketOpenReportResult } from "../services/MarketOpenReportService";
import { openReportToCsv } from "../services/market-open-report";

export function openReportResponse(
  c: Context,
  report: MarketOpenReportResult,
  query: MarketOpenReportQuery,
) {
  if (query.format === "csv") {
    const view = query.view ?? "daily";
    return c.body(openReportToCsv(report, view), 200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="market-open-report-${view}-${report.from}-${report.to}.csv"`,
    });
  }
  return c.json({ success: true, data: report }, 200);
}
