// A stand-in for the small part of Deno the edge functions use: secrets (Deno.env) and the
// request handler (Deno.serve). Import this BEFORE importing an edge function in a test.
type Handler = (req: Request) => Response | Promise<Response>

export const env = new Map<string, string>()
let handler: Handler | null = null

;(globalThis as unknown as { Deno: unknown }).Deno = {
  env: { get: (name: string) => env.get(name) },
  serve: (h: Handler) => { handler = h },
}

/** The function's request handler, as Supabase would call it. */
export function served(): Handler {
  if (!handler) throw new Error('The edge function did not call Deno.serve')
  return handler
}
