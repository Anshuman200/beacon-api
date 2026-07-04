import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";
import os from "os";

test.describe("GraphQL body type", () => {
  test("sends the query and resolved variables as {query, variables} JSON", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("text=Execute", { timeout: 15000 });

    await page.getByPlaceholder("https://api.example.com").fill("http://localhost:3000/api/demo/echo");
    await page.getByPlaceholder("posts/1").fill("");

    const requestTabsNav = page.locator(".ant-tabs-nav").filter({ hasText: "Auth" });
    await requestTabsNav.getByRole("tab", { name: "Body" }).click();
    await page.locator(".ant-select").filter({ hasText: /^None$/ }).click();
    await page.locator(".ant-select-item-option", { hasText: "GraphQL" }).click();

    await page.locator("textarea").first().fill("query { me { name } }");
    await page.locator("textarea").nth(1).fill('{"id": "42"}');

    await page.getByRole("button", { name: /Execute/i }).click();
    await page.waitForTimeout(2000);

    await page.getByRole("tab", { name: /^Body$/ }).last().click();
    const responseText = await page.locator("body").innerText();
    expect(responseText).toContain("query { me { name } }");
    expect(responseText).toContain('"id": "42"');
  });
});

test.describe("real file uploads", () => {
  test("sends an actual file through the multipart path to the local echo endpoint", async ({ page }) => {
    const tmpFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "beacon-e2e-upload-")), "hello.txt");
    fs.writeFileSync(tmpFile, "Hello from the Beacon E2E suite!");

    await page.goto("/");
    await page.waitForSelector("text=Execute", { timeout: 15000 });

    await page.getByPlaceholder("https://api.example.com").fill("http://localhost:3000/api/demo/echo");
    await page.getByPlaceholder("posts/1").fill("");

    const methodSelect = page.locator(".ant-select").filter({ hasText: "GET" }).first();
    await methodSelect.click();
    await page.locator(".ant-select-item-option", { hasText: "POST" }).first().click();

    const requestTabsNav = page.locator(".ant-tabs-nav").filter({ hasText: "Auth" });
    await requestTabsNav.getByRole("tab", { name: "Body" }).click();
    await page.locator(".ant-select").filter({ hasText: /^None$/ }).click();
    await page.locator(".ant-select-item-option", { hasText: "Form Data" }).click();

    await page.getByRole("button", { name: /Add Parameter/i }).click();
    await page.getByPlaceholder("Key").last().fill("upload");
    await page.locator(".ant-segmented-item", { hasText: "File" }).last().click();
    await page.locator('input[type="file"]').last().setInputFiles(tmpFile);
    await page.waitForTimeout(300);

    await page.getByRole("button", { name: /Execute/i }).click();
    await page.waitForTimeout(3000);

    const responseText = await page.locator("body").innerText();
    expect(responseText).toContain("Hello from the Beacon E2E suite!");
    expect(responseText).toContain("hello.txt");
  });

  test("reverts to an empty file field on reload instead of a broken placeholder", async ({ page }) => {
    const tmpFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "beacon-e2e-upload-")), "reload-test.txt");
    fs.writeFileSync(tmpFile, "content");

    await page.goto("/");
    await page.waitForSelector("text=Execute", { timeout: 15000 });

    const requestTabsNav = page.locator(".ant-tabs-nav").filter({ hasText: "Auth" });
    await requestTabsNav.getByRole("tab", { name: "Body" }).click();
    await page.locator(".ant-select").filter({ hasText: /^None$/ }).click();
    await page.locator(".ant-select-item-option", { hasText: "Form Data" }).click();
    await page.getByRole("button", { name: /Add Parameter/i }).click();
    await page.getByPlaceholder("Key").last().fill("attachment");
    await page.locator(".ant-segmented-item", { hasText: "File" }).last().click();
    await page.locator('input[type="file"]').last().setInputFiles(tmpFile);
    await page.waitForTimeout(300);

    const consoleErrors: string[] = [];
    page.on("pageerror", (err) => consoleErrors.push(err.message));

    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector("text=Execute", { timeout: 15000 });

    expect(consoleErrors).toHaveLength(0);
    // The field survives (key persisted) but the file itself is cleanly gone, not a broken `{}`.
    expect(await page.locator("body").innerText()).toContain("attachment");
    expect(await page.locator("body").innerText()).not.toContain("[object Object]");
  });
});
