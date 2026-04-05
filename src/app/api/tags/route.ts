import { NextResponse } from "next/server";
import { z } from "zod";
import { createTag, listTags } from "@/lib/library/tags";
import {
  assertTrustedWriteRequest,
  handleApiError,
  parseJsonBody,
} from "@/lib/server/api";

export const runtime = "nodejs";

const tagTypeSchema = z.enum(["mood", "genre", "theme", "custom"]);
const createTagSchema = z.object({
  name: z.string().trim().min(1),
  type: tagTypeSchema,
  color: z.string().trim().min(1).optional(),
});

export async function GET() {
  try {
    return NextResponse.json(listTags());
  } catch (error) {
    return handleApiError("api.tags.list.failed", error);
  }
}

export async function POST(request: Request) {
  try {
    assertTrustedWriteRequest(request);
    const body = await parseJsonBody(request, createTagSchema);

    return NextResponse.json(
      createTag({
        name: body.name,
        type: body.type,
        color: body.color,
      }),
    );
  } catch (error) {
    return handleApiError("api.tags.create.failed", error);
  }
}
