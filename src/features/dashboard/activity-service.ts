import { supabase } from '@/lib/supabase'

/**
 * The person's real activity in Hiba, read from their own data (Row Level Security: only theirs).
 * Reach, likes and comments from other people are not here: LinkedIn only shares those with apps it
 * has approved for its Community Management programme, which Hiba is not part of yet.
 */
export interface Activity {
  /** LinkedIn posts that went out from Hiba in the last 30 days. */
  postsPublished: number
  /** Follow-up comments Hiba posted under them in the last 30 days. */
  commentsPosted: number
  /** Ideas captured in the last 30 days. */
  ideas: number
  /** Posts waiting to go out at a set time. */
  scheduled: number
  /** Posts published per week for the last 8 weeks, oldest first. */
  weeks: { start: Date; count: number }[]
  /** The most recent post that went out, if any. */
  lastPost: { publishedAt: string; url: string | null } | null
}

const DAY = 86_400_000

/** Monday 00:00 of the week `date` is in, in the person's own time zone. */
function weekStart(date: Date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d
}

export async function fetchActivity(): Promise<Activity> {
  const now = new Date()
  const firstWeek = weekStart(new Date(now.getTime() - 7 * 7 * DAY))
  const since30 = new Date(now.getTime() - 30 * DAY).toISOString()

  const [published, comments, ideas, scheduled] = await Promise.all([
    supabase.from('posts').select('published_at, external_url')
      .eq('platform', 'linkedin').not('published_at', 'is', null).gte('published_at', firstWeek.toISOString())
      .order('published_at', { ascending: false }),
    supabase.from('post_comments').select('id', { count: 'exact', head: true }).eq('status', 'published').gte('published_at', since30),
    supabase.from('ideas').select('id', { count: 'exact', head: true }).gte('created_at', since30),
    supabase.from('posts').select('id', { count: 'exact', head: true }).eq('status', 'scheduled'),
  ])
  const failed = [published, comments, ideas, scheduled].find((r) => r.error)
  if (failed?.error) throw failed.error

  const rows = (published.data ?? []) as { published_at: string; external_url: string | null }[]
  const weeks = Array.from({ length: 8 }, (_, i) => ({ start: new Date(firstWeek.getTime() + i * 7 * DAY), count: 0 }))
  for (const r of rows) {
    const i = Math.floor((weekStart(new Date(r.published_at)).getTime() - firstWeek.getTime()) / (7 * DAY))
    if (i >= 0 && i < weeks.length) weeks[i].count++
  }
  // The last post may be older than 8 weeks.
  let lastPost = rows[0] ? { publishedAt: rows[0].published_at, url: rows[0].external_url } : null
  if (!lastPost) {
    const { data } = await supabase.from('posts').select('published_at, external_url')
      .eq('platform', 'linkedin').not('published_at', 'is', null).order('published_at', { ascending: false }).limit(1).maybeSingle()
    if (data?.published_at) lastPost = { publishedAt: data.published_at, url: data.external_url }
  }

  return {
    postsPublished: rows.filter((r) => r.published_at >= since30).length,
    commentsPosted: comments.count ?? 0,
    ideas: ideas.count ?? 0,
    scheduled: scheduled.count ?? 0,
    weeks,
    lastPost,
  }
}
