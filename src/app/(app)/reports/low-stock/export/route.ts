import type { NextRequest } from "next/server";
import { getActiveUser } from "@/lib/auth/session";
import { csvResponse, toCsv } from "@/lib/csv";
import { getLowStockReport } from "@/lib/data/reports";
import { businessToday } from "@/lib/format";
import { LOW_STOCK_CSV } from "@/lib/report-csv";
import { readLowStockFilters } from "@/lib/report-filters";

/** CSV export of the Low Stock report, with exactly the filters of the report page. */
export async function GET(request: NextRequest): Promise<Response> {
  const user = await getActiveUser();
  if (!user) return new Response("Not signed in", { status: 401 });

  const filters = readLowStockFilters(Object.fromEntries(request.nextUrl.searchParams));
  const rows = await getLowStockReport(filters);
  return csvResponse(toCsv(LOW_STOCK_CSV, rows), "low-stock", businessToday());
}
