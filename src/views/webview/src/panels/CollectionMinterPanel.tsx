import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Response } from '@/components/ai-elements/response';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Slider } from '@/components/ui/slider';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ProcessedImage } from '@/components/ProcessedImage';
import { getVscode } from '../vscode';
import { FolderOpen, Folder, Image, Sparkles, Coins, CheckCircle2, Edit, Settings, Layers, ArrowLeft, ExternalLink, Loader2, AlertCircle, XCircle, Save, ChevronRight, Copy, Plus, GripVertical, ArrowUp, ArrowDown, Trash2, FileQuestion, FileText, Info } from 'lucide-react';
import { RarityEditor } from '../components/collection/RarityEditor';
import { TraitsEditor } from '../components/collection/TraitsEditor';
import { TraitOverrideDialog } from '../components/collection/TraitOverrideDialog';
import { AIGenerationDialog } from '../components/AIGenerationDialog';
import '../App.css';

// Draggable Item Component (Native HTML5 Drag-and-Drop)
function DraggableItem({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', id);
      }}
    >
      {children}
    </div>
  );
}

// Droppable Group Component (Native HTML5 Drag-and-Drop)
function DroppableGroup({ id, children, onDrop }: {
  id: string;
  children: React.ReactNode;
  onDrop: (fileId: string, targetGroup: string) => void;
}) {
  const [isOver, setIsOver] = useState(false);

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setIsOver(true);
      }}
      onDragLeave={() => {
        setIsOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setIsOver(false);
        const fileId = e.dataTransfer.getData('text/plain');
        if (fileId) {
          onDrop(fileId, id);
        }
      }}
      className={isOver ? 'ring-2 ring-primary ring-offset-2 rounded-md' : ''}
    >
      {children}
    </div>
  );
}

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
  // For variant support
  variantGroup?: string; // Item name that groups variants together
  isVariant?: boolean; // True if this file is a variant of an item
}

interface VariantGroup {
  itemName: string;
  variants: CollectionFile[];
  metadata: CollectionItemMetadata;
  mintQuantity: number; // How many copies to mint (distributed across variants)
}

type FolderStructure = 'flat' | 'one-level' | 'two-level';

interface FilenamePattern {
  type: 'prefix' | 'suffix' | 'contains' | 'regex';
  targetField: string; // 'variant', 'rarity', or trait name
  pattern: string;
  matchValue?: string; // For prefix/suffix/contains, what value to extract
}

interface RenamePattern {
  type: 'prefix-remove' | 'suffix-remove' | 'replace' | 'regex-replace';
  pattern: string;
  replacement?: string; // For replace types
}

interface NameStandardization {
  enabled: boolean;
  template: string; // Template with variables: {itemName}, {rarity}, {trait:TraitName}
}

// Pipeline operation types
type PipelineOperation =
  | { type: 'exclude'; path: string; reason: string; }
  | { type: 'move'; from: string; to: string; reason?: string; }
  | { type: 'rename-folder'; from: string; to: string; reason?: string; }
  | {
      type: 'transform';
      scope: string | 'all';
      renamePatterns: RenamePattern[];
      reason?: string;
    }
  | {
      type: 'map-traits';
      scope: string | 'all';
      filenamePatterns: FilenamePattern[];
      reason?: string;
    }
  | {
      type: 'map-folders';
      scope: string | 'all';
      traitMapping: {
        level1TraitName?: string;
        level2TraitName?: string;
        folderAsItemName?: boolean;
      };
      reason?: string;
    }
  | {
      type: 'standardize-names';
      scope: string | 'all';
      nameStandardization: NameStandardization;
      reason?: string;
    }
  | {
      type: 'compress';
      scope: string | 'all';
      quality: number;
      maxWidth?: number;
      maxHeight?: number;
      format?: 'jpeg' | 'png' | 'webp';
      reason?: string;
    }
  | {
      type: 'filter';
      scope: string | 'all';
      rules: Array<{
        field: string;
        operator: 'equals' | 'contains' | 'startsWith' | 'endsWith' | 'regex';
        value: string;
        action: 'include' | 'exclude';
      }>;
      reason?: string;
    };

interface Pipeline {
  operations: PipelineOperation[];
  reasoning: string;
  warnings?: string[];
}

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
    level1TraitName?: string;
    level2TraitName?: string;
    folderAsItemName?: boolean; // Use folder name as item name, files are variants
  };
  renamePatterns?: RenamePattern[]; // Applied BEFORE other mappings
  filenamePatterns?: FilenamePattern[];
  nameStandardization?: NameStandardization; // Applied AFTER all mappings
  variantGroups?: Record<string, number>; // itemName -> mintQuantity mapping
  batchSize?: number;
  aiPromptContext?: string; // Optional user-provided context for AI configuration
  pipeline?: Pipeline; // New pipeline system
}

interface CostEstimate {
  itemCount: number;
  totalDataSize: number;
  inscriptionCost: number;
  txFees: number;
  totalBSV: number;
}

interface MintProgressItem {
  current: number;
  total: number;
  status: 'success' | 'saved' | 'error';
  txid?: string;
  label?: string;
  message?: string;
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
  const [isConfiguring, setIsConfiguring] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  // Mint progress tracking
  const [isMinting, setIsMinting] = useState(false);
  const [mintProgressItems, setMintProgressItems] = useState<MintProgressItem[]>([]);

  // Pipeline execution progress tracking
  const [isPipelineExecuting, setIsPipelineExecuting] = useState(false);
  const [pipelineProgress, setPipelineProgress] = useState<{
    currentStep: number;
    totalSteps: number;
    steps: Array<{
      operationType: string;
      status: 'pending' | 'in_progress' | 'completed' | 'error';
      message: string;
      filesAffected?: number;
    }>;
  }>({ currentStep: 0, totalSteps: 0, steps: [] });
  const [transformedFiles, setTransformedFiles] = useState<Array<{
    id: string;
    path: string;
    name: string;
    metadata?: {
      name: string;
      traits?: Array<{ name: string; value: string }>;
      rarityLabel?: string;
    };
  }> | null>(null);
  const [showMintProgressModal, setShowMintProgressModal] = useState(false);

  // AI Pipeline Config Success Modal
  const [showPipelineSuccessModal, setShowPipelineSuccessModal] = useState(false);
  const [pipelineSuccessData, setPipelineSuccessData] = useState<{
    message: string;
    operations: Array<{ type: string; scope?: string; reason?: string }>;
  } | null>(null);

  // Pipeline Execution Logs
  const [executionLogs, setExecutionLogs] = useState<Array<{ timestamp: string; message: string; level: 'info' | 'warning' | 'error' }>>([]);
  const [showLogsModal, setShowLogsModal] = useState(false);
  const [aiStrategy, setAiStrategy] = useState<string | null>(null);

  // Sub-tab state for Review & Mint
  const [itemSubTab, setItemSubTab] = useState<'collection' | 'item' | 'output'>('item');
  const [outputSettings, setOutputSettings] = useState({
    format: 'original',
    quality: 85,
    maxWidth: 2048,
    maxHeight: 2048,
    compression: 'lossy'
  });

  // Group By state for tree view (can be 'rarity', 'none', or any trait name)
  const [groupBy, setGroupBy] = useState<string>('rarity');

  // Notification dialog state (replaces alert())
  const [notificationDialog, setNotificationDialog] = useState<{
    open: boolean;
    title: string;
    message: string;
    type: 'success' | 'error' | 'info';
  }>({
    open: false,
    title: '',
    message: '',
    type: 'info'
  });

