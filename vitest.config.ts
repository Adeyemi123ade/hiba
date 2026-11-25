import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config'

// The edge functions (supabase/functions) are Deno files that import the Supabase client as
// 'npm:@supabase/supabase-js@2'. In tests that name points at the same package from node_modules,
// so the functions can be tested here without changing a line of them.
export default mergeConfig(viteConfig, defineConfig({
  test: {
    alias: { 'npm:@supabase/supabase-js@2': '@supabase/supabase-js' },
  },
}))
