import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { validateIDPToken } from './index';

export interface TzamConfig {
  publicRoutes?: string[];
  loginUrl?: string;
  idpUrl?: string;
}

const defaultConfig: Required<TzamConfig> = {
  publicRoutes: ['/', '/auth/login', '/auth/register', '/api/auth'],
  loginUrl: '/auth/login',
  idpUrl: process.env.IDP_URL || 'http://localhost:3001',
};

export function createTzamProxy(userConfig: TzamConfig = {}) {
  const cfg: Required<TzamConfig> = { ...defaultConfig, ...userConfig };

  const isPublicRoute = (pathname: string) => {
    return cfg.publicRoutes.some((route) =>
      route === '/' ? pathname === '/' : pathname.startsWith(route),
    );
  };

  return async function proxy(request: NextRequest) {
    const { pathname } = request.nextUrl;

    if (isPublicRoute(pathname)) {
      return NextResponse.next();
    }

    const sessionCookie = request.cookies.get('session');

    if (!sessionCookie) {
      const loginUrl = new URL(cfg.loginUrl, request.url);
      loginUrl.searchParams.set('redirect', pathname);
      return NextResponse.redirect(loginUrl);
    }

    const validation = await validateIDPToken(sessionCookie.value);

    if (!validation) {
      const response = NextResponse.redirect(new URL(cfg.loginUrl, request.url));
      response.cookies.delete('session');
      response.cookies.delete('refresh_token');
      return response;
    }

    const response = NextResponse.next();
    response.headers.set('x-user-id', validation.userId);
    response.headers.set('x-user-email', validation.email);
    return response;
  };
}

export const proxy = createTzamProxy();

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
