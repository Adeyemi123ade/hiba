import { Link } from 'react-router-dom'
import { Card } from '@/components/ui/card'

export function ComingSoon({ title, text }: { title: string; text: string }) {
  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold text-[var(--color-text-primary)]">{title}</h1>
      <Card className="flex flex-col items-start gap-3">
        <p className="text-[var(--color-text-secondary)]">{text}</p>
        <Link
          to="/dashboard/capture"
          className="rounded-[var(--radius-sm)] bg-[var(--color-primary-dark)] px-4 py-2 text-sm font-semibold text-white"
        >
          Record an idea
        </Link>
      </Card>
    </div>
  )
}
