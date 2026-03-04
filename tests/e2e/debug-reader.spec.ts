import { expect, test } from "@playwright/test";

const IMAGE_HEADERS = {
  "content-type": "image/png",
};
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9sX6ix8AAAAASUVORK5CYII=",
  "base64",
);

test("debug reader paging", async ({ page }) => {
  const patchBodies: Array<Record<string, unknown>> = [];
  const postBodies: Array<Record<string, unknown>> = [];

  await page.route("**/api/media/**", async (route) => {
    await route.fulfill({
      status: 200,
      headers: IMAGE_HEADERS,
      body: TINY_PNG,
    });
  });
  await page.route("**/api/chapters/ch-*/pages", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          index: 0,
          imageUrl: "/api/media/page?url=https%3A%2F%2Fhot.planeptune.us%2Fpage-1.jpg",
        },
        {
          index: 1,
          imageUrl: "/api/media/page?url=https%3A%2F%2Fhot.planeptune.us%2Fpage-2.jpg",
        },
        {
          index: 2,
          imageUrl: "/api/media/page?url=https%3A%2F%2Fhot.planeptune.us%2Fpage-3.jpg",
        },
      ]),
    });
  });
  await page.route("**/api/series/series-1/chapters", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        { sourceChapterId: "ch-1", chapterNo: 1, title: "Chapter 1" },
        { sourceChapterId: "ch-2", chapterNo: 2, title: "Chapter 2" },
      ]),
    });
  });
  await page.route("**/api/reader/state?seriesId=series-1&chapterId=*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        preferences: {
          readingDirection: "vertical",
          fitMode: "width",
        },
        progress: {
          currentPage: 1,
          completed: false,
          updatedAt: null,
        },
      }),
    });
  });
  await page.route("**/api/reader/state", async (route) => {
    if (route.request().method() === "PATCH") {
      patchBodies.push(route.request().postDataJSON() as Record<string, unknown>);
    }
    if (route.request().method() === "POST") {
      postBodies.push(route.request().postDataJSON() as Record<string, unknown>);
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });

  await page.goto("/read/series-1/ch-1");
  await page.getByRole("button", { name: "Toggle reader controls" }).click();
  await page.getByRole("button", { name: "Hide progress bar" }).click();
  await expect(page.getByLabel("Reading progress bar")).toBeHidden();
  await page.waitForSelector("text=2/3");
  await page.keyboard.press("m");
  await expect.poll(() => patchBodies.length).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page.getByAltText("Page 3")).toBeVisible();
  await page.keyboard.press("m");
  await page.keyboard.press("m");
  await page.getByRole("button", { name: "Close overlay" }).click();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.getByRole("button", { name: "Advance to Chapter 2" }).click();
  await expect(page).toHaveURL(/\/read\/series-1\/ch-2$/);
  await page.waitForTimeout(900);
  expect(postBodies.length).toBeGreaterThan(0);
});
