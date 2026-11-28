// The checks the drafting function (supabase/functions/generate-drafts) runs on what the AI
// writes: the owner's word limits and writing rules, and how its answers are read.
import { describe, expect, it } from 'vitest'
import './deno-stub'
import {
  ANGLE_KINDS, COMMENTS_MAX, buildCommentsPrompt, buildPrompt, commentProblems, excessWords, measureVoice, nextKinds, overLimits, parseAngles,
  parseClarify, parseComments, parseOneComment, qualityScore, recentFeedback, sourcesHash, styleProblems, voiceProblems,
  type AngleKind, type VoiceStats,
} from '../functions/generate-drafts/index.ts'

const words = (n: number, w = 'word') => Array(n).fill(w).join(' ')
type Drafts = Parameters<typeof styleProblems>[0]
const good: Drafts = {
  linkedin: 'I cancelled two standing meetings last week.\nMy team shipped faster.\n\nWhich meeting would you cancel first?',
  x: ['I cancelled two standing meetings.\nMy team shipped faster.', 'Which one would you cancel?'],
  substack: { title: 'Fewer meetings', body: 'I cancelled two meetings. The team shipped faster.\n\nHere is what changed.' },
}
const drafts = (d: Partial<Drafts>): Drafts => ({ ...good, ...d })

describe('word limits (LinkedIn 300, X 150 in total, Substack 3000)', () => {
  it('passes drafts at the limits', () => {
    const d = drafts({ linkedin: words(300), x: [words(100), words(50)], substack: { title: 'T', body: words(3000) } })
    expect(overLimits(d)).toEqual([])
    expect(excessWords(d)).toBe(0)
  })

  it('names each draft over its limit, with the numbers', () => {
    const d = drafts({ linkedin: words(301), x: [words(100), words(51)], substack: { title: 'T', body: words(3002) } })
    expect(overLimits(d)).toEqual([
      'LinkedIn was 301 words; the limit is 300',
      'the X thread was 151 words in total; the limit is 150',
      'Substack was 3002 words; the limit is 3000',
    ])
    expect(excessWords(d)).toBe(1 + 1 + 2)
  })
})

describe('writing rules', () => {
  it('finds nothing wrong with a draft that follows them', () => {
    expect(styleProblems(good)).toEqual([])
    expect(qualityScore(good)).toBe(0)
  })

  it('catches banned phrases, also with a curly apostrophe', () => {
    const problems = styleProblems(drafts({ linkedin: 'In today’s fast-paced world, focus wins.\n\nWhat do you focus on?' }))
    expect(problems).toContain('it used banned phrases: "in today\'s fast-paced world"')
  })

  it('catches lines with more than two sentences', () => {
    expect(styleProblems(drafts({ linkedin: 'One. Two. Three.\n\nWhat do you think about it?' })))
      .toContain('LinkedIn had 1 line(s) with more than two sentences')
  })

  it('does not count e.g. or Dr. as the end of a sentence', () => {
    expect(styleProblems(drafts({ linkedin: 'Ask Dr. Bello, e.g. on Monday. Then decide.\n\nWould you ask?' }))).toEqual([])
  })

  it('catches bullet points and numbered lines', () => {
    const problems = styleProblems(drafts({ linkedin: 'Three things:\n- focus\n2) rest\n\nWhich matters most?' }))
    expect(problems).toContain('it used bullets, dashes or numbers at the start of lines; put each point on its own plain line instead')
  })

  it('catches a blank line inside an X post', () => {
    expect(styleProblems(drafts({ x: ['First line.\n\nSecond line.'] })))
      .toContain('an X post contained a blank line; use single line breaks inside a post')
  })

  it('catches long Substack paragraphs', () => {
    expect(styleProblems(drafts({ substack: { title: 'T', body: 'One. Two. Three. Four.' } })))
      .toContain('Substack had 1 paragraph(s) with more than three sentences')
  })

  it('wants LinkedIn to end with a question, hashtags may follow it', () => {
    expect(styleProblems(drafts({ linkedin: 'I cancelled two meetings.\n\nThat is all.' })))
      .toContain('LinkedIn did not end with a specific question that invites readers to share')
    expect(styleProblems(drafts({ linkedin: 'I cancelled two meetings.\n\nWould you?\n\n#work #focus' }))).toEqual([])
  })

  it('weighs a broken rule far more than a few extra words', () => {
    expect(qualityScore(drafts({ linkedin: words(305) }))).toBeGreaterThan(25)
  })
})

