import { AdminPaymentsManager } from '@/components/features/admin/AdminPaymentsManager';
import type { PaymentMethod, PaymentTransactionType } from '@/types/booking.type';

export const metadata = { title: 'Sổ thanh toán — Hotel AI' };

interface AdminPaymentsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const allowedTypes = new Set<PaymentTransactionType>(['Payment', 'Refund']);
const allowedMethods = new Set<PaymentMethod>(['Cash', 'BankTransfer', 'CardTerminal']);

export default async function AdminPaymentsPage({ searchParams }: AdminPaymentsPageProps) {
  const params = await searchParams;
  const rawSearch = Array.isArray(params.search) ? params.search[0] : params.search;
  const rawType = Array.isArray(params.transaction_type) ? params.transaction_type[0] : params.transaction_type;
  const rawMethod = Array.isArray(params.method) ? params.method[0] : params.method;
  return (
    <AdminPaymentsManager
      initialSearch={(rawSearch ?? '').trim().slice(0, 150)}
      initialType={rawType && allowedTypes.has(rawType as PaymentTransactionType) ? rawType as PaymentTransactionType : ''}
      initialMethod={rawMethod && allowedMethods.has(rawMethod as PaymentMethod) ? rawMethod as PaymentMethod : ''}
    />
  );
}
