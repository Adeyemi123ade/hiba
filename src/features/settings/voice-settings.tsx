import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Loader2, RotateCcw } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { SignInAgainButton } from '@/features/auth/components/sign-in-again-button'
import { useSession } from '@/features/auth/use-session'
import { useOnline } from '@/features/onboarding/use-online'
import { supabase } from '@/lib/supabase'

interface VoiceStats {
  avgSentenceWords?: number
  oneSentenceLineShare?: number
  questionsPer100Words?: number
  usesContractions?: boolean
  spelling?: 'british' | 'american' | 'unknown'
  emoji?: boolean
  hashtags?: boolean
}
interface VoiceDescription {
  cadence?: string; sentence_style?: string; vocabulary?: string; nuance?: string
  openings?: string; endings?: string; signature_phrases?: string[]; avoid?: string[]
}
interface SavedVoice {
  voice_profile: { description?: VoiceDescription; stats?: VoiceStats; sources?: number } | null
  voice_profile_at: string | null
}

const text = (v: unknown) => (typeof v === 'string' ? v : '')
const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

/** The measured facts, in plain words. */
function statLines(s: VoiceStats): string[] {
  const out: string[] = []
  if (typeof s.avgSentenceWords === 'number') out.push(`Your sentences are about ${Math.round(s.avgSentenceWords)} words long.`)
  if (typeof s.oneSentenceLineShare === 'number') out.push(s.oneSentenceLineShare >= 0.7 ? 'Almost every line is one sentence.' : 'Your lines often hold one or two sentences.')
  if (typeof s.questionsPer100Words === 'number') out.push(s.questionsPer100Words >= 1 ? 'You ask questions often.' : 'You use questions sparingly.')
  if (typeof s.usesContractions === 'boolean') out.push(s.usesContractions ? 'You write "don\'t" and "it\'s", not "do not" and "it is".' : 'You rarely shorten words like "do not".')
  if (s.spelling === 'british') out.push('You use British spelling (organise, behaviour).')
  if (s.spelling === 'american') out.push('You use American spelling (organize, behavior).')
  if (s.emoji === false && s.hashtags === false) out.push('No emojis or hashtags.')
  return out
}

/**
 * "Your voice, as Hiba sees it": what Hiba learned from the person's writing sample and approved
 * LinkedIn posts, and uses in every draft and comment. They can ask Hiba to study it again.
 * Loaded on its own: if migration 0015 is not run yet, only this card says it is not available.
 */
