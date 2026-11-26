import { expect, test } from "@playwright/test";

test("home page remains usable without horizontal overflow at common viewport widths", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: /make every word/i })).toBeVisible();
  await expect(page.getByText("Upload your media")).toBeVisible();
  await expect(page.locator("#language")).toBeVisible();
  await expect(page.locator(".uploadBox")).toBeVisible();

  for (const width of [320, 360, 375, 390, 414, 600, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(80);
    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
    }));
    expect(
      dimensions.document,
      `document overflows at ${width}px: ${JSON.stringify(dimensions)}`,
    ).toBeLessThanOrEqual(dimensions.viewport + 1);
    expect(
      dimensions.body,
      `body overflows at ${width}px: ${JSON.stringify(dimensions)}`,
    ).toBeLessThanOrEqual(dimensions.viewport + 1);
  }
});
