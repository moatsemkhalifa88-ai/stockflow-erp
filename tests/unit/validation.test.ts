import { describe, expect, it } from "vitest";
import { describeDbError } from "@/lib/db-errors";
import { businessDayRange } from "@/lib/format";
import { buildHref, getSearchParam, getSortParam } from "@/lib/search-params";
import { validateAdjustment, type AdjustmentFormValues } from "@/lib/validation/movement";
import { validateProduct, type ProductFormValues } from "@/lib/validation/product";
import { readWarehouseForm, validateWarehouse, type WarehouseFormValues } from "@/lib/validation/warehouse";

const CATEGORY_ID = "8a6b2f0e-3c1d-4e5f-9a7b-1c2d3e4f5a6b";
const PRODUCT_ID = "0f1e2d3c-4b5a-4968-8776-655443322110";
const WAREHOUSE_ID = "11111111-2222-4333-8444-555555555555";

const validProduct: ProductFormValues = {
  sku: "CMP-2100",
  name: "USB Hub 4-Port",
  description: "",
  category_id: CATEGORY_ID,
  unit_of_measure: "EA",
  barcode: "7290001234567",
  cost_price: "30",
  sale_price: "59.90",
  min_stock_level: "10",
  reorder_quantity: "25",
};

describe("validateProduct", () => {
  it("accepts a valid product and converts numbers and empty strings", () => {
    const result = validateProduct({ ...validProduct, barcode: "" });
    expect(result).toEqual({
      ok: true,
      value: {
        ...validProduct,
        description: null,
        barcode: null,
        cost_price: 30,
        sale_price: 59.9,
        min_stock_level: 10,
        reorder_quantity: 25,
      },
    });
  });

  it("mirrors the database constraints field by field", () => {
    const result = validateProduct({
      ...validProduct,
      sku: "x",
      name: "",
      category_id: "not-a-uuid",
      unit_of_measure: "GALLON",
      barcode: "12AB",
      cost_price: "-1",
      sale_price: "1.999",
      min_stock_level: "2.5",
      reorder_quantity: "",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.errors).sort()).toEqual(
        [
          "barcode",
          "category_id",
          "cost_price",
          "min_stock_level",
          "name",
          "reorder_quantity",
          "sale_price",
          "sku",
          "unit_of_measure",
        ].sort(),
      );
    }
  });
});

describe("validateAdjustment", () => {
  const valid: AdjustmentFormValues = {
    movement_type: "ADJUSTMENT_OUT",
    product_id: PRODUCT_ID,
    warehouse_id: WAREHOUSE_ID,
    quantity: "3",
    reason: "Damaged in handling",
    reference_number: "",
    notes: "",
  };

  it("accepts a valid adjustment", () => {
    expect(validateAdjustment(valid)).toEqual({
      ok: true,
      value: { ...valid, quantity: 3, reference_number: null, notes: null },
    });
  });

  it("requires a reason", () => {
    const result = validateAdjustment({ ...valid, reason: "" });
    expect(result).toMatchObject({ ok: false, errors: { reason: expect.any(String) } });
  });

  it("only allows manual movement types", () => {
    expect(validateAdjustment({ ...valid, movement_type: "SALE" })).toMatchObject({
      ok: false,
      errors: { movement_type: expect.any(String) },
    });
  });

  it("rejects zero, negative and fractional quantities", () => {
    for (const quantity of ["0", "-2", "1.5", "abc"]) {
      expect(validateAdjustment({ ...valid, quantity })).toMatchObject({ ok: false, errors: { quantity: expect.any(String) } });
    }
  });
});

describe("validateWarehouse", () => {
  const valid: WarehouseFormValues = {
    code: "WH-NTN",
    name: "Netanya Regional Warehouse",
    warehouse_type: "REGIONAL",
    address_line: "",
    city: "Netanya",
    country: "Israel",
    phone: "09-555-0700",
    manager_id: "",
  };

  it("accepts a valid warehouse and turns empty optional fields into null", () => {
    expect(validateWarehouse(valid)).toEqual({
      ok: true,
      value: { ...valid, address_line: null, manager_id: null },
    });
  });

  it("mirrors the database constraints field by field", () => {
    const result = validateWarehouse({
      ...valid,
      code: "x",
      name: "",
      warehouse_type: "FACTORY",
      city: "",
      country: "",
      phone: "call me",
      manager_id: "not-a-uuid",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.errors).sort()).toEqual(
        ["city", "code", "country", "manager_id", "name", "phone", "warehouse_type"].sort(),
      );
    }
  });

  it("upper-cases the code when reading the form", () => {
    const form = new FormData();
    form.set("code", " wh-ntn ");
    expect(readWarehouseForm(form).code).toBe("WH-NTN");
  });
});

describe("search params", () => {
  it("strips PostgREST filter syntax from free-text search", () => {
    expect(getSearchParam({ q: "  mouse),sku.eq.(x*%  " })).toBe("mouse sku eq x");
  });

  it("reads ascending and descending sort, falling back for unknown columns", () => {
    const allowed = ["name", "sku"] as const;
    const fallback = { column: "sku" as const, ascending: true };
    expect(getSortParam({ sort: "-name" }, allowed, fallback)).toEqual({ column: "name", ascending: false });
    expect(getSortParam({ sort: "drop table" }, allowed, fallback)).toEqual(fallback);
  });

  it("builds links that keep filters and drop empty values", () => {
    expect(buildHref("/products", { q: "hub", page: "3", status: "" }, { page: undefined, sort: "-name" })).toBe(
      "/products?q=hub&sort=-name",
    );
  });
});

describe("businessDayRange", () => {
  it("uses the Israel summer and winter offsets", () => {
    expect(businessDayRange("2026-07-01")).toEqual({
      start: "2026-07-01T00:00:00+03:00",
      end: "2026-07-01T23:59:59.999+03:00",
    });
    expect(businessDayRange("2026-01-15").start).toBe("2026-01-15T00:00:00+02:00");
  });
});

describe("describeDbError", () => {
  it("passes through messages raised by the inventory engine", () => {
    expect(describeDbError({ code: "SF001", message: "Insufficient stock: 5 available, 6 requested" })).toBe(
      "Insufficient stock: 5 available, 6 requested",
    );
  });

  it("explains unique constraint violations", () => {
    expect(
      describeDbError({ code: "23505", message: 'duplicate key value violates unique constraint "products_sku_key"' }),
    ).toBe("A product with this SKU already exists.");
  });

  it("hides unexpected internals", () => {
    expect(describeDbError({ code: "XX000", message: "internal error at 0x0" })).toBe(
      "The operation could not be completed.",
    );
  });
});
