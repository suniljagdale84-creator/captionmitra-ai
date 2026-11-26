import { expect, test } from "@playwright/test";

test("home page controls remain visible and usable without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const heading = page.getByRole("heading", { name: /make every word/i });
  const uploadBox = page.locator(".uploadBox");
  const language = page.locator("#language");
  const uploadButton = page.getByRole("button", { name: /upload securely/i });

  for (const width of [320, 360, 375, 390, 414, 600, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(heading).toBeVisible();
    await expect(page.getByRole("heading", { name: "Upload your media" })).toBeVisible();
    await expect(uploadBox).toBeVisible();
    await expect(language).toBeVisible();
    await expect(uploadButton).toBeVisible();

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

    for (const locator of [uploadBox, language, uploadButton]) {
      const bounds = await locator.boundingBox();
      expect(bounds, `control is not laid out at ${width}px`).not.toBeNull();
      expect(bounds!.x, `control starts outside viewport at ${width}px`).toBeGreaterThanOrEqual(-1);
      expect(bounds!.x + bounds!.width, `control ends outside viewport at ${width}px`).toBeLessThanOrEqual(width + 1);
    }
  }
});
