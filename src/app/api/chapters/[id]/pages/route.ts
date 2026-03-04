import { NextResponse } from "next/server";
import { getChapterPages } from "@/lib/sources/weebcentral";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const pages = await getChapterPages(id);

    const proxiedPages = pages.map((page) => ({
      ...page,
      imageUrl: `/api/media/page?url=${encodeURIComponent(page.imageUrl)}`,
    }));

    return NextResponse.json(proxiedPages);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
