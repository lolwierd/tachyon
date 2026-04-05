import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteTag, getTag, updateTag } from "@/lib/library/tags";
import {
  assertTrustedWriteRequest,
  handleApiError,
  notFound,
  parseJsonBody,
} from "@/lib/server/api";

export const runtime = "nodejs";

const tagTypeSchema = z.enum(["mood", "genre", "theme", "custom"]);
const updateTagSchema = z.object({
  name: z.string().trim().min(1),
  type: tagTypeSchema,
  color: z.string().trim().min(1).optional(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    assertTrustedWriteRequest(request);
    const body = await parseJsonBody(request, updateTagSchema);

    const record = updateTag(id, {
      name: body.name,
      type: body.type,
      color: body.color,
    });

    if (!record) {
      throw notFound("Tag not found", { code: "tag_not_found" });
    }

    return NextResponse.json(record);
  } catch (error) {
    const { id } = await context.params;
    return handleApiError("api.tags.update.failed", error, { tagId: id });
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertTrustedWriteRequest(_request);
    const { id } = await context.params;
    const existing = getTag(id);

    if (!existing) {
      throw notFound("Tag not found", { code: "tag_not_found" });
    }

    deleteTag(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const { id } = await context.params;
    return handleApiError("api.tags.delete.failed", error, { tagId: id });
  }
}
