import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { DataSource } from 'typeorm';
import { RoomsService } from '../rooms/rooms.service';

export interface ConciergeCitation {
  doc_id: string;
  category: string;
  title: string;
  snippet: string;
  score: number;
  bm25_raw: number;
  tfidf_score: number;
  suggested_route?: string | null;
}

export interface ConciergeSlots {
  room_type_id?: number | null;
  room_type_name?: string | null;
  check_in_date?: string | null;
  check_out_date?: string | null;
  nights?: number | null;
  guest_count?: number | null;
  coupon_code?: string | null;
}

export interface ConciergeSuggestedAction {
  label: string;
  href: string;
}

export interface RichChatResult {
  response: string;
  citations: ConciergeCitation[];
  slots: ConciergeSlots;
  suggested_action: ConciergeSuggestedAction | null;
  retriever: string;
  live_tools_used: string[];
}

interface SOPKnowledgeEntry {
  keywords: RegExp;
  responseVi: string;
  responseEn: string;
}

const WHITESAND_SOP: SOPKnowledgeEntry[] = [
  {
    keywords: /dia chi|vi tri|o dau|address|location|vo van kiet|my khe|san bay|airport|ban do|lien he|hotline|email/,
    responseVi:
      '📍 **Vị Trí & Liên Hệ — White Sand Boutique Hotel:**\n' +
      '• **Địa chỉ:** 89-91 Võ Văn Kiệt, phường An Hải (Phước Mỹ cũ), quận Sơn Trà, TP. Đà Nẵng.\n' +
      '• **Khoảng cách nổi bật:** Cách bãi biển Mỹ Khê khoảng 50m (đối diện công viên Biển Đông), cách cầu Rồng 1,5 km, cách Sân bay Quốc tế Đà Nẵng ~15 phút di chuyển.\n' +
      '• **Hotline:** +84 2363 575 799 / +84 766 535 355 · **Email:** sm@whitesandhotel.com.vn.\n' +
      '• Lưu ý: Trợ lý chỉ cung cấp thông tin khách sạn và không tự đặt xe hoặc đặt phòng qua chat.',
    responseEn:
      '📍 **Location & Contact — White Sand Boutique Hotel:**\n' +
      '• **Address:** 89-91 Vo Van Kiet St., An Hai Ward, Son Tra District, Da Nang City.\n' +
      '• **Highlights:** ~50m from My Khe Beach, ~1.5 km from Dragon Bridge, ~15 minutes from Da Nang International Airport.\n' +
      '• **Hotline:** +84 2363 575 799 / +84 766 535 355 · **Email:** sm@whitesandhotel.com.vn.\n' +
      '• Note: White Sand assistant provides verified hotel guidance and does not create bookings over chat.',
  },
  {
    keywords: /an sang|buffet|nha hang|am thuc|dining|breakfast|restaurant|tang 14|mon an|thuc don/,
    responseVi:
      '🍽️ **Nhà Hàng Biển White Sand (Tầng 14):**\n' +
      '• **Không gian:** Tọa lạc tại Tầng 14 với tầm nhìn hướng trực diện biển Mỹ Khê và bán đảo Sơn Trà.\n' +
      '• **Buffet sáng hàng ngày:** Phục vụ tại Nhà hàng Tầng 14 với thực đơn món Việt đặc sản Đà Nẵng và món Âu.\n' +
      '• Đặt bàn sự kiện hoặc yêu cầu thực đơn đặc biệt vui lòng liên hệ Lễ tân (+84 2363 575 799).',
    responseEn:
      '🍽️ **White Sand Sea-View Restaurant (14th Floor):**\n' +
      '• **Setting:** Located on Floor 14 overlooking My Khe Beach and Son Tra Peninsula.\n' +
      '• **Daily Breakfast Buffet:** Served at our 14F restaurant with Da Nang local specialties and international cuisine.\n' +
      '• For dietary requests or table arrangements, please contact Reception (+84 2363 575 799).',
  },
  {
    keywords: /spa|massage|gym|fitness|the duc|ho boi|be boi|pool|wellness|tang 2|tang 15|wifi|tien ich/,
    responseVi:
      '🌿 **Tiện Ích Sức Khỏe & Thư Giãn tại White Sand:**\n' +
      '• **White Sand Spa (Tầng 15):** Khách lưu trú trực tiếp được áp dụng **ưu đãi 30%** các gói massage & trị liệu thư giãn.\n' +
      '• **Hồ bơi trong nhà & Phòng Gym (Tầng 2):** Mở cửa phục vụ miễn phí cho khách lưu trú trong thời gian ở.\n' +
      '• **Wi-Fi tốc độ cao:** Miễn phí toàn khu vực phòng nghỉ và sảnh. Quý khách cần hỗ trợ đặt lịch spa vui lòng liên hệ quầy Lễ tân (trợ lý chat không trực tiếp tạo lịch hẹn).',
    responseEn:
      '🌿 **Wellness & Facilities at White Sand Boutique Hotel:**\n' +
      '• **White Sand Spa (15th Floor):** Resident guests enjoy a **30% discount** on spa treatments.\n' +
      '• **Indoor Pool & Fitness Gym (2nd Floor):** Complimentary daily access for staying guests.\n' +
      '• **Wi-Fi & Concierge Desk:** High-speed Wi-Fi is included across rooms and lobby; live spa scheduling is handled by Front Desk staff (White Sand assistant does not create reservations via chat).',
  },
  {
    keywords: /thu cung|cho|meo|pet|pet.?friendly|dong vat/,
    responseVi:
      '🐾 **Chính Sách Thú Cưng (Pet Policy):**\n' +
      '• Để bảo đảm vệ sinh và không gian yên tĩnh cho toàn bộ tòa nhà 15 tầng, White Sand Boutique Hotel **hiện không nhận thú cưng** (no pets allowed).',
    responseEn:
      '🐾 **Pet Policy:**\n' +
      '• To maintain hygiene and acoustic comfort across our 15-floor building, White Sand Boutique Hotel **does not allow pets**.',
  },
  {
    keywords: /coupon|khuyen mai|giam gia|voucher|code|promo|discount|whitesand10|summer15|suite20|diff2026/,
    responseVi:
      '🏷️ **Mã Giảm Giá Trực Tiếp Tại White Sand (Áp dụng tại /book):**\n' +
      '• `WHITESAND10`: Giảm 10% tối đa 300.000 VND/đêm cho mọi hạng phòng.\n' +
      '• `SUMMER15`: Giảm 15% tối đa 450.000 VND/đêm mùa biển Mỹ Khê.\n' +
      '• `DIFF2026`: Giảm 12% tối đa 400.000 VND/đêm dịp Lễ hội Pháo hoa Đà Nẵng.\n' +
      '• `SUITE20`: Giảm 20% tối đa 600.000 VND/đêm dành cho hạng `Suite` và `Studio Apartment`.\n\n' +
      '💡 Hệ thống luôn kiểm tra giới hạn lượt dùng thực tế trong CSDL và rào chắn giá sàn biến phí (452.000 VND/đêm) khi xuất báo giá tại **/book**.',
    responseEn:
      '🏷️ **Direct Booking Coupons at White Sand (Apply on /book):**\n' +
      '• `WHITESAND10`: 10% off up to VND 300,000/night across all room types.\n' +
      '• `SUMMER15`: 15% off up to VND 450,000/night for coastal stays.\n' +
      '• `DIFF2026`: 12% off up to VND 400,000/night for Danang Fireworks festival season.\n' +
      '• `SUITE20`: 20% off up to VND 600,000/night for `Suite` and `Studio Apartment` tiers.\n\n' +
      '💡 Availability quotas and our contribution margin floor (VND 452,000/night) are enforced live on **/book**.',
  },
];

