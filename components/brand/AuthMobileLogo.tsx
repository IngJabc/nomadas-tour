import { PlatformLogoMark } from '@/components/brand/PlatformLogoMark';

/** Platform logo shown above auth forms on mobile — hidden on lg+ where hero column is visible. */
export function AuthMobileLogo() {
  return (
    <div className="lg:hidden flex justify-center mb-5">
      <PlatformLogoMark size={36} priority />
    </div>
  );
}
