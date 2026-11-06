/**
 * Cloudflare Access JWT verification.
 * Access puts a signed JWT in the `Cf-Access-Jwt-Assertion` header on every request it lets through.
 * We verify the RS256 signature against the team's public keys, plus audience, issuer and expiry,
 * then map the email to a display name from the USERS var.
 */
interface Jwk extends JsonWebKey { kid: string }

let certCache: { at: number; keys: Jwk[] } | null = null;

async function accessKeys(teamDomain: string): Promise<Jwk[]> {
  if (certCache && Date.now() - certCache.at < 60 * 60 * 1000) return certCache.keys;
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`Access certs: HTTP ${res.status}`);
  const body = (await res.json()) as { keys: Jwk[] };
  certCache = { at: Date.now(), keys: body.keys };
  return body.keys;
}

const b64url = (s: string): Uint8Array<ArrayBuffer> => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '='));
  return new Uint8Array(Array.from(b, (c) => c.charCodeAt(0)));
};

export async function verifyAccessJwt(token: string, teamDomain: string, aud: string): Promise<string | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, s] = parts as [string, string, string];
  const header = JSON.parse(new TextDecoder().decode(b64url(h))) as { kid?: string; alg?: string };
  if (header.alg !== 'RS256') return null;
  const jwk = (await accessKeys(teamDomain)).find((k) => k.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64url(s), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) return null;
  const claims = JSON.parse(new TextDecoder().decode(b64url(p))) as { aud?: string | string[]; iss?: string; exp?: number; email?: string };
  const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!auds.includes(aud)) return null;
  if (claims.iss !== `https://${teamDomain}`) return null;
  if (!claims.exp || claims.exp * 1000 < Date.now()) return null;
  return claims.email?.toLowerCase() ?? null;
}

export function userName(email: string, usersVar: string): string | null {
  for (const pair of usersVar.split(',')) {
    const [e, n] = pair.split('=').map((x) => x.trim());
    if (e && e.toLowerCase() === email) return n || e;
  }
  return null;
}
