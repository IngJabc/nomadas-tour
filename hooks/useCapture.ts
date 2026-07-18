'use client';

import { useCallback, useRef } from 'react';
import { toPng } from 'html-to-image';

interface UseCaptureOptions {
  filename?: string;
  pixelRatio?: number;
}

interface ShareOptions {
  text?: string;
}

interface ShareResult {
  shared: boolean;
}

interface UseCaptureReturn {
  captureRef: React.RefObject<HTMLDivElement | null>;
  capture: () => Promise<string | null>;
  download: () => Promise<void>;
  share: (options?: ShareOptions) => Promise<ShareResult>;
}

export function useCapture(options: UseCaptureOptions = {}): UseCaptureReturn {
  const { filename = 'boleto', pixelRatio = 2 } = options;
  const captureRef = useRef<HTMLDivElement | null>(null);

  const capture = useCallback(async (): Promise<string | null> => {
    if (!captureRef.current) return null;
    try {
      const dataUrl = await toPng(captureRef.current, {
        pixelRatio,
        cacheBust: true,
        backgroundColor: '#ffffff',
      });
      return dataUrl;
    } catch {
      return null;
    }
  }, [pixelRatio]);

  const download = useCallback(async () => {
    const dataUrl = await capture();
    if (!dataUrl) return;
    const link = document.createElement('a');
    link.download = `${filename}.png`;
    link.href = dataUrl;
    link.click();
  }, [capture, filename]);

  const share = useCallback(async (options?: ShareOptions): Promise<ShareResult> => {
    const dataUrl = await capture();
    if (!dataUrl) return { shared: false };

    try {
      if (navigator.share && navigator.canShare) {
        const res = await fetch(dataUrl);
        const blob = await res.blob();
        const file = new File([blob], `${filename}.png`, { type: 'image/png' });

        if (navigator.canShare({ files: [file] })) {
          await navigator.share({
            files: [file],
            title: 'Boleto de viaje',
            ...(options?.text ? { text: options.text } : {}),
          });
          return { shared: true };
        }
      }

      await download();
      return { shared: false };
    } catch {
      return { shared: false };
    }
  }, [capture, download, filename]);

  return { captureRef, capture, download, share };
}
