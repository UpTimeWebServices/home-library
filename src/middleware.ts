import { defineMiddleware } from 'astro:middleware';
import { env } from 'cloudflare:workers';
import { userName, verifyAccessJwt } from './lib/auth';

/**
 * Every request must come through Cloudflare Access with an allowed email.
 * If Access isn't configured yet, only `astro dev` is let in — production fails closed.
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

  const token = ctx.request.headers.get('cf-access-jwt-assertion');
  const email = token ? await verifyAccessJwt(token, team, aud).catch(() => null) : null;
  const name = email ? userName(email, env.USERS ?? '') : null;
  if (!email || !name) return new Response('Not signed in.', { status: 403 });

  ctx.locals.user = { email, name };
  return next();
});