export function VoiceSettings() {
  const { session } = useSession()
  const userId = session?.user.id
  const online = useOnline()
  const queryClient = useQueryClient()
  const voice = useQuery({
    queryKey: ['profile-voice', userId],
    enabled: Boolean(userId),
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('voice_profile, voice_profile_at').eq('id', userId as string).maybeSingle()
      if (error) throw error
      return (data ?? { voice_profile: null, voice_profile_at: null }) as SavedVoice
    },
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expired, setExpired] = useState(false)
  const [reset, setReset] = useState(false)

  async function studyAgain() {
    if (!navigator.onLine) { setError('You are offline. Reconnect, then try again.'); return }
    setBusy(true)
    setError(null)
    const { error: e } = await supabase.from('profiles')
      .update({ voice_profile: null, voice_profile_at: null, voice_sources_hash: null }).eq('id', userId as string)
    setBusy(false)
    if (e) {
      if (e.code === 'PGRST301' || /jwt/i.test(e.message)) setExpired(true)
      else setError('That did not work. Please try again.')
      return
    }
    setReset(true)
    await queryClient.invalidateQueries({ queryKey: ['profile-voice', userId] })
  }

  const title = <h2 id="voice-title" className="text-lg font-semibold text-[var(--color-text-primary)]">Your voice, as Hiba sees it</h2>

  if (voice.isError) {
    return (
      <Card aria-labelledby="voice-title">
        {title}
        <p className="text-sm text-[var(--color-text-secondary)]">This cannot be shown just now. Hiba still writes in your voice using your writing sample. Please try again later.</p>
      </Card>
    )
  }

  if (voice.isPending) {
    return (
      <Card aria-labelledby="voice-title">
        {title}
        <div className="mt-2 space-y-2" aria-label="Loading your voice">
          <div className="h-4 w-3/4 animate-pulse rounded bg-[var(--color-border)]" />
          <div className="h-4 w-1/2 animate-pulse rounded bg-[var(--color-border)]" />
        </div>
      </Card>
    )
  }

  const saved = voice.data.voice_profile
  const d = saved?.description ?? {}
  const facts = statLines(saved?.stats ?? {})
  const rows: [string, string][] = ([
    ['Rhythm', text(d.cadence)], ['Sentences', text(d.sentence_style)], ['Words you choose', text(d.vocabulary)],
    ['How you come across', text(d.nuance)], ['How you open', text(d.openings)], ['How you close', text(d.endings)],
  ] as [string, string][]).filter(([, v]) => v)
  const phrases = list(d.signature_phrases)
  const avoid = list(d.avoid)

  if (!saved || (!rows.length && !facts.length)) {
    return (
      <Card aria-labelledby="voice-title">
        {title}
        {reset && <p role="status" className="mt-1 flex items-center gap-1 text-sm text-[var(--color-primary-dark)]"><Check size={14} aria-hidden="true" /> Done. Hiba will study your writing again on your next draft.</p>}
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          Hiba has not studied your writing yet. It does this on your next draft, from your writing sample (under
          Profile and preferences) and the LinkedIn posts you approve. The more you write and approve, the closer it gets.
        </p>
      </Card>
    )
  }

  const when = voice.data.voice_profile_at ? new Date(voice.data.voice_profile_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : null
  return (
    <Card aria-labelledby="voice-title">
      {title}
      <p className="mt-0.5 text-sm text-[var(--color-text-secondary)]">
        Hiba uses this in every draft and comment. It comes from your own writing{saved.sources ? ` (${saved.sources} piece${saved.sources === 1 ? '' : 's'})` : ''}
        {when ? `, last studied on ${when}` : ''}. It is studied again each week, and whenever you change your writing sample.
      </p>

      {facts.length > 0 && (
        <ul className="mt-3 list-disc space-y-0.5 pl-5 text-sm text-[var(--color-text-primary)]">
          {facts.map((f) => <li key={f}>{f}</li>)}
        </ul>
      )}
      {rows.length > 0 && (
        <dl className="mt-3 space-y-2 text-sm">
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt className="font-semibold text-[var(--color-text-primary)]">{k}</dt>
              <dd className="text-[var(--color-text-secondary)]">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {phrases.length > 0 && (
        <div className="mt-3 text-sm">
          <p className="font-semibold text-[var(--color-text-primary)]">Phrases that are yours</p>
          <p className="text-[var(--color-text-secondary)]">{phrases.map((p) => `"${p}"`).join(', ')}</p>
        </div>
      )}
      {avoid.length > 0 && (
        <div className="mt-3 text-sm">
          <p className="font-semibold text-[var(--color-text-primary)]">Hiba avoids</p>
          <p className="text-[var(--color-text-secondary)]">{avoid.join('; ')}</p>
        </div>
      )}

      <p className="mt-3 text-xs text-[var(--color-text-secondary)]">Does this not sound like you? Update your writing sample, or ask Hiba to study your writing again.</p>
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
      {expired && (
        <p role="alert" className="mt-2 flex flex-wrap items-center gap-2 text-sm text-red-700">
          Your session expired. Sign in again, then try again. <SignInAgainButton />
        </p>
      )}
      <button type="button" onClick={studyAgain} disabled={busy || !online}
        className="mt-3 inline-flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-[var(--color-primary-dark)] disabled:cursor-not-allowed disabled:opacity-50">
        {busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <RotateCcw size={16} aria-hidden="true" />}
        {busy ? 'Working...' : 'Study my writing again'}
      </button>
      {!online && <p role="status" className="mt-1 text-sm text-amber-800">You are offline. Reconnect to use this.</p>}
    </Card>
  )
}
