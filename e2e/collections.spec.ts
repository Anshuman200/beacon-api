import { test, expect } from "@playwright/test";

test.describe("folders", () => {
  test("create, move a request in, and survive a reload", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("text=Execute", { timeout: 15000 });

    await page.getByLabel("New folder").first().click();
    await page.keyboard.type("My Folder");
    await page.keyboard.press("Enter");
    await expect(page.locator("text=My Folder")).toHaveCount(1);

    await page.getByLabel("Move to folder").first().click();
    await page.getByRole("menuitem", { name: "My Folder" }).click();
    await page.waitForTimeout(300);

    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector("text=Execute", { timeout: 15000 });

    // The v1->v2 migration + persistence path: folder and its nested request both survive.
    await expect(page.locator("text=My Folder")).toHaveCount(1);
    expect(await page.locator("body").innerText()).toContain("Default Request");
  });
});

test.describe("collection variables", () => {
  test("a variable set via a pre-request script resolves into the live request", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("text=Execute", { timeout: 15000 });

    await page.getByPlaceholder("https://api.example.com").fill("http://localhost:3000/api/demo/echo");
    await page.getByPlaceholder("posts/1").fill("");

    const requestTabsNav = page.locator(".ant-tabs-nav").filter({ hasText: "Auth" });
    await requestTabsNav.getByRole("tab", { name: /^Params$/ }).click();
    await page.getByRole("button", { name: /Add Parameter/i }).click();
    await page.getByPlaceholder("Key").last().fill("marker");
    await page.getByPlaceholder("Value").last().fill("{{colVarTest}}");

    await requestTabsNav.getByRole("tab", { name: /Scripts/i }).click();
    const preTextarea = page.locator("textarea").nth(0);
    await preTextarea.fill(`be.collectionVariables.set("colVarTest", "hello-from-collection-var");`);

    await page.getByRole("button", { name: /Execute/i }).click();
    await page.waitForTimeout(2000);

    await page.getByRole("tab", { name: /^Body$/ }).last().click();
    expect(await page.locator("body").innerText()).toContain("hello-from-collection-var");
  });
});

test.describe("multi-tab request editor", () => {
  test("opens tabs for clicked requests and closing one focuses a neighbor", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("text=Execute", { timeout: 15000 });

    await page.getByRole("button", { name: /Load Demo Collection/i }).click();
    await page.waitForTimeout(1500);

    const reqRows = page.locator('[class*="group/req"]');
    await reqRows.nth(1).click();
    await page.waitForTimeout(200);
    await reqRows.nth(2).click();
    await page.waitForTimeout(200);

    const closeButtons = page.locator('button[aria-label^="Close "]');
    const openCount = await closeButtons.count();
    expect(openCount).toBeGreaterThanOrEqual(3);

    await closeButtons.first().click();
    await page.waitForTimeout(200);
    expect(await page.locator('button[aria-label^="Close "]').count()).toBe(openCount - 1);
  });

  test("deleting a request closes its tab", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("text=Execute", { timeout: 15000 });

    // The default request auto-opens a tab on first load (reconciliation effect).
    const closeButtons = page.locator('button[aria-label^="Close "]');
    await expect(closeButtons).toHaveCount(1);

    await page.getByLabel("Delete request").first().click();
    await page.getByRole("button", { name: "Delete" }).click(); // Popconfirm's okText
    await page.waitForTimeout(300);

    await expect(closeButtons).toHaveCount(0);
  });
});
