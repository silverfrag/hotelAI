"""Constraint-Based Room Allocation Engine using Google OR-Tools CP-SAT Solver.

This module models room assignment as an Exact Constraint Satisfaction & Optimization Problem (COP):
- Solves single-booking or batch competing booking requests competing for finite physical rooms.
- Guarantees zero overlapping room assignments (no double booking).
- Enforces hard physical capacity constraints (capacity >= guest_count).
- Maximizes total revenue / contribution margin while penalizing capacity wastage and fragmentation.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any, Final

from ortools.sat.python import cp_model


@dataclass(frozen=True, slots=True)
class PhysicalRoomCandidate:
    room_id: int
    room_number: str
    type_id: int
    capacity: int
    current_status: str = "Available"
    housekeeping_status: str = "Ready"
    base_price: float = 0.0


@dataclass(frozen=True, slots=True)
class BookingAllocationRequest:
    request_id: str
    room_type_id: int
    check_in_date: str  # YYYY-MM-DD
    check_out_date: str  # YYYY-MM-DD
    guest_count: int
    revenue_value: float = 0.0
    vip_priority: int = 1  # 1 = regular, 2 = silver, 3 = gold, 4 = platinum
    requested_base_price: float = 0.0
    current_room_id: int | None = None
    requires_ready_room: bool = False


@dataclass(frozen=True, slots=True)
class ExistingRoomOccupancy:
    room_id: int
    check_in_date: str  # YYYY-MM-DD
    check_out_date: str  # YYYY-MM-DD
    booking_id: str


@dataclass(frozen=True, slots=True)
class AllocationAssignment:
    request_id: str
    room_id: int
    room_number: str
    assigned_type_id: int
    is_upgrade: bool
    status: str  # "ASSIGNED" | "REJECTED_NO_CAPACITY"


@dataclass(frozen=True, slots=True)
class OptimizationResult:
    status: str  # "OPTIMAL" | "FEASIBLE" | "INFEASIBLE"
    solver_time_ms: float
    total_assigned_revenue: float
    assignments: list[AllocationAssignment]
    unassigned_request_ids: list[str]
    audit_notes: list[str]


def parse_date(date_str: str) -> date:
    return datetime.strptime(date_str, "%Y-%m-%d").date()


def generate_date_range(start: date, end: date) -> list[date]:
    """Return all nights in the stay [start, end)."""
    curr = start
    dates = []
    while curr < end:
        dates.append(curr)
        curr += timedelta(days=1)
    return dates


class ConstraintRoomAllocationSolver:
    """Solves multi-request physical room allocation using OR-Tools CP-SAT."""

    def __init__(self, time_limit_seconds: float = 2.0) -> None:
        self.time_limit_seconds = time_limit_seconds

    def solve(
        self,
        requests: list[BookingAllocationRequest],
        available_rooms: list[PhysicalRoomCandidate],
        existing_occupancies: list[ExistingRoomOccupancy] | None = None,
        allow_upgrades: bool = True,
    ) -> OptimizationResult:
        start_time = datetime.now()
        existing = existing_occupancies or []

        if not requests:
            return OptimizationResult(
                status="OPTIMAL",
                solver_time_ms=0.0,
                total_assigned_revenue=0.0,
                assignments=[],
                unassigned_request_ids=[],
                audit_notes=["No booking requests provided to allocator."],
            )

        if not available_rooms:
            return OptimizationResult(
                status="INFEASIBLE",
                solver_time_ms=0.0,
                total_assigned_revenue=0.0,
                assignments=[
                    AllocationAssignment(
                        request_id=req.request_id,
                        room_id=-1,
                        room_number="UNASSIGNED",
                        assigned_type_id=-1,
                        is_upgrade=False,
                        status="REJECTED_NO_CAPACITY",
                    )
                    for req in requests
                ],
                unassigned_request_ids=[req.request_id for req in requests],
                audit_notes=["No physical rooms available in inventory."],
            )

        # 1. Map existing occupancies to pre-blocked room nights
        blocked_room_nights: set[tuple[int, str]] = set()
        for occ in existing:
            check_in = parse_date(occ.check_in_date)
            check_out = parse_date(occ.check_out_date)
            for night in generate_date_range(check_in, check_out):
                blocked_room_nights.add((occ.room_id, night.isoformat()))

        # 2. Build OR-Tools CP-SAT Model
        model = cp_model.CpModel()

        # Decision Variables:
        # x[r_idx, req_idx] == 1 if request `req_idx` is assigned to room `r_idx`
        x: dict[tuple[int, int], cp_model.IntVar] = {}

        # Pre-filter feasible pairs to minimize search space
        feasible_pairs: list[tuple[int, int]] = []

        for req_idx, req in enumerate(requests):
            req_in = parse_date(req.check_in_date)
            req_out = parse_date(req.check_out_date)
            req_nights = [d.isoformat() for d in generate_date_range(req_in, req_out)]

            for r_idx, room in enumerate(available_rooms):
                # Hard Constraint 1: Room maintenance
                if room.current_status == "Maintenance":
                    continue

                # Hard Constraint 1b: Immediate / active stay arrivals require Available + Ready
                if req.requires_ready_room and (
                    room.current_status != "Available" or room.housekeeping_status != "Ready"
                ):
                    continue

                # Hard Constraint 2: Room Type compatibility (never allow downgrade!)
                if room.type_id != req.room_type_id:
                    if not allow_upgrades or room.capacity < req.guest_count:
                        continue
                    if room.base_price > 0 and req.requested_base_price > 0:
                        if room.base_price < req.requested_base_price:
                            continue
                    elif room.type_id < req.room_type_id:
                        continue

                # Hard Constraint 3: Capacity
                if room.capacity < req.guest_count:
                    continue

                # Hard Constraint 4: Conflict with existing bookings
                has_existing_conflict = any(
                    (room.room_id, night) in blocked_room_nights for night in req_nights
                )
                if has_existing_conflict:
                    continue

                var_name = f"assign_req{req_idx}_room{room.room_id}"
                x[(r_idx, req_idx)] = model.NewBoolVar(var_name)
                feasible_pairs.append((r_idx, req_idx))

        # Constraint A: Each request is assigned to at most ONE physical room
        for req_idx in range(len(requests)):
            vars_for_req = [
                x[(r_idx, req_idx)]
                for r_idx, _ in enumerate(available_rooms)
                if (r_idx, req_idx) in x
            ]
            if vars_for_req:
                model.Add(sum(vars_for_req) <= 1)

        # Constraint B: A physical room CANNOT have overlapping bookings on any night
        # Find all pairs of requests that have overlapping stay dates
        for req1_idx in range(len(requests)):
            req1 = requests[req1_idx]
            in1, out1 = parse_date(req1.check_in_date), parse_date(req1.check_out_date)

            for req2_idx in range(req1_idx + 1, len(requests)):
                req2 = requests[req2_idx]
                in2, out2 = parse_date(req2.check_in_date), parse_date(req2.check_out_date)

                # Check date interval overlap: max(in1, in2) < min(out1, out2)
                overlap = max(in1, in2) < min(out1, out2)
                if overlap:
                    # If two requests overlap, they cannot share the same room
                    for r_idx in range(len(available_rooms)):
                        if (r_idx, req1_idx) in x and (r_idx, req2_idx) in x:
                            model.Add(x[(r_idx, req1_idx)] + x[(r_idx, req2_idx)] <= 1)

        # Objective Function:
        # Maximize:
        # + Revenue of accepted requests (weighted by VIP priority)
        # - Capacity waste penalty (capacity - guest_count)
        # + Housekeeping Readiness bonus (Ready = +30, Cleaning = +15)
        objective_terms = []

        SCALE_FACTOR = 100  # Scale float revenue to integer cents for CP-SAT
        for r_idx, req_idx in feasible_pairs:
            req = requests[req_idx]
            room = available_rooms[r_idx]

            # 1. Base revenue score (scaled)
            rev_weight = int(req.revenue_value / 1000) * req.vip_priority
            if rev_weight <= 0:
                rev_weight = 1000 * req.vip_priority

            # 2. Capacity waste penalty (prefer snug fit, e.g. 2 guests in 2-cap room vs 4-cap room)
            waste = max(0, room.capacity - req.guest_count)
            waste_penalty = waste * 50

            # 3. Housekeeping readiness bonus
            hk_bonus = 0
            if room.housekeeping_status == "Ready":
                hk_bonus = 30
            elif room.housekeeping_status == "Cleaning":
                hk_bonus = 15

            # 4. Exact room-type match bonus (penalty if upgraded unnecessarily)
            type_bonus = 100 if room.type_id == req.room_type_id else 0

            # 5. Stability tie-breaker: prefer keeping existing room assignment when equivalent
            keep_bonus = 5 if (req.current_room_id is not None and room.room_id == req.current_room_id) else 0

            net_weight = rev_weight - waste_penalty + hk_bonus + type_bonus + keep_bonus
            objective_terms.append(x[(r_idx, req_idx)] * net_weight)

        if objective_terms:
            model.Maximize(sum(objective_terms))

        # Solve model
        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = self.time_limit_seconds
        solver_status = solver.Solve(model)

        elapsed_ms = (datetime.now() - start_time).total_seconds() * 1000.0

        status_str = {
            cp_model.OPTIMAL: "OPTIMAL",
            cp_model.FEASIBLE: "FEASIBLE",
            cp_model.INFEASIBLE: "INFEASIBLE",
            cp_model.MODEL_INVALID: "MODEL_INVALID",
        }.get(solver_status, "UNKNOWN")

        assignments: list[AllocationAssignment] = []
        unassigned_ids: list[str] = []
        total_assigned_rev = 0.0
        audit_notes: list[str] = [
            f"Google OR-Tools CP-SAT Solver Status: {status_str} ({elapsed_ms:.2f}ms)",
            f"Requests evaluated: {len(requests)}, Physical rooms: {len(available_rooms)}",
        ]

        assigned_req_indices = set()
        if solver_status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            for r_idx, req_idx in feasible_pairs:
                if solver.Value(x[(r_idx, req_idx)]) == 1:
                    req = requests[req_idx]
                    room = available_rooms[r_idx]
                    is_upgrade = room.type_id != req.room_type_id
                    assignments.append(
                        AllocationAssignment(
                            request_id=req.request_id,
                            room_id=room.room_id,
                            room_number=room.room_number,
                            assigned_type_id=room.type_id,
                            is_upgrade=is_upgrade,
                            status="ASSIGNED",
                        )
                    )
                    assigned_req_indices.add(req_idx)
                    total_assigned_rev += req.revenue_value

        for req_idx, req in enumerate(requests):
            if req_idx not in assigned_req_indices:
                unassigned_ids.append(req.request_id)
                assignments.append(
                    AllocationAssignment(
                        request_id=req.request_id,
                        room_id=-1,
                        room_number="UNASSIGNED",
                        assigned_type_id=-1,
                        is_upgrade=False,
                        status="REJECTED_NO_CAPACITY",
                    )
                )

        audit_notes.append(
            f"Allocated {len(assigned_req_indices)}/{len(requests)} requests successfully. Total Revenue: {total_assigned_rev:,.0f} VND"
        )

        return OptimizationResult(
            status=status_str,
            solver_time_ms=round(elapsed_ms, 2),
            total_assigned_revenue=total_assigned_rev,
            assignments=assignments,
            unassigned_request_ids=unassigned_ids,
            audit_notes=audit_notes,
        )
