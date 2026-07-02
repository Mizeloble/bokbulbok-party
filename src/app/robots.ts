import type { MetadataRoute } from 'next';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      // Room pages are ephemeral, per-group, and need a live socket — there's
      // nothing to index and a crawled code would 404. Keep bots on public pages.
      disallow: ['/r/', '/api/'],
    },
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
