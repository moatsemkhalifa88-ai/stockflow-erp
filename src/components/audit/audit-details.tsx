import type { Json } from "@/types/database";

type JsonRecord = { [key: string]: Json | undefined };

function isRecord(value: Json | null | undefined): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function show(value: Json | undefined): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** Keys worth showing inline for workflow entries (document numbers, quantities, reasons). */
const SUMMARY_KEYS = [
  "po_number",
  "so_number",
  "receipt_number",
  "transfer_number",
  "movement_number",
  "movement_type",
  "quantity_change",
  "quantity",
  "lines",
  "total_amount",
  "reason",
  "po_status",
];

/** One-line summary: changed fields for edits, key facts for workflow actions. */
export function AuditSummary({ details, oldValues }: { details: Json; oldValues: Json | null }) {
  if (!isRecord(details)) return <span className="text-slate-400">—</span>;
  const changed = details.changed_fields;
  if (isRecord(changed)) {
    const before = isRecord(oldValues) ? oldValues : {};
    return (
      <ul className="space-y-0.5">
        {Object.entries(changed).map(([field, value]) => (
          <li key={field} className="truncate">
            <span className="font-medium text-slate-700">{field}</span>{" "}
            <span className="text-slate-400">{show(before[field])}</span> → <span className="text-slate-900">{show(value)}</span>
          </li>
        ))}
      </ul>
    );
  }
  const facts = SUMMARY_KEYS.filter((k) => details[k] !== undefined && details[k] !== null);
  if (facts.length === 0) return <span className="text-slate-400">—</span>;
  return (
    <p className="truncate">
      {facts.map((k, i) => (
        <span key={k}>
          {i > 0 && <span className="text-slate-300"> · </span>}
          <span className="text-slate-500">{k.replace(/_/g, " ")}</span> {show(details[k])}
        </span>
      ))}
    </p>
  );
}

/** Full JSON behind a disclosure, for investigators. */
export function AuditRaw({ details, oldValues, newValues }: { details: Json; oldValues: Json | null; newValues: Json | null }) {
  const blocks: [string, Json | null][] = [
    ["Details", details],
    ["Before", oldValues],
    ["After", newValues],
  ];
  return (
    <details className="mt-1">
      <summary className="cursor-pointer text-xs text-brand-700 hover:underline">Raw data</summary>
      <div className="mt-2 grid gap-2 lg:grid-cols-3">
        {blocks
          .filter(([, v]) => v !== null && !(isRecord(v) && Object.keys(v).length === 0))
          .map(([label, value]) => (
            <div key={label}>
              <p className="text-xs font-semibold text-slate-500 uppercase">{label}</p>
              <pre className="mt-1 max-h-60 overflow-auto rounded bg-slate-50 p-2 text-xs whitespace-pre-wrap text-slate-700">
                {JSON.stringify(value, null, 2)}
              </pre>
            </div>
          ))}
      </div>
    </details>
  );
}
