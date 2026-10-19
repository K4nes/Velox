import { Card } from '@/components/ui/card'

export function MintTasksPage() {
  return (
    <div className="flex flex-1 flex-col p-6">
      <div className="grid flex-1 gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="grid gap-4 lg:grid-rows-[1fr_2fr]">
          <Card />
          <Card />
        </div>
        <Card />
      </div>
    </div>
  )
}
