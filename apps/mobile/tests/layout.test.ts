import assert from "node:assert/strict";
import { test } from "node:test";
import { mobileLayout, consumerTabs } from "../src/theme/layout";
import { activateConsumerTab, tabAnimation } from "../src/theme/tab-actions";
import { authScreenAnimation } from "../src/theme/auth-navigation";

test("Android auth transitions avoid outgoing animations; other platforms respect reduced motion", () => {
  assert.equal(authScreenAnimation("android", false), "none");
  assert.equal(authScreenAnimation("android", true), "none");
  assert.equal(authScreenAnimation("ios", false), "slide_from_right");
  assert.equal(authScreenAnimation("ios", true), "none");
});

test("consumer navigation keeps five unique tabs with QR in the middle", () => {
  assert.equal(consumerTabs.length, 5);
  assert.equal(new Set(consumerTabs.map((tab) => tab.name)).size, 5);
  assert.equal(consumerTabs[2].name, "scan");
  assert.deepEqual(
    consumerTabs.map((tab) => tab.title),
    ["Trang chủ", "Doanh nghiệp", "Quét QR", "Sản phẩm", "Tài khoản"],
  );
});
test("quick actions fit small phones/tablets and switch to one column with large text", () => {
  for (const width of [320, 360, 390, 768, 1440]) {
    const layout = mobileLayout(width);
    const available =
      Math.min(width, layout.contentMaxWidth) - 2 * layout.horizontalPadding;
    assert.ok(available > 0);
    if (layout.quickActionWidth === "48%")
      assert.ok(available * 0.96 + 12 <= available);
    assert.equal(mobileLayout(width, 1.5).quickActionWidth, "100%");
    assert.equal(mobileLayout(width, 2).quickActionWidth, "100%");
  }
  assert.equal(mobileLayout(320).horizontalPadding, 16);
  assert.equal(mobileLayout(320).quickActionWidth, "100%");
});
test("tab switching emits the cancellable event before navigating once", () => {
  const events: string[] = [];
  assert.equal(
    activateConsumerTab(
      false,
      () => {
        events.push("tabPress");
        return { defaultPrevented: false };
      },
      () => events.push("navigate"),
    ),
    true,
  );
  assert.deepEqual(events, ["tabPress", "navigate"]);
});
test("selected/prevented tabs cannot push duplicate routes; reduced motion disables fading", () => {
  let events = 0,
    navigations = 0;
  for (const [selected, prevented] of [
    [true, false],
    [false, true],
    [true, true],
  ]) {
    assert.equal(
      activateConsumerTab(
        selected,
        () => {
          events++;
          return { defaultPrevented: prevented };
        },
        () => {
          navigations++;
        },
      ),
      false,
    );
  }
  assert.equal(events, 3);
  assert.equal(navigations, 0);
  assert.equal(tabAnimation(true), "none");
  assert.equal(tabAnimation(false), "fade");
});
