import type { RoomType } from '@/types/room.type';
import type { RoomPresentation } from '@/types/room-presentation.type';

interface RoomMeta {
  img: string;
  gallery: string[];
  sqm: number;
  category: string;
  rating: number;
  floor: string;
  features: string[];
  featuresDetail: string[];
  description: string;
}

const DEFAULT_GALLERY = [
  'https://images.unsplash.com/photo-1731336478850-6bce7235e320?w=800&h=600&fit=crop&auto=format',
  'https://images.unsplash.com/photo-1584622650111-993a426fbf0a?w=800&h=600&fit=crop&auto=format',
  'https://images.unsplash.com/photo-1602002418679-43121356bf41?w=800&h=600&fit=crop&auto=format',
  'https://images.unsplash.com/photo-1611971263023-105938ce12ed?w=800&h=600&fit=crop&auto=format',
];

const ROOM_METADATA: Record<string, RoomMeta> = {
  'deluxe king': {
    img: 'https://images.unsplash.com/photo-1591088398332-8a7791972843?w=900&h=600&fit=crop&auto=format',
    gallery: [
      'https://images.unsplash.com/photo-1591088398332-8a7791972843?w=900&h=600&fit=crop&auto=format',
      'https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=900&h=600&fit=crop&auto=format',
      'https://images.unsplash.com/photo-1584622650111-993a426fbf0a?w=900&h=600&fit=crop&auto=format',
    ],
    sqm: 42,
    category: 'Deluxe Collection',
    rating: 4.85,
    floor: 'Floors 1 - 2',
    features: ['King Featherbed', 'Marble Bath', 'High-Speed Wi-Fi', 'Balcony'],
    featuresDetail: ['Plush King-size luxury bed', 'Full Italian marble bath with rain shower', 'Soundproof floor-to-ceiling glass doors'],
    description: 'Designed for effortless comfort and refined tranquility, the Deluxe King features warm timber millwork, tailored linens, and a private balcony overlooking our landscaped sanctuary.',
  },
  'premier twin retreat': {
    img: 'https://images.unsplash.com/photo-1590490360182-c33d57733427?w=900&h=600&fit=crop&auto=format',
    gallery: [
      'https://images.unsplash.com/photo-1590490360182-c33d57733427?w=900&h=600&fit=crop&auto=format',
      'https://images.unsplash.com/photo-1611971263023-105938ce12ed?w=900&h=600&fit=crop&auto=format',
      'https://images.unsplash.com/photo-1602002418679-43121356bf41?w=900&h=600&fit=crop&auto=format',
    ],
    sqm: 46,
    category: 'Deluxe Collection',
    rating: 4.88,
    floor: 'Floor 1',
    features: ['Twin Beds', 'Garden Terrace', 'Ergonomic Desk', 'Smart Climate'],
    featuresDetail: ['Two bespoke twin beds with plush duvets', 'Private veranda opening toward botanical paths', 'Executive workstation and smart ambient controls'],
    description: 'Perfect for discerning colleagues or traveling friends, the Premier Twin Retreat combines dual-bed flexibility with bespoke craftsmanship and lush terrace garden vistas.',
  },
  'family suite': {
    img: 'https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=900&h=600&fit=crop&auto=format',
    gallery: [
      'https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=900&h=600&fit=crop&auto=format',
      'https://images.unsplash.com/photo-1735199579641-c6d4bd824134?w=900&h=600&fit=crop&auto=format',
      'https://images.unsplash.com/photo-1591088398332-8a7791972843?w=900&h=600&fit=crop&auto=format',
    ],
    sqm: 78,
    category: 'Suite Collection',
    rating: 4.92,
    floor: 'Floor 2',
    features: ['2 Bedrooms', 'Living Lounge', 'Kids Nook', 'Deep Soaking Tub'],
    featuresDetail: ['Separate master bedroom and junior bedroom', 'Spacious open-plan living and entertainment area', 'Dual-vanity bathroom with free-standing soaking tub'],
    description: 'An expansive family sanctuary boasting dual bedrooms and an interconnected lounge. Specially appointed with child-friendly amenities and thoughtful privacy for parents.',
  },
  'executive ocean suite': {
    img: 'https://images.unsplash.com/photo-1578683010236-d716f9a3f461?w=900&h=600&fit=crop&auto=format',
    gallery: [
      'https://images.unsplash.com/photo-1578683010236-d716f9a3f461?w=900&h=600&fit=crop&auto=format',
      'https://images.unsplash.com/photo-1590523277543-a94d2e4eb00b?w=900&h=600&fit=crop&auto=format',
      'https://images.unsplash.com/photo-1584622650111-993a426fbf0a?w=900&h=600&fit=crop&auto=format',
    ],
    sqm: 58,
    category: 'Executive Collection',
    rating: 4.94,
    floor: 'Floor 3',
    features: ['180° Ocean View', 'Lounge Access', 'Nespresso Bar', 'Sunset Veranda'],
    featuresDetail: ['Direct uninterrupted sea views', 'Complimentary access to the Aurum Executive Club Lounge', 'Artisanal espresso bar and daily sommelier selection'],
    description: 'Perched on high elevations, the Executive Ocean Suite delivers breathtaking panoramic horizon views, personalized check-in privileges, and access to the Aurum VIP Lounge.',
  },
  'panoramic sunrise suite': {
    img: 'https://images.unsplash.com/photo-1618773928121-c32242e63f39?w=900&h=600&fit=crop&auto=format',
    gallery: [
      'https://images.unsplash.com/photo-1618773928121-c32242e63f39?w=900&h=600&fit=crop&auto=format',
      'https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=900&h=600&fit=crop&auto=format',
      'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=900&h=600&fit=crop&auto=format',
    ],
    sqm: 88,
    category: 'Suite Collection',
    rating: 4.96,
    floor: 'Floor 4',
    features: ['Glass Corner Wall', 'Jacuzzi Spa Bath', 'Private Sunbed', 'Sunset Cocktail'],
    featuresDetail: ['Corner architecture with 270-degree wraparound glazing', 'In-suite heated hydromassage jacuzzi overlooking the horizon', 'Daybed terrace for sunrise meditations'],
    description: 'Awaken to the golden dawn breaking across the horizon. This corner suite offers 270-degree floor-to-ceiling glass architecture and an in-suite hydromassage bath.',
  },
  'wellness & spa villa': {
    img: 'https://images.unsplash.com/photo-1540541338287-41700207dee6?w=900&h=600&fit=crop&auto=format',
    gallery: [
      'https://images.unsplash.com/photo-1540541338287-41700207dee6?w=900&h=600&fit=crop&auto=format',
      'https://images.unsplash.com/photo-1609601546193-f558f1ebb385?w=900&h=600&fit=crop&auto=format',
      'https://images.unsplash.com/photo-1584622650111-993a426fbf0a?w=900&h=600&fit=crop&auto=format',
    ],
    sqm: 110,
    category: 'Villa Collection',
    rating: 4.98,
    floor: 'Garden Enclave',
    features: ['Private Herbal Sauna', 'Outdoor Stone Bath', 'Yoga Pavilion', 'Daily Spa Included'],
    featuresDetail: ['Private cedarwood sauna and steam chamber', 'Monolithic granite outdoor bath amidst tropical greenery', 'One 60-minute therapeutic spa session included per adult daily'],
    description: 'An oasis of rejuvenation enveloped in tropical foliage. Features a private cedarwood sauna, outdoor stone soaking bath, and daily bespoke Ayurvedic therapies.',
  },
  'royal penthouse suite': {
    img: 'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=900&h=600&fit=crop&auto=format',
    gallery: [
      'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=900&h=600&fit=crop&auto=format',
      'https://images.unsplash.com/photo-1578683010236-d716f9a3f461?w=900&h=600&fit=crop&auto=format',
      'https://images.unsplash.com/photo-1618773928121-c32242e63f39?w=900&h=600&fit=crop&auto=format',
    ],
    sqm: 185,
    category: 'Signature Penthouse',
    rating: 5.0,
    floor: 'Floor 6 (Penthouse)',
    features: ['Infinity Plunge Pool', '24/7 Butler Service', 'Grand Piano', 'Private Cellar'],
    featuresDetail: ['Heated rooftop infinity pool commanding the skyline', 'Dedicated certified butler service at your beck and call', 'Private temperature-controlled wine cellar and tasting area'],
    description: 'The pinnacle of vertical luxury. Occupying the entire top floor with private elevator access, a rooftop infinity plunge pool, and round-the-clock dedicated butler service.',
  },
  'presidential beachfront villa': {
    img: 'https://images.unsplash.com/photo-1613977257363-707ba9348227?w=900&h=600&fit=crop&auto=format',
    gallery: [
      'https://images.unsplash.com/photo-1613977257363-707ba9348227?w=900&h=600&fit=crop&auto=format',
      'https://images.unsplash.com/photo-1590523277543-a94d2e4eb00b?w=900&h=600&fit=crop&auto=format',
      'https://images.unsplash.com/photo-1540541338287-41700207dee6?w=900&h=600&fit=crop&auto=format',
    ],
    sqm: 320,
    category: 'Signature Estate',
    rating: 5.0,
    floor: 'Oceanfront Private Estate',
    features: ['Direct Beach Access', '25m Private Lap Pool', 'Private Chef Kitchen', '3 Master Suites'],
    featuresDetail: ['Private gated pathway leading directly onto pristine white sands', '25-meter private swimming pool and sun terrace pavilion', 'Full professional kitchen with private chef dining options'],
    description: 'Our crown jewel. A sprawling private compound steps from the turquoise sea, featuring three grand master suites, a 25-meter private pool, and private beachfront cabana.',
  },
};

