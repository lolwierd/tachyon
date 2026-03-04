import { NextResponse } from "next/server";
import { deleteCollection, getCollection, updateCollection } from "@/lib/library/collections";
import { logError } from "@/lib/server/log";

export const runtime = "nodejs";

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

    if (!name) {
      return badRequest("name is required");
    }

    const record = updateCollection(id, {
      name,
      description: typeof body.description === "string" ? body.description : undefined,
      icon: typeof body.icon === "string" ? body.icon : undefined,
    });

    if (!record) {
      return NextResponse.json({ error: "Collection not found" }, { status: 404 });
    }

    return NextResponse.json(record);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const { id } = await context.params;
    logError("api.collections.update.failed", error, { collectionId: id });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const existing = getCollection(id);

    if (!existing) {
      return NextResponse.json({ error: "Collection not found" }, { status: 404 });
    }

    deleteCollection(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const { id } = await context.params;
    logError("api.collections.delete.failed", error, { collectionId: id });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
