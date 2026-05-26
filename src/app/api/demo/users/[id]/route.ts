import { NextRequest, NextResponse } from "next/server";

// GET /api/demo/users/[id] — Get single user
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const apiKey = req.headers.get("x-api-key") || "";

  if (!apiKey || apiKey !== "beacon-demo-key-2026") {
    return NextResponse.json(
      { success: false, error: "Valid x-api-key header is required" },
      { status: 401 }
    );
  }

  if (!id || !id.startsWith("usr_")) {
    return NextResponse.json(
      { success: false, error: `User '${id}' not found` },
      { status: 404 }
    );
  }

  // Demo user data
  const user = {
    id,
    name: "Demo User",
    email: "demo@beacon.dev",
    role: "user",
    avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${id}`,
    verified: true,
    createdAt: "2024-03-01T00:00:00Z",
    lastSeen: new Date().toISOString(),
    stats: {
      requests: 142,
      collections: 8,
      environments: 3,
    },
  };

  return NextResponse.json({ success: true, data: user });
}

// PUT /api/demo/users/[id] — Update user
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace("Bearer ", "").trim();

  if (!token || !token.startsWith("beacon_demo.")) {
    return NextResponse.json(
      { success: false, error: "Bearer token required for this operation" },
      { status: 401 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const { name, email, role } = body as Record<string, string>;

  if (!name && !email && !role) {
    return NextResponse.json(
      { success: false, error: "At least one field (name, email, role) must be provided" },
      { status: 422 }
    );
  }

  return NextResponse.json({
    success: true,
    data: {
      id,
      name: name || "Demo User",
      email: email || "demo@beacon.dev",
      role: role || "user",
      updatedAt: new Date().toISOString(),
    },
    message: "User updated successfully",
  });
}

// DELETE /api/demo/users/[id] — Delete user
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace("Bearer ", "").trim();

  if (!token || !token.startsWith("beacon_demo.")) {
    return NextResponse.json(
      { success: false, error: "Bearer token required" },
      { status: 401 }
    );
  }

  return NextResponse.json({
    success: true,
    message: `User '${id}' deleted successfully`,
    deletedAt: new Date().toISOString(),
  });
}
