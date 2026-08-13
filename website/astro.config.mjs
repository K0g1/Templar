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
      logo: { src: './src/assets/emblem.svg', alt: 'Templar' },
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
