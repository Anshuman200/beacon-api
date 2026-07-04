import { test, expect } from "@playwright/test";

test.describe("script sandbox isolation", () => {
  test("a full prototype-chain escape still can't reach fetch/importScripts/WebSocket", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("text=Execute", { timeout: 15000 });

    const requestTabsNav = page.locator(".ant-tabs-nav").filter({ hasText: "Auth" });
    await requestTabsNav.getByRole("tab", { name: /Scripts/i }).click();

    const postTextarea = page.locator("textarea").nth(1);
    await postTextarea.click();
    await postTextarea.fill(`
      var g = (function(){}).constructor("return this")();
      console.log("HAS_FETCH:", typeof g.fetch);
      console.log("HAS_IMPORTSCRIPTS:", typeof g.importScripts);
      console.log("HAS_WEBSOCKET:", typeof g.WebSocket);
      be.test("script ran to completion", () => { be.expect(1 + 1).to.equal(2); });
    `);

    await page.getByRole("button", { name: /Execute/i }).click();
    await page.waitForTimeout(3000);

    await page.getByRole("tab", { name: /^Console/i }).last().click();
    const consoleText = (await page.locator("body").innerText()).toLowerCase();
    expect(consoleText).toContain("has_fetch: undefined");
    expect(consoleText).toContain("has_importscripts: undefined");
    expect(consoleText).toContain("has_websocket: undefined");

    // Confirms the escape didn't also break normal script execution (test still ran).
    await page.getByRole("tab", { name: /^Tests/i }).last().click();
    expect(await page.locator("body").innerText()).toContain("4 / 4");
  });
});

test.describe("OAuth2 Authorization Code — CSRF/state protection", () => {
  test("rejects a callback message with a mismatched state instead of accepting it", async ({ page, context }) => {
    await page.goto("/");
    await page.waitForSelector("text=Execute", { timeout: 15000 });

    const requestTabsNav = page.locator(".ant-tabs-nav").filter({ hasText: "Auth" });
    await requestTabsNav.getByRole("tab", { name: "Auth" }).click();

    await page.locator(".ant-select").filter({ hasText: "No Auth" }).click();
    await page.locator(".ant-select-item-option", { hasText: "OAuth 2.0" }).click();
    await page.locator(".ant-select").filter({ hasText: "Client Credentials" }).click();
    await page.locator(".ant-select-item-option", { hasText: "Authorization Code" }).click();

    // Authorization URL points at a page that never posts a callback message —
    // the only message the flow will ever receive is the forged one below, so
    // there's no race with a legitimate completion.
    await page.getByPlaceholder("https://auth.example.com/oauth/authorize").fill("http://localhost:3000/");
    await page.getByPlaceholder("https://auth.example.com/oauth/token").fill("http://localhost:3000/api/demo/oauth-token");
    await page.getByPlaceholder("Client ID").fill("test-client");

    const [popup] = await Promise.all([
      context.waitForEvent("page"),
      page.getByRole("button", { name: /Get New Access Token/i }).click(),
    ]);
    await popup.waitForLoadState("domcontentloaded").catch(() => {});

    // Forge a same-origin message with the right shape but a bogus state.
    await page.evaluate(() => {
      window.postMessage(
        { source: "beacon-oauth-callback", code: "forged_code", state: "not-the-real-state", error: null, errorDescription: null },
        window.location.origin
      );
    });

    await page.waitForTimeout(1000);
    const bodyText = (await page.locator("body").innerText()).toLowerCase();
    expect(bodyText).toContain("state mismatch");
    // No token should have been accepted from the forged message.
    expect(bodyText).not.toContain("current token");

    await popup.close().catch(() => {});
  });
});

