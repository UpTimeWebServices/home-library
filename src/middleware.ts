import { defineMiddleware } from 'astro:middleware';
import { env } from 'cloudflare:workers';
import type { CloudflareAccessContext } from '@cloudflare/workers-types';
import { userName, verifyAccessJwt } from './lib/auth';

/**
 * Every request must come through Cloudflare Access with an allowed email.
 *
 * 1. Worker-level Access (Workers & Pages → home-library → Access) hands the Worker `ctx.access`,
 *    already verified by Cloudflare: we check its audience and read the identity.
 * 2. Fallback: hostname-based Access only adds the `Cf-Access-Jwt-Assertion` header, which we verify.
 * If Access isn't configured, only `astro dev` is let in — production fails closed.
 */
export const onRequest = defineMiddleware(async (ctx, next) => {
  const team = env.ACCESS_TEAM_DOMAIN?.trim();
  const aud = env.ACCESS_AUD?.trim();

  if (!team || !aud) {
    if (import.meta.env.DEV) {
      ctx.locals.user = { email: 'dev@local', name: 'Aron (dev)' };
      return next();
    }
    return new Response('Sign-in is not configured yet (ACCESS_TEAM_DOMAIN / ACCESS_AUD).', { status: 503 });
  }

  let email: string | null = null;
  let reason = 'No Cloudflare Access sign-in on this request.';

  const access = (ctx.locals as { cfContext?: { access?: CloudflareAccessContext } }).cfContext?.access;
  if (access) {
    if (access.aud !== aud) {
      reason = `Signed in to a different Access application (aud ${access.aud.slice(0, 8)}…).`;
    } else {
      const identity = await access.getIdentity().catch(() => undefined);
      email = identity?.email?.toLowerCase() ?? null;
      if (!email) reason = 'Access did not return an email address.';
    }
  }

  if (!email) {
    const token = ctx.request.headers.get('cf-access-jwt-assertion');
    if (token) {
      email = await verifyAccessJwt(token, team, aud).catch(() => null);
      if (!email) reason = 'The Access sign-in token could not be verified.';
    }
  }

  if (!email) {
    console.warn('auth rejected:', reason);
    return new Response(`Not signed in. ${reason}`, { status: 403 });
  }

  const name = userName(email, env.USERS ?? '');
  if (!name) {
    console.warn('auth rejected: not on USERS list', email);
    return new Response(`Signed in as ${email}, but that address isn't on the library's member list.`, { status: 403 });
  }

  ctx.locals.user = { email, name };
  return next();
});
