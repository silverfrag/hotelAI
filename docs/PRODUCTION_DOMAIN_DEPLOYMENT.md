# Hướng Dẫn Triển Khai Production & Tên Miền Thương Hiệu (Branded Custom Domain)

Tài liệu này hướng dẫn đưa hệ thống **Hotel AI / White Sand Boutique Hotel** lên môi trường Production với tên miền thương hiệu riêng (Custom Domain), hạ tầng mạng ổn định, chứng chỉ HTTPS tự động và cơ chế bảo mật cấp doanh nghiệp.

---

## 1. Định Vị Thương Hiệu & Yêu Cầu Production

Hệ thống sở hữu giao diện khách hàng (Public Booking) và bảng điều hành (Admin PMS / Revenue Simulator) được trau chuốt hoàn chỉnh. Việc sử dụng tên miền phụ miễn phí (như `*.duckdns.org`, `*.ngrok.io`) hay máy chủ miễn phí không cam kết (OCI Always Free dễ bị thu hồi do idle) sẽ làm giảm uy tín thương hiệu đối với khách sạn, đối tác và người dùng.

### Tiêu chuẩn một tên miền chuẩn chỉ:
- **Tên miền riêng**: Ví dụ `whitesandhotel.vn`, `whitesandhotel.com`, `hotelai.vn`, hoặc subdomain quản trị `app.hotelai.vn`, `booking.whitesandhotel.vn`.
- **Độ trễ thấp tại Việt Nam**: Khách hàng đặt phòng tại Việt Nam yêu cầu thời gian phản hồi (TTFB) dưới 100ms.
- **Chứng chỉ TLS/HTTPS đạt chuẩn A+**: Tự động cấp phát bởi Let's Encrypt / ZeroSSL hoặc Cloudflare Edge SSL.
- **Thẻ xem trước thương hiệu (OpenGraph / Social Card)**: Khi gửi link qua Zalo, Messenger, Facebook, LinkedIn, hệ thống tự động hiển thị ảnh bìa khách sạn, tiêu đề và mô tả chuẩn SEO.

---

## 2. Chuẩn Bị Tên Miền & DNS Cloudflare

### Bước 2.1: Đăng ký tên miền
- **Tên miền nội địa (`.vn`, `.com.vn`)**: Đăng ký qua các nhà đăng ký được VNNIC cấp phép (iNET, Mắt Bão, PA Việt Nam). Đây là lựa chọn tối ưu cho khách sạn tại Việt Nam để khẳng định sự chuyên nghiệp và bảo hộ thương hiệu.
- **Tên miền quốc tế (`.com`, `.ai`, `.io`)**: Đăng ký qua Cloudflare Registrar hoặc Namecheap.

### Bước 2.2: Trỏ Nameserver về Cloudflare (Khuyên Dùng)
Cloudflare cung cấp giải pháp CDN toàn cầu với máy chủ PoP tại Hà Nội và TP.HCM, tự động ẩn IP máy chủ gốc, lọc tấn công DDoS Layer 7 và tối ưu nén tài nguyên.

1. Thêm domain vào tài khoản Cloudflare (gói Miễn phí là đủ cho nhu cầu vận hành).
2. Cập nhật Nameserver tại nhà đăng ký tên miền theo hướng dẫn của Cloudflare.
3. Trong bảng điều khiển **DNS Records** của Cloudflare, tạo các bản ghi sau:
   - **Bản ghi A (Apex domain)**:
     - `Type`: `A`
     - `Name`: `@` (hoặc tên miền chính)
     - `IPv4 address`: `<IP_PUBLIC_CỦA_VPS>`
     - `Proxy status`: **Proxied** (Cờ vàng)
   - **Bản ghi CNAME (www)**:
     - `Type`: `CNAME`
     - `Name`: `www`
     - `Target`: `@`
     - `Proxy status`: **Proxied** (Cờ vàng)
4. Trong mục **SSL/TLS**:
   - Chọn chế độ **Full (Strict)** (nếu dùng Caddy có chứng chỉ hợp lệ) hoặc **Full**.
   - Bật **Always Use HTTPS** để tự động chuyển hướng mọi truy cập HTTP sang HTTPS.
