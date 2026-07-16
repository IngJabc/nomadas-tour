import { cn } from '@/lib/utils';

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  count?: number;
}

export function Skeleton({ className, count = 1, ...props }: SkeletonProps) {
  if (count > 1) {
    return (
      <>
        {Array.from({ length: count }).map((_, i) => (
          <div
            key={i}
            className={cn('animate-pulse bg-slate-200 rounded', className)}
            {...props}
          />
        ))}
      </>
    );
  }

  return (
    <div
      className={cn('animate-pulse bg-slate-200 rounded', className)}
      {...props}
    />
  );
}

export function CardSkeleton() {
  return (
    <div className="bg-[var(--color-brand-surface)] rounded-2xl border border-[rgba(0,0,0,0.06)] p-6 shadow-[0_1px_3px_rgba(0,0,0,0.06)] animate-pulse flex flex-col gap-4">
      {/* Header: title + badge */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 space-y-1.5">
          <div className="h-5 bg-slate-200 rounded w-3/5" />
          <div className="h-3 bg-slate-200 rounded w-2/3" />
        </div>
        <div className="h-5 bg-slate-200 rounded-full w-16 shrink-0" />
      </div>

      {/* Vehicle row */}
      <div className="flex items-center gap-2">
        <div className="w-3.5 h-3.5 bg-slate-200 rounded" />
        <div className="h-3 bg-slate-200 rounded w-28" />
      </div>

      {/* TripOccupancy area */}
      <div className="space-y-3">
        <div className="h-2 bg-slate-200 rounded-full w-full" />
        <div className="flex items-center justify-between">
          <div className="h-4 bg-slate-200 rounded w-12" />
          <div className="h-3 bg-slate-200 rounded w-20" />
        </div>
        <div className="flex gap-4">
          <div className="h-3 bg-slate-200 rounded w-24" />
          <div className="h-3 bg-slate-200 rounded w-24" />
          <div className="h-3 bg-slate-200 rounded w-24" />
        </div>
      </div>

      {/* TripAgencies row */}
      <div className="flex items-center gap-1.5">
        <div className="h-5 bg-slate-200 rounded-full w-14" />
        <div className="h-5 bg-slate-200 rounded-full w-16" />
        <div className="h-5 bg-slate-200 rounded-full w-12" />
        <div className="h-5 bg-slate-200 rounded-full w-10" />
      </div>

      {/* Actions row */}
      <div className="flex items-center gap-2 pt-1">
        <div className="h-7 bg-slate-200 rounded-lg w-16" />
        <div className="h-7 bg-slate-200 rounded-lg w-20" />
        <div className="h-7 bg-slate-200 rounded-lg w-12 ml-auto" />
      </div>
    </div>
  );
}

export function AgencyTripCardSkeleton() {
  return (
    <div className="bg-[var(--color-brand-surface)] rounded-2xl border border-[rgba(0,0,0,0.06)] p-6 shadow-[0_1px_3px_rgba(0,0,0,0.06)] animate-pulse">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="flex-1 min-w-0 space-y-2">
          <Skeleton className="h-5 w-3/5" />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-3 w-32" />
          </div>
        </div>
        <div className="flex items-center gap-6 shrink-0">
          <div className="text-center space-y-1">
            <Skeleton className="h-2.5 w-16 mx-auto" />
            <Skeleton className="h-7 w-10 mx-auto" />
          </div>
          <div className="text-center space-y-1">
            <Skeleton className="h-2.5 w-16 mx-auto" />
            <Skeleton className="h-7 w-10 mx-auto" />
          </div>
        </div>
      </div>
      <div className="mt-4 pt-4 border-t border-[rgba(0,0,0,0.06)] flex items-center justify-between">
        <Skeleton className="h-3 w-24" />
        <div className="flex items-center gap-3">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-28" />
        </div>
      </div>
    </div>
  );
}

export function ReservationDetailSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Top 2-col: trip info + QR */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        {/* Left: trip info card */}
        <div className="bg-[var(--color-brand-surface)] rounded-2xl border border-[rgba(0,0,0,0.06)] p-6 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
          <Skeleton className="h-5 w-40 mb-5" />
          <div className="space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="w-8 h-8 rounded-lg shrink-0" />
                <div className="space-y-1.5 flex-1">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-4 w-32" />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: QR card */}
        <div className="bg-[var(--color-brand-surface)] rounded-2xl border border-[rgba(0,0,0,0.06)] p-6 shadow-[0_1px_3px_rgba(0,0,0,0.06)] flex flex-col items-center justify-center">
          <Skeleton className="w-40 h-40 rounded-xl" />
          <Skeleton className="h-5 w-48 mt-4" />
          <Skeleton className="h-3 w-24 mt-2" />
          <div className="w-full mt-5 space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex justify-between">
                <Skeleton className="h-3 w-28" />
                <Skeleton className="h-3 w-20" />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Passengers section */}
      <div className="bg-[var(--color-brand-surface)] rounded-2xl border border-[rgba(0,0,0,0.06)] p-6 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
        <Skeleton className="h-5 w-36 mb-3" />
        <Skeleton className="h-3 w-40 mb-5" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 p-4 rounded-xl bg-slate-50">
              <Skeleton className="w-10 h-10 rounded-lg shrink-0" />
              <div className="space-y-1.5 flex-1">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-3 w-20" />
              </div>
              <Skeleton className="h-5 w-14 rounded-full shrink-0" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function TableSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="bg-[var(--color-brand-surface)] rounded-2xl border border-[rgba(0,0,0,0.06)] overflow-hidden">
      <div className="p-5 border-b border-slate-100">
        <Skeleton className="h-4 w-24" />
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="p-5 border-b border-slate-100 flex gap-4">
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}
