import { useMemo } from 'react'
import { Image as ImageIcon, Search, Trash2 } from 'lucide-react'
import { Area } from '@/components/dither-kit/area'
import { AreaChart } from '@/components/dither-kit/area-chart'
import { Tooltip } from '@/components/dither-kit/tooltip'
import { XAxis } from '@/components/dither-kit/x-axis'
import { YAxis } from '@/components/dither-kit/y-axis'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
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
import { usePageStore } from '@/hooks/use-page-store'
import { usePnlRecords } from '@/hooks/data/use-pnl-records'
import { pnlLifetimeStore } from '@/pages/pnl/store'
import {
  formatUsd,
  lifetimeView,
  type LifetimeCollection,
} from '@/lib/pnl/pnl-records'
import { formatEth } from '@/lib/pnl/pnl-trades'
import { cn } from '@/lib/utils'

const sortOptions = ['Newest First', 'Oldest First', 'Highest PnL', 'Lowest PnL']

const monthFormat = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  year: 'numeric',
})

const checkDateFormat = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})

function monthLabel(month: string): string {
  const [year, index] = month.split('-')
  return monthFormat.format(new Date(Number(year), Number(index) - 1, 1))
}

// `from` is a local day key, so it is parsed as a local date; the Date
// constructor's string form would read it as UTC and shift the day.
function dayOf(day: string): Date {
  const [year, month, date] = day.split('-')
  return new Date(Number(year), Number(month) - 1, Number(date))
}

function ethText(value: bigint | null): string {
  return value === null ? '—' : `${formatEth(value)} ETH`
}

// One precision for the whole axis, or two ticks can print the same label. The
// axis always spans zero, so a flat series still needs digits for its height.
// A fifth of the width is roughly one d3 tick.
function axisDigits(levels: number[]): number {
  if (levels.length === 0) return 2
  const width = Math.max(0, ...levels) - Math.min(0, ...levels)
  if (width <= 0) return 2
  return Math.max(2, Math.ceil(-Math.log10(width / 5)) + 1)
}

function matchesQuery(row: LifetimeCollection, query: string): boolean {
  if (query.length === 0) return true
  return [row.name, row.slug, row.chain].some((field) =>
    field.toLowerCase().includes(query),
  )
}

function compareRows(a: LifetimeCollection, b: LifetimeCollection, sort: string): number {
  if (sort === 'Oldest First') return a.checkedAt - b.checkedAt
  if (sort === 'Highest PnL') {
    return a.net > b.net ? -1 : a.net < b.net ? 1 : 0
  }
  if (sort === 'Lowest PnL') {
    return a.net < b.net ? -1 : a.net > b.net ? 1 : 0
  }
  return b.checkedAt - a.checkedAt
}

function subtitleOf(row: LifetimeCollection): string {
  const parts = [row.chain]
  if (row.breakdown !== null) {
    parts.push(`${row.breakdown.held} held · ${row.breakdown.sold} sold`)
  }
  if (row.lastReadPartial) parts.push('newer read incomplete')
  return parts.join(' · ')
}

function emptyMessage(
  loading: boolean,
  searched: boolean,
  onlyIncomplete: boolean,
): string {
  if (loading) return 'Loading records…'
  if (searched) return 'No collections match your search.'
  if (onlyIncomplete) return 'No complete checks yet.'
  return 'No PnL records yet.'
}

