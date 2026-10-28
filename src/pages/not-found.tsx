import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return (
    <div className="p-6">
      <Link to="/mint/tasks" className="text-sm text-muted-foreground underline">
        Go to Tasks
      </Link>
    </div>
  )
}
