import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/rpg-rzutnik-front/'   // <- NAZWA TWOJEGO REPO
})
