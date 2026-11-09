export type StepKind = 'text' | 'longtext' | 'multi' | 'single' | 'prefs'
export type StepDisplay = 'chips' | 'cards' | 'icons' | 'platforms' | 'list'
export type Answers = Record<string, string | string[]>

export interface StepOption {
  value: string
  label: string
  icon?: string
  description?: string
}

export interface OnboardingStep {
  id: string
  title: string
  description: string
  label: string
  icon: string
  kind: StepKind
  required: boolean
  display?: StepDisplay
  placeholder?: string
  maxLength?: number
  options?: StepOption[]
  maxSelect?: number
  allowCustom?: boolean
  customLabel?: string
  tip: { title: string; text: string }
}

export const CUSTOM_MAX = 60

const slug = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const o = (label: string, icon?: string, description?: string): StepOption => ({
  value: slug(label), label, icon, description,
})
// Same as o(), but keeps an existing saved value so earlier answers still match.
const ov = (value: string, label: string, icon?: string, description?: string): StepOption => ({
  value, label, icon, description,
})

// The whole journey is driven by this list. Add, remove or reorder steps here only.
export const STEPS: OnboardingStep[] = [
  {
    id: 'preferredName', icon: 'user', kind: 'text', required: true, maxLength: 60,
    title: 'What should I call you?',
    description: 'Tell me your preferred name. I will use it across your workspace.',
    label: 'Preferred name', placeholder: 'Enter your name',
    tip: { title: 'This helps me personalize your experience', text: 'and make every suggestion more relevant to you.' },
  },
  {
    id: 'craft', icon: 'briefcase', kind: 'multi', required: true, maxSelect: 3, allowCustom: true,
    title: 'What do you do?',
    description: 'Pick what fits you best (up to 3), or write your own.',
    label: 'Your profession', customLabel: 'Or type your own, e.g. Brand Strategist',
    options: [o('Product Manager', 'target'), o('Project Manager', 'sliders'), o('Product Designer', 'palette'),
      o('Software Engineer', 'zap'), o('Founder or CEO', 'rocket'), o('Marketer', 'megaphone'),
      o('Data or AI Specialist', 'sparkles'), o('Consultant or Coach', 'users'),
      o('Student or Career Starter', 'cap'), o('Content Creator', 'pen')],
    tip: { title: 'Do not worry about the perfect title', text: 'You can always update this later.' },
  },
  {
    id: 'intro', icon: 'message', kind: 'longtext', required: false, maxLength: 200,
    title: 'How do you usually introduce yourself?',
    description: 'Share one or two sentences about what you do and the value you bring. You can refine this anytime.',
    label: 'Your introduction',
    placeholder: 'e.g. I help startups build products customers love by combining user insights with data-driven decisions.',
    tip: { title: 'Tip', text: 'Focus on what you do, who you help, and the impact you create.' },
  },
  {
    id: 'goals', icon: 'target', kind: 'multi', required: true, display: 'cards', allowCustom: true,
    maxSelect: 4,
    title: 'What are you working toward?',
    description: 'Select the outcomes that matter most to you (up to 4). This helps me create content that moves you closer to your goals.',
    label: 'Your goals', customLabel: 'Add my own goal',
    options: [ov('build-credibility', 'Building credibility', 'shield', 'Be trusted for what you know.'),
      ov('expand-my-network', 'Expanding my professional network', 'network', 'Connect with the right people.'),
      ov('attract-clients', 'Attracting clients', 'user-plus', 'Bring in more of the right clients.'),
      ov('discover-new-opportunities', 'Discovering opportunities', 'briefcase', 'Open doors to new roles and deals.'),
      ov('share-what-i-know', 'Sharing knowledge', 'book', 'Teach and help others grow.'),
      ov('grow-my-audience', 'Growing an audience', 'trending', 'Reach more people over time.'),
      o('Becoming known for expertise', 'star', 'Be the person people think of first.'),
      o('Promoting a business or product', 'megaphone', 'Tell people what you are building.')],
    tip: { title: 'You can change this anytime', text: 'Your goals shape the ideas Hiba suggests.' },
  },
  {
    id: 'audience', icon: 'users', kind: 'multi', required: true, display: 'icons', allowCustom: true,
    maxSelect: 5,
    title: 'Who would you like to reach most?',
    description: 'Select all that apply (up to 5). Knowing your audience helps me create content that speaks to the people who matter to you.',
    label: 'Your audience', customLabel: 'Add another audience',
    options: [o('Recruiters', 'briefcase'), o('Founders', 'rocket'), o('Investors', 'trending'),
      o('Product managers', 'target'), o('Aspiring product managers', 'cap'), o('Designers', 'palette'),
      o('Engineers', 'zap'), o('Business owners', 'building'),
      ov('clients-and-customers', 'Potential customers', 'user-plus'), o('Industry professionals', 'users')],
    tip: { title: 'Tip', text: 'You can always update this later in your settings.' },
  },
  {
    id: 'tone', icon: 'chat', kind: 'multi', required: true, allowCustom: true, maxSelect: 3,
    title: 'How should your content feel?',
    description: 'Pick the vibe that feels most like you (up to 3). You can change this anytime.',
    label: 'Your vibe', customLabel: 'Or describe your own',
    options: [ov('warm-and-human', 'Warm', 'heart'), o('Personal', 'user'), o('Practical', 'star'),
      o('Generous', 'heart'), o('Thoughtful', 'lightbulb'), o('Conversational', 'chat'),
      o('Educational', 'book'), o('Inspiring', 'sparkles'), o('Direct', 'zap'),
      o('Professional', 'briefcase'), ov('funny', 'Humorous', 'smile'), o('Story-driven', 'pen')],
    tip: { title: 'What this does', text: 'Hiba writes captions, stories and posts that sound natural and consistent with your personality.' },
  },
  {
    id: 'topics', icon: 'pen', kind: 'multi', required: true, allowCustom: true, maxSelect: 6,
    title: 'What subjects do you enjoy talking about?',
    description: 'Pick the topics you care about most (up to 6). I will organize your ideas around them.',
    label: 'Your topics', customLabel: 'Add a topic',
    options: [o('Product management'), o('Leadership'), o('User research'), o('Product strategy'),
      o('Entrepreneurship'), o('Career growth'), ov('ai-and-technology', 'Technology'), o('Business'),
      o('Personal development'), o('Industry experiences'), o('Lessons from building products')],
    tip: { title: 'Why this matters', text: 'The more I know about your interests, the better I can recommend ideas that resonate with your audience.' },
  },
  {
    id: 'platforms', icon: 'link', kind: 'multi', required: false, display: 'platforms',
    title: 'Choose where you would like to publish',
    description: 'Pick one or more platforms now, or come back whenever you are ready.',
    label: 'Your platforms',
    options: [o('LinkedIn', undefined, 'Connect your account and post directly.'),
      o('X (Twitter)', undefined, 'Drafts you copy and paste yourself.'),
      o('Substack', undefined, 'Drafts you copy and paste yourself.')],
    tip: { title: 'We keep your connections safe', text: 'Hiba only posts with your permission. You can remove any account anytime.' },
  },
  {
    id: 'frequency', icon: 'calendar', kind: 'single', required: true, display: 'list',
    title: 'How often do you want to post?',
    description: 'This helps me plan a content schedule you can actually stick to.',
    label: 'Posting frequency',
    options: [o('1-2 times per day', 'calendar'), o('3-5 times per week', 'calendar'),
      o('1-2 times per week', 'calendar'), o('2-3 times per month', 'calendar'), o('I will decide later', 'calendar')],
    tip: { title: 'Why this matters', text: 'A consistent posting rhythm helps build trust, visibility and engagement over time.' },
  },
  {
    id: 'approval', icon: 'sliders', kind: 'single', required: true, display: 'list',
    title: 'Who decides when a post goes out?',
    description: 'You stay in control. You can change this any time in Settings.',
    label: 'Final approval',
    options: [ov('i-will-review-every-post', 'Review every post', 'user', 'Nothing is published until you approve it.'),
      o('Publish automatically', 'shield', 'Approved posts go out on your schedule. Only works once LinkedIn is connected.')],
    tip: { title: 'You are always in control', text: 'You can pause or change this whenever you like.' },
  },
  {
    id: 'workingPrefs', icon: 'clock', kind: 'prefs', required: true,
    title: 'How should Hiba work for you?',
    description: 'Choose how much Hiba does on its own, and when you like your posts to go out.',
    label: 'Your working preferences',
    tip: { title: 'Change it any time', text: 'These settings only shape suggestions. Nothing is posted without your rules.' },
  },
  {
    id: 'writingSample', icon: 'pen', kind: 'longtext', required: false, maxLength: 3000,
    title: 'Will you like to paste something you have written before?',
    description: 'Paste a post you are happy with. I will study your tone, pacing and writing habits so future drafts sound more like you.',
    label: 'Something you wrote', placeholder: 'Paste your post here, or tap the mic and speak',
    tip: { title: 'Your content stays private', text: 'This helps me learn your style better. I will never share it.' },
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

// Working preferences (HPD-37) are stored as "key=value" entries so they fit the answers format.
export interface WorkingPrefs {
  autoDraft: boolean
  bestTimes: boolean
  postingTime: string
  timezone: string
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

function detectTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

export function defaultPrefs(): WorkingPrefs {
  return { autoDraft: true, bestTimes: true, postingTime: '09:00', timezone: detectTimezone() }
}

export function readPrefs(value: string | string[] | undefined): WorkingPrefs {
  const prefs = defaultPrefs()
  if (!Array.isArray(value)) return prefs
  for (const entry of value) {
    const [key, ...rest] = entry.split('=')
    const v = rest.join('=')
    if (key === 'autoDraft' || key === 'bestTimes') prefs[key] = v === 'on'
    if (key === 'postingTime' && TIME_RE.test(v)) prefs.postingTime = v
    if (key === 'timezone' && v && v.length <= 64) prefs.timezone = v
  }
  return prefs
}

export function writePrefs(prefs: WorkingPrefs): string[] {
  return [
    `autoDraft=${prefs.autoDraft ? 'on' : 'off'}`,
    `bestTimes=${prefs.bestTimes ? 'on' : 'off'}`,
    `postingTime=${prefs.postingTime}`,
    `timezone=${prefs.timezone}`,
  ]
}

/** 24 hour "14:30" shown as "2:30 PM". */
export function formatTime(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number)
  const suffix = h < 12 ? 'AM' : 'PM'
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${suffix}`
}

// Readable names for options removed when the lists moved to the Jira versions (9 Nov 2026),
// so earlier answers still read well. They behave like the person's own answers.
const LEGACY_LABELS: Record<string, string> = {
  'become-more-visible': 'Become more visible',
  'product-leaders': 'Product leaders', students: 'Students', marketers: 'Marketers',
  'just-sharing-my-journey': 'Just sharing my journey',
  authentic: 'Authentic', formal: 'Formal', 'firm-and-confident': 'Firm and confident', friendly: 'Friendly', bold: 'Bold',
  'data-and-analytics': 'Data and analytics', startups: 'Startups', growth: 'Growth', marketing: 'Marketing',
  design: 'Design', innovation: 'Innovation', communication: 'Communication', 'remote-work': 'Remote work',
  'project-management': 'Project management', mentoring: 'Mentoring', fundraising: 'Fundraising',
}

/** Display name for a saved value: current option, then removed option, then the person's own words. */
export function labelFor(step: OnboardingStep, value: string): string {
  return step.options?.find((o) => o.value === value)?.label ?? LEGACY_LABELS[value] ?? value
}

/** Plain-language summary of one answer, for the review screen. */
export function formatAnswer(step: OnboardingStep, value: string | string[] | undefined): string {
  if (step.kind === 'prefs') {
    const p = readPrefs(value)
    return [
      `Automatic drafts ${p.autoDraft ? 'on' : 'off'}`,
      `Suggested best times ${p.bestTimes ? 'on' : 'off'}`,
      `Preferred time ${formatTime(p.postingTime)} (${p.timezone})`,
    ].join(' · ')
  }
  if (!isAnswered(value)) return 'Not answered'
  const labelOf = (v: string) => labelFor(step, v)
  return Array.isArray(value) ? value.map(labelOf).join(', ') : step.options ? labelOf(value as string) : (value as string)
}

/**
 * Drops saved answers that no longer match the current options (for example after the
 * option lists changed), so the person is asked that question again instead of being stuck.
 */
export function normalizeAnswers(saved: Answers): Answers {
  const out: Answers = { ...saved }
  for (const step of STEPS) {
    const v = out[step.id]
    if (v === undefined) continue
    if (step.kind === 'single' && !step.options?.some((o) => o.value === v)) delete out[step.id]
    if (step.kind === 'multi' && Array.isArray(v) && !step.allowCustom) {
      const kept = v.filter((x) => step.options?.some((o) => o.value === x))
      if (kept.length) out[step.id] = kept
      else delete out[step.id]
    }
  }
  return out
}

export function isAnswered(value: string | string[] | undefined): boolean {
  if (Array.isArray(value)) return value.length > 0
  return Boolean(value && value.trim().length > 0)
}

export function validateStep(step: OnboardingStep, value: string | string[] | undefined): string | null {
  if (step.kind === 'prefs') {
    if (!Array.isArray(value)) return 'Please check your preferences.'
    const p = readPrefs(value)
    const time = value.find((e) => e.startsWith('postingTime='))?.slice('postingTime='.length)
    if (!time || !TIME_RE.test(time) || time !== p.postingTime) return 'Please choose a time, for example 9:00 AM.'
    return null
  }
  if (!isAnswered(value)) return step.required ? 'Please answer this to continue.' : null
  if (typeof value === 'string' && step.maxLength && value.length > step.maxLength) {
    return `Please keep this under ${step.maxLength} characters.`
  }
  if (Array.isArray(value)) {
    const allowed = new Set(step.options?.map((o) => o.value))
    const bad = value.some(
      (v) => !allowed.has(v) && !(step.allowCustom && v.length > 0 && v.length <= CUSTOM_MAX),
    )
    if (bad) {
      return step.allowCustom
        ? `Your own answers must be ${CUSTOM_MAX} characters or fewer.`
        : 'Please choose from the options shown.'
    }
    if (step.maxSelect && value.length > step.maxSelect) return `Choose up to ${step.maxSelect}.`
  }
  if (step.kind === 'single' && !step.options?.some((opt) => opt.value === value)) {
    return 'Please choose one option.'
  }
  return null
}
