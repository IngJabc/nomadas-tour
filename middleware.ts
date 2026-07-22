import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const protectedPaths = ['/bookings', '/admin', '/agency'];
const adminPaths = ['/admin'];
const agencyPaths = ['/agency'];
const publicPaths = ['/login', '/register', '/', '/trips'];

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

  // Redirect non-superadmin away from /admin
  if (pathname.startsWith('/admin')) {
    const role = user?.user_metadata?.role ?? '';
    if (role !== 'superadmin') {
      const url = request.nextUrl.clone();
      url.pathname = '/';
      return NextResponse.redirect(url);
    }
  }

  // Redirect non-agency away from /agency
  if (pathname.startsWith('/agency')) {
    const role = user?.user_metadata?.role ?? '';
    if (role !== 'agency') {
      const url = request.nextUrl.clone();
      url.pathname = '/';
      return NextResponse.redirect(url);
    }

    // Validate agency_id from email link against session
    const agencyParam = request.nextUrl.searchParams.get('agency');
    if (agencyParam) {
      const userAgencyId = user?.user_metadata?.agency_id;
      if (userAgencyId !== agencyParam) {
        const url = request.nextUrl.clone();
        url.pathname = '/agency/trips';
        url.searchParams.set('error', 'wrong-agency');
        return NextResponse.redirect(url);
      }
    }
  }

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