5. (Tuỳ chọn) Trong mục **Rules → Redirect Rules**:
   - Tạo quy tắc chuyển hướng `www.yourdomain.com` về `https://yourdomain.com` (chuẩn hóa tên miền gốc).

---

## 3. Lựa Chọn & Thiết Lập Máy Chủ (Production Cloud VPS)

Để hệ thống hoạt động 24/7 ổn định, khuyến nghị sử dụng VPS từ 2 vCPU và 4GB RAM (đảm bảo đủ tài nguyên cho PostgreSQL, Redis, Kafka, NestJS backend, FastAPI AI service và Next.js App Router).

### Nhà cung cấp đề xuất:
- **Việt Nam (Ping 5–15ms, thanh toán nội địa, hóa đơn VAT)**:
  - **Vietnix**: Gói Cloud VPS Pro hoặc NVMe VPS.
  - **Bizfly Cloud**: Gói Cloud Server tiêu chuẩn.
  - **VNPT Cloud / Viettel IDC**: Hạ tầng cấp trung tâm dữ liệu nhà nước.
- **Quốc tế (Chi phí rẻ, phần cứng cực mạnh)**:
  - **Hetzner Cloud**: Gói CPX21 (3 vCPU AMD, 4GB RAM) hoặc CX32 (~€5 - €7/tháng).
  - **DigitalOcean / Vultr**: Vị trí Datacenter Singapore (ping về Việt Nam khoảng 25-35ms).

### Cấu hình tường lửa máy chủ (UFW):
Trên VPS Linux (Ubuntu 22.04 / 24.04 LTS), chạy lệnh:

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp      # Cổng SSH
sudo ufw allow 80/tcp      # HTTP (Caddy xác thực Let's Encrypt)
sudo ufw allow 443/tcp     # HTTPS
sudo ufw allow 443/udp     # HTTP/3 QUIC
sudo ufw enable
```

> [!IMPORTANT]
> **Tuyệt đối không mở các cổng nội bộ**: `3000`, `5432` (PostgreSQL), `6379` (Redis), `8000` (AI Service), `9092` (Kafka) ra internet. Tất cả các dịch vụ này đã được cấu hình chỉ lắng nghe trên mạng Docker riêng (`hotel_network`) hoặc `127.0.0.1`.

---

## 4. Các Bước Triển Khai Hệ Thống Trên Server

### Bước 4.1: Cài đặt Docker & Docker Compose
Cài đặt Docker Engine bản mới nhất theo hướng dẫn chính thức:

```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
newgrp docker
docker compose version
```

### Bước 4.2: Tải mã nguồn từ nhánh `main`
```bash
git clone https://github.com/nhathung121225/hotelAI.git
cd hotelAI
git checkout main
```

### Bước 4.3: Thiết lập biến môi trường Production
Tạo file `.env.production` từ bản mẫu:

```bash
cp .env.production.example .env.production
chmod 600 .env.production
```

Tạo các chuỗi bảo mật ngẫu nhiên:
```bash
openssl rand -hex 32
```

Chỉnh sửa file `.env.production`:
```bash
nano .env.production
```

Điền các thông tin chuẩn:
```env
# Tên miền thương hiệu của bạn
PUBLIC_DOMAIN=yourdomain.com
PUBLIC_BIND_ADDRESS=0.0.0.0

NGINX_BIND_ADDRESS=127.0.0.1
NGINX_PORT=8080

DEPLOYMENT_MODE=production
COOKIE_SECURE=true
CORS_ORIGINS=https://yourdomain.com
HOTEL_TIMEZONE=Asia/Bangkok

# Mật khẩu PostgreSQL quản trị
POSTGRES_PASSWORD=<MẬT_KHẨU_ADMIN_RANDOM>

# Thông tin tài khoản ứng dụng runtime
BACKEND_DB_USER=hotelai_app
BACKEND_DB_PASSWORD=<MẬT_KHẨU_RUNTIME_RANDOM>

# JWT Secret từ lệnh openssl rand -hex 32
JWT_SECRET=<CHUỖI_HEX_32_BYTES>

