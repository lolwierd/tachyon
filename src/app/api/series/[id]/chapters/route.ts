import { NextResponse } from "next/server";
import { getChapterList } from "@/lib/sources/weebcentral";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const chapters = await getChapterList(id);
    return NextResponse.json(chapters);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
