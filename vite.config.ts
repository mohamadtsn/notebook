import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // 'prompt', not 'autoUpdate': autoUpdate reloads the page on its own, and this
      // app is a text editor — a reload mid-sentence is a data-loss-shaped surprise.
      // The user gets a toast and decides. Deviation from PLAN-V2 Phase 3.1.
      registerType: 'prompt',
      includeAssets: ['favicon.ico', 'apple-touch-icon-180x180.png', 'app-icon.svg'],
      manifest: {
        name: 'دفترچه',
        short_name: 'دفترچه',
        description: 'دفترچه یادداشت ساده و آفلاین',
        lang: 'fa',
        dir: 'rtl',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        background_color: '#F5F5F0',
        theme_color: '#F5F5F0',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App shell + fonts. All data lives in localStorage, so precaching the shell
        // is the whole offline story — no runtime caching rules needed.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
        // The experimental editor's chunk is lazily imported precisely so users who
        // never turn it on do not download it — precaching it would hand all 275kB to
        // everyone through the back door. It is cached on first use instead, so it is
        // still there offline for the users who do enable it.
        globIgnores: ['**/CodeEditor-*.js'],
        runtimeCaching: [
          {
            urlPattern: /\/assets\/CodeEditor-.*\.js$/,
            handler: 'CacheFirst',
            options: { cacheName: 'code-editor' },
          },
        ],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
})