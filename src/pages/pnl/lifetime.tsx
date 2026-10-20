import { useState } from 'react'
import { Search } from 'lucide-react'
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
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
import { cn } from '@/lib/utils'

const allTimeNet = '0.0000 ETH'

const summary = [
  { label: 'Realized PnL', value: '0.0000 ETH', secondary: '$0.00' },
  { label: 'Unrealized PnL', value: '0.0000 ETH', secondary: '$0.00' },
  { label: 'Net Total PnL', value: allTimeNet, secondary: '$0.00' },
  { label: 'Invested', value: '0.0000 ETH', secondary: '$0.00' },
  { label: 'Holdings Value', value: '0.0000 ETH', secondary: '$0.00' },
  { label: 'Net ROI', value: '—', secondary: '0 months tracked' },
]

const rangeRows = [
  'Best month',
  'Worst month',
  'Average / month',
  'Profitable months',
  'Longest win streak',
]

const sortOptions = ['Newest First', 'Oldest First', 'Highest PnL', 'Lowest PnL']

const columns = [
  { label: 'Collection' },
  { label: 'Net PnL (ETH)', className: 'w-[146px]' },
  { label: 'USD Value', className: 'w-[136px]' },
  { label: 'Date', className: 'w-[109px]' },
]

export function PnlLifetimePage() {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState(sortOptions[0])

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <Card className="gap-0 py-0">
        <dl className="bg-border grid grid-cols-2 gap-px forced-colors:gap-0 md:grid-cols-3 xl:grid-cols-6">
          {summary.map((stat) => (
            <div
              key={stat.label}
              className="bg-card flex flex-col gap-1 px-4 py-3 forced-colors:border-b"
            >
              <dt className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                {stat.label}
              </dt>
              <dd className="flex flex-col gap-0.5">
                <span className="text-sm font-semibold">{stat.value}</span>
                <span className="text-muted-foreground text-xs">{stat.secondary}</span>
              </dd>
            </div>
          ))}
        </dl>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Card>
          <CardHeader className="border-b">
            <CardTitle role="heading" aria-level={2}>Cumulative performance</CardTitle>
            <CardAction className="flex flex-col items-end gap-0.5 text-right">
              <span className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                All-time net
              </span>
              <span className="text-xs font-semibold">{allTimeNet}</span>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-1 items-center justify-center">
            <h2 className="text-muted-foreground">No PnL records yet.</h2>
          </CardContent>
        </Card>

        <Card className="py-0">
          <CardContent className="flex flex-1 flex-col p-0">
            {rangeRows.map((label) => (
              <div
                key={label}
                className="flex items-center justify-between gap-3 border-b px-4 py-2.5 last:border-b-0"
              >
                <div className="flex flex-col">
                  <span className="text-sm">{label}</span>
                  <span className="text-muted-foreground text-xs">—</span>
                </div>
                <span className="text-sm">—</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card className="flex-1 gap-0 overflow-hidden py-0">
        <div className="flex items-center justify-end gap-2.5 border-b px-4 py-3">
          <div className="relative w-60">
            <Search
              aria-hidden
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
            />
            <label htmlFor="collection-search" className="sr-only">
              Search collection
            </label>
            <Input
              id="collection-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search collection…"
              className="pl-8"
            />
          </div>
          <span id="pnl-sort-label" className="sr-only" aria-hidden="true">
            Sort PnL records
          </span>
          <Select value={sort} onValueChange={setSort}>
            <SelectTrigger
              aria-labelledby="pnl-sort-label pnl-sort-value"
              className="w-[158px] px-3"
            >
              <SelectValue id="pnl-sort-value" />
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

        <Table aria-label="PnL by collection">
          <TableHeader>
            <TableRow>
              {columns.map((column) => (
                <TableHead key={column.label} className={cn('px-4', column.className)}>
                  {column.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={columns.length} className="p-0">
                <div className="flex justify-center px-6 py-8 text-center">
                  <h2 className="text-muted-foreground">No PnL records yet.</h2>
                </div>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Card>
    </div>
  )
}
