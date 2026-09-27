import type { NextRequest } from "next/server";
import { getActiveUser } from "@/lib/auth/session";
import { csvResponse, toCsv } from "@/lib/csv";
import { getValuationReport } from "@/lib/data/reports";
import { VALUATION_CSV } from "@/lib/report-csv";
import { readValuationFilters } from "@/lib/report-filters";

/** CSV export of the Inventory Valuation report, with exactly the filters of the report page. */
export async function GET(request: NextRequest): Promise<Response> {
  const user = await getActiveUser();
  if (!user) return new Response("Not signed in", { status: 401 });

  const filters = readValuationFilters(Object.fromEntries(request.nextUrl.searchParams));
  const rows = await getValuationReport(filters);
  return csvResponse(toCsv(VALUATION_CSV, rows), "inventory-valuation", filters.asOf);
}
