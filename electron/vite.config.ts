import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import electron from 'vite-plugin-electron/simple'
import path from 'path'
import pkg from './package.json'

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    tailwindcss(),
    react(),
    electron({
      main: {
        entry: 'src/main/index.ts',
        // Start Electron on first build, skip restart on subsequent rebuilds
        // to prevent killing active terminals
        onstart({ startup }) {
          if (!process.electronApp) {
            startup()
          } else {
            console.log('[vite] Main process rebuilt. Restart manually to apply changes.')
          }
        },
        vite: {
          resolve: {
            alias: {
              '@shared': path.resolve(__dirname, 'src/shared'),
              '@main': path.resolve(__dirname, 'src/main'),
            },
          },
          build: {
            outDir: 'dist-electron/main',
            rollupOptions: {
              input: {
                index: path.resolve(__dirname, 'src/main/index.ts'),
                'workers/index-worker': path.resolve(
                  __dirname,
                  'src/main/services/IndexWorker.ts'
                ),
              },
              external: ['better-sqlite3', 'node-pty'],
              output: {
                entryFileNames: '[name].js',
              },
            },
          },
        },
      },
      preload: {
        input: 'src/preload/index.ts',
        // Prevent automatic reload of renderer window on preload rebuild
        // to avoid wiping out active sessions/terminals
        onstart({ reload }) {
          console.log('[vite] Preload rebuilt. Restart manually to apply changes.')
        },
        vite: {
          resolve: {
            alias: {
              '@shared': path.resolve(__dirname, 'src/shared'),
            },
          },
          build: {
            outDir: 'dist-electron/preload',
            rollupOptions: {
              external: ['electron', 'os'],
            },
          },
        },
      },
    }),
  ],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@renderer': path.resolve(__dirname, 'src/renderer'),
      '@main': path.resolve(__dirname, 'src/main'),
    },
  },
})
