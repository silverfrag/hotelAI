import type { BadgeVariant } from '@/components/ui/Badge';

/*
  Static MOCK data for the dashboard preview only.
  No backend, no business logic — purely to evaluate the shell visually.
*/

export interface StatMetric {
  key: string;
  label: string;
  value: string;
  helper: string;
  delta?: { value: string; direction: 'up' | 'down' | 'flat' };
  icon: 'occupancy' | 'arrivals' | 'departures' | 'available' | 'adr';
}

export const statMetrics: StatMetric[] = [
  {
    key: 'occupancy',
    label: 'Occupancy',
    value: '87%',
    helper: '176 of 202 rooms sold',
    delta: { value: '4.2% vs last week', direction: 'up' },
    icon: 'occupancy',
  },
  {
    key: 'arrivals',
    label: "Today's Arrivals",
    value: '42',
    helper: '18 not yet checked in',
    delta: { value: '6 vs yesterday', direction: 'up' },
    icon: 'arrivals',
  },
  {
    key: 'departures',
    label: "Today's Departures",
    value: '31',
    helper: '9 late check-outs',
    delta: { value: '3 vs yesterday', direction: 'down' },
    icon: 'departures',
  },
  {
    key: 'available',
    label: 'Available Rooms',
    value: '24',
    helper: '12 need housekeeping',
    delta: { value: 'flat vs yesterday', direction: 'flat' },
    icon: 'available',
  },
  {
    key: 'adr',
    label: 'ADR',
    value: '$214',
    helper: 'Average Daily Rate',
    delta: { value: '$12 vs last week', direction: 'up' },
    icon: 'adr',
  },
];

export interface RoomStatusItem {
  label: string;
  count: number;
  variant: BadgeVariant;
}

export const roomStatus: RoomStatusItem[] = [
  { label: 'Occupied', count: 176, variant: 'info' },
  { label: 'Vacant · Clean', count: 24, variant: 'success' },
  { label: 'Vacant · Dirty', count: 12, variant: 'warning' },
  { label: 'Arriving', count: 42, variant: 'primary' },
  { label: 'Departing', count: 31, variant: 'neutral' },
  { label: 'Out of Service', count: 4, variant: 'danger' },
];

export const roomStatusTotal = 202;

export type ReservationStatus = 'Confirmed' | 'In-house' | 'Arriving' | 'Checked-out' | 'Cancelled';

export interface ReservationRow {
  ref: string;
  guest: string;
  room: string;
  roomType: string;
  checkIn: string;
  nights: number;
  amount: string;
  status: ReservationStatus;
}

export const recentReservations: ReservationRow[] = [
  { ref: 'RSV-10428', guest: 'Nguyen Minh Anh', room: '1204', roomType: 'Deluxe King', checkIn: 'Aug 27', nights: 3, amount: '$642', status: 'Arriving' },
  { ref: 'RSV-10427', guest: 'James Whitfield', room: '0812', roomType: 'Executive Suite', checkIn: 'Aug 27', nights: 2, amount: '$988', status: 'Confirmed' },
  { ref: 'RSV-10425', guest: 'Sofia Marchetti', room: '0517', roomType: 'Twin Standard', checkIn: 'Aug 26', nights: 4, amount: '$536', status: 'In-house' },
  { ref: 'RSV-10422', guest: 'Tran Quoc Bao', room: '1109', roomType: 'Deluxe King', checkIn: 'Aug 26', nights: 1, amount: '$214', status: 'In-house' },
  { ref: 'RSV-10419', guest: 'Amelia Clarke', room: '0303', roomType: 'Twin Standard', checkIn: 'Aug 25', nights: 5, amount: '$670', status: 'Checked-out' },
  { ref: 'RSV-10416', guest: 'Daniel Osei', room: '0921', roomType: 'Executive Suite', checkIn: 'Aug 25', nights: 2, amount: '$994', status: 'Cancelled' },
];

export const reservationStatusVariant: Record<ReservationStatus, BadgeVariant> = {
  Confirmed: 'primary',
  'In-house': 'success',
  Arriving: 'info',
  'Checked-out': 'neutral',
  Cancelled: 'danger',
};

export interface AiRecommendation {
  title: string;
  detail: string;
  impact: string;
  confidence: 'High' | 'Medium' | 'Low';
}

export const aiRecommendations: AiRecommendation[] = [
  {
    title: 'Raise weekend rate for Deluxe King',
    detail: 'Demand for Fri–Sat is tracking 22% above forecast. Suggested +8% ($214 → $231).',
    impact: '+$3,120 projected revenue',
    confidence: 'High',
  },
  {
    title: 'Release 6 held Executive Suites',
    detail: 'Group block RSV-10390 unlikely to pick up remaining allotment before cut-off.',
    impact: '+6 sellable rooms tonight',
    confidence: 'Medium',
  },
  {
    title: 'Shift housekeeping to floor 12',
    detail: '9 arrivals assigned to floor 12 rooms still flagged vacant-dirty.',
    impact: 'Reduce check-in wait by ~14 min',
    confidence: 'High',
  },
];
