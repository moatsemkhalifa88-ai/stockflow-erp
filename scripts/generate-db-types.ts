/**
 * Generates src/types/database.ts (Supabase-compatible `Database` type) by
 * applying all migrations to an in-memory PGlite database and introspecting it.
 * Works offline and without Docker. With a running local Supabase stack you can
 * use `npx supabase gen types typescript --local` instead; both produce the same shape.
 *
 * Usage: npm run db:types
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb } from "../tests/db/harness";

interface ColumnInfo {
  table_name: string;
  column_name: string;
  udt_name: string;
  data_type: string;
  is_nullable: "YES" | "NO";
  column_default: string | null;
  is_identity: "YES" | "NO";
  is_generated: "ALWAYS" | "NEVER";
  ordinal_position: number;
}

interface ForeignKeyInfo {
  constraint_name: string;
  table_name: string;
  columns: string[];
  referenced_table: string;
  referenced_columns: string[];
  is_one_to_one: boolean;
}

interface FunctionInfo {
  name: string;
  arg_names: string[] | null;
  arg_types: string[];
  arg_has_default: boolean[];
  return_type: string;
  returns_set: boolean;
  /** Columns of a RETURNS TABLE (...) function, in order. */
  table_columns: { name: string; type: string }[] | null;
}

async function loadColumns(db: PGlite, relkinds: string[]): Promise<ColumnInfo[]> {
  const result = await db.query<ColumnInfo>(
    `select c.table_name, c.column_name, c.udt_name, c.data_type, c.is_nullable, c.column_default,
            c.is_identity, c.is_generated, c.ordinal_position
     from information_schema.columns c
     join pg_class k on k.relname = c.table_name
     join pg_namespace n on n.oid = k.relnamespace and n.nspname = c.table_schema
     where c.table_schema = 'public' and k.relkind = any($1::char[])
     order by c.table_name, c.ordinal_position`,
    [relkinds],
  );
  return result.rows;
}

async function loadForeignKeys(db: PGlite): Promise<ForeignKeyInfo[]> {
  const result = await db.query<ForeignKeyInfo>(
    `select con.conname as constraint_name,
            src.relname as table_name,
            array(select a.attname from unnest(con.conkey) with ordinality k(attnum, ord)
                  join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum order by k.ord)::text[] as columns,
            ref.relname as referenced_table,
            array(select a.attname from unnest(con.confkey) with ordinality k(attnum, ord)
                  join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.attnum order by k.ord)::text[] as referenced_columns,
            exists (
              select 1 from pg_constraint u
              where u.conrelid = con.conrelid and u.contype in ('u', 'p')
                and u.conkey::int[] @> con.conkey::int[] and u.conkey::int[] <@ con.conkey::int[]
            ) as is_one_to_one
     from pg_constraint con
     join pg_class src on src.oid = con.conrelid
     join pg_class ref on ref.oid = con.confrelid
     join pg_namespace n on n.oid = src.relnamespace
     join pg_namespace rn on rn.oid = ref.relnamespace
     where con.contype = 'f' and n.nspname = 'public' and rn.nspname = 'public'
     order by src.relname, con.conname`,
  );
  return result.rows;
}

async function loadEnums(db: PGlite): Promise<Map<string, string[]>> {
  const result = await db.query<{ name: string; value: string }>(
    `select t.typname as name, e.enumlabel as value
     from pg_type t join pg_enum e on e.enumtypid = t.oid
     join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public'
     order by t.typname, e.enumsortorder`,
  );
  const enums = new Map<string, string[]>();
  for (const row of result.rows) {
    enums.set(row.name, [...(enums.get(row.name) ?? []), row.value]);
  }
  return enums;
}

