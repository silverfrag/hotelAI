'use client';

import { Search, SlidersHorizontal } from 'lucide-react';

export type RoomSort = 'price-asc' | 'price-desc' | 'capacity-desc';

interface RoomFilterProps {
  search: string;
  capacity: number;
  sort: RoomSort;
  availableOnly: boolean;
  onSearchChange: (value: string) => void;
  onCapacityChange: (value: number) => void;
  onSortChange: (value: RoomSort) => void;
  onAvailableOnlyChange: (value: boolean) => void;
}

export function RoomFilter({
  search,
  capacity,
  sort,
  availableOnly,
  onSearchChange,
  onCapacityChange,
  onSortChange,
  onAvailableOnlyChange,
}: RoomFilterProps) {
  return (
    <div className="p-6 rounded-[28px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-sm space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-4 items-end">
        {/* Search */}
        <div className="lg:col-span-5 space-y-1.5">
          <label className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] block">
            Tìm loại phòng
          </label>
          <div className="relative">
            <input
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Nhập tên phòng (Deluxe, Suite, Villa...)"
              type="search"
              className="w-full px-4 py-3 pl-11 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface-elevated)] text-sm font-semibold text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--gold-primary)]"
            />
            <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--gold-primary)]" />
          </div>
        </div>

        {/* Capacity */}
        <div className="lg:col-span-3 space-y-1.5">
          <label className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] block">
            Số lượng khách
          </label>
          <select
            value={capacity}
            onChange={(e) => onCapacityChange(Number(e.target.value))}
            className="w-full px-4 py-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface-elevated)] text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:border-[var(--gold-primary)]"
          >
            <option value={0}>Tất cả sức chứa</option>
            {[1, 2, 3, 4, 5, 6].map((v) => (
              <option key={v} value={v}>Từ {v} khách trở lên</option>
            ))}
          </select>
        </div>

        {/* Sort */}
        <div className="lg:col-span-4 space-y-1.5">
          <label className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] block">
            Sắp xếp theo giá
          </label>
          <select
            value={sort}
            onChange={(e) => onSortChange(e.target.value as RoomSort)}
            className="w-full px-4 py-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface-elevated)] text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:border-[var(--gold-primary)]"
          >
            <option value="price-asc">Giá cơ sở: Thấp đến cao</option>
            <option value="price-desc">Giá cơ sở: Cao đến thấp</option>
            <option value="capacity-desc">Sức chứa: Nhiều khách nhất</option>
          </select>
        </div>
      </div>

      {/* Checkbox Filter */}
      <div className="pt-2 flex items-center justify-between">
        <label className="inline-flex items-center gap-2.5 text-xs font-semibold text-[var(--text-secondary)] cursor-pointer select-none">
          <input
            type="checkbox"
            checked={availableOnly}
            onChange={(e) => onAvailableOnlyChange(e.target.checked)}
            className="w-4 h-4 rounded text-[var(--gold-primary)] accent-[var(--gold-primary)]"
          />
          <span>Chỉ hiển thị các hạng phòng đang sẵn sàng hôm nay</span>
        </label>
      </div>
    </div>
  );
}
