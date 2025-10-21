import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Plus, FolderOpen, Download, Trash2, Layers, Image as ImageIcon, Sparkles } from 'lucide-react'
import { getVscode } from '../vscode'
import '../App.css'

const vscode = getVscode()

interface CollectionMetadata {
  id: string
  name: string
  description?: string
  itemCount: number
  traitCount: number
  rarityCount: number
  status: 'draft' | 'ready' | 'minting' | 'minted'
  createdAt: string
  updatedAt: string
  mintedTxId?: string
  mintedItemCount?: number
}

export function CollectionsManagerPanel() {
  const [collections, setCollections] = useState<CollectionMetadata[]>([])
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [collectionToDelete, setCollectionToDelete] = useState<CollectionMetadata | null>(null)

  useEffect(() => {
    document.documentElement.classList.add('dark')

    // Remove initial loading spinner
    const loader = document.getElementById('initial-loader')
    if (loader) {
      loader.style.opacity = '0'
      loader.style.transition = 'opacity 0.3s'
      setTimeout(() => loader.remove(), 300)
    }

    // Request initial collections list
    vscode.postMessage({ command: 'refreshCollections' })
  }, [])

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const { command, collections: receivedCollections } = event.data

      if (command === 'collectionsList' && receivedCollections) {
        setCollections(receivedCollections)
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [])

  const handleCreateCollection = () => {
    vscode.postMessage({ command: 'createCollection' })
  }

  const handleOpenCollection = (collectionId: string) => {
    vscode.postMessage({ command: 'openCollection', collectionId })
  }

  const handleExportCollection = (collectionId: string) => {
    vscode.postMessage({ command: 'exportCollection', collectionId })
  }

  const handleDeleteClick = (collection: CollectionMetadata) => {
    setCollectionToDelete(collection)
    setDeleteDialogOpen(true)
  }

  const handleDeleteConfirm = () => {
    if (collectionToDelete) {
      vscode.postMessage({ command: 'deleteCollection', collectionId: collectionToDelete.id })
      setDeleteDialogOpen(false)
      setCollectionToDelete(null)
    }
  }

  const getStatusBadge = (status: CollectionMetadata['status']) => {
    const variants = {
      draft: { variant: 'secondary' as const, label: 'Draft' },
      ready: { variant: 'default' as const, label: 'Ready' },
      minting: { variant: 'default' as const, label: 'Minting' },
      minted: { variant: 'default' as const, label: 'Minted' }
    }
    const { variant, label } = variants[status]
    return <Badge variant={variant}>{label}</Badge>
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const days = Math.floor(diff / (1000 * 60 * 60 * 24))

    if (days === 0) {
      const hours = Math.floor(diff / (1000 * 60 * 60))
      if (hours === 0) {
        const minutes = Math.floor(diff / (1000 * 60))
        return minutes === 0 ? 'Just now' : `${minutes}m ago`
      }
      return `${hours}h ago`
    }
    if (days === 1) return 'Yesterday'
    if (days < 7) return `${days}d ago`
    return date.toLocaleDateString()
  }

  return (
    <div className="w-full min-h-screen p-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Collections</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage your NFT collections
          </p>
        </div>
        <Button onClick={handleCreateCollection}>
          <Plus className="mr-2 h-4 w-4" />
          Create Collection
        </Button>
      </div>

      {/* Collections Grid */}
      <ScrollArea className="h-[calc(100vh-200px)]">
        {collections.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Layers className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No collections yet</h3>
              <p className="text-sm text-muted-foreground mb-4 text-center max-w-sm">
                Create your first collection to start minting NFTs with custom traits and rarities
              </p>
              <Button onClick={handleCreateCollection}>
                <Plus className="mr-2 h-4 w-4" />
                Create Your First Collection
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {collections.map((collection) => (
              <Card key={collection.id} className="hover:border-primary/50 transition-colors">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-base truncate">
                        {collection.name || 'Untitled Collection'}
                      </CardTitle>
                      {collection.description && (
                        <CardDescription className="text-xs mt-1 line-clamp-2">
                          {collection.description}
                        </CardDescription>
                      )}
                    </div>
                    {getStatusBadge(collection.status)}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* Stats */}
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div className="flex flex-col items-center p-2 rounded-md bg-muted/50">
                      <ImageIcon className="h-3.5 w-3.5 mb-1 text-muted-foreground" />
                      <span className="font-mono font-semibold">
                        {collection.status === 'minted' && collection.mintedItemCount
                          ? collection.mintedItemCount
                          : collection.itemCount}
                      </span>
                      <span className="text-muted-foreground">Items</span>
                    </div>
                    <div className="flex flex-col items-center p-2 rounded-md bg-muted/50">
                      <Layers className="h-3.5 w-3.5 mb-1 text-muted-foreground" />
                      <span className="font-mono font-semibold">{collection.traitCount}</span>
                      <span className="text-muted-foreground">Traits</span>
                    </div>
                    <div className="flex flex-col items-center p-2 rounded-md bg-muted/50">
                      <Sparkles className="h-3.5 w-3.5 mb-1 text-muted-foreground" />
                      <span className="font-mono font-semibold">{collection.rarityCount}</span>
                      <span className="text-muted-foreground">Rarities</span>
                    </div>
                  </div>

                  {/* Minted Info */}
                  {collection.status === 'minted' && collection.mintedTxId && (
                    <div className="p-2 rounded-md bg-primary/10 border border-primary/20">
                      <p className="text-xs text-muted-foreground mb-1">Transaction ID</p>
                      <p className="text-xs font-mono truncate">{collection.mintedTxId}</p>
                    </div>
                  )}

                  {/* Updated */}
                  <p className="text-xs text-muted-foreground">
                    Updated {formatDate(collection.updatedAt)}
                  </p>

                  {/* Actions */}
                  <div className="flex gap-2 pt-1">
                    <Button
                      size="sm"
                      variant="default"
                      className="flex-1"
                      onClick={() => handleOpenCollection(collection.id)}
                    >
                      <FolderOpen className="mr-1.5 h-3.5 w-3.5" />
                      {collection.status === 'minted' ? 'View' : 'Open'}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleExportCollection(collection.id)}
                    >
                      <Download className="h-3.5 w-3.5" />
                    </Button>
                    {collection.status !== 'minted' && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleDeleteClick(collection)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </ScrollArea>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Collection</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{collectionToDelete?.name || 'Untitled Collection'}"?
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setCollectionToDelete(null)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
