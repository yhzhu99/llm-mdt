import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return

          if (id.includes('/vue/') || id.includes('@vue')) {
            return 'vue-vendor'
          }

          if (
            id.includes('/marked') ||
            id.includes('/marked-highlight') ||
            id.includes('/marked-katex-extension') ||
            id.includes('/katex') ||
            id.includes('/dompurify')
          ) {
            return 'markdown-vendor'
          }

          if (id.includes('/lucide-vue-next')) {
            return 'ui-vendor'
          }
        },
      },
    },
  },
})
