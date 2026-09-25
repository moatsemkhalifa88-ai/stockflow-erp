import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, createUser, runAs, type TestUser } from "./harness";

interface Totals {
  line_count: number;
  total_quantity: number;
  inventory_value: string;
  low_stock_count: number;
  out_of_stock_count: number;
}

interface Filters {
  warehouse?: string;
  category?: string;
  status?: string;
  search?: string;
}

/**
 * The Inventory page cards must summarise exactly the rows the table lists.
 * inventory_totals() is checked against fixed data and against the view itself.
 */
describe("inventory_totals (Inventory page summary cards)", () => {
  let db: PGlite;
  let manager: TestUser;
  let inactive: TestUser;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    db = await createTestDb({ seed: true });
    manager = await createUser(db, "manager@stockflow.test", "warehouse_manager");
    inactive = await createUser(db, "former@stockflow.test", "warehouse_manager");
    await db.query("update public.profiles set is_active = false where id = $1", [inactive.id]);

    for (const [key, sql] of [
      ["tlv", "select id from public.warehouses where code = 'WH-TLV'"],
      ["hfa", "select id from public.warehouses where code = 'WH-HFA'"],
      ["comp", "select id from public.categories where code = 'COMP'"],
      ["net", "select id from public.categories where code = 'NET'"],
    ] as const) {
      ids[key] = (await db.query<{ id: string }>(sql)).rows[0].id;
    }

    // sku, category, cost, minimum
    const products: [string, string, number, number][] = [
      ["TOT-0001", "comp", 10, 5],
      ["TOT-0002", "comp", 4, 10],
      ["TOT-0003", "net", 100, 2],
      ["TOT-0004", "net", 1, 0],
    ];
    for (const [sku, category, cost, min] of products) {
      const r = await db.query<{ id: string }>(
        `insert into public.products (sku, name, category_id, cost_price, min_stock_level)
         values ($1, 'Totals test ' || $1, $2, $3::numeric, $4) returning id`,
        [sku, ids[category], cost, min],
      );
      ids[sku] = r.rows[0].id;
    }

    // Resulting stock:           TLV              HFA
    //   TOT-0001 (COMP, min 5)   20 IN_STOCK      3 LOW_STOCK
    //   TOT-0002 (COMP, min 10)   8 LOW_STOCK     -
    //   TOT-0003 (NET, min 2)     5 IN_STOCK      0 OUT_OF_STOCK
    //   TOT-0004 (NET, min 0)     0 OUT_OF_STOCK  -
    const moves: [string, string, string, number][] = [
      ["TOT-0001", "tlv", "PURCHASE_RECEIPT", 20],
      ["TOT-0001", "hfa", "PURCHASE_RECEIPT", 3],
      ["TOT-0002", "tlv", "PURCHASE_RECEIPT", 8],
      ["TOT-0003", "tlv", "PURCHASE_RECEIPT", 5],
      ["TOT-0003", "hfa", "PURCHASE_RECEIPT", 1],
      ["TOT-0003", "hfa", "SALE", 1],
      ["TOT-0004", "tlv", "PURCHASE_RECEIPT", 2],
      ["TOT-0004", "tlv", "SALE", 2],
    ];
    await runAs(db, { role: "authenticated", userId: manager.id }, async () => {
      for (const [sku, warehouse, type, quantity] of moves) {
        await db.query("select public.create_stock_movement($1, $2, $3::public.movement_type, $4)", [
          ids[sku],
          ids[warehouse],
          type,
          quantity,
        ]);
      }
    });
  });

  afterAll(async () => {
    await db.close();
  });

  function totals(filters: Filters, userId = manager.id): Promise<Totals> {
    return runAs(db, { role: "authenticated", userId }, async () => {
      const r = await db.query<Totals>("select * from public.inventory_totals($1, $2, $3, $4)", [
        filters.warehouse ?? null,
        filters.category ?? null,
        filters.status ?? null,
        filters.search ?? null,
      ]);
      return r.rows[0];
    });
  }

  /** The same filters applied to the view the Inventory table reads. */
  function fromList(filters: Filters): Promise<Totals> {
    return runAs(db, { role: "authenticated", userId: manager.id }, async () => {
      const r = await db.query<{ quantity: number; inventory_value: string; stock_status: string }>(
        `select quantity, inventory_value, stock_status from public.inventory_valuation
         where ($1::uuid is null or warehouse_id = $1::uuid)
           and ($2::uuid is null or category_id = $2::uuid)
           and ($3::text is null or stock_status = $3::text)
           and ($4::text is null or sku ilike '%' || $4::text || '%' or product_name ilike '%' || $4::text || '%')`,
        [filters.warehouse ?? null, filters.category ?? null, filters.status ?? null, filters.search ?? null],
      );
      return {
        line_count: r.rows.length,
        total_quantity: r.rows.reduce((sum, x) => sum + x.quantity, 0),
        inventory_value: r.rows.reduce((sum, x) => sum + Number(x.inventory_value), 0).toFixed(2),
        low_stock_count: r.rows.filter((x) => x.stock_status === "LOW_STOCK").length,
        out_of_stock_count: r.rows.filter((x) => x.stock_status === "OUT_OF_STOCK").length,
      };
    });
  }

  const expected = (line_count: number, total_quantity: number, value: number, low: number, out: number): Totals => ({
    line_count,
    total_quantity,
    inventory_value: value.toFixed(2),
    low_stock_count: low,
    out_of_stock_count: out,
  });

  it("totals everything when no filter is set", async () => {
    expect(await totals({})).toEqual(expected(6, 36, 762, 2, 2));
  });

  it("respects the warehouse filter", async () => {
    expect(await totals({ warehouse: ids.tlv })).toEqual(expected(4, 33, 732, 1, 1));
  });

  it("respects warehouse + category (the old cards ignored the category)", async () => {
    expect(await totals({ warehouse: ids.tlv, category: ids.comp })).toEqual(expected(2, 28, 232, 1, 0));
  });

  it("respects warehouse + category + status (the old cards ignored the status)", async () => {
    expect(await totals({ warehouse: ids.tlv, category: ids.comp, status: "LOW_STOCK" })).toEqual(
      expected(1, 8, 32, 1, 0),
    );
  });

  it("respects the category and status filters on their own", async () => {
    expect(await totals({ category: ids.net })).toEqual(expected(3, 5, 500, 0, 2));
    expect(await totals({ status: "OUT_OF_STOCK" })).toEqual(expected(2, 0, 0, 0, 2));
  });

  it("respects the search box (SKU or product name, case-insensitive)", async () => {
    expect(await totals({ search: "tot-0003" })).toEqual(expected(2, 5, 500, 0, 1));
    expect(await totals({ search: "  " })).toEqual(await totals({}));
  });

  it("returns zeros, not an error, when nothing matches", async () => {
    expect(await totals({ warehouse: ids.hfa, category: ids.comp, status: "OUT_OF_STOCK" })).toEqual(
      expected(0, 0, 0, 0, 0),
    );
  });

  it("always agrees with the rows the Inventory table lists", async () => {
    const combos: Filters[] = [];
    for (const warehouse of [undefined, ids.tlv, ids.hfa])
      for (const category of [undefined, ids.comp, ids.net])
        for (const status of [undefined, "IN_STOCK", "LOW_STOCK", "OUT_OF_STOCK"])
          for (const search of [undefined, "TOT-000", "totals test tot-0001"]) combos.push({ warehouse, category, status, search });

    for (const filters of combos) {
      expect(await totals(filters), JSON.stringify(filters)).toEqual(await fromList(filters));
    }
  });

  it("applies RLS: a deactivated user gets zeros and anonymous users are refused", async () => {
    expect(await totals({}, inactive.id)).toEqual(expected(0, 0, 0, 0, 0));
    await expect(
      runAs(db, { role: "anon" }, () => db.query("select * from public.inventory_totals()")),
    ).rejects.toThrow(/permission denied/);
  });
});
