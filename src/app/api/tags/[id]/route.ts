import { NextResponse } from "next/server";
import { deleteTag, getTag, updateTag } from "@/lib/library/tags";
import { logError } from "@/lib/server/log";

export const runtime = "nodejs";

const TAG_TYPES = new Set(["mood", "genre", "theme", "custom"] as const);

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const type =
      typeof body.type === "string" && TAG_TYPES.has(body.type as never) ? body.type : null;

    if (!name || !type) {
      return badRequest("name and type are required");
    }

    const record = updateTag(id, {
      name,
      type,
      color: typeof body.color === "string" ? body.color : undefined,
    });

    if (!record) {
      return NextResponse.json({ error: "Tag not found" }, { status: 404 });
    }

    return NextResponse.json(record);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const { id } = await context.params;
    logError("api.tags.update.failed", error, { tagId: id });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const existing = getTag(id);

    if (!existing) {
      return NextResponse.json({ error: "Tag not found" }, { status: 404 });
    }

    deleteTag(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const { id } = await context.params;
    logError("api.tags.delete.failed", error, { tagId: id });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
