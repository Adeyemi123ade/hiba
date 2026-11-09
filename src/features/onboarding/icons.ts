import {
  BadgeCheck, BookOpen, Briefcase, Building2, CalendarDays, Eye, GraduationCap, Globe, Heart,
  Lightbulb, Link2, Megaphone, MessageCircle, MessageSquare, Network, Palette, PenLine, Rocket,
  ShieldCheck, SlidersHorizontal, Smile, Sparkles, Star, Target, TrendingUp, User, UserPlus,
  Users, Zap, type LucideIcon,
} from 'lucide-react'

// Icons are referenced by name from steps.ts so the journey stays plain data.
export const ICONS: Record<string, LucideIcon> = {
  user: User, briefcase: Briefcase, message: MessageSquare, target: Target, users: Users,
  chat: MessageCircle, pen: PenLine, link: Link2, calendar: CalendarDays, sliders: SlidersHorizontal,
  sparkles: Sparkles, check: BadgeCheck, shield: ShieldCheck, network: Network, 'user-plus': UserPlus,
  book: BookOpen, trending: TrendingUp, eye: Eye, heart: Heart, rocket: Rocket, palette: Palette,
  cap: GraduationCap, megaphone: Megaphone, building: Building2, globe: Globe, smile: Smile,
  zap: Zap, lightbulb: Lightbulb, star: Star,
}
