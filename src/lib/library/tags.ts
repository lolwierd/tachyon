import { asc, count, eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { seriesTag, tag } from "@/lib/db/schema";
import type { SeriesDetail } from "@/lib/sources/types";
import { ensureSeriesRecord, getSeriesMapping } from "./shared";

export type LibraryTagType = "mood" | "genre" | "theme" | "custom";

export interface LibraryTagRecord {
  id: string;
  name: string;
  color: string | null;
  type: LibraryTagType;
  seriesCount: number;
}

export interface UpsertTagInput {
  name: string;
  color?: string;
  type: LibraryTagType;
}

function normalizeText(value: string | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function mapTagRow(row: {
  id: string;
  name: string;
  color: string | null;
  type: LibraryTagType;
  seriesCount: number;
}): LibraryTagRecord {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    type: row.type,
    seriesCount: row.seriesCount,
  };
}

export function listTags() {
  return getDb()
    .select({
      id: tag.id,
      name: tag.name,
      color: tag.color,
      type: tag.type,
      seriesCount: count(seriesTag.seriesId),
    })
    .from(tag)
    .leftJoin(seriesTag, eq(tag.id, seriesTag.tagId))
    .groupBy(tag.id)
    .orderBy(asc(tag.type), asc(tag.name))
    .all()
    .map(mapTagRow);
}

export function getTag(tagId: string) {
  return listTags().find((item) => item.id === tagId) ?? null;
}

export function createTag(input: UpsertTagInput) {
  const id = crypto.randomUUID();

  getDb()
    .insert(tag)
    .values({
      id,
      name: input.name.trim(),
      color: normalizeText(input.color),
      type: input.type,
    })
    .run();

  return getTag(id);
}

export function updateTag(tagId: string, input: UpsertTagInput) {
  getDb()
    .update(tag)
    .set({
      name: input.name.trim(),
      color: normalizeText(input.color),
      type: input.type,
    })
    .where(eq(tag.id, tagId))
    .run();

  return getTag(tagId);
}

export function deleteTag(tagId: string) {
  getDb().delete(seriesTag).where(eq(seriesTag.tagId, tagId)).run();
  getDb().delete(tag).where(eq(tag.id, tagId)).run();
}

export function listTagIdsForSeries(sourceSeriesId: string, sourceName?: string) {
  const mapping = getSeriesMapping(sourceSeriesId, sourceName);
  if (!mapping) {
    return [];
  }

  return getDb()
    .select({ tagId: seriesTag.tagId })
    .from(seriesTag)
    .where(eq(seriesTag.seriesId, mapping.seriesId))
    .all()
    .map((row) => row.tagId);
}

export async function replaceSeriesTags(
  sourceSeriesId: string,
  tagIds: string[],
  seriesDetail?: SeriesDetail,
  sourceName?: string,
) {
  const resolvedSource = sourceName ?? seriesDetail?.source ?? getSeriesMapping(sourceSeriesId)?.source;
  const seriesId = await ensureSeriesRecord(sourceSeriesId, seriesDetail, resolvedSource);
  const uniqueTagIds = [...new Set(tagIds)];

  getDb().transaction((tx) => {
    tx.delete(seriesTag).where(eq(seriesTag.seriesId, seriesId)).run();

    if (uniqueTagIds.length > 0) {
      const validTagIds = tx
        .select({ id: tag.id })
        .from(tag)
        .where(inArray(tag.id, uniqueTagIds))
        .all()
        .map((row) => row.id);

      if (validTagIds.length > 0) {
        tx.insert(seriesTag)
          .values(validTagIds.map((tagId) => ({ seriesId, tagId })))
          .run();
      }
    }
  });

  return listTagIdsForSeries(sourceSeriesId, resolvedSource);
}
