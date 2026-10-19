import { useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { WalletSelect, type WalletGroup } from '@/components/wallet-select'

const walletGroups: WalletGroup[] = [
  {
    id: 'main-burners',
    name: 'Main Burners',
    wallets: [
      { id: 'mb-1', name: '0x1a2b…9f01' },
      { id: 'mb-2', name: '0x3c4d…7e02' },
    ],
  },
  {
    id: 'wallet-burners',
    name: 'wallet burners',
    wallets: [
      { id: 'wb-1', name: '0x5e6f…1a03' },
      { id: 'wb-2', name: '0x7g8h…2b04' },
      { id: 'wb-3', name: '0x9i0j…3c05' },
    ],
  },
]

export function MintEligibilityPage() {
  const [selectedWallets, setSelectedWallets] = useState<string[]>([])

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <Tabs defaultValue="check" className="flex flex-1 flex-col gap-4">
        <TabsList className="w-fit">
          <TabsTrigger value="check">Check Eligible</TabsTrigger>
          <TabsTrigger value="snapshot">Snapshot</TabsTrigger>
        </TabsList>

        <TabsContent value="check" className="flex flex-1 flex-col gap-4">
          <Card className="flex h-16 flex-row items-center gap-2 px-4">
            <Input placeholder="Collection URL" className="flex-1" />
            <WalletSelect
              groups={walletGroups}
              selected={selectedWallets}
              onSelectedChange={setSelectedWallets}
              className="shrink-0"
            />
            <Button className="shrink-0">Check</Button>
          </Card>
          <Card className="flex-1" />
        </TabsContent>

        <TabsContent value="snapshot" className="flex flex-1 flex-col">
          <Card className="flex-1" />
        </TabsContent>
      </Tabs>
    </div>
  )
}
