# Tzam - IDP Authentication for Next.js

**Tzam** (צם) - Hebraico para "vigiar e proteger"

A simple and secure authentication client for Next.js applications integrated with the IDP identity provider.

## Installation

```bash
npm install @rpappio/tzam
# or
pnpm add @rpappio/tzam
```

## Setup

### 1. Environment Variables

Add to your `.env` file:

```env
IDP_URL=http://localhost:3001
```

### 2. Create the Proxy

Create `proxy.ts` in your Next.js app root:

```typescript
import { proxy, config } from '@rpappio/tzam/proxy';

export { config };
export default proxy;
```

### 3. Create Login API Route

Create `app/api/auth/login/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { loginToIDP } from '@rpappio/tzam';

export async function POST(request: Request) {
  try {
    const { email, password } = await request.json();
    const result = await loginToIDP(email, password);

    const response = NextResponse.json({ success: true, user: result.user });

    response.cookies.set('session', result.accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 15 * 60,
      path: '/',
    });

    if (result.refreshToken) {
      response.cookies.set('refresh_token', result.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60,
        path: '/',
      });
    }

    return response;
  } catch (error) {
    return NextResponse.json({ error: 'Credenciais inválidas' }, { status: 401 });
  }
}
```

### 4. Create Register API Route

Create `app/api/auth/register/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { registerToIDP } from '@rpappio/tzam';

export async function POST(request: Request) {
  try {
    const { name, email, password } = await request.json();

    if (password.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters' },
        { status: 400 },
      );
    }

    const result = await registerToIDP(name, email, password);

    const response = NextResponse.json({ success: true, user: result.user });

    response.cookies.set('session', result.accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 15 * 60,
      path: '/',
    });

    return response;
  } catch (error) {
    return NextResponse.json(
      { error: 'Registration failed. Email may already be in use.' },
      { status: 400 },
    );
  }
}
```

### 5. Create Login Page

Create `app/auth/login/page.tsx`:

```typescript
'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get('redirect') || '/dashboard';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Invalid credentials');
        return;
      }

      window.location.href = redirectTo;
    } catch {
      setError('Login error');
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email"
        required
      />
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
        required
      />
      <button type="submit">Login</button>
    </form>
  );
}
```

### 6. Get User Info in Server Components

```typescript
import { headers } from 'next/headers';

export default async function DashboardPage() {
  const headersList = await headers();
  const userId = headersList.get('x-user-id');
  const userEmail = headersList.get('x-user-email');

  return (
    <div>
      <h1>Welcome, {userEmail}!</h1>
      <p>User ID: {userId}</p>
    </div>
  );
}
```

## OAuth Login (Google, GitHub)

Tzam supports OAuth login via the IDP. The flow uses authorization code exchange with PKCE-like state management.

### 1. Environment Variables

```env
TZAM_URL=http://localhost:3001
TZAM_CLIENT_ID=your_app_client_id
TZAM_CLIENT_SECRET=your_app_client_secret
NEXT_PUBLIC_TZAM_URL=http://localhost:3001
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### 2. OAuth Initiation Routes

Create `app/api/auth/oauth/github/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';

const idpUrl = process.env.TZAM_URL || 'http://localhost:3001';
const clientId = process.env.TZAM_CLIENT_ID || '';

export async function GET(request: NextRequest) {
  const redirect = request.nextUrl.searchParams.get('redirect') || '/dashboard';
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
  const redirectUri = `${appUrl}/api/auth/callback/github`;

  const url = new URL(`${idpUrl}/auth/oauth/github`);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', redirect);

  return NextResponse.redirect(url.toString());
}
```

> Repeat for Google at `app/api/auth/oauth/google/route.ts` replacing `github` with `google`.

### 3. OAuth Callback Routes

Create `app/api/auth/callback/github/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';

