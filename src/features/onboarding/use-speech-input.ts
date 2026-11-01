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
  onerror: (() => void) | null
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

/** Browser speech-to-text. Calls onText with each finalised phrase. */
export function useSpeechInput(onText: (text: string) => void) {
  const supported = typeof window !== 'undefined' && getCtor() !== null
  const [listening, setListening] = useState(false)
  const recRef = useRef<Recognition | null>(null)
  const cbRef = useRef(onText)
  useEffect(() => {
    cbRef.current = onText
  }, [onText])
  useEffect(() => () => recRef.current?.stop(), [])

  const toggle = useCallback(() => {
    if (listening) {
      recRef.current?.stop()
      return
    }
    const Ctor = getCtor()
    if (!Ctor) return
    const rec = new Ctor()
    rec.lang = navigator.language || 'en-US'
    rec.continuous = true
    rec.interimResults = false
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) cbRef.current(e.results[i][0].transcript)
      }
    }
    rec.onend = () => setListening(false)
    rec.onerror = () => setListening(false)
    recRef.current = rec
    rec.start()
    setListening(true)
  }, [listening])

  return { supported, listening, toggle }
}
