import Image from 'next/image';
import { PLATFORM_LOGO_ALT, PLATFORM_LOGO_SRC } from '@/lib/brand/constants';

interface PlatformLogoMarkProps {
  size?: number;
  className?: string;
  priority?: boolean;
}

export function PlatformLogoMark({
  size = 40,
  className,
  priority = false,
}: PlatformLogoMarkProps) {
  return (
    <Image
      src={PLATFORM_LOGO_SRC}
      alt={PLATFORM_LOGO_ALT}
      width={size}
      height={size}
      priority={priority}
      className={className}
    />
  );
}
