import type { Metadata } from "next";
import AboutView from "@/components/features/figma/AboutView";

export const metadata: Metadata = {
  title: "About | HotelAI",
  description: "Discover the HotelAI approach to thoughtful stays, room discovery and travel planning.",
};

export default function AboutPage() {
  return <AboutView />;
}
