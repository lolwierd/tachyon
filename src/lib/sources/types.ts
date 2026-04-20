export interface SearchResult {
  seriesId?: string;
  sourceId: string;
  title: string;
  slug: string;
  coverUrl: string;
  year: number | null;
  status: string;
  type: string;
  authors: string[];
  tags: string[];
  source?: string;
}

export interface SeriesDetail {
  seriesId?: string;
  sourceId: string;
  source?: string;
  title: string;
  slug: string;
  coverUrl: string;
  description: string;
  authors: string[];
  tags: string[];
  type: string;
  status: string;
  year: number | null;
  isAdult: boolean;
  isOfficial: boolean;
  anilistUrl: string | null;
  relatedSeries: { sourceId: string; title: string; relationship: string }[];
}

export interface Chapter {
  sourceChapterId: string;
  chapterNo: number;
  title: string;
  // Unix ms when the chapter was published on the source site.
  // null when the source exposes no date at all; undefined when we just didn't parse one.
  publishedAt?: number | null;
}

export interface ChapterPage {
  index: number;
  imageUrl: string;
}

export interface SearchOptions {
  sort?:
    | "Best Match"
    | "Alphabet"
    | "Popularity"
    | "Subscribers"
    | "Recently Added"
    | "Latest Updates";
  order?: "Ascending" | "Descending";
  official?: boolean;
  adult?: boolean;
  status?: ("Ongoing" | "Complete" | "Hiatus" | "Canceled")[];
  type?: ("Manga" | "Manhwa" | "Manhua" | "OEL")[];
  tags?: string[];
  author?: string;
}
