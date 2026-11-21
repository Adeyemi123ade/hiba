import { useCallback, useEffect, useRef, useState } from 'react'
import { TRANSCRIBE_ERROR_TEXT, TranscribeError, transcribeAudio } from '@/features/voice/transcribe-service'

/** Longest recording, so the file stays well under the server's 10 MB limit. */
export const MAX_SECONDS = 5 * 60
const MIN_MS = 1000

/** Recording formats in order of preference. Safari records mp4; Chrome, Edge and Firefox record webm. */
const MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return undefined
  return MIME_TYPES.find((t) => MediaRecorder.isTypeSupported(t))
}

const MIC_ERRORS: Record<string, string> = {
  NotAllowedError: 'Microphone is blocked. Click the lock icon in the address bar and allow the microphone.',
  SecurityError: 'Microphone is blocked. Click the lock icon in the address bar and allow the microphone.',
  NotFoundError: 'No microphone was found on this device.',
  NotReadableError: 'Your microphone is being used by another app. Close it, then try again.',
}

export const formatSeconds = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

/**
 * Voice input. Records the person's voice, then sends it to OpenAI's transcription service
 * (through Hiba's server) for far better accuracy than the browser's own voice typing.
 * `onText` receives the finished text. The last recording is kept, so a failed attempt can be retried.
 */
export function useSpeechInput(onText: (text: string) => void) {
  const supported =
    typeof window !== 'undefined' && typeof MediaRecorder !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia)
  const [listening, setListening] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [canRetry, setCanRetry] = useState(false)
  const recorder = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const chunks = useRef<Blob[]>([])
  const lastAudio = useRef<Blob | null>(null)
  const startedAt = useRef(0)
  // Length of the last recording in seconds, sent with it (also on "Try again").
  const lastLength = useRef(0)
  const discard = useRef(false)
  const tick = useRef<ReturnType<typeof setInterval> | null>(null)
  const cbRef = useRef(onText)
  useEffect(() => {
    cbRef.current = onText
  }, [onText])

  const releaseMic = useCallback(() => {
    if (tick.current) clearInterval(tick.current)
    tick.current = null
    stream.current?.getTracks().forEach((t) => t.stop())
    stream.current = null
  }, [])

  // Leaving the page while recording: stop and throw the recording away, and free the microphone.
  useEffect(() => () => {
    discard.current = true
    if (recorder.current?.state === 'recording') recorder.current.stop()
    releaseMic()
  }, [releaseMic])

  const send = useCallback(async (audio: Blob) => {
    setTranscribing(true)
    setError(null)
    setCanRetry(false)
    try {
      const text = await transcribeAudio(audio, lastLength.current)
      lastAudio.current = null
      cbRef.current(text)
    } catch (e) {
      const code = e instanceof TranscribeError ? e.code : 'failed'
      setError(TRANSCRIBE_ERROR_TEXT[code])
      setCanRetry(code === 'offline' || code === 'failed' || code === 'busy')
    } finally {
      setTranscribing(false)
    }
  }, [])

  /** Finish recording and turn it into text. */
  const stop = useCallback(() => {
    if (recorder.current?.state === 'recording') recorder.current.stop()
  }, [])

  /** Stop and throw the recording away (for example "Capture another idea"). */
  const cancel = useCallback(() => {
    discard.current = true
    if (recorder.current?.state === 'recording') recorder.current.stop()
    lastAudio.current = null
    setCanRetry(false)
    setError(null)
  }, [])

  const start = useCallback(async () => {
    setError(null)
    setCanRetry(false)
    let media: MediaStream
    try {
      media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
    } catch (e) {
      const name = e instanceof DOMException ? e.name : ''
      setError(MIC_ERRORS[name] ?? 'The microphone could not start. Please try again, or type instead.')
      return
    }
    const mimeType = pickMimeType()
    let rec: MediaRecorder
    try {
      rec = new MediaRecorder(media, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 64_000 })
    } catch {
      media.getTracks().forEach((t) => t.stop())
      setError('Recording is not supported in this browser. Please type instead.')
      return
    }
    stream.current = media
    chunks.current = []
    discard.current = false
    rec.ondataavailable = (ev) => { if (ev.data.size > 0) chunks.current.push(ev.data) }
    rec.onstop = () => {
      releaseMic()
      setListening(false)
      if (discard.current) return
      const audio = new Blob(chunks.current, { type: rec.mimeType || mimeType || 'audio/webm' })
      if (Date.now() - startedAt.current < MIN_MS || audio.size === 0) {
        setError('That was too short. Tap the mic, say your idea, then tap stop.')
        return
      }
      lastAudio.current = audio
      lastLength.current = (Date.now() - startedAt.current) / 1000
      void send(audio)
    }
    recorder.current = rec
    startedAt.current = Date.now()
    setSeconds(0)
    rec.start(1000)
    setListening(true)
    tick.current = setInterval(() => {
      const s = Math.floor((Date.now() - startedAt.current) / 1000)
      setSeconds(s)
      if (s >= MAX_SECONDS && rec.state === 'recording') rec.stop()
    }, 250)
  }, [releaseMic, send])

  const toggle = useCallback(() => {
    if (transcribing) return
    if (listening) stop()
    else void start()
  }, [listening, transcribing, start, stop])

  /** Sends the last recording again after a failure. */
  const retry = useCallback(() => {
    if (lastAudio.current && !transcribing) void send(lastAudio.current)
  }, [send, transcribing])

  const interim = listening
    ? `Recording ${formatSeconds(seconds)} of ${formatSeconds(MAX_SECONDS)}. Tap stop when you are done.`
    : transcribing ? 'Turning your voice into text...' : ''

  return { supported, listening, transcribing, seconds, interim, error, canRetry, toggle, stop, cancel, retry }
}
