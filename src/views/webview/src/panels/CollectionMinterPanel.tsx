import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getVscode } from '../vscode';
import { FolderOpen, Image, Sparkles, Coins, CheckCircle2, Wand2 } from 'lucide-react';
import { RarityEditor } from '../components/collection/RarityEditor';
import { TraitsEditor } from '../components/collection/TraitsEditor';
import '../App.css';

interface CollectionFile {
  id: string;
  path: string;
  name: string;
  dataUrl?: string;
  contentType: string;
  size: number;
  selected: boolean;
  metadata?: {
    name: string;
    description?: string;
    traits?: Array<{ name: string; value: string; }>;
    rarityLabel?: string;
    rank?: number;
    mintNumber?: number;
  };
}

type FolderStructure = 'flat' | 'one-level' | 'two-level';

interface CollectionConfig {
  name: string;
  description: string;
  quantity: number;
  rarityLabels: Array<{ label: string; percentage: string; }>;
  traits: Array<{
    name: string;
    values: string[];
    occurancePercentages: string[];
  }>;
  folderStructure?: FolderStructure;
  traitMapping?: {
    level1TraitName: string;
    level2TraitName: string;
  };
}

interface CostEstimate {
  itemCount: number;
  totalDataSize: number;
  inscriptionCost: number;
  txFees: number;
  totalBSV: number;
}

// Declare global payload
declare global {
  interface Window {
    COLLECTION_PAYLOAD?: {
      files: CollectionFile[];
      collectionConfig: Partial<CollectionConfig>;
      selectedFolder: string | null;
    };
  }
}

