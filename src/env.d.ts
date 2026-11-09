/// <reference types="astro/client" />

// Worker types imported module-style so they don't clash with the DOM types used by browser scripts.
type D1Database = import('@cloudflare/workers-types').D1Database;
type D1PreparedStatement = import('@cloudflare/workers-types').D1PreparedStatement;
type Fetcher = import('@cloudflare/workers-types').Fetcher;
type R2Bucket = import('@cloudflare/workers-types').R2Bucket;

declare module 'cloudflare:workers' {
  export const env: Env;
}

declare namespace App {
  interface Locals {
    user: { email: string; name: string } | null;
  }
}