async function loadFunctions(db: PGlite): Promise<FunctionInfo[]> {
  const result = await db.query<FunctionInfo>(
    `select p.proname as name,
            p.proargnames::text[] as arg_names,
            array(select format_type(t, null) from unnest(p.proargtypes) t)::text[] as arg_types,
            array(select i >= p.pronargs - p.pronargdefaults from generate_series(0, p.pronargs - 1) i)::boolean[] as arg_has_default,
            format_type(p.prorettype, null) as return_type,
            p.proretset as returns_set,
            case when p.proargmodes is null then null else (
              select json_agg(json_build_object('name', p.proargnames[i], 'type', format_type(p.proallargtypes[i], null)) order by i)
              from generate_subscripts(p.proargmodes, 1) i
              where p.proargmodes[i] = 't'
            ) end as table_columns
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
     order by p.proname`,
  );
  return result.rows;
}

function tsType(udtName: string, enums: Map<string, string[]>): string {
  const isArray = udtName.startsWith("_");
  const base = isArray ? udtName.slice(1) : udtName;
  let type: string;
  if (enums.has(base)) type = `Database["public"]["Enums"]["${base}"]`;
  else if (["int2", "int4", "int8", "float4", "float8", "numeric"].includes(base)) type = "number";
  else if (base === "bool") type = "boolean";
  else if (base === "json" || base === "jsonb") type = "Json";
  else type = "string";
  return isArray ? `${type}[]` : type;
}

function formatTypeToTs(formatted: string, enums: Map<string, string[]>): string {
  const map: Record<string, string> = {
    integer: "int4", bigint: "int8", smallint: "int2", numeric: "numeric", boolean: "bool",
    jsonb: "jsonb", json: "json", "double precision": "float8", real: "float4",
  };
  const isArray = formatted.endsWith("[]");
  const base = isArray ? formatted.slice(0, -2) : formatted;
  const udt = map[base] ?? base.replace(/^public\./, "");
  return tsType(isArray ? `_${udt}` : udt, enums);
}

function renderRelationships(fks: ForeignKeyInfo[], indent: string): string {
  if (fks.length === 0) return "[]";
  const items = fks.map(
    (fk) =>
      `${indent}  {\n` +
      `${indent}    foreignKeyName: "${fk.constraint_name}"\n` +
      `${indent}    columns: [${fk.columns.map((c) => `"${c}"`).join(", ")}]\n` +
      `${indent}    isOneToOne: ${fk.is_one_to_one}\n` +
      `${indent}    referencedRelation: "${fk.referenced_table}"\n` +
      `${indent}    referencedColumns: [${fk.referenced_columns.map((c) => `"${c}"`).join(", ")}]\n` +
      `${indent}  },`,
  );
  return `[\n${items.join("\n")}\n${indent}]`;
}

function renderRelations(
  columns: ColumnInfo[],
  fks: ForeignKeyInfo[],
  enums: Map<string, string[]>,
  withWrites: boolean,
): string {
  const byTable = new Map<string, ColumnInfo[]>();
  for (const col of columns) byTable.set(col.table_name, [...(byTable.get(col.table_name) ?? []), col]);
  if (byTable.size === 0) return "{\n      [_ in never]: never\n    }";

  const out: string[] = [];
  for (const [table, cols] of byTable) {
    const row = cols
      .map((c) => `          ${c.column_name}: ${tsType(c.udt_name, enums)}${c.is_nullable === "YES" ? " | null" : ""}`)
      .join("\n");
    out.push(`      ${table}: {\n        Row: {\n${row}\n        }`);

    if (withWrites) {
      const insert = cols
        .map((c) => {
          if (c.is_generated === "ALWAYS") return `          ${c.column_name}?: never`;
          const optional = c.is_nullable === "YES" || c.column_default !== null || c.is_identity === "YES";
          return `          ${c.column_name}${optional ? "?" : ""}: ${tsType(c.udt_name, enums)}${c.is_nullable === "YES" ? " | null" : ""}`;
        })
        .join("\n");
      const update = cols
        .map((c) =>
          c.is_generated === "ALWAYS"
            ? `          ${c.column_name}?: never`
            : `          ${c.column_name}?: ${tsType(c.udt_name, enums)}${c.is_nullable === "YES" ? " | null" : ""}`,
        )
        .join("\n");
      out.push(`        Insert: {\n${insert}\n        }\n        Update: {\n${update}\n        }`);
    }

    const tableFks = fks.filter((fk) => fk.table_name === table);
    out.push(`        Relationships: ${renderRelationships(tableFks, "        ")}\n      }`);
  }
  return `{\n${out.join("\n")}\n    }`;
}

