import {
  createTzamClient,
  PasswordMethodDisabledError,
  MagicLinkMethodDisabledError,
  OtpMethodDisabledError,
  AppInactiveError,
} from './index';

const appConfigOk = (overrides: {
  active?: boolean;
  password?: boolean;
  magicLink?: boolean;
  otp?: boolean;
} = {}) => ({
  ok: true,
  status: 200,
  json: async () => ({
    clientId: 'test-client',
    active: overrides.active ?? true,
    methods: {
      password: overrides.password ?? true,
      magicLink: overrides.magicLink ?? true,
      otp: overrides.otp ?? true,
      oauth: { github: false, google: false },
    },
  }),
});

const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('createTzamClient', () => {
  const client = createTzamClient({
    url: 'http://localhost:4000',
    clientId: 'test-client',
    clientSecret: 'test-secret',
  });

  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('refreshToken', () => {
    it('should call refresh endpoint with refresh token in Cookie header', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ accessToken: 'new-access-token' }),
      });

      const result = await client.refreshToken('my-refresh-token');

      expect(mockFetch).toHaveBeenCalledWith('http://localhost:4000/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: 'refresh_token=my-refresh-token' },
      });
      expect(result.accessToken).toBe('new-access-token');
    });

    it('should throw when refresh fails', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 401 });

      await expect(client.refreshToken('bad-token')).rejects.toThrow('Token refresh failed');
    });
  });

  describe('validateToken', () => {
    it('should return payload for valid token', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ userId: 'u1', email: 'a@b.com' }),
      });

      const result = await client.validateToken('valid-token');
      expect(result).toEqual({ userId: 'u1', email: 'a@b.com', exp: 0 });
    });

    it('should return null for invalid token', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 401 });

      const result = await client.validateToken('bad-token');
      expect(result).toBeNull();
    });

    it('should return null on network error', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const result = await client.validateToken('any-token');
      expect(result).toBeNull();
    });
  });

  describe('login', () => {
    it('should send credentials with client_id and client_secret', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          accessToken: 'at',
          refreshToken: 'rt',
          user: { id: 'u1', email: 'a@b.com', name: 'Test' },
        }),
      });

      const result = await client.login('a@b.com', 'pass123');

      expect(mockFetch).toHaveBeenCalledWith('http://localhost:4000/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'a@b.com',
          password: 'pass123',
          client_id: 'test-client',
          client_secret: 'test-secret',
        }),
      });
      expect(result.accessToken).toBe('at');
      expect(result.refreshToken).toBe('rt');
    });

    it('should throw on login failure', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        json: async () => ({ message: 'Invalid credentials' }),
      });

      await expect(client.login('a@b.com', 'wrong')).rejects.toThrow('Invalid credentials');
    });
  });

  describe('logout', () => {
    it('should call IdP logout with access token and refresh token', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({ success: true }) });

      await client.logout('my-access-token', 'my-refresh-token');

      expect(mockFetch).toHaveBeenCalledWith('http://localhost:4000/auth/logout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer my-access-token',
          Cookie: 'refresh_token=my-refresh-token',
        },
      });
    });

    it('should not throw when logout fails', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      await expect(client.logout('token', 'refresh')).resolves.toBeUndefined();
    });
  });

  describe('forgotPassword', () => {
    it('probes /auth/app-config then posts to /auth/forgot-password when password is enabled', async () => {
      mockFetch
        .mockResolvedValueOnce(appConfigOk())
        .mockResolvedValueOnce({ ok: true, status: 204 });

      await client.forgotPassword('user@example.com');

      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        'http://localhost:4000/auth/app-config?client_id=test-client',
        { method: 'GET', headers: { 'Content-Type': 'application/json' } },
      );
      expect(mockFetch).toHaveBeenNthCalledWith(2, 'http://localhost:4000/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'user@example.com', clientId: 'test-client' }),
      });
    });

    it('treats 204 as success (no body to parse)', async () => {
      mockFetch
        .mockResolvedValueOnce(appConfigOk())
        .mockResolvedValueOnce({ ok: true, status: 204 });
      await expect(client.forgotPassword('a@b.com')).resolves.toBeUndefined();
    });

    it('throws PasswordMethodDisabledError when password method is disabled for the app', async () => {
      mockFetch.mockResolvedValueOnce(appConfigOk({ password: false }));

      await expect(client.forgotPassword('a@b.com')).rejects.toBeInstanceOf(
        PasswordMethodDisabledError,
      );
      // Server is never hit — fail-fast at the probe
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('throws AppInactiveError when the application is inactive', async () => {
      mockFetch.mockResolvedValueOnce(appConfigOk({ active: false }));

      await expect(client.forgotPassword('a@b.com')).rejects.toBeInstanceOf(AppInactiveError);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('throws with server message when request fails', async () => {
      mockFetch.mockResolvedValueOnce(appConfigOk()).mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ message: 'Mail provider unavailable' }),
      });
      await expect(client.forgotPassword('a@b.com')).rejects.toThrow('Mail provider unavailable');
    });

    it('falls back to a generic message when the server payload has none', async () => {
      mockFetch.mockResolvedValueOnce(appConfigOk()).mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({}),
      });
      await expect(client.forgotPassword('a@b.com')).rejects.toThrow('Forgot password failed');
    });
  });

  describe('requestMagicLink', () => {
    it('probes /auth/app-config then posts when magic link is enabled', async () => {
      mockFetch
        .mockResolvedValueOnce(appConfigOk())
        .mockResolvedValueOnce({ ok: true, status: 204 });

      await client.requestMagicLink('user@example.com', '/after-login');

      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        'http://localhost:4000/auth/app-config?client_id=test-client',
        { method: 'GET', headers: { 'Content-Type': 'application/json' } },
      );
      expect(mockFetch).toHaveBeenNthCalledWith(2, 'http://localhost:4000/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'user@example.com', redirect: '/after-login', client_id: 'test-client' }),
      });
    });

    it('throws MagicLinkMethodDisabledError when magic link is disabled', async () => {
      mockFetch.mockResolvedValueOnce(appConfigOk({ magicLink: false }));

      await expect(client.requestMagicLink('a@b.com')).rejects.toBeInstanceOf(
        MagicLinkMethodDisabledError,
      );
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('throws AppInactiveError when the app is inactive', async () => {
      mockFetch.mockResolvedValueOnce(appConfigOk({ active: false }));

      await expect(client.requestMagicLink('a@b.com')).rejects.toBeInstanceOf(AppInactiveError);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('requestOtp', () => {
    it('probes /auth/app-config then posts when OTP is enabled', async () => {
      mockFetch
        .mockResolvedValueOnce(appConfigOk())
        .mockResolvedValueOnce({ ok: true, status: 204 });

      await client.requestOtp('user@example.com');

      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        'http://localhost:4000/auth/app-config?client_id=test-client',
        { method: 'GET', headers: { 'Content-Type': 'application/json' } },
      );
      expect(mockFetch).toHaveBeenNthCalledWith(2, 'http://localhost:4000/auth/otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'user@example.com', client_id: 'test-client' }),
      });
    });

    it('throws OtpMethodDisabledError when OTP is disabled', async () => {
      mockFetch.mockResolvedValueOnce(appConfigOk({ otp: false }));

      await expect(client.requestOtp('a@b.com')).rejects.toBeInstanceOf(OtpMethodDisabledError);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('throws AppInactiveError when the app is inactive', async () => {
      mockFetch.mockResolvedValueOnce(appConfigOk({ active: false }));

      await expect(client.requestOtp('a@b.com')).rejects.toBeInstanceOf(AppInactiveError);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('getAuthMethods', () => {
    /**
     * Thin probe around GET /auth/app-config. Consumers use it before
     * rendering the auth UI because forgotPassword() (and other silent
     * auth-email flows) return 204 even when the method is disabled for
     * the app — this endpoint is the only non-leaky way to tell.
     */
    it('GETs /auth/app-config with the client_id and returns the parsed payload', async () => {
      const payload = {
        clientId: 'test-client',
        active: true,
        methods: {
          password: true,
          magicLink: false,
          otp: false,
          oauth: { github: false, google: true },
        },
      };
      mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => payload });

      const result = await client.getAuthMethods();

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:4000/auth/app-config?client_id=test-client',
        { method: 'GET', headers: { 'Content-Type': 'application/json' } },
      );
      expect(result).toEqual(payload);
    });

    it('throws with the server message when the request fails', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ message: 'Upstream unavailable' }),
      });

      await expect(client.getAuthMethods()).rejects.toThrow('Upstream unavailable');
    });

    it('falls back to a generic message when the server payload has none', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });

      await expect(client.getAuthMethods()).rejects.toThrow('Auth methods lookup failed');
    });
  });

  describe('resetPassword', () => {
    it('posts token + newPassword to /auth/reset-password', async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 204 });

      await client.resetPassword('reset-tok-xxx', 'NewSecret123!');

      expect(mockFetch).toHaveBeenCalledWith('http://localhost:4000/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: 'reset-tok-xxx', newPassword: 'NewSecret123!' }),
      });
    });

    it('throws on invalid/expired token', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ message: 'Invalid or expired reset token' }),
      });
      await expect(client.resetPassword('bad', 'NewPass1!')).rejects.toThrow(
        'Invalid or expired reset token',
      );
    });
  });
});
