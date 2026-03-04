import { NextResponse } from "next/server";
import { createTag, listTags } from "@/lib/library/tags";
import { logError } from "@/lib/server/log";

export const runtime = "nodejs";

const TAG_TYPES = new Set(["mood", "genre", "theme", "custom"] as const);

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function GET() {
  try {
    return NextResponse.json(listTags());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logError("api.tags.list.failed", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const type =
      typeof body.type === "string" && TAG_TYPES.has(body.type as never) ? body.type : null;

    if (!name || !type) {
      return badRequest("name and type are required");
    }

    return NextResponse.json(
      createTag({
        name,
        type,
        color: typeof body.color === "string" ? body.color : undefined,
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logError("api.tags.create.failed", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