export function CollectionMinterPanel() {
  const vscode = getVscode();
  const [files, setFiles] = useState<CollectionFile[]>([]);
  const [collectionConfig, setCollectionConfig] = useState<Partial<CollectionConfig>>({
    rarityLabels: [],
    traits: []
  });
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [costEstimate, setCostEstimate] = useState<CostEstimate | null>(null);
  const [activeTab, setActiveTab] = useState('setup');

  // Load initial payload
  useEffect(() => {
    if (window.COLLECTION_PAYLOAD) {
      setFiles(window.COLLECTION_PAYLOAD.files || []);
      setCollectionConfig(window.COLLECTION_PAYLOAD.collectionConfig || {});
      setSelectedFolder(window.COLLECTION_PAYLOAD.selectedFolder);
    }

    // Remove initial loading spinner
    const loader = document.getElementById('initial-loader');
    if (loader) {
      loader.style.opacity = '0';
      loader.style.transition = 'opacity 0.3s';
      setTimeout(() => loader.remove(), 300);
    }

    // Apply dark mode
    document.documentElement.classList.add('dark');
  }, []);

  // Handle messages from extension
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const msg = event.data;

      if (msg.command === 'update') {
        setFiles(msg.files || []);
        setCollectionConfig(msg.collectionConfig || {});
        setSelectedFolder(msg.selectedFolder);
      }

      if (msg.command === 'costEstimate') {
        setCostEstimate(msg.estimate);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleSelectFolder = () => {
    vscode.postMessage({ command: 'selectFolder' });
  };

  const handleToggleFileSelection = (fileId: string, selected: boolean) => {
    vscode.postMessage({
      command: 'updateFileSelection',
      fileId,
      selected
    });
  };

  const handleUpdateConfig = (updates: Partial<CollectionConfig>) => {
    const newConfig = { ...collectionConfig, ...updates };
    setCollectionConfig(newConfig);
    vscode.postMessage({
      command: 'updateCollectionConfig',
      config: newConfig
    });
  };

  const handleEstimateCosts = () => {
    vscode.postMessage({ command: 'estimateCosts' });
  };

  const handleMintCollection = () => {
    vscode.postMessage({ command: 'mintCollection' });
  };

  const selectedFiles = files.filter(f => f.selected);

  return (
    <div className="h-screen flex flex-col bg-background p-4">
      <div className="mb-4">
        <h1 className="text-2xl font-bold mb-2">Collection Minter</h1>
        <p className="text-sm text-muted-foreground">
          Create and mint NFT collections with AI-generated images and custom traits
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="setup">
            <FolderOpen className="h-4 w-4 mr-2" />
            Setup
          </TabsTrigger>
          <TabsTrigger value="files" disabled={files.length === 0}>
            <Image className="h-4 w-4 mr-2" />
            Files ({selectedFiles.length})
          </TabsTrigger>
          <TabsTrigger value="traits" disabled={files.length === 0}>
            <Sparkles className="h-4 w-4 mr-2" />
            Traits
          </TabsTrigger>
          <TabsTrigger value="mint" disabled={selectedFiles.length === 0}>
            <Coins className="h-4 w-4 mr-2" />
            Mint
          </TabsTrigger>
        </TabsList>

        <div className="flex-1 overflow-auto mt-4">
          <TabsContent value="setup" className="mt-0">
            <Card>
              <CardHeader>
                <CardTitle>Collection Setup</CardTitle>
                <CardDescription>
                  Configure your collection details and select source files
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Collection Name</Label>
                  <Input
                    id="name"
                    placeholder="My Awesome Collection"
                    value={collectionConfig.name || ''}
                    onChange={(e) => handleUpdateConfig({ name: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    placeholder="A unique collection of digital art..."
                    value={collectionConfig.description || ''}
                    onChange={(e) => handleUpdateConfig({ description: e.target.value })}
                    rows={3}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="quantity">Total Quantity</Label>
                  <Input
                    id="quantity"
                    type="number"
                    placeholder="100"
                    value={collectionConfig.quantity || ''}
                    onChange={(e) => handleUpdateConfig({ quantity: parseInt(e.target.value) || 0 })}
                  />
                </div>

                <div className="border-t pt-4">
                  <h3 className="font-semibold mb-2">Source Files</h3>
                  {selectedFolder ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                        <span>{selectedFolder}</span>
                      </div>
                      <p className="text-sm">Loaded {files.length} images</p>
                      <Button onClick={handleSelectFolder} variant="outline" size="sm">
                        Change Folder
                      </Button>
                    </div>
                  ) : (
                    <Button onClick={handleSelectFolder} className="w-full">
                      <FolderOpen className="h-4 w-4 mr-2" />
                      Select Folder
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="files" className="mt-0">
            <Card>
              <CardHeader>
                <CardTitle>Files ({selectedFiles.length} selected)</CardTitle>
                <CardDescription>
                  Review and select images for your collection
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Folder Structure Info */}
                {collectionConfig.folderStructure && (
                  <div className="border rounded-lg p-3 bg-muted/50 space-y-2">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                      <span>
                        {collectionConfig.folderStructure === 'flat' && 'Flat structure (all files in root)'}
                        {collectionConfig.folderStructure === 'one-level' && 'One-level structure (files in subfolders)'}
                        {collectionConfig.folderStructure === 'two-level' && 'Two-level structure (nested subfolders)'}
                      </span>
                    </div>

                    {/* Show auto-detected traits */}
                    {files.length > 0 && files.some(f => f.metadata?.traits && f.metadata.traits.length > 0) && (
                      <div className="text-xs space-y-1">
                        <p className="text-muted-foreground">Auto-detected traits from folders:</p>
                        {(() => {
                          const traitSummary = new Map<string, Set<string>>();
                          files.forEach(file => {
                            file.metadata?.traits?.forEach(trait => {
                              if (!traitSummary.has(trait.name)) {
                                traitSummary.set(trait.name, new Set());
                              }
                              traitSummary.get(trait.name)!.add(trait.value);
                            });
                          });

                          return Array.from(traitSummary.entries()).map(([name, values]) => (
                            <div key={name} className="flex gap-2">
                              <span className="font-mono font-semibold">{name}:</span>
                              <span className="text-muted-foreground">
                                {values.size} {values.size === 1 ? 'value' : 'values'}
                                ({Array.from(values).slice(0, 3).join(', ')}
                                {values.size > 3 ? '...' : ''})
                              </span>
                            </div>
                          ));
                        })()}
                      </div>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {files.map((file) => (
                    <div
                      key={file.id}
                      className={`relative border rounded-lg p-2 cursor-pointer transition-all ${
                        file.selected ? 'ring-2 ring-primary' : 'opacity-50'
                      }`}
                      onClick={() => handleToggleFileSelection(file.id, !file.selected)}
                    >
                      {file.dataUrl && (
                        <img
                          src={file.dataUrl}
                          alt={file.name}
                          className="w-full h-32 object-cover rounded"
                        />
                      )}
                      <div className="mt-2 space-y-1">
                        <p className="text-xs truncate font-medium">{file.name}</p>
                        {file.metadata?.traits && file.metadata.traits.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {file.metadata.traits.map((trait, idx) => (
                              <span
                                key={idx}
                                className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded"
                                title={`${trait.name}: ${trait.value}`}
                              >
                                {trait.value}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="absolute top-1 right-1">
                        <input
                          type="checkbox"
                          checked={file.selected}
                          onChange={(e) => {
                            e.stopPropagation();
                            handleToggleFileSelection(file.id, e.target.checked);
                          }}
                          className="h-4 w-4"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="traits" className="mt-0">
            <div className="space-y-4">
              {/* Rarity Labels Card */}
              <Card>
                <CardHeader>
                  <CardTitle>Rarity Labels</CardTitle>
                  <CardDescription>
                    Define rarity tiers and their distribution across the collection
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <RarityEditor
                    rarities={collectionConfig.rarityLabels || []}
                    onChange={(rarities) => handleUpdateConfig({ rarityLabels: rarities })}
                  />
                </CardContent>
              </Card>

              {/* Traits Card */}
              <Card>
                <CardHeader>
                  <CardTitle>Traits</CardTitle>
                  <CardDescription>
                    Define trait categories and their possible values
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <TraitsEditor
                    traits={collectionConfig.traits || []}
                    onChange={(traits) => handleUpdateConfig({ traits })}
                  />
                </CardContent>
              </Card>

              {/* Auto-Assignment Card */}
              {selectedFiles.length > 0 && (collectionConfig.rarityLabels?.length || 0) > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle>Auto-Assignment</CardTitle>
                    <CardDescription>
                      Automatically assign rarities and traits to your collection items
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="text-sm text-muted-foreground space-y-2">
                      <p>
                        This will randomly assign rarity labels to {selectedFiles.length} items
                        based on the percentages you've defined above.
                      </p>
                      {(collectionConfig.traits?.length || 0) > 0 && (
                        <p>
                          Additional traits will also be assigned based on their occurrence percentages.
                        </p>
                      )}
                    </div>
                    <Button
                      onClick={() => {
                        vscode.postMessage({
                          command: 'autoAssignTraits'
                        });
                      }}
                      className="w-full"
                    >
                      <Wand2 className="h-4 w-4 mr-2" />
                      Auto-Assign Rarities & Traits
                    </Button>
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>

          <TabsContent value="mint" className="mt-0">
            <Card>
              <CardHeader>
                <CardTitle>Mint Collection</CardTitle>
                <CardDescription>
                  Review costs and mint your collection
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Button onClick={handleEstimateCosts} variant="outline" className="w-full">
                    Estimate Costs
                  </Button>

                  {costEstimate && (
                    <div className="border rounded-lg p-4 space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Items:</span>
                        <span className="font-mono">{costEstimate.itemCount}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Total Data Size:</span>
                        <span className="font-mono">{(costEstimate.totalDataSize / 1024).toFixed(2)} KB</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Inscription Cost:</span>
                        <span className="font-mono">{costEstimate.inscriptionCost.toFixed(8)} BSV</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">TX Fees:</span>
                        <span className="font-mono">{costEstimate.txFees.toFixed(8)} BSV</span>
                      </div>
                      <div className="border-t pt-2 flex justify-between font-semibold">
                        <span>Total:</span>
                        <span className="font-mono">{costEstimate.totalBSV.toFixed(8)} BSV</span>
                      </div>
                    </div>
                  )}
                </div>

                <Button onClick={handleMintCollection} className="w-full" disabled={!costEstimate}>
                  <Coins className="h-4 w-4 mr-2" />
                  Mint Collection
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