test.describe("Security testing panel", () => {
  test("passive analysis flags missing security headers on a real response", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("text=Execute", { timeout: 15000 });

    await page.getByPlaceholder("https://api.example.com").fill("https://httpbin.org");
    await page.getByPlaceholder("posts/1").fill("get");
    await page.getByRole("button", { name: /Execute/i }).click();
    await page.waitForSelector("text=STATUS CODE", { timeout: 20000 });

    const requestTabsNav = page.locator(".ant-tabs-nav").filter({ hasText: "Auth" });
    await requestTabsNav.getByRole("tab", { name: "Security" }).click();
    await page.getByRole("button", { name: /Analyze Last Response/i }).click();
    await page.waitForTimeout(500);

    const bodyText = (await page.locator("body").innerText()).toLowerCase();
    expect(bodyText).toContain("missing");
    expect(bodyText).toContain("header");
  });

  test("renders all 10 OWASP checklist categories and lets you set a status", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("text=Execute", { timeout: 15000 });

    const requestTabsNav = page.locator(".ant-tabs-nav").filter({ hasText: "Auth" });
    await requestTabsNav.getByRole("tab", { name: "Security" }).click();

    const bodyText = await page.locator("body").innerText();
    for (const code of ["API1:2023", "API5:2023", "API10:2023"]) {
      expect(bodyText).toContain(code);
    }

    const statusSelects = page.locator(".ant-select").filter({ hasText: "Not tested" });
    await expect(statusSelects).toHaveCount(10);

    await statusSelects.first().click();
    await page.locator(".ant-select-item-option", { hasText: "Pass" }).first().click();
    await page.waitForTimeout(200);
    expect(await page.locator("body").innerText()).toContain("Pass");
  });

  test("active XSS probe detects reflected input on the local echo endpoint", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("text=Execute", { timeout: 15000 });

    await page.getByPlaceholder("https://api.example.com").fill("http://localhost:3000/api/demo/echo");
    await page.getByPlaceholder("posts/1").fill("");

    const requestTabsNav = page.locator(".ant-tabs-nav").filter({ hasText: "Auth" });
    await requestTabsNav.getByRole("tab", { name: /^Params$/ }).click();
    await page.getByRole("button", { name: /Add Parameter/i }).click();
    await page.getByPlaceholder("Key").last().fill("q");

    await requestTabsNav.getByRole("tab", { name: "Security" }).click();
    await page.getByText("Active Probes", { exact: true }).click(); // expand the collapsed section
    await page.getByText("XSS", { exact: true }).click();
    await page.locator(".ant-select").filter({ hasText: "Select a field to probe" }).click();
    await page.locator(".ant-select-item-option", { hasText: "Param: q" }).click();
    await page.getByText(/I'm authorized to security-test/i).click();

    const runProbesBtn = page.getByRole("button", { name: /Run Probes/i });
    await expect(runProbesBtn).toBeEnabled();
    await runProbesBtn.click();
    await page.waitForTimeout(4000);

    const bodyText = (await page.locator("body").innerText()).toLowerCase();
    expect(bodyText).toContain("reflected xss");
  });

  test("auth helper flags an endpoint that responds fine with no auth at all", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("text=Execute", { timeout: 15000 });

    await page.getByPlaceholder("https://api.example.com").fill("http://localhost:3000/api/demo/echo");
    await page.getByPlaceholder("posts/1").fill("");

    const requestTabsNav = page.locator(".ant-tabs-nav").filter({ hasText: "Auth" });
    await requestTabsNav.getByRole("tab", { name: "Auth" }).click();
    await page.locator(".ant-select").filter({ hasText: "No Auth" }).click();
    await page.locator(".ant-select-item-option", { hasText: "Bearer Token" }).click();
    await page.getByPlaceholder("Token").fill("some-token-value");

    await requestTabsNav.getByRole("tab", { name: "Security" }).click();
    await page.getByText("Auth Helpers", { exact: true }).click(); // expand the collapsed section
    await page.getByRole("button", { name: /Test Without Auth/i }).click();
    await page.waitForTimeout(2000);

    const bodyText = (await page.locator("body").innerText()).toLowerCase();
    expect(bodyText).toContain("without any auth");
  });

  test("Quick Security Check runs response analysis + auth helpers with no configuration", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("text=Execute", { timeout: 15000 });

    await page.getByPlaceholder("https://api.example.com").fill("https://httpbin.org");
    await page.getByPlaceholder("posts/1").fill("get");

    const requestTabsNav = page.locator(".ant-tabs-nav").filter({ hasText: "Auth" });
    await requestTabsNav.getByRole("tab", { name: "Auth" }).click();
    await page.locator(".ant-select").filter({ hasText: "No Auth" }).click();
    await page.locator(".ant-select-item-option", { hasText: "Bearer Token" }).click();
    await page.getByPlaceholder("Token").fill("some-token");

    await page.getByRole("button", { name: /Execute/i }).click();
    await page.waitForSelector("text=STATUS CODE", { timeout: 20000 });
    await page.waitForSelector("text=No Response Yet", { state: "detached", timeout: 20000 }).catch(() => {});

    await requestTabsNav.getByRole("tab", { name: "Security" }).click();
    await expect(page.locator("text=Quick Security Check")).toBeVisible();

    await page.getByRole("button", { name: /Run Check/i }).click();
    await page.waitForTimeout(4000);

    const bodyText = (await page.locator("body").innerText()).toLowerCase();
    // Both sub-checks ran and their sections auto-expanded — no category/target picking needed.
    expect(bodyText).toContain("missing");
    expect(bodyText).toContain("header");
    expect(bodyText).toMatch(/without any auth|malformed token/);
  });
});