@Injectable()
export class ChatService {
  constructor(
    private readonly rooms: RoomsService,
    @Optional() private readonly config?: ConfigService,
    @Optional() private readonly dataSource?: DataSource,
  ) {}

  private getBusinessDate(now = new Date()): string {
    const timeZone = this.config?.get<string>('HOTEL_TIMEZONE', 'Asia/Bangkok') ?? 'Asia/Bangkok';
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    const value = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
    return `${value.year}-${value.month}-${value.day}`;
  }

  private addIsoDays(isoDate: string, days: number): string {
    const parsed = new Date(`${isoDate}T00:00:00.000Z`);
    parsed.setUTCDate(parsed.getUTCDate() + days);
    return parsed.toISOString().slice(0, 10);
  }

  private getConciergeUrl(): string | null {
    if (!this.config) return null;
    const revenue = this.config.get<string>('AI_REVENUE_URL');
    const academic = this.config.get<string>('AI_ACADEMIC_URL');
    const legacy = this.config.get<string>('AI_SERVICE_URL');
    const raw = revenue || academic || legacy || 'http://127.0.0.1:8000';
    try {
      return `${new URL(raw).origin}/api/v1/concierge/ask`;
    } catch {
      return null;
    }
  }

  private async queryConciergeRag(
    message: string,
    language: 'vi' | 'en',
  ): Promise<{
    retriever: string;
    top_category: string;
    slots: ConciergeSlots;
    citations: ConciergeCitation[];
  }> {
    const url = this.getConciergeUrl();
    if (!url) {
      return { retriever: 'rule_fallback', top_category: 'general', slots: {}, citations: [] };
    }
    try {
      const { data } = await axios.post(
        url,
        { message, language },
        { timeout: 3500 },
      );
      return {
        retriever: typeof data?.retriever === 'string' ? data.retriever : 'hybrid_bm25_tfidf_v1',
        top_category: typeof data?.top_category === 'string' ? data.top_category : 'general',
        slots: data?.slots && typeof data.slots === 'object' ? data.slots : {},
        citations: Array.isArray(data?.citations) ? data.citations : [],
      };
    } catch {
      return { retriever: 'rule_fallback', top_category: 'general', slots: {}, citations: [] };
    }
  }

