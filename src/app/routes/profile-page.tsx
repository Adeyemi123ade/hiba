import { useParams } from 'react-router-dom'

export function ProfilePage() {
  const { id } = useParams()
  return <div className="text-[var(--color-text-primary)]">Public profile — placeholder ({id})</div>
}
