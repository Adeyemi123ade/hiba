export type StepKind = 'text' | 'longtext' | 'multi' | 'single'
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
    options: [o('Build credibility', 'shield', 'Establish trust and be seen as an expert.'),
      o('Expand my network', 'network', 'Connect with the right people and communities.'),
      o('Discover new opportunities', 'briefcase', 'Open doors to career and business growth.'),
      o('Attract clients', 'user-plus', 'Bring in more of the right clients.'),
      o('Share what I know', 'book', 'Teach, inspire, and create impact.'),
      o('Grow my audience', 'trending', 'Increase reach and engagement over time.'),
      o('Become more visible', 'eye', 'Show up consistently and stay top of mind.')],
    tip: { title: 'You can change this anytime', text: 'Your goals shape the ideas Hiba suggests.' },
  },
  {
    id: 'audience', icon: 'users', kind: 'multi', required: true, display: 'icons', allowCustom: true,
    maxSelect: 5,
    title: 'Who would you like to reach most?',
    description: 'Select all that apply (up to 5). Knowing your audience helps me create content that speaks to the people who matter to you.',
    label: 'Your audience', customLabel: 'Add another audience',
    options: [o('Founders', 'rocket'), o('Investors', 'trending'), o('Aspiring product managers', 'target'),
      o('Product leaders', 'sliders'), o('Designers', 'palette'), o('Engineers', 'zap'),
      o('Students', 'cap'), o('Marketers', 'megaphone'), o('Business owners', 'building'),
      o('Recruiters', 'briefcase'), o('Clients and customers', 'user-plus'), o('Just sharing my journey', 'heart')],
    tip: { title: 'Tip', text: 'You can always update this later in your settings.' },
  },
  {
    id: 'tone', icon: 'chat', kind: 'multi', required: true, allowCustom: true, maxSelect: 3,
    title: 'How should your content feel?',
    description: 'Pick the vibe that feels most like you (up to 3). You can change this anytime.',
    label: 'Your vibe', customLabel: 'Or describe your own',
    options: [o('Warm and human', 'heart'), o('Authentic', 'check'), o('Professional', 'briefcase'),
      o('Formal', 'building'), o('Firm and confident', 'shield'), o('Friendly', 'smile'), o('Bold', 'zap'),
      o('Thoughtful', 'lightbulb'), o('Conversational', 'chat'), o('Practical', 'star'),
      o('Inspiring', 'sparkles'), o('Funny', 'smile')],
    tip: { title: 'What this does', text: 'Hiba writes captions, stories and posts that sound natural and consistent with your personality.' },
  },
  {
    id: 'topics', icon: 'pen', kind: 'multi', required: true, allowCustom: true, maxSelect: 6,
    title: 'What subjects do you enjoy talking about?',
    description: 'Pick the topics you care about most (up to 6). I will organize your ideas around them.',
    label: 'Your topics', customLabel: 'Add a topic',
    options: [o('Product strategy'), o('AI and technology'), o('Leadership'), o('Data and analytics'),
      o('Startups'), o('User research'), o('Growth'), o('Career growth'), o('Marketing'), o('Design'),
      o('Innovation'), o('Communication'), o('Remote work'), o('Project management'), o('Mentoring'),
      o('Fundraising')],
    tip: { title: 'Why this matters', text: 'The more I know about your interests, the better I can recommend ideas that resonate with your audience.' },
  },
  {
    id: 'platforms', icon: 'link', kind: 'multi', required: false, display: 'platforms',
    title: 'Choose where you would like to publish',
    description: 'Pick one or more platforms now, or come back whenever you are ready.',
    label: 'Your platforms',
    options: [o('LinkedIn'), o('X (Twitter)'), o('Substack')],
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
    options: [o('I will review every post', 'user', 'Nothing is published until you approve it.'),
      o('Publish automatically after review rules', 'shield', 'Posts that pass your rules go out on schedule.'),
      o('Let Hiba manage it intelligently', 'sparkles', 'Hiba decides, and asks you only when unsure.')],
    tip: { title: 'You are always in control', text: 'You can pause or change this whenever you like.' },
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
