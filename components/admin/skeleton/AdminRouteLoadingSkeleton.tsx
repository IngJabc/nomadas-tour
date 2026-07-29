'use client';

import { Skeleton } from '@/components/ui/Skeleton';
import { AdminSkeletonItem, AdminSkeletonShell } from './AdminSkeletonMotion';
import { AdminTripCardSkeleton } from './AdminTripCardSkeleton';

export function AdminRouteLoadingSkeleton() {
  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <AdminSkeletonShell>
        <AdminSkeletonItem>
          <div className="flex items-center justify-between mb-6">
            <Skeleton className="h-7 w-32 rounded-lg" />
            <Skeleton className="h-10 w-36 rounded-xl" />
          </div>
        </AdminSkeletonItem>

        <AdminSkeletonItem>
          <div className="flex flex-col sm:flex-row gap-3 mb-6">
            <Skeleton className="h-10 flex-1 sm:max-w-md rounded-xl" />
            <Skeleton className="h-10 w-full sm:w-44 rounded-xl" />
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