  async processMessage(
    _userId: string | undefined,
    message: string,
    userName?: string,
    language?: 'vi' | 'en',
  ): Promise<string> {
    const raw = message.trim();
    const text = raw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
    const english = language
      ? language === 'en'
      : /^(hi\b|hello\b|hey\b|what\b|how\b|where\b|when\b|can\b|is\b|are\b|do\b|does\b|price\b|room\b|book\b|cancel\b)/i.test(raw);
    const reply = (vi: string, en: string) => (english ? en : vi);

    // 1. SOP Tri thức khách sạn White Sand Đà Nẵng
    for (const entry of WHITESAND_SOP) {
      if (entry.keywords.test(text)) {
        return english ? entry.responseEn : entry.responseVi;
      }
    }

    // 2. Chính sách hủy / hoàn tiền
    if (/huy|hoan tien|doi ngay|chinh sach|cancel|refund|policy/.test(text)) {
      return reply(
        '📋 **Chính Sách Hủy & Tra Cứu Đặt Phòng:**\n' +
          '• Quý khách vui lòng mở mục **"Lịch sử đặt phòng" (`/bookings`)** để kiểm tra điều kiện hủy (`can_cancel`) và thao tác trực tiếp theo từng mã đặt phòng.\n' +
          '• Chỉ những đơn còn trong thời hạn hợp lệ trước ngày nhận phòng mới có thể hủy trực tuyến.\n' +
          '• Nếu cần hỗ trợ đặc biệt về hoàn cọc hoặc đổi lịch trình, vui lòng liên hệ trực tiếp Lễ tân qua hotline +84 2363 575 799 hoặc email sm@whitesandhotel.com.vn.',
        '📋 **Cancellation & Reservation Lookup:**\n' +
          '• Please open **"My Bookings" (`/bookings`)** to check exact cancellation eligibility (`can_cancel`) and cancel online when permitted.\n' +
          '• Only active bookings before their check-in cut-off can be canceled self-service.\n' +
          '• For refund assistance or schedule changes, please contact Front Desk staff at +84 2363 575 799 or sm@whitesandhotel.com.vn.',
      );
    }

    // 3. Hội viên & Nâng hạng
    if (/hoi vien|loyalty|diem|point|nang hang|upgrade|tier|vip/.test(text)) {
      return reply(
        '👑 **Hạng Thành Viên & Quy Tắc Nâng Hạng Phòng:**\n' +
          '• **Bronze (Mặc định):** 0 – 999 điểm.\n' +
          '• **Silver (từ 1.000 điểm):** Tích lũy từ chi tiêu lưu trú đã hoàn tất.\n' +
          '• **Gold (từ 5.000 điểm):** Ưu tiên xem xét hỗ trợ khi nhận phòng.\n' +
          '• **Platinum (từ 20.000 điểm):** Mức ưu tiên cao nhất trong hệ thống phân bổ.\n\n' +
          '💡 *Lưu ý:* Việc nâng hạng phòng thực tế chỉ được **nhân viên Lễ tân** thực hiện khi có phòng trống phù hợp (và tuân thủ bài toán tối ưu phân bổ không trùng lịch OR-Tools), trợ lý chat không tự ý nâng hạng.',
        '👑 **Loyalty Tiers & Room Upgrade Policy:**\n' +
          '• **Bronze (Default):** 0 – 999 points.\n' +
          '• **Silver (1,000+ pts):** Accumulated from completed hotel stays.\n' +
          '• **Gold (5,000+ pts):** Priority consideration upon arrival.\n' +
          '• **Platinum (20,000+ pts):** Highest priority tier in allocation optimization.\n\n' +
          '💡 *Note:* Actual room upgrades are reviewed and confirmed only by **hotel staff / Reception** subject to physical availability, never committed by chat.',
      );
    }

    // 4. Nhận phòng / Trả phòng
    if (/nhan phong|tra phong|check.?in|check.?out|checkout|checkin|gio den|gio di/.test(text)) {
      return reply(
        '🕒 **Giờ Nhận & Trả Phòng — White Sand Boutique Hotel:**\n' +
          '• **Giờ nhận phòng (Check-in):** Từ 14:00.\n' +
          '• **Giờ trả phòng (Check-out):** Trước 12:00 trưa.\n' +
          '• Yêu cầu nhận phòng sớm hoặc trả phòng muộn tùy thuộc trạng thái dọn phòng thực tế tại Lễ tân (tầng trệt, 89-91 Võ Văn Kiệt).',
        '🕒 **Check-in & Check-out Hours — White Sand Boutique Hotel:**\n' +
          '• **Standard Check-in:** From 14:00.\n' +
          '• **Standard Check-out:** Before 12:00 noon.\n' +
          '• Early check-in or late check-out requests depend on live housekeeping readiness at the Front Desk.',
      );
    }

    // 5. Danh mục phòng & Giá cơ sở từ CSDL thực tế
    if (/phong|gia|room|price|rate|suite|studio|deluxe|superior|premium|executive|availability|book|con phong/.test(text)) {
      const catalog = await this.rooms.findAllActiveRooms();
      if (!catalog.length) {
        return reply(
          'Hiện chưa có hạng phòng nào trong danh mục. Vui lòng thử lại sau hoặc liên hệ Lễ tân +84 2363 575 799.',
          'No rooms are currently listed in the catalog. Please try again later or contact Reception at +84 2363 575 799.',
        );
      }

      const amount = new Intl.NumberFormat(english ? 'en-US' : 'vi-VN', {
        style: 'currency',
        currency: 'VND',
        maximumFractionDigits: 0,
      });

      const lines = catalog.map(
        (room) =>
          `• **${room.type_name}:** ${amount.format(Number(room.base_price))} / ${reply('đêm', 'night')} · ${reply('tối đa', 'max')} ${room.capacity} ${reply('khách', 'guests')}`,
      );

      return (
        reply(
          '🏨 **Danh Mục Phòng & Giá Cơ Sở Tại White Sand Boutique Hotel Đà Nẵng:**\n\n',
          '🏨 **Room Categories & Base Rates at White Sand Boutique Hotel Da Nang:**\n\n',
        ) +
        lines.join('\n') +
        '\n\n' +
        reply(
          '💡 *Lưu ý:* Đây là giá tham chiếu cơ sở, **chưa phải giá chốt** cuối cùng. Quý khách vui lòng chọn ngày và nhập mã ưu đãi tại trang **Đặt phòng (`/book`)** để nhận báo giá động thực tế kèm phân tích chi tiết.',
          '💡 *Note:* These base rates are indicative and **are not final locked quotes**. Select your dates and coupon code on **Book (`/book`)** to generate a real-time contextual quote.',
        )
      );
    }

    // 6. Lời chào mặc định trung thực
    return reply(
      `Xin chào${userName ? ' ' + userName : ''}! Tôi là **White Sand assistant** (trợ lý thông tin tại White Sand Boutique Hotel Đà Nẵng, 89-91 Võ Văn Kiệt).\n\n` +
        'Tôi có thể hỗ trợ quý khách:\n' +
        '• Tra cứu danh mục phòng (54 phòng, 6 hạng) & giá cơ sở tham chiếu (xem giá chốt tại `/book`).\n' +
        '• Địa chỉ khách sạn gần biển Mỹ Khê, Nhà hàng Tầng 14, Hồ bơi & Gym Tầng 2, White Sand Spa Tầng 15 (giảm 30%).\n' +
        '• Mã ưu đãi trực tuyến (`WHITESAND10`, `SUMMER15`, `DIFF2026`, `SUITE20`) và chính sách hủy tại `/bookings`.\n\n' +
        'Quý khách cần thông tin gì thêm?',
      `Hello${userName ? ' ' + userName : ''}! I am your **White Sand assistant** at White Sand Boutique Hotel Da Nang (89-91 Vo Van Kiet St.).\n\n` +
        'I can help you with:\n' +
        '• Browsing our 6 room categories (54 rooms) and indicative base rates (locked quotes on `/book`).\n' +
        '• Verified hotel facilities: 14F Sea-View Restaurant, 2F Indoor Pool & Gym, 15F White Sand Spa (30% off).\n' +
        '• Direct booking coupons (`WHITESAND10`, `SUMMER15`, `DIFF2026`, `SUITE20`) and cancellation lookup on `/bookings`.\n\n' +
        'How may I assist you today?',
    );
  }

