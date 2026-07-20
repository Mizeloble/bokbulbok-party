import type { MetadataRoute } from 'next';
import { GAME_META, type GameId } from '@/games/types';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

// Only the stable public pages. Room routes are ephemeral and intentionally left out.
export default function sitemap(): MetadataRoute.Sitemap {
  const gamePages = (Object.keys(GAME_META) as GameId[])
    .filter((id) => GAME_META[id].enabled)
    .map((id) => `/games/${id}`);
  return ['', ...gamePages, '/privacy', '/terms'].map((path) => ({
    url: `${siteUrl}${path}`,
    changeFrequency: 'monthly' as const,
    priority: path === '' ? 1 : path.startsWith('/games/') ? 0.7 : 0.5,
  }));
}