export function PnlLifetimePage() {
  const { records, loading, error, remove } = usePnlRecords()
  const { query, sort } = usePageStore(pnlLifetimeStore)
  const setQuery = (next: string) => pnlLifetimeStore.set({ query: next })
  const setSort = (next: string) => pnlLifetimeStore.set({ sort: next })

  const view = useMemo(() => lifetimeView(records), [records])
  const series = useMemo(
    () =>
      view.months.map((month) => ({
        label: monthLabel(month.month),
        level: Number(month.level) / 10 ** 18,
      })),
    [view.months],
  )
  const rows = useMemo(() => {
    const search = query.trim().toLowerCase()
    return view.collections
      .filter((row) => matchesQuery(row, search))
      .sort((a, b) => compareRows(a, b, sort))
  }, [view.collections, query, sort])
  const tickDigits = useMemo(
    () => axisDigits(series.map((point) => point.level)),
    [series],
  )

  const totals = view.totals
  const ranges = view.ranges
  const searched = query.trim().length > 0

  const summary = [
    {
      label: 'Realized PnL',
      value: ethText(totals.realized),
      secondary: formatUsd(totals.usd.realized),
    },
    {
      label: 'Unrealized PnL',
      value: ethText(totals.unrealized),
      secondary: formatUsd(totals.usd.unrealized),
    },
    {
      label: 'Net Total PnL',
      value: ethText(totals.net),
      secondary: formatUsd(totals.usd.net),
    },
    {
      label: 'Invested',
      value: ethText(totals.spent),
      secondary: formatUsd(totals.usd.spent),
    },
    {
      label: 'Holdings Value',
      value: ethText(totals.holdings),
      secondary: formatUsd(totals.usd.holdings),
    },
    {
      label: 'Net ROI',
      value: totals.roi === null ? '—' : `${(totals.roi * 100).toFixed(1)}%`,
      secondary: `${ranges.tracked} months tracked`,
    },
  ]

  const rangeRows = [
    {
      label: 'Best month',
      secondary: ranges.best === null ? '—' : monthLabel(ranges.best.month),
      value: ranges.best === null ? '—' : ethText(ranges.best.change),
    },
    {
      label: 'Worst month',
      secondary: ranges.worst === null ? '—' : monthLabel(ranges.worst.month),
      value: ranges.worst === null ? '—' : ethText(ranges.worst.change),
    },
    {
      label: 'Average / month',
      secondary: `${ranges.tracked} months with a check`,
      value: ethText(ranges.average),
    },
    {
      label: 'Profitable months',
      secondary: `of ${ranges.tracked} months`,
      value: String(ranges.profitable),
    },
    {
      label: 'Longest win streak',
      secondary: 'consecutive profitable months',
      value: String(ranges.streak),
    },
    {
      label: 'Since',
      secondary: 'first complete check',
      value: totals.from === null ? '—' : checkDateFormat.format(dayOf(totals.from)),
    },
  ]

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <Card className="gap-0 py-0">
        <dl className="bg-border grid grid-cols-2 gap-px forced-colors:gap-0 md:grid-cols-3 xl:grid-cols-6">
          {summary.map((stat) => (
            <div
              key={stat.label}
              className="bg-card flex flex-col gap-1 px-4 py-3 forced-colors:border-b"
            >
              <dt className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
                {stat.label}
              </dt>
              <dd className="flex flex-col gap-0.5">
                <span className="text-lg font-semibold">{stat.value}</span>
                <span className="text-muted-foreground text-[11px]">
                  {stat.secondary}
                </span>
              </dd>
            </div>
          ))}
        </dl>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Card className="flex min-h-[336px] flex-col gap-0 py-0">
          <div className="flex h-12 items-center justify-between border-b px-4">
            <div className="flex flex-col">
              <h2 className="text-[13px] font-semibold">Cumulative performance</h2>
              <p className="text-xs text-muted-foreground">Monthly · ETH</p>
            </div>
            <div className="flex flex-col items-end">
              <span className="text-[11px] font-medium text-muted-foreground tracking-[0.6px] uppercase">
                All-time net
              </span>
              <span className="flex items-baseline gap-1.5">
                <span className="text-xs font-medium">{ethText(totals.net)}</span>
                {totals.usd.net === null ? null : (
                  <span className="text-[11px] text-muted-foreground">
                    {formatUsd(totals.usd.net)}
                  </span>
                )}
              </span>
            </div>
          </div>
          {view.months.length === 0 ? (
            <div className="flex flex-1 items-center justify-center text-[13px] text-muted-foreground">
              {records.length === 0 ? 'No PnL records yet.' : 'No complete checks yet.'}
            </div>
          ) : (
            <div className="min-h-0 flex-1">
              <AreaChart
                data={series}
                config={{
                  level: { label: 'Net PnL', color: 'green' },
                }}
                bloom="aura"
                margins={{ left: 56, right: 44 }}
                className="h-full w-full"
              >
                <XAxis dataKey="label" />
                <YAxis
                  tickFormatter={(value: number) =>
                    tickDigits <= 6
                      ? value.toFixed(tickDigits)
                      : value.toExponential(1)
                  }
                />
                <Tooltip
                  labelKey="label"
                  valueFormatter={(value: number) =>
                    `${value.toFixed(4)} ETH`
                  }
                />
                <Area dataKey="level" variant="gradient" splitBySign />
              </AreaChart>
            </div>
          )}
        </Card>

        <Card className="py-0">
          <CardContent className="flex flex-1 flex-col p-0">
            {rangeRows.map((row) => (
              <div
                key={row.label}
                className="flex items-center justify-between gap-3 border-b px-4 py-2.5 last:border-b-0"
              >
                <div className="flex flex-col">
                  <span className="text-sm">{row.label}</span>
                  <span className="text-muted-foreground text-xs">
                    {row.secondary}
                  </span>
                </div>
                <span className="text-sm">{row.value}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card className="flex-1 gap-0 overflow-hidden py-0">
        <div className="flex h-12 items-center justify-end gap-2.5 border-b px-4">
          <div className="relative w-60">
            <Search
              aria-hidden
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
            />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search collection…"
              aria-label="Search collection"
              className="pl-8"
            />
          </div>
          <Select value={sort} onValueChange={setSort}>
            <SelectTrigger aria-label="Sort collections" className="w-[158px] px-3">
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

        {totals.excluded === 0 ? null : (
          <p className="px-4 pb-2 text-xs text-muted-foreground">
            {totals.excluded === 1
              ? '1 collection left out: no complete check.'
              : `${totals.excluded} collections left out: no complete check.`}
          </p>
        )}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-muted-foreground px-3 text-xs font-medium">
                Collection
              </TableHead>
              <TableHead className="text-muted-foreground w-[146px] px-3 text-xs font-medium">
                Net PnL (ETH)
              </TableHead>
              <TableHead className="text-muted-foreground w-[130px] px-3 text-xs font-medium">
                Realized (ETH)
              </TableHead>
              <TableHead className="text-muted-foreground w-[130px] px-3 text-xs font-medium">
                Unrealized (ETH)
              </TableHead>
              <TableHead className="text-muted-foreground w-[136px] px-3 text-xs font-medium">
                USD Value
              </TableHead>
              <TableHead className="text-muted-foreground w-[109px] px-3 text-xs font-medium">
                Last check
              </TableHead>
              <TableHead className="text-muted-foreground w-10 px-3 text-xs font-medium" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={7} className="p-0">
                  <div className="flex justify-center px-6 py-8 text-center">
                    <p className="text-muted-foreground">
                      {emptyMessage(
                        loading,
                        searched,
                        records.length > 0 && view.collections.length === 0,
                      )}
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.id} className="hover:bg-transparent">
                  <TableCell className="px-3">
                    <div className="flex items-center gap-2.5">
                      {row.imageUrl ? (
                        <img
                          src={row.imageUrl}
                          alt=""
                          className="size-8 rounded-lg border object-cover"
                        />
                      ) : (
                        <div className="flex size-8 items-center justify-center rounded-lg border bg-muted">
                          <ImageIcon className="size-3.5 text-muted-foreground" />
                        </div>
                      )}
                      <div className="flex flex-col">
                        <span className="text-[13px] font-medium">{row.name}</span>
                        <span className="text-[11px] text-muted-foreground">
                          {subtitleOf(row)}
                        </span>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell
                    className={cn(
                      'px-3 text-[13px] font-medium',
                      row.net > 0n && 'text-pnl-positive-surface',
                      row.net < 0n && 'text-pnl-negative-surface',
                    )}
                  >
                    {ethText(row.net)}
                  </TableCell>
                  <TableCell className="px-3 text-[13px]">
                    {ethText(row.breakdown?.realized ?? null)}
                  </TableCell>
                  <TableCell className="px-3 text-[13px]">
                    {ethText(row.breakdown?.unrealized ?? null)}
                  </TableCell>
                  <TableCell className="px-3 text-[13px]">
                    {formatUsd(row.usd)}
                  </TableCell>
                  <TableCell className="px-3 text-[13px] text-muted-foreground">
                    {checkDateFormat.format(row.checkedAt)}
                  </TableCell>
                  <TableCell className="w-10 px-3">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Delete ${row.name} latest check`}
                      onClick={(event) => {
                        if (event.detail > 1) {
                          return
                        }
                        remove(row.id)
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
