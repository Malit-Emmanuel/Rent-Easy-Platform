import type { MetadataRoute } from 'next';

// Lets people add Zuri Home to their phone's home screen. It works like a normal website otherwise; nothing is stored for offline use.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Zuri Home', short_name: 'Zuri Home', description: 'Verified rentals', start_url: '/', scope: '/', display: 'standalone',
    background_color: '#f6f2ea', theme_color: '#123d32',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
