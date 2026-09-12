.PHONY: up build down logs ps test test-infrastructure test-ai-outage test-all test-ai

up:
	docker compose --env-file .env up -d

build:
	docker compose --env-file .env up -d --build

down:
	docker compose down

logs:
	docker compose logs -f

ps:
	docker compose ps

test:
	cd 3_backend_core && npm run test:suite

test-infrastructure:
	cd 3_backend_core && npm run test:infrastructure-suite

test-ai-outage:
	cd 3_backend_core && npm run test:ai-outage-suite

test-all:
	cd 3_backend_core && npm run test:all

test-ai:
	docker build --target test -t hotelai-ai-test:local 2_ai_pricing_service
	docker run --rm hotelai-ai-test:local
