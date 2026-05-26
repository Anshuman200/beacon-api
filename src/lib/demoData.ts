/**
 * Beacon API — Built-in Demo Collection
 * Showcases all features: params, headers, auth, body, tests, scripts, seeding
 */

import type { ApiRequest, Environment } from "@/store/collectionStore";

const BASE = typeof window !== "undefined" ? window.location.origin : "http://localhost:3002";

export const DEMO_ENVIRONMENT: Omit<Environment, "id"> = {
  name: "Beacon Demo",
  variables: [
    { key: "base_url", value: BASE, enabled: true },
    { key: "api_key", value: "beacon-demo-key-2026", enabled: true },
    { key: "auth_token", value: "", enabled: true, description: "Set by Login script" },
    { key: "user_id", value: "", enabled: true, description: "Set by Create User script" },
    { key: "post_id", value: "", enabled: true, description: "Set by Create Post script" },
  ],
};

type DemoRequest = Omit<ApiRequest, "id" | "seedMode" | "repeatCount" | "delay" | "jsonItems"> & {
  id: string;
  seedMode: "repeat" | "items";
  repeatCount: number;
  delay: number;
  jsonItems: string;
};

export const DEMO_REQUESTS: DemoRequest[] = [
  // ─────────────────────────────────────────────────────────────────────────────
  // 1. Echo — Headers & Params Demo
  // ─────────────────────────────────────────────────────────────────────────────
  {
    id: "demo_req_echo",
    name: "🔊 Echo — Headers & Params",
    method: "GET",
    baseUrl: "{{base_url}}",
    endpoint: "api/demo/echo",
    contentType: "application/json",
    params: [
      { key: "env", value: "production", enabled: true, description: "Target environment" },
      { key: "version", value: "v2", enabled: true, description: "API version" },
      { key: "debug", value: "true", enabled: true, description: "Enable debug mode" },
      { key: "delay", value: "200", enabled: false, description: "Simulate latency (ms)" },
    ],
    headers: [
      { key: "x-request-id", value: "beacon-{{$timestamp}}", enabled: true, description: "Unique request ID" },
      { key: "x-client", value: "BeaconAPI/1.0", enabled: true, description: "Client identifier" },
      { key: "accept-language", value: "en-US", enabled: true },
    ],
    auth: {
      type: "none",
      bearerToken: "",
      basicUser: "",
      basicPass: "",
      apiKeyName: "x-api-key",
      apiKeyValue: "",
      apiKeyLocation: "header",
    },
    body: { type: "none", rawText: "", formdata: [], urlencoded: [] },
    assertions: [
      {
        id: "demo_assert_echo_1",
        target: "status_code",
        property: "",
        operator: "equals",
        value: "200",
      },
      {
        id: "demo_assert_echo_2",
        target: "response_time",
        property: "",
        operator: "less_than",
        value: "3000",
      },
      {
        id: "demo_assert_echo_3",
        target: "json_path",
        property: "success",
        operator: "equals",
        value: "true",
      },
    ],
    seedMode: "repeat",
    repeatCount: 1,
    delay: 0,
    jsonItems: "[]",
    preRequestScript: `// Pre-request Script: dynamically set a timestamp header
const ts = Date.now().toString();
be.environment.set("current_ts", ts);
console.log("Pre-request: timestamp set to", ts);
`,
    postResponseScript: `// Post-response Script: verify the echo worked
be.test("Status is 200", () => {
  be.response.to.have.status(200);
});

be.test("Success flag is true", () => {
  const body = be.response.json();
  be.expect(body.success).to.be.true;
});

be.test("Echo method is GET", () => {
  const body = be.response.json();
  be.expect(body.echo.method).to.equal("GET");
});

be.test("Response time is acceptable", () => {
  be.expect(be.response.responseTime).to.be.a("number");
});

console.log("Echo response received:", be.response.json().echo.method);
`,
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. Login — Auth + Script variable chaining
  // ─────────────────────────────────────────────────────────────────────────────
  {
    id: "demo_req_login",
    name: "🔐 Login — Auth & Variable Chaining",
    method: "POST",
    baseUrl: "{{base_url}}",
    endpoint: "api/demo/auth",
    contentType: "application/json",
    params: [],
    headers: [
      { key: "x-client", value: "BeaconAPI/1.0", enabled: true },
    ],
    auth: {
      type: "none",
      bearerToken: "",
      basicUser: "",
      basicPass: "",
      apiKeyName: "x-api-key",
      apiKeyValue: "",
      apiKeyLocation: "header",
    },
    body: {
      type: "json",
      rawText: JSON.stringify({ email: "alice@beacon.dev", password: "beacon123" }, null, 2),
      formdata: [],
      urlencoded: [],
    },
    assertions: [
      {
        id: "demo_assert_login_1",
        target: "status_code",
        property: "",
        operator: "equals",
        value: "200",
      },
      {
        id: "demo_assert_login_2",
        target: "json_path",
        property: "token",
        operator: "exists",
        value: "",
      },
      {
        id: "demo_assert_login_3",
        target: "content_type",
        property: "",
        operator: "contains",
        value: "application/json",
      },
    ],
    seedMode: "repeat",
    repeatCount: 1,
    delay: 0,
    jsonItems: "[]",
    preRequestScript: `// Pre-request: log which user we're logging in
console.log("[Login] Attempting login for alice@beacon.dev");
`,
    postResponseScript: `// Post-response: extract and store token for subsequent requests
be.test("Login is successful", () => {
  be.response.to.have.status(200);
});

be.test("Token is present in response", () => {
  const body = be.response.json();
  be.expect(body).to.have.property("token");
  be.expect(body.token).to.be.a("string");
});

be.test("User data is returned", () => {
  const body = be.response.json();
  be.expect(body.user).to.have.property("id");
  be.expect(body.user.email).to.equal("alice@beacon.dev");
});

// 🔑 Chain: Save token to environment for next requests
const body = be.response.json();
if (body.token) {
  be.environment.set("auth_token", body.token);
  console.log("[Login] Token saved to environment:", body.token.substring(0, 30) + "...");
}
`,
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. List Users — API Key + Params + Assertions
  // ─────────────────────────────────────────────────────────────────────────────
  {
    id: "demo_req_list_users",
    name: "👥 List Users — API Key + Pagination",
    method: "GET",
    baseUrl: "{{base_url}}",
    endpoint: "api/demo/users",
    contentType: "application/json",
    params: [
      { key: "page", value: "1", enabled: true, description: "Page number" },
      { key: "limit", value: "5", enabled: true, description: "Items per page" },
      { key: "role", value: "user", enabled: false, description: "Filter by role" },
      { key: "search", value: "", enabled: false, description: "Search by name or email" },
      { key: "sort_by", value: "createdAt", enabled: true, description: "Sort field" },
      { key: "order", value: "desc", enabled: true, description: "asc or desc" },
    ],
    headers: [],
    auth: {
      type: "apikey",
      bearerToken: "",
      basicUser: "",
      basicPass: "",
      apiKeyName: "x-api-key",
      apiKeyValue: "{{api_key}}",
      apiKeyLocation: "header",
    },
    body: { type: "none", rawText: "", formdata: [], urlencoded: [] },
    assertions: [
      {
        id: "demo_assert_users_1",
        target: "status_code",
        property: "",
        operator: "equals",
        value: "200",
      },
      {
        id: "demo_assert_users_2",
        target: "json_path",
        property: "pagination.total",
        operator: "greater_than",
        value: "0",
      },
      {
        id: "demo_assert_users_3",
        target: "json_path",
        property: "success",
        operator: "equals",
        value: "true",
      },
    ],
    seedMode: "repeat",
    repeatCount: 1,
    delay: 0,
    jsonItems: "[]",
    preRequestScript: `// Pre-request: verify API key is configured
const key = be.environment.get("api_key");
if (!key) {
  console.warn("[List Users] WARNING: api_key is not set in environment!");
} else {
  console.log("[List Users] API key is set:", key.substring(0, 10) + "...");
}
`,
    postResponseScript: `// Post-response: validate paginated response structure
be.test("Users list returned successfully", () => {
  be.response.to.have.status(200);
});

be.test("Pagination object exists", () => {
  const body = be.response.json();
  be.expect(body).to.have.property("pagination");
  be.expect(body.pagination).to.have.property("total");
  be.expect(body.pagination).to.have.property("page");
});

be.test("Data is an array", () => {
  const body = be.response.json();
  be.expect(Array.isArray(body.data)).to.be.true;
});

be.test("Each user has required fields", () => {
  const body = be.response.json();
  const users = body.data;
  if (users.length > 0) {
    be.expect(users[0]).to.have.property("id");
    be.expect(users[0]).to.have.property("name");
    be.expect(users[0]).to.have.property("email");
  }
});

const body = be.response.json();
console.log(\`[List Users] Found \${body.pagination.total} total users, showing page \${body.pagination.page}\`);
`,
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. Create User — POST with JSON body + Seeding
  // ─────────────────────────────────────────────────────────────────────────────
  {
    id: "demo_req_create_user",
    name: "➕ Create User — Body Seeding (10 Users)",
    method: "POST",
    baseUrl: "{{base_url}}",
    endpoint: "api/demo/users",
    contentType: "application/json",
    params: [],
    headers: [
      { key: "x-api-key", value: "{{api_key}}", enabled: true },
    ],
    auth: {
      type: "none",
      bearerToken: "",
      basicUser: "",
      basicPass: "",
      apiKeyName: "x-api-key",
      apiKeyValue: "",
      apiKeyLocation: "header",
    },
    body: {
      type: "json",
      rawText: JSON.stringify({
        name: "{{name}}",
        email: "{{email}}",
        role: "{{role}}",
      }, null, 2),
      formdata: [],
      urlencoded: [],
    },
    assertions: [
      {
        id: "demo_assert_create_user_1",
        target: "status_code",
        property: "",
        operator: "equals",
        value: "201",
      },
      {
        id: "demo_assert_create_user_2",
        target: "json_path",
        property: "success",
        operator: "equals",
        value: "true",
      },
    ],
    seedMode: "items",
    repeatCount: 1,
    delay: 150,
    jsonItems: JSON.stringify([
      { name: "Emma Nexus", email: "emma.nexus@beacon.dev", role: "editor" },
      { name: "Liam Bridge", email: "liam.bridge@beacon.dev", role: "viewer" },
      { name: "Sophia Wave", email: "sophia.wave@beacon.dev", role: "user" },
      { name: "Noah Pulse", email: "noah.pulse@beacon.dev", role: "editor" },
      { name: "Ava Signal", email: "ava.signal@beacon.dev", role: "user" },
      { name: "Oliver Core", email: "oliver.core@beacon.dev", role: "viewer" },
      { name: "Isabella Edge", email: "isabella.edge@beacon.dev", role: "user" },
      { name: "Elijah Flow", email: "elijah.flow@beacon.dev", role: "editor" },
      { name: "Charlotte Apex", email: "charlotte.apex@beacon.dev", role: "user" },
      { name: "James Hub", email: "james.hub@beacon.dev", role: "viewer" },
    ], null, 2),
    preRequestScript: `// Pre-request: log the seeded item being sent
console.log("[Seed Users] Sending item via seeder...");
`,
    postResponseScript: `// Post-response: save the last created user ID
be.test("User created with 201 status", () => {
  be.response.to.have.status(201);
});

be.test("Response has user data", () => {
  const body = be.response.json();
  be.expect(body).to.have.property("data");
  be.expect(body.data).to.have.property("id");
});

const body = be.response.json();
if (body.data && body.data.id) {
  be.environment.set("user_id", body.data.id);
  console.log("[Seed Users] Created user:", body.data.name, "ID:", body.data.id);
}
`,
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // 5. List Posts — Query Params + Assertions
  // ─────────────────────────────────────────────────────────────────────────────
  {
    id: "demo_req_list_posts",
    name: "📝 List Posts — Query Params & Filters",
    method: "GET",
    baseUrl: "{{base_url}}",
    endpoint: "api/demo/posts",
    contentType: "application/json",
    params: [
      { key: "page", value: "1", enabled: true, description: "Page number" },
      { key: "limit", value: "5", enabled: true, description: "Items per page" },
      { key: "q", value: "", enabled: false, description: "Full-text search query" },
      { key: "category", value: "Technology", enabled: false, description: "Filter by category" },
      { key: "published", value: "true", enabled: true, description: "Filter published posts" },
    ],
    headers: [
      { key: "x-client", value: "BeaconAPI/1.0", enabled: true },
    ],
    auth: {
      type: "none",
      bearerToken: "",
      basicUser: "",
      basicPass: "",
      apiKeyName: "x-api-key",
      apiKeyValue: "",
      apiKeyLocation: "header",
    },
    body: { type: "none", rawText: "", formdata: [], urlencoded: [] },
    assertions: [
      {
        id: "demo_assert_posts_1",
        target: "status_code",
        property: "",
        operator: "equals",
        value: "200",
      },
      {
        id: "demo_assert_posts_2",
        target: "json_path",
        property: "data",
        operator: "exists",
        value: "",
      },
      {
        id: "demo_assert_posts_3",
        target: "response_time",
        property: "",
        operator: "less_than",
        value: "2000",
      },
    ],
    seedMode: "repeat",
    repeatCount: 1,
    delay: 0,
    jsonItems: "[]",
    preRequestScript: "",
    postResponseScript: `// Post-response: validate posts response structure
be.test("Posts list returned successfully", () => {
  be.response.to.have.status(200);
});

be.test("Posts data array exists", () => {
  const body = be.response.json();
  be.expect(body.success).to.be.true;
  be.expect(Array.isArray(body.data)).to.be.true;
});

be.test("Pagination metadata is present", () => {
  const body = be.response.json();
  const pagination = body.pagination;
  be.expect(pagination).to.have.property("total");
  be.expect(pagination).to.have.property("totalPages");
});

be.test("Categories list is returned", () => {
  const body = be.response.json();
  be.expect(Array.isArray(body.categories)).to.be.true;
});

const body = be.response.json();
console.log(\`[Posts] \${body.data.length} posts on page \${body.pagination.page} of \${body.pagination.totalPages}\`);
`,
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // 6. Create Post — Bearer Auth + JSON body
  // ─────────────────────────────────────────────────────────────────────────────
  {
    id: "demo_req_create_post",
    name: "✍️ Create Post — Bearer Auth Required",
    method: "POST",
    baseUrl: "{{base_url}}",
    endpoint: "api/demo/posts",
    contentType: "application/json",
    params: [],
    headers: [],
    auth: {
      type: "bearer",
      bearerToken: "{{auth_token}}",
      basicUser: "",
      basicPass: "",
      apiKeyName: "x-api-key",
      apiKeyValue: "",
      apiKeyLocation: "header",
    },
    body: {
      type: "json",
      rawText: JSON.stringify({
        title: "Getting Started with Beacon API",
        content: "Beacon API makes testing your APIs a delightful experience. With pre-request scripts, post-response assertions, and seeding...",
        category: "Technology",
        tags: ["api", "testing", "beacon"],
      }, null, 2),
      formdata: [],
      urlencoded: [],
    },
    assertions: [
      {
        id: "demo_assert_create_post_1",
        target: "status_code",
        property: "",
        operator: "equals",
        value: "201",
      },
      {
        id: "demo_assert_create_post_2",
        target: "json_path",
        property: "data.id",
        operator: "exists",
        value: "",
      },
      {
        id: "demo_assert_create_post_3",
        target: "json_path",
        property: "data.slug",
        operator: "exists",
        value: "",
      },
    ],
    seedMode: "repeat",
    repeatCount: 1,
    delay: 0,
    jsonItems: "[]",
    preRequestScript: `// Pre-request: check if we have a token
const token = be.environment.get("auth_token");
if (!token) {
  console.warn("[Create Post] No auth_token found! Run the Login request first to get a token.");
} else {
  console.log("[Create Post] Token found, proceeding with request.");
}
`,
    postResponseScript: `// Post-response: save post ID and validate
be.test("Post created with 201 status", () => {
  be.response.to.have.status(201);
});

be.test("Created post has id and slug", () => {
  const body = be.response.json();
  be.expect(body.data).to.have.property("id");
  be.expect(body.data).to.have.property("slug");
  be.expect(body.data.slug).to.be.a("string");
});

be.test("Post data matches request body", () => {
  const body = be.response.json();
  be.expect(body.data.title).to.equal("Getting Started with Beacon API");
  be.expect(body.data.category).to.equal("Technology");
});

const body = be.response.json();
if (body.data && body.data.id) {
  be.environment.set("post_id", body.data.id);
  console.log("[Create Post] Post created! ID:", body.data.id, "Slug:", body.data.slug);
}
`,
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // 7. Stress Test — Repeat Seeding Demo
  // ─────────────────────────────────────────────────────────────────────────────
  {
    id: "demo_req_stress",
    name: "⚡ Echo Stress Test — Repeat 20x",
    method: "GET",
    baseUrl: "{{base_url}}",
    endpoint: "api/demo/echo",
    contentType: "application/json",
    params: [
      { key: "run", value: "stress-test", enabled: true },
      { key: "version", value: "{{api_key}}", enabled: false },
    ],
    headers: [
      { key: "x-client", value: "BeaconAPI-StressTest/1.0", enabled: true },
    ],
    auth: {
      type: "none",
      bearerToken: "",
      basicUser: "",
      basicPass: "",
      apiKeyName: "x-api-key",
      apiKeyValue: "",
      apiKeyLocation: "header",
    },
    body: { type: "none", rawText: "", formdata: [], urlencoded: [] },
    assertions: [
      {
        id: "demo_assert_stress_1",
        target: "status_code",
        property: "",
        operator: "equals",
        value: "200",
      },
      {
        id: "demo_assert_stress_2",
        target: "response_time",
        property: "",
        operator: "less_than",
        value: "5000",
      },
    ],
    seedMode: "repeat",
    repeatCount: 20,
    delay: 50,
    jsonItems: "[]",
    preRequestScript: "",
    postResponseScript: `be.test("Echo responds OK", () => {
  be.response.to.have.status(200);
});
`,
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // 8. Form Data — multipart body demo
  // ─────────────────────────────────────────────────────────────────────────────
  {
    id: "demo_req_formdata",
    name: "📋 Form Data — Multipart Body",
    method: "POST",
    baseUrl: "{{base_url}}",
    endpoint: "api/demo/echo",
    contentType: "multipart/form-data",
    params: [],
    headers: [
      { key: "x-client", value: "BeaconAPI/1.0", enabled: true },
    ],
    auth: {
      type: "none",
      bearerToken: "",
      basicUser: "",
      basicPass: "",
      apiKeyName: "x-api-key",
      apiKeyValue: "",
      apiKeyLocation: "header",
    },
    body: {
      type: "formdata",
      rawText: "",
      formdata: [
        { key: "username", value: "alice_beacon", enabled: true, description: "Username field" },
        { key: "project", value: "BeaconAPI Demo", enabled: true, description: "Project name" },
        { key: "environment", value: "{{base_url}}", enabled: true, description: "From env variable" },
        { key: "timestamp", value: new Date().toISOString(), enabled: true, description: "Current time" },
        { key: "inactive_field", value: "this won't be sent", enabled: false, description: "Disabled" },
      ],
      urlencoded: [],
    },
    assertions: [
      {
        id: "demo_assert_form_1",
        target: "status_code",
        property: "",
        operator: "equals",
        value: "200",
      },
    ],
    seedMode: "repeat",
    repeatCount: 1,
    delay: 0,
    jsonItems: "[]",
    preRequestScript: `console.log("[Form Data] Sending multipart form data to echo endpoint...");`,
    postResponseScript: `be.test("Form data sent successfully", () => {
  be.response.to.have.status(200);
});
console.log("[Form Data] Echo confirmed form submission");
`,
  },
];
