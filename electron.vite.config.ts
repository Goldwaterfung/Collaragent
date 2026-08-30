import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    ssr: {
      external: ['electron']
    },
    resolve: {
      alias: {
        '@collaragent': resolve('src/collaragent'),
        '@workspace': resolve('src/workspace'),
        '@shared': resolve('src/shared'),
        '@main': resolve('src/main')
      }
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          server: resolve(__dirname, 'src/main/server/fileServer/process.ts')
        },
        output: {
          format: 'cjs',
          entryFileNames: '[name].js',
          chunkFileNames: 'chunks/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]'
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    ssr: {
      external: ['electron']
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer'),
        '@collaragent': resolve('src/collaragent'),
        '@workspace': resolve('src/workspace'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [
      react(),
      nodePolyfills({
        globals: {
          Buffer: true,
          global: true,
          process: true
        },
        protocolImports: true
      }),
      tailwindcss()
    ]
  }
})
