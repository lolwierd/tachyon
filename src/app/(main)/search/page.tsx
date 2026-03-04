import { Suspense } from "react";
import { SearchView } from "./search-view";

export const metadata = {
  title: "Search — Tachyon",
};

export default function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  return (
    <Suspense>
      <SearchView searchParamsPromise={searchParams} />
    </Suspense>
  );
}
