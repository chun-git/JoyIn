import { describe, expect, it } from 'vitest';
import { AppError } from '../src/lib/errors';
import { verifyLiffIdToken } from '../src/middleware/auth';

const JWT = `${'a'.repeat(20)}.${'b'.repeat(20)}.${'c'.repeat(20)}`;

describe('verifyLiffIdToken', () => {
  it('maps non-JSON LINE responses to auth_token_invalid instead of 500', async () => {
    await expect(
      verifyLiffIdToken(JWT, '1234567890', async () => new Response('<html>error</html>', { status: 502 })),
    ).rejects.toMatchObject({
      status: 401,
      code: 'auth_token_invalid',
    });
  });

  it('maps empty LINE bodies to auth_token_invalid instead of 500', async () => {
    await expect(
      verifyLiffIdToken(JWT, '1234567890', async () => new Response('', { status: 400 })),
    ).rejects.toMatchObject({
      status: 401,
      code: 'auth_token_invalid',
    });
  });

  it('maps non-string LINE error_description without throwing TypeError', async () => {
    await expect(
      verifyLiffIdToken(
        JWT,
        '1234567890',
        async () =>
          new Response(JSON.stringify({ error: 'invalid_request', error_description: 0 }), {
            status: 400,
          }),
      ),
    ).rejects.toMatchObject({
      status: 401,
      code: 'auth_token_invalid',
      message: '無法驗證登入身分',
    });
  });

  it('classifies IdToken expired as auth_token_expired without leaking LINE text', async () => {
    await expect(
      verifyLiffIdToken(
        JWT,
        '1234567890',
        async () =>
          new Response(JSON.stringify({ error: 'invalid_request', error_description: 'IdToken expired' }), {
            status: 400,
          }),
      ),
    ).rejects.toMatchObject({
      status: 401,
      code: 'auth_token_expired',
      message: 'LINE 登入已過期',
    });
  });

  it('classifies spaced id token expired variants', async () => {
    await expect(
      verifyLiffIdToken(
        JWT,
        '1234567890',
        async () =>
          new Response(JSON.stringify({ error_description: 'ID Token expired.' }), { status: 400 }),
      ),
    ).rejects.toMatchObject({
      status: 401,
      code: 'auth_token_expired',
    });
  });

  it('rejects missing channel id as 401', async () => {
    await expect(verifyLiffIdToken(JWT, '  ')).rejects.toBeInstanceOf(AppError);
    await expect(verifyLiffIdToken(JWT, '  ')).rejects.toMatchObject({
      status: 401,
      code: 'auth_token_invalid',
    });
  });

  it('accepts a valid LINE verify payload', async () => {
    const user = await verifyLiffIdToken(
      JWT,
      '1234567890',
      async () =>
        new Response(JSON.stringify({ sub: 'U-real', name: 'Real User', picture: 'https://example.com/a.png' }), {
          status: 200,
        }),
    );
    expect(user).toEqual({
      lineUserId: 'U-real',
      displayName: 'Real User',
      pictureUrl: 'https://example.com/a.png',
    });
  });

  it('maps fetch failures to auth_token_invalid', async () => {
    await expect(
      verifyLiffIdToken(JWT, '1234567890', async () => {
        throw new TypeError('network down');
      }),
    ).rejects.toMatchObject({
      status: 401,
      code: 'auth_token_invalid',
    });
  });
});
