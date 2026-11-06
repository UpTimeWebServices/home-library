/// <reference types="astro/client" />

// Worker types imported module-style so they don't clash with the DOM types used by browser scripts.
type D1Database = import('@cloudflare/workers-types').D1Database;
type Fetcher = import('@cloudflare/workers-types').Fetcher;

declare module 'cloudflare:workers' {
  export const env: Env;
}

declare namespace App {
  interface Locals {
    user: { email: string; name: string } | null;
  }
}
