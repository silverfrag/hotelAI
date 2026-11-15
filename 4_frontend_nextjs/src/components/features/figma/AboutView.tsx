"use client";

import Link from "next/link";

const HERO_BG = "/images/whitesand/hero/hotel-exterior.jpg";

const VALUES = [
  {
    num: "01",
    title: "6 Hạng Phòng · 54 Phòng (3F–13F)",
    body: "Từ Superior Room (30 m²) đến Studio Apartment (65 m²), mỗi hạng phòng có hình ảnh, sức chứa và mức giá niêm yết rõ ràng cùng giá trần kê khai.",
  },
  {
    num: "02",
    title: "Kiểm Tra Tồn Phòng Thời Gian Thực",
    body: "Tồn kho 54 phòng vật lý được khóa chồng lấn theo từng đêm lưu trú. Khi xác nhận hoặc hủy đặt phòng, số phòng trống cập nhật ngay lập tức.",
  },
  {
    num: "03",
    title: "Định Giá Theo Ngữ Cảnh Minh Bạch",
    body: "Mọi báo giá đều tách rõ 4 nguồn: mô hình ML tham chiếu lịch sử (A), tồn kho thực tế của khách sạn (B), giả định kịch bản thị trường (C) và quy tắc ưu đãi / giá trần (D).",
  },
  {
    num: "04",
    title: "Vị Trí Thuận Tiện Tại Sơn Trà",
    body: "Tọa lạc tại 89-91 Võ Văn Kiệt, Sơn Trà, TP. Đà Nẵng — trục đường kết nối trực tiếp cầu Rồng, trung tâm thành phố và bãi biển Mỹ Khê.",
  },
];

const TIMELINE = [
  { year: "1F", event: "Sảnh lễ tân 24/7, khu vực đón tiếp Concierge và hỗ trợ thủ tục nhận/trả phòng." },
  { year: "2F", event: "Hồ bơi thư giãn và phòng Gym dành riêng cho khách lưu trú tại White Sand." },
  { year: "3F – 6F", event: "12 phòng Superior Room (301–406) và 12 phòng Deluxe Room (501–606)." },
  { year: "7F – 10F", event: "8 phòng Premium Room (701–804) và 8 phòng Executive Room (901–1004)." },
  { year: "11F – 13F", event: "8 phòng Suite (1101–1204) và 6 căn Studio Apartment rộng 65 m² (1301–1306)." },
  { year: "14F – 15F", event: "Nhà hàng Sky View tầng 14 phục vụ buffet sáng & ẩm thực biển, cùng khu vực White Sand Spa tầng 15." },
];

const HIGHLIGHTS = [
  {
    name: "Lễ Tân & Hỗ Trợ Lưu Trú",
    role: "1F · Hotline +84 2363 575 799",
    img: "/images/whitesand/facilities/concierge-reception.jpg",
    quote: "Tiếp nhận check-in từ 14:00, hỗ trợ hành lý, tư vấn dịch vụ Đà Nẵng và xử lý yêu cầu đặt phòng trực tuyến.",
  },
  {
    name: "Hồ Bơi & Phòng Gym Tầng 2",
    role: "2F · Wellness & Fitness",
    img: "/images/whitesand/facilities/pool-gym-2f.jpg",
    quote: "Không gian rèn luyện sức khỏe và thư giãn mỗi ngày ngay trong tòa nhà khách sạn 15 tầng.",
  },
  {
    name: "Nhà Hàng Sky View Tầng 14",
    role: "14F · Ẩm thực hướng biển",
    img: "/images/whitesand/facilities/restaurant-14f.jpg",
    quote: "Phục vụ bữa sáng, cà phê và tiệc tối hướng nhìn toàn cảnh thành phố Đà Nẵng và biển Mỹ Khê.",
  },
];

