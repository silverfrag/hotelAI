'use client';

import { ArrowRight, Search, Users } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useTranslation } from '@/contexts/LanguageContext';
import { addIsoDays } from '@/utils/businessDate';
import { RoomType } from '@/types/room.type';

const ROOM_IMAGES = [
  'https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=900&auto=format&fit=crop&q=85',
  'https://images.unsplash.com/photo-1618773928121-c32242e63f39?w=900&auto=format&fit=crop&q=85',
  'https://images.unsplash.com/photo-1591088398332-8a7791972843?w=900&auto=format&fit=crop&q=85',
];

function imageFor(room: RoomType): string {
  return ROOM_IMAGES[(room.type_id - 1) % ROOM_IMAGES.length];
}

export function RoomCatalog({ roomTypes, businessDate }: { roomTypes: RoomType[]; businessDate: string }) {
  const { formatPrice } = useTranslation();
  const [search, setSearch] = useState('');
  const [capacity, setCapacity] = useState(0);
  const [availableOnly, setAvailableOnly] = useState(false);
  const [selectedId, setSelectedId] = useState(roomTypes[0]?.type_id ?? 0);
  const selectedRoom = roomTypes.find((room) => room.type_id === selectedId) ?? roomTypes[0];

  const filteredRooms = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase('vi');
    return roomTypes.filter((room) => {
      const matchesSearch = !normalized || room.type_name.toLocaleLowerCase('vi').includes(normalized);
      const matchesCapacity = capacity === 0 || room.capacity >= capacity;
      const matchesAvailability = !availableOnly || room.available_now > 0;
      return matchesSearch && matchesCapacity && matchesAvailability;
    });
  }, [availableOnly, capacity, roomTypes, search]);

  return (
    <div className="-mx-4 sm:-mx-6 lg:-mx-8 border-t border-[var(--border-subtle)]">
      <div className="flex flex-col lg:flex-row min-h-[70vh]">
        <div className="flex-1 min-w-0">
          <div className="sticky top-[64px] z-20 px-5 md:px-10 py-4 flex flex-wrap items-center gap-2 bg-[var(--bg-primary)]/95 backdrop-blur-xl border-b border-[var(--border-subtle)]">
            <label className="relative flex-1 min-w-[220px] max-w-sm">
              <span className="sr-only">Tìm loại phòng</span>
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--gold-primary)]" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm loại phòng" className="w-full bg-transparent border-b border-[var(--border-gold)] py-2 pl-9 text-xs text-[var(--text-primary)] outline-none" />
            </label>
            <select value={capacity} onChange={(event) => setCapacity(Number(event.target.value))} className="bg-[var(--bg-surface)] border border-[var(--border-gold)] px-3 py-2 text-xs text-[var(--text-secondary)]">
              <option value={0}>Mọi sức chứa</option>
              {[1, 2, 3, 4, 5, 6].map((value) => <option key={value} value={value}>Từ {value} khách</option>)}
            </select>
            <label className="inline-flex items-center gap-2 text-xs text-[var(--text-muted)] px-2">
              <input type="checkbox" checked={availableOnly} onChange={(event) => setAvailableOnly(event.target.checked)} className="accent-[var(--gold-primary)]" />
              Còn phòng hôm nay
            </label>
            <span className="ml-auto text-[10px] uppercase tracking-wider text-[var(--text-muted)]">{filteredRooms.length} loại phòng</span>
          </div>

          <div className="px-5 md:px-10 py-10 space-y-5">
            {filteredRooms.map((room) => {
              const selected = room.type_id === selectedRoom?.type_id;
              return (
                <article key={room.type_id} onClick={() => setSelectedId(room.type_id)} className={`group flex flex-col sm:flex-row overflow-hidden border transition-colors cursor-pointer ${selected ? 'border-[var(--gold-primary)] bg-[var(--gold-light)]' : 'border-[var(--border-subtle)] bg-[var(--bg-surface)]'}`}>
                  <div className="sm:w-56 shrink-0 aspect-[4/3] sm:aspect-auto sm:min-h-[220px] overflow-hidden"><img src={imageFor(room)} alt={room.type_name} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" /></div>
                  <div className="flex-1 p-5 flex flex-col justify-between gap-5">
                    <div className="flex items-start justify-between gap-5">
                      <div>
                        <p className="text-[9px] uppercase tracking-[0.2em] text-[var(--gold-primary)] mb-2">{room.available_now > 0 ? `${room.available_now} phòng sẵn sàng` : 'Hết phòng hôm nay'}</p>
                        <h2 className="font-serif text-2xl text-[var(--text-primary)]">{room.type_name}</h2>
                        <p className="mt-2 text-xs text-[var(--text-muted)] inline-flex items-center gap-2"><Users size={14} /> Tối đa {room.capacity} khách · {room.total_rooms} phòng trong hệ thống</p>
                      </div>
                      <div className="text-right shrink-0"><strong className="font-serif text-2xl text-[var(--gold-primary)]">{formatPrice(room.base_price)}</strong><p className="text-[10px] text-[var(--text-muted)]">giá cơ sở / đêm</p></div>
                    </div>
                    <div className="flex items-center justify-between border-t border-[var(--border-subtle)] pt-4"><span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Giá thực nhận theo ngày lưu trú</span><Link href={`/rooms/${room.type_id}`} onClick={(event) => event.stopPropagation()} className="inline-flex items-center gap-2 text-[10px] uppercase tracking-wider text-[var(--gold-primary)]">Xem chi tiết <ArrowRight size={14} /></Link></div>
                  </div>
                </article>
              );
            })}
            {filteredRooms.length === 0 && <p className="py-20 text-center text-sm text-[var(--text-muted)]">Không tìm thấy loại phòng phù hợp.</p>}
          </div>
        </div>

        {selectedRoom && (
          <aside className="w-full lg:w-[340px] shrink-0 border-l border-[var(--border-subtle)] bg-[var(--bg-surface-elevated)]"><div className="lg:sticky lg:top-[64px] p-6">
            <p className="text-[10px] uppercase tracking-[0.22em] text-[var(--gold-primary)] mb-5">Báo giá cho kỳ nghỉ</p>
            <img src={imageFor(selectedRoom)} alt={selectedRoom.type_name} className="w-full aspect-[16/9] object-cover" />
            <h2 className="font-serif text-2xl text-[var(--text-primary)] mt-5">{selectedRoom.type_name}</h2>
            <p className="text-xs text-[var(--text-muted)] mt-1">Tối đa {selectedRoom.capacity} khách · còn {selectedRoom.available_now} phòng hôm nay</p>
            <div className="border-t border-[var(--border-subtle)] mt-5 pt-5 space-y-3 text-xs text-[var(--text-secondary)]"><div className="flex justify-between"><span>Giá cơ sở</span><strong>{formatPrice(selectedRoom.base_price)} / đêm</strong></div><div className="flex justify-between"><span>Giá cuối</span><span>Được tính theo ngày</span></div></div>
            <Link href={`/checkout?room_type_id=${selectedRoom.type_id}&check_in_date=${businessDate}&check_out_date=${addIsoDays(businessDate, 1)}&guest_count=1`} className="mt-6 w-full inline-flex items-center justify-center gap-2 bg-[var(--gold-primary)] text-[var(--bg-primary)] py-3.5 text-[10px] uppercase tracking-[0.18em] font-semibold">Nhận báo giá AI <ArrowRight size={14} /></Link>
            <p className="text-[10px] text-[var(--text-muted)] text-center mt-3">Báo giá thật và thời hạn bảo đảm sẽ xuất hiện ở bước tiếp theo.</p>
          </div></aside>
        )}
      </div>
    </div>
  );
}
