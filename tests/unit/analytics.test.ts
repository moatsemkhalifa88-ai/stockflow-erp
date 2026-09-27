import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "@/lib/csv";
import { bucketFor, presetRange, readDateRange } from "@/lib/date-range";

describe("csv", () => {
  it("quotes commas, quotes and line breaks", () => {
    expect(csvCell('27" Monitor, QHD')).toBe('"27"" Monitor, QHD"');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(12.5)).toBe("12.5");
  });

  it("neutralises spreadsheet formulas but keeps negative numbers", () => {
    expect(csvCell("=HYPERLINK(\"http://evil\")")).toBe(`"'=HYPERLINK(""http://evil"")"`);
    expect(csvCell("+1-555")).toBe("'+1-555");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("-7")).toBe("-7");
    expect(csvCell(-7)).toBe("-7");
  });

  it("writes a BOM, a header row and CRLF lines", () => {
    const csv = toCsv([{ header: "SKU", value: (r: { sku: string }) => r.sku }], [{ sku: "CMP-2001" }]);
    expect(csv).toBe("﻿SKU\r\nCMP-2001\r\n");
  });
});

describe("date ranges", () => {
  const today = "2026-09-27";

  it("resolves presets in business dates", () => {
    expect(presetRange("7d", today)).toEqual({ from: "2026-09-21", to: today, preset: "7d" });
    expect(presetRange("mtd", today)).toEqual({ from: "2026-09-01", to: today, preset: "mtd" });
    expect(presetRange("ytd", today)).toEqual({ from: "2026-01-01", to: today, preset: "ytd" });
  });

  it("reads custom ranges, clamping to today and swapping reversed dates", () => {
    expect(readDateRange({ from: "2026-09-30", to: "2026-09-10" }, "90d", today)).toEqual({
      from: "2026-09-10",
      to: today,
      preset: "custom",
    });
    expect(readDateRange({}, "30d", today)).toEqual({ from: "2026-08-29", to: today, preset: "30d" });
    expect(readDateRange({ range: "junk" }, "7d", today).preset).toBe("7d");
  });

  it("picks day, week or month buckets by range length", () => {
    expect(bucketFor({ from: "2026-09-01", to: "2026-09-27" })).toBe("day");
    expect(bucketFor({ from: "2026-06-30", to: "2026-09-27" })).toBe("week");
    expect(bucketFor({ from: "2026-01-01", to: "2026-09-27" })).toBe("month");
  });
});
