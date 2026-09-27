/**
 * CSV for spreadsheet users (Excel, Google Sheets, Power BI).
 *  - RFC 4180 quoting (commas, quotes, line breaks).
 *  - Cells starting with = + - @ (or tab / CR) are prefixed with ' so a
 *    product name or reason can never run as a spreadsheet formula
 *    (CSV injection). Plain negative numbers are left alone.
 *  - A UTF-8 byte-order mark so Excel shows Hebrew and ₪ correctly.
 */

export type CsvValue = string | number | boolean | null | undefined;

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => CsvValue;
}

const FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  let text = typeof value === "number" ? (Number.isFinite(value) ? String(value) : "") : String(value);
  if (FORMULA_START.test(text) && !PLAIN_NUMBER.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv<T>(columns: CsvColumn<T>[], rows: T[]): string {
  const lines = [columns.map((c) => csvCell(c.header)).join(",")];
  for (const row of rows) lines.push(columns.map((c) => csvCell(c.value(row))).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}

/** Response for a CSV download; the file name gets today's date. */
export function csvResponse(csv: string, baseName: string, date: string): Response {
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${baseName}-${date}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
