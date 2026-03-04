import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

type SeriesCardProps = {
  sourceId: string;
  title: string;
  coverUrl?: string;
  type?: string;
  status?: string;
  year?: number;
  authors?: string[];
  tags?: string[];
  className?: string;
};

export function SeriesCard({
  sourceId,
  title,
  coverUrl,
  type,
  status,
  year,
  authors,
  tags,
  className,
}: SeriesCardProps) {
  return (
    <Link
      href={`/series/${sourceId}`}
      className={cn(
        "group block rounded-xl border border-border bg-surface p-2 transition-all duration-300",
        "hover:border-accent-muted hover:bg-surface-raised",
        className,
      )}
    >
      <div className="relative aspect-[2/3] w-full overflow-hidden rounded-lg bg-surface-raised">
        {coverUrl ? (
          <Image
            src={`/api/media/cover/${sourceId}`}
            alt={title}
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 200px"
            className="object-cover transition-transform duration-300 group-hover:scale-[1.02]"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-text-faint">
            <span className="text-xs">No cover</span>
          </div>
        )}
      </div>

      <div className="mt-2 space-y-1.5 px-0.5">
        <h3 className="line-clamp-2 text-sm font-medium leading-snug text-text">
          {title}
        </h3>

        {(type || status) && (
          <div className="flex flex-wrap gap-1">
            {type && <Badge variant="accent">{type}</Badge>}
            {status && <Badge variant="status">{status}</Badge>}
          </div>
        )}

        {authors && authors.length > 0 && (
          <p className="truncate text-xs text-text-faint">
            {authors.join(", ")}
          </p>
        )}
      </div>
    </Link>
  );
}
