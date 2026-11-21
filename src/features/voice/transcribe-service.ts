import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { whenAvailable } from '@/features/content/api/content-service'

export type TranscribeErrorCode =
  | 'offline' | 'session_expired' | 'too_large' | 'rate_limited' | 'not_configured' | 'failed' | 'empty' | 'busy' | 'daily_limit'

export class TranscribeError extends Error {
  readonly code: TranscribeErrorCode
  constructor(code: TranscribeErrorCode) {
    super(code)
    this.code = code
  }
}

/** When the next voice recording is allowed (from the last daily-limit answer). */
let voiceNextAt: string | null = null

/** Plain messages. Every one says the recording is kept, because it is: "Try again" resends it. */
export const TRANSCRIBE_ERROR_TEXT: Record<TranscribeErrorCode, string> = {
  offline: 'You are offline. Your recording is kept. Reconnect, then tap "Try again".',
  session_expired: 'Your session expired. Sign in again, then record once more.',
  too_large: 'That recording is too long. Please keep it under 5 minutes.',
  rate_limited: 'You have used voice a lot this hour. Please wait a little, or type your idea.',
  not_configured: 'Voice is not available right now. Please type your idea for now.',
  failed: 'I could not turn your recording into text. Your recording is kept. Tap "Try again".',
  busy: 'Hiba is very busy right now. Your recording is kept. Tap "Try again" in a minute.',
  get daily_limit() {
    return `You have used all of today's voice recordings. You can record again ${whenAvailable(voiceNextAt)}.`
  },
  empty: 'I could not hear any words in that recording. Please try again a little closer to the microphone.',
}

/** Sends one recording to the server, which asks OpenAI for the text. */
export async function transcribeAudio(audio: Blob, seconds?: number): Promise<string> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) throw new TranscribeError('offline')
  const form = new FormData()
  form.append('audio', audio, 'recording')
  // The recording's length, so the cost of each recording can be recorded.
  if (seconds && seconds > 0) form.append('seconds', String(Math.round(seconds)))
  const { data, error } = await supabase.functions.invoke<{ text: string }>('transcribe', { body: form })
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const res = error.context as Response
      let code = ''
      try {
        const payload = (await res.json()) as { error?: string; nextAt?: string }
        code = payload.error ?? ''
        if (code === 'daily_limit') voiceNextAt = payload.nextAt ?? null
      } catch {
        // Not JSON; use the status below.
      }
      if (res.status === 401 || code === 'unauthorized') throw new TranscribeError('session_expired')
      if (res.status === 413 || code === 'too_large') throw new TranscribeError('too_large')
      if (code === 'daily_limit') throw new TranscribeError('daily_limit')
      if (code === 'rate_limited') throw new TranscribeError('rate_limited')
      if (code === 'busy') throw new TranscribeError('busy')
      if (code === 'not_configured') throw new TranscribeError('not_configured')
      throw new TranscribeError('failed')
    }
    if (typeof navigator !== 'undefined' && !navigator.onLine) throw new TranscribeError('offline')
    throw new TranscribeError('failed')
  }
  const text = data?.text?.trim() ?? ''
  if (!text) throw new TranscribeError('empty')
  return text
}
