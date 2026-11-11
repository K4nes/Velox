import { useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Image as ImageIcon,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { Area } from '@/components/dither-kit/area'
import { AreaChart } from '@/components/dither-kit/area-chart'
import { Tooltip } from '@/components/dither-kit/tooltip'
import { XAxis } from '@/components/dither-kit/x-axis'
import { YAxis } from '@/components/dither-kit/y-axis'
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
import { usePnlRecords } from '@/hooks/data/use-pnl-records'
import {
  dailyNetSeries,
  dayKey,
  formatNetPnl,
  isComplete,
  monthNet,
  netWei,
  recordUsd,
  recordsInMonth,
  type PnlRecord,
} from '@/lib/pnl/pnl-records'
import { formatEth } from '@/lib/pnl/pnl-trades'
import { cn } from '@/lib/utils'

const sortOptions = ['Newest First', 'Oldest First']

const dayFormat = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
})

const recordDateFormat = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

export function PnlMonthlyPage() {
  const { records, loading, error, remove } = usePnlRecords()
  const [month, setMonth] = useState(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  })
  const [selectedDay, setSelectedDay] = useState<Date>()
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState(sortOptions[0])

  const monthRecords = recordsInMonth(records, month)
  const totals = monthNet(records, month)
  const series = dailyNetSeries(records, month)
  const day = selectedDay ? dayKey(selectedDay) : null
  const dayLabel = selectedDay ? dayFormat.format(selectedDay) : null
  const search = query.trim().toLowerCase()

  const dayRows =
    day === null ? monthRecords : monthRecords.filter((record) => record.day === day)
  const rows = dayRows
    .filter((record) => matchesQuery(record, search))
    .sort((a, b) =>
      sort === sortOptions[0]
        ? b.createdAt - a.createdAt
        : a.createdAt - b.createdAt
    )

  const selectMonth = (next: Date) => {
    setMonth(new Date(next.getFullYear(), next.getMonth(), 1))
    setSelectedDay(undefined)
  }

  const shiftMonth = (offset: number) => {
    selectMonth(new Date(month.getFullYear(), month.getMonth() + offset, 1))
  }

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
              <span className="flex items-baseline gap-1.5">
                <span className="text-xs font-medium">
                  {formatEth(totals.wei)} ETH
                </span>
                {totals.usd === '—' ? null : (
                  <span className="text-[11px] text-muted-foreground">
                    {totals.usd}
                  </span>
                )}
              </span>
            </div>
          </div>
          {monthRecords.length === 0 ? (
            <div className="flex flex-1 items-center justify-center text-[13px] text-muted-foreground">
              No PnL records yet.
            </div>
          ) : (
            <div className="min-h-0 flex-1">
              <AreaChart
                data={series}
                config={{
                  net: {
                    label: 'Net PnL',
                    color: totals.wei < 0n ? 'red' : 'green',
                  },
                }}
                bloom="aura"
                className="h-full w-full"
              >
                <XAxis dataKey="day" tickFormatter={String} />
                <YAxis tickFormatter={(value: number) => value.toFixed(2)} />
                <Tooltip
                  labelKey="day"
                  valueFormatter={(value: number) =>
                    `${value.toFixed(4)} ETH`
                  }
                />
                <Area dataKey="net" variant="gradient" />
              </AreaChart>
            </div>
          )}
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
                onClick={() => shiftMonth(-1)}
              >
                <ChevronLeft />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Next month"
                onClick={() => shiftMonth(1)}
              >
                <ChevronRight />
              </Button>
            </div>
          </div>
          <div className="mx-auto w-full max-w-[280px] p-2.5">
            <div className="rounded-lg bg-muted/40 p-2 ring-1 ring-foreground/10">
              <Calendar
                mode="single"
                month={month}
                onMonthChange={selectMonth}
                selected={selectedDay}
                onSelect={(date: Date | undefined) => {
                  setSelectedDay(date)
                  if (
                    date &&
                    (date.getFullYear() !== month.getFullYear() ||
                      date.getMonth() !== month.getMonth())
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
        <div className="flex h-12 items-center justify-end gap-3 border-b px-4">
          {dayLabel ? (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setSelectedDay(undefined)}
              aria-label={`Clear ${dayLabel} filter`}
            >
              {dayLabel}
              <X />
            </Button>
          ) : null}
          <div className="relative w-60 shrink-0">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search collection..."
              aria-label="Search collection"
              className="pl-8"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <Select value={sort} onValueChange={setSort}>
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

        {error ? (
          <p className="px-4 pb-2 text-xs text-muted-foreground">{error}</p>
        ) : null}

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
              <TableHead className="text-muted-foreground w-10 px-3 text-xs font-medium" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell
                  colSpan={5}
                  className="h-10 text-center text-[13px] text-muted-foreground"
                >
                  {emptyMessage(loading, day !== null && dayRows.length === 0, search !== '')}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((record) => (
                <TableRow key={record.id} className="hover:bg-transparent">
                  <TableCell className="px-3">
                    <div className="flex items-center gap-2.5">
                      {record.imageUrl ? (
                        <img
                          src={record.imageUrl}
                          alt=""
                          className="size-8 rounded-lg border object-cover"
                        />
                      ) : (
                        <div className="flex size-8 items-center justify-center rounded-lg border bg-muted">
                          <ImageIcon className="size-3.5 text-muted-foreground" />
                        </div>
                      )}
                      <div className="flex flex-col">
                        <span className="text-[13px] font-medium">
                          {record.name}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          {isComplete(record) ? record.chain : `${record.chain} · partial read`}
                        </span>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell
                    className={cn(
                      'px-3 text-[13px] font-medium',
                      netWei(record) > 0n && 'text-pnl-positive-surface',
                      netWei(record) < 0n && 'text-pnl-negative-surface',
                    )}
                  >
                    {formatNetPnl(record)}
                  </TableCell>
                  <TableCell className="px-3 text-[13px]">
                    {recordUsd(record)}
                  </TableCell>
                  <TableCell className="px-3 text-[13px] text-muted-foreground">
                    {recordDateFormat.format(record.createdAt)}
                  </TableCell>
                  <TableCell className="w-10 px-3">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Delete ${record.name} record`}
                      onClick={(event) => {
                        if (event.detail > 1) {
                          return
                        }
                        remove(record.id)
                      }}
                    >
                      <Trash2 />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  )
}

function matchesQuery(record: PnlRecord, query: string): boolean {
  if (query.length === 0) return true
  const fields = [record.name, record.slug, record.chain]
  return fields.some((field) => field.toLowerCase().includes(query))
}

function emptyMessage(loading: boolean, filtered: boolean, searched: boolean): string {
  if (loading) return 'Loading records…'
  if (filtered) return 'No PnL records on this day.'
  return searched ? 'No collections match your search.' : 'No PnL records yet.'
}