export function mapApiRoomToPresentation(room: RoomType): RoomPresentation {
  const normalizedKey = room.type_name.trim().toLowerCase();
  const meta = ROOM_METADATA[normalizedKey] ?? {
    img: DEFAULT_GALLERY[0],
    gallery: DEFAULT_GALLERY,
    sqm: Math.max(35, room.capacity * 20),
    category: 'Aurum Collection',
    rating: 4.85,
    floor: 'Main Resort Wing',
    features: [`Up to ${room.capacity} guests`, `${room.total_rooms} rooms in collection`, 'Date-based pricing'],
    featuresDetail: [`Capacity: ${room.capacity} guests`, `Collection: ${room.total_rooms} physical rooms`, 'Final pricing and availability are checked for your travel dates.'],
    description: `Plan your stay in ${room.type_name}, accommodating up to ${room.capacity} guests. Choose your dates to check current availability and receive a hotel price quote.`,
  };

  return {
    id: room.type_id,
    name: room.type_name,
    type: `Up to ${room.capacity} guests · ${meta.category}`,
    img: meta.img,
    gallery: meta.gallery,
    price: room.base_price,
    originalPrice: room.base_price,
    discount: 0,
    address: 'Aurum Luxury Retreat · Coastal Sanctuary',
    floor: meta.floor,
    tags: [meta.category, `${room.capacity} guests`, `${meta.sqm} m²`],
    features: meta.features,
    featureIcons: [
      { icon: 'bed', label: `${room.capacity} guests` },
      { icon: 'size', label: `${meta.sqm} m²` },
    ],
    extraServices: [],
    sqm: meta.sqm,
    guests: room.capacity,
    category: meta.category,
    description: meta.description,
    features_detail: meta.featuresDetail,
    reviews: [],
    rating: meta.rating,
    availableNow: room.available_now,
    totalRooms: room.total_rooms,
    currency: 'VND',
  };
}
