"""
Aurum Hotel AI - Mock Data Generator
Populates rich historical pricing quotes, exposures, and booking acceptance events
across all 8 luxury room types to satisfy conversion challenger readiness gates.
"""

from __future__ import annotations

import argparse
import math
from pathlib import Path
import random
import sys
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "2_ai_pricing_service"))
from app.core.vietnam_calendar import calculate_vietnam_demand_score

try:
    import psycopg2
    from psycopg2.extras import execute_batch
except ImportError:
    print("psycopg2 is required. Install with: pip install psycopg2-binary")
    sys.exit(1)


def is_weekend_stay(check_in: datetime, stay_nights: int) -> bool:
    for offset in range(stay_nights):
        day = (check_in + timedelta(days=offset)).weekday()
        if day in (4, 5, 6):  # Friday, Saturday, Sunday nights
            return True
    return False


def generate_mock_dataset(
    *,
    host: str = "localhost",
    port: int = 5432,
    user: str = "hotel_admin",
    password: str = "secretpassword",
    dbname: str = "hotel_db",
    total_quotes: int = 2500,
    seed: int = 42,
) -> None:
    random.seed(seed)
    print(f"Connecting to database {dbname} at {host}:{port} as {user}...")

    conn = psycopg2.connect(
        host=host,
        port=port,
        user=user,
        password=password,
        dbname=dbname,
    )
    conn.autocommit = False
    cursor = conn.cursor()

    try:
        # 1. Fetch available room types and physical rooms
        cursor.execute(
            "SELECT type_id, name, base_price, capacity FROM room_types ORDER BY type_id;"
        )
        room_types = cursor.fetchall()
        if not room_types:
            raise RuntimeError("No room types found in database. Run seed.sql first.")
        print(f"Found {len(room_types)} room types.")

        cursor.execute(
            "SELECT room_id, type_id, room_number FROM rooms WHERE current_status <> 'Maintenance';"
        )
        all_rooms = cursor.fetchall()
        rooms_by_type: dict[int, list[int]] = {}
        for r_id, t_id, _ in all_rooms:
            rooms_by_type.setdefault(t_id, []).append(r_id)

        # 2. Ensure a demo customer exists for bookings
        cursor.execute("SELECT customer_id FROM customers LIMIT 1;")
        customer_row = cursor.fetchone()
        if customer_row:
            customer_id = customer_row[0]
        else:
            customer_id = str(uuid.uuid4())
            cursor.execute(
                """
                INSERT INTO customers (customer_id, full_name, email, phone, nationality)
                VALUES (%s, 'Aurum Guest', 'guest@aurum.ai', '0900000000', 'VN')
                ON CONFLICT (customer_id) DO NOTHING;
                """,
                (customer_id,),
            )

        # 3. Clean up any existing generated mock quotes to allow clean idempotency
        cursor.execute("SET hotelai.allow_quote_event_cleanup = 'on';")
        cursor.execute("""
            CREATE TEMP TABLE temp_mock_bookings ON COMMIT DROP AS
            SELECT booking_id FROM pricing_quotes
            WHERE ai_model_version = 'random_forest_v2_mock' AND booking_id IS NOT NULL;
        """)
        cursor.execute("""
            DELETE FROM pricing_quote_events
            WHERE quote_id IN (
                SELECT quote_id FROM pricing_quotes WHERE ai_model_version = 'random_forest_v2_mock'
            );
        """)
        cursor.execute(
            "DELETE FROM pricing_quotes WHERE ai_model_version = 'random_forest_v2_mock';"
        )
        deleted_count = cursor.rowcount
        cursor.execute("""
            DELETE FROM bookings
            WHERE booking_id IN (SELECT booking_id FROM temp_mock_bookings);
        """)
        if deleted_count:
            print(f"Cleared {deleted_count} previous mock quotes.")

        print(f"Generating {total_quotes} historical quotes over a 60-day window...")
        # Window: 75 days ago to 15 days ago (so all historical quotes have matured beyond the 15-minute expiry)
        now = datetime.now(UTC)
        start_date = now - timedelta(days=75)

        quotes_data: list[tuple[Any, ...]] = []
        events_data: list[tuple[Any, ...]] = []
        bookings_data: list[tuple[Any, ...]] = []

        accepted_count = 0
        rejected_count = 0
        expired_count = 0

        for i in range(total_quotes):
            quote_id = str(uuid.uuid4())
            t_id, t_name, base_price, capacity = random.choice(room_types)
            base_price = float(base_price)
            physical_room_ids = rooms_by_type.get(t_id, [1])
            sellable_rooms = len(physical_room_ids)

            # Random exposure timestamp within historical window
            seconds_offset = random.uniform(0, 60 * 86400)
            exposure_time = start_date + timedelta(seconds=seconds_offset)
            expires_at = exposure_time + timedelta(minutes=15)

            # Stay context
            lead_time = random.randint(1, 45)
            check_in = (exposure_time + timedelta(days=lead_time)).date()
            stay_nights = random.choices([1, 2, 3, 4, 5, 7], weights=[25, 35, 20, 10, 7, 3])[0]
            check_out = check_in + timedelta(days=stay_nights)
            is_weekend = is_weekend_stay(datetime.combine(check_in, datetime.min.time()), stay_nights)
            guest_count = random.randint(1, capacity)
            special_requests = random.choices([0, 1, 2], weights=[70, 25, 5])[0]

            # Vietnam Seasonality & Holiday Demand Analysis
            demand_info = calculate_vietnam_demand_score(check_in, stay_nights)
            has_vietnam_holiday = bool(demand_info["has_holiday"])
            season_mult = float(demand_info["season_multiplier"])

            # Inventory snapshot reflecting real Vietnam resort occupancy trends
            base_occ_mean = 0.42 * season_mult + (0.22 if has_vietnam_holiday else 0.0)
            target_booked = int(round(sellable_rooms * min(0.95, max(0.05, random.gauss(base_occ_mean, 0.12)))))
            booked_rooms = min(sellable_rooms, max(0, target_booked))
            if booked_rooms >= sellable_rooms and sellable_rooms > 1:
                booked_rooms = sellable_rooms - 1
            rooms_available = sellable_rooms - booked_rooms
            occupancy_ratio = round(booked_rooms / sellable_rooms, 6)

            # AI Multiplier & Pricing with Vietnam market dynamics
            mult_mean = (
                1.00
                + (0.12 if is_weekend else 0.0)
                + (0.18 if has_vietnam_holiday else 0.0)
                + (0.10 if season_mult > 1.15 else 0.0)
                - (0.08 if season_mult < 0.90 else 0.0)
                - (0.04 if lead_time > 20 else 0.0)
            )
            ai_multiplier = round(max(0.80, min(1.60, random.gauss(mult_mean, 0.10))), 3)
            nightly_price = round((base_price * ai_multiplier) / 1000.0) * 1000.0
            total_price = nightly_price * stay_nights
            offered_price_ratio = nightly_price / base_price

            # Conversion probability modeling centered near 50% for balanced classification
            # Customers are more accepting of premium pricing during major Vietnam holidays
            z = (
                0.35
                - 5.5 * (offered_price_ratio - 1.0)
                - 0.025 * (lead_time - 14)
                + (0.45 if is_weekend else -0.25)
                + (0.35 if has_vietnam_holiday else 0.0)
                + (0.20 if season_mult > 1.15 else -0.10)
                - 0.50 * (occupancy_ratio - 0.35)
            )
            if t_id in (7, 8):  # Exclusive villas / penthouses
                z -= 0.35
            elif t_id in (1, 3):  # Standard & twin
                z += 0.35

            prob = 1.0 / (1.0 + math.exp(-z))
            prob = max(0.05, min(0.95, prob))

            is_accepted = random.random() < prob
            booking_id = None
            accepted_at = None

            session_id = str(uuid.uuid4())
            search_id = str(uuid.uuid4())

            # Quote exposed event
            exposed_event_id = str(uuid.uuid4())
            events_data.append((
                exposed_event_id,
                quote_id,
                "quote.exposed.v1",
                exposure_time + timedelta(seconds=2),
                "web",
                session_id,
                search_id,
                '{"ui": "aurum-v2"}'
            ))

            if is_accepted:
                accepted_count += 1
                booking_id = str(uuid.uuid4())
                accepted_at = exposure_time + timedelta(seconds=random.randint(45, 600))

                bookings_data.append((
                    booking_id,
                    customer_id,
                    exposure_time,
                    check_in,
                    check_out,
                    guest_count,
                    "Confirmed",
                ))
            else:
                # Discarded quote: either explicit reject or timeout
                if random.random() < 0.45:
                    rejected_count += 1
                    rejected_at = exposure_time + timedelta(seconds=random.randint(20, 300))
                    events_data.append((
                        str(uuid.uuid4()),
                        quote_id,
                        "quote.rejected.v1",
                        rejected_at,
                        "web",
                        session_id,
                        search_id,
                        '{"reason": "price_review"}'
                    ))
                else:
                    expired_count += 1

            quotes_data.append((
                quote_id,
                customer_id,
                booking_id,
                t_id,
                t_name,
                capacity,
                check_in,
                check_out,
                guest_count,
                special_requests,
                lead_time,
                is_weekend,
                rooms_available,
                base_price,
                ai_multiplier,
                nightly_price,
                total_price,
                "VND",
                "ai",
                1,
                "random_forest_v2_mock",
                "dc2e163f5cd9b29d",
                "2.0.0",
                exposure_time,
                expires_at,
                accepted_at,
                sellable_rooms,
                booked_rooms,
                occupancy_ratio,
                exposure_time,
            ))

        # 4. Batch Insert
        print("Inserting bookings for accepted quotes...")
        execute_batch(
            cursor,
            """
            INSERT INTO bookings (
                booking_id, customer_id, created_at, check_in_date, check_out_date, guest_count, status
            ) VALUES (%s, %s, %s, %s, %s, %s, %s);
            """,
            bookings_data,
            page_size=500,
        )

        print("Inserting pricing quotes...")
        execute_batch(
            cursor,
            """
            INSERT INTO pricing_quotes (
                quote_id, customer_id, booking_id, room_type_id, room_type_name_snapshot,
                capacity_snapshot, check_in_date, check_out_date, guest_count,
                total_of_special_requests, lead_time, is_weekend, rooms_available,
                base_price, ai_multiplier, nightly_price, total_price, currency,
                pricing_source, settings_version, ai_model_version, ai_training_run_id,
                ai_feature_contract_version, created_at, expires_at, accepted_at,
                rooms_sellable_snapshot, rooms_booked_snapshot, occupancy_ratio_snapshot,
                inventory_snapshot_at
            ) VALUES (
                %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
            );
            """,
            quotes_data,
            page_size=500,
        )

        print("Inserting pricing quote events...")
        execute_batch(
            cursor,
            """
            INSERT INTO pricing_quote_events (
                quote_event_id, quote_id, event_type, occurred_at, source,
                session_id, search_id, metadata
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (quote_id, event_type) DO NOTHING;
            """,
            events_data,
            page_size=500,
        )

        conn.commit()
        print("\n=== Data Generation Complete ===")
        print(f"Total Quotes:    {len(quotes_data)}")
        print(f"Accepted:        {accepted_count} ({(accepted_count/total_quotes)*100:.1f}%)")
        print(f"Rejected:        {rejected_count} ({(rejected_count/total_quotes)*100:.1f}%)")
        print(f"Timed out:       {expired_count} ({(expired_count/total_quotes)*100:.1f}%)")
        print(f"Negative labels: {rejected_count + expired_count} ({((rejected_count + expired_count)/total_quotes)*100:.1f}%)")

    except Exception as exc:
        conn.rollback()
        print(f"Error during mock data generation: {exc}")
        raise
    finally:
        cursor.close()
        conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate mock quotes and conversion training data.")
    parser.add_argument("--quotes", type=int, default=2500, help="Number of quotes to generate")
    parser.add_argument("--host", default="localhost", help="Postgres host")
    parser.add_argument("--port", type=int, default=5432, help="Postgres port")
    parser.add_argument("--user", default="hotel_admin", help="Postgres user")
    parser.add_argument("--password", default="secretpassword", help="Postgres password")
    parser.add_argument("--dbname", default="hotel_db", help="Postgres db name")
    args = parser.parse_args()

    generate_mock_dataset(
        host=args.host,
        port=args.port,
        user=args.user,
        password=args.password,
        dbname=args.dbname,
        total_quotes=args.quotes,
    )
