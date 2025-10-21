import { useEffect, useState, useRef, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Slider } from '@/components/ui/slider';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { ScrollArea } from '@/components/ui/scroll-area';
import { getVscode } from '../vscode';
import { FolderOpen, Image, Sparkles, Coins, CheckCircle2, Edit, Settings, Layers, ArrowLeft, ExternalLink, Loader2 } from 'lucide-react';
import { RarityEditor } from '../components/collection/RarityEditor';
import { TraitsEditor } from '../components/collection/TraitsEditor';
import { TraitOverrideDialog } from '../components/collection/TraitOverrideDialog';
import { AIGenerationDialog } from '../components/AIGenerationDialog';
import '../App.css';

interface CollectionItemMetadata {
  name: string;
  description?: string;
  traits?: Array<{ name: string; value: string; }>;
  rarityLabel?: string;
  rank?: number;
  mintNumber?: number;
}

interface CollectionFile {
  id: string;
  path: string;
  name: string;
  dataUrl?: string;
  contentType: string;
  size: number;
  selected: boolean;
  metadata?: CollectionItemMetadata;
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
  batchSize?: number;
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
    traits: [],
    batchSize: 8
  });
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('setup');
  const [editingFile, setEditingFile] = useState<CollectionFile | null>(null);
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const [aiDialogType, setAiDialogType] = useState<'rarities' | 'traits'>('rarities');
  const [aiConfigDialogOpen, setAiConfigDialogOpen] = useState(false);
  const [isAssigning, setIsAssigning] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  // Setup form with react-hook-form (prevents UI lag)
  const setupForm = useForm({
    defaultValues: {
      name: '',
      description: '',
      quantity: 0
    }
  });

  // Item details form
  const itemDetailsForm = useForm({
    defaultValues: {
      name: '',
      description: '',
      rarityLabel: ''
    }
  });

  // Track if user is actively editing to prevent form resets
  const isEditingRef = useRef(false);
  const updateTimeoutRef = useRef<NodeJS.Timeout>();

  // Debounced update function
  const debouncedUpdateMetadata = useCallback((fileId: string, metadata: Partial<CollectionItemMetadata>) => {
    if (updateTimeoutRef.current) {
      clearTimeout(updateTimeoutRef.current);
    }
    updateTimeoutRef.current = setTimeout(() => {
      vscode.postMessage({
        command: 'updateFileMetadata',
        fileId,
        metadata
      });
      isEditingRef.current = false;
    }, 500); // 500ms debounce
  }, [vscode]);

  // Get selected files first
  const selectedFiles = files.filter(f => f.selected);

  // Get selected item
  const selectedItem = selectedItemId ? files.find(f => f.id === selectedItemId) : selectedFiles[0];

  // Calculate assignment status
  const itemsWithRarity = selectedFiles.filter(f => f.metadata?.rarityLabel).length;
  const itemsWithTraits = selectedFiles.filter(f => f.metadata?.traits && f.metadata.traits.length > 0).length;
  const allItemsAssigned = selectedFiles.length > 0 && itemsWithRarity === selectedFiles.length;

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

    // Cleanup timeout on unmount
    return () => {
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current);
      }
    };
  }, []);

  // Handle messages from extension
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const msg = event.data;

      if (msg.command === 'update') {
        setFiles(msg.files || []);
        setCollectionConfig(msg.collectionConfig || {});
        setSelectedFolder(msg.selectedFolder);

        // Update form values when backend sends data
        if (msg.collectionConfig) {
          setupForm.reset({
            name: msg.collectionConfig.name || '',
            description: msg.collectionConfig.description || '',
            quantity: msg.collectionConfig.quantity || 0
          });
        }
      } else if (msg.command === 'assignmentComplete') {
        setIsAssigning(false);
        // Show success message
        if (msg.success) {
          alert(`✅ ${msg.message || 'AI assignment completed successfully!'}`);
        } else {
          alert(`❌ ${msg.message || 'AI assignment failed. Please try again.'}`);
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [setupForm]);

  // Load images lazily when viewing Review tab
  useEffect(() => {
    if (activeTab === 'mint') {
      // Load images for selected files that don't have dataUrl yet
      const filesToLoad = files.filter(f => f.selected && !f.dataUrl);
      filesToLoad.forEach(file => {
        vscode.postMessage({ command: 'loadImage', fileId: file.id });
      });
    }
  }, [activeTab, files]); // Use files instead of computed selectedFiles

  // Load image for selected item and update form
  useEffect(() => {
    if (selectedItemId) {
      const item = files.find(f => f.id === selectedItemId);
      if (item && !item.dataUrl) {
        vscode.postMessage({ command: 'loadImage', fileId: item.id });
      }
      // Only update form when selectedItemId changes, NOT when files changes
      // This prevents overwriting user edits
      if (item && !isEditingRef.current) {
        itemDetailsForm.reset({
          name: item.metadata?.name || item.name,
          description: item.metadata?.description || '',
          rarityLabel: item.metadata?.rarityLabel || ''
        });
      }
    }
  }, [selectedItemId]); // ONLY depend on selectedItemId, not files!

  // Calculate costs in real-time
  const calculateCosts = (): CostEstimate => {
    const selectedFiles = files.filter(f => f.selected);
    const totalDataSize = selectedFiles.reduce((sum, f) => sum + f.size, 0);

    // More accurate fee calculation
    // Collection inscription: ~500 bytes for metadata + image
    // Each item: ~500 bytes metadata + image size
    const collectionTxSize = 500; // Collection metadata transaction

    // Using 50 sat/KB (standard rate)
    const satPerKb = 50;
    const collectionFee = (collectionTxSize / 1000) * satPerKb;
    const itemsFee = selectedFiles.reduce((sum, f) =>
      sum + ((f.size + 500) / 1000) * satPerKb, 0
    );

    // Convert satoshis to BSV (1 BSV = 100,000,000 sats)
    const totalFee = (collectionFee + itemsFee) / 100000000;

    // Each inscription requires 1 satoshi output
    const inscriptionOutputs = (selectedFiles.length + 1) / 100000000; // Collection + items

    return {
      itemCount: selectedFiles.length,
      totalDataSize,
      inscriptionCost: inscriptionOutputs,
      txFees: totalFee,
      totalBSV: inscriptionOutputs + totalFee
    };
  };

  const costEstimate = calculateCosts();

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

  const handleOpenAIDialog = (type: 'rarities' | 'traits') => {
    setAiDialogType(type);

    // Check if AI is available before opening dialog
    const handleAvailability = (event: MessageEvent) => {
      const msg = event.data;

      if (msg.command === 'aiAvailability') {
        window.removeEventListener('message', handleAvailability);

        if (msg.available) {
          // API key is configured, open the AI dialog
          setAiDialogOpen(true);
        } else {
          // No API key configured, show config dialog
          setAiConfigDialogOpen(true);
        }
      }
    };

    window.addEventListener('message', handleAvailability);

    // Request availability check
    vscode.postMessage({ command: 'checkAIAvailable' });
  };

  const handleAIGenerated = (data: any) => {
    if (aiDialogType === 'rarities' && data.rarityLabels) {
      handleUpdateConfig({ rarityLabels: data.rarityLabels });
    } else if (aiDialogType === 'traits' && data.traits) {
      handleUpdateConfig({ traits: data.traits });
    }
  };

  const handleMintCollection = () => {
    // Validate that items have rarities assigned
    const itemsWithoutRarity = selectedFiles.filter(f => !f.metadata?.rarityLabel);
    const itemsWithoutTraits = selectedFiles.filter(f => !f.metadata?.traits || f.metadata.traits.length === 0);

    if (itemsWithoutRarity.length > 0) {
      alert(`${itemsWithoutRarity.length} items don't have rarity assigned. Please use "Auto-Assign Rarities & Traits" in the Traits tab first.`);
      setActiveTab('traits');
      return;
    }

    if (collectionConfig.traits && collectionConfig.traits.length > 0 && itemsWithoutTraits.length > 0) {
      const proceed = confirm(`${itemsWithoutTraits.length} items don't have traits assigned. Do you want to continue anyway?`);
      if (!proceed) {
        setActiveTab('traits');
        return;
      }
    }

    vscode.postMessage({ command: 'mintCollection' });
  };

  const handleSaveTraits = (fileId: string, traits: Array<{ name: string; value: string }>, rarityLabel: string) => {
    vscode.postMessage({
      command: 'updateFileMetadata',
      fileId,
      metadata: {
        traits,
        rarityLabel
      }
    });
  };

  const handleUpdateItemMetadata = (fileId: string, metadata: Partial<CollectionItemMetadata>) => {
    vscode.postMessage({
      command: 'updateFileMetadata',
      fileId,
      metadata
    });
  };

  const handleBackToCollections = () => {
    vscode.postMessage({ command: 'backToCollections' });
  };

  return (
    <div className="h-screen flex flex-col bg-background p-4">
      {/* Navbar with Back Arrow */}
      <div className="sticky top-0 z-10 bg-background border-b border-border pb-4 mb-4">
        <div className="flex items-center gap-4 mb-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleBackToCollections}
            className="gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Collections
          </Button>
        </div>
        <div>
          <h1 className="text-2xl font-bold mb-2">Collection Minter</h1>
          <p className="text-sm text-muted-foreground">
            Create and mint NFT collections with custom traits and rarity distribution
          </p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="grid w-full grid-cols-4 flex-shrink-0">
          <TabsTrigger value="setup">
            <div className="flex items-center gap-2">
              <div className="flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-xs font-semibold">1</div>
              <span>Setup</span>
            </div>
          </TabsTrigger>
          <TabsTrigger value="files" disabled={files.length === 0}>
            <div className="flex items-center gap-2">
              <div className="flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-xs font-semibold">2</div>
              <span>Files ({selectedFiles.length})</span>
            </div>
          </TabsTrigger>
          <TabsTrigger value="traits" disabled={files.length === 0}>
            <div className="flex items-center gap-2">
              <div className="flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-xs font-semibold">3</div>
              <span>Traits</span>
              {selectedFiles.length > 0 && allItemsAssigned && (
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              )}
            </div>
          </TabsTrigger>
          <TabsTrigger value="mint" disabled={selectedFiles.length === 0}>
            <div className="flex items-center gap-2">
              <div className="flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-xs font-semibold">4</div>
              <span>Review & Mint</span>
            </div>
          </TabsTrigger>
        </TabsList>

        <div className="flex-1 overflow-hidden mt-4">
          <TabsContent value="setup" className="mt-0 h-full overflow-auto">
            <Card>
              <CardHeader>
                <CardTitle>Step 1: Collection Setup</CardTitle>
                <CardDescription>
                  Configure basic collection details and select source files
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Form {...setupForm}>
                  <FormField
                    control={setupForm.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Collection Name</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="My Awesome Collection"
                            {...field}
                            onBlur={(e) => {
                              field.onBlur();
                              handleUpdateConfig({ name: e.target.value });
                            }}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={setupForm.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Description</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="A unique collection of digital art..."
                            rows={3}
                            {...field}
                            onBlur={(e) => {
                              field.onBlur();
                              handleUpdateConfig({ description: e.target.value });
                            }}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={setupForm.control}
                    name="quantity"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Total Quantity</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            placeholder="100"
                            {...field}
                            onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                            onBlur={(e) => {
                              field.onBlur();
                              handleUpdateConfig({ quantity: parseInt(e.target.value) || 0 });
                            }}
                          />
                        </FormControl>
                        <FormDescription>
                          Total number of items in this collection
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </Form>

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

          <TabsContent value="files" className="mt-0 h-full overflow-auto">
            <Card>
              <CardHeader>
                <CardTitle>Step 2: Select Files ({selectedFiles.length} selected)</CardTitle>
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

                {/* Table View - Much faster for large collections */}
                <div className="border rounded-lg">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12">
                          <Checkbox
                            checked={files.length > 0 && files.every(f => f.selected)}
                            onCheckedChange={(checked: boolean) => {
                              files.forEach(f => handleToggleFileSelection(f.id, checked));
                            }}
                          />
                        </TableHead>
                        <TableHead>File Name</TableHead>
                        <TableHead>Traits</TableHead>
                        <TableHead>Rarity</TableHead>
                        <TableHead className="w-24">Size</TableHead>
                        <TableHead className="w-24">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {files.map((file) => (
                        <TableRow key={file.id} className={file.selected ? '' : 'opacity-50'}>
                          <TableCell>
                            <Checkbox
                              checked={file.selected}
                              onCheckedChange={(checked: boolean) => handleToggleFileSelection(file.id, checked)}
                            />
                          </TableCell>
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-2">
                              <Image className="h-4 w-4 text-muted-foreground" />
                              <span className="truncate max-w-xs">{file.name}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            {file.metadata?.traits && file.metadata.traits.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {file.metadata.traits.slice(0, 3).map((trait, idx) => (
                                  <span
                                    key={idx}
                                    className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded"
                                    title={`${trait.name}: ${trait.value}`}
                                  >
                                    {trait.value}
                                  </span>
                                ))}
                                {file.metadata.traits.length > 3 && (
                                  <span className="text-xs text-muted-foreground">
                                    +{file.metadata.traits.length - 3}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {file.metadata?.rarityLabel ? (
                              <span className="text-xs bg-muted px-2 py-1 rounded font-medium">
                                {file.metadata.rarityLabel}
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {(file.size / 1024).toFixed(1)} KB
                          </TableCell>
                          <TableCell>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0"
                              onClick={() => setEditingFile(file)}
                            >
                              <Edit className="h-3 w-3" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Trait Override Dialog */}
          {editingFile && (
            <TraitOverrideDialog
              open={!!editingFile}
              onOpenChange={(open) => !open && setEditingFile(null)}
              fileName={editingFile.name}
              currentTraits={editingFile.metadata?.traits || []}
              currentRarityLabel={editingFile.metadata?.rarityLabel}
              onSave={(traits, rarityLabel) => {
                handleSaveTraits(editingFile.id, traits, rarityLabel);
                setEditingFile(null);
              }}
            />
          )}

          <TabsContent value="traits" className="mt-0 h-full overflow-auto">
            <div className="space-y-4">
              {/* Rarity Labels Card */}
              <Card>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <CardTitle>Rarity Labels</CardTitle>
                      <CardDescription>
                        Define rarity tiers and their distribution across the collection
                      </CardDescription>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleOpenAIDialog('rarities')}
                      className="ml-4"
                    >
                      <Sparkles className="h-4 w-4 mr-2" />
                      AI Generate
                    </Button>
                  </div>
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
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <CardTitle>Traits</CardTitle>
                      <CardDescription>
                        Define trait categories and their possible values
                      </CardDescription>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleOpenAIDialog('traits')}
                      className="ml-4"
                    >
                      <Sparkles className="h-4 w-4 mr-2" />
                      AI Generate
                    </Button>
                  </div>
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
                <Card className={isAssigning ? 'border-blue-500/50' : allItemsAssigned ? 'border-green-500/50' : 'border-yellow-500/50'}>
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <CardTitle className="flex items-center gap-2">
                          Auto-Assignment
                          {isAssigning ? (
                            <Loader2 className="h-5 w-5 text-blue-500 animate-spin" />
                          ) : allItemsAssigned ? (
                            <CheckCircle2 className="h-5 w-5 text-green-500" />
                          ) : null}
                        </CardTitle>
                        <CardDescription>
                          {isAssigning
                            ? 'AI is analyzing your collection and assigning traits...'
                            : 'Automatically assign rarities and traits to your collection items'
                          }
                        </CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Assignment Status */}
                    <div className="p-3 rounded-lg bg-muted/50 space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Rarities Assigned</span>
                        <span className={`font-semibold ${allItemsAssigned ? 'text-green-600' : 'text-yellow-600'}`}>
                          {itemsWithRarity} / {selectedFiles.length}
                        </span>
                      </div>
                      {(collectionConfig.traits?.length || 0) > 0 && (
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">Traits Assigned</span>
                          <span className="font-semibold">
                            {itemsWithTraits} / {selectedFiles.length}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="text-sm text-muted-foreground space-y-2">
                      <p>
                        AI will intelligently analyze all {selectedFiles.length} items and assign rarities based on:
                      </p>
                      <ul className="list-disc list-inside space-y-1 ml-2">
                        <li>File names and patterns</li>
                        <li>Folder structure</li>
                        <li>Existing manual assignments</li>
                        <li>Target rarity percentages</li>
                      </ul>
                      {(collectionConfig.traits?.length || 0) > 0 && (
                        <p className="pt-1">
                          Traits will be assigned based on context and logical fit.
                        </p>
                      )}
                    </div>
                    <Button
                      onClick={() => {
                        setIsAssigning(true);
                        vscode.postMessage({
                          command: 'autoAssignTraits'
                        });
                      }}
                      className="w-full"
                      variant={allItemsAssigned ? 'outline' : 'default'}
                      disabled={isAssigning}
                    >
                      {isAssigning ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Analyzing collection with AI...
                        </>
                      ) : (
                        <>
                          <Sparkles className="h-4 w-4 mr-2" />
                          {allItemsAssigned ? 'AI Re-assign Rarities & Traits' : 'AI Assign Rarities & Traits'}
                        </>
                      )}
                    </Button>
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>

          <TabsContent value="mint" className="mt-0 h-full">
            {/* Resizable Inventory-Style Layout */}
            <ResizablePanelGroup direction="horizontal" className="h-full rounded-lg border">
              {/* Left: Item Grid */}
              <ResizablePanel defaultSize={60} minSize={40}>
                <div className="h-full flex flex-col">
                  {/* Fixed Header */}
                  <div className="p-4 border-b bg-background flex-shrink-0">
                    <h3 className="font-semibold">Collection Items</h3>
                    <p className="text-sm text-muted-foreground">
                      {selectedFiles.length} item{selectedFiles.length !== 1 ? 's' : ''} ready to mint
                    </p>
                  </div>

                  {/* Scrollable Grid */}
                  <ScrollArea className="flex-1 min-h-0">
                    <div className="p-4 grid grid-cols-4 gap-3">
                      {selectedFiles.map((file) => (
                        <button
                          key={file.id}
                          onClick={() => setSelectedItemId(file.id)}
                          className={`relative border-2 rounded-lg overflow-hidden transition-all hover:border-primary/70 ${
                            selectedItemId === file.id ? 'border-primary ring-2 ring-primary/20' : 'border-border'
                          }`}
                        >
                          {/* Item Image */}
                          <div className="aspect-square bg-muted">
                            {file.dataUrl && (
                              <img
                                src={file.dataUrl}
                                alt={file.metadata?.name || file.name}
                                className="w-full h-full object-cover"
                              />
                            )}
                          </div>

                          {/* Rarity Badge */}
                          {file.metadata?.rarityLabel && (
                            <div className="absolute top-1 right-1">
                              <div className="bg-black/70 backdrop-blur-sm rounded px-1.5 py-0.5 text-xs text-white font-medium">
                                {file.metadata.rarityLabel}
                              </div>
                            </div>
                          )}

                          {/* Selection Indicator */}
                          {selectedItemId === file.id && (
                            <div className="absolute top-1 left-1">
                              <CheckCircle2 className="h-4 w-4 text-primary fill-primary-foreground" />
                            </div>
                          )}
                        </button>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              </ResizablePanel>

              <ResizableHandle withHandle />

              {/* Right: Detail Panel */}
              <ResizablePanel defaultSize={40} minSize={30}>
                <div className="h-full flex flex-col">
                  {/* Fixed Preview Image Section */}
                  <div className="p-4 border-b bg-background flex-shrink-0">
                    {selectedItem ? (
                      <>
                        <div className="h-48 rounded-lg overflow-hidden border-2 border-primary/20 bg-muted relative">
                          {selectedItem.dataUrl ? (
                            <img
                              src={selectedItem.dataUrl}
                              alt={selectedItem.metadata?.name || selectedItem.name}
                              className="w-full h-full object-contain"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                              <div className="text-center">
                                <Image className="h-8 w-8 mx-auto mb-2 opacity-50" />
                                <p className="text-xs">Loading...</p>
                              </div>
                            </div>
                          )}
                        </div>
                      </>
                    ) : (
                      <div className="h-48 flex items-center justify-center text-muted-foreground">
                        <div className="text-center">
                          <Image className="h-12 w-12 mx-auto mb-2 opacity-50" />
                          <p className="text-sm">Select an item to preview</p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Scrollable Item Details */}
                  {selectedItem && (
                    <ScrollArea className="flex-1 min-h-0">
                        <div className="p-4 space-y-4">
                      {/* Source File */}
                      <div>
                        <Label htmlFor="item-src" className="text-xs text-muted-foreground">Source</Label>
                        <div className="flex gap-2 mt-1">
                          <Input
                            id="item-src"
                            value={selectedItem.path}
                            disabled
                            className="text-sm flex-1 font-mono text-xs"
                          />
                          <Button
                            variant="outline"
                            size="sm"
                            className="flex-shrink-0"
                            onClick={() => {
                              vscode.postMessage({ command: 'openFileInEditor', filePath: selectedItem.path });
                            }}
                          >
                            <ExternalLink className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>

                      <Form {...itemDetailsForm}>
                        {/* Name */}
                        <FormField
                          control={itemDetailsForm.control}
                          name="name"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-xs text-muted-foreground">Name</FormLabel>
                              <FormControl>
                                <Input
                                  {...field}
                                  className="text-sm"
                                  onChange={(e) => {
                                    isEditingRef.current = true;
                                    field.onChange(e);
                                    debouncedUpdateMetadata(selectedItem.id, {
                                      ...selectedItem.metadata,
                                      name: e.target.value
                                    });
                                  }}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        {/* Description */}
                        <FormField
                          control={itemDetailsForm.control}
                          name="description"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-xs text-muted-foreground">Description</FormLabel>
                              <FormControl>
                                <Textarea
                                  {...field}
                                  className="text-sm resize-none"
                                  rows={2}
                                  onChange={(e) => {
                                    isEditingRef.current = true;
                                    field.onChange(e);
                                    debouncedUpdateMetadata(selectedItem.id, {
                                      ...selectedItem.metadata,
                                      description: e.target.value
                                    });
                                  }}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        {/* Rarity */}
                        <FormField
                          control={itemDetailsForm.control}
                          name="rarityLabel"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-xs text-muted-foreground">Rarity</FormLabel>
                              <div className="flex items-center gap-2">
                                <Sparkles className="h-4 w-4 text-primary" />
                                <FormControl>
                                  <select
                                    {...field}
                                    className="flex-1 h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                    onChange={(e) => {
                                      field.onChange(e);
                                      // Rarity updates immediately (no debounce needed for dropdowns)
                                      handleUpdateItemMetadata(selectedItem.id, {
                                        ...selectedItem.metadata,
                                        rarityLabel: e.target.value
                                      });
                                    }}
                                  >
                                    <option value="">No Rarity</option>
                                    {collectionConfig.rarityLabels?.map((rarity) => (
                                      <option key={rarity.label} value={rarity.label}>
                                        {rarity.label}
                                      </option>
                                    ))}
                                  </select>
                                </FormControl>
                              </div>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </Form>

                      {/* Traits */}
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <Label className="text-xs text-muted-foreground">Traits</Label>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 text-xs"
                            onClick={() => setEditingFile(selectedItem)}
                          >
                            <Edit className="h-3 w-3 mr-1" />
                            Edit All
                          </Button>
                        </div>
                        <div className="space-y-2">
                          {selectedItem.metadata?.traits && selectedItem.metadata.traits.length > 0 ? (
                            selectedItem.metadata.traits.map((trait, idx) => (
                              <div key={idx} className="flex items-center justify-between p-2 rounded-md bg-muted/50 text-sm">
                                <span className="font-medium text-xs">{trait.name}</span>
                                <span className="text-xs text-muted-foreground">{trait.value}</span>
                              </div>
                            ))
                          ) : (
                            <p className="text-xs text-muted-foreground italic">No traits assigned</p>
                          )}
                        </div>
                      </div>

                      {/* Inscription Metadata Preview */}
                      <div className="pt-2 border-t space-y-3">
                        <h4 className="text-sm font-semibold flex items-center gap-2">
                          <Layers className="h-4 w-4" />
                          Item Inscription Metadata
                        </h4>

                        <div className="space-y-2 text-xs">
                          <div className="text-muted-foreground text-xs mb-2">
                            This shows the exact metadata that will be inscribed for this item:
                          </div>

                          <code className="block bg-muted p-3 rounded text-xs overflow-x-auto font-mono whitespace-pre">
                            {JSON.stringify(
                              {
                                app: 'vscode-bitcoin',
                                type: 'ord',
                                name: selectedItem.metadata?.name || selectedItem.name,
                                subType: 'collectionItem',
                                subTypeData: {
                                  collectionId: '(assigned when collection is minted)',
                                  mintNumber: selectedFiles.findIndex(f => f.id === selectedItem.id) + 1,
                                  ...(selectedItem.metadata?.rarityLabel && {
                                    rarityLabel: selectedItem.metadata.rarityLabel
                                  }),
                                  ...(selectedItem.metadata?.traits && selectedItem.metadata.traits.length > 0 && {
                                    traits: selectedItem.metadata.traits.map(t => ({
                                      name: t.name,
                                      value: t.value
                                    }))
                                  })
                                }
                              },
                              null,
                              2
                            )}
                          </code>

                          <div className="pt-2 mt-3 border-t space-y-1">
                            <p className="text-muted-foreground text-xs mb-2">File Information:</p>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">File Size</span>
                              <span className="font-mono">{(selectedItem.size / 1024).toFixed(2)} KB</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Type</span>
                              <span className="font-mono">{selectedItem.contentType}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                        </div>
                      </ScrollArea>
                  )}

                  {/* Fixed Mint Controls at Bottom */}
                  <div className="p-4 border-t bg-background flex-shrink-0">
                    <div className="space-y-4">
                {/* Batch Size Configuration */}
                <div className="mb-4 pb-4 border-b">
                  <div className="flex items-center justify-between mb-2">
                    <Label className="text-sm font-medium">Batch Size</Label>
                    <span className="text-xs text-muted-foreground font-mono">
                      {collectionConfig.batchSize || 8} items per transaction
                    </span>
                  </div>
                  <Slider
                    value={[collectionConfig.batchSize || 8]}
                    onValueChange={(value) => handleUpdateConfig({ batchSize: value[0] })}
                    min={1}
                    max={99}
                    step={1}
                    className="w-full"
                  />
                  <p className="text-xs text-muted-foreground mt-2">
                    Minting in batches improves origin indexing digestibility. Multiple transactions will be created for large collections.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4 mb-4">
                  {/* Cost Breakdown */}
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Items to mint:</span>
                      <span className="font-mono">{costEstimate.itemCount}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Total Size:</span>
                      <span className="font-mono">{(costEstimate.totalDataSize / 1024).toFixed(2)} KB</span>
                    </div>
                  </div>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Inscription Outputs:</span>
                      <span className="font-mono">{costEstimate.inscriptionCost.toFixed(8)} BSV</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Transaction Fees:</span>
                      <span className="font-mono">{costEstimate.txFees.toFixed(8)} BSV</span>
                    </div>
                  </div>
                </div>

                <div className="border-t pt-3 mb-3 flex justify-between font-semibold">
                  <span>Estimated Total:</span>
                  <span className="font-mono text-primary text-lg">{costEstimate.totalBSV.toFixed(8)} BSV</span>
                </div>

                      <Button
                        onClick={handleMintCollection}
                        className="w-full"
                        size="lg"
                        disabled={!collectionConfig.name || !collectionConfig.description || selectedFiles.length === 0}
                      >
                        <Coins className="h-4 w-4 mr-2" />
                        Mint Collection ({selectedFiles.length} item{selectedFiles.length !== 1 ? 's' : ''})
                      </Button>
                    </div>
                  </div>
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
          </TabsContent>
        </div>
      </Tabs>

      {/* AI Generation Dialog */}
      <AIGenerationDialog
        open={aiDialogOpen}
        onOpenChange={setAiDialogOpen}
        type={aiDialogType}
        collectionName={collectionConfig.name}
        onGenerated={handleAIGenerated}
      />

      {/* AI Configuration Required Dialog */}
      <AlertDialog open={aiConfigDialogOpen} onOpenChange={setAiConfigDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              OpenAI API Key Required
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-4">
              <p>
                To use AI-powered generation features, you need to configure an OpenAI API key.
              </p>
              <div className="space-y-2">
                <p className="font-semibold text-sm text-foreground">Option 1: Environment Variable (Recommended)</p>
                <p className="text-sm">
                  Set the <code className="bg-muted px-1 py-0.5 rounded text-xs">OPENAI_API_KEY</code> environment variable:
                </p>
                <pre className="bg-muted p-2 rounded text-xs overflow-x-auto">
export OPENAI_API_KEY=sk-...
                </pre>
              </div>
              <div className="space-y-2">
                <p className="font-semibold text-sm text-foreground">Option 2: VS Code Settings</p>
                <p className="text-sm">
                  Add your API key to VS Code settings:
                </p>
                <ol className="text-sm list-decimal list-inside space-y-1">
                  <li>Open Settings (Cmd/Ctrl + ,)</li>
                  <li>Search for "Bitcoin: Ai: Openai Api Key"</li>
                  <li>Enter your API key</li>
                </ol>
              </div>
              <p className="text-sm">
                Get an API key at{' '}
                <a href="https://platform.openai.com" className="text-primary hover:underline" target="_blank" rel="noopener noreferrer">
                  platform.openai.com
                </a>
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Close</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                vscode.postMessage({ command: 'openSettings', setting: 'bitcoin.ai.openaiApiKey' });
              }}
            >
              <Settings className="h-4 w-4 mr-2" />
              Open Settings
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
