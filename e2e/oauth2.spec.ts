import { test, expect } from "@playwright/test";

test.describe("OAuth2 Client Credentials", () => {
  test("fetches a token and attaches it as Authorization: Bearer on the next request", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("text=Execute", { timeout: 15000 });

    const requestTabsNav = page.locator(".ant-tabs-nav").filter({ hasText: "Auth" });
    await requestTabsNav.getByRole("tab", { name: "Auth" }).click();

    await page.locator(".ant-select").filter({ hasText: "No Auth" }).click();
    await page.locator(".ant-select-item-option", { hasText: "OAuth 2.0" }).click();

    await page.getByPlaceholder("https://auth.example.com/oauth/token").fill("http://localhost:3000/api/demo/oauth-token");
    await page.getByPlaceholder("Client ID").fill("test-client");
    await page.getByPlaceholder("Client Secret").fill("test-secret");

    await page.getByRole("button", { name: /Get New Access Token/i }).click();
    await page.waitForTimeout(1500);

    const bodyText = (await page.locator("body").innerText()).toLowerCase();
    expect(bodyText).toContain("current token");
    expect(bodyText).toContain("demo_client_credentials");

    // Send a request and confirm the token is actually attached, not just displayed.
    await page.getByPlaceholder("https://api.example.com").fill("http://localhost:3000/api/demo/echo");
    await page.getByPlaceholder("posts/1").fill("");
    await page.getByRole("button", { name: /Execute/i }).click();
    await page.waitForTimeout(2000);

    const responseBodyTab = page.locator(".ant-tabs-nav").filter({ hasText: "Console" }).getByRole("tab", { name: "Body" });
    await responseBodyTab.click();
    const responseText = (await page.locator("body").innerText()).toLowerCase();
    expect(responseText).toMatch(/authorization.*bearer demo_client_credentials/);
  });

  test("reuses a cached, unexpired token instead of fetching again", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("text=Execute", { timeout: 15000 });

    const requestTabsNav = page.locator(".ant-tabs-nav").filter({ hasText: "Auth" });
    await requestTabsNav.getByRole("tab", { name: "Auth" }).click();
    await page.locator(".ant-select").filter({ hasText: "No Auth" }).click();
    await page.locator(".ant-select-item-option", { hasText: "OAuth 2.0" }).click();
    await page.getByPlaceholder("https://auth.example.com/oauth/token").fill("http://localhost:3000/api/demo/oauth-token");
    await page.getByPlaceholder("Client ID").fill("test-client");
    await page.getByPlaceholder("Client Secret").fill("test-secret");

    await page.getByRole("button", { name: /Get New Access Token/i }).click();
    await page.waitForTimeout(1500);
    const firstToken = (await page.locator("body").innerText()).match(/demo_client_credentials_\w+/)?.[0];

    await page.getByPlaceholder("https://api.example.com").fill("http://localhost:3000/api/demo/echo");
    await page.getByPlaceholder("posts/1").fill("");
    await page.getByRole("button", { name: /Execute/i }).click();
    await page.waitForTimeout(2000);

    const responseBodyTab = page.locator(".ant-tabs-nav").filter({ hasText: "Console" }).getByRole("tab", { name: "Body" });
    await responseBodyTab.click();
    const responseText = await page.locator("body").innerText();
    // The token attached to the request is the same one that was fetched — no silent re-fetch happened.
    expect(responseText).toContain(firstToken);
  });
});

test.describe("OAuth2 Authorization Code + PKCE", () => {
  test("completes the full popup -> callback -> token exchange round trip", async ({ page, context }) => {
    await page.goto("/");
    await page.waitForSelector("text=Execute", { timeout: 15000 });

    const requestTabsNav = page.locator(".ant-tabs-nav").filter({ hasText: "Auth" });
    await requestTabsNav.getByRole("tab", { name: "Auth" }).click();

    await page.locator(".ant-select").filter({ hasText: "No Auth" }).click();
    await page.locator(".ant-select-item-option", { hasText: "OAuth 2.0" }).click();
    await page.locator(".ant-select").filter({ hasText: "Client Credentials" }).click();
    await page.locator(".ant-select-item-option", { hasText: "Authorization Code" }).click();

    await page.getByPlaceholder("https://auth.example.com/oauth/token").fill("http://localhost:3000/api/demo/oauth-token");
    await page.getByPlaceholder("https://auth.example.com/oauth/authorize").fill("http://localhost:3000/api/demo/oauth-authorize");
    await page.getByPlaceholder("Client ID").fill("test-client");
    await page.getByPlaceholder("Client Secret").fill("test-secret");

    const [popup] = await Promise.all([
      context.waitForEvent("page"),
      page.getByRole("button", { name: /Get New Access Token/i }).click(),
    ]);
    await popup.waitForEvent("close", { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(1000);

    const bodyText = (await page.locator("body").innerText()).toLowerCase();
    expect(bodyText).toContain("current token");
    expect(bodyText).toContain("demo_authorization_code");
  });
});
