# Public website on `whitesandhotel.dev`

This setup keeps the full Docker Compose app on a cloud VPS, so it continues
running when the development computer is off. It is a single-server academic
demo setup, not a high-availability hotel production service.

## Recommended hosting size and cost

Use a DigitalOcean Basic Droplet in Singapore with **2 vCPU, 4 GiB RAM, and 80
GiB SSD** as a low-traffic starting point. DigitalOcean currently lists that
size at **$24/month**. The 4 vCPU / 8 GiB size is **$48/month** if builds or
traffic need more headroom. Weekly Droplet backups are listed at 20% of the
server price, so about $4.80/month for the 4 GiB size; taxes or other add-ons
may change the final bill. The VM remains billed while it is powered off; delete
it to stop compute charges. [DigitalOcean Droplet pricing](https://www.digitalocean.com/pricing/droplets)

The server uses the Singapore region for a nearby Asia-Pacific location. Start
with 4 GiB for a small academic demo; choose 8 GiB if you want more headroom
during image builds and concurrent requests. The app includes PostgreSQL,
Redis, Kafka, a NestJS API, a FastAPI AI service, Next.js, Nginx, and Caddy.

## 1. Create the cloud server

In DigitalOcean, create a **Basic Droplet** with Ubuntu 24.04 LTS, Singapore,
2 vCPU / 4 GiB RAM, and its included public IPv4. Keep the server running; the
cloud VM is independent of the laptop.

Create a Cloud Firewall with inbound rules:

- TCP `22` (SSH) from your own current IP address only;
- TCP `80` and `443` from all IPv4 addresses;
- UDP `443` from all IPv4 addresses for optional HTTP/3.

Do not open `3000`, `5432`, `6379`, `8000`, or `9092` to the Internet. Use the
provider firewall for inbound filtering. Docker-published ports can bypass
Ubuntu UFW rules, so UFW alone is not a reliable boundary for this Compose
stack. [Docker firewall guidance](https://docs.docker.com/engine/network/packet-filtering-firewalls/)

Add your SSH public key during server creation. Keep the private key on your
computer and never paste it into chat.

## 2. Point the domain to the server

At the DNS provider currently managing `whitesandhotel.dev`, set:

| Type | Host | Value |
| --- | --- | --- |
| A | `@` | The Droplet public IPv4 |
| CNAME | `www` | `whitesandhotel.dev` |

Remove only conflicting A/AAAA/CNAME records for these website names. Preserve
MX/TXT records if you use email on this domain. Keep the website records
DNS-only; this setup does not require a DNS proxy. Do not add an AAAA record
unless the server has a working public IPv6 address.

Wait for both DNS names to resolve to the expected server before starting the
public profile. Caddy will obtain and renew HTTPS certificates for the apex and
`www` hostnames automatically.

## 3. Install Docker and fetch `main`

Connect to the VM over SSH, install Docker Engine and the Compose plugin using
the [official Ubuntu instructions](https://docs.docker.com/engine/install/ubuntu/),
and enable Docker at boot:

```bash
sudo systemctl enable --now docker
git clone https://github.com/silverfrag/hotelAI.git
cd hotelAI
git checkout main
```

## 4. Add production secrets on the VM

Create the production-only file and restrict its permissions:

```bash
cp .env.production.example .env.production
chmod 600 .env.production
openssl rand -hex 32
nano .env.production
```

Set `PUBLIC_DOMAIN=whitesandhotel.dev` and `CORS_ORIGINS=https://whitesandhotel.dev`.
Replace the database and JWT placeholders with unique secrets. Use the
`openssl` output for `JWT_SECRET`. Keep the database bind addresses at
`127.0.0.1`; `.env.production` is ignored by Git and must stay on the server.

## 5. Initialize the database and app

First start the data services and apply migrations:

```bash
docker compose --env-file .env.production -f docker-compose.yml -f compose.public.yml up -d postgres redis kafka ai_service
docker compose --env-file .env.production -f docker-compose.yml -f compose.public.yml run --rm db_migrations
docker compose --env-file .env.production -f docker-compose.yml -f compose.public.yml exec postgres psql -U hotel_admin -d hotel_db
```

At the `psql` prompt, create the restricted runtime login. Enter the same
password configured as `BACKEND_DB_PASSWORD` when `\password` prompts:

```sql
CREATE ROLE hotelai_app LOGIN IN ROLE hotelai_runtime;
\password hotelai_app
\q
```

Build and start the full site, TLS proxy, and APIs:

```bash
docker compose --env-file .env.production -f docker-compose.yml -f compose.public.yml --profile public up -d --build
docker compose --env-file .env.production -f docker-compose.yml -f compose.public.yml --profile public ps
```

Docker's restart policies bring the services back after a VM reboot. Check
`https://whitesandhotel.dev` and `https://www.whitesandhotel.dev` after Caddy
finishes issuing the certificates.

There is no default administrator account. Register your operator account, then
grant it admin role from the server:

```bash
docker compose --env-file .env.production -f docker-compose.yml -f compose.public.yml exec backend_core npm run user:set-role -- your-login-email admin
```

## 6. Backups and ongoing cost

Enable weekly provider backups if you want quick VM recovery. Also schedule
PostgreSQL logical dumps and copy them off the VM; a disk backup alone is not a
separate database backup. Retain at least several recent dumps and periodically
confirm one can be restored. Keep the `.env.production` secrets in a separate
secure location so the site can be rebuilt if the VM is lost.

The domain registration and VPS are separate bills. The registered domain does
not include a server. A single VPS removes the laptop as a dependency, but it
still has a single-server outage risk; it does not promise 100% uptime.