  const showNotification = (message: string, type: 'success' | 'error' | 'info' = 'info', title?: string) => {
    setNotificationDialog({
      open: true,
      title: title || (type === 'success' ? '✅ Success' : type === 'error' ? '❌ Error' : 'ℹ️ Info'),
      message,
      type
    });
  };

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
  const setupFormInitialized = useRef(false);
  const updateTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const configUpdateTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);

  // Debounced update function for item metadata
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

  // Debounced update function for collection config
  const debouncedUpdateConfig = useCallback((updates: Partial<CollectionConfig>) => {
    if (configUpdateTimeoutRef.current) {
      clearTimeout(configUpdateTimeoutRef.current);
    }
    configUpdateTimeoutRef.current = setTimeout(() => {
      vscode.postMessage({
        command: 'updateConfig',
        config: updates
      });
    }, 1000); // 1 second debounce for config to reduce interruptions
  }, [vscode]);

  // Get selected files - use transformed files if available, otherwise use original files
  // When transformedFiles exists, merge it with selection state from original files
  const selectedFiles = useMemo((): CollectionFile[] => {
    if (transformedFiles && transformedFiles.length > 0) {
      // Map transformed files back to CollectionFile format with selection state preserved
      const merged: CollectionFile[] = [];
      for (const tf of transformedFiles) {
        const originalFile = files.find(f => f.id === tf.id);
        if (originalFile && originalFile.selected) {
          merged.push({
            ...originalFile,
            path: tf.path,
            metadata: tf.metadata || originalFile.metadata
          });
        }
      }
      return merged;
    }
    return files.filter(f => f.selected);
  }, [files, transformedFiles]);

  // Get selected item - use transformed path if available
  const selectedItem = useMemo((): CollectionFile | undefined => {
    if (!selectedItemId) return selectedFiles[0];

    const originalFile = files.find(f => f.id === selectedItemId);
    if (!originalFile) return selectedFiles[0];

    if (transformedFiles && transformedFiles.length > 0) {
      const tf = transformedFiles.find(f => f.id === selectedItemId);
      if (tf) {
        return {
          ...originalFile,
          path: tf.path,
          metadata: tf.metadata || originalFile.metadata
        };
      }
    }
    return originalFile;
  }, [selectedItemId, files, transformedFiles, selectedFiles]);

  // Calculate assignment status
  const itemsWithRarity = selectedFiles.filter(f => f.metadata?.rarityLabel).length;
  const itemsWithTraits = selectedFiles.filter(f => f.metadata?.traits && f.metadata.traits.length > 0).length;
  const allItemsAssigned = selectedFiles.length > 0 && itemsWithRarity === selectedFiles.length;

  // Group files by selected field for tree view
  const groupedFiles = useMemo(() => {
    if (groupBy === 'none') {
      return { 'All Items': selectedFiles };
    }

    const groups: Record<string, CollectionFile[]> = {};

    selectedFiles.forEach(file => {
      let groupKey = 'Ungrouped';

      if (groupBy === 'rarity') {
        groupKey = file.metadata?.rarityLabel || 'No Rarity';
      } else {
        // Group by trait - find the trait value
        const trait = file.metadata?.traits?.find(t => t.name === groupBy);
        groupKey = trait?.value || 'No Value';
      }

      if (!groups[groupKey]) {
        groups[groupKey] = [];
      }
      groups[groupKey].push(file);
    });

    return groups;
  }, [selectedFiles, groupBy]);

  // Compute variant groups when folder is mapped to "itemName" OR when filename patterns mark files as variants
  const variantGroups = useMemo(() => {
    const folderMappedToItemName = collectionConfig.traitMapping?.level1TraitName === 'itemName';
    const hasVariantPatterns = collectionConfig.filenamePatterns?.some(p => p.targetField === 'variant');

    if (!folderMappedToItemName && !hasVariantPatterns) {
      return null; // Variant mode not enabled
    }

    const groups: Record<string, VariantGroup> = {};

    selectedFiles.forEach(file => {
      // Get relative path to determine item name from folder
      const relativePath = selectedFolder
        ? file.path.replace(selectedFolder, '').replace(/^\//, '')
        : file.path;
      const pathParts = relativePath.split('/').filter(Boolean);
      const folders = pathParts.slice(0, -1);
      const fileName = pathParts[pathParts.length - 1];
      const fileNameWithoutExt = fileName.replace(/\.[^/.]+$/, '');

      let itemName: string;
      let isVariant = false;

      // Check if filename matches a variant pattern
      if (hasVariantPatterns) {
        for (const pattern of collectionConfig.filenamePatterns || []) {
          if (pattern.targetField !== 'variant') continue;

          let matches = false;
          if (pattern.type === 'prefix' && fileNameWithoutExt.toLowerCase().startsWith(pattern.pattern.toLowerCase())) {
            matches = true;
          } else if (pattern.type === 'suffix' && fileNameWithoutExt.toLowerCase().endsWith(pattern.pattern.toLowerCase())) {
            matches = true;
          } else if (pattern.type === 'contains' && fileNameWithoutExt.toLowerCase().includes(pattern.pattern.toLowerCase())) {
            matches = true;
          } else if (pattern.type === 'regex') {
            try {
              matches = new RegExp(pattern.pattern, 'i').test(fileNameWithoutExt);
            } catch {}
          }

          if (matches) {
            isVariant = true;
            break;
          }
        }
      }

      // If folder is mapped to itemName, use folder as item name
      if (folderMappedToItemName && folders.length >= 1) {
        itemName = folders[folders.length - 1];
        isVariant = true; // All files in this folder are variants
      } else {
        // Use the file's metadata name or filename as item name
        itemName = file.metadata?.name || fileNameWithoutExt;
      }

      if (!isVariant) {
        return; // Skip non-variant files
      }

      if (!groups[itemName]) {
        groups[itemName] = {
          itemName,
          variants: [],
          metadata: file.metadata || { name: itemName },
          mintQuantity: collectionConfig.variantGroups?.[itemName] || 1
        };
      }

      groups[itemName].variants.push(file);
    });

    // Only return groups if we actually found variants
    return Object.keys(groups).length > 0 ? groups : null;
  }, [selectedFiles, collectionConfig.traitMapping?.level1TraitName, collectionConfig.filenamePatterns, collectionConfig.variantGroups, selectedFolder]);

  // Drag and drop handler
  const handleItemDrop = useCallback((fileId: string, targetGroup: string) => {
    const file = files.find(f => f.id === fileId);
    if (!file) return;

    const updatedMetadata = { ...file.metadata };

    if (groupBy === 'rarity') {
      // Update rarity label
      updatedMetadata.rarityLabel = targetGroup === 'No Rarity' ? undefined : targetGroup;
    } else if (groupBy !== 'none') {
      // Update specific trait
      if (!updatedMetadata.traits) {
        updatedMetadata.traits = [];
      }
      const traitIndex = updatedMetadata.traits.findIndex(t => t.name === groupBy);
      if (traitIndex >= 0) {
        updatedMetadata.traits[traitIndex].value = targetGroup === 'No Value' ? '' : targetGroup;
      } else {
        updatedMetadata.traits.push({ name: groupBy, value: targetGroup === 'No Value' ? '' : targetGroup });
      }
    }

    // Send update to backend
    vscode.postMessage({
      command: 'updateFileMetadata',
      fileId,
      metadata: updatedMetadata
    });
  }, [files, groupBy, vscode]);

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

    // Cleanup timeouts on unmount
    return () => {
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current);
      }
      if (configUpdateTimeoutRef.current) {
        clearTimeout(configUpdateTimeoutRef.current);
      }
    };
  }, []);

  // Handle messages from extension
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const msg = event.data;

      if (msg.command === 'update') {
        setFiles(msg.files || []);
        setSelectedFolder(msg.selectedFolder);

        // Check if we should accept config updates
        const shouldAcceptConfig = !setupFormInitialized.current || (window as any).__acceptNextConfigUpdate;

        console.log('[CollectionMinter] Received update:', {
          hasConfig: !!msg.collectionConfig,
          shouldAccept: shouldAcceptConfig,
          acceptFlag: (window as any).__acceptNextConfigUpdate,
          renamePatterns: msg.collectionConfig?.renamePatterns?.length || 0,
          filenamePatterns: msg.collectionConfig?.filenamePatterns?.length || 0,
          nameStandardization: msg.collectionConfig?.nameStandardization
        });

        if (msg.collectionConfig && shouldAcceptConfig) {
          console.log('[CollectionMinter] Applying config update:', {
            renamePatterns: msg.collectionConfig.renamePatterns,
            filenamePatterns: msg.collectionConfig.filenamePatterns,
            nameStandardization: msg.collectionConfig.nameStandardization
          });
          setCollectionConfig(msg.collectionConfig || {});

          // Only reset the form on first load, not after AI config
          if (!setupFormInitialized.current) {
            setupForm.reset({
              name: msg.collectionConfig.name || '',
              description: msg.collectionConfig.description || '',
              quantity: msg.collectionConfig.quantity || 0
            });
            setupFormInitialized.current = true;
          }

          // Clear the flag if it was set
          if ((window as any).__acceptNextConfigUpdate) {
            console.log('[CollectionMinter] Cleared acceptNextConfigUpdate flag');
            delete (window as any).__acceptNextConfigUpdate;
          }
        } else {
          console.log('[CollectionMinter] Ignoring config update (frontend is source of truth)');
        }
        // After initialization, normally ignore backend config updates - frontend is source of truth
      } else if (msg.command === 'assignmentComplete') {
        setIsAssigning(false);
        // Show success message
        if (msg.success) {
          showNotification(msg.message || 'AI assignment completed successfully!', 'success');
        } else {
          showNotification(msg.message || 'AI assignment failed. Please try again.', 'error');
        }
      } else if (msg.command === 'autoConfigureComplete') {
        setIsConfiguring(false);

        // Show success modal with pipeline operations
        if (msg.success) {
          // Apply the updated config immediately - force new object reference
          if (msg.collectionConfig) {
            console.log('[CollectionMinter] Applying AI-configured pipeline:', msg.collectionConfig.pipeline);
            setCollectionConfig({...msg.collectionConfig});
          }

          // Store AI strategy for tooltip
          if (msg.aiStrategy) {
            setAiStrategy(msg.aiStrategy);
          }

          // Add config logs to execution logs
          if (msg.configLog && msg.configLog.length > 0) {
            setExecutionLogs(prev => [...prev, ...msg.configLog]);
          }

          setPipelineSuccessData({
            message: msg.message || 'AI configured pipeline successfully!',
            operations: msg.operations || []
          });
          setShowPipelineSuccessModal(true);

          // Still set flag to accept the follow-up update message
          (window as any).__acceptNextConfigUpdate = true;
        } else {
          showNotification(msg.message || 'AI configuration failed. Please try again.', 'error');
        }
      } else if (msg.command === 'mintStarted') {
        console.log('[CollectionMinter] Received mintStarted message', { total: msg.total });
        // Minting started - show progress modal immediately
        setIsMinting(true);
        setMintProgressItems([]);
        setShowMintProgressModal(true);
      } else if (msg.command === 'mintProgress') {
        console.log('[CollectionMinter] Received mintProgress message', msg);
        // Handle mint progress updates
        setMintProgressItems(prev => [...prev, {
          current: msg.current,
          total: msg.total,
          status: msg.status,
          txid: msg.txid,
          label: msg.label,
          message: msg.message
        }]);

        // Check if minting is complete
        if (msg.current === msg.total) {
          console.log('[CollectionMinter] Minting complete');
          setIsMinting(false);
        }
      } else if (msg.command === 'mintComplete') {
        console.log('[CollectionMinter] Received mintComplete message');
        // Minting finished
        setIsMinting(false);
      } else if (msg.command === 'mintError') {
        console.log('[CollectionMinter] Received mintError message', msg);
        // Minting error
        setIsMinting(false);
        showNotification(msg.message || 'Minting failed. Please try again.', 'error');
      } else if (msg.command === 'pipelineProgress') {
        console.log('[CollectionMinter] Received pipelineProgress message', msg);
        // Update pipeline progress
        setPipelineProgress(prev => ({
          ...prev,
          currentStep: msg.currentStep,
          steps: msg.steps
        }));
      } else if (msg.command === 'pipelineComplete') {
        console.log('[CollectionMinter] Received pipelineComplete message', msg);
        // Pipeline finished - backend has already updated file paths to workspace
        setIsPipelineExecuting(false);
        setTransformedFiles(msg.transformedFiles || null);
        setExecutionLogs(msg.executionLog || []);
        showNotification(msg.message || 'Pipeline executed successfully!', 'success');
      } else if (msg.command === 'pipelineError') {
        console.log('[CollectionMinter] Received pipelineError message', msg);
        // Pipeline error
        setIsPipelineExecuting(false);
        setExecutionLogs(msg.executionLog || []);
        showNotification(msg.message || 'Pipeline execution failed. Please try again.', 'error');
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [setupForm]);

  // Images are now loaded on-demand by ProcessedImage component
  // This prevents loading 300+ images unnecessarily

  // Update form when selected item changes
  useEffect(() => {
    if (selectedItemId) {
      const item = files.find(f => f.id === selectedItemId);
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
    console.log('[CollectionMinter] Mint button clicked');

    // Validate that items have rarities assigned
    const itemsWithoutRarity = selectedFiles.filter(f => !f.metadata?.rarityLabel);
    const itemsWithoutTraits = selectedFiles.filter(f => !f.metadata?.traits || f.metadata.traits.length === 0);

    console.log('[CollectionMinter] Validation:', {
      selectedFiles: selectedFiles.length,
      itemsWithoutRarity: itemsWithoutRarity.length,
      itemsWithoutTraits: itemsWithoutTraits.length
    });

    if (itemsWithoutRarity.length > 0) {
      showNotification(`${itemsWithoutRarity.length} items don't have rarity assigned. Please use "Auto-Assign Rarities & Traits" in the Traits tab first.`, 'error');
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

    console.log('[CollectionMinter] Sending mintCollection command to backend');
    console.log('[CollectionMinter] vscode object:', vscode);

    try {
      // Start minting - the backend will send mintStarted message to show the modal
      const message = {
        command: 'mintCollection',
        outputSettings // Include image processing settings
      };
      console.log('[CollectionMinter] About to send message:', message);
      vscode.postMessage(message);
      console.log('[CollectionMinter] Message sent successfully');
    } catch (error) {
      console.error('[CollectionMinter] Error sending message:', error);
      showNotification(`Failed to send mint command: ${error}`, 'error');
    }
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

  // Calculate mint readiness errors
  const getMintErrors = (): string[] => {
    const errors: string[] = [];
    if (!collectionConfig.name) errors.push('Collection name required');
    if (!collectionConfig.description) errors.push('Collection description required');
    if (selectedFiles.length === 0) errors.push('No files selected');
    return errors;
  };

  // Helper to render tree structure as text for clipboard
  type FolderNode = {
    name: string;
    type: 'folder' | 'file';
    path: string;
    children: FolderNode[];
  };

  const renderTreeAsText = (node: FolderNode, indent = ''): string => {
    if (node.type === 'file') {
      return `${indent}📄 ${node.name}`;
    }
    const lines = [`${indent}📁 ${node.name}/`];
    node.children.forEach(child => {
      lines.push(renderTreeAsText(child, indent + '  '));
    });
    return lines.join('\n');
  };

  const mintErrors = getMintErrors();
  const canMint = mintErrors.length === 0;

  return (
    <TooltipProvider>
      <div className="h-screen flex flex-col bg-background">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background border-b border-border px-4 py-3">
        <div className="flex items-center justify-between gap-4">
          {/* Left: Back button + Title */}
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleBackToCollections}
              className="gap-2"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
            <div>
              <h1 className="text-lg font-semibold">Collection Minter</h1>
              {collectionConfig.name && (
                <p className="text-xs text-muted-foreground">{collectionConfig.name}</p>
              )}
            </div>
          </div>

          {/* Right: Error Indicator */}
          <div className="flex items-center gap-2">
            {mintErrors.length > 0 ? (
              <div className="flex items-center gap-2 text-yellow-600 dark:text-yellow-400 text-xs">
                <AlertCircle className="w-4 h-4" />
                <span>{mintErrors.length} issue{mintErrors.length !== 1 ? 's' : ''}</span>
              </div>
            ) : selectedFiles.length > 0 ? (
              <div className="flex items-center gap-2 text-green-600 dark:text-green-400 text-xs">
                <CheckCircle2 className="w-4 h-4" />
                <span>Ready to mint</span>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden px-4">
        <TabsList className="grid w-full grid-cols-5 flex-shrink-0 mt-2 mb-0 h-9">
          <TabsTrigger value="setup" className="h-8 text-sm">
            <div className="flex items-center gap-2">
              <div className="flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-xs font-semibold">1</div>
              <span>Setup</span>
            </div>
          </TabsTrigger>
          <TabsTrigger value="files" disabled={files.length === 0} className="h-8 text-sm">
            <div className="flex items-center gap-2">
              <div className="flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-xs font-semibold">2</div>
              <span>Files ({selectedFiles.length})</span>
            </div>
          </TabsTrigger>
          <TabsTrigger value="traits" disabled={files.length === 0} className="h-8 text-sm">
            <div className="flex items-center gap-2">
              <div className="flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-xs font-semibold">3</div>
              <span>Traits</span>
              {selectedFiles.length > 0 && allItemsAssigned && (
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              )}
            </div>
          </TabsTrigger>
          <TabsTrigger value="structure" disabled={files.length === 0} className="h-8 text-sm">
            <div className="flex items-center gap-2">
              <div className="flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-xs font-semibold">4</div>
              <span>Structure</span>
            </div>
          </TabsTrigger>
          <TabsTrigger value="mint" disabled={selectedFiles.length === 0} className="h-8 text-sm">
            <div className="flex items-center gap-2">
              <div className="flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-xs font-semibold">5</div>
              <span>Review & Mint</span>
            </div>
          </TabsTrigger>
        </TabsList>

        <div className="flex-1 overflow-hidden">
          <TabsContent value="setup" className="mt-0 h-full overflow-auto pt-2">
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
                            onChange={(e) => {
                              field.onChange(e);
                              // Update local state immediately for validation
                              setCollectionConfig(prev => ({ ...prev, name: e.target.value }));
                              debouncedUpdateConfig({ name: e.target.value });
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
                            onChange={(e) => {
                              field.onChange(e);
                              // Update local state immediately for validation
                              setCollectionConfig(prev => ({ ...prev, description: e.target.value }));
                              debouncedUpdateConfig({ description: e.target.value });
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
                            onChange={(e) => {
                              const value = parseInt(e.target.value) || 0;
                              field.onChange(value);
                              // Update local state immediately for validation
                              setCollectionConfig(prev => ({ ...prev, quantity: value }));
                              debouncedUpdateConfig({ quantity: value });
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
                      <div className="flex gap-2">
                        <Button onClick={handleSelectFolder} variant="outline" size="sm">
                          Change Folder
                        </Button>
                        <Button
                          onClick={() => vscode.postMessage({ command: 'reloadFiles' })}
                          variant="outline"
                          size="sm"
                          title="Reload files from current folder"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>
                          Refresh
                        </Button>
                      </div>
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

          <TabsContent value="files" className="mt-0 h-full overflow-auto pt-2">
            <Card>
              <CardHeader>
                <CardTitle>
                  {variantGroups
                    ? `Step 2: Variant Groups (${Object.keys(variantGroups).length} items, ${selectedFiles.length} variants)`
                    : `Step 2: Select Files (${selectedFiles.length} selected)`
                  }
                </CardTitle>
                <CardDescription>
                  {variantGroups
                    ? 'Each folder is an item with multiple image variants that will be randomly distributed during minting'
                    : 'Review and select images for your collection'
                  }
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Variant Mode Info */}
                {variantGroups && (
                  <div className="border rounded-lg p-3 bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800 space-y-2">
                    <div className="flex items-center gap-2 text-sm font-semibold text-blue-900 dark:text-blue-100">
                      <CheckCircle2 className="h-4 w-4" />
                      <span>Variant Mode Enabled</span>
                    </div>
                    <p className="text-xs text-blue-800 dark:text-blue-200">
                      Folders represent items. Files inside are variants. Each variant is inscribed once, then randomly used during minting.
                      Set the quantity for each item below.
                    </p>
                  </div>
                )}

                {/* Folder Structure Info */}
                {collectionConfig.folderStructure && !variantGroups && (
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

                {/* Variant Groups Table (when variant mode is on) */}
                {variantGroups ? (
                  <div className="border rounded-lg">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Item Name</TableHead>
                          <TableHead>Variants</TableHead>
                          <TableHead>Traits</TableHead>
                          <TableHead>Rarity</TableHead>
                          <TableHead className="w-32">Mint Quantity</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {Object.values(variantGroups).map((group) => (
                          <TableRow key={group.itemName}>
                            <TableCell className="font-medium">
                              <div className="flex items-center gap-2">
                                <Layers className="h-4 w-4 text-muted-foreground" />
                                <span className="truncate max-w-xs">{group.itemName}</span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <Badge variant="secondary" className="text-xs">
                                  {group.variants.length} variant{group.variants.length !== 1 ? 's' : ''}
                                </Badge>
                                <Collapsible>
                                  <CollapsibleTrigger asChild>
                                    <Button variant="ghost" size="sm" className="h-6 px-2 text-xs">
                                      View
                                    </Button>
                                  </CollapsibleTrigger>
                                  <CollapsibleContent className="absolute z-10 mt-1 p-2 bg-popover border rounded-lg shadow-lg">
                                    <div className="space-y-1 min-w-[200px]">
                                      {group.variants.map((variant) => (
                                        <div key={variant.id} className="text-xs font-mono text-muted-foreground">
                                          {variant.name}
                                        </div>
                                      ))}
                                    </div>
                                  </CollapsibleContent>
                                </Collapsible>
                              </div>
                            </TableCell>
                            <TableCell>
                              {group.metadata?.traits && group.metadata.traits.length > 0 ? (
                                <div className="flex flex-wrap gap-1">
                                  {group.metadata.traits.slice(0, 2).map((trait, idx) => (
                                    <span
                                      key={idx}
                                      className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded"
                                    >
                                      {trait.value}
                                    </span>
                                  ))}
                                  {group.metadata.traits.length > 2 && (
                                    <span className="text-xs text-muted-foreground">
                                      +{group.metadata.traits.length - 2}
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground">-</span>
                              )}
                            </TableCell>
                            <TableCell>
                              {group.metadata?.rarityLabel ? (
                                <span className="text-xs bg-muted px-2 py-1 rounded font-medium">
                                  {group.metadata.rarityLabel}
                                </span>
                              ) : (
                                <span className="text-xs text-muted-foreground">-</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <Input
                                type="number"
                                min="1"
                                value={group.mintQuantity}
                                onChange={(e) => {
                                  const newQuantity = parseInt(e.target.value) || 1;
                                  handleUpdateConfig({
                                    variantGroups: {
                                      ...collectionConfig.variantGroups,
                                      [group.itemName]: newQuantity
                                    }
                                  });
                                }}
                                className="h-8 w-24 text-sm"
                              />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  /* Regular Table View - Much faster for large collections */
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
                )}
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

          <TabsContent value="traits" className="mt-0 h-full overflow-auto pt-2">
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

          <TabsContent value="structure" className="mt-0 h-full pt-2">
            <ResizablePanelGroup direction="horizontal" className="h-full rounded-lg border">
              {/* Left: Before - Folder Structure Tree */}
              <ResizablePanel defaultSize={25} minSize={20}>
                <div className="h-full flex flex-col">
                  {/* Header with Root Path */}
                  <div className="p-4 border-b bg-background flex-shrink-0">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-semibold text-sm">Before: Original Files</h3>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            // Build tree from selectedFiles
                            type LocalFolderNode = {
                              name: string;
                              type: 'folder' | 'file';
                              path: string;
                              children: LocalFolderNode[];
                            };

                            const buildTree = (files: typeof selectedFiles): LocalFolderNode => {
                              const root: LocalFolderNode = {
                                name: 'Root',
                                type: 'folder',
                                path: '',
                                children: []
                              };

                              files.forEach(file => {
                                const relativePath = selectedFolder
                                  ? file.path.substring(selectedFolder.length + 1)
                                  : file.path;
                                const parts = relativePath.split('/').filter(Boolean);
                                let currentNode = root;

                                parts.forEach((part, index) => {
                                  const isFile = index === parts.length - 1;
                                  let childNode = currentNode.children.find(c => c.name === part);

                                  if (!childNode) {
                                    childNode = {
                                      name: part,
                                      type: isFile ? 'file' : 'folder',
                                      path: parts.slice(0, index + 1).join('/'),
                                      children: []
                                    };
                                    currentNode.children.push(childNode);
                                  }

                                  if (!isFile) {
                                    currentNode = childNode;
                                  }
                                });
                              });

                              return root;
                            };

                            const tree = buildTree(selectedFiles);
                            const treeText = tree.children.map(child => renderTreeAsText(child as FolderNode)).join('\n');
                            navigator.clipboard.writeText(treeText);
                            showNotification('Copied BEFORE structure to clipboard', 'success');
                          }}
                          title="Copy structure to clipboard"
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                        <span className="text-xs text-muted-foreground">
                        {(() => {
                          // Count unique directories from file paths
                          const dirs = new Set<string>();
                          selectedFiles.forEach(file => {
                            // Get relative path: remove selectedFolder prefix + leading slash
                            const relativePath = selectedFolder
                              ? file.path.substring(selectedFolder.length + 1)
                              : file.path;
                            const pathParts = relativePath.split('/').filter(Boolean);
                            // Add all parent directories
                            for (let i = 1; i < pathParts.length; i++) {
                              dirs.add(pathParts.slice(0, i).join('/'));
                            }
                          });
                          return `${dirs.size} dirs, ${selectedFiles.length} files`;
                        })()}
                        </span>
                      </div>
                    </div>
                    {selectedFolder && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="truncate flex-1 font-mono">{selectedFolder}</span>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 w-6 p-0 shrink-0"
                          onClick={() => {
                            navigator.clipboard.writeText(selectedFolder || '');
                          }}
                          title="Copy path"
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                      </div>
                    )}
                  </div>

                  {/* Scrollable Tree View */}
                  <ScrollArea className="flex-1 min-h-0">
                    <div className="py-1">
                      {(() => {
                        // Build hierarchical folder tree
                        type FolderNode = {
                          name: string;
                          type: 'folder' | 'file';
                          path: string;
                          children: FolderNode[];
                          fileCount?: number;
                        };

                        const buildTree = (files: typeof selectedFiles): FolderNode => {
                          const root: FolderNode = {
                            name: 'Root',
                            type: 'folder',
                            path: '',
                            children: []
                          };

                          files.forEach(file => {
                            // Get relative path: remove selectedFolder prefix + leading slash
                            const relativePath = selectedFolder
                              ? file.path.substring(selectedFolder.length + 1)
                              : file.path;

                            const pathParts = relativePath.split('/').filter(Boolean);
                            let currentNode = root;

                            // Navigate/create folders
                            for (let i = 0; i < pathParts.length - 1; i++) {
                              const folderName = pathParts[i];
                              let folder = currentNode.children.find(
                                c => c.name === folderName && c.type === 'folder'
                              );

                              if (!folder) {
                                folder = {
                                  name: folderName,
                                  type: 'folder',
                                  path: pathParts.slice(0, i + 1).join('/'),
                                  children: []
                                };
                                currentNode.children.push(folder);
                              }

                              currentNode = folder;
                            }

                            // Add file
                            currentNode.children.push({
                              name: pathParts[pathParts.length - 1],
                              type: 'file',
                              path: relativePath,
                              children: []
                            });
                          });

                          // Sort children: folders first, then alphabetically
                          const sortChildren = (node: FolderNode) => {
                            node.children.sort((a, b) => {
                              if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
                              return a.name.localeCompare(b.name);
                            });
                            node.children.forEach(child => {
                              if (child.type === 'folder') sortChildren(child);
                            });
                          };

                          sortChildren(root);
                          return root;
                        };

                        // Recursive tree renderer
                        const TreeNode = ({ node, depth = 0 }: { node: FolderNode; depth?: number }) => {
                          if (node.type === 'file') {
                            return (
                              <div
                                className="text-xs text-muted-foreground py-0.5 font-mono truncate hover:text-foreground transition-colors"
                                style={{ paddingLeft: `${(depth + 1) * 12}px` }}
                              >
                                {node.name}
                              </div>
                            );
                          }

                          const fileCount = node.children.filter(c => c.type === 'file').length;
                          const folderCount = node.children.filter(c => c.type === 'folder').length;
                          const files = node.children.filter(c => c.type === 'file');
                          const folders = node.children.filter(c => c.type === 'folder');
                          const showFiles = files.length > 0 && files.length <= 5;

                          return (
                            <Collapsible defaultOpen={depth === 0} className="group/collapsible">
                              <CollapsibleTrigger
                                className="w-full flex items-center gap-1.5 px-2 py-1.5 hover:bg-accent/50 rounded-md transition-colors text-xs font-medium text-foreground"
                                style={{ paddingLeft: `${depth * 12 + 8}px` }}
                              >
                                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/collapsible:rotate-90" />
                                <Folder className="h-3.5 w-3.5 shrink-0 text-blue-500" />
                                <span className="truncate">{node.name}</span>
                                <div className="ml-auto flex items-center gap-1">
                                  {folderCount > 0 && (
                                    <Badge variant="outline" className="h-4 px-1.5 text-[10px] font-normal">
                                      {folderCount} folders
                                    </Badge>
                                  )}
                                  {fileCount > 0 && (
                                    <Badge variant="secondary" className="h-4 px-1.5 text-[10px] font-normal">
                                      {fileCount} files
                                    </Badge>
                                  )}
                                </div>
                              </CollapsibleTrigger>

                              <CollapsibleContent>
                                <div className="space-y-0.5 py-0.5">
                                  {/* Render nested folders first */}
                                  {folders.map((child, idx) => (
                                    <TreeNode key={`folder-${idx}`} node={child} depth={depth + 1} />
                                  ))}

                                  {/* Show first 5 files if not too many */}
                                  {showFiles && files.map((child, idx) => (
                                    <TreeNode key={`file-${idx}`} node={child} depth={depth + 1} />
                                  ))}

                                  {/* Show "X files" if too many */}
                                  {!showFiles && fileCount > 0 && (
                                    <div
                                      className="text-xs text-muted-foreground italic py-0.5"
                                      style={{ paddingLeft: `${(depth + 2) * 12}px` }}
                                    >
                                      {fileCount} files
                                    </div>
                                  )}
                                </div>
                              </CollapsibleContent>
                            </Collapsible>
                          );
                        };

                        const tree = buildTree(selectedFiles);
                        return tree.children.map((child, idx) => (
                          <TreeNode key={idx} node={child} depth={0} />
                        ));
                      })()}
                    </div>
                  </ScrollArea>
                </div>
              </ResizablePanel>

              <ResizableHandle withHandle />

              {/* Center: Mapping Configuration */}
              <ResizablePanel defaultSize={50} minSize={30}>
                <ScrollArea className="h-full">
                  <div className="p-4 space-y-6">
                {/* AI Auto-Configure Button */}
                {selectedFiles.length > 0 && (
                  <Card className={isConfiguring ? 'border-blue-500/50' : 'border-purple-500/50'}>
                    <CardContent className="pt-6">
                      <div className="space-y-3">
                        <div className="flex items-start gap-3">
                          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-purple-500/10 flex items-center justify-center">
                            <Sparkles className="h-5 w-5 text-purple-500" />
                          </div>
                          <div className="flex-1">
                            <h4 className="font-semibold text-sm mb-1">AI Auto-Configure Mappings</h4>
                            <p className="text-xs text-muted-foreground">
                              Let AI analyze your file structure and automatically configure rename patterns, folder mappings, filename patterns, and name standardization.
                            </p>
                          </div>
                        </div>

                        {/* Optional user prompt for additional context */}
                        <div className="space-y-2">
                          <label className="text-xs font-medium text-muted-foreground">
                            Additional Context (Optional)
                          </label>
                          <textarea
                            value={collectionConfig.aiPromptContext || ''}
                            onChange={(e) => {
                              setCollectionConfig({
                                ...collectionConfig,
                                aiPromptContext: e.target.value
                              });
                            }}
                            placeholder="e.g., 'Each folder is a character with different art styles' or 'Files ending in _bg are backgrounds'"
                            className="w-full min-h-[60px] px-3 py-2 text-xs border rounded-md resize-none"
                            disabled={isConfiguring}
                          />
                        </div>

                        <Button
                          onClick={() => {
                            setIsConfiguring(true);
                            vscode.postMessage({
                              command: 'autoConfigureStructureMappings',
                              userContext: collectionConfig.aiPromptContext || ''
                            });
                          }}
                          className="w-full"
                          variant="default"
                          disabled={isConfiguring}
                        >
                          {isConfiguring ? (
                            <>
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              Analyzing file structure with AI...
                            </>
                          ) : (
                            <>
                              <Sparkles className="h-4 w-4 mr-2" />
                              AI Auto-Configure Mappings
                            </>
                          )}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Pipeline Operations */}
                <div className="space-y-4">
                  <div className="border-b pb-3 flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold text-sm">Pipeline Operations</h3>
                        {aiStrategy && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                            </TooltipTrigger>
                            <TooltipContent className="max-w-md">
                              <p className="text-xs">{aiStrategy}</p>
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Transform your collection with sequential operations. Order matters!
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      {collectionConfig.pipeline?.operations && collectionConfig.pipeline.operations.length > 0 && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6 shrink-0"
                          title="Copy pipeline JSON"
                          onClick={() => {
                            navigator.clipboard.writeText(JSON.stringify(collectionConfig.pipeline, null, 2));
                            showNotification('Pipeline copied to clipboard', 'success');
                          }}
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      )}
                      <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6 shrink-0"
                          title="Add pipeline operation"
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => {
                            const newOp: PipelineOperation = {
                              type: 'exclude',
                              path: '',
                              reason: ''
                            };
                            handleUpdateConfig({
                              pipeline: {
                                ...collectionConfig.pipeline,
                                operations: [...(collectionConfig.pipeline?.operations || []), newOp],
                                reasoning: collectionConfig.pipeline?.reasoning || ''
                              }
                            });
                          }}
                        >
                          Exclude Files
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => {
                            const newOp: PipelineOperation = {
                              type: 'move',
                              from: '',
                              to: ''
                            };
                            handleUpdateConfig({
                              pipeline: {
                                ...collectionConfig.pipeline,
                                operations: [...(collectionConfig.pipeline?.operations || []), newOp],
                                reasoning: collectionConfig.pipeline?.reasoning || ''
                              }
                            });
                          }}
                        >
                          Move Files
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => {
                            const newOp: PipelineOperation = {
                              type: 'rename-folder',
                              from: '',
                              to: ''
                            };
                            handleUpdateConfig({
                              pipeline: {
                                ...collectionConfig.pipeline,
                                operations: [...(collectionConfig.pipeline?.operations || []), newOp],
                                reasoning: collectionConfig.pipeline?.reasoning || ''
                              }
                            });
                          }}
                        >
                          Rename Folder
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => {
                            const newOp: PipelineOperation = {
                              type: 'transform',
                              scope: 'all',
                              renamePatterns: []
                            };
                            handleUpdateConfig({
                              pipeline: {
                                ...collectionConfig.pipeline,
                                operations: [...(collectionConfig.pipeline?.operations || []), newOp],
                                reasoning: collectionConfig.pipeline?.reasoning || ''
                              }
                            });
                          }}
                        >
                          Transform (Rename Files)
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => {
                            const newOp: PipelineOperation = {
                              type: 'map-traits',
                              scope: 'all',
                              filenamePatterns: []
                            };
                            handleUpdateConfig({
                              pipeline: {
                                ...collectionConfig.pipeline,
                                operations: [...(collectionConfig.pipeline?.operations || []), newOp],
                                reasoning: collectionConfig.pipeline?.reasoning || ''
                              }
                            });
                          }}
                        >
                          Map Traits (Filename Patterns)
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => {
                            const newOp: PipelineOperation = {
                              type: 'map-folders',
                              scope: 'all',
                              traitMapping: {}
                            };
                            handleUpdateConfig({
                              pipeline: {
                                ...collectionConfig.pipeline,
                                operations: [...(collectionConfig.pipeline?.operations || []), newOp],
                                reasoning: collectionConfig.pipeline?.reasoning || ''
                              }
                            });
                          }}
                        >
                          Map Folders (Folder Structure)
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => {
                            const newOp: PipelineOperation = {
                              type: 'standardize-names',
                              scope: 'all',
                              nameStandardization: { enabled: true, template: '{itemName}' }
                            };
                            handleUpdateConfig({
                              pipeline: {
                                ...collectionConfig.pipeline,
                                operations: [...(collectionConfig.pipeline?.operations || []), newOp],
                                reasoning: collectionConfig.pipeline?.reasoning || ''
                              }
                            });
                          }}
                        >
                          Standardize Names
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => {
                            const newOp: PipelineOperation = {
                              type: 'compress',
                              scope: 'all',
                              quality: 85,
                              maxWidth: 1920,
                              maxHeight: 1920,
                              format: 'jpeg'
                            };
                            handleUpdateConfig({
                              pipeline: {
                                ...collectionConfig.pipeline,
                                operations: [...(collectionConfig.pipeline?.operations || []), newOp],
                                reasoning: collectionConfig.pipeline?.reasoning || ''
                              }
                            });
                          }}
                        >
                          Compress Images
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => {
                            const newOp: PipelineOperation = {
                              type: 'filter',
                              scope: 'all',
                              rules: []
                            };
                            handleUpdateConfig({
                              pipeline: {
                                ...collectionConfig.pipeline,
                                operations: [...(collectionConfig.pipeline?.operations || []), newOp],
                                reasoning: collectionConfig.pipeline?.reasoning || ''
                              }
                            });
                          }}
                        >
                          Filter Items (Include/Exclude)
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>

                  {/* Pipeline Operations List */}
                  <div className="space-y-2">
                    {collectionConfig.pipeline?.operations && collectionConfig.pipeline.operations.length > 0 ? (
                      collectionConfig.pipeline.operations.map((operation, index) => (
                        <div key={index} className="p-3 border rounded-lg space-y-3 group">
                          {/* Operation Header with Controls */}
                          <div className="flex items-start gap-2">
                            <div className="flex items-center gap-1">
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-6 w-6 cursor-move opacity-0 group-hover:opacity-100 transition-opacity"
                                title="Drag to reorder"
                              >
                                <GripVertical className="h-4 w-4 text-muted-foreground" />
                              </Button>
                              <Badge variant="outline" className="text-xs px-2 py-0.5">
                                {index + 1}
                              </Badge>
                            </div>

                            <div className="flex-1">
                              <div className="text-sm font-medium mb-1">
                                {(() => {
                                  switch(operation.type) {
                                    case 'exclude': return 'Exclude Files';
                                    case 'exclude-file': return 'Exclude Single File';
                                    case 'move': return 'Move Files';
                                    case 'move-file': return 'Move Single File';
                                    case 'rename-file': return 'Rename Single File';
                                    case 'rename-folder': return 'Rename Folder';
                                    case 'transform': return 'Transform (Rename Files)';
                                    case 'map-traits': return 'Map Traits';
                                    case 'map-folders': return 'Map Folders';
                                    case 'standardize-names': return 'Standardize Names';
                                    case 'set-metadata': return 'Set Item Metadata';
                                    case 'compress': return 'Compress Images';
                                    case 'filter': return 'Filter Items';
                                    default: return `Unknown: ${operation.type}`;
                                  }
                                })()}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {(() => {
                                  switch(operation.type) {
                                    case 'exclude': return `Pattern: ${operation.path || '(not set)'}`;
                                    case 'exclude-file': return `Target: ${operation.target || '(not set)'}`;
                                    case 'move': return `${operation.from || '(from)'} → ${operation.to || '(to)'}`;
                                    case 'move-file': return `${operation.target || '(target)'} → ${operation.to || '(to)'}`;
                                    case 'rename-file': return `${operation.target || '(target)'} → ${operation.newName || '(new name)'}`;
                                    case 'rename-folder': return `${operation.from || '(from)'} → ${operation.to || '(to)'}`;
                                    case 'transform': return `Scope: ${operation.scope || 'all'} • ${operation.renamePatterns?.length || 0} patterns`;
                                    case 'map-traits': return `Scope: ${operation.scope || 'all'} • ${operation.filenamePatterns?.length || 0} patterns`;
                                    case 'map-folders': return `Scope: ${operation.scope || 'all'}`;
                                    case 'standardize-names': return `Scope: ${operation.scope || 'all'} • Template: ${operation.nameStandardization?.template || '{itemName}'}`;
                                    case 'set-metadata': return `${operation.target || '(target)'} → ${operation.metadata?.name || 'metadata'} ${operation.metadata?.rarityLabel ? `[${operation.metadata.rarityLabel}]` : ''}`;
                                    case 'compress': return `Scope: ${operation.scope || 'all'} • Quality: ${operation.quality}% • ${operation.format?.toUpperCase() || 'JPEG'}`;
                                    case 'filter': return `Scope: ${operation.scope || 'all'} • ${operation.rules?.length || 0} rules`;
                                    default: return JSON.stringify(operation).slice(0, 100);
                                  }
                                })()}
                              </div>
                            </div>

                            <div className="flex items-center gap-1">
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-6 w-6"
                                disabled={index === 0}
                                onClick={() => {
                                  if (index === 0) return;
                                  const ops = [...(collectionConfig.pipeline?.operations || [])];
                                  [ops[index - 1], ops[index]] = [ops[index], ops[index - 1]];
                                  handleUpdateConfig({
                                    pipeline: {
                                      ...collectionConfig.pipeline,
                                      operations: ops,
                                      reasoning: collectionConfig.pipeline?.reasoning || ''
                                    }
                                  });
                                }}
                                title="Move up"
                              >
                                <ArrowUp className="h-4 w-4" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-6 w-6"
                                disabled={index === (collectionConfig.pipeline?.operations?.length || 0) - 1}
                                onClick={() => {
                                  const ops = [...(collectionConfig.pipeline?.operations || [])];
                                  if (index >= ops.length - 1) return;
                                  [ops[index], ops[index + 1]] = [ops[index + 1], ops[index]];
                                  handleUpdateConfig({
                                    pipeline: {
                                      ...collectionConfig.pipeline,
                                      operations: ops,
                                      reasoning: collectionConfig.pipeline?.reasoning || ''
                                    }
                                  });
                                }}
                                title="Move down"
                              >
                                <ArrowDown className="h-4 w-4" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-6 w-6 text-destructive hover:text-destructive"
                                onClick={() => {
                                  const ops = [...(collectionConfig.pipeline?.operations || [])];
                                  ops.splice(index, 1);
                                  handleUpdateConfig({
                                    pipeline: {
                                      ...collectionConfig.pipeline,
                                      operations: ops,
                                      reasoning: collectionConfig.pipeline?.reasoning || ''
                                    }
                                  });
                                }}
                                title="Delete operation"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>

                          {/* Operation-specific fields */}
                          {operation.type === 'exclude' && (
                            <div className="space-y-2">
                              <div className="space-y-1">
                                <Label className="text-xs">File Path Pattern</Label>
                                <Input
                                  value={operation.path}
                                  onChange={(e) => {
                                    const ops = [...(collectionConfig.pipeline?.operations || [])];
                                    ops[index] = { ...operation, path: e.target.value };
                                    handleUpdateConfig({
                                      pipeline: {
                                        ...collectionConfig.pipeline,
                                        operations: ops,
                                        reasoning: collectionConfig.pipeline?.reasoning || ''
                                      }
                                    });
                                  }}
                                  placeholder=".DS_Store, *.tmp, thumbs.db"
                                  className="h-8 text-xs font-mono"
                                />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs">Reason</Label>
                                <Input
                                  value={operation.reason}
                                  onChange={(e) => {
                                    const ops = [...(collectionConfig.pipeline?.operations || [])];
                                    ops[index] = { ...operation, reason: e.target.value };
                                    handleUpdateConfig({
                                      pipeline: {
                                        ...collectionConfig.pipeline,
                                        operations: ops,
                                        reasoning: collectionConfig.pipeline?.reasoning || ''
                                      }
                                    });
                                  }}
                                  placeholder="System file"
                                  className="h-8 text-xs"
                                />
                              </div>
                            </div>
                          )}

                          {operation.type === 'move' && (
                            <div className="space-y-2">
                              <div className="space-y-1">
                                <Label className="text-xs">From</Label>
                                <Input
                                  value={operation.from}
                                  onChange={(e) => {
                                    const ops = [...(collectionConfig.pipeline?.operations || [])];
                                    ops[index] = { ...operation, from: e.target.value };
                                    handleUpdateConfig({
                                      pipeline: {
                                        ...collectionConfig.pipeline,
                                        operations: ops,
                                        reasoning: collectionConfig.pipeline?.reasoning || ''
                                      }
                                    });
                                  }}
                                  placeholder="items/sword.png"
                                  className="h-8 text-xs font-mono"
                                />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs">To</Label>
                                <Input
                                  value={operation.to}
                                  onChange={(e) => {
                                    const ops = [...(collectionConfig.pipeline?.operations || [])];
                                    ops[index] = { ...operation, to: e.target.value };
                                    handleUpdateConfig({
                                      pipeline: {
                                        ...collectionConfig.pipeline,
                                        operations: ops,
                                        reasoning: collectionConfig.pipeline?.reasoning || ''
                                      }
                                    });
                                  }}
                                  placeholder="items/weapons/sword.png"
                                  className="h-8 text-xs font-mono"
                                />
                              </div>
                            </div>
                          )}

                          {operation.type === 'rename-folder' && (
                            <div className="space-y-2">
                              <div className="space-y-1">
                                <Label className="text-xs">From</Label>
                                <Input
                                  value={operation.from}
                                  onChange={(e) => {
                                    const ops = [...(collectionConfig.pipeline?.operations || [])];
                                    ops[index] = { ...operation, from: e.target.value };
                                    handleUpdateConfig({
                                      pipeline: {
                                        ...collectionConfig.pipeline,
                                        operations: ops,
                                        reasoning: collectionConfig.pipeline?.reasoning || ''
                                      }
                                    });
                                  }}
                                  placeholder="char1"
                                  className="h-8 text-xs font-mono"
                                />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs">To</Label>
                                <Input
                                  value={operation.to}
                                  onChange={(e) => {
                                    const ops = [...(collectionConfig.pipeline?.operations || [])];
                                    ops[index] = { ...operation, to: e.target.value };
                                    handleUpdateConfig({
                                      pipeline: {
                                        ...collectionConfig.pipeline,
                                        operations: ops,
                                        reasoning: collectionConfig.pipeline?.reasoning || ''
                                      }
                                    });
                                  }}
                                  placeholder="warrior"
                                  className="h-8 text-xs font-mono"
                                />
                              </div>
                            </div>
                          )}

                          {/* TRANSFORM - Rename Files */}
                          {operation.type === 'transform' && (
                            <div className="space-y-3">
                              {/* Scope */}
                              <div className="space-y-1">
                                <Label className="text-xs">Scope (folder path or "all")</Label>
                                <Input
                                  value={operation.scope}
                                  onChange={(e) => {
                                    const ops = [...(collectionConfig.pipeline?.operations || [])];
                                    ops[index] = { ...operation, scope: e.target.value };
                                    handleUpdateConfig({
                                      pipeline: {
                                        ...collectionConfig.pipeline,
                                        operations: ops,
                                        reasoning: collectionConfig.pipeline?.reasoning || ''
                                      }
                                    });
                                  }}
                                  placeholder="all"
                                  className="h-8 text-xs font-mono"
                                />
                                <p className="text-[10px] text-muted-foreground">
                                  Use "all" for global or specify folder path like "items/weapons"
                                </p>
                              </div>

                              {/* Rename Patterns */}
                              <div className="border-t pt-3 space-y-2">
                                <div className="flex items-center justify-between">
                                  <Label className="text-xs font-semibold">Rename Patterns</Label>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-5 w-5"
                                    onClick={() => {
                                      const ops = [...(collectionConfig.pipeline?.operations || [])];
                                      const newPattern: RenamePattern = { type: 'prefix-remove', pattern: '' };
                                      ops[index] = {
                                        ...operation,
                                        renamePatterns: [...(operation.renamePatterns || []), newPattern]
                                      };
                                      handleUpdateConfig({
                                        pipeline: {
                                          ...collectionConfig.pipeline,
                                          operations: ops,
                                          reasoning: collectionConfig.pipeline?.reasoning || ''
                                        }
                                      });
                                    }}
                                    title="Add rename pattern"
                                  >
                                    <Plus className="h-3 w-3" />
                                  </Button>
                                </div>

                                {operation.renamePatterns && operation.renamePatterns.length > 0 ? (
                                  <div className="space-y-2">
                                    {operation.renamePatterns.map((pattern, patIdx) => (
                                      <div key={patIdx} className="p-2 border rounded space-y-2 bg-muted/30">
                                        <div className="grid grid-cols-2 gap-2">
                                          <div className="space-y-1">
                                            <Label className="text-[10px]">Type</Label>
                                            <Select
                                              value={pattern.type}
                                              onValueChange={(value: any) => {
                                                const ops = [...(collectionConfig.pipeline?.operations || [])];
                                                const patterns = [...(operation.renamePatterns || [])];
                                                patterns[patIdx] = { ...patterns[patIdx], type: value };
                                                ops[index] = { ...operation, renamePatterns: patterns };
                                                handleUpdateConfig({
                                                  pipeline: {
                                                    ...collectionConfig.pipeline,
                                                    operations: ops,
                                                    reasoning: collectionConfig.pipeline?.reasoning || ''
                                                  }
                                                });
                                              }}
                                            >
                                              <SelectTrigger className="h-7 text-[10px]">
                                                <SelectValue />
                                              </SelectTrigger>
                                              <SelectContent>
                                                <SelectItem value="prefix-remove">Remove Prefix</SelectItem>
                                                <SelectItem value="suffix-remove">Remove Suffix</SelectItem>
                                                <SelectItem value="replace">Find & Replace</SelectItem>
                                                <SelectItem value="regex-replace">Regex Replace</SelectItem>
                                              </SelectContent>
                                            </Select>
                                          </div>
                                          <div className="space-y-1">
                                            <Label className="text-[10px]">Pattern</Label>
                                            <div className="flex gap-1">
                                              <Input
                                                value={pattern.pattern}
                                                onChange={(e) => {
                                                  const ops = [...(collectionConfig.pipeline?.operations || [])];
                                                  const patterns = [...(operation.renamePatterns || [])];
                                                  patterns[patIdx] = { ...patterns[patIdx], pattern: e.target.value };
                                                  ops[index] = { ...operation, renamePatterns: patterns };
                                                  handleUpdateConfig({
                                                    pipeline: {
                                                      ...collectionConfig.pipeline,
                                                      operations: ops,
                                                      reasoning: collectionConfig.pipeline?.reasoning || ''
                                                    }
                                                  });
                                                }}
                                                placeholder={pattern.type === 'prefix-remove' ? 'nft_' : 'text'}
                                                className="h-7 text-[10px] font-mono"
                                              />
                                              <Button
                                                size="icon"
                                                variant="ghost"
                                                className="h-7 w-7"
                                                onClick={() => {
                                                  const ops = [...(collectionConfig.pipeline?.operations || [])];
                                                  const patterns = [...(operation.renamePatterns || [])];
                                                  patterns.splice(patIdx, 1);
                                                  ops[index] = { ...operation, renamePatterns: patterns };
                                                  handleUpdateConfig({
                                                    pipeline: {
                                                      ...collectionConfig.pipeline,
                                                      operations: ops,
                                                      reasoning: collectionConfig.pipeline?.reasoning || ''
                                                    }
                                                  });
                                                }}
                                              >
                                                <XCircle className="h-3 w-3" />
                                              </Button>
                                            </div>
                                          </div>
                                          {(pattern.type === 'replace' || pattern.type === 'regex-replace') && (
                                            <div className="space-y-1 col-span-2">
                                              <Label className="text-[10px]">Replace With</Label>
                                              <Input
                                                value={pattern.replacement || ''}
                                                onChange={(e) => {
                                                  const ops = [...(collectionConfig.pipeline?.operations || [])];
                                                  const patterns = [...(operation.renamePatterns || [])];
                                                  patterns[patIdx] = { ...patterns[patIdx], replacement: e.target.value };
                                                  ops[index] = { ...operation, renamePatterns: patterns };
                                                  handleUpdateConfig({
                                                    pipeline: {
                                                      ...collectionConfig.pipeline,
                                                      operations: ops,
                                                      reasoning: collectionConfig.pipeline?.reasoning || ''
                                                    }
                                                  });
                                                }}
                                                placeholder="Replacement text"
                                                className="h-7 text-[10px]"
                                              />
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="text-[10px] text-muted-foreground italic">No rename patterns</p>
                                )}
                              </div>
                            </div>
                          )}

                          {/* MAP-TRAITS - Filename Patterns */}
                          {operation.type === 'map-traits' && (
                            <div className="space-y-3">
                              {/* Scope */}
                              <div className="space-y-1">
                                <Label className="text-xs">Scope (folder path or "all")</Label>
                                <Input
                                  value={operation.scope}
                                  onChange={(e) => {
                                    const ops = [...(collectionConfig.pipeline?.operations || [])];
                                    ops[index] = { ...operation, scope: e.target.value };
                                    handleUpdateConfig({
                                      pipeline: {
                                        ...collectionConfig.pipeline,
                                        operations: ops,
                                        reasoning: collectionConfig.pipeline?.reasoning || ''
                                      }
                                    });
                                  }}
                                  placeholder="all"
                                  className="h-8 text-xs font-mono"
                                />
                                <p className="text-[10px] text-muted-foreground">
                                  Extract trait values from filenames
                                </p>
                              </div>

                              {/* Filename Patterns */}
                              <div className="border-t pt-3 space-y-2">
                                <div className="flex items-center justify-between">
                                  <Label className="text-xs font-semibold">Filename Patterns</Label>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-5 w-5"
                                    onClick={() => {
                                      const ops = [...(collectionConfig.pipeline?.operations || [])];
                                      const newPattern: FilenamePattern = {
                                        type: 'prefix',
                                        targetField: 'rarity',
                                        pattern: ''
                                      };
                                      ops[index] = {
                                        ...operation,
                                        filenamePatterns: [...(operation.filenamePatterns || []), newPattern]
                                      };
                                      handleUpdateConfig({
                                        pipeline: {
                                          ...collectionConfig.pipeline,
                                          operations: ops,
                                          reasoning: collectionConfig.pipeline?.reasoning || ''
                                        }
                                      });
                                    }}
                                    title="Add filename pattern"
                                  >
                                    <Plus className="h-3 w-3" />
                                  </Button>
                                </div>

                                {operation.filenamePatterns && operation.filenamePatterns.length > 0 ? (
                                  <div className="space-y-2">
                                    {operation.filenamePatterns.map((pattern, patIdx) => (
                                      <div key={patIdx} className="p-2 border rounded space-y-2 bg-muted/30">
                                        <div className="grid grid-cols-2 gap-2">
                                          <div className="space-y-1">
                                            <Label className="text-[10px]">Pattern Type</Label>
                                            <Select
                                              value={pattern.type}
                                              onValueChange={(value: any) => {
                                                const ops = [...(collectionConfig.pipeline?.operations || [])];
                                                const patterns = [...(operation.filenamePatterns || [])];
                                                patterns[patIdx] = { ...patterns[patIdx], type: value };
                                                ops[index] = { ...operation, filenamePatterns: patterns };
                                                handleUpdateConfig({
                                                  pipeline: {
                                                    ...collectionConfig.pipeline,
                                                    operations: ops,
                                                    reasoning: collectionConfig.pipeline?.reasoning || ''
                                                  }
                                                });
                                              }}
                                            >
                                              <SelectTrigger className="h-7 text-[10px]">
                                                <SelectValue />
                                              </SelectTrigger>
                                              <SelectContent>
                                                <SelectItem value="prefix">Prefix</SelectItem>
                                                <SelectItem value="suffix">Suffix</SelectItem>
                                                <SelectItem value="contains">Contains</SelectItem>
                                                <SelectItem value="regex">Regex</SelectItem>
                                              </SelectContent>
                                            </Select>
                                          </div>
                                          <div className="space-y-1">
                                            <Label className="text-[10px]">Maps To</Label>
                                            <Select
                                              value={pattern.targetField}
                                              onValueChange={(value: any) => {
                                                const ops = [...(collectionConfig.pipeline?.operations || [])];
                                                const patterns = [...(operation.filenamePatterns || [])];
                                                patterns[patIdx] = { ...patterns[patIdx], targetField: value };
                                                ops[index] = { ...operation, filenamePatterns: patterns };
                                                handleUpdateConfig({
                                                  pipeline: {
                                                    ...collectionConfig.pipeline,
                                                    operations: ops,
                                                    reasoning: collectionConfig.pipeline?.reasoning || ''
                                                  }
                                                });
                                              }}
                                            >
                                              <SelectTrigger className="h-7 text-[10px]">
                                                <SelectValue />
                                              </SelectTrigger>
                                              <SelectContent>
                                                <SelectItem value="variant">Variant</SelectItem>
                                                <SelectItem value="rarity">Rarity</SelectItem>
                                                {collectionConfig.traits?.map(trait => (
                                                  <SelectItem key={trait.name} value={trait.name}>
                                                    {trait.name}
                                                  </SelectItem>
                                                ))}
                                              </SelectContent>
                                            </Select>
                                          </div>
                                          <div className="space-y-1 col-span-2">
                                            <Label className="text-[10px]">Pattern</Label>
                                            <div className="flex gap-1">
                                              <Input
                                                value={pattern.pattern}
                                                onChange={(e) => {
                                                  const ops = [...(collectionConfig.pipeline?.operations || [])];
                                                  const patterns = [...(operation.filenamePatterns || [])];
                                                  patterns[patIdx] = { ...patterns[patIdx], pattern: e.target.value };
                                                  ops[index] = { ...operation, filenamePatterns: patterns };
                                                  handleUpdateConfig({
                                                    pipeline: {
                                                      ...collectionConfig.pipeline,
                                                      operations: ops,
                                                      reasoning: collectionConfig.pipeline?.reasoning || ''
                                                    }
                                                  });
                                                }}
                                                placeholder={pattern.type === 'prefix' ? 'common_' : 'pattern'}
                                                className="h-7 text-[10px] font-mono"
                                              />
                                              <Button
                                                size="icon"
                                                variant="ghost"
                                                className="h-7 w-7"
                                                onClick={() => {
                                                  const ops = [...(collectionConfig.pipeline?.operations || [])];
                                                  const patterns = [...(operation.filenamePatterns || [])];
                                                  patterns.splice(patIdx, 1);
                                                  ops[index] = { ...operation, filenamePatterns: patterns };
                                                  handleUpdateConfig({
                                                    pipeline: {
                                                      ...collectionConfig.pipeline,
                                                      operations: ops,
                                                      reasoning: collectionConfig.pipeline?.reasoning || ''
                                                    }
                                                  });
                                                }}
                                              >
                                                <XCircle className="h-3 w-3" />
                                              </Button>
                                            </div>
                                          </div>
                                          {pattern.type !== 'regex' && (
                                            <div className="space-y-1 col-span-2">
                                              <Label className="text-[10px]">Extract Value</Label>
                                              <Input
                                                value={pattern.matchValue || ''}
                                                onChange={(e) => {
                                                  const ops = [...(collectionConfig.pipeline?.operations || [])];
                                                  const patterns = [...(operation.filenamePatterns || [])];
                                                  patterns[patIdx] = { ...patterns[patIdx], matchValue: e.target.value };
                                                  ops[index] = { ...operation, filenamePatterns: patterns };
                                                  handleUpdateConfig({
                                                    pipeline: {
                                                      ...collectionConfig.pipeline,
                                                      operations: ops,
                                                      reasoning: collectionConfig.pipeline?.reasoning || ''
                                                    }
                                                  });
                                                }}
                                                placeholder="Value to assign when matched"
                                                className="h-7 text-[10px]"
                                              />
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="text-[10px] text-muted-foreground italic">No filename patterns</p>
                                )}
                              </div>
                            </div>
                          )}

                          {/* MAP-FOLDERS - Folder Structure Mapping */}
                          {operation.type === 'map-folders' && (
                            <div className="space-y-3">
                              {/* Scope */}
                              <div className="space-y-1">
                                <Label className="text-xs">Scope (folder path or "all")</Label>
                                <Input
                                  value={operation.scope}
                                  onChange={(e) => {
                                    const ops = [...(collectionConfig.pipeline?.operations || [])];
                                    ops[index] = { ...operation, scope: e.target.value };
                                    handleUpdateConfig({
                                      pipeline: {
                                        ...collectionConfig.pipeline,
                                        operations: ops,
                                        reasoning: collectionConfig.pipeline?.reasoning || ''
                                      }
                                    });
                                  }}
                                  placeholder="all"
                                  className="h-8 text-xs font-mono"
                                />
                                <p className="text-[10px] text-muted-foreground">
                                  Map folder names to traits or item names
                                </p>
                              </div>

                              {/* Folder Mapping */}
                              <div className="border-t pt-3 space-y-2">
                                <Label className="text-xs font-semibold">Folder Structure Mapping</Label>

                                {/* Folder as Item Name checkbox */}
                                <div className="flex items-center space-x-2">
                                  <Checkbox
                                    id={`folder-as-item-${index}`}
                                    checked={operation.traitMapping?.folderAsItemName || false}
                                    onCheckedChange={(checked) => {
                                      const ops = [...(collectionConfig.pipeline?.operations || [])];
                                      ops[index] = {
                                        ...operation,
                                        traitMapping: {
                                          ...operation.traitMapping,
                                          folderAsItemName: checked as boolean
                                        }
                                      };
                                      handleUpdateConfig({
                                        pipeline: {
                                          ...collectionConfig.pipeline,
                                          operations: ops,
                                          reasoning: collectionConfig.pipeline?.reasoning || ''
                                        }
                                      });
                                    }}
                                  />
                                  <label
                                    htmlFor={`folder-as-item-${index}`}
                                    className="text-[10px] font-medium leading-none cursor-pointer"
                                  >
                                    Use folder name as item name
                                  </label>
                                </div>

                                {!operation.traitMapping?.folderAsItemName && (
                                  <div className="space-y-2 pl-6">
                                    <div className="space-y-1">
                                      <Label className="text-[10px]">Level 1 Folders Map To</Label>
                                      <Select
                                        value={operation.traitMapping?.level1TraitName || 'none'}
                                        onValueChange={(value) => {
                                          const ops = [...(collectionConfig.pipeline?.operations || [])];
                                          ops[index] = {
                                            ...operation,
                                            traitMapping: {
                                              ...operation.traitMapping,
                                              level1TraitName: value === 'none' ? '' : value
                                            }
                                          };
                                          handleUpdateConfig({
                                            pipeline: {
                                              ...collectionConfig.pipeline,
                                              operations: ops,
                                              reasoning: collectionConfig.pipeline?.reasoning || ''
                                            }
                                          });
                                        }}
                                      >
                                        <SelectTrigger className="h-7 text-[10px]">
                                          <SelectValue placeholder="Select..." />
                                        </SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="none">Don't map</SelectItem>
                                          <SelectItem value="itemName">Item Name</SelectItem>
                                          <SelectItem value="rarity">Rarity</SelectItem>
                                          {collectionConfig.traits?.map(trait => (
                                            <SelectItem key={trait.name} value={trait.name}>
                                              {trait.name}
                                            </SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                    </div>

                                    <div className="space-y-1">
                                      <Label className="text-[10px]">Level 2 Folders Map To</Label>
                                      <Select
                                        value={operation.traitMapping?.level2TraitName || 'none'}
                                        onValueChange={(value) => {
                                          const ops = [...(collectionConfig.pipeline?.operations || [])];
                                          ops[index] = {
                                            ...operation,
                                            traitMapping: {
                                              ...operation.traitMapping,
                                              level2TraitName: value === 'none' ? '' : value
                                            }
                                          };
                                          handleUpdateConfig({
                                            pipeline: {
                                              ...collectionConfig.pipeline,
                                              operations: ops,
                                              reasoning: collectionConfig.pipeline?.reasoning || ''
                                            }
                                          });
                                        }}
                                      >
                                        <SelectTrigger className="h-7 text-[10px]">
                                          <SelectValue placeholder="Select..." />
                                        </SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="none">Don't map</SelectItem>
                                          <SelectItem value="rarity">Rarity</SelectItem>
                                          {collectionConfig.traits?.map(trait => (
                                            <SelectItem key={trait.name} value={trait.name}>
                                              {trait.name}
                                            </SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}

                          {/* STANDARDIZE-NAMES - Name Standardization */}
                          {operation.type === 'standardize-names' && (
                            <div className="space-y-3">
                              {/* Scope */}
                              <div className="space-y-1">
                                <Label className="text-xs">Scope (folder path or "all")</Label>
                                <Input
                                  value={operation.scope}
                                  onChange={(e) => {
                                    const ops = [...(collectionConfig.pipeline?.operations || [])];
                                    ops[index] = { ...operation, scope: e.target.value };
                                    handleUpdateConfig({
                                      pipeline: {
                                        ...collectionConfig.pipeline,
                                        operations: ops,
                                        reasoning: collectionConfig.pipeline?.reasoning || ''
                                      }
                                    });
                                  }}
                                  placeholder="all"
                                  className="h-8 text-xs font-mono"
                                />
                                <p className="text-[10px] text-muted-foreground">
                                  Apply standardized naming template
                                </p>
                              </div>

                              {/* Name Standardization */}
                              <div className="border-t pt-3 space-y-2">
                                <Label className="text-xs font-semibold">Name Standardization</Label>

                                <div className="space-y-1">
                                  <Label className="text-[10px]">Template</Label>
                                  <Input
                                    value={operation.nameStandardization?.template || '{itemName}'}
                                    onChange={(e) => {
                                      const ops = [...(collectionConfig.pipeline?.operations || [])];
                                      ops[index] = {
                                        ...operation,
                                        nameStandardization: {
                                          ...operation.nameStandardization,
                                          enabled: true,
                                          template: e.target.value
                                        }
                                      };
                                      handleUpdateConfig({
                                        pipeline: {
                                          ...collectionConfig.pipeline,
                                          operations: ops,
                                          reasoning: collectionConfig.pipeline?.reasoning || ''
                                        }
                                      });
                                    }}
                                    placeholder="{itemName}"
                                    className="h-7 text-[10px] font-mono"
                                  />
                                  <p className="text-[9px] text-muted-foreground">
                                    Variables: {'{itemName}'}, {'{rarity}'}, {'{trait:Name}'}
                                  </p>
                                </div>
                              </div>
                            </div>
                          )}

                          {/* COMPRESS - Image Compression */}
                          {operation.type === 'compress' && (
                            <div className="space-y-3">
                              {/* Scope */}
                              <div className="space-y-1">
                                <Label className="text-xs">Scope (folder path or "all")</Label>
                                <Input
                                  value={operation.scope}
                                  onChange={(e) => {
                                    const ops = [...(collectionConfig.pipeline?.operations || [])];
                                    ops[index] = { ...operation, scope: e.target.value };
                                    handleUpdateConfig({
                                      pipeline: {
                                        ...collectionConfig.pipeline,
                                        operations: ops,
                                        reasoning: collectionConfig.pipeline?.reasoning || ''
                                      }
                                    });
                                  }}
                                  placeholder="all"
                                  className="h-8 text-xs font-mono"
                                />
                                <p className="text-[10px] text-muted-foreground">
                                  Compress images to reduce file size
                                </p>
                              </div>

                              {/* Quality */}
                              <div className="space-y-1">
                                <div className="flex items-center justify-between">
                                  <Label className="text-xs">Quality (%)</Label>
                                  <span className="text-xs text-muted-foreground">{operation.quality || 85}</span>
                                </div>
                                <Input
                                  type="number"
                                  min="1"
                                  max="100"
                                  value={operation.quality || 85}
                                  onChange={(e) => {
                                    const ops = [...(collectionConfig.pipeline?.operations || [])];
                                    ops[index] = { ...operation, quality: parseInt(e.target.value) || 85 };
                                    handleUpdateConfig({
                                      pipeline: {
                                        ...collectionConfig.pipeline,
                                        operations: ops,
                                        reasoning: collectionConfig.pipeline?.reasoning || ''
                                      }
                                    });
                                  }}
                                  placeholder="85"
                                  className="h-8 text-xs"
                                />
                                <p className="text-[9px] text-muted-foreground">
                                  85-90 recommended for JPEG
                                </p>
                              </div>

                              {/* Max Dimensions */}
                              <div className="grid grid-cols-2 gap-2">
                                <div className="space-y-1">
                                  <Label className="text-xs">Max Width (px)</Label>
                                  <Input
                                    type="number"
                                    min="0"
                                    value={operation.maxWidth || ''}
                                    onChange={(e) => {
                                      const ops = [...(collectionConfig.pipeline?.operations || [])];
                                      ops[index] = { ...operation, maxWidth: e.target.value ? parseInt(e.target.value) : undefined };
                                      handleUpdateConfig({
                                        pipeline: {
                                          ...collectionConfig.pipeline,
                                          operations: ops,
                                          reasoning: collectionConfig.pipeline?.reasoning || ''
                                        }
                                      });
                                    }}
                                    placeholder="1920"
                                    className="h-8 text-xs"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs">Max Height (px)</Label>
                                  <Input
                                    type="number"
                                    min="0"
                                    value={operation.maxHeight || ''}
                                    onChange={(e) => {
                                      const ops = [...(collectionConfig.pipeline?.operations || [])];
                                      ops[index] = { ...operation, maxHeight: e.target.value ? parseInt(e.target.value) : undefined };
                                      handleUpdateConfig({
                                        pipeline: {
                                          ...collectionConfig.pipeline,
                                          operations: ops,
                                          reasoning: collectionConfig.pipeline?.reasoning || ''
                                        }
                                      });
                                    }}
                                    placeholder="1920"
                                    className="h-8 text-xs"
                                  />
                                </div>
                              </div>

                              {/* Format */}
                              <div className="space-y-1">
                                <Label className="text-xs">Output Format</Label>
                                <select
                                  value={operation.format || 'jpeg'}
                                  onChange={(e) => {
                                    const ops = [...(collectionConfig.pipeline?.operations || [])];
                                    ops[index] = { ...operation, format: e.target.value as 'jpeg' | 'png' | 'webp' };
                                    handleUpdateConfig({
                                      pipeline: {
                                        ...collectionConfig.pipeline,
                                        operations: ops,
                                        reasoning: collectionConfig.pipeline?.reasoning || ''
                                      }
                                    });
                                  }}
                                  className="h-8 text-xs w-full border rounded px-2 bg-background"
                                >
                                  <option value="jpeg">JPEG</option>
                                  <option value="png">PNG</option>
                                  <option value="webp">WebP</option>
                                </select>
                              </div>

                              {/* Reason */}
                              <div className="space-y-1">
                                <Label className="text-xs">Reason (optional)</Label>
                                <Input
                                  value={operation.reason || ''}
                                  onChange={(e) => {
                                    const ops = [...(collectionConfig.pipeline?.operations || [])];
                                    ops[index] = { ...operation, reason: e.target.value };
                                    handleUpdateConfig({
                                      pipeline: {
                                        ...collectionConfig.pipeline,
                                        operations: ops,
                                        reasoning: collectionConfig.pipeline?.reasoning || ''
                                      }
                                    });
                                  }}
                                  placeholder="Why compression is needed"
                                  className="h-8 text-xs"
                                />
                              </div>
                            </div>
                          )}

                          {/* FILTER - Include/Exclude Rules */}
                          {operation.type === 'filter' && (
                            <div className="space-y-3">
                              {/* Scope */}
                              <div className="space-y-1">
                                <Label className="text-xs">Scope (folder path or "all")</Label>
                                <Input
                                  value={operation.scope}
                                  onChange={(e) => {
                                    const ops = [...(collectionConfig.pipeline?.operations || [])];
                                    ops[index] = { ...operation, scope: e.target.value };
                                    handleUpdateConfig({
                                      pipeline: {
                                        ...collectionConfig.pipeline,
                                        operations: ops,
                                        reasoning: collectionConfig.pipeline?.reasoning || ''
                                      }
                                    });
                                  }}
                                  placeholder="all"
                                  className="h-8 text-xs font-mono"
                                />
                                <p className="text-[10px] text-muted-foreground">
                                  Include or exclude items based on rules
                                </p>
                              </div>

                              {/* Filter Rules */}
                              <div className="border-t pt-3 space-y-3">
                                <div className="flex items-center justify-between">
                                  <Label className="text-xs font-semibold">Filter Rules</Label>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-6 px-2 text-[10px]"
                                    onClick={() => {
                                      const ops = [...(collectionConfig.pipeline?.operations || [])];
                                      const newRule = {
                                        field: 'filename',
                                        operator: 'contains' as const,
                                        value: '',
                                        action: 'exclude' as const
                                      };
                                      ops[index] = {
                                        ...operation,
                                        rules: [...(operation.rules || []), newRule]
                                      };
                                      handleUpdateConfig({
                                        pipeline: {
                                          ...collectionConfig.pipeline,
                                          operations: ops,
                                          reasoning: collectionConfig.pipeline?.reasoning || ''
                                        }
                                      });
                                    }}
                                  >
                                    Add Rule
                                  </Button>
                                </div>

                                {operation.rules && operation.rules.length > 0 ? (
                                  <div className="space-y-2">
                                    {operation.rules.map((rule, ruleIndex) => (
                                      <div key={ruleIndex} className="border p-2 rounded space-y-2 bg-muted/30">
                                        <div className="flex justify-between items-center">
                                          <span className="text-[10px] font-semibold">Rule {ruleIndex + 1}</span>
                                          <Button
                                            size="sm"
                                            variant="ghost"
                                            className="h-5 w-5 p-0 text-destructive"
                                            onClick={() => {
                                              const ops = [...(collectionConfig.pipeline?.operations || [])];
                                              const newRules = [...(operation.rules || [])];
                                              newRules.splice(ruleIndex, 1);
                                              ops[index] = { ...operation, rules: newRules };
                                              handleUpdateConfig({
                                                pipeline: {
                                                  ...collectionConfig.pipeline,
                                                  operations: ops,
                                                  reasoning: collectionConfig.pipeline?.reasoning || ''
                                                }
                                              });
                                            }}
                                          >
                                            <Trash2 className="h-3 w-3" />
                                          </Button>
                                        </div>

                                        <div className="grid grid-cols-2 gap-2">
                                          <div className="space-y-1">
                                            <Label className="text-[10px]">Field</Label>
                                            <Input
                                              value={rule.field}
                                              onChange={(e) => {
                                                const ops = [...(collectionConfig.pipeline?.operations || [])];
                                                const newRules = [...(operation.rules || [])];
                                                newRules[ruleIndex] = { ...rule, field: e.target.value };
                                                ops[index] = { ...operation, rules: newRules };
                                                handleUpdateConfig({
                                                  pipeline: {
                                                    ...collectionConfig.pipeline,
                                                    operations: ops,
                                                    reasoning: collectionConfig.pipeline?.reasoning || ''
                                                  }
                                                });
                                              }}
                                              placeholder="filename"
                                              className="h-7 text-[10px]"
                                            />
                                          </div>
                                          <div className="space-y-1">
                                            <Label className="text-[10px]">Operator</Label>
                                            <select
                                              value={rule.operator}
                                              onChange={(e) => {
                                                const ops = [...(collectionConfig.pipeline?.operations || [])];
                                                const newRules = [...(operation.rules || [])];
                                                newRules[ruleIndex] = { ...rule, operator: e.target.value as any };
                                                ops[index] = { ...operation, rules: newRules };
                                                handleUpdateConfig({
                                                  pipeline: {
                                                    ...collectionConfig.pipeline,
                                                    operations: ops,
                                                    reasoning: collectionConfig.pipeline?.reasoning || ''
                                                  }
                                                });
                                              }}
                                              className="h-7 text-[10px] w-full border rounded px-1 bg-background"
                                            >
                                              <option value="equals">equals</option>
                                              <option value="contains">contains</option>
                                              <option value="startsWith">starts with</option>
                                              <option value="endsWith">ends with</option>
                                              <option value="regex">regex</option>
                                            </select>
                                          </div>
                                        </div>

                                        <div className="space-y-1">
                                          <Label className="text-[10px]">Value</Label>
                                          <Input
                                            value={rule.value}
                                            onChange={(e) => {
                                              const ops = [...(collectionConfig.pipeline?.operations || [])];
                                              const newRules = [...(operation.rules || [])];
                                              newRules[ruleIndex] = { ...rule, value: e.target.value };
                                              ops[index] = { ...operation, rules: newRules };
                                              handleUpdateConfig({
                                                pipeline: {
                                                  ...collectionConfig.pipeline,
                                                  operations: ops,
                                                  reasoning: collectionConfig.pipeline?.reasoning || ''
                                                }
                                              });
                                            }}
                                            placeholder="test, _draft, etc."
                                            className="h-7 text-[10px] font-mono"
                                          />
                                        </div>

                                        <div className="space-y-1">
                                          <Label className="text-[10px]">Action</Label>
                                          <select
                                            value={rule.action}
                                            onChange={(e) => {
                                              const ops = [...(collectionConfig.pipeline?.operations || [])];
                                              const newRules = [...(operation.rules || [])];
                                              newRules[ruleIndex] = { ...rule, action: e.target.value as 'include' | 'exclude' };
                                              ops[index] = { ...operation, rules: newRules };
                                              handleUpdateConfig({
                                                pipeline: {
                                                  ...collectionConfig.pipeline,
                                                  operations: ops,
                                                  reasoning: collectionConfig.pipeline?.reasoning || ''
                                                }
                                              });
                                            }}
                                            className="h-7 text-[10px] w-full border rounded px-1 bg-background"
                                          >
                                            <option value="include">Include (only these)</option>
                                            <option value="exclude">Exclude (remove these)</option>
                                          </select>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="text-[10px] text-muted-foreground italic text-center py-2">
                                    No rules yet. Click "Add Rule" to create one.
                                  </p>
                                )}
                              </div>

                              {/* Reason */}
                              <div className="space-y-1">
                                <Label className="text-xs">Reason (optional)</Label>
                                <Input
                                  value={operation.reason || ''}
                                  onChange={(e) => {
                                    const ops = [...(collectionConfig.pipeline?.operations || [])];
                                    ops[index] = { ...operation, reason: e.target.value };
                                    handleUpdateConfig({
                                      pipeline: {
                                        ...collectionConfig.pipeline,
                                        operations: ops,
                                        reasoning: collectionConfig.pipeline?.reasoning || ''
                                      }
                                    });
                                  }}
                                  placeholder="Why filtering is needed"
                                  className="h-8 text-xs"
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      ))
                    ) : (
                      <div className="text-xs text-muted-foreground italic p-3 bg-muted/30 rounded text-center">
                        No pipeline operations configured. Click the + button above to add operations.
                      </div>
                    )}
                  </div>
                </div>


                {/* OLD SECTIONS - COMMENTED OUT FOR NOW */}
                {false && collectionConfig.folderStructure && collectionConfig.folderStructure !== 'flat' && (
                  <div className="space-y-4 border-t pt-4">
                    <div className="border-b pb-3">
                      <h3 className="font-semibold text-sm mb-2">OLD: Step 2: Folder Structure</h3>
                      <p className="text-xs text-muted-foreground">
                        Your files are organized in {collectionConfig.folderStructure === 'one-level' ? 'subdirectories' : 'nested subdirectories'}.
                        Map these folders to traits, rarities, or item names.
                      </p>
                    </div>

                    {/* One-Level Structure: Single subdirectory */}
                    {collectionConfig.folderStructure === 'one-level' && (
                      <div className="space-y-3">
                        {/* Folder as Item Name Option */}
                        <div className="flex items-center space-x-2 p-3 bg-muted/30 rounded">
                          <Checkbox
                            id="folderAsItemName"
                            checked={collectionConfig.traitMapping?.folderAsItemName || false}
                            onCheckedChange={(checked) => {
                              handleUpdateConfig({
                                traitMapping: {
                                  ...collectionConfig.traitMapping,
                                  folderAsItemName: checked as boolean,
                                  level1TraitName: checked ? '' : collectionConfig.traitMapping?.level1TraitName
                                }
                              });
                            }}
                          />
                          <div className="flex-1">
                            <label
                              htmlFor="folderAsItemName"
                              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                            >
                              Use folder name as item name (files are variants)
                            </label>
                            <p className="text-xs text-muted-foreground mt-1">
                              Example: "Sword/v1.png, Sword/v2.png" → Item: "Sword", files are variants
                            </p>
                          </div>
                        </div>

                        {!collectionConfig.traitMapping?.folderAsItemName && (
                          <>
                            <Label className="text-sm font-medium">Map Subdirectories To:</Label>
                            <Select
                              value={collectionConfig.traitMapping?.level1TraitName || 'none'}
                              onValueChange={(value) => {
                                handleUpdateConfig({
                                  traitMapping: {
                                    ...collectionConfig.traitMapping,
                                    level1TraitName: value === 'none' ? '' : value
                                  }
                                });
                              }}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Select trait or rarity..." />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">Don't map folders</SelectItem>
                                <SelectItem value="itemName">Item Name</SelectItem>
                                <SelectItem value="rarity">Rarity</SelectItem>
                                {collectionConfig.traits?.map(trait => (
                                  <SelectItem key={trait.name} value={trait.name}>
                                    {trait.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {collectionConfig.traitMapping?.level1TraitName === 'itemName' && (
                              <p className="text-xs text-muted-foreground bg-blue-50 dark:bg-blue-950/20 p-2 rounded mt-2">
                                Folder names will be used as item names. Files inside are variants (use filename patterns to mark them).
                              </p>
                            )}
                          </>
                        )}

                        {/* Show detected folders */}
                        <div className="text-xs text-muted-foreground space-y-1 mt-2 p-3 bg-muted/50 rounded">
                          <p className="font-medium">Detected subdirectories:</p>
                          <div className="flex flex-wrap gap-2 mt-2">
                            {Array.from(new Set(selectedFiles.map(f => {
                              // Get relative path from root
                              const relativePath = selectedFolder
                                ? f.path.replace(selectedFolder, '').replace(/^\//, '')
                                : f.path;
                              const parts = relativePath.split('/').filter(Boolean);
                              // Return first folder in relative path
                              return parts.length > 1 ? parts[0] : null;
                            }).filter(Boolean))).sort().map(folder => (
                              <span key={folder} className="px-2 py-1 bg-background rounded text-xs font-mono">
                                {folder}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Two-Level Structure: Nested subdirectories */}
                    {collectionConfig.folderStructure === 'two-level' && (
                      <div className="space-y-4">
                        {/* Level 1 mapping */}
                        <div className="space-y-3">
                          <Label className="text-sm font-medium">Map Top-Level Folders To:</Label>
                          <Select
                            value={collectionConfig.traitMapping?.level1TraitName || 'none'}
                            onValueChange={(value) => {
                              handleUpdateConfig({
                                traitMapping: {
                                  ...collectionConfig.traitMapping,
                                  level1TraitName: value === 'none' ? '' : value
                                }
                              });
                            }}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select trait or rarity..." />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">Don't map folders</SelectItem>
                              <SelectItem value="itemName">Item Name</SelectItem>
                              <SelectItem value="rarity">Rarity</SelectItem>
                              {collectionConfig.traits?.map(trait => (
                                <SelectItem key={trait.name} value={trait.name}>
                                  {trait.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {collectionConfig.traitMapping?.level1TraitName === 'itemName' && (
                            <p className="text-xs text-muted-foreground bg-blue-50 dark:bg-blue-950/20 p-2 rounded">
                              Folder names will be used as item names. Files inside are variants (use filename patterns to mark them).
                            </p>
                          )}
                        </div>

                        {/* Level 2 mapping */}
                        <div className="space-y-3">
                          <Label className="text-sm font-medium">Map Second-Level Folders To:</Label>
                          <Select
                            value={collectionConfig.traitMapping?.level2TraitName || 'none'}
                            onValueChange={(value) => {
                              handleUpdateConfig({
                                traitMapping: {
                                  ...collectionConfig.traitMapping,
                                  level2TraitName: value === 'none' ? '' : value
                                }
                              });
                            }}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select trait or rarity..." />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">Don't map folders</SelectItem>
                              <SelectItem value="rarity">Rarity</SelectItem>
                              {collectionConfig.traits?.map(trait => (
                                <SelectItem key={trait.name} value={trait.name}>
                                  {trait.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* File Name Pattern Mapping */}
                {false && (
                <div className="space-y-4 border-t pt-4">
                  <div className="border-b pb-3">
                    <h3 className="font-semibold text-sm mb-2">OLD: Step 3: Filename Patterns</h3>
                    <p className="text-xs text-muted-foreground">
                      Extract trait or rarity information from filenames (applied after renames)
                    </p>
                  </div>

                  {/* Pattern List */}
                  <div className="space-y-2">
                    {(collectionConfig.filenamePatterns?.length || 0) > 0 ? (
                      collectionConfig.filenamePatterns!.map((pattern, index) => (
                        <div key={index} className="p-3 border rounded-lg space-y-3">
                          {/* Pattern Configuration */}
                          <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-1">
                              <Label className="text-xs">Pattern Type</Label>
                              <Select
                                value={pattern.type}
                                onValueChange={(value: any) => {
                                  const updated = [...(collectionConfig.filenamePatterns || [])];
                                  updated[index] = { ...updated[index], type: value };
                                  handleUpdateConfig({ filenamePatterns: updated });
                                }}
                              >
                                <SelectTrigger className="h-8 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="prefix">Prefix</SelectItem>
                                  <SelectItem value="suffix">Suffix</SelectItem>
                                  <SelectItem value="contains">Contains</SelectItem>
                                  <SelectItem value="regex">Regex</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>

                            <div className="space-y-1">
                              <Label className="text-xs">Maps To</Label>
                              <Select
                                value={pattern.targetField}
                                onValueChange={(value: any) => {
                                  const updated = [...(collectionConfig.filenamePatterns || [])];
                                  updated[index] = { ...updated[index], targetField: value };
                                  handleUpdateConfig({ filenamePatterns: updated });
                                }}
                              >
                                <SelectTrigger className="h-8 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="variant">Variant</SelectItem>
                                  <SelectItem value="rarity">Rarity</SelectItem>
                                  {collectionConfig.traits?.map(trait => (
                                    <SelectItem key={trait.name} value={trait.name}>
                                      {trait.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              {pattern.targetField === 'variant' && (
                                <p className="text-[10px] text-muted-foreground bg-blue-50 dark:bg-blue-950/20 p-1.5 rounded mt-1">
                                  Files matching this pattern are variants (same item, different image)
                                </p>
                              )}
                            </div>

                            <div className="space-y-1 col-span-2">
                              <Label className="text-xs">Pattern</Label>
                              <div className="flex gap-2">
                                <Input
                                  value={pattern.pattern}
                                  onChange={(e) => {
                                    const updated = [...(collectionConfig.filenamePatterns || [])];
                                    updated[index] = { ...updated[index], pattern: e.target.value };
                                    handleUpdateConfig({ filenamePatterns: updated });
                                  }}
                                  placeholder={pattern.type === 'prefix' ? 'common_' : pattern.type === 'suffix' ? '_common' : 'common'}
                                  className="h-8 text-xs font-mono"
                                />
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-8 w-8 p-0"
                                  onClick={() => {
                                    const updated = [...(collectionConfig.filenamePatterns || [])];
                                    updated.splice(index, 1);
                                    handleUpdateConfig({ filenamePatterns: updated });
                                  }}
                                >
                                  <XCircle className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>

                            {pattern.type !== 'regex' && (
                              <div className="space-y-1 col-span-2">
                                <Label className="text-xs">Extract Value</Label>
                                <Input
                                  value={pattern.matchValue || ''}
                                  onChange={(e) => {
                                    const updated = [...(collectionConfig.filenamePatterns || [])];
                                    updated[index] = { ...updated[index], matchValue: e.target.value };
                                    handleUpdateConfig({ filenamePatterns: updated });
                                  }}
                                  placeholder="Value to assign when matched"
                                  className="h-8 text-xs"
                                />
                                <p className="text-[10px] text-muted-foreground">
                                  The {pattern.targetField} value to assign when this pattern matches
                                </p>
                              </div>
                            )}
                          </div>

                          {/* Test pattern on sample files */}
                          <div className="pt-2 border-t">
                            <p className="text-xs text-muted-foreground mb-1">Matches:</p>
                            <div className="flex flex-wrap gap-1">
                              {selectedFiles.slice(0, 10).filter(file => {
                                const nameWithoutExt = file.name.replace(/\.[^/.]+$/, '');
                                if (pattern.type === 'prefix') {
                                  return nameWithoutExt.toLowerCase().startsWith(pattern.pattern.toLowerCase());
                                } else if (pattern.type === 'suffix') {
                                  return nameWithoutExt.toLowerCase().endsWith(pattern.pattern.toLowerCase());
                                } else if (pattern.type === 'contains') {
                                  return nameWithoutExt.toLowerCase().includes(pattern.pattern.toLowerCase());
                                }
                                return false;
                              }).slice(0, 3).map(file => (
                                <span key={file.id} className="text-xs px-2 py-0.5 bg-green-50 dark:bg-green-950/20 text-green-700 dark:text-green-300 rounded">
                                  {file.name}
                                </span>
                              ))}
                              {selectedFiles.filter(file => {
                                const nameWithoutExt = file.name.replace(/\.[^/.]+$/, '');
                                if (pattern.type === 'prefix') {
                                  return nameWithoutExt.toLowerCase().startsWith(pattern.pattern.toLowerCase());
                                } else if (pattern.type === 'suffix') {
                                  return nameWithoutExt.toLowerCase().endsWith(pattern.pattern.toLowerCase());
                                } else if (pattern.type === 'contains') {
                                  return nameWithoutExt.toLowerCase().includes(pattern.pattern.toLowerCase());
                                }
                                return false;
                              }).length > 3 && (
                                <span className="text-xs text-muted-foreground">
                                  +{selectedFiles.filter(file => {
                                    const nameWithoutExt = file.name.replace(/\.[^/.]+$/, '');
                                    if (pattern.type === 'prefix') {
                                      return nameWithoutExt.toLowerCase().startsWith(pattern.pattern.toLowerCase());
                                    } else if (pattern.type === 'suffix') {
                                      return nameWithoutExt.toLowerCase().endsWith(pattern.pattern.toLowerCase());
                                    } else if (pattern.type === 'contains') {
                                      return nameWithoutExt.toLowerCase().includes(pattern.pattern.toLowerCase());
                                    }
                                    return false;
                                  }).length - 3} more
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="text-xs text-muted-foreground italic p-3 bg-muted/30 rounded text-center">
                        No filename patterns configured
                      </div>
                    )}
                  </div>

                  {/* Add Pattern Button */}
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    onClick={() => {
                      // Add a new pattern
                      const newPattern: FilenamePattern = {
                        type: 'prefix',
                        targetField: 'rarity',
                        pattern: ''
                      };
                      handleUpdateConfig({
                        filenamePatterns: [...(collectionConfig.filenamePatterns || []), newPattern]
                      });
                    }}
                  >
                    + Add Filename Pattern
                  </Button>

                  {/* Quick Examples */}
                  <div className="space-y-2">
                    <p className="text-xs font-medium">Quick Add Examples:</p>
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-auto py-2 flex flex-col items-start text-left"
                        onClick={() => {
                          const patterns = collectionConfig.filenamePatterns || [];
                          if (collectionConfig.rarityLabels && collectionConfig.rarityLabels.length > 0) {
                            const firstRarity = collectionConfig.rarityLabels[0].label.toLowerCase();
                            handleUpdateConfig({
                              filenamePatterns: [...patterns, {
                                type: 'prefix',
                                targetField: 'rarity',
                                pattern: firstRarity + '_',
                                matchValue: collectionConfig.rarityLabels[0].label
                              }]
                            });
                          }
                        }}
                      >
                        <span className="text-xs font-semibold">Prefix Pattern</span>
                        <code className="text-[10px] text-muted-foreground">common_item.png</code>
                      </Button>

                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-auto py-2 flex flex-col items-start text-left"
                        onClick={() => {
                          const patterns = collectionConfig.filenamePatterns || [];
                          if (collectionConfig.rarityLabels && collectionConfig.rarityLabels.length > 0) {
                            const firstRarity = collectionConfig.rarityLabels[0].label.toLowerCase();
                            handleUpdateConfig({
                              filenamePatterns: [...patterns, {
                                type: 'suffix',
                                targetField: 'rarity',
                                pattern: '_' + firstRarity,
                                matchValue: collectionConfig.rarityLabels[0].label
                              }]
                            });
                          }
                        }}
                      >
                        <span className="text-xs font-semibold">Suffix Pattern</span>
                        <code className="text-[10px] text-muted-foreground">item_common.png</code>
                      </Button>
                    </div>
                  </div>

                  <div className="p-3 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded text-xs text-blue-900 dark:text-blue-100">
                    <p className="font-semibold mb-1">💡 Pro Tip</p>
                    <p>Use the AI Auto-Assign feature in the Traits tab to automatically detect and map these patterns. It will analyze your filenames and folder structure intelligently.</p>
                  </div>
                </div>
                )}

                {/* Name Standardization */}
                {false && (
                <div className="space-y-4 border-t pt-4">
                  <div className="border-b pb-3">
                    <h3 className="font-semibold text-sm mb-2">OLD: Step 4: Name Standardization</h3>
                    <p className="text-xs text-muted-foreground">
                      Standardize item names based on mapped metadata (applied after all mappings)
                    </p>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="enableNameStandardization"
                      checked={collectionConfig.nameStandardization?.enabled || false}
                      onCheckedChange={(checked) => {
                        handleUpdateConfig({
                          nameStandardization: {
                            enabled: checked as boolean,
                            template: collectionConfig.nameStandardization?.template || '{itemName}'
                          }
                        });
                      }}
                    />
                    <label
                      htmlFor="enableNameStandardization"
                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                    >
                      Enable name standardization
                    </label>
                  </div>

                  {collectionConfig.nameStandardization?.enabled && (
                    <div className="space-y-3">
                      <div className="space-y-1">
                        <Label className="text-xs">Name Template</Label>
                        <Input
                          value={collectionConfig.nameStandardization?.template || '{itemName}'}
                          onChange={(e) => {
                            handleUpdateConfig({
                              nameStandardization: {
                                ...collectionConfig.nameStandardization,
                                enabled: collectionConfig.nameStandardization?.enabled || false,
                                template: e.target.value
                              }
                            });
                          }}
                          placeholder="{itemName}"
                          className="h-8 text-xs font-mono"
                        />
                        <p className="text-[10px] text-muted-foreground">
                          Available variables: {'{itemName}'}, {'{rarity}'}, {'{trait:TraitName}'}
                        </p>
                      </div>

                      {/* Live Preview */}
                      <div className="space-y-2">
                        <p className="text-xs font-medium">Preview:</p>
                        <div className="space-y-1 p-3 bg-muted/30 rounded text-xs">
                          {selectedFiles.slice(0, 3).map(file => {
                            // Apply transformations to preview standardized name
                            const fileNameWithoutExt = file.name.replace(/\.[^/.]+$/, '');

                            // Get relative path
                            const relativePath = selectedFolder
                              ? file.path.replace(selectedFolder, '').replace(/^\//, '')
                              : file.path;
                            const pathParts = relativePath.split('/').filter(Boolean);
                            const folders = pathParts.slice(0, -1);

                            // Apply renames
                            let renamedFileName = fileNameWithoutExt;
                            if (collectionConfig.renamePatterns) {
                              for (const pattern of collectionConfig.renamePatterns) {
                                if (pattern.type === 'prefix-remove' && renamedFileName.startsWith(pattern.pattern)) {
                                  renamedFileName = renamedFileName.substring(pattern.pattern.length);
                                } else if (pattern.type === 'suffix-remove' && renamedFileName.endsWith(pattern.pattern)) {
                                  renamedFileName = renamedFileName.substring(0, renamedFileName.length - pattern.pattern.length);
                                } else if (pattern.type === 'replace') {
                                  renamedFileName = renamedFileName.replace(new RegExp(pattern.pattern, 'g'), pattern.replacement || '');
                                } else if (pattern.type === 'regex-replace') {
                                  try {
                                    renamedFileName = renamedFileName.replace(new RegExp(pattern.pattern, 'g'), pattern.replacement || '');
                                  } catch (e) {
                                    // Invalid regex, skip
                                  }
                                }
                              }
                            }

                            // Determine base item name
                            let itemName = renamedFileName;
                            if (collectionConfig.traitMapping?.folderAsItemName && folders.length >= 1) {
                              itemName = folders[folders.length - 1];
                            }

                            // Calculate metadata
                            let rarity = '';
                            const traits: Array<{name: string; value: string}> = [];

                            // From filename patterns
                            if (collectionConfig.filenamePatterns) {
                              for (const pattern of collectionConfig.filenamePatterns) {
                                let matches = false;
                                let extractedValue = pattern.matchValue || '';

                                if (pattern.type === 'prefix' && renamedFileName.toLowerCase().startsWith(pattern.pattern.toLowerCase())) {
                                  matches = true;
                                } else if (pattern.type === 'suffix' && renamedFileName.toLowerCase().endsWith(pattern.pattern.toLowerCase())) {
                                  matches = true;
                                } else if (pattern.type === 'contains' && renamedFileName.toLowerCase().includes(pattern.pattern.toLowerCase())) {
                                  matches = true;
                                }

                                if (matches && extractedValue) {
                                  if (pattern.targetField === 'rarity') {
                                    rarity = extractedValue;
                                  } else {
                                    traits.push({ name: pattern.targetField, value: extractedValue });
                                  }
                                }
                              }
                            }

                            // From folder mappings
                            if (collectionConfig.traitMapping && !collectionConfig.traitMapping.folderAsItemName) {
                              if (collectionConfig.traitMapping.level1TraitName && folders.length >= 1) {
                                const folderValue = folders[0];
                                if (collectionConfig.traitMapping.level1TraitName === 'rarity') {
                                  rarity = folderValue;
                                } else {
                                  traits.push({ name: collectionConfig.traitMapping.level1TraitName, value: folderValue });
                                }
                              }
                              if (collectionConfig.traitMapping.level2TraitName && folders.length >= 2) {
                                const folderValue = folders[1];
                                if (collectionConfig.traitMapping.level2TraitName === 'rarity') {
                                  rarity = folderValue;
                                } else {
                                  traits.push({ name: collectionConfig.traitMapping.level2TraitName, value: folderValue });
                                }
                              }
                            }

                            // Apply standardization template
                            let standardizedName = collectionConfig.nameStandardization?.template || '{itemName}';
                            standardizedName = standardizedName.replace('{itemName}', itemName);
                            standardizedName = standardizedName.replace('{rarity}', rarity);

                            // Replace trait variables
                            for (const trait of traits) {
                              standardizedName = standardizedName.replace(`{trait:${trait.name}}`, trait.value);
                            }

                            return (
                              <div key={file.id} className="flex items-center gap-2">
                                <span className="text-muted-foreground line-through">{itemName}</span>
                                <span>→</span>
                                <span className="text-green-600 dark:text-green-400 font-medium">{standardizedName}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Template Examples */}
                      <div className="space-y-2">
                        <p className="text-xs font-medium">Template Examples:</p>
                        <div className="grid grid-cols-1 gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-auto py-2 flex flex-col items-start text-left"
                            onClick={() => {
                              handleUpdateConfig({
                                nameStandardization: {
                                  enabled: true,
                                  template: '{rarity}_{itemName}'
                                }
                              });
                            }}
                          >
                            <span className="text-xs font-semibold">{'{rarity}_{itemName}'}</span>
                            <code className="text-[10px] text-muted-foreground">Example: Epic_Sword</code>
                          </Button>

                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-auto py-2 flex flex-col items-start text-left"
                            onClick={() => {
                              if (collectionConfig.traits && collectionConfig.traits.length > 0) {
                                const firstTrait = collectionConfig.traits[0].name;
                                handleUpdateConfig({
                                  nameStandardization: {
                                    enabled: true,
                                    template: `{trait:${firstTrait}}_{itemName}`
                                  }
                                });
                              }
                            }}
                          >
                            <span className="text-xs font-semibold">{'{trait:Type}_{itemName}'}</span>
                            <code className="text-[10px] text-muted-foreground">Example: Weapon_Sword</code>
                          </Button>

                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-auto py-2 flex flex-col items-start text-left"
                            onClick={() => {
                              handleUpdateConfig({
                                nameStandardization: {
                                  enabled: true,
                                  template: '{itemName} - {rarity}'
                                }
                              });
                            }}
                          >
                            <span className="text-xs font-semibold">{'{itemName} - {rarity}'}</span>
                            <code className="text-[10px] text-muted-foreground">Example: Sword - Epic</code>
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                )}
                  </div>
                </ScrollArea>
              </ResizablePanel>

              <ResizableHandle withHandle />

              {/* Right: After - Transformed Items */}
              <ResizablePanel defaultSize={25} minSize={20}>
                <div className="h-full flex flex-col">
                  {/* Header */}
                  <div className="p-4 border-b bg-background flex-shrink-0">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold text-sm">After: Transformed Items</h3>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            if (!transformedFiles || transformedFiles.length === 0) {
                              showNotification('No transformed files to copy', 'error');
                              return;
                            }

                            // Build tree from transformedFiles
                            type LocalFolderNode = {
                              name: string;
                              type: 'folder' | 'file';
                              path: string;
                              children: LocalFolderNode[];
                            };

                            const buildTree = (files: typeof transformedFiles): LocalFolderNode => {
                              const root: LocalFolderNode = {
                                name: 'Root',
                                type: 'folder',
                                path: '',
                                children: []
                              };

                              files.forEach(file => {
                                const parts = file.path.split('/').filter(Boolean);
                                let currentNode = root;

                                parts.forEach((part, index) => {
                                  const isFile = index === parts.length - 1;
                                  let childNode = currentNode.children.find(c => c.name === part);

                                  if (!childNode) {
                                    childNode = {
                                      name: part,
                                      type: isFile ? 'file' : 'folder',
                                      path: parts.slice(0, index + 1).join('/'),
                                      children: []
                                    };
                                    currentNode.children.push(childNode);
                                  }

                                  if (!isFile) {
                                    currentNode = childNode;
                                  }
                                });
                              });

                              return root;
                            };

                            const tree = buildTree(transformedFiles);
                            const treeText = tree.children.map(child => renderTreeAsText(child as FolderNode)).join('\n');
                            navigator.clipboard.writeText(treeText);
                            showNotification('Copied AFTER structure to clipboard', 'success');
                          }}
                          title="Copy structure to clipboard"
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                        <span className="text-xs text-muted-foreground">
                        {transformedFiles ? (() => {
                          const dirs = new Set<string>();
                          transformedFiles.forEach(file => {
                            const pathParts = file.path.split('/').filter(Boolean);
                            for (let i = 1; i < pathParts.length; i++) {
                              dirs.add(pathParts.slice(0, i).join('/'));
                            }
                          });
                          return `${dirs.size} dirs, ${transformedFiles.length} files`;
                        })() : '- dirs, - files'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Scrollable Tree View - Same structure as Before */}
                  <ScrollArea className="flex-1 min-h-0">
                    <div className="py-1">
                      {(() => {
                        // Show empty state if pipeline hasn't been executed yet
                        if (!transformedFiles || transformedFiles.length === 0) {
                          return (
                            <div className="flex flex-col items-center justify-center h-full py-12 px-4 text-center">
                              <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
                                <FileQuestion className="h-6 w-6 text-muted-foreground" />
                              </div>
                              <h4 className="text-sm font-medium mb-1">No transformations yet</h4>
                              <p className="text-xs text-muted-foreground max-w-sm">
                                Execute the pipeline to see transformed file structure
                              </p>
                            </div>
                          );
                        }

                        // Build hierarchical folder tree (same as BEFORE panel)
                        type FolderNode = {
                          name: string;
                          type: 'folder' | 'file';
                          path: string;
                          children: FolderNode[];
                        };

                        const buildTree = (): FolderNode => {
                          const root: FolderNode = {
                            name: 'Root',
                            type: 'folder',
                            path: '',
                            children: []
                          };

                          transformedFiles.forEach(file => {
                            // Get path relative to workspace transformed folder
                            // Files are in format: ~/.bitcoin/collections/{name}/transformed/{item folders}
                            // We want to show just the {item folders} part
                            const transformedMarker = '/transformed/';
                            const transformedIndex = file.path.lastIndexOf(transformedMarker);

                            let relativePath = file.path;
                            if (transformedIndex !== -1) {
                              relativePath = file.path.substring(transformedIndex + transformedMarker.length);
                            }

                            const pathParts = relativePath.split('/').filter(Boolean);

                            let currentNode = root;

                            // Navigate/create folders
                            for (let i = 0; i < pathParts.length - 1; i++) {
                              const folderName = pathParts[i];
                              let folder = currentNode.children.find(
                                c => c.name === folderName && c.type === 'folder'
                              );

                              if (!folder) {
                                folder = {
                                  name: folderName,
                                  type: 'folder',
                                  path: pathParts.slice(0, i + 1).join('/'),
                                  children: []
                                };
                                currentNode.children.push(folder);
                              }

                              currentNode = folder;
                            }

                            // Add file
                            currentNode.children.push({
                              name: pathParts[pathParts.length - 1] || file.name,
                              type: 'file',
                              path: file.path,
                              children: []
                            });
                          });

                          // Sort children: folders first, then alphabetically
                          const sortChildren = (node: FolderNode) => {
                            node.children.sort((a, b) => {
                              if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
                              return a.name.localeCompare(b.name);
                            });
                            node.children.forEach(child => {
                              if (child.type === 'folder') sortChildren(child);
                            });
                          };

                          sortChildren(root);
                          return root;
                        };

                        // Recursive tree renderer (same as BEFORE panel)
                        const TreeNode = ({ node, depth = 0 }: { node: FolderNode; depth?: number }) => {
                          if (node.type === 'file') {
                            return (
                              <div
                                className="text-xs text-muted-foreground py-0.5 font-mono truncate hover:text-foreground transition-colors"
                                style={{ paddingLeft: `${(depth + 1) * 12}px` }}
                              >
                                {node.name}
                              </div>
                            );
                          }

                          const fileCount = node.children.filter(c => c.type === 'file').length;
                          const folderCount = node.children.filter(c => c.type === 'folder').length;
                          const files = node.children.filter(c => c.type === 'file');
                          const folders = node.children.filter(c => c.type === 'folder');
                          const showFiles = files.length > 0 && files.length <= 5;

                          return (
                            <Collapsible defaultOpen={depth === 0} className="group/collapsible">
                              <CollapsibleTrigger
                                className="w-full flex items-center gap-1.5 px-2 py-1.5 hover:bg-accent/50 rounded-md transition-colors text-xs font-medium text-foreground"
                                style={{ paddingLeft: `${depth * 12 + 8}px` }}
                              >
                                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/collapsible:rotate-90" />
                                <Folder className="h-3.5 w-3.5 shrink-0 text-blue-500" />
                                <span className="truncate">{node.name}</span>
                                <div className="ml-auto flex items-center gap-1">
                                  {folderCount > 0 && (
                                    <Badge variant="outline" className="h-4 px-1.5 text-[10px] font-normal">
                                      {folderCount} folders
                                    </Badge>
                                  )}
                                  {fileCount > 0 && (
                                    <Badge variant="secondary" className="h-4 px-1.5 text-[10px] font-normal">
                                      {fileCount} files
                                    </Badge>
                                  )}
                                </div>
                              </CollapsibleTrigger>

                              <CollapsibleContent>
                                <div className="space-y-0.5 py-0.5">
                                  {/* Render nested folders first */}
                                  {folders.map((child, idx) => (
                                    <TreeNode key={`folder-${idx}`} node={child} depth={depth + 1} />
                                  ))}

                                  {/* Show first 5 files if not too many */}
                                  {showFiles && files.map((child, idx) => (
                                    <TreeNode key={`file-${idx}`} node={child} depth={depth + 1} />
                                  ))}

                                  {/* Show "X files" if too many */}
                                  {!showFiles && fileCount > 0 && (
                                    <div
                                      className="text-xs text-muted-foreground italic py-0.5"
                                      style={{ paddingLeft: `${(depth + 2) * 12}px` }}
                                    >
                                      {fileCount} files
                                    </div>
                                  )}
                                </div>
                              </CollapsibleContent>
                            </Collapsible>
                          );
                        };

                        const tree = buildTree();
                        return tree.children.map((child, idx) => (
                          <TreeNode key={idx} node={child} depth={0} />
                        ));
                      })()}
                    </div>
                  </ScrollArea>

                  {/* Fixed Footer with Action Button */}
                  <div className="p-4 border-t bg-background flex-shrink-0">
                    <Button
                      onClick={() => {
                        if (transformedFiles && transformedFiles.length > 0) {
                          setActiveTab('mint');
                        } else {
                          // Execute pipeline
                          setIsPipelineExecuting(true);
                          setPipelineProgress({ currentStep: 0, totalSteps: collectionConfig.pipeline?.operations.length || 0, steps: [] });
                          vscode.postMessage({ command: 'executePipeline' });
                        }
                      }}
                      className="w-full"
                      variant="default"
                      disabled={!collectionConfig.pipeline?.operations || collectionConfig.pipeline.operations.length === 0}
                    >
                      {transformedFiles && transformedFiles.length > 0 ? (
                        <>
                          Review & Mint
                          <ChevronRight className="h-4 w-4 ml-2" />
                        </>
                      ) : (
                        <>
                          <Layers className="h-4 w-4 mr-2" />
                          Run Transformations
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
          </TabsContent>

          <TabsContent value="mint" className="mt-0 h-full pt-2">
            {!transformedFiles || transformedFiles.length === 0 ? (
              /* Empty state when pipeline hasn't been executed */
              <div className="flex flex-col items-center justify-center h-full py-12 px-4 text-center border rounded-lg">
                <Layers className="h-12 w-12 text-muted-foreground/50 mb-4" />
                <h3 className="text-lg font-semibold mb-2">No Transformed Files</h3>
                <p className="text-sm text-muted-foreground max-w-md mb-6">
                  Run the transformation pipeline in the <strong>Transform</strong> tab to prepare your collection for minting.
                  Once transformations are complete, you'll be able to review and mint your collection here.
                </p>
                <Button
                  onClick={() => setActiveTab('transform')}
                  variant="default"
                  size="sm"
                >
                  <Layers className="h-4 w-4 mr-2" />
                  Go to Transform Tab
                </Button>
              </div>
            ) : (
              /* Resizable Inventory-Style Layout */
              <ResizablePanelGroup direction="horizontal" className="h-full rounded-lg border">
                {/* Left: Item Grid */}
                <ResizablePanel defaultSize={70} minSize={40}>
                  <div className="h-full flex flex-col">
                    {/* Fixed Header */}
                    <div className="p-4 border-b bg-background flex-shrink-0">
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="font-semibold">Collection Items</h3>
                        <Select value={groupBy} onValueChange={(value: any) => setGroupBy(value)}>
                          <SelectTrigger className="w-[140px] h-7 text-xs">
                            <SelectValue placeholder="Group by..." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="rarity">Rarity</SelectItem>
                            {collectionConfig.traits && collectionConfig.traits.length > 0 && (
                              <>
                                {collectionConfig.traits.map(trait => (
                                  <SelectItem key={trait.name} value={trait.name}>
                                    {trait.name}
                                  </SelectItem>
                                ))}
                              </>
                            )}
                            <SelectItem value="none">No Grouping</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {selectedFiles.length} item{selectedFiles.length !== 1 ? 's' : ''} ready to mint
                      </p>
                    </div>

                    {/* Scrollable Tree View */}
                    <ScrollArea className="flex-1 min-h-0">
                      <div className="py-1 space-y-1">
                        {Object.entries(groupedFiles).map(([groupName, groupFiles]) => (
                        <Collapsible
                          key={groupName}
                          defaultOpen={true}
                          className="group/collapsible"
                        >
                          <CollapsibleTrigger className="w-full flex items-center gap-1.5 px-2 py-1.5 hover:bg-accent/50 rounded-md transition-colors text-xs font-medium text-foreground">
                            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/collapsible:rotate-90" />
                            <span className="truncate">{groupName}</span>
                            <Badge variant="secondary" className="ml-auto h-4 px-1.5 text-[10px] font-normal">
                              {groupFiles.length}
                            </Badge>
                          </CollapsibleTrigger>

                          <CollapsibleContent>
                            <DroppableGroup id={groupName} onDrop={handleItemDrop}>
                              <div className="space-y-0.5 py-0.5">
                                {groupFiles.map((file) => (
                                  <DraggableItem key={file.id} id={file.id}>
                                    <button
                                      onClick={() => setSelectedItemId(file.id)}
                                      className={`w-full flex items-center gap-2 px-2 py-1 pl-6 rounded-md hover:bg-accent transition-colors ${
                                        selectedItemId === file.id ? 'bg-accent/70' : ''
                                      }`}
                                    >
                                      {/* Tiny Thumbnail */}
                                      <div className="shrink-0 w-5 h-5 rounded overflow-hidden bg-muted border border-border/50">
                                        <ProcessedImage
                                          fileId={file.id}
                                          options={{ thumbnail: true }}
                                          alt={file.metadata?.name || file.name}
                                          className="w-full h-full object-cover"
                                        />
                                      </div>

                                      {/* Item Name */}
                                      <span className="truncate text-xs text-foreground flex-1 text-left">
                                        {file.metadata?.name || file.name}
                                      </span>

                                      {/* Rarity Badge (optional) */}
                                      {file.metadata?.rarityLabel && (
                                        <Badge variant="outline" className="h-4 px-1.5 text-[10px] shrink-0">
                                          {file.metadata.rarityLabel}
                                        </Badge>
                                      )}

                                      {/* Selection Indicator */}
                                      {selectedItemId === file.id && (
                                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-primary" />
                                      )}
                                    </button>
                                  </DraggableItem>
                                ))}
                              </div>
                            </DroppableGroup>
                          </CollapsibleContent>
                        </Collapsible>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              </ResizablePanel>

              <ResizableHandle withHandle />

              {/* Right: Detail Panel */}
              <ResizablePanel defaultSize={30} minSize={30}>
                <div className="h-full flex flex-col">
                  {/* Sub-Tabs */}
                  <Tabs value={itemSubTab} onValueChange={(value) => setItemSubTab(value as 'collection' | 'item' | 'output')} className="flex-1 flex flex-col min-h-0">
                    <div className="flex-shrink-0 border-b bg-background">
                      <TabsList className="w-full grid grid-cols-3 rounded-none border-b h-8">
                        <TabsTrigger value="collection" className="rounded-none h-7 text-xs">Collection</TabsTrigger>
                        <TabsTrigger value="item" className="rounded-none h-7 text-xs">Item</TabsTrigger>
                        <TabsTrigger value="output" className="rounded-none h-7 text-xs">Output</TabsTrigger>
                      </TabsList>
                    </div>

                    {/* Tab Content Container */}
                    <div className="flex-1 min-h-0">
                      {/* Collection Tab */}
                      <TabsContent value="collection" className="m-0 border-none p-0 h-full">
                        <ScrollArea className="h-full">
                          <div className="p-4 space-y-4">
                            <h4 className="text-sm font-semibold flex items-center gap-2">
                              <Layers className="h-4 w-4" />
                              Collection Inscription Metadata
                            </h4>

                            <div className="space-y-2 text-xs">
                              <div className="text-muted-foreground text-xs mb-2">
                                This shows the collection-level metadata that will be inscribed:
                              </div>

                              <code className="block bg-muted p-3 rounded text-xs overflow-x-auto font-mono whitespace-pre">
                                {JSON.stringify(
                                  {
                                    app: 'vscode-bitcoin',
                                    type: 'ord',
                                    name: collectionConfig.name,
                                    description: collectionConfig.description,
                                    subType: 'collection',
                                    subTypeData: {
                                      quantity: selectedFiles.length,
                                      ...(collectionConfig.rarityLabels && collectionConfig.rarityLabels.length > 0 && {
                                        rarityLabels: collectionConfig.rarityLabels.map(r => ({
                                          label: r.label,
                                          percentage: r.percentage
                                        }))
                                      }),
                                      ...(collectionConfig.traits && collectionConfig.traits.length > 0 && {
                                        traits: collectionConfig.traits.map(t => ({
                                          name: t.name,
                                          values: t.values,
                                          occurancePercentages: t.occurancePercentages
                                        }))
                                      })
                                    }
                                  },
                                  null,
                                  2
                                )}
                              </code>
                            </div>
                          </div>
                        </ScrollArea>
                      </TabsContent>

                      {/* Item Tab */}
                      <TabsContent value="item" className="m-0 border-none p-0 h-full">
                        <div className="flex flex-col h-full">
                          {/* Fixed Preview Image Section */}
                          <div className="p-4 border-b bg-background flex-shrink-0">
                            {selectedItem ? (
                              <>
                                <div className="h-48 rounded-lg overflow-hidden border-2 border-primary/20 bg-muted relative">
                                  <ProcessedImage
                                    fileId={selectedItem.id}
                                    options={{ preview: true }}
                                    alt={selectedItem.metadata?.name || selectedItem.name}
                                    className="w-full h-full object-contain"
                                  />
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
                        </div>
                      </TabsContent>

                      {/* Output Tab */}
                      <TabsContent value="output" className="m-0 border-none p-0 h-full">
                        <ScrollArea className="h-full">
                          <div className="p-4 space-y-6">
                            <div>
                              <h4 className="text-sm font-semibold mb-3">Image Optimization Settings</h4>
                              <p className="text-xs text-muted-foreground mb-4">
                                Configure optimization settings for the entire collection. Optimization is applied during minting; original files remain unchanged.
                              </p>

                              <div className="space-y-4">
                                {/* Format */}
                                <div className="space-y-2">
                                  <Label className="text-xs font-medium">Format</Label>
                                  <Select
                                    value={outputSettings.format}
                                    onValueChange={(value) => setOutputSettings({ ...outputSettings, format: value })}
                                  >
                                    <SelectTrigger className="w-full">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="original">Original</SelectItem>
                                      <SelectItem value="webp">WebP</SelectItem>
                                      <SelectItem value="avif">AVIF</SelectItem>
                                      <SelectItem value="jpeg">JPEG</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>

                                {/* Quality */}
                                <div className="space-y-2">
                                  <div className="flex items-center justify-between">
                                    <Label className="text-xs font-medium">Quality</Label>
                                    <span className="text-xs text-muted-foreground font-mono">{outputSettings.quality}</span>
                                  </div>
                                  <Slider
                                    value={[outputSettings.quality]}
                                    onValueChange={(value) => setOutputSettings({ ...outputSettings, quality: value[0] })}
                                    min={1}
                                    max={100}
                                    step={1}
                                    className="w-full"
                                  />
                                  <p className="text-xs text-muted-foreground">
                                    Higher values preserve more detail but increase file size
                                  </p>
                                </div>

                                {/* Max Width */}
                                <div className="space-y-2">
                                  <Label htmlFor="max-width" className="text-xs font-medium">Max Width (px)</Label>
                                  <Input
                                    id="max-width"
                                    type="number"
                                    value={outputSettings.maxWidth}
                                    onChange={(e) => setOutputSettings({ ...outputSettings, maxWidth: parseInt(e.target.value) || 0 })}
                                    className="text-sm"
                                    placeholder="0 = no limit"
                                  />
                                  <p className="text-xs text-muted-foreground">
                                    Set to 0 for no limit
                                  </p>
                                </div>

                                {/* Max Height */}
                                <div className="space-y-2">
                                  <Label htmlFor="max-height" className="text-xs font-medium">Max Height (px)</Label>
                                  <Input
                                    id="max-height"
                                    type="number"
                                    value={outputSettings.maxHeight}
                                    onChange={(e) => setOutputSettings({ ...outputSettings, maxHeight: parseInt(e.target.value) || 0 })}
                                    className="text-sm"
                                    placeholder="0 = no limit"
                                  />
                                  <p className="text-xs text-muted-foreground">
                                    Set to 0 for no limit
                                  </p>
                                </div>

                                {/* Compression */}
                                <div className="space-y-2">
                                  <Label className="text-xs font-medium">Compression</Label>
                                  <Select
                                    value={outputSettings.compression}
                                    onValueChange={(value) => setOutputSettings({ ...outputSettings, compression: value })}
                                  >
                                    <SelectTrigger className="w-full">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="none">None</SelectItem>
                                      <SelectItem value="lossless">Lossless</SelectItem>
                                      <SelectItem value="lossy">Lossy</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                              </div>
                            </div>

                            {/* Preview Section */}
                            <div className="border-t pt-4">
                              <h4 className="text-sm font-semibold mb-3">Size Reduction Preview</h4>
                              <div className="p-3 rounded-lg bg-muted/50 space-y-2">
                                <div className="flex items-center justify-between text-sm">
                                  <span className="text-muted-foreground">Original Total Size</span>
                                  <span className="font-mono font-semibold">
                                    {(selectedFiles.reduce((sum, f) => sum + f.size, 0) / 1024).toFixed(2)} KB
                                  </span>
                                </div>
                                <div className="flex items-center justify-between text-sm">
                                  <span className="text-muted-foreground">Estimated Optimized Size</span>
                                  <span className="font-mono font-semibold text-green-600">
                                    ~{(selectedFiles.reduce((sum, f) => sum + f.size, 0) * (outputSettings.quality / 100) / 1024).toFixed(2)} KB
                                  </span>
                                </div>
                                <div className="flex items-center justify-between text-sm pt-2 border-t">
                                  <span className="text-muted-foreground">Estimated Savings</span>
                                  <span className="font-mono font-semibold text-green-600">
                                    ~{(100 - outputSettings.quality).toFixed(0)}%
                                  </span>
                                </div>
                              </div>
                              <p className="text-xs text-muted-foreground mt-3 italic">
                                Note: Optimization applied during minting. Original files unchanged.
                              </p>
                            </div>

                            {/* Batch Output Information */}
                            <div className="border-t pt-4">
                              <h4 className="text-sm font-semibold mb-3">Batch Minting Cost Estimate</h4>
                              <p className="text-xs text-muted-foreground mb-4">
                                Based on batch size of {collectionConfig.batchSize || 8} items per transaction
                              </p>

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

                              <div className="border-t pt-3 flex justify-between font-semibold">
                                <span>Estimated Total:</span>
                                <span className="font-mono text-primary text-lg">{costEstimate.totalBSV.toFixed(8)} BSV</span>
                              </div>
                            </div>
                          </div>
                        </ScrollArea>
                      </TabsContent>
                    </div>
                    {/* End Tab Content Container */}
                  </Tabs>

                  {/* Fixed Mint Controls at Bottom */}
                  <div className="p-4 border-t bg-background flex-shrink-0">
                    <div className="space-y-4">
                {/* Batch Size Configuration */}
                <div className="mb-4 pb-4 border-b">
                  <div className="flex items-center justify-between mb-2">
                    <Label className="text-xs font-medium">Batch Size</Label>
                    <span className="text-[10px] text-muted-foreground font-mono">
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
                  <p className="text-[10px] text-muted-foreground mt-1.5">
                    Batches improve indexing. View cost breakdown in Output tab.
                  </p>
                </div>

                      <div className="space-y-2">
                        {mintErrors.length > 0 && (
                          <div className="text-xs text-yellow-600 dark:text-yellow-400 flex items-start gap-2 p-2 bg-yellow-50 dark:bg-yellow-950/20 rounded">
                            <AlertCircle className="h-3 w-3 mt-0.5 flex-shrink-0" />
                            <div className="space-y-1">
                              {mintErrors.map((error, idx) => (
                                <div key={idx}>• {error}</div>
                              ))}
                            </div>
                          </div>
                        )}
                        <Button
                          onClick={handleMintCollection}
                          className="w-full"
                          size="lg"
                          disabled={!canMint}
                        >
                          <Coins className="h-4 w-4 mr-2" />
                          Mint Collection ({selectedFiles.length} item{selectedFiles.length !== 1 ? 's' : ''})
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
            )}
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

      {/* Mint Progress Modal */}
      <Dialog open={showMintProgressModal} onOpenChange={setShowMintProgressModal}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {isMinting ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Minting Collection...
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                  Minting Complete
                </>
              )}
            </DialogTitle>
            <DialogDescription>
              {isMinting
                ? `Processing items (${mintProgressItems.length} of ${selectedFiles.length})...`
                : `Successfully processed ${mintProgressItems.length} item${mintProgressItems.length !== 1 ? 's' : ''}`
              }
            </DialogDescription>
          </DialogHeader>

          {/* Progress Bar */}
          {isMinting && (
            <div className="space-y-2">
              <Progress
                value={(mintProgressItems.length / selectedFiles.length) * 100}
                className="h-2"
              />
              <p className="text-xs text-muted-foreground text-center">
                {mintProgressItems.length} of {selectedFiles.length} items
              </p>
            </div>
          )}

          {/* Transaction List */}
          <ScrollArea className="flex-1 min-h-0 pr-4">
            <div className="space-y-2">
              {mintProgressItems.map((item, idx) => (
                <div
                  key={idx}
                  className={`border rounded-lg p-3 flex items-start gap-3 ${
                    item.status === 'success' ? 'bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800' :
                    item.status === 'saved' ? 'bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800' :
                    'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800'
                  }`}
                >
                  {/* Status Icon */}
                  <div className="flex-shrink-0 mt-0.5">
                    {item.status === 'success' ? (
                      <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
                    ) : item.status === 'saved' ? (
                      <Save className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                    ) : (
                      <XCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
                    )}
                  </div>

                  {/* Transaction Details */}
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-medium text-sm">
                        {item.label || `Item ${item.current}`}
                      </span>
                      <span className="text-xs text-muted-foreground font-mono">
                        {item.current}/{item.total}
                      </span>
                    </div>

                    {item.txid && (
                      <div className="flex items-center gap-2">
                        <code className="text-xs font-mono bg-background/50 px-2 py-1 rounded truncate">
                          {item.txid}
                        </code>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 w-6 p-0 flex-shrink-0"
                          onClick={() => {
                            vscode.postMessage({
                              command: 'openTransaction',
                              txid: item.txid
                            });
                          }}
                        >
                          <ExternalLink className="h-3 w-3" />
                        </Button>
                      </div>
                    )}

                    {item.status === 'success' && (
                      <p className="text-xs text-green-600 dark:text-green-400">
                        Broadcasted successfully
                      </p>
                    )}
                    {item.status === 'saved' && (
                      <p className="text-xs text-blue-600 dark:text-blue-400">
                        Saved to transaction cache (auto-broadcast disabled)
                      </p>
                    )}
                    {item.status === 'error' && item.message && (
                      <p className="text-xs text-red-600 dark:text-red-400">
                        {item.message}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>

          <DialogFooter>
            <Button
              onClick={() => setShowMintProgressModal(false)}
              disabled={isMinting}
              className="w-full"
            >
              {isMinting ? 'Minting in progress...' : 'Close'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pipeline Execution Progress Modal */}
      <Dialog open={isPipelineExecuting} onOpenChange={setIsPipelineExecuting}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Layers className="h-5 w-5" />
              Executing Pipeline
            </DialogTitle>
            <DialogDescription>
              Running {pipelineProgress.totalSteps} operation{pipelineProgress.totalSteps !== 1 ? 's' : ''} in sequence
            </DialogDescription>
          </DialogHeader>

          {/* Overall Progress Bar */}
          <div className="space-y-2 px-1">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                Step {pipelineProgress.currentStep} of {pipelineProgress.totalSteps}
              </span>
              <span className="font-medium">
                {pipelineProgress.totalSteps > 0 ? Math.round((pipelineProgress.currentStep / pipelineProgress.totalSteps) * 100) : 0}%
              </span>
            </div>
            <Progress
              value={pipelineProgress.totalSteps > 0 ? (pipelineProgress.currentStep / pipelineProgress.totalSteps) * 100 : 0}
              className="h-2"
            />
          </div>

          <ScrollArea className="flex-1 pr-4 max-h-[50vh]">
            <div className="space-y-3 py-4">
              {pipelineProgress.steps.map((step, index) => (
                <div
                  key={index}
                  className={`flex items-start gap-3 p-3 rounded-lg border ${
                    step.status === 'completed'
                      ? 'bg-green-50 border-green-200 dark:bg-green-950 dark:border-green-800'
                      : step.status === 'in_progress'
                      ? 'bg-blue-50 border-blue-200 dark:bg-blue-950 dark:border-blue-800'
                      : step.status === 'error'
                      ? 'bg-red-50 border-red-200 dark:bg-red-950 dark:border-red-800'
                      : 'bg-muted/30'
                  }`}
                >
                  <div className="flex-shrink-0 mt-0.5">
                    {step.status === 'completed' ? (
                      <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
                    ) : step.status === 'in_progress' ? (
                      <Loader2 className="h-5 w-5 text-blue-600 dark:text-blue-400 animate-spin" />
                    ) : step.status === 'error' ? (
                      <XCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
                    ) : (
                      <div className="h-5 w-5 rounded-full border-2 border-muted-foreground/30" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-medium text-muted-foreground">
                        Step {index + 1}/{pipelineProgress.totalSteps}
                      </span>
                      <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground font-mono">
                        {step.operationType}
                      </span>
                    </div>
                    <p className="text-sm font-medium mb-1">{step.message}</p>
                    {step.filesAffected !== undefined && (
                      <p className="text-xs text-muted-foreground">
                        {step.filesAffected} file{step.filesAffected !== 1 ? 's' : ''} affected
                      </p>
                    )}
                  </div>
                </div>
              ))}

              {pipelineProgress.steps.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" />
                  <p className="text-sm">Initializing pipeline...</p>
                </div>
              )}
            </div>
          </ScrollArea>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setShowLogsModal(true)}
              disabled={executionLogs.length === 0}
            >
              <FileText className="h-4 w-4 mr-2" />
              View Logs
            </Button>
            <Button
              variant="outline"
              onClick={() => setIsPipelineExecuting(false)}
              disabled={pipelineProgress.currentStep < pipelineProgress.totalSteps && pipelineProgress.currentStep > 0}
            >
              {pipelineProgress.currentStep === pipelineProgress.totalSteps ? 'Close' : 'Cancel'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AI Pipeline Configuration Success Modal */}
      <Dialog open={showPipelineSuccessModal} onOpenChange={setShowPipelineSuccessModal}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              Pipeline Configured
            </DialogTitle>
            <DialogDescription asChild>
              <div className="text-sm">
                {pipelineSuccessData && <Response>{pipelineSuccessData.message}</Response>}
              </div>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 max-h-[300px] overflow-y-auto">
            <p className="text-sm font-medium">Pipeline Operations:</p>
            {pipelineSuccessData && pipelineSuccessData.operations.map((op, index) => (
              <div key={index} className="flex items-start gap-2 text-xs p-2 rounded bg-muted/30">
                <span className="font-mono font-medium min-w-[120px]">{op.type}</span>
                {op.scope && <span className="text-muted-foreground">→ {op.scope}</span>}
              </div>
            ))}
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setShowPipelineSuccessModal(false);
                // Config is already updated, just close the modal
              }}
            >
              <Edit className="h-4 w-4 mr-2" />
              Review Pipeline
            </Button>
            <Button
              onClick={() => {
                setShowPipelineSuccessModal(false);
                // Start pipeline execution
                setIsPipelineExecuting(true);
                setPipelineProgress({ currentStep: 0, totalSteps: collectionConfig.pipeline?.operations.length || 0, steps: [] });
                vscode.postMessage({ command: 'executePipeline' });
              }}
            >
              <Layers className="h-4 w-4 mr-2" />
              Run Transformations
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pipeline Execution Logs Modal */}
      <Dialog open={showLogsModal} onOpenChange={setShowLogsModal}>
        <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Pipeline Execution Logs
            </DialogTitle>
            <DialogDescription>
              Detailed execution log for the last pipeline run ({executionLogs.length} entries)
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="flex-1 pr-4">
            <div className="space-y-2 py-4">
              {executionLogs.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No logs available</p>
                </div>
              ) : (
                executionLogs.map((log, index) => (
                  <div
                    key={index}
                    className={`p-3 rounded-lg border text-sm font-mono ${
                      log.level === 'error'
                        ? 'bg-red-50 border-red-200 dark:bg-red-950 dark:border-red-800'
                        : log.level === 'warning'
                        ? 'bg-yellow-50 border-yellow-200 dark:bg-yellow-950 dark:border-yellow-800'
                        : 'bg-muted/30 border-muted'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex-shrink-0">
                        {log.level === 'error' ? (
                          <XCircle className="h-4 w-4 text-red-600 dark:text-red-400 mt-0.5" />
                        ) : log.level === 'warning' ? (
                          <AlertCircle className="h-4 w-4 text-yellow-600 dark:text-yellow-400 mt-0.5" />
                        ) : (
                          <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span>{new Date(log.timestamp).toLocaleTimeString()}</span>
                          <span className={`px-1.5 py-0.5 rounded font-medium ${
                            log.level === 'error'
                              ? 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300'
                              : log.level === 'warning'
                              ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300'
                              : 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
                          }`}>
                            {log.level.toUpperCase()}
                          </span>
                        </div>
                        <p className="text-sm leading-relaxed break-words">{log.message}</p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setExecutionLogs([])}
              disabled={executionLogs.length === 0}
            >
              Clear Logs
            </Button>
            <Button onClick={() => setShowLogsModal(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Notification Dialog (replaces alert()) with markdown support */}
      <AlertDialog open={notificationDialog.open} onOpenChange={(open) => setNotificationDialog({ ...notificationDialog, open })}>
        <AlertDialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle>{notificationDialog.title}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="text-sm">
                <Response>{notificationDialog.message}</Response>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setNotificationDialog({ ...notificationDialog, open: false })}>
              OK
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
    </TooltipProvider>
  );
}
