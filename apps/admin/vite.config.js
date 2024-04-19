import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    VITE_SLACK_APP_SUPABASE_API_URL: `'${process.env.VITE_SLACK_APP_SUPABASE_API_URL}'`,
    VITE_SLACK_APP_SUPABASE_ANON_KEY: `'${process.env.VITE_SLACK_APP_SUPABASE_ANON_KEY}'`
  }
})