const idpUrl = process.env.TZAM_URL || 'http://localhost:3001';
const clientId = process.env.TZAM_CLIENT_ID || '';
const clientSecret = process.env.TZAM_CLIENT_SECRET || '';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;

  // IDP redirects back with ?error=CODE when auth fails
  if (error) {
    return NextResponse.redirect(new URL(`/auth/login?error=${error}`, baseUrl));
  }

  if (!code) {
    return NextResponse.redirect(new URL('/auth/login?error=no_code', baseUrl));
  }

  let redirectTo = '/dashboard';
  try {
    if (state) {
      const stateData = JSON.parse(Buffer.from(state, 'base64url').toString());
      if (stateData.redirect) redirectTo = stateData.redirect;
    }
  } catch {
    // state may be a plain string path
    if (state && state.startsWith('/')) redirectTo = state;
  }

  try {
    // Exchange authorization code for tokens
    const tokenRes = await fetch(`${idpUrl}/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: `${baseUrl}/api/auth/callback/github`,
      }),
    });

    if (!tokenRes.ok) {
      // Extract IDP error code for user-friendly messages
      let errorCode = 'token_exchange_failed';
      try {
        const errorData = await tokenRes.json();
        if (errorData.code) errorCode = errorData.code;
      } catch {}
      return NextResponse.redirect(new URL(`/auth/login?error=${errorCode}`, baseUrl));
    }

    const data = await tokenRes.json();

    if (!data.access_token) {
      return NextResponse.redirect(new URL('/auth/login?error=no_token', baseUrl));
    }

    const response = NextResponse.redirect(new URL(redirectTo, baseUrl));

    response.cookies.set('session', data.access_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 15 * 60,
      path: '/',
    });

    if (data.refresh_token) {
      response.cookies.set('refresh_token', data.refresh_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60,
        path: '/',
      });
    }

    return response;
  } catch {
    return NextResponse.redirect(new URL('/auth/login?error=callback_failed', baseUrl));
  }
}
```

### 4. Redirect URIs

The `redirect_uri` used in the callback **must** be registered in the Application's `redirectUris` on the IDP admin panel. For each OAuth provider, register:

```
https://your-app.com/api/auth/callback/github
https://your-app.com/api/auth/callback/google
```

> Without this, the token exchange will fail with `APP_REDIRECT_INVALID`.

### 5. Handling Errors on Login Page

The IDP returns structured error codes via query parameter. Read them on the login page:

```typescript
const authError = searchParams.get('error');
const errorMessage = authError ? getAuthErrorMessage(authError) : '';
```

## Error Codes

Error codes returned by the IDP in OAuth redirects and API responses:

### Auth

| Code | HTTP | Description |
|------|------|-------------|
| `AUTH_INVALID_CREDENTIALS` | 401 | Email or password incorrect |
| `AUTH_ACCOUNT_INACTIVE` | 401 | User account is disabled |
| `AUTH_USER_NOT_REGISTERED` | 400 | User does not exist (app login requires prior registration) |
| `AUTH_EMAIL_EXISTS` | 409 | Email already in use |
| `AUTH_TOKEN_INVALID` | 401 | Access token is invalid |
| `AUTH_TOKEN_EXPIRED` | 401 | Access token has expired |
| `AUTH_SESSION_REVOKED` | 401 | Session was revoked by admin |
| `AUTH_REFRESH_FAILED` | 401 | Refresh token invalid or expired |

### OAuth

| Code | HTTP | Description |
|------|------|-------------|
| `OAUTH_PROVIDER_NOT_CONFIGURED` | 400 | Provider credentials not set on IDP |
| `OAUTH_PROVIDER_DISABLED` | 400 | Provider is disabled globally or for the org |
| `OAUTH_EXCHANGE_FAILED` | 400 | Failed to exchange code with provider (Google/GitHub) |
| `OAUTH_USERINFO_FAILED` | 400 | Failed to fetch user info from provider |
| `OAUTH_EMAIL_NOT_FOUND` | 400 | Provider did not return an email |
| `OAUTH_CODE_INVALID` | 401 | Authorization code is invalid or already used |
| `OAUTH_CODE_EXPIRED` | 401 | Authorization code has expired (5 min TTL) |

### Application

| Code | HTTP | Description |
|------|------|-------------|
| `APP_NOT_FOUND` | 401 | Application with given `client_id` not found |
| `APP_CLIENT_INVALID` | 401 | Invalid `client_id` |
| `APP_REDIRECT_INVALID` | 401 | `redirect_uri` not registered in the application |

### Organization

| Code | HTTP | Description |
|------|------|-------------|
| `ORG_MEMBER_NOT_FOUND` | 400 | User is not a member of the app's organization |

## OAuth Flow Diagram

```
Client App                    Tzam IDP                   OAuth Provider
    |                            |                            |
    |-- GET /api/auth/oauth/github --------------------------->|
    |                            |-- redirect to GitHub ------>|
    |                            |                            |
    |                            |<-- callback with code -----|
    |                            |                            |
    |                            |-- handleCallback() ------->|
    |                            |   (exchange code,          |
    |                            |    fetch user info)        |
    |                            |                            |
    |<-- redirect with auth code |                            |
    |    or ?error=CODE          |                            |
    |                            |                            |
    |-- POST /auth/token ------->|                            |
    |   (exchange auth code)     |                            |
    |                            |                            |
    |<-- { access_token, ... } --|                            |
    |    or { code: "ERROR" }    |                            |
```

**Important:** When a user tries to log in via an app (with `client_id`) but is not registered on the IDP, the flow returns `AUTH_USER_NOT_REGISTERED`. The app should redirect the user to a registration page. Auto-registration does not happen for app-initiated logins.

## Features

- **JWT-based authentication** with IDP
- **OAuth login** (Google, GitHub) with authorization code exchange
- **Automatic token validation** in middleware
- **User headers** for server components
- **Structured error codes** for client-side error handling
- **Configurable public routes**
- **TypeScript support**

## API

### `createTzamClient(config)`

Creates an authenticated client instance.

```typescript
const client = createTzamClient({
  url: 'http://localhost:3001',
  clientId: 'your_client_id',
  clientSecret: 'your_client_secret',
});
```

### `client.login(email, password)`

Login with email and password. Returns `{ accessToken, refreshToken, user }`.

### `client.register(name, email, password)`

Register a new user for the app. Returns `{ accessToken, refreshToken, user }`.

### `client.validateToken(token)`

Validate an access token. Returns `{ userId, email }` or `null`.

### `client.refreshToken(refreshToken)`

Refresh an expired access token. Returns `{ accessToken }`.

### `client.logout(accessToken, refreshToken)`

Revoke the session (best-effort).

### `createTzamProxy(config)`

Creates a Next.js middleware that validates sessions and injects user headers.

```typescript
import { createTzamProxy } from '@rpappio/tzam/proxy';

export default createTzamProxy({
  url: process.env.TZAM_URL!,
  clientId: process.env.TZAM_CLIENT_ID!,
  clientSecret: process.env.TZAM_CLIENT_SECRET!,
  publicRoutes: ['/', '/auth/login', '/auth/register', '/api/auth'],
  loginUrl: '/auth/login',
});
```

## License

MIT
