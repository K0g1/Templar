import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

const site = process.env.SITE_URL ?? 'https://k0g1.github.io';
const base = process.env.SITE_BASE ?? '/Templar';

export default defineConfig({
  site,
  base,
  output: 'static',
  trailingSlash: 'always',
  integrations: [
    starlight({
      title: 'Templar Docs',
      head: [
        { tag: 'meta', attrs: { property: 'og:image', content: site + base + '/og.png' } },
        { tag: 'meta', attrs: { name: 'twitter:card', content: 'summary_large_image' } },
        { tag: 'meta', attrs: { name: 'twitter:image', content: site + base + '/og.png' } },
      ],
      logo: {
        light: './src/assets/logo-mark-light.svg',
        dark: './src/assets/logo-mark-dark.svg',
        alt: 'Templar',
      },
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/K0g1/Templar' }],
      customCss: ['./src/styles/tokens.css', './src/styles/docs.css'],
      editLink: { baseUrl: 'https://github.com/K0g1/Templar/edit/main/' },
      sidebar: [
        { label: 'Start here', items: [{ autogenerate: { directory: 'docs/start' } }] },
        { label: 'Reference', items: [{ autogenerate: { directory: 'docs/reference' } }] },
        { label: 'Developers', items: [{ autogenerate: { directory: 'docs/developers' } }] },
        { label: 'Release notes', items: [{ autogenerate: { directory: 'docs/releases' } }] }
      ]
    })
  ]
});
