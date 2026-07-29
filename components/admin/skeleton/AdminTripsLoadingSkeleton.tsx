'use client';

import { Skeleton } from '@/components/ui/Skeleton';
import { AdminSkeletonItem, AdminSkeletonShell } from './AdminSkeletonMotion';
import { AdminTripCardSkeleton } from './AdminTripCardSkeleton';

export function AdminTripsLoadingSkeleton() {
  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <AdminSkeletonShell>
        <AdminSkeletonItem>
          <div className="h-7 w-32 bg-slate-200 rounded-lg animate-pulse mb-6" />
        </AdminSkeletonItem>

        <AdminSkeletonItem>
          <div className="flex flex-col gap-3 mb-6">
            <div className="flex justify-center">
              <div className="flex gap-1.5 bg-slate-100 rounded-xl h-9 px-1 w-full sm:w-auto">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div
                    key={i}
                    className="flex-1 sm:flex-none h-7 bg-slate-200 rounded-lg animate-pulse"
                    style={{
                      width: i === 1 ? 64 : i === 2 ? 72 : i === 3 ? 96 : i === 4 ? 88 : 80,
                    }}
                  />
                ))}
              </div>
            </div>
            <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3">
              <Skeleton className="h-10 flex-1 sm:basis-[200px] rounded-xl" />
              <Skeleton className="h-10 w-full sm:w-44 rounded-xl" />
              <Skeleton className="h-10 w-full sm:w-44 rounded-xl" />
              <Skeleton className="h-10 w-full sm:w-44 rounded-xl" />
            </div>
          </div>
        </AdminSkeletonItem>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <AdminSkeletonItem key={i}>
              <AdminTripCardSkeleton />
            </AdminSkeletonItem>
          ))}
        </div>
      </AdminSkeletonShell>
    </main>
  );
}
