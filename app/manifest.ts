import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Nuvio Control Center',
    short_name: 'Nuvio Control',
    description: 'Aplicação web para administrar perfis e dados da conta Nuvio.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#0b0c0f',
    theme_color: '#0b0c0f',
    icons: [
      { src: '/brand/nuvio-icon.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  }
}
