import { readFileSync } from "node:fs";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DraftService } from "../src/service/draft-service.js";
import { PolicyService } from "../src/service/policy-service.js";
import { SaleService } from "../src/service/sale-service.js";
import { D1DraftStore, D1SaleItemStore, D1SellerPolicyStore, type D1Binding } from "../src/storage/d1.js";

describe("D1 persistence", () => {
  const runtime = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    d1Databases: { DB: "test-db" },
  });
  let db: D1Binding;

  beforeAll(async () => {
    const d1 = await runtime.getD1Database("DB");
    for (const file of ["001_initial.sql", "002_listing_drafts.sql"]) {
      const sql = readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8");
      for (const statement of sql.split(";").map((part) => part.trim()).filter(Boolean)) {
        await d1.prepare(statement).run();
      }
    }
    db = d1 as unknown as D1Binding;
  });

  afterAll(async () => { await runtime.dispose(); });

  it("persists the 25% default and a policy change across store instances", async () => {
    const first = new PolicyService(new D1SellerPolicyStore(db));
    await expect(first.getSellerPolicy()).resolves.toEqual({ shippingSafetyMarginBps: 2500 });
    await first.setShippingSafetyMarginBps(3000);
    const second = new PolicyService(new D1SellerPolicyStore(db));
    await expect(second.getSellerPolicy()).resolves.toEqual({ shippingSafetyMarginBps: 3000 });
    const sale = new SaleService(new D1SaleItemStore(db), second);
    await expect(sale.estimateProtectedShipping({ currency: "USD", minorUnits: 1000 })).resolves.toMatchObject({
      protectedEstimate: { currency: "USD", minorUnits: 1300 },
    });
  });

  it("round-trips sale items and local drafts across store instances", async () => {
    const sale = new SaleService(new D1SaleItemStore(db), new PolicyService(new D1SellerPolicyStore(db)));
    const item = await sale.createSaleItem({ brand: "Synthetic Brand" });
    await expect(new D1SaleItemStore(db).get(item.id)).resolves.toEqual(item);
    await expect(new D1SaleItemStore(db).get(crypto.randomUUID())).resolves.toBeUndefined();

    const draftService = new DraftService(new D1DraftStore(db));
    const draft = await draftService.createDraft({
      itemId: item.id,
      title: "Synthetic test item",
      description: "Fixture only",
      condition: "Used",
      saleFormat: "FIXED_PRICE",
      price: { currency: "USD", minorUnits: 1000 },
      itemSpecifics: { Color: "Blue" },
    });
    await expect(new D1DraftStore(db).get(draft.id)).resolves.toEqual(draft);
  });
});
