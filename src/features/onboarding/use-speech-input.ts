import { useCallback, useEffect, useRef, useState } from 'react'

interface SpeechResultEvent {
  resultIndex: number
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>
}
interface Recognition {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((e: SpeechResultEvent) => void) | null
  onend: (() => void) | null
  onerror: ((e: { error?: string }) => void) | null
  start: () => void
  stop: () => void
}
type RecognitionCtor = new () => Recognition

function getCtor(): RecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor
    webkitSpeechRecognition?: RecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

const ERRORS: Record<string, string> = {
  'not-allowed': 'Microphone is blocked. Click the lock icon in the address bar and allow the microphone.',
  'service-not-allowed': 'Microphone is blocked. Click the lock icon in the address bar and allow the microphone.',
  'no-speech': 'I did not hear anything. Tap the mic and try again.',
  'audio-capture': 'No microphone was found on this device.',
  network: 'Voice typing needs an internet connection.',
}

/** Browser speech-to-text. onText gets each finished phrase; `interim` is what is being heard right now. */
export function useSpeechInput(onText: (text: string) => void) {
  const supported = typeof window !== 'undefined' && getCtor() !== null
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [error, setError] = useState<string | null>(null)
  const recRef = useRef<Recognition | null>(null)
  const cbRef = useRef(onText)
  useEffect(() => {
    cbRef.current = onText
  }, [onText])
  useEffect(() => () => recRef.current?.stop(), [])

  const stop = useCallback(() => recRef.current?.stop(), [])

  const toggle = useCallback(() => {
    if (listening) {
      recRef.current?.stop()
      return
    }
    const Ctor = getCtor()
    if (!Ctor) return
    setError(null)
    const rec = new Ctor()
    rec.lang = navigator.language || 'en-US'
    rec.continuous = true
    rec.interimResults = true
    rec.onresult = (e) => {
      let heard = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const text = e.results[i][0].transcript
        if (e.results[i].isFinal) cbRef.current(text)
        else heard += text
      }
      setInterim(heard)
    }
    rec.onend = () => {
      setListening(false)
      setInterim('')
    }
    rec.onerror = (e) => {
      setError(ERRORS[e.error ?? ''] ?? 'Voice typing stopped unexpectedly. Please try again.')
      setListening(false)
      setInterim('')
    }
    recRef.current = rec
    rec.start()
    setListening(true)
  }, [listening])

  return { supported, listening, interim, error, toggle, stop }
}