describe('reading the AI clarifying question', () => {
  it('returns the question when the AI asked one instead of writing', () => {
    expect(parseClarify('{"clarify":" Who is this for? "}')).toBe('Who is this for?')
  })

  it('ignores it when drafts came too, or the answer is not JSON', () => {
    expect(parseClarify('{"clarify":"Who?","linkedin":"A post"}')).toBeNull()
    expect(parseClarify('not json')).toBeNull()
    expect(parseClarify('{"clarify":""}')).toBeNull()
  })
})

describe('angle ideas', () => {
  const all = Object.keys(ANGLE_KINDS) as AngleKind[]

  it('offers new kinds first, three at a time', () => {
    expect(nextKinds([])).toEqual(all.slice(0, 3))
    expect(nextKinds(all.slice(0, 3))).toEqual(all.slice(3, 6))
  })

  it('still offers three when almost every kind was used, so "more angles" always works', () => {
    const offered = nextKinds(all.slice(0, 7))
    expect(offered).toHaveLength(3)
    expect(offered[0]).toBe(all[7])
  })

  it('keeps one well-formed angle per requested kind and never invents text', () => {
    const raw = JSON.stringify({
      angles: [
        { kind: 'opinion', title: 'Meetings are a tax', summary: 'Why most should go.' },
        { kind: 'opinion', title: 'Duplicate', summary: 'Same kind again.' },
        { kind: 'personal_story', title: 'Not asked for', summary: 'Wrong kind.' },
        { kind: 'common_mistake', title: 'No summary' },
      ],
    })
    expect(parseAngles(raw, ['opinion', 'common_mistake'])).toEqual([
      { kind: 'opinion', title: 'Meetings are a tax', summary: 'Why most should go.' },
    ])
  })

  it('returns nothing when no angle is usable', () => {
    expect(parseAngles('{"angles":[]}', ['opinion'])).toBeNull()
    expect(parseAngles('{"other":1}', ['opinion'])).toBeNull()
    expect(parseAngles('nope', ['opinion'])).toBeNull()
  })
})

describe('the person\'s voice', () => {
  const sample = (spelling: string) =>
    `I don't plan every day. I ${spelling} my week on Sunday.\nIt's simple and it works.\n\nYou'll find your own rhythm. Start with one small change and keep it for a month.`

  it('needs at least 30 words of their writing', () => {
    expect(measureVoice(['Too short to learn from.'])).toBeNull()
  })

  it('notices British or American spelling and contractions', () => {
    const british = measureVoice([sample('organise'), sample('prioritise')])!
    expect(british.spelling).toBe('british')
    expect(british.usesContractions).toBe(true)
    expect(british.emoji).toBe(false)
    expect(measureVoice([sample('organize'), sample('prioritize')])!.spelling).toBe('american')
  })

  const stats: VoiceStats = {
    samples: 3, words: 200, avgSentenceWords: 8, oneSentenceLineShare: 0.9, avgGroupLines: 2,
    questionsPer100Words: 1, usesContractions: true, spelling: 'british', exclamationsPer100Words: 0, emoji: false, hashtags: false,
  }
  const inVoice = "I don't plan every day.\nI organise my week on Sunday.\nIt's simple and it works for me.\nYou'll find your own rhythm too.\nStart with one small change.\nKeep it for a whole month.\n\nWhat would you change first?"

  it('accepts a draft that sounds like them', () => {
    expect(voiceProblems(drafts({ linkedin: inVoice }), stats)).toEqual([])
  })

  it('flags the other spelling, missing contractions and much longer sentences', () => {
    const off = `I do not plan every single day of the week because it would organize everything far too tightly for the team and for me. ${words(30, 'and')}.\n\nWhat would you change first?`
    const problems = voiceProblems(drafts({ linkedin: off }), stats)
    expect(problems.some((p) => p.startsWith('LinkedIn sentences average'))).toBe(true)
    expect(problems).toContain('it used American spelling (organize); this person writes british English')
    expect(problems).toContain('LinkedIn uses no contractions, but this person writes with contractions')
  })

  it('checks nothing when too little of their writing is known', () => {
    expect(voiceProblems(drafts({ linkedin: 'organize' }), null)).toEqual([])
    expect(voiceProblems(drafts({ linkedin: 'organize' }), { ...stats, words: 50 })).toEqual([])
  })

  it('fingerprints the source texts so the description is redone when they change', async () => {
    const a = await sourcesHash(['one', 'two'])
    expect(a).toMatch(/^[0-9a-f]{32}$/)
    expect(await sourcesHash(['one', 'two'])).toBe(a)
    expect(await sourcesHash(['one', 'three'])).not.toBe(a)
  })
})

