import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

const site = process.env.SITE_URL || 'https://example.github.io';
const rawBase = process.env.BASE_PATH || '/';
const base = `/${rawBase.split('/').filter(Boolean).join('/')}`;
const fixtureBuild = process.env.ALLOW_TEST_DATA === '1' && !process.env.CI;

export default defineConfig({
  site,
  base: base === '/' ? '/' : `${base}/`,
  output: 'static',
  outDir: fixtureBuild ? './.verification/fixture-dist' : './dist',
  trailingSlash: 'always',
  integrations: [sitemap()],
});
