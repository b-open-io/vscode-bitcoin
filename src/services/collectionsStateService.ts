import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import vsApi from '../vsShim';

export interface Collection {
  id: string;
  config: {
    name: string;
    description: string;
    quantity: number;
    rarityLabels: Array<{ label: string; percentage: string }>;
    traits: Array<{
      name: string;
      values: string[];
      occurancePercentages: string[];
    }>;
    folderStructure?: 'flat' | 'one-level' | 'two-level';
    traitMapping?: {
      level1TraitName: string;
      level2TraitName: string;
    };
    batchSize?: number;
  };
  selectedFolder: string | null;
  files: Array<{
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
      traits?: Array<{ name: string; value: string }>;
      rarityLabel?: string;
      rank?: number;
      mintNumber?: number;
    };
  }>;
  status: 'draft' | 'ready' | 'minting' | 'minted';
  createdAt: string;
  updatedAt: string;
  mintedTxId?: string;
  mintedItemCount?: number;
}

interface CollectionIndexEntry extends Omit<Collection, 'files'> {
  selectedFilesCount: number; // Cached count for performance
}

interface CollectionsIndex {
  collections: { [id: string]: CollectionIndexEntry }; // Files stored separately for performance
  activeCollectionId: string | null;
  lastUpdate: number;
}

/**
 * Global collections state service using bitcoin workspace path
 * Follows same pattern as TxCache for consistency
 *
 * Storage: ~/.bitcoin/collections/ (or configured path)
 * - index.json: Collection metadata (without files for performance)
 * - {collection-id}.json: Full collection data including files
 */
export class CollectionsStateService {
  private collectionsDir: string;
  private indexFile: string;
  private index: CollectionsIndex;

  constructor(workspaceRoot?: string) {
    const bitcoinDir = this.getBitcoinDirectory(workspaceRoot);
    this.collectionsDir = path.join(bitcoinDir, 'collections');
    this.indexFile = path.join(this.collectionsDir, 'index.json');

    console.log('[CollectionsState] Initializing with paths:', {
      bitcoinDir,
      collectionsDir: this.collectionsDir,
      indexFile: this.indexFile
    });

    this.ensureDirectories();
    this.index = this.loadIndex();
    console.log('[CollectionsState] Loaded index:', {
      collectionCount: Object.keys(this.index.collections).length,
      activeId: this.index.activeCollectionId
    });
  }

  private getBitcoinDirectory(workspaceRoot?: string): string {
    const config = vsApi.workspace.getConfiguration('bitcoin');
    const bitcoinPath = config.get<string>('workspace.path') || '.bitcoin';

    // If workspaceRoot explicitly provided, use it
    if (workspaceRoot) {
      return path.join(workspaceRoot, bitcoinPath);
    }

    // Check if user wants project-level storage
    const useProjectLevel = config.get<boolean>('storage.useProjectLevel') || false;

    if (useProjectLevel && vsApi?.workspace?.workspaceFolders?.length) {
      const wsRoot = vsApi.workspace.workspaceFolders[0].uri.fsPath;
      return path.join(wsRoot, bitcoinPath);
    }

    // Default: Global user-level storage (like tx cache)
    const homeDir = process.env.HOME || process.env.USERPROFILE || '.';
    return path.join(homeDir, bitcoinPath);
  }

  private ensureDirectories(): void {
    if (!fs.existsSync(this.collectionsDir)) {
      fs.mkdirSync(this.collectionsDir, { recursive: true });
    }
  }

  private getCollectionFilePath(id: string): string {
    return path.join(this.collectionsDir, `${id}.json`);
  }

  private loadIndex(): CollectionsIndex {
    try {
      if (fs.existsSync(this.indexFile)) {
        const data = fs.readFileSync(this.indexFile, 'utf-8');
        return JSON.parse(data);
      }
    } catch (error) {
      console.error('[CollectionsState] Failed to load index:', error);
    }

    return {
      collections: {},
      activeCollectionId: null,
      lastUpdate: Date.now()
    };
  }

