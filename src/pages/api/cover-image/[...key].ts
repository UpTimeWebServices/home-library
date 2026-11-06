/** GET /api/cover-image/covers/<id>-<ts>.jpg — serve an uploaded cover photo from R2 (behind Access). */
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

export const GET: APIRoute = async ({ params }) => {
  const key = params.key ?? '';
  if (!/^covers\/\d+-\d+\.(jpg|png|webp)$/.test(key)) return new Response('Not found', { status: 404 });
  const obj = await env.COVERS.get(key);
  if (!obj) return new Response('Not found', { status: 404 });
  return new Response(obj.body as unknown as BodyInit, {
    headers: {
      'content-type': obj.httpMetadata?.contentType ?? 'image/jpeg',
      // Keys are unique per upload, so the browser can keep them forever.
      'cache-control': 'private, max-age=31536000, immutable',
      etag: obj.httpEtag,
    },
  });
};