/** Return type of a function: table rows (e.g. `returns public.stock_movements`) map to that table's Row. */
function returnTypeToTs(formatted: string, enums: Map<string, string[]>, tableNames: Set<string>): string {
  if (formatted === "void") return "undefined";
  const name = formatted.replace(/^public\./, "");
  if (tableNames.has(name)) return `Database["public"]["Tables"]["${name}"]["Row"]`;
  return formatTypeToTs(formatted, enums);
}

function renderFunctions(functions: FunctionInfo[], enums: Map<string, string[]>, tableNames: Set<string>): string {
  if (functions.length === 0) return "{\n      [_ in never]: never\n    }";
  const out = functions.map((fn) => {
    const args = fn.arg_types
      .map((t, i) => {
        const name = fn.arg_names?.[i] ?? `arg${i}`;
        return `          ${name}${fn.arg_has_default[i] ? "?" : ""}: ${formatTypeToTs(t, enums)}`;
      })
      .join("\n");
    const columns = fn.table_columns?.map((c) => `          ${c.name}: ${formatTypeToTs(c.type, enums)}`).join("\n");
    const ret = columns ? `{\n${columns}\n        }` : returnTypeToTs(fn.return_type, enums, tableNames);
    const argsBlock = args ? `{\n${args}\n        }` : "never";
    return `      ${fn.name}: {\n        Args: ${argsBlock}\n        Returns: ${ret}${fn.returns_set ? "[]" : ""}\n      }`;
  });
  return `{\n${out.join("\n")}\n    }`;
}

function renderEnums(enums: Map<string, string[]>): string {
  if (enums.size === 0) return "{\n      [_ in never]: never\n    }";
  const out = [...enums].map(([name, values]) => `      ${name}: ${values.map((v) => `"${v}"`).join(" | ")}`);
  return `{\n${out.join("\n")}\n    }`;
}

async function main(): Promise<void> {
  const db = await createTestDb();
  const [tables, views, fks, enums, functions] = await Promise.all([
    loadColumns(db, ["r"]),
    loadColumns(db, ["v", "m"]),
    loadForeignKeys(db),
    loadEnums(db),
    loadFunctions(db),
  ]);
  await db.close();

  const enumConstants = [...enums]
    .map(([name, values]) => `      ${name}: [${values.map((v) => `"${v}"`).join(", ")}],`)
    .join("\n");

  const source = `// AUTO-GENERATED by scripts/generate-db-types.ts - do not edit by hand.
// Regenerate after changing migrations: npm run db:types

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  public: {
    Tables: ${renderRelations(tables, fks, enums, true)}
    Views: ${renderRelations(views, [], enums, false)}
    Functions: ${renderFunctions(functions, enums, new Set(tables.map((c) => c.table_name)))}
    Enums: ${renderEnums(enums)}
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type PublicSchema = Database["public"]

export type Tables<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Row"]
export type TablesInsert<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Insert"]
export type TablesUpdate<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Update"]
export type Views<T extends keyof PublicSchema["Views"]> = PublicSchema["Views"][T]["Row"]
export type Enums<T extends keyof PublicSchema["Enums"]> = PublicSchema["Enums"][T]

export const Constants = {
  public: {
    Enums: {
${enumConstants}
    },
  },
} as const
`;

  const target = path.resolve(__dirname, "..", "src", "types", "database.ts");
  writeFileSync(target, source, "utf8");
  console.log(`Wrote ${path.relative(process.cwd(), target)} (${tables.length} table columns, ${enums.size} enums)`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
