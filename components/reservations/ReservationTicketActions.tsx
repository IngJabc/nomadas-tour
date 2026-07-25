'use client';

import { useState, useCallback } from 'react';
import { Download, Share2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';

interface ReservationTicketActionsProps {
  onDownload: () => Promise<void>;
  onShare: () => Promise<unknown>;
  className?: string;
}

export function ReservationTicketActions({
  onDownload,
  onShare,
  className,
}: ReservationTicketActionsProps) {
  const [downloading, setDownloading] = useState(false);
  const [shareState, setShareState] = useState<'idle' | 'loading'>('idle');

  const handleDownload = useCallback(async () => {
    setDownloading(true);
    try {
      await onDownload();
    } finally {
      setDownloading(false);
    }
  }, [onDownload]);

  const handleShare = useCallback(async () => {
    setShareState('loading');
    try {
      await onShare();
    } finally {
      setShareState('idle');
    }
  }, [onShare]);

  return (
    <div className={`flex flex-col sm:flex-row gap-2 ${className ?? ''}`}>
      <Button
        variant="primary"
        size="sm"
        onClick={handleDownload}
        loading={downloading}
        className="flex-1"
      >
        <Download className="w-4 h-4" />
        Descargar
      </Button>
      <Button
        variant="secondary"
        size="sm"
        onClick={handleShare}
        loading={shareState === 'loading'}
        className="flex-1"
      >
        <Share2 className="w-4 h-4" />
        Compartir
      </Button>
    </div>
  );
}
