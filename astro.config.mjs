// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import tailwindcss from '@tailwindcss/vite';

/**
 * Home Library — private catalog app for Aron and Darlene.
 * Fully server-rendered on a Cloudflare Worker (D1 for data). Access protects the whole site.
 */
export default defineConfig({
  site: 'https://home-library.aron-da0.workers.dev',
  output: 'server',
  adapter: cloudflare({ imageService: 'passthrough' }),
  session: false,
  devToolbar: { enabled: false },
  vite: { plugins: [tailwindcss()] },
});
