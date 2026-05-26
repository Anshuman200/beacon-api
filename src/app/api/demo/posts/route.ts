import { NextRequest, NextResponse } from "next/server";

const CATEGORIES = ["Technology", "Design", "Business", "Science", "Arts", "Health"];

function deterministicPost(id: number) {
  const seed = id * 31;
  const words = [
    "beacon", "signal", "pulse", "wave", "stream", "flow", "bridge",
    "nexus", "apex", "core", "edge", "node", "link", "gate", "hub",
  ];
  const title = `${words[seed % words.length]} ${words[(seed * 7) % words.length]} #${id}`;
  return {
    id: `post_${String(id).padStart(3, "0")}`,
    title: title.charAt(0).toUpperCase() + title.slice(1),
    slug: title.toLowerCase().replace(/ /g, "-"),
    category: CATEGORIES[seed % CATEGORIES.length],
    author: `Author ${(seed % 5) + 1}`,
    authorId: `usr_${String((seed % 5) + 1).padStart(3, "0")}`,
    content: `This is the content for post #${id}. Beacon API makes testing APIs delightful.`,
    tags: [
      words[(seed * 3) % words.length],
      words[(seed * 5) % words.length],
    ],
    views: (seed * 137) % 5000,
    likes: (seed * 43) % 500,
    published: seed % 3 !== 0,
    createdAt: new Date(Date.now() - seed * 86_400_000).toISOString(),
  };
}

const ALL_POSTS = Array.from({ length: 50 }, (_, i) => deterministicPost(i + 1));

// GET /api/demo/posts — List posts (paginated, filterable, sortable)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const limit = Math.min(20, Math.max(1, parseInt(searchParams.get("limit") || "5", 10)));
  const search = (searchParams.get("q") || "").toLowerCase();
  const category = searchParams.get("category") || "";
  const published = searchParams.get("published");
  const authorId = searchParams.get("author_id") || "";

  let filtered = [...ALL_POSTS];

  if (search) {
    filtered = filtered.filter(
      (p) =>
        p.title.toLowerCase().includes(search) ||
        p.content.toLowerCase().includes(search) ||
        p.tags.some((t) => t.includes(search))
    );
  }

  if (category) {
    filtered = filtered.filter((p) => p.category === category);
  }

  if (published !== null && published !== "") {
    const want = published === "true";
    filtered = filtered.filter((p) => p.published === want);
  }

  if (authorId) {
    filtered = filtered.filter((p) => p.authorId === authorId);
  }

  const total = filtered.length;
  const totalPages = Math.ceil(total / limit);
  const items = filtered.slice((page - 1) * limit, page * limit);

  return NextResponse.json({
    success: true,
    data: items,
    categories: CATEGORIES,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    },
  });
}

// POST /api/demo/posts — Create post (Bearer auth required)
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace("Bearer ", "").trim();

  if (!token || !token.startsWith("beacon_demo.")) {
    return NextResponse.json(
      {
        success: false,
        error: "Authorization required. Use POST /api/demo/auth to get a token.",
      },
      { status: 401 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const { title, content, category, tags } = body as Record<string, unknown>;

  const errors: Record<string, string> = {};
  if (!title) errors.title = "Title is required";
  if (!content) errors.content = "Content is required";
  if (!category) errors.category = "Category is required";
  if (category && !CATEGORIES.includes(category as string)) {
    errors.category = `Category must be one of: ${CATEGORIES.join(", ")}`;
  }

  if (Object.keys(errors).length > 0) {
    return NextResponse.json(
      { success: false, error: "Validation failed", details: errors },
      { status: 422 }
    );
  }

  const slug = (title as string).toLowerCase().replace(/\s+/g, "-").replace(/[^\w-]/g, "");

  return NextResponse.json(
    {
      success: true,
      data: {
        id: "post_" + Date.now(),
        title,
        slug,
        category,
        content,
        tags: tags || [],
        views: 0,
        likes: 0,
        published: false,
        createdAt: new Date().toISOString(),
      },
      message: "Post created successfully",
    },
    { status: 201 }
  );
}