function ArrowRight() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 6.5h9M8 3l3.5 3.5L8 10" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function AboutView() {
  return (
    <>
      {/* ── HERO ── */}
      <section className="relative h-[70vh] min-h-[500px] flex items-end overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url(${HERO_BG})` }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[rgba(0,0,0,0.92)] via-[rgba(0,0,0,0.3)] to-[rgba(0,0,0,0.15)]" />
        <div className="absolute inset-0 bg-gradient-to-r from-[rgba(0,0,0,0.55)] to-transparent" />

        <div className="relative z-10 px-5 md:px-10 lg:px-16 pb-14 max-w-4xl">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-px w-8" style={{ background: "var(--gold)" }} />
            <span className="text-[9px] tracking-[0.28em] uppercase" style={{ color: "var(--gold)" }}>
              White Sand Boutique Hotel · Đà Nẵng
            </span>
          </div>
          <h1 className="font-display text-5xl md:text-6xl lg:text-7xl text-white leading-[0.92] mb-6">
            Không Gian<br />
            <em className="not-italic" style={{ color: "var(--gold)" }}>Bên Biển Mỹ Khê</em>
          </h1>
          <p className="text-sm text-white/65 max-w-lg leading-relaxed">
            Khách sạn 15 tầng tại 89-91 Võ Văn Kiệt, Quận Sơn Trà, TP. Đà Nẵng với 54 phòng thuộc 6 hạng phòng kết hợp nền tảng đặt phòng và mô phỏng doanh thu HotelAI.
          </p>
        </div>
      </section>

      {/* ── MISSION & CONTACT ── */}
      <section
        className="px-5 md:px-10 lg:px-16 py-24"
        style={{ borderTop: "1px solid var(--border)" }}
      >
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 lg:gap-28 items-start">
          <div>
            <div className="flex items-center gap-3 mb-6">
              <div className="h-px w-8" style={{ background: "var(--gold)" }} />
              <span className="text-[9px] tracking-[0.28em] uppercase" style={{ color: "var(--gold)" }}>
                Hồ Sơ Khách Sạn
              </span>
            </div>
            <h2 className="font-display text-4xl md:text-5xl leading-[1.0] mb-8" style={{ color: "var(--fg)" }}>
              White Sand Boutique Hotel<br />Đà Nẵng.
            </h2>
            <div className="space-y-5 text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
              <p>
                Tọa lạc trên trục đường du lịch Võ Văn Kiệt kết nối thẳng ra bãi biển Mỹ Khê, White Sand Boutique Hotel sở hữu kiến trúc 15 tầng gọn gàng, tinh tế với 54 phòng lưu trú phân bổ từ tầng 3 đến tầng 13.
              </p>
              <p>
                Hệ thống đặt phòng HotelAI được kết nối đồng bộ cho phép kiểm tra tình trạng phòng trống theo thời gian thực, áp dụng các chương trình ưu đãi theo mùa/hạng phòng và giải thích rõ từng yếu tố cấu thành giá trước khi khách xác nhận.
              </p>
              <div className="p-5 space-y-2 border text-xs" style={{ borderColor: "var(--border-gold)", background: "var(--bg2)", color: "var(--fg2)" }}>
                <div><strong>Địa chỉ:</strong> 89-91 Võ Văn Kiệt, Phường Phước Mỹ, Quận Sơn Trà, TP. Đà Nẵng</div>
                <div><strong>Điện thoại:</strong> +84 2363 575 799</div>
                <div><strong>Email đặt phòng & kinh doanh:</strong> sm@whitesandhotel.com.vn</div>
              </div>
            </div>
          </div>

          <div>
            <div
              className="aspect-[4/5] overflow-hidden mb-5"
              style={{ borderRadius: "9999px 9999px 6px 6px" }}
            >
              <img
                src="/images/whitesand/hero/ocean-suite-view.jpg"
                alt="Không gian hướng biển tại White Sand Boutique Hotel Đà Nẵng"
                className="w-full h-full object-cover"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              {[
                { v: "15 Tầng", l: "Tiện ích đồng bộ 1F–15F" },
                { v: "54 Phòng", l: "Quản lý tồn kho thực tế" },
                { v: "6 Hạng", l: "Superior → Studio Apartment" },
                { v: "24/7", l: "Hỗ trợ lễ tân & báo giá" },
              ].map((s) => (
                <div key={s.l} className="p-4" style={{ border: "1px solid var(--border-gold)" }}>
                  <div className="font-display text-2xl" style={{ color: "var(--gold)" }}>{s.v}</div>
                  <div className="text-[10px] uppercase tracking-wider mt-1" style={{ color: "var(--muted)" }}>{s.l}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── VALUES ── */}
      <section
        className="py-24"
        style={{ background: "var(--bg2)", borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)" }}
      >
        <div className="px-5 md:px-10 lg:px-16">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-px w-8" style={{ background: "var(--gold)" }} />
            <span className="text-[9px] tracking-[0.28em] uppercase" style={{ color: "var(--gold)" }}>
              Nền Tảng Vận Hành
            </span>
          </div>
          <h2 className="font-display text-4xl md:text-5xl leading-[1.0] mb-14" style={{ color: "var(--fg)" }}>
            Bốn trụ cột<br />của White Sand &amp; HotelAI.
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-px" style={{ background: "var(--border)" }}>
            {VALUES.map((v) => (
              <div
                key={v.num}
                className="p-8 transition-all duration-300 group"
                style={{ background: "var(--bg2)" }}
                onMouseEnter={(e) =>
                  ((e.currentTarget as HTMLElement).style.background = "var(--card-hover)")
                }
                onMouseLeave={(e) =>
                  ((e.currentTarget as HTMLElement).style.background = "var(--bg2)")
                }
              >
                <div className="font-display text-5xl mb-5 leading-none" style={{ color: "rgba(196,153,90,0.16)" }}>
                  {v.num}
                </div>
                <h3 className="font-display text-xl mb-4" style={{ color: "var(--fg)" }}>
                  {v.title}
                </h3>
                <p className="text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
                  {v.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FLOOR DIRECTORY TIMELINE ── */}
      <section className="px-5 md:px-10 lg:px-16 py-24">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-px w-8" style={{ background: "var(--gold)" }} />
          <span className="text-[9px] tracking-[0.28em] uppercase" style={{ color: "var(--gold)" }}>
            Cấu Trúc Tòa Nhà
          </span>
        </div>
        <h2 className="font-display text-4xl md:text-5xl leading-[1.0] mb-14" style={{ color: "var(--fg)" }}>
          Phân bổ không gian từ 1F đến 15F
        </h2>

        <div className="relative">
          <div
            className="absolute left-[110px] md:left-[140px] top-0 bottom-0 w-px hidden sm:block"
            style={{ background: "var(--border)" }}
          />
          <div className="space-y-0">
            {TIMELINE.map((t, i) => (
              <div key={t.year} className="flex items-start gap-8 sm:gap-16 py-7" style={{ borderBottom: i < TIMELINE.length - 1 ? "1px solid var(--border)" : "none" }}>
                <div
                  className="shrink-0 font-display text-2xl w-[110px] md:w-[140px] text-right pr-8 relative"
                  style={{ color: "var(--gold)" }}
                >
                  {t.year}
                  <div
                    className="absolute right-0 top-3 w-2 h-2 rounded-full translate-x-1 hidden sm:block"
                    style={{ background: "var(--gold)" }}
                  />
                </div>
                <p className="text-sm leading-relaxed pt-1" style={{ color: "var(--muted)" }}>
                  {t.event}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── HIGHLIGHTS ── */}
      <section
        className="py-24"
        style={{ background: "var(--bg2)", borderTop: "1px solid var(--border)" }}
      >
        <div className="px-5 md:px-10 lg:px-16">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-px w-8" style={{ background: "var(--gold)" }} />
            <span className="text-[9px] tracking-[0.28em] uppercase" style={{ color: "var(--gold)" }}>
              Tiện Ích Nội Khu
            </span>
          </div>
          <h2 className="font-display text-4xl md:text-5xl leading-[1.0] mb-14" style={{ color: "var(--fg)" }}>
            Dịch vụ đồng bộ<br />trong từng tầng
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {HIGHLIGHTS.map((item) => (
              <div key={item.name} className="group">
                <div className="overflow-hidden mb-6" style={{ borderRadius: "9999px 9999px 6px 6px" }}>
                  <div className="aspect-[3/4]">
                    <img
                      src={item.img}
                      alt={item.name}
                      className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-[1.04]"
                    />
                  </div>
                </div>
                <div className="text-[9px] tracking-[0.2em] uppercase mb-1" style={{ color: "var(--gold)" }}>
                  {item.role}
                </div>
                <h3 className="font-display text-xl mb-3" style={{ color: "var(--fg)" }}>{item.name}</h3>
                <p className="text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
                  {item.quote}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="px-5 md:px-10 lg:px-16 py-24 text-center">
        <div className="max-w-2xl mx-auto">
          <div className="font-display text-7xl leading-none mb-2 select-none" style={{ color: "rgba(196,153,90,0.08)" }}>&ldquo;</div>
          <blockquote className="font-display text-2xl md:text-3xl italic leading-snug -mt-5 mb-10" style={{ color: "var(--fg)" }}>
            Chọn đúng hạng phòng tại White Sand Đà Nẵng, xem rõ bảng giá và xác nhận chỉ trong vài bước.
          </blockquote>
          <div className="text-[9px] tracking-[0.2em] uppercase mb-10" style={{ color: "var(--dim)" }}>
            — White Sand Boutique Hotel · 89-91 Võ Văn Kiệt, Sơn Trà, Đà Nẵng
          </div>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <Link
              href="/rooms"
              className="inline-flex items-center gap-2 text-[10px] tracking-[0.18em] uppercase px-8 py-4 border transition-all duration-300"
              style={{ borderColor: "var(--gold)", color: "var(--gold)" }}
            >
              Xem 6 Hạng Phòng
            </Link>
            <Link
              href="/book"
              className="inline-flex items-center gap-2 text-[10px] tracking-[0.18em] uppercase px-10 py-4 transition-all duration-300"
              style={{ background: "var(--gold)", color: "var(--bg)" }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "var(--gold-hi)")}
              onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "var(--gold)")}
            >
              Đặt Phòng Ngay <ArrowRight />
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
