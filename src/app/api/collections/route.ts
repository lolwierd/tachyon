import { NextResponse } from "next/server";
import { createCollection, listCollections } from "@/lib/library/collections";
import { logError } from "@/lib/server/log";

export const runtime = "nodejs";

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function GET() {
  try {
    return NextResponse.json(listCollections());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logError("api.collections.list.failed", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const name = typeof body.name === "string" ? body.name.trim() : "";

    if (!name) {
      return badRequest("name is required");
    }

    return NextResponse.json(
      createCollection({
        name,
        description: typeof body.description === "string" ? body.description : undefined,
        icon: typeof body.icon === "string" ? body.icon : undefined,
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logError("api.collections.create.failed", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
