import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const protectedPaths = ['/admin', '/agency'];
const publicPaths = ['/login', '/register', '/accept-invitation', '/forgot-password', '/reset-password', '/'];

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const host = request.headers.get('host') || '';

  // Check if request comes from a subdomain (multi-tenant)
  const parts = host.split('.');
  const isSubdomain = parts.length >= 3 && parts[0] !== 'www' && parts[0] !== 'admin';
  const subdomain = isSubdomain ? parts[0] : null;

  // Redirect to login if protected and not authenticated
  const isProtected = protectedPaths.some((path) => pathname.startsWith(path));
  if (isProtected && !user) {
    const url = request.nextUrl.clone();
    const originalPath = pathname + request.nextUrl.search;
    url.pathname = '/login';
    url.searchParams.set('redirect', originalPath);
    return NextResponse.redirect(url);
  }

  // Role checks and agency param validation: UX redirects in layout via /auth/me (AuthRoleGuard)

  // Pass subdomain to Express via header
  if (subdomain) {
    supabaseResponse.headers.set('X-Subdomain', subdomain);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
