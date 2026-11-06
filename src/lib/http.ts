export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

export const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export const str = (v: unknown, max = 500): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
  return s || null;
};
