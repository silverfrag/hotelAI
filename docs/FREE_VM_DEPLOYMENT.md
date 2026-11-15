# Public full-stack demo on a free VM

This deployment runs the existing Docker Compose stack on one Linux VM. It keeps
PostgreSQL, Redis, and Kafka bound to loopback, publishes only ports 80/443 via
Caddy, and serves HTTPS for a DuckDNS hostname.

## Free-tier limits

The suggested OCI Always Free shape is a demo target, not a production SLA. The
free account currently includes up to 2 OCPUs total for Ampere A1 compute, and
Oracle may reclaim compute instances it classifies as idle. Free capacity can
also be unavailable in a region. If the VM is reclaimed or the account cannot
allocate an instance, use another Linux VM; DuckDNS can still point the name to
it.

DuckDNS gives a free subdomain, not a separately owned top-level domain. The
suggested name is `hotelai.duckdns.org`; register it in DuckDNS and point it to
the VM's public IPv4 address. Create a cron updater if that address can change.

## 1. Create the VM and DNS name

1. Create an Ubuntu 24.04 ARM64 VM in the OCI Always Free allocation, if an
   eligible instance is available. Do not select paid shapes or paid add-ons.
2. In the VM network firewall/security list, allow inbound TCP `22`, `80`, and
   `443`; allow UDP `443` for HTTP/3. Do not open `3000`, `5432`, `6379`, `8000`,
   or `9092` to the internet.
3. Register `hotelai` at DuckDNS and point it to the VM public IPv4 address.
   Wait until DNS resolves to that address before starting Caddy.
4. Install Docker Engine with the Compose plugin using Docker's official Linux
   instructions. Connect over SSH and clone this repository.

## 2. Set production secrets

From the repository root on the VM:

```bash
git checkout feat/hotelai-ai-v1
cp .env.production.example .env.production
chmod 600 .env.production
openssl rand -hex 32
```

Edit `.env.production` on the VM. Replace all three `CHANGE_THIS_...` values
with unique secrets; use the output from `openssl rand -hex 32` for `JWT_SECRET`.
Keep `POSTGRES_BIND_ADDRESS`, `REDIS_BIND_ADDRESS`, and `KAFKA_BIND_ADDRESS`
set to `127.0.0.1`. Keep `.env.production` on the VM only; it is ignored by Git.
If choosing a different DuckDNS hostname, update both `PUBLIC_DOMAIN` and
`CORS_ORIGINS` to that exact hostname.

## 3. Start data services and apply migrations

```bash
docker compose --env-file .env.production -f docker-compose.yml -f compose.public.yml up -d postgres redis kafka ai_service
docker compose --env-file .env.production -f docker-compose.yml -f compose.public.yml run --rm db_migrations
```

The migration creates the unprivileged `hotelai_runtime` permission group. Create
the runtime login and set its password interactively, using the same value as
`BACKEND_DB_PASSWORD` in `.env.production`:

```bash
docker compose --env-file .env.production -f docker-compose.yml -f compose.public.yml exec postgres psql -U hotel_admin -d hotel_db
```

At the `psql` prompt:

```sql
CREATE ROLE hotelai_app LOGIN IN ROLE hotelai_runtime;
\password hotelai_app
\q
```

If `POSTGRES_USER` or `POSTGRES_DB` was customized, use those values in the
`psql` command instead.

## 4. Start the public app and TLS proxy

```bash
docker compose --env-file .env.production -f docker-compose.yml -f compose.public.yml --profile public up -d --build
docker compose --env-file .env.production -f docker-compose.yml -f compose.public.yml --profile public ps
```

Caddy obtains and renews the HTTPS certificate after DNS points to the VM and
ports 80/443 are reachable. Open `https://hotelai.duckdns.org`. Register the
first account through the public app, then promote only the intended operator
account to admin from the backend container:

```bash
docker compose --env-file .env.production -f docker-compose.yml -f compose.public.yml exec backend_core npm run user:set-role -- admin@example.com admin
```

Replace `admin@example.com` with the account you registered. No default admin
password is provided.

## 5. Operations

```bash
docker compose --env-file .env.production -f docker-compose.yml -f compose.public.yml --profile public logs --tail=100
docker compose --env-file .env.production -f docker-compose.yml -f compose.public.yml --profile public pull
```

Back up PostgreSQL before migrations or redeploys. The named Docker volumes are
on the VM's boot storage; they are not an off-site backup. A free VM may sleep,
be reclaimed, lose its public IP, or become unavailable. Keep a copy of the
database backup outside the VM if demo records matter.