  private saveIndex(): void {
    try {
      this.index.lastUpdate = Date.now();
      fs.writeFileSync(this.indexFile, JSON.stringify(this.index, null, 2), 'utf-8');
    } catch (error) {
      console.error('[CollectionsState] Failed to save index:', error);
    }
  }

  // ============================================================================
  // PUBLIC API - CRUD
  // ============================================================================

  /**
   * Create a new collection with default values
   */
  createCollection(): string {
    const id = randomUUID();
    const now = new Date().toISOString();

    const collection: Collection = {
      id,
      config: {
        name: '',
        description: '',
        quantity: 0,
        rarityLabels: [],
        traits: []
      },
      selectedFolder: null,
      files: [],
      status: 'draft',
      createdAt: now,
      updatedAt: now
    };

    // Save full collection data
    this.saveCollection(collection);

    // Update index (without files, but with count)
    const { files, ...metadata } = collection;
    this.index.collections[id] = {
      ...metadata,
      selectedFilesCount: files.filter(f => f.selected).length
    };
    this.index.activeCollectionId = id;
    this.saveIndex();

    console.log(`[CollectionsState] Created collection: ${id}`);
    return id;
  }

  /**
   * Get full collection data including files
   */
  getCollection(id: string): Collection | null {
    try {
      const filePath = this.getCollectionFilePath(id);
      if (!fs.existsSync(filePath)) {
        console.warn(`[CollectionsState] Collection file not found: ${id}`);
        return null;
      }

      const data = fs.readFileSync(filePath, 'utf-8');
      const collection: Collection = JSON.parse(data);

      // Update last accessed in index
      if (this.index.collections[id]) {
        this.saveIndex();
      }

      return collection;
    } catch (error) {
      console.error(`[CollectionsState] Failed to load collection ${id}:`, error);
      return null;
    }
  }

  /**
   * Update collection (merges with existing data)
   * Auto-updates status based on completion
   */
  updateCollection(id: string, updates: Partial<Collection>): void {
    const existing = this.getCollection(id);
    if (!existing) {
      console.warn(`[CollectionsState] Cannot update non-existent collection: ${id}`);
      return;
    }

    // Merge updates
    const updated: Collection = {
      ...existing,
      ...updates,
      id, // Ensure ID doesn't change
      updatedAt: new Date().toISOString()
    };

    // Auto-determine status if not explicitly set
    if (!updates.status) {
      updated.status = this.determineStatus(updated);
    }

    // Save full collection
    this.saveCollection(updated);

    // Update index metadata (with cached file count)
    const { files, ...metadata } = updated;
    this.index.collections[id] = {
      ...metadata,
      selectedFilesCount: files.filter(f => f.selected).length
    };
    this.saveIndex();

    console.log(`[CollectionsState] Updated collection: ${id}, status: ${updated.status}`);
  }

  /**
   * Delete collection and its file
   */
  deleteCollection(id: string): boolean {
    try {
      const filePath = this.getCollectionFilePath(id);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      delete this.index.collections[id];

      // Clear active if it was this collection
      if (this.index.activeCollectionId === id) {
        this.index.activeCollectionId = null;
      }

      this.saveIndex();
      console.log(`[CollectionsState] Deleted collection: ${id}`);
      return true;
    } catch (error) {
      console.error(`[CollectionsState] Failed to delete collection ${id}:`, error);
      return false;
    }
  }

  // ============================================================================
  // PUBLIC API - LIST & QUERY
  // ============================================================================

