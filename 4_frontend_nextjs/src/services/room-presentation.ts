import type { RoomType } from '@/types/room.type';
import type { RoomPresentation } from '@/types/room-presentation.type';

interface RoomMeta {
  img: string;
  gallery: string[];
  category: string;
  floor: string;
  sqm: number;
  features: string[];
  featureIcons: { icon: string; label: string }[];
  featuresDetail: string[];
  descriptionVi: string;
}

const WHITE_SAND_ADDRESS = '89-91 Võ Văn Kiệt, Sơn Trà, TP. Đà Nẵng';

const DEFAULT_GALLERY = [
  '/images/whitesand/hero/hotel-exterior.jpg',
  '/images/whitesand/rooms/superior/superior-1.jpg',
  '/images/whitesand/rooms/deluxe/deluxe-1.jpg',
  '/images/whitesand/hero/ocean-suite-view.jpg',
  '/images/whitesand/facilities/pool-gym-2f.jpg',
];

const ROOM_METADATA: Record<string, RoomMeta> = {
  'superior room': {
    img: '/images/whitesand/rooms/superior/superior-1.jpg',
    gallery: [
      '/images/whitesand/rooms/superior/superior-1.jpg',
      '/images/whitesand/rooms/superior/superior-2.jpg',
      '/images/whitesand/rooms/superior/superior-3.jpg',
      '/images/whitesand/rooms/superior/superior-4.jpg',
      '/images/whitesand/rooms/superior/superior-5.jpg',
    ],
    category: 'Standard & Deluxe',
    floor: 'Tầng 3F – 4F (301–406)',
    sqm: 26,
    features: ['Wi-Fi tốc độ cao', 'Bàn làm việc', 'Smart TV 43"', 'Cửa sổ ánh sáng tự nhiên'],
    featureIcons: [
      { icon: 'size', label: '26 m²' },
      { icon: 'bed', label: '1 giường Queen hoặc 2 giường đơn' },
      { icon: 'shower', label: 'Phòng tắm vòi sen đứng' },
      { icon: 'wifi', label: 'Wi-Fi miễn phí' },
    ],
    featuresDetail: [
      'Diện tích tiêu chuẩn 26 m² tại tầng 3F – 4F (12 phòng: 301–406)',
      '1 giường Queen hoặc 2 giường đơn êm ái, tối đa 2 khách',
      'Điều hòa 2 chiều, Smart TV, minibar và két sắt điện tử',
      'Khu vực bàn làm việc gọn gàng phù hợp công tác & nghỉ ngắn ngày',
      'Phòng tắm riêng với vòi sen nóng lạnh và bộ đồ dùng cá nhân',
      'Giá trần kê khai tối đa 1.550.000 VND/đêm',
    ],
    descriptionVi:
      'Hạng phòng Superior Room (26 m²) gồm 12 phòng tại tầng 3F–4F của White Sand Boutique Hotel Đà Nẵng, thiết kế tối giản ấm cúng cách bãi biển Mỹ Khê chỉ vài phút di chuyển.',
  },
  'deluxe room': {
    img: '/images/whitesand/rooms/deluxe/deluxe-1.jpg',
    gallery: [
      '/images/whitesand/rooms/deluxe/deluxe-1.jpg',
      '/images/whitesand/rooms/deluxe/deluxe-2.jpg',
      '/images/whitesand/rooms/deluxe/deluxe-3.jpg',
      '/images/whitesand/rooms/deluxe/deluxe-4.jpg',
      '/images/whitesand/rooms/deluxe/deluxe-5.jpg',
    ],
    category: 'Standard & Deluxe',
    floor: 'Tầng 5F – 6F (501–606)',
    sqm: 30,
    features: ['Ban công thoáng mát', 'Khu ghế thư giãn', 'Smart TV 49"', 'Cà phê & trà'],
    featureIcons: [
      { icon: 'size', label: '30 m²' },
      { icon: 'bed', label: '1 giường King hoặc 2 giường đơn' },
      { icon: 'coffee', label: 'Trà & cà phê pha sẵn' },
      { icon: 'wifi', label: 'Wi-Fi miễn phí' },
    ],
    featuresDetail: [
      'Diện tích 30 m² tại tầng 5F – 6F (12 phòng: 501–606)',
      'Không gian sáng, ban công hoặc cửa sổ lớn hướng phố biển Sơn Trà',
      'Khu vực ghế thư giãn riêng bên cửa sổ',
      'Phòng tắm hiện đại đầy đủ tiện nghi & máy sấy tóc',
      'Sử dụng hồ bơi & phòng gym miễn phí tại tầng 2F',
      'Giá trần kê khai tối đa 1.700.000 VND/đêm',
    ],
    descriptionVi:
      'Deluxe Room rộng 30 m² phân bổ tại tầng 5F–6F với ánh sáng tự nhiên dồi dào, mang lại trải nghiệm lưu trú thư thái gần cầu Rồng và biển Mỹ Khê.',
  },
  'premium room': {
    img: '/images/whitesand/rooms/premium/premium-1.jpg',
    gallery: [
      '/images/whitesand/rooms/premium/premium-1.jpg',
      '/images/whitesand/rooms/premium/premium-2.jpg',
      '/images/whitesand/rooms/premium/premium-3.jpg',
      '/images/whitesand/rooms/premium/premium-4.jpg',
      '/images/whitesand/hero/ocean-suite-view.jpg',
    ],
    category: 'Premium & Executive',
    floor: 'Tầng 7F – 8F (701–804)',
    sqm: 34,
    features: ['Phòng gia đình 4 khách', 'Không gian mở', 'Cửa sổ rộng', 'Sofa tiếp khách'],
    featureIcons: [
      { icon: 'size', label: '34 m²' },
      { icon: 'bed', label: '2 giường đôi (tối đa 4 khách)' },
      { icon: 'ocean', label: 'Tầm nhìn tầng trung cao' },
      { icon: 'wifi', label: 'Wi-Fi tốc độ cao' },
    ],
    featuresDetail: [
      'Diện tích 34 m² tại tầng 7F – 8F (8 phòng: 701–804)',
      'Sức chứa rộng rãi tới 4 khách, lý tưởng cho gia đình hoặc nhóm bạn',
      'Trang bị sofa tiếp khách, Smart TV, minibar & bình đun nước',
      'Cách âm tốt, rèm cản sáng hai lớp giúp nghỉ ngơi trọn vẹn',
      'Truy cập tiện ích hồ bơi tầng 2F và nhà hàng tầng 14F',
      'Giá trần kê khai tối đa 1.850.000 VND/đêm',
    ],
    descriptionVi:
      'Premium Room (34 m²) nằm trên tầng 7F–8F, bố trí tối đa 4 khách cho gia đình và nhóm du lịch khám phá Đà Nẵng với tầm nhìn thông thoáng về phía bán đảo Sơn Trà.',
  },
  'executive room': {
    img: '/images/whitesand/rooms/executive/executive-1.jpg',
    gallery: [
      '/images/whitesand/rooms/executive/executive-1.jpg',
      '/images/whitesand/rooms/executive/executive-2.jpg',
      '/images/whitesand/rooms/executive/executive-3.jpg',
      '/images/whitesand/rooms/executive/executive-4.jpg',
      '/images/whitesand/facilities/concierge-reception.jpg',
    ],
    category: 'Premium & Executive',
    floor: 'Tầng 9F – 10F (901–1004)',
    sqm: 38,
    features: ['Tầm nhìn hướng biển', 'Bồn tắm nằm', 'Góc làm việc Executive', 'Tầng cao yên tĩnh'],
    featureIcons: [
      { icon: 'size', label: '38 m²' },
      { icon: 'ocean', label: 'Hướng biển Mỹ Khê' },
      { icon: 'bath', label: 'Bồn tắm nằm thư giãn' },
      { icon: 'bed', label: '1 giường King cao cấp' },
    ],
    featuresDetail: [
      'Diện tích 38 m² tại tầng 9F – 10F (8 phòng: 901–1004)',
      'Tầm nhìn tầng cao mở rộng về phía biển Mỹ Khê và đại lộ Võ Văn Kiệt',
      'Bồn tắm nằm riêng biệt kết hợp phòng tắm đứng kính trong suốt',
      'Góc làm việc yên tĩnh với bàn gỗ lớn và ghế công thái học',
      'Ưu tiên nhận phòng sớm / trả phòng trễ tùy tình trạng trống thực tế',
      'Giá trần kê khai tối đa 2.000.000 VND/đêm',
    ],
    descriptionVi:
      'Executive Room rộng 38 m² tại tầng 9F–10F mang đến sự riêng tư và tầm nhìn cao khoáng đạt hướng biển Mỹ Khê cùng bồn tắm nằm thư giãn.',
  },
  'suite': {
    img: '/images/whitesand/rooms/suite/suite-1.jpg',
    gallery: [
      '/images/whitesand/rooms/suite/suite-1.jpg',
      '/images/whitesand/rooms/suite/suite-2.jpg',
      '/images/whitesand/rooms/suite/suite-3.jpg',
      '/images/whitesand/rooms/suite/suite-4.jpg',
      '/images/whitesand/hero/ocean-suite-view.jpg',
    ],
    category: 'Suite & Studio',
    floor: 'Tầng 11F – 12F (1101–1204)',
    sqm: 48,
    features: ['Phòng khách tách biệt', 'Ban công hướng biển', 'Bồn tắm đá', 'Tối đa 3 khách'],
    featureIcons: [
      { icon: 'size', label: '48 m²' },
      { icon: 'ocean', label: 'Toàn cảnh biển & cầu Rồng' },
      { icon: 'bath', label: 'Bồn tắm lớn & áo choàng' },
      { icon: 'bed', label: 'Phòng ngủ + Phòng khách riêng' },
    ],
    featuresDetail: [
      'Diện tích 48 m² tại tầng 11F – 12F (8 phòng: 1101–1204)',
      'Thiết kế Suite gồm phòng ngủ King tách biệt phòng khách sofa rộng',
      'Sức chứa tối đa 3 khách, phù hợp cặp đôi cao cấp hoặc gia đình nhỏ',
      'Cửa kính tràn viền đón bình minh Mỹ Khê ngay từ tầng cao',
      'Chỉ một tầng di chuyển tới nhà hàng tầng 14F và Spa tầng 15F',
      'Giá trần kê khai tối đa 2.150.000 VND/đêm',
    ],
    descriptionVi:
      'Hạng Suite (48 m²) tại tầng 11F–12F kết hợp phòng ngủ King riêng tư và phòng khách thoáng đãng, thu trọn khung cảnh biển Đông và nhịp sống Đà Nẵng.',
  },
  'studio apartment': {
    img: '/images/whitesand/rooms/studio/studio-1.jpg',
    gallery: [
      '/images/whitesand/rooms/studio/studio-1.jpg',
      '/images/whitesand/rooms/studio/studio-2.jpg',
      '/images/whitesand/rooms/studio/studio-3.jpg',
      '/images/whitesand/rooms/studio/studio-4.jpg',
      '/images/whitesand/hero/hotel-exterior.jpg',
    ],
    category: 'Suite & Studio',
    floor: 'Tầng 13F (1301–1306)',
    sqm: 56,
    features: ['Bếp nhỏ tiện nghi', 'Bàn ăn 4 chỗ', 'Tầng lưu trú cao nhất', 'Lưu trú dài ngày'],
    featureIcons: [
      { icon: 'size', label: '56 m²' },
      { icon: 'chef', label: 'Khu bếp & bàn ăn riêng' },
      { icon: 'ocean', label: 'Tầm nhìn 13F thoáng rộng' },
      { icon: 'bed', label: 'Căn hộ tối đa 4 khách' },
    ],
    featuresDetail: [
      'Diện tích 56 m² tại tầng 13F (6 căn hộ: 1301–1306)',
      'Trang bị bếp từ, lò vi sóng, tủ lạnh lớn và bộ bàn ăn gia đình',
      'Tối ưu cho kỳ nghỉ dài ngày hoặc gia đình 4 khách cần sinh hoạt riêng',
      'Cách tầng 14F Nhà hàng & tầng 15F Spa chỉ vài bước thang máy',
      'Ánh sáng tự nhiên bao quanh 2 mặt kính rộng',
      'Giá trần kê khai tối đa 2.300.000 VND/đêm',
    ],
    descriptionVi:
      'Studio Apartment 56 m² tọa lạc trên tầng 13F — tầng phòng nghỉ cao nhất của White Sand Boutique Hotel, tích hợp bếp tiện nghi cho kỳ nghỉ gia đình dài ngày tại Đà Nẵng.',
  },
};

