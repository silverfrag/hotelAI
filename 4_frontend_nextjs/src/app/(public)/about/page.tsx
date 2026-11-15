import type { Metadata } from "next";
import AboutView from "@/components/features/figma/AboutView";

export const metadata: Metadata = {
  title: "Giới thiệu White Sand Boutique Hotel Đà Nẵng | HotelAI",
  description: "Khám phá White Sand Boutique Hotel tại 89-91 Võ Văn Kiệt, Sơn Trà, TP. Đà Nẵng: 15 tầng tiện ích, 54 phòng thuộc 6 hạng phòng và hệ thống định giá HotelAI.",
};

export default function AboutPage() {
  return <AboutView />;
}
