import test from "node:test";
import assert from "node:assert/strict";
import { SupplyTab } from "../js/logic/SupplyTab.js";

test("the Supply tab owns order changes and clears only a successfully placed order", () => {
  let placedOrder = null;
  const scene = {
    supply: {
      orderSummary(order) {
        const crates = [...order.values()].reduce((sum, count) => sum + count, 0);
        return { crates, maxCrates: 1, canPlace: crates === 1, problem: null };
      },
      placeOrder(order) {
        placedOrder = new Map(order);
        return true;
      },
    },
    showShopMessage() {
      assert.fail("A valid order should not show an error");
    },
  };
  const tab = new SupplyTab(scene);

  tab.changeOrder("rations", 1);
  tab.changeOrder("rations", 1);
  assert.deepEqual([...tab.order], [["rations", 1]]);

  tab.placeOrder();
  assert.deepEqual([...placedOrder], [["rations", 1]]);
  assert.equal(tab.order.size, 0);
});

test("a failed Supply order stays in the tab so it can be corrected", () => {
  const scene = {
    supply: {
      orderSummary: () => ({
        crates: 1, maxCrates: 1, canPlace: true, problem: null,
      }),
      placeOrder: () => false,
    },
  };
  const tab = new SupplyTab(scene);
  tab.order.set("rations", 1);

  tab.placeOrder();

  assert.deepEqual([...tab.order], [["rations", 1]]);
});
