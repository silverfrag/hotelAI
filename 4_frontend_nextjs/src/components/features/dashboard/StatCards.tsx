import {
  BedDouble,
  LogIn,
  LogOut,
  DoorOpen,
  DollarSign,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { cn } from '@/components/ui/utils';
import { statMetrics, type StatMetric } from './mockData';

const iconMap: Record<StatMetric['icon'], LucideIcon> = {
  occupancy: BedDouble,
  arrivals: LogIn,
  departures: LogOut,
  available: DoorOpen,
  adr: DollarSign,
};

const deltaStyle = {
  up: 'text-success',
  down: 'text-danger',
  flat: 'text-muted-foreground',
} as const;

const DeltaIcon = { up: ArrowUpRight, down: ArrowDownRight, flat: Minus } as const;

function StatCard({ metric }: { metric: StatMetric }) {
  const Icon = iconMap[metric.icon];
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <p className="text-sm font-medium text-muted-foreground">{metric.label}</p>
        <span className="flex size-9 items-center justify-center rounded-lg bg-primary-muted text-primary">
          <Icon className="size-[18px]" />
        </span>
      </div>
      <p className="mt-3 text-3xl font-semibold tracking-tight tabular-nums text-foreground">
        {metric.value}
      </p>
      <div className="mt-2 flex items-center gap-2">
        {metric.delta &&
          (() => {
            const D = DeltaIcon[metric.delta.direction];
            return (
              <span
                className={cn(
                  'inline-flex items-center gap-0.5 text-xs font-medium',
                  deltaStyle[metric.delta.direction],
                )}
              >
                <D className="size-3.5" />
                {metric.delta.value}
              </span>
            );
          })()}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{metric.helper}</p>
    </Card>
  );
}

export function StatCards() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      {statMetrics.map((metric) => (
        <StatCard key={metric.key} metric={metric} />
      ))}
    </div>
  );
}