  /**
   * List all collections (metadata only, no files)
   * Sorted by most recently updated
   */
  listCollections(): Array<Omit<Collection, 'files'>> {
    return Object.values(this.index.collections)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  /**
   * Get collection count
   */
  getCollectionCount(): number {
    return Object.keys(this.index.collections).length;
  }

  /**
   * Get collections by status
   */
  getCollectionsByStatus(status: Collection['status']): Array<Omit<Collection, 'files'>> {
    return this.listCollections().filter(c => c.status === status);
  }

  // ============================================================================
  // PUBLIC API - ACTIVE COLLECTION
  // ============================================================================

  /**
   * Get active collection ID
   */
  getActiveCollectionId(): string | null {
    return this.index.activeCollectionId;
  }

  /**
   * Set active collection
   */
  setActiveCollectionId(id: string | null): void {
    if (id && !this.index.collections[id]) {
      console.warn(`[CollectionsState] Cannot set active: collection ${id} doesn't exist`);
      return;
    }

    this.index.activeCollectionId = id;
    this.saveIndex();
    console.log(`[CollectionsState] Set active collection: ${id}`);
  }

  // ============================================================================
  // PUBLIC API - IMPORT/EXPORT
  // ============================================================================

  /**
   * Export collection to external JSON file
   */
  exportCollection(id: string, exportPath: string): boolean {
    try {
      const collection = this.getCollection(id);
      if (!collection) {
        return false;
      }

      // Create export-friendly version (strip dataUrl to reduce size)
      const exportData = {
        ...collection,
        files: collection.files.map(({ dataUrl, ...file }) => file)
      };

      fs.writeFileSync(exportPath, JSON.stringify(exportData, null, 2), 'utf-8');
      console.log(`[CollectionsState] Exported collection ${id} to ${exportPath}`);
      return true;
    } catch (error) {
      console.error(`[CollectionsState] Failed to export collection ${id}:`, error);
      return false;
    }
  }

  /**
   * Import collection from external JSON file
   * Returns new collection ID
   */
  importCollection(importPath: string): string | null {
    try {
      const data = fs.readFileSync(importPath, 'utf-8');
      const imported = JSON.parse(data) as Collection;

      // Generate new ID and timestamps
      const id = randomUUID();
      const now = new Date().toISOString();

      const collection: Collection = {
        ...imported,
        id, // New ID
        createdAt: now,
        updatedAt: now,
        status: 'draft', // Reset to draft on import
        mintedTxId: undefined // Clear minted status
      };

      this.saveCollection(collection);

      // Update index
      const { files, ...metadata } = collection;
      this.index.collections[id] = {
        ...metadata,
        selectedFilesCount: files.filter(f => f.selected).length
      };
      this.saveIndex();

      console.log(`[CollectionsState] Imported collection as ${id}`);
      return id;
    } catch (error) {
      console.error(`[CollectionsState] Failed to import collection:`, error);
      return null;
    }
  }

  // ============================================================================
  // HELPERS
  // ============================================================================

  private saveCollection(collection: Collection): void {
    try {
      const filePath = this.getCollectionFilePath(collection.id);

      // Strip dataUrl from files to reduce size (images loaded on-demand)
      // This prevents saving potentially hundreds of megabytes of base64 data
      const collectionToSave = {
        ...collection,
        files: collection.files.map(({ dataUrl, ...file }) => file)
      };

      fs.writeFileSync(filePath, JSON.stringify(collectionToSave, null, 2), 'utf-8');
    } catch (error) {
      console.error(`[CollectionsState] Failed to save collection ${collection.id}:`, error);
      throw error;
    }
  }

  /**
   * Auto-determine collection status based on completion
   */
  private determineStatus(collection: Collection): Collection['status'] {
    // If already minted, keep that status
    if (collection.mintedTxId) {
      return 'minted';
    }

    // Check if ready to mint
    const hasName = !!collection.config.name;
    const hasDescription = !!collection.config.description;
    const hasFiles = collection.files.some(f => f.selected);

    if (hasName && hasDescription && hasFiles) {
      return 'ready';
    }

    return 'draft';
  }

  /**
   * Get collections directory path
   */
  getCollectionsDir(): string {
    return this.collectionsDir;
  }
}

// Singleton instance
export const collectionsState = new CollectionsStateService();
