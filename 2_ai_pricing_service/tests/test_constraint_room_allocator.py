"""Tests for Google OR-Tools Constraint Room Allocation Solver."""
import pytest
from app.services.constraint_room_allocator import (
    BookingAllocationRequest,
    ConstraintRoomAllocationSolver,
    ExistingRoomOccupancy,
    PhysicalRoomCandidate,
)


def test_single_request_allocation_success():
    solver = ConstraintRoomAllocationSolver()
    rooms = [
        PhysicalRoomCandidate(room_id=101, room_number="101", type_id=1, capacity=2),
        PhysicalRoomCandidate(room_id=102, room_number="102", type_id=1, capacity=2),
    ]
    requests = [
        BookingAllocationRequest(
            request_id="REQ-001",
            room_type_id=1,
            check_in_date="2026-11-01",
            check_out_date="2026-11-03",
            guest_count=2,
            revenue_value=2400000,
        )
    ]
    result = solver.solve(requests, rooms)
    assert result.status == "OPTIMAL"
    assert len(result.assignments) == 1
    assert result.assignments[0].status == "ASSIGNED"
    assert result.assignments[0].room_id in (101, 102)
    assert len(result.unassigned_request_ids) == 0


def test_competing_requests_for_single_room_no_oversell():
    """Two competing bookings for the same room on overlapping dates: solver must assign only 1."""
    solver = ConstraintRoomAllocationSolver()
    # Only 1 physical room exists
    rooms = [
        PhysicalRoomCandidate(room_id=101, room_number="101", type_id=1, capacity=2),
    ]
    requests = [
        # Normal customer
        BookingAllocationRequest(
            request_id="REQ-NORMAL",
            room_type_id=1,
            check_in_date="2026-11-01",
            check_out_date="2026-11-04",
            guest_count=2,
            revenue_value=3000000,
            vip_priority=1,
        ),
        # VIP customer with higher revenue & priority
        BookingAllocationRequest(
            request_id="REQ-VIP",
            room_type_id=1,
            check_in_date="2026-11-02",
            check_out_date="2026-11-05",
            guest_count=2,
            revenue_value=4500000,
            vip_priority=3,
        ),
    ]

    result = solver.solve(requests, rooms)
    assert result.status == "OPTIMAL"
    assigned = [a for a in result.assignments if a.status == "ASSIGNED"]
    rejected = [a for a in result.assignments if a.status == "REJECTED_NO_CAPACITY"]

    # Exactly 1 assigned, 1 rejected -> zero oversell guarantee
    assert len(assigned) == 1
    assert len(rejected) == 1
    # VIP with higher revenue/priority wins the constrained room
    assert assigned[0].request_id == "REQ-VIP"
    assert assigned[0].room_id == 101
    assert rejected[0].request_id == "REQ-NORMAL"


def test_respects_existing_occupancy_blocks():
    """Room is occupied from 2026-11-02 to 2026-11-04. A new request for 2026-11-01 to 2026-11-03 must be rejected if no other room exists."""
    solver = ConstraintRoomAllocationSolver()
    rooms = [
        PhysicalRoomCandidate(room_id=201, room_number="201", type_id=2, capacity=4),
    ]
    existing = [
        ExistingRoomOccupancy(
            room_id=201,
            check_in_date="2026-11-02",
            check_out_date="2026-11-05",
            booking_id="PREV-BOOKING-01",
        )
    ]
    requests = [
        BookingAllocationRequest(
            request_id="REQ-NEW",
            room_type_id=2,
            check_in_date="2026-11-01",
            check_out_date="2026-11-03",
            guest_count=3,
            revenue_value=5000000,
        )
    ]
    result = solver.solve(requests, rooms, existing_occupancies=existing)
    # Cannot assign due to overlap with existing booking
    assert len(result.unassigned_request_ids) == 1
    assert result.assignments[0].status == "REJECTED_NO_CAPACITY"


def test_capacity_constraint_rejection():
    """Request with 5 guests cannot be placed into a 2-person room."""
    solver = ConstraintRoomAllocationSolver()
    rooms = [
        PhysicalRoomCandidate(room_id=101, room_number="101", type_id=1, capacity=2),
    ]
    requests = [
        BookingAllocationRequest(
            request_id="REQ-OVERCAP",
            room_type_id=1,
            check_in_date="2026-11-10",
            check_out_date="2026-11-12",
            guest_count=5,
            revenue_value=3000000,
        )
    ]
    result = solver.solve(requests, rooms)
    assert len(result.unassigned_request_ids) == 1
    assert result.assignments[0].status == "REJECTED_NO_CAPACITY"


def test_upgrade_never_downgrades_even_when_lower_tier_is_free():
    """When target tier is full and allow_upgrades=True, solver can upgrade to higher price tier, never downgrade."""
    solver = ConstraintRoomAllocationSolver()
    rooms = [
        PhysicalRoomCandidate(room_id=1, room_number="301", type_id=1, capacity=2, base_price=1200000),
        PhysicalRoomCandidate(room_id=2, room_number="501", type_id=2, capacity=2, base_price=1400000),
    ]
    # Request wants type 2 (1.4M) while type 2 room 501 is already occupied, and only type 1 (1.2M) is free
    existing = [
        ExistingRoomOccupancy(
            room_id=2,
            check_in_date="2026-11-20",
            check_out_date="2026-11-22",
            booking_id="OCC-501",
        )
    ]
    requests = [
        BookingAllocationRequest(
            request_id="REQ-NO-DOWNGRADE",
            room_type_id=2,
            check_in_date="2026-11-20",
            check_out_date="2026-11-22",
            guest_count=2,
            revenue_value=2800000,
            requested_base_price=1400000,
        )
    ]
    result = solver.solve(requests, rooms, existing_occupancies=existing, allow_upgrades=True)
    assert len(result.unassigned_request_ids) == 1
    assert result.assignments[0].status == "REJECTED_NO_CAPACITY"

    # Now add a higher tier room (type 3, 1.6M, cap 4) -> must pick the upgrade, never the 1.2M downgrade
    rooms_with_upgrade = rooms + [
        PhysicalRoomCandidate(room_id=3, room_number="701", type_id=3, capacity=4, base_price=1600000),
    ]
    upgraded = solver.solve(requests, rooms_with_upgrade, existing_occupancies=existing, allow_upgrades=True)
    assert upgraded.assignments[0].status == "ASSIGNED"
    assert upgraded.assignments[0].room_id == 3
    assert upgraded.assignments[0].is_upgrade is True


def test_requires_ready_room_and_keeps_current_room_when_tied():
    solver = ConstraintRoomAllocationSolver()
    rooms = [
        PhysicalRoomCandidate(room_id=10, room_number="301", type_id=1, capacity=2, housekeeping_status="Dirty", base_price=1200000),
        PhysicalRoomCandidate(room_id=11, room_number="302", type_id=1, capacity=2, housekeeping_status="Ready", base_price=1200000),
        PhysicalRoomCandidate(room_id=12, room_number="303", type_id=1, capacity=2, housekeeping_status="Ready", base_price=1200000),
    ]
    requests = [
        BookingAllocationRequest(
            request_id="REQ-SAME-DAY",
            room_type_id=1,
            check_in_date="2026-11-12",
            check_out_date="2026-11-14",
            guest_count=2,
            revenue_value=2400000,
            requested_base_price=1200000,
            current_room_id=12,
            requires_ready_room=True,
        )
    ]
    result = solver.solve(requests, rooms, allow_upgrades=True)
    assert result.assignments[0].status == "ASSIGNED"
    assert result.assignments[0].room_id == 12
    assert result.assignments[0].is_upgrade is False
