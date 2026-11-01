export type StepKind = 'text' | 'longtext' | 'multi' | 'single'
export type Answers = Record<string, string | string[]>

export interface StepOption {
  value: string
  label: string
}

export interface OnboardingStep {
  id: string
  category: string
  title: string
  description: string
  label: string
  kind: StepKind
  required: boolean
  placeholder?: string
  maxLength?: number
  options?: StepOption[]
  maxSelect?: number
}

// The whole journey is driven by this list. Add, remove or reorder steps here only.
export const STEPS: OnboardingStep[] = [
  {
    id: 'preferredName',
    category: 'Personal Identity',
    title: 'What should I call you?',
    description:
      'Identify yourself so Hiba can personalize conversations, draft intros, and sign-offs in your authentic tone.',
    label: 'Preferred name',
    kind: 'text',
    required: true,
    maxLength: 60,
    placeholder: 'Your name',
  },
  {
    id: 'craft',
    category: 'Personal Identity',
    title: 'What do you do?',
    description: 'Your role or craft in a line. Hiba uses it to frame your posts with the right authority.',
    label: 'Role or craft',
    kind: 'text',
    required: true,
    maxLength: 120,
    placeholder: 'e.g. Product mentor and founder',
  },
  {
    id: 'topics',
    category: 'Content Focus',
    title: 'What do you write about?',
    description: 'List the topics you want to be known for. Separate them with commas.',
    label: 'Core topics',
    kind: 'longtext',
    required: true,
    maxLength: 400,
    placeholder: 'e.g. product management, mentoring, AI for founders',
  },
  {
    id: 'audience',
    category: 'Content Focus',
    title: 'Who are you writing for?',
    description: 'Describe the people you want to reach so every draft speaks to them.',
    label: 'Target audience',
    kind: 'longtext',
    required: true,
    maxLength: 400,
    placeholder: 'e.g. early-career product managers and first-time founders',
  },
  {
    id: 'platforms',
    category: 'Channels',
    title: 'Where do you publish?',
    description: 'Pick every channel Hiba should write for.',
    label: 'Platforms',
    kind: 'multi',
    required: true,
    options: [
      { value: 'linkedin', label: 'LinkedIn' },
      { value: 'x', label: 'X (Threads)' },
      { value: 'substack', label: 'Substack' },
    ],
  },
  {
    id: 'tone',
    category: 'Voice',
    title: 'How do you sound?',
    description: 'Choose up to three tones that feel most like you.',
    label: 'Tone archetypes',
    kind: 'multi',
    required: true,
    maxSelect: 3,
    options: [
      { value: 'authentic-founder', label: 'Authentic Founder' },
      { value: 'insightful', label: 'Insightful' },
      { value: 'punchy', label: 'Punchy' },
      { value: 'educational', label: 'Educational' },
      { value: 'warm', label: 'Warm' },
      { value: 'bold', label: 'Bold' },
    ],
  },
  {
    id: 'voiceSample',
    category: 'Voice',
    title: 'Show me your voice',
    description:
      'Paste or speak a post you are proud of. This trains your voice match. You can skip it and add one later.',
    label: 'Writing sample',
    kind: 'longtext',
    required: false,
    maxLength: 3000,
    placeholder: 'Paste a post you wrote, or tap the mic and speak',
  },
  {
    id: 'publishingMode',
    category: 'Publishing',
    title: 'How should Hiba publish?',
    description: 'You can change this any time in Settings.',
    label: 'Publishing mode',
    kind: 'single',
    required: true,
    options: [
      { value: 'approve', label: 'Ask me to approve every post' },
      { value: 'autopilot', label: 'Publish automatically on schedule' },
    ],
  },
]

// Strip control characters and trim. React escapes output, so this is defence in depth.
export function sanitizeText(raw: string, multiline: boolean): string {
  let out = ''
  for (const ch of raw) {
    const code = ch.charCodeAt(0)
    const isControl = code < 32 || code === 127
    out += isControl && !(multiline && code === 10) ? ' ' : ch
  }
  return out.trim()
}

export function isAnswered(value: string | string[] | undefined): boolean {
  if (Array.isArray(value)) return value.length > 0
  return Boolean(value && value.trim().length > 0)
}

export function validateStep(step: OnboardingStep, value: string | string[] | undefined): string | null {
  if (!isAnswered(value)) return step.required ? 'Please answer this to continue.' : null
  if (typeof value === 'string' && step.maxLength && value.length > step.maxLength) {
    return `Please keep this under ${step.maxLength} characters.`
  }
  if (Array.isArray(value)) {
    const allowed = new Set(step.options?.map((o) => o.value))
    if (value.some((v) => !allowed.has(v))) return 'Please choose from the options shown.'
    if (step.maxSelect && value.length > step.maxSelect) return `Choose up to ${step.maxSelect}.`
  }
  if (step.kind === 'single') {
    const allowed = step.options?.some((o) => o.value === value)
    if (!allowed) return 'Please choose one option.'
  }
  return null
}
