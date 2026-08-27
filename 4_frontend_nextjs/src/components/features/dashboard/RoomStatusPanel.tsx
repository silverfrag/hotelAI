import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { cn } from '@/components/ui/utils';
import { roomStatus, roomStatusTotal } from './mockData';

const barColor: Record<string, string> = {
  info: 'bg-info',
  success: 'bg-success',
  warning: 'bg-warning',
  primary: 'bg-primary',
  neutral: 'bg-muted-foreground',
  danger: 'bg-danger',
  outline: 'bg-muted-foreground',
};

export function RoomStatusPanel() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Room Status</CardTitle>
        <CardDescription>Live snapshot across {roomStatusTotal} rooms</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/* Composite share bar */}
        <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
          {roomStatus.map((item) => (
            <div
              key={item.label}
              className={cn('h-full', barColor[item.variant])}
              style={{ width: `${(item.count / roomStatusTotal) * 100}%` }}
              title={`${item.label}: ${item.count}`}
            />
          ))}
        </div>

        <ul className="flex flex-col divide-y divide-border">
          {roomStatus.map((item) => (
            <li key={item.label} className="flex items-center justify-between py-2.5">
              <span className="flex items-center gap-2.5 text-sm text-foreground">
                <span className={cn('size-2.5 rounded-full', barColor[item.variant])} aria-hidden="true" />
                {item.label}
              </span>
              <span className="text-sm font-semibold tabular-nums text-foreground">{item.count}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