  async processRichMessage(
    userId: string | undefined,
    message: string,
    userName?: string,
    language?: 'vi' | 'en',
  ): Promise<RichChatResult> {
    const raw = message.trim();
    const normText = raw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
    const english = language
      ? language === 'en'
      : /^(hi\b|hello\b|hey\b|what\b|how\b|where\b|when\b|can\b|is\b|are\b|do\b|does\b|price\b|room\b|book\b|cancel\b)/i.test(raw);
    const lang: 'vi' | 'en' = english ? 'en' : 'vi';
    const reply = (vi: string, en: string) => (english ? en : vi);

    const [baseline, rag] = await Promise.all([
      this.processMessage(userId, message, userName, language),
      this.queryConciergeRag(raw, lang),
    ]);

    const liveToolsUsed: string[] = [];
    const extraBlocks: string[] = [];
    let response = baseline;
    let suggestedAction: ConciergeSuggestedAction | null = null;
    const slots = rag.slots ?? {};
    const businessDate = this.getBusinessDate();

    const isGreetingFallback =
      baseline.includes('Quý khách cần thông tin gì thêm?') ||
      baseline.includes('How may I assist you today?');

    // 1. Live PG availability tool (read-only; NEVER writes pricing_quotes)
    const shouldCheckInventory =
      Boolean(this.dataSource) &&
      (slots.room_type_id != null || slots.check_in_date != null) &&
      !/huy|hoan tien|cancel|refund|thu cung|pet/.test(normText);

    if (shouldCheckInventory && this.dataSource) {
      try {
        const rawCheckIn = slots.check_in_date && slots.check_in_date >= businessDate
          ? slots.check_in_date
          : this.addIsoDays(businessDate, 1);
        const nights = Math.max(1, Math.min(30, slots.nights ?? 2));
        const rawCheckOut =
          slots.check_out_date && slots.check_out_date > rawCheckIn
            ? slots.check_out_date
            : this.addIsoDays(rawCheckIn, nights);

        const rows = (await this.dataSource.query(
          `SELECT rt.type_id,
                  rt.name AS type_name,
                  rt.base_price,
                  rt.capacity,
                  COUNT(r.room_id)::int AS sellable_rooms,
                  COUNT(r.room_id) FILTER (
                    WHERE r.current_status = 'Available'
                      AND NOT EXISTS (
                        SELECT 1
                        FROM booking_details bd
                        INNER JOIN bookings b ON b.booking_id = bd.booking_id
                        WHERE bd.room_id = r.room_id
                          AND (b.status IN ('Confirmed', 'CheckedIn')
                            OR (b.status = 'Pending' AND b.pending_expires_at > CURRENT_TIMESTAMP))
                          AND b.check_in_date < $3::date
                          AND b.check_out_date > $2::date
                      )
                  )::int AS available_rooms
           FROM room_types rt
           LEFT JOIN rooms r ON r.type_id = rt.type_id AND r.current_status <> 'Maintenance'
           WHERE ($1::int IS NULL OR rt.type_id = $1::int)
           GROUP BY rt.type_id, rt.name, rt.base_price, rt.capacity
           ORDER BY rt.base_price ASC, rt.type_id ASC`,
          [slots.room_type_id ?? null, rawCheckIn, rawCheckOut],
        )) as Array<{
          type_id: number | string;
          type_name: string;
          base_price: string | number;
          capacity: number | string;
          sellable_rooms: number | string;
          available_rooms: number | string;
        }>;

        if (rows.length > 0) {
          liveToolsUsed.push('pg_live_inventory_availability');
          const vnd = new Intl.NumberFormat(english ? 'en-US' : 'vi-VN', {
            style: 'currency',
            currency: 'VND',
            maximumFractionDigits: 0,
          });
          const lines = rows.map(
            (r) =>
              `• **${r.type_name}:** ${Number(r.available_rooms)}/${Number(r.sellable_rooms)} ${reply('phòng trống', 'rooms available')} · ${vnd.format(Number(r.base_price))}/${reply('đêm (giá gốc)', 'night (base rate)')} · ${reply('tối đa', 'max')} ${Number(r.capacity)} ${reply('khách', 'guests')}`,
          );
          extraBlocks.push(
            reply(
              `📅 **Kiểm Tra Tồn Phòng Thực Tế (${rawCheckIn} → ${rawCheckOut}):**\n${lines.join('\n')}`,
              `📅 **Live Room Availability (${rawCheckIn} → ${rawCheckOut}):**\n${lines.join('\n')}`,
            ),
          );

          const primary = rows[0];
          const params = new URLSearchParams({
            room_type_id: String(primary.type_id),
            check_in_date: rawCheckIn,
            check_out_date: rawCheckOut,
          });
          if (slots.guest_count) params.set('guest_count', String(slots.guest_count));
          if (slots.coupon_code) params.set('coupon_code', slots.coupon_code);
          suggestedAction = {
            label: reply(`Báo giá ${primary.type_name} tại /book`, `Open ${primary.type_name} quote on /book`),
            href: `/book?${params.toString()}`,
          };
        }
      } catch {
        // Ignore read-only DB failures and keep baseline response
      }
    }

    // 2. Live PG coupon quota tool (read-only)
    const wantsCouponCheck =
      Boolean(this.dataSource) &&
      (Boolean(slots.coupon_code) ||
        /coupon|khuyen mai|giam gia|voucher|promo|whitesand10|summer15|diff2026|suite20/.test(normText));
    if (wantsCouponCheck && this.dataSource) {
      try {
        const couponRows = (await this.dataSource.query(
          `SELECT code, description_vi, discount_pct, max_discount_vnd, usage_limit, used_count
           FROM pricing_coupons
           WHERE active = true
             AND (expiry_date IS NULL OR expiry_date >= $1::date)
             AND ($2::text IS NULL OR code = $2::text)
           ORDER BY discount_pct ASC`,
          [businessDate, slots.coupon_code ?? null],
        )) as Array<{
          code: string;
          description_vi: string;
          discount_pct: string | number;
          max_discount_vnd: string | number;
          usage_limit: number | string;
          used_count: number | string;
        }>;
        if (couponRows.length > 0) {
          liveToolsUsed.push('pg_coupon_quota_lookup');
          const vnd = new Intl.NumberFormat(english ? 'en-US' : 'vi-VN', {
            style: 'currency',
            currency: 'VND',
            maximumFractionDigits: 0,
          });
          const quotaLines = couponRows.map((c) => {
            const left = Math.max(0, Number(c.usage_limit) - Number(c.used_count));
            return `• \`${c.code}\`: ${Number(c.discount_pct)}% (${reply('tối đa', 'max')} ${vnd.format(Number(c.max_discount_vnd))}/${reply('đêm', 'night')}) — ${reply('còn', 'remaining')} ${left}/${Number(c.usage_limit)}`;
          });
          extraBlocks.push(
            reply(
              `🎟️ **Lượt Mã Ưu Đãi Trực Tuyến Trong CSDL:**\n${quotaLines.join('\n')}`,
              `🎟️ **Live Coupon Quotas in Database:**\n${quotaLines.join('\n')}`,
            ),
          );
        } else if (slots.coupon_code) {
          liveToolsUsed.push('pg_coupon_quota_lookup');
          extraBlocks.push(
            reply(
              `🎟️ Mã \`${slots.coupon_code}\` hiện không nằm trong danh sách ưu đãi đang mở tại White Sand.`,
              `🎟️ Coupon \`${slots.coupon_code}\` is not currently active in White Sand promotions.`,
            ),
          );
        }
      } catch {
        // Ignore read-only DB errors
      }
    }

    // 3. Grounded RAG enrichment when regex didn't hit a specific handler
    if (isGreetingFallback && rag.citations.length > 0 && rag.citations[0].score >= 0.2 && liveToolsUsed.length === 0) {
      const top = rag.citations[0];
      response =
        `📚 **[${top.doc_id}] ${top.title}**\n• ${top.snippet}\n\n` +
        reply(
          '💡 *Gợi ý:* Trợ lý chỉ cung cấp thông tin tham khảo từ SOP khách sạn; đặt phòng thực tế được thực hiện tại `/book`.',
          '💡 *Note:* Guidance is grounded in verified White Sand SOP documents; reservations are finalized on `/book`.',
        );
      if (top.suggested_route && !suggestedAction) {
        suggestedAction = {
          label: reply(`Đi tới ${top.suggested_route}`, `Go to ${top.suggested_route}`),
          href: top.suggested_route,
        };
      }
    } else if (extraBlocks.length > 0) {
      if (isGreetingFallback || (slots.room_type_id != null && /phong|gia|room|price|rate|suite|studio|deluxe|superior|premium|executive|book/.test(normText))) {
        response =
          extraBlocks.join('\n\n') +
          '\n\n' +
          reply(
            '💡 *Lưu ý:* Tồn kho trên là số liệu thực từ CSDL cho ngày đã chọn (không giữ phòng qua chat). Vui lòng mở `/book` để xem giá chốt động kèm sàn biến phí 452.000 VND/đêm.',
            '💡 *Note:* Availability reflects live database counts for those dates (chat does not hold rooms). Open `/book` to generate an official dynamic quote.',
          );
      } else {
        response = `${baseline}\n\n${extraBlocks.join('\n\n')}`;
      }
    } else if (!suggestedAction && rag.citations[0]?.suggested_route && !isGreetingFallback) {
      suggestedAction = {
        label: reply(`Mở ${rag.citations[0].suggested_route}`, `Open ${rag.citations[0].suggested_route}`),
        href: rag.citations[0].suggested_route,
      };
    }

    return {
      response,
      citations: rag.citations.slice(0, 3),
      slots,
      suggested_action: suggestedAction,
      retriever: rag.retriever,
      live_tools_used: liveToolsUsed,
    };
  }
}