describe('follow-up comments', () => {
  const ok = 'What surprised me most was how quickly the team adjusted. Nobody missed the meetings, and we finally had whole afternoons to think about the work that matters.'

  // The owner's own examples (brief of 28 Nov 2026, HPD-176).
  const prdPost = 'Having a PRD is great and important\n\nbut the context behind the requirements matters just as much.'
  const goodSet = [
    'Two people can read the same requirement and walk away with completely different pictures of what to build.',
    "Here's the simple version I'd start with:\n✅ What we decided\n✅ Why we chose it over the other option\n✅ What would make us revisit it\n\nThree lines that save a lot of confusion later.",
    'The best test I know is to ask a new engineer to explain the requirement back to you 🙂\n\nIf their version surprises you, the context is missing, not the detail.\n\nFix that before the sprint starts, because it only gets more expensive after.',
    'Context also ages. A requirement that made sense in March can mislead someone in June.',
  ]

  it('accepts comments of very different lengths, with icon steps and one emoji', () => {
    expect(commentProblems([ok], 'The post')).toEqual([])
    expect(commentProblems(goodSet, prdPost)).toEqual([])
  })

  it('rejects the owner\'s bad example: praise opener and buzzwords', () => {
    const bad = 'Absolutely! Context is the cornerstone of successful product execution. It bridges the gap between strategic alignment and operational excellence, ensuring stakeholders leverage clarity to drive impactful outcomes.'
    const problems = commentProblems([bad], prdPost)
    expect(problems).toEqual(expect.arrayContaining([
      'comment 1 opens with "absolutely"; start with the point itself, not praise or agreement',
      expect.stringMatching(/^comment 1 sounds artificial \(.*"leverage".*"cornerstone".*\)/),
      'comment 1 has a line with more than two sentences; split it for phones',
    ]))
  })

  it('does not mistake a real opening for a praise opener', () => {
    expect(commentProblems(['Exactly how you frame the requirement decides what gets built.'], 'The post')).toEqual([])
    expect(commentProblems(['Absolutely nothing changes until someone writes down the why.'], 'The post')).toEqual([])
    expect(commentProblems(['Exactly. And the why is the part people skip most often.'], 'The post'))
      .toContain('comment 1 opens with "exactly"; start with the point itself, not praise or agreement')
  })

  it('allows a buzzword the person uses in their own post or writing', () => {
    const c = 'The real leverage is in writing the why next to each requirement, not in adding more pages.'
    expect(commentProblems([c], 'The post')).toEqual([expect.stringContaining('"leverage"')])
    expect(commentProblems([c], 'We leverage PRDs every day.')).toEqual([])
    expect(commentProblems([c], 'The post', { own: 'I leverage templates.' })).toEqual([])
  })

  it('names every broken rule, by comment number', () => {
    const problems = commentProblems([
      'Great point, thanks.',
      words(91),
      `${ok} #focus`,
      `1. ${ok}`,
      'First line here.\nSecond line here.\nThird line here.',
      'Steps:\n- one thing to do\n- another thing to do',
      'Do this:\n✅ one step\n👉 another step',
      'Nice 🎉 and more 🚀 words to reach the minimum length.',
    ], 'The post')
    expect(problems).toEqual(expect.arrayContaining([
      'comment 1 used banned phrases: "great point"',
      'comment 1 opens with "great point"; start with the point itself, not praise or agreement',
      'comment 1 has 3 words; it needs at least 8',
      'comment 2 has 91 words; the limit is 90',
      'comment 3 has hashtags',
      'comment 4 starts with a number or label',
      'comment 5 has a paragraph of more than two lines; use short paragraphs with a blank line between them',
      'comment 6 uses bullets, dashes or numbers; start each step with the same simple icon instead',
      'comment 7 mixes different icons for its steps; use one icon for all of them',
      'comment 8 has 2 emojis; use at most one',
    ]))
  })

  it('wants a set that opens differently, varies in length and does not put an emoji in every comment', () => {
    const same = [
      `The truth is ${words(12, 'that')}`, `The truth is ${words(14, 'this')}`,
      `Most teams ${words(13, 'skip')} 🙂`, `Context ages ${words(12, 'fast')} 🚀`,
    ]
    const problems = commentProblems(same.map((c, i) => (i < 2 ? `${c} 😀` : c)), 'The post')
    expect(problems).toEqual(expect.arrayContaining([
      'comments 1 and 2 open the same way ("the truth"); open every comment differently',
      'the comments are all about the same length; make some one or two short lines and others fuller',
      'every comment uses an emoji; use them in only a few, where they fit',
    ]))
  })

  it('checks a rewritten comment against the opening of the others', () => {
    expect(commentProblems(['The truth is that nobody reads a PRD twice before building.'], 'The post', { others: ['The truth is simple: write it down.'] }))
      .toContain('it opens the same way as another comment ("the truth")')
  })

  it('writes comments as the author, from the shared brand core, with past change requests as content', () => {
    const profile = { preferred_name: 'Ada', onboarding: { craft: ['product-manager'], tone: ['friendly'] } }
    const voice = { stats: measureVoice([words(40, 'Short line.')]), description: null, examples: [] }
    const { system, user } = buildCommentsPrompt(profile, 'idea', prdPost, { count: 5 }, voice, ['Less formal'])
    expect(system).toContain('You are the person who wrote this LinkedIn post')
    expect(system).toContain('THEIR BRAND')
    expect(system).toContain('teach it forward')
    expect(system).toContain('Under <feedback>')
    expect(system).not.toContain('They do not use emojis') // comments follow their own emoji rule
    expect(user).toContain('<feedback>\n- Less formal\n</feedback>')
    expect(buildCommentsPrompt(profile, 'idea', prdPost, { count: 5 }).system).not.toContain('Under <feedback>')
  })

  it('gives drafts the same brand core and keeps the closing question', () => {
    const { system, user } = buildPrompt(null, 'idea', undefined, undefined, undefined, ['linkedin'], ['Shorter'])
    expect(system).toContain('THEIR BRAND')
    expect(system).toContain('end with a specific question')
    expect(user).toContain('<feedback>\n- Shorter\n</feedback>')
    expect(buildPrompt(null, 'idea').user).not.toContain('<feedback>')
  })

  it('learns from what the person asked to change, without angle notes or repeats', () => {
    expect(recentFeedback(['Less formal', 'Angle: Common mistake', 'less formal', '  Shorter  sentences ', null, 7]))
      .toEqual(['Less formal', 'Shorter sentences'])
    expect(recentFeedback(Array.from({ length: 10 }, (_, i) => `note ${i}`))).toHaveLength(6)
  })

  it('catches a comment that repeats a line of the post word for word', () => {
    const line = 'Nobody missed the meetings, not even the managers.'
    expect(commentProblems([`${line}\n${words(20, 'more')}`], `Intro\n${line}`))
      .toContain('comment 1 repeats a line from the post')
  })

  it('reads comments sent as plain text separated by ---', () => {
    expect(parseComments('"First comment."\n---\nSecond comment.\n***\nFirst comment.')).toEqual(['First comment.', 'Second comment.'])
  })

  it('reads comments sent as JSON in the shapes the AI uses', () => {
    expect(parseComments('{"comments":["A","B"]}')).toEqual(['A', 'B'])
    expect(parseComments('[{"text":"A"},{"comment":"B"},{"position":3,"body":"C"}]')).toEqual(['A', 'B', 'C'])
    expect(parseComments('{"items":["A"]}')).toEqual(['A'])
  })

  it(`keeps at most ${COMMENTS_MAX}, and nothing when the answer is unusable`, () => {
    expect(parseComments(JSON.stringify({ comments: Array.from({ length: 14 }, (_, i) => `Comment ${i}`) }))).toHaveLength(COMMENTS_MAX)
    expect(parseComments('{"comments":[]}')).toBeNull()
    expect(parseComments('{broken')).toBeNull()
  })

  it('reads a single rewritten comment', () => {
    expect(parseOneComment('A better comment.')).toBe('A better comment.')
    expect(parseOneComment('{"comment":"From JSON."}')).toBe('From JSON.')
    expect(parseOneComment('{"comments":["First of a list."]}')).toBe('First of a list.')
    expect(parseOneComment('{"comment":""}')).toBeNull()
  })
})
