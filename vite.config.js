import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  build: {
    // ExcelJS is loaded only when an XLSX export is requested. Its standalone
    // browser bundle is about 929 KB minified (about 256 KB after gzip).
    chunkSizeWarningLimit: 1000,
  },
})
