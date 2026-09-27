import type { NextRequest } from "next/server";
import { getActiveUser } from "@/lib/auth/session";
import { csvResponse, toCsv } from "@/lib/csv";
import { getMovementReportAll } from "@/lib/data/reports";
import { MOVEMENT_CSV } from "@/lib/report-csv";
import { readMovementFilters } from "@/lib/report-filters";

/** CSV export of the Stock Movement report, with exactly the filters of the report page. */
export async function GET(request: NextRequest): Promise<Response> {
  const user = await getActiveUser();
  if (!user) return new Response("Not signed in", { status: 401 });

  const filters = readMovementFilters(Object.fromEntries(request.nextUrl.searchParams));
  const rows = await getMovementReportAll(filters);
  return csvResponse(toCsv(MOVEMENT_CSV, rows), "stock-movements", `${filters.from}-to-${filters.to}`);
}
