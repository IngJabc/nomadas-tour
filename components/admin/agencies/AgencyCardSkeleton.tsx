import { Card } from '@/components/ui/Card';

export function AgencyCardSkeleton() {
  return (
    <Card className="flex flex-col gap-4 h-full animate-pulse">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-slate-200 shrink-0" />
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="h-5 bg-slate-200 rounded w-3/5" />
          <div className="h-3 bg-slate-200 rounded w-2/3" />
          <div className="flex gap-2 mt-1.5">
            <div className="h-4 bg-slate-200 rounded-full w-14" />
            <div className="h-4 bg-slate-200 rounded-full w-12" />
          </div>
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 pt-1">
        <div className="h-7 bg-slate-200 rounded-lg w-16" />
        <div className="h-7 bg-slate-200 rounded-lg w-20" />
      </div>
    </Card>
  );
}
