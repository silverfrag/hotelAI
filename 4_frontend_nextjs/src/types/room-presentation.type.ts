/** Public presentation contract; transactional fields always come from core API. */
export interface RoomPresentation {
  id: number;
  name: string;
  type: string;
  img: string;
  gallery: string[];
  price: number;
  originalPrice: number;
  discount: number;
  address: string;
  floor: string;
  tags: string[];
  features: string[];
  featureIcons: { icon: string; label: string }[];
  extraServices: { id: string; label: string; price: number; unit: string; defaultOn: boolean }[];
  sqm: number | null;
  guests: number;
  category: string;
  description: string;
  features_detail: string[];
  reviews: { name: string; country: string; rating: number; date: string; text: string }[];
  rating: number | null;
  availableNow: number;
  totalRooms: number;
  currency: 'VND';
}
