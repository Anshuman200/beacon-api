import { NextRequest, NextResponse } from "next/server";

// Deterministic fake user generator — no faker dependency needed
const FIRST_NAMES = ["Alice", "Bob", "Carol", "Dave", "Eve", "Frank", "Grace", "Hank", "Iris", "Jack",
  "Kim", "Liam", "Mia", "Noah", "Olivia", "Paul", "Quinn", "Rose", "Sam", "Tina",
  "Uma", "Victor", "Wendy", "Xander", "Yara"];
const LAST_NAMES = ["Beacon", "Signal", "Pulse", "Wave", "Stream", "Flow", "Bridge", "Nexus",
  "Apex", "Core", "Edge", "Node", "Link", "Gate", "Hub", "Flare", "Spark",
  "Crest", "Dawn", "Ridge"];
const COUNTRIES = ["United States", "United Kingdom", "Germany", "Canada", "Australia",
  "India", "France", "Japan", "Brazil", "Netherlands"];
const ROLES = ["user", "editor", "viewer", "admin"];

function seededItem<T>(arr: T[], seed: number): T {
  return arr[Math.abs(seed) % arr.length];
}

const FAKE_USERS = Array.from({ length: 25 }, (_, i) => {
  const n = i + 1;
  const firstName = seededItem(FIRST_NAMES, n * 7);
  const lastName = seededItem(LAST_NAMES, n * 13);
  const name = `${firstName} ${lastName}`;
  const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}@beacon.dev`;
  const year = 2023 + (n % 2);
  const month = String((n % 12) + 1).padStart(2, "0");
  const day = String((n % 28) + 1).padStart(2, "0");

  return {
    id: `usr_${String(n).padStart(3, "0")}`,
    name,
    email,
    role: i === 0 ? "admin" : seededItem(ROLES, n * 3),
    avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${firstName}${n}`,
    country: seededItem(COUNTRIES, n * 11),
    phone: `+1-555-${String(1000 + n * 37).slice(0, 4)}-${String(n * 99).padStart(4, "0").slice(0, 4)}`,
    bio: `${name} is a ${seededItem(ROLES, n * 5)} at Beacon. Loves APIs.`,
    verified: n % 3 !== 0,
    createdAt: `${year}-${month}-${day}T${String(n % 24).padStart(2, "0")}:00:00Z`,
  };
});

// GET /api/demo/users — List users (paginated, filterable, sortable)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const limit = Math.min(20, Math.max(1, parseInt(searchParams.get("limit") || "5", 10)));
  const search = (searchParams.get("search") || "").toLowerCase();
  const role = searchParams.get("role") || "";
  const sortBy = searchParams.get("sort_by") || "createdAt";
  const order = searchParams.get("order") === "asc" ? "asc" : "desc";
  const apiKey = req.headers.get("x-api-key") || "";

  if (!apiKey) {
    return NextResponse.json(
      { success: false, error: "x-api-key header is required. Use: beacon-demo-key-2026" },
      { status: 401 }
    );
  }

  if (apiKey !== "beacon-demo-key-2026") {
    return NextResponse.json(
      { success: false, error: "Invalid API key. Expected: beacon-demo-key-2026" },
      { status: 403 }
    );
  }

  let filtered = [...FAKE_USERS];
  if (search) {
    filtered = filtered.filter(
      (u) => u.name.toLowerCase().includes(search) || u.email.includes(search)
    );
  }
  if (role) {
    filtered = filtered.filter((u) => u.role === role);
  }

  // Sort
  filtered.sort((a, b) => {
    const valA = String((a as Record<string, unknown>)[sortBy] ?? "");
    const valB = String((b as Record<string, unknown>)[sortBy] ?? "");
    return order === "asc" ? valA.localeCompare(valB) : valB.localeCompare(valA);
  });

  const total = filtered.length;
  const totalPages = Math.ceil(total / limit);
  const items = filtered.slice((page - 1) * limit, page * limit);

  return NextResponse.json({
    success: true,
    data: items,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    },
    filters: { search, role, sortBy, order },
  });
}

// POST /api/demo/users — Create user
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { name, email, role = "user" } = body as Record<string, string>;

  const errors: Record<string, string> = {};
  if (!name) errors.name = "Name is required";
  if (!email) errors.email = "Email is required";
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = "Invalid email format";
  }

  if (Object.keys(errors).length > 0) {
    return NextResponse.json(
      { success: false, error: "Validation failed", details: errors },
      { status: 422 }
    );
  }

  const newUser = {
    id: "usr_" + Date.now(),
    name,
    email: email.toLowerCase(),
    role,
    avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(name)}`,
    verified: false,
    createdAt: new Date().toISOString(),
  };

  return NextResponse.json(
    {
      success: true,
      data: newUser,
      message: `User '${name}' created successfully`,
    },
    { status: 201 }
  );
}
