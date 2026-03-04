import { and, asc, count, eq, inArray, max } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { collection, collectionSeries, sourceMapping } from "@/lib/db/schema";
import type { SeriesDetail } from "@/lib/sources/types";
import { ensureSeriesRecord, SOURCE } from "./shared";

export interface LibraryCollectionRecord {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  sortOrder: number;
  createdAt: string | null;
  seriesCount: number;
}

export interface UpsertCollectionInput {
  name: string;
  description?: string;
  icon?: string;
}

function toIsoString(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function normalizeText(value: string | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function mapCollectionRow(row: {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  sortOrder: number | null;
  createdAt: Date | null;
  seriesCount: number;
}): LibraryCollectionRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    icon: row.icon,
    sortOrder: row.sortOrder ?? 0,
    createdAt: toIsoString(row.createdAt),
    seriesCount: row.seriesCount,
  };
}

export function listCollections() {
  return getDb()
    .select({
      id: collection.id,
      name: collection.name,
      description: collection.description,
      icon: collection.icon,
      sortOrder: collection.sortOrder,
      createdAt: collection.createdAt,
      seriesCount: count(collectionSeries.seriesId),
    })
    .from(collection)
    .leftJoin(collectionSeries, eq(collection.id, collectionSeries.collectionId))
    .groupBy(collection.id)
    .orderBy(asc(collection.sortOrder), asc(collection.createdAt), asc(collection.name))
    .all()
    .map(mapCollectionRow);
}

export function getCollection(collectionId: string) {
  return listCollections().find((item) => item.id === collectionId) ?? null;
}

export function createCollection(input: UpsertCollectionInput) {
  const now = new Date();
  const sortRow = getDb().select({ value: max(collection.sortOrder) }).from(collection).get();
  const id = crypto.randomUUID();

  getDb()
    .insert(collection)
    .values({
      id,
      name: input.name.trim(),
      description: normalizeText(input.description),
      icon: normalizeText(input.icon),
      sortOrder: (sortRow?.value ?? -1) + 1,
      createdAt: now,
    })
    .run();

  return getCollection(id);
}

export function updateCollection(collectionId: string, input: UpsertCollectionInput) {
  getDb()
    .update(collection)
    .set({
      name: input.name.trim(),
      description: normalizeText(input.description),
      icon: normalizeText(input.icon),
    })
    .where(eq(collection.id, collectionId))
    .run();

  return getCollection(collectionId);
}

export function deleteCollection(collectionId: string) {
  getDb().delete(collectionSeries).where(eq(collectionSeries.collectionId, collectionId)).run();
  getDb().delete(collection).where(eq(collection.id, collectionId)).run();
}

export function listCollectionIdsForSeries(sourceSeriesId: string) {
  return getDb()
    .select({
      collectionId: collectionSeries.collectionId,
    })
    .from(sourceMapping)
    .innerJoin(collectionSeries, eq(sourceMapping.seriesId, collectionSeries.seriesId))
    .where(and(eq(sourceMapping.source, SOURCE), eq(sourceMapping.sourceSeriesId, sourceSeriesId)))
    .all()
    .map((row) => row.collectionId);
}

export async function replaceSeriesCollections(
  sourceSeriesId: string,
  collectionIds: string[],
  seriesDetail?: SeriesDetail,
) {
  const seriesId = await ensureSeriesRecord(sourceSeriesId, seriesDetail);
  const uniqueCollectionIds = [...new Set(collectionIds)];

  getDb().delete(collectionSeries).where(eq(collectionSeries.seriesId, seriesId)).run();

  if (uniqueCollectionIds.length > 0) {
    const validCollectionIds = getDb()
      .select({ id: collection.id })
      .from(collection)
      .where(inArray(collection.id, uniqueCollectionIds))
      .all()
      .map((row) => row.id);

    validCollectionIds.forEach((collectionId, index) => {
      getDb()
        .insert(collectionSeries)
        .values({
          collectionId,
          seriesId,
          sortOrder: index,
        })
        .run();
    });
  }

  return listCollectionIdsForSeries(sourceSeriesId);
}
