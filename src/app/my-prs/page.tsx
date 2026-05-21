import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default function MyPrsPage() {
  redirect('/pulls?mine=1');
}
