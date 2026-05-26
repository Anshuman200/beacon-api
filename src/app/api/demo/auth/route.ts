import { NextRequest, NextResponse } from "next/server";

const DEMO_USERS = [
  {
    id: "usr_001",
    name: "Alice Beacon",
    email: "alice@beacon.dev",
    role: "admin",
    password: "beacon123",
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=alice",
    createdAt: "2024-01-15T08:00:00Z",
  },
  {
    id: "usr_002",
    name: "Bob Signal",
    email: "bob@beacon.dev",
    role: "user",
    password: "signal456",
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=bob",
    createdAt: "2024-02-20T10:30:00Z",
  },
];

function generateToken(userId: string): string {
  // Simple base64 pseudo-token for demo purposes
  const payload = { sub: userId, iat: Date.now(), exp: Date.now() + 3600_000 };
  return "beacon_demo." + Buffer.from(JSON.stringify(payload)).toString("base64");
}

function verifyToken(token: string): { sub: string } | null {
  try {
    if (!token.startsWith("beacon_demo.")) return null;
    const raw = token.replace("beacon_demo.", "");
    const payload = JSON.parse(Buffer.from(raw, "base64").toString("utf-8"));
    if (payload.exp < Date.now()) return null;
    return { sub: payload.sub };
  } catch {
    return null;
  }
}

// POST /api/demo/auth — Login
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { email, password } = body as { email?: string; password?: string };

  if (!email || !password) {
    return NextResponse.json(
      { success: false, error: "email and password are required" },
      { status: 400 }
    );
  }

  const user = DEMO_USERS.find((u) => u.email === email && u.password === password);
  if (!user) {
    return NextResponse.json(
      { success: false, error: "Invalid credentials" },
      { status: 401 }
    );
  }

  const token = generateToken(user.id);
  const { password: _pw, ...safeUser } = user;
  void _pw;

  return NextResponse.json({
    success: true,
    token,
    user: safeUser,
    message: `Welcome back, ${user.name}! 🎉`,
    expiresIn: 3600,
  });
}

// GET /api/demo/auth — Get current user (requires Bearer token)
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace("Bearer ", "").trim();

  if (!token) {
    return NextResponse.json(
      { success: false, error: "Authorization header missing" },
      { status: 401 }
    );
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    return NextResponse.json(
      { success: false, error: "Invalid or expired token" },
      { status: 401 }
    );
  }

  const user = DEMO_USERS.find((u) => u.id === decoded.sub);
  if (!user) {
    return NextResponse.json(
      { success: false, error: "User not found" },
      { status: 404 }
    );
  }

  const { password: _pw, ...safeUser } = user;
  void _pw;

  return NextResponse.json({
    success: true,
    user: safeUser,
  });
}
