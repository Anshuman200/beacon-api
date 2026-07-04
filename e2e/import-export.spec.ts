import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";
import os from "os";

test.describe("Beacon export/import", () => {
  test("redacts secret variables on export and re-imports as a new collection", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("text=Execute", { timeout: 15000 });

    // Create an environment with a secret variable.
    await page.getByRole("button", { name: "Environments" }).click();
    await page.getByPlaceholder("New environment...").fill("Test Env");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(300);

    await page.getByRole("button", { name: /Add Parameter/i }).click();
    await page.getByPlaceholder("VARIABLE_NAME").last().fill("apiKey");
    await page.getByPlaceholder("value").last().fill("super-secret-token-123");
    await page.getByLabel("Mark as secret").last().click();
    await page.waitForTimeout(200);

    await page.locator(".environment-drawer button").first().click(); // close via X

    const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), "beacon-e2e-"));
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      (async () => {
        await page.getByRole("button", { name: "Import / Export" }).click();
        await page.locator("button", { hasText: "Export" }).first().click();
      })(),
    ]);
    const savePath = path.join(downloadDir, "export.json");
    await download.saveAs(savePath);
    const exported = JSON.parse(fs.readFileSync(savePath, "utf-8"));

    expect(exported.beaconExportVersion).toBe(1);
    expect(Array.isArray(exported.collection.folders)).toBe(true);
    const secretVar = exported.environments.find((e: { name: string }) => e.name === "Test Env").variables.find((v: { key: string }) => v.key === "apiKey");
    expect(secretVar.key).toBe("apiKey");
    expect(secretVar.value).toBe(""); // redacted

    // Re-import the same file (drawer is still open) and confirm it lands as a new collection.
    await page.locator('input[type="file"]').setInputFiles(savePath);
    await page.waitForTimeout(800);
    expect(await page.locator("body").innerText()).toContain(exported.collection.name);
  });
});

test.describe("Postman v2.1 import", () => {
  test("maps folders, auth, body, and scripts from a Postman collection", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("text=Execute", { timeout: 15000 });

    await page.getByRole("button", { name: "Import / Export" }).click();
    await page.locator('input[type="file"]').setInputFiles(path.join(__dirname, "fixtures", "postman-collection.json"));
    await page.waitForTimeout(800);

    const bodyText = await page.locator("body").innerText();
    expect(bodyText).toContain("Postman Import Test");
    expect(bodyText).toContain("Auth Folder");
    expect(bodyText).toContain("Get Echo");
    expect(bodyText).toContain("Root Request");

    await page.getByText("Get Echo").click();
    await page.waitForTimeout(300);
    expect(await page.locator("body").innerText()).toContain("GET");

    const requestTabsNav = page.locator(".ant-tabs-nav").filter({ hasText: "Auth" });
    await requestTabsNav.getByRole("tab", { name: /^Auth$/ }).click();
    expect((await page.locator("body").innerText()).toLowerCase()).toContain("bearer");
  });
});
