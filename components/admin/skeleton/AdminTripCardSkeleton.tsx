import { Skeleton } from '@/components/ui/Skeleton';

/** Mismo layout que CardSkeleton, con pulso por elemento (como agency). Solo admin. */
export function AdminTripCardSkeleton() {
  return (
    <div className="bg-[var(--color-brand-surface)] rounded-2xl border border-[rgba(0,0,0,0.06)] p-6 shadow-[0_1px_3px_rgba(0,0,0,0.06)] flex flex-col gap-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-5 w-3/5" />
          <Skeleton className="h-3 w-2/3" />
        </div>
        <Skeleton className="h-5 w-16 rounded-full shrink-0" />
      </div>

      <div className="flex items-center gap-2">
        <Skeleton className="w-3.5 h-3.5 rounded" />
        <Skeleton className="h-3 w-28" />
      </div>

      <div className="space-y-3">
        <Skeleton className="h-2 w-full rounded-full" />
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-12" />
          <Skeleton className="h-3 w-20" />
        </div>
        <div className="flex gap-4">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        <Skeleton className="h-5 w-14 rounded-full" />
        <Skeleton className="h-5 w-16 rounded-full" />
        <Skeleton className="h-5 w-12 rounded-full" />
        <Skeleton className="h-5 w-10 rounded-full" />
      </div>

      <div className="flex items-center gap-2 pt-1">
        <Skeleton className="h-7 w-16 rounded-lg" />
        <Skeleton className="h-7 w-20 rounded-lg" />
        <Skeleton className="h-7 w-12 rounded-lg ml-auto" />
      </div>
    </div>
  );
}
