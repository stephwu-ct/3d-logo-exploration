import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
// For GitHub Pages deployment, set base to your repository name
// e.g., if repo is 'username/sixth-street-logo', use base: '/sixth-street-logo/'
export default defineConfig({
  plugins: [vue()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  }
})
