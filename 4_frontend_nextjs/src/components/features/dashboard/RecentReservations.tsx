import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/Table';
import { recentReservations, reservationStatusVariant } from './mockData';

export function RecentReservations() {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex-row items-center justify-between">
        <div className="flex flex-col gap-1">
          <CardTitle>Recent Reservations</CardTitle>
          <CardDescription>Latest booking activity across all channels</CardDescription>
        </div>
        <Button variant="outline" size="sm" disabled>
          View all
        </Button>
      </CardHeader>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Reference</TableHead>
            <TableHead>Guest</TableHead>
            <TableHead>Room</TableHead>
            <TableHead>Check-in</TableHead>
            <TableHead className="text-right">Nights</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {recentReservations.map((r) => (
            <TableRow key={r.ref}>
              <TableCell className="font-mono text-xs text-muted-foreground">{r.ref}</TableCell>
              <TableCell className="font-medium text-foreground">{r.guest}</TableCell>
              <TableCell>
                <span className="font-medium text-foreground">{r.room}</span>
                <span className="block text-xs text-muted-foreground">{r.roomType}</span>
              </TableCell>
              <TableCell className="text-muted-foreground">{r.checkIn}</TableCell>
              <TableCell className="text-right tabular-nums">{r.nights}</TableCell>
              <TableCell className="text-right font-medium tabular-nums text-foreground">
                {r.amount}
              </TableCell>
              <TableCell>
                <Badge variant={reservationStatusVariant[r.status]} dot>
                  {r.status}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
