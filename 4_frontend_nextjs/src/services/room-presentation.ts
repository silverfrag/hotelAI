import type { RoomType } from '@/types/room.type';
import type { RoomPresentation } from '@/types/room-presentation.type';

const ROOM_PHOTO = 'https://images.unsplash.com/photo-1731336478850-6bce7235e320?w=800&h=600&fit=crop&auto=format';
const FAMILY_PHOTO = 'https://images.unsplash.com/photo-1735199579641-c6d4bd824134?w=800&h=600&fit=crop&auto=format';
const GALLERY = [
  'https://images.unsplash.com/photo-1731336478850-6bce7235e320?w=500&h=340&fit=crop&auto=format',
  'https://images.unsplash.com/photo-1584622650111-993a426fbf0a?w=500&h=340&fit=crop&auto=format',
  'https://images.unsplash.com/photo-1602002418679-43121356bf41?w=500&h=340&fit=crop&auto=format',
  'https://images.unsplash.com/photo-1611971263023-105938ce12ed?w=500&h=340&fit=crop&auto=format',
];

/** Core has no media, property locations, area, extras or reviews. Images are
 * illustrative design assets, never used to infer hotel inventory or amenities. */
export function mapApiRoomToPresentation(room: RoomType): RoomPresentation {
  const img = /family/i.test(room.type_name) ? FAMILY_PHOTO : ROOM_PHOTO;
  return {
    id: room.type_id, name: room.type_name, type: `Up to ${room.capacity} guests`,
    img, gallery: [img, ...GALLERY], price: room.base_price, originalPrice: room.base_price,
    discount: 0, address: 'HotelAI · Room collection', floor: 'Illustrative photography',
    tags: ['Room collection', `${room.capacity} guests`],
    features: [`Up to ${room.capacity} guests`, `${room.total_rooms} rooms in collection`, 'Date-based pricing'],
    featureIcons: [{ icon: 'bed', label: `${room.capacity} guests` }, { icon: 'size', label: `${room.total_rooms} rooms` }],
    extraServices: [], sqm: null, guests: room.capacity, category: room.type_name,
    description: `Plan your stay in ${room.type_name}, accommodating up to ${room.capacity} guests. Choose your dates to check current availability and receive a hotel price quote. Photography illustrates the design inspiration; contact the hotel for specific room amenities.`,
    features_detail: [`Capacity: ${room.capacity} guests`, `Collection: ${room.total_rooms} physical rooms`, 'Final pricing and availability are checked for your travel dates.'],
    reviews: [], rating: null, availableNow: room.available_now, totalRooms: room.total_rooms, currency: 'VND',
  };
}
