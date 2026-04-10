import { Suspense } from "react";
import { SearchView } from "./search-view";

export const metadata = {
  title: "Search — Tachyon",
};

export default function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; showExtra?: string; sort?: string; type?: string; status?: string }>;
}) {
  return (
    <Suspense>
      <SearchView searchParamsPromise={searchParams} />
    </Suspense>
  );
}