# Địa chỉ IP nội bộ an toàn
POSTGRES_BIND_ADDRESS=127.0.0.1
REDIS_BIND_ADDRESS=127.0.0.1
KAFKA_BIND_ADDRESS=127.0.0.1
```

### Bước 4.4: Khởi động cơ sở dữ liệu & Chạy Migration
```bash
# 1. Khởi động hạ tầng cơ bản
docker compose --env-file .env.production -f docker-compose.yml -f compose.public.yml up -d postgres redis kafka ai_service

# 2. Áp dụng migration lược đồ DB
docker compose --env-file .env.production -f docker-compose.yml -f compose.public.yml run --rm db_migrations

# 3. Tạo user runtime unprivileged hotelai_app
docker compose --env-file .env.production -f docker-compose.yml -f compose.public.yml exec postgres psql -U hotel_admin -d hotel_db
```

Tại dấu nhắc `psql`, thực thi lệnh SQL:
```sql
CREATE ROLE hotelai_app LOGIN IN ROLE hotelai_runtime;
\password hotelai_app
```
*(Nhập mật khẩu giống hệt giá trị `BACKEND_DB_PASSWORD` trong file `.env.production`)*
Gõ `\q` để thoát.

### Bước 4.5: Khởi chạy toàn bộ hệ thống & Caddy HTTPS
```bash
docker compose --env-file .env.production -f docker-compose.yml -f compose.public.yml --profile public up -d --build
```

Kiểm tra trạng thái các container:
```bash
docker compose --env-file .env.production -f docker-compose.yml -f compose.public.yml --profile public ps
```

Sau vài giây, Caddy sẽ tự động bắt tay với Let's Encrypt / ZeroSSL để cấp chứng chỉ TLS cho `yourdomain.com`.

---

## 5. Khởi Tạo Tài Khoản Quản Trị Viên (Admin) Đầu Tiên

1. Truy cập trình duyệt tại `https://yourdomain.com/register`.
2. Đăng ký tài khoản dành riêng cho người vận hành (ví dụ: `ceo@whitesandhotel.vn` hoặc `admin@hotelai.vn`).
3. Quay lại terminal trên VPS và cấp quyền `admin` trực tiếp qua container backend:

```bash
docker compose --env-file .env.production -f docker-compose.yml -f compose.public.yml exec backend_core npm run user:set-role -- ceo@whitesandhotel.vn admin
```

4. Đăng nhập vào `https://yourdomain.com/login` và truy cập trang quản trị tại `https://yourdomain.com/admin`.

---

## 6. Kiểm Tra Nhận Diện Thương Hiệu (Brand Validation)

- **Kiểm tra HTTPS & Security Headers**: Truy cập [SSL Labs](https://www.ssllabs.com/ssltest/) để kiểm tra đánh giá bảo mật (đạt chuẩn A/A+).
- **Kiểm tra thẻ OpenGraph Social Preview**:
  - Dùng công cụ [Facebook Sharing Debugger](https://developers.facebook.com/tools/debug/) hoặc [OpenGraph.xyz](https://www.opengraph.xyz/).
  - Nhập `https://yourdomain.com` để xem trước hình ảnh khách sạn White Sand Boutique Hotel, tiêu đề và mô tả khi gửi link trên Zalo/Facebook.
- **Kiểm tra luồng nghiệp vụ**:
  - Khách hàng xem 6 hạng phòng, đặt phòng, áp coupon (`WHITESAND10`, `SUMMER15`).
  - Quản trị viên mở Sơ đồ phòng trực quan (Tape Chart `/admin/tape-chart`), điều phối dọn buồng (`/admin/housekeeping`) và theo dõi định giá AI (`/admin/revenue-simulator`).

---

## 7. Bảo Trì & Sao Lưu Dữ Liệu Tự Động

Tạo một cronjob sao lưu cơ sở dữ liệu hàng ngày vào lúc 02:00 sáng trên VPS:

```bash
crontab -e
```

Thêm dòng sau:
```bash
0 2 * * * docker compose -f /home/$USER/hotelAI/docker-compose.yml --env-file /home/$USER/hotelAI/.env.production exec -T postgres pg_dump -U hotel_admin hotel_db | gzip > /home/$USER/backups/hotel_db_$(date +\%F).sql.gz
```
*(Đảm bảo thư mục `/home/$USER/backups` đã được tạo trước)*.
