import type { Metadata } from "next";
import DestinationsView from "@/components/features/figma/DestinationsView";

export const metadata: Metadata = {
  title: "Destination Inspiration | HotelAI",
  description: "Explore destination stories and travel inspiration from around the world, then plan a stay from our hotel's room collection.",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function DestinationsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const single = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] ?? "" : value ?? "";
  const query = single(params.q) || single(params.search);
  const region = single(params.region);
  const sort = single(params.sort);
  const view = single(params.view);

  return <DestinationsView key={`${query}|${region}|${sort}|${view}`} initialQuery={query} initialRegion={region} initialSort={sort} initialView={view} />;
}
