'use client';

import { Skeleton } from '@/components/ui/Skeleton';
import { AdminSkeletonItem, AdminSkeletonShell } from './AdminSkeletonMotion';

export function AdminDashboardLoadingSkeleton() {
  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <AdminSkeletonShell>
        <AdminSkeletonItem>
          <div className="flex items-center gap-3 mb-6">
            <div className="w-1 h-[18px] bg-slate-200 rounded-sm shrink-0" />
            <Skeleton className="h-5 w-40" />
          </div>
        </AdminSkeletonItem>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6 mb-10">
          {[1, 2, 3, 4].map((i) => (
            <AdminSkeletonItem key={i}>
              <div className="bg-[var(--color-brand-surface)] rounded-2xl border border-[rgba(0,0,0,0.06)] shadow-[0_1px_3px_rgba(0,0,0,0.06)] p-5">
                <div className="flex items-center gap-4">
                  <Skeleton className="w-12 h-12 rounded-xl shrink-0" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-48" />
                  </div>
                  <Skeleton className="w-5 h-5 rounded shrink-0" />
                </div>
              </div>
            </AdminSkeletonItem>
          ))}
        </div>

        <AdminSkeletonItem>
          <div className="flex items-center gap-3 mb-6">
            <div className="w-1 h-[18px] bg-slate-200 rounded-sm shrink-0" />
            <Skeleton className="h-5 w-44" />
          </div>
        </AdminSkeletonItem>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-10">
          {[1, 2, 3, 4].map((i) => (
            <AdminSkeletonItem key={i}>
              <div className="bg-[var(--color-brand-surface)] rounded-2xl border border-[rgba(0,0,0,0.06)] shadow-[0_1px_3px_rgba(0,0,0,0.06)] p-4 sm:p-6">
                <div className="flex items-center gap-3 mb-3">
                  <Skeleton className="w-10 h-10 rounded-xl shrink-0" />
                  <Skeleton className="h-3 w-20" />
                </div>
                <Skeleton className="h-10 w-16" />
              </div>
            </AdminSkeletonItem>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-10">
          {[1, 2].map((i) => (
            <AdminSkeletonItem key={i}>
              <div className="bg-[var(--color-brand-surface)] rounded-2xl border border-[rgba(0,0,0,0.06)] shadow-[0_1px_3px_rgba(0,0,0,0.06)] p-5">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-1 h-[18px] bg-slate-200 rounded-sm shrink-0" />
                  <Skeleton className="h-5 w-36" />
                </div>
                <div className="space-y-4">
                  {[1, 2, 3].map((j) => (
                    <div key={j} className="flex gap-4">
                      <Skeleton className="w-14 h-10 rounded-lg shrink-0" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-3 w-3/4" />
                        <Skeleton className="h-3 w-1/2" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </AdminSkeletonItem>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {[1, 2].map((i) => (
            <AdminSkeletonItem key={i}>
              <div className="bg-[var(--color-brand-surface)] rounded-2xl border border-[rgba(0,0,0,0.06)] shadow-[0_1px_3px_rgba(0,0,0,0.06)] p-5">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-1 h-[18px] bg-slate-200 rounded-sm shrink-0" />
                  <Skeleton className="h-5 w-40" />
                </div>
                <Skeleton className="h-48 w-full rounded-lg" />
              </div>
            </AdminSkeletonItem>
          ))}
        </div>
      </AdminSkeletonShell>
    </main>
  );
}
