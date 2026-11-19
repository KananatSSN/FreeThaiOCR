import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { compression, defineAlgorithm } from 'vite-plugin-compression2'
import { VitePWA } from 'vite-plugin-pwa'
import models from './models.json' with { type: 'json' }
import { buildLicensesText } from './scripts/third-party-licenses.ts'

// COOP/COEP make the page cross-origin isolated, which onnxruntime-web needs
// for multi-threaded WASM (SharedArrayBuffer). nginx sets the same headers in production.
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

/**
 * The maintainer's donation QR lives in private/ (gitignored, so forks never
 * ship someone else's account). When present it is served in dev and emitted
 * into the build under a content-hashed name; the app shows it in the donate
 * dialog via import.meta.env.VITE_PROMPTPAY_QR. Without it, that card is hidden.
 */
function privateDonationQr(): Plugin {
  const dir = path.resolve(import.meta.dirname, 'private')
  const file = existsSync(dir) ? readdirSync(dir).find((f) => /^promptpay[-_]?qr\.(jpe?g|png|webp)$/i.test(f)) : undefined
  if (!file) return { name: 'private-donation-qr' }
  const buf = readFileSync(path.join(dir, file))
  const ext = path.extname(file).toLowerCase().replace('.jpeg', '.jpg')
  const name = `donate/promptpay-qr-${createHash('sha256').update(buf).digest('hex').slice(0, 10)}${ext}`
  const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg'
  return {
    name: 'private-donation-qr',
    config: () => ({ define: { 'import.meta.env.VITE_PROMPTPAY_QR': JSON.stringify(`/${name}`) } }),
    configureServer(server) {
      server.middlewares.use(`/${name}`, (_req, res) => {
        res.setHeader('Content-Type', mime)
        res.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
        res.end(buf)
      })
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: name, source: buf })
    },
  }
}

/** Serves (dev) and emits (build) /licenses.txt: every shipped package's license and notice. */
function thirdPartyLicenses(): Plugin {
  const root = import.meta.dirname
  const text = () => buildLicensesText(root, path.join(root, 'public', 'models', `openthai-${models.openthai.revision.slice(0, 7)}`), path.join(root, 'public', 'models', `akson-${models.akson.revision ? models.akson.revision.slice(0, 7) : 'local'}`))
  return {
    name: 'third-party-licenses',
    configureServer(server) {
      server.middlewares.use('/licenses.txt', (_req, res) => {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8')
        res.end(text())
      })
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'licenses.txt', source: text() })
    },
  }
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    privateDonationQr(),
    thirdPartyLicenses(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icon-192.png'],
      manifest: {
        name: 'FreeThaiOCR',
        short_name: 'FreeThaiOCR',
        description: 'Thai & English OCR that runs entirely in your browser',
        lang: 'th',
        theme_color: '#171717',
        background_color: '#ffffff',
        display: 'standalone',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache only the small app shell. The OCR runtime (ORT wasm, OpenCV,
        // models) is cached the first time it is used, so installing never
        // downloads the WebGPU build (or anything else) nobody asked for.
        globPatterns: ['**/*.{js,mjs,css,html,svg,woff2,png}'],
        globIgnores: ['**/opencv*.js', '**/ort-wasm-*', '**/pdf.worker*', '**/vendor/**', '**/models/**'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        // Real files opened by navigation must not get the app shell instead.
        navigateFallbackDenylist: [/^\/models\//, /^\/vendor\//, /^\/donate\//, /^\/licenses\.txt$/],
        runtimeCaching: [
          {
            // Content-hashed bundles and versioned paths never change: cache first.
            urlPattern: ({ url, sameOrigin }) =>
              sameOrigin && (/^\/assets\/.+\.(wasm|m?js)$/.test(url.pathname) || /^\/(models|vendor|fonts)\//.test(url.pathname)),
            handler: 'CacheFirst',
            options: {
              cacheName: 'freethaiocr-runtime',
              expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
    }),
    // Pre-gzipped copies for nginx `gzip_static` (Cloudflare re-compresses to brotli at the edge).
    compression({ algorithms: [defineAlgorithm('gzip', { level: 9 })], threshold: 1024, exclude: [/\.(png|woff2|gz)$/] }),
  ],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  server: { headers: isolation },
  preview: { headers: isolation },
  worker: { format: 'es' },
  // The OCR worker's dependencies load lazily; declaring them avoids a mid-session
  // "optimized dependencies changed" reload in dev.
  optimizeDeps: { include: ['@techstark/opencv-js', 'onnxruntime-web/wasm', 'onnxruntime-web/webgpu', 'clipper-lib'] },
  build: {
    // The OCR runtime chunks are inherently large and load lazily in the worker.
    chunkSizeWarningLimit: 2000,
  },
})
