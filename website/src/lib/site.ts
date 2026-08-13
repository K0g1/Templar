export const base = import.meta.env.BASE_URL.replace(/\/$/, '');

export function url(path = '/') {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${base}${normalized}`.replace(/\/+/g, '/');
}

export const repo = 'https://github.com/K0g1/Templar';
export const releasesUrl = `${repo}/releases`;
export const bratUrl = 'obsidian://brat?plugin=K0g1/Templar';
