import type { MetadataRoute } from 'next';

// Lets people add Edupato Homes to their phone's home screen. It works like a normal website otherwise; nothing is stored for offline use.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Edupato Homes', short_name: 'Edupato Homes', description: 'Verified rentals', start_url: '/', scope: '/', display: 'standalone',
    background_color: '#f6f4f1', theme_color: '#0b0d0c',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
