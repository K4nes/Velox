import { useState } from 'react'
import { ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

const sortOptions = ['Newest First', 'Oldest First']

export function PnlMonthlyPage() {
  const [month, setMonth] = useState(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  })
  const [selectedDay, setSelectedDay] = useState(() => new Date())

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Card className="flex min-h-[336px] flex-col gap-0 py-0">
          <div className="flex h-12 items-center justify-between border-b px-4">
            <div className="flex flex-col">
              <h2 className="text-[13px] font-semibold">Net PnL</h2>
              <p className="text-xs text-muted-foreground">Daily · ETH</p>
            </div>
            <div className="flex flex-col items-end">
              <span className="text-[11px] font-medium text-muted-foreground tracking-[0.6px] uppercase">
                Month net
              </span>
              <span className="text-xs font-medium">0.0000 ETH</span>
            </div>
          </div>
          <div className="flex flex-1 items-center justify-center text-[13px] text-muted-foreground">
            No PnL records yet.
          </div>
        </Card>

        <Card className="flex min-h-[336px] flex-col gap-0 py-0">
          <div className="flex h-12 items-center justify-between border-b px-4">
            <span className="text-[13px] font-semibold" aria-live="polite">
              {month.toLocaleDateString('en-US', {
                month: 'long',
                year: 'numeric',
              })}
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Previous month"
                onClick={() =>
                  setMonth(
                    (current) =>
                      new Date(current.getFullYear(), current.getMonth() - 1, 1)
                  )
                }
              >
                <ChevronLeft />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Next month"
                onClick={() =>
                  setMonth(
                    (current) =>
                      new Date(current.getFullYear(), current.getMonth() + 1, 1)
                  )
                }
              >
                <ChevronRight />
              </Button>
            </div>
          </div>
          <div className="mx-auto w-full max-w-[280px] p-2.5">
            <div className="rounded-lg bg-muted/40 p-2 ring-1 ring-foreground/10">
              <Calendar
                mode="single"
                required
                month={month}
                onMonthChange={setMonth}
                selected={selectedDay}
                onSelect={(date) => {
                  setSelectedDay(date)
                  if (
                    date.getFullYear() !== month.getFullYear() ||
                    date.getMonth() !== month.getMonth()
                  ) {
                    setMonth(new Date(date.getFullYear(), date.getMonth(), 1))
                  }
                }}
                hideNavigation
                className="w-full bg-transparent p-0"
                classNames={{
                  month_caption: 'hidden',
                  week: 'mt-0 flex w-full',
                  weekday:
                    'flex h-8 flex-1 items-center justify-center text-[11px] font-medium text-muted-foreground select-none',
                  day: 'group/day relative flex h-[38px] w-full items-center justify-center p-0 select-none [&[data-today=true]>button]:bg-muted',
                  today: 'bg-transparent',
                  day_button:
                    'size-[30px] rounded-md border-0 text-xs group-data-[focused=true]/day:ring-transparent focus-visible:ring-foreground/70! data-[selected-single=true]:border data-[selected-single=true]:border-border data-[selected-single=true]:bg-secondary! data-[selected-single=true]:font-semibold data-[selected-single=true]:text-foreground',
                }}
              />
            </div>
          </div>
        </Card>
      </div>

      <Card className="flex flex-1 flex-col gap-0 py-0">
        <div className="flex h-12 items-center justify-end gap-3 px-4">
          <div className="relative w-60 shrink-0">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search collection..."
              aria-label="Search collection"
              className="pl-8"
            />
          </div>
          <Select defaultValue={sortOptions[0]}>
            <SelectTrigger className="w-[158px]" aria-label="Sort collections">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" sideOffset={4}>
              {sortOptions.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-muted-foreground px-3 text-xs font-medium">
                Collection
              </TableHead>
              <TableHead className="text-muted-foreground w-[146px] px-3 text-xs font-medium">
                Net PnL (ETH)
              </TableHead>
              <TableHead className="text-muted-foreground w-[136px] px-3 text-xs font-medium">
                USD Value
              </TableHead>
              <TableHead className="text-muted-foreground w-[109px] px-3 text-xs font-medium">
                Date
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow className="hover:bg-transparent">
              <TableCell
                colSpan={4}
                className="h-10 text-center text-[13px] text-muted-foreground"
              >
                No PnL records yet.
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Card>
    </div>
  )
}
