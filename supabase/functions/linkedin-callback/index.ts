// Supabase Edge Function: LinkedIn sends the person back here after they approve Hiba.
// It only forwards the browser to Hiba's own page, where the signed-in app finishes the
// connection through the `linkedin` function. It touches no data and holds no secrets.
//
// Deploy with "Verify JWT" OFF: LinkedIn's redirect carries no Hiba login token.
// Secret APP_ORIGINS: comma-separated list of Hiba addresses allowed to receive the person,
// e.g. "http://localhost:5173,https://your-domain.com". Anything else falls back to the first.

const ORIGINS = (Deno.env.get('APP_ORIGINS') ?? 'http://localhost:5173')
  .split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean)

function decodeState(state: string): { o?: string } | null {
  try {
    const b64 = state.replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    return JSON.parse(atob(padded))
  } catch {
    return null
  }
}

Deno.serve((req) => {
  const url = new URL(req.url)
  const state = url.searchParams.get('state') ?? ''
  const wanted = decodeState(state)?.o
  // Never forward to an address that is not on the allow list (no open redirect).
  const origin = wanted && ORIGINS.includes(wanted) ? wanted : ORIGINS[0]

  const back = new URL('/dashboard/linkedin/callback', origin)
  for (const key of ['code', 'state', 'error', 'error_description']) {
    const value = url.searchParams.get(key)
    if (value) back.searchParams.set(key, value.slice(0, 2000))
  }
  return new Response(null, {
    status: 302,
    headers: { Location: back.toString(), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
  })
})