export function mapApiRoomToPresentation(room: RoomType): RoomPresentation {
  const normalizedKey = room.type_name.trim().toLowerCase();
  const meta = ROOM_METADATA[normalizedKey];

  const category = meta?.category ?? 'White Sand Collection';
  const img = meta?.img ?? DEFAULT_GALLERY[0];
  const gallery = meta?.gallery ?? DEFAULT_GALLERY;
  const featureIcons = meta?.featureIcons ?? [{ icon: 'bed', label: `Tối đa ${room.capacity} khách` }];
  const features = meta?.features ?? [];
  const featuresDetail = meta?.featuresDetail ?? [];
  const description =
    meta?.descriptionVi ??
    `Lên kế hoạch lưu trú tại hạng phòng ${room.type_name} (tối đa ${room.capacity} khách) ở White Sand Boutique Hotel Đà Nẵng. Chọn ngày nhận và trả phòng để nhận báo giá theo ngữ cảnh thực tế.`;

  return {
    id: room.type_id,
    name: room.type_name,
    type: `Tối đa ${room.capacity} khách`,
    img,
    gallery,
    price: room.base_price,
    originalPrice: room.base_price,
    discount: 0,
    address: WHITE_SAND_ADDRESS,
    tags: [category, `Tối đa ${room.capacity} khách`],
    featureIcons,
    extraServices: [],
    guests: room.capacity,
    category,
    features_detail: featuresDetail,
    floor: meta?.floor ?? '',
    features,
    sqm: meta?.sqm ?? null,
    rating: null,
    description,
    reviews: [],
    availableNow: room.available_now,
    totalRooms: room.total_rooms,
    currency: 'VND',
  };
}

export const FALLBACK_ROOM_TYPES: RoomType[] = [
  { type_id: 1, type_name: 'Superior Room', base_price: 1200000, declared_max_price: 1550000, capacity: 2, total_rooms: 12, available_now: 12 },
  { type_id: 2, type_name: 'Deluxe Room', base_price: 1400000, declared_max_price: 1700000, capacity: 2, total_rooms: 12, available_now: 12 },
  { type_id: 3, type_name: 'Premium Room', base_price: 1600000, declared_max_price: 1850000, capacity: 4, total_rooms: 8, available_now: 8 },
  { type_id: 4, type_name: 'Executive Room', base_price: 1700000, declared_max_price: 2000000, capacity: 2, total_rooms: 8, available_now: 8 },
  { type_id: 5, type_name: 'Suite', base_price: 1800000, declared_max_price: 2150000, capacity: 3, total_rooms: 8, available_now: 8 },
  { type_id: 6, type_name: 'Studio Apartment', base_price: 2000000, declared_max_price: 2300000, capacity: 4, total_rooms: 6, available_now: 6 },
];

export function getFallbackRoomPresentations(): RoomPresentation[] {
  return FALLBACK_ROOM_TYPES.map(mapApiRoomToPresentation);
}
