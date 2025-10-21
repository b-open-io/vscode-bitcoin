# Collections Management Architecture

## Overview

Users can work on multiple NFT collections simultaneously, with each collection maintaining its own state that persists across VSCode sessions.

## Storage Strategy

### Workspace State (Primary)
Store in VSCode workspace state for fast access and automatic cleanup:

```typescript
{
  "collections": {
    "collection-uuid-1": {
      "id": "collection-uuid-1",
      "workspaceFolder": "/path/to/workspace", // Which workspace folder this belongs to
      "config": {
        "name": "Cool Punks",
        "description": "...",
        "quantity": 100,
        "rarityLabels": [...],
        "traits": [...]
      },
      "selectedFolder": "/path/to/images",
      "files": [...], // All loaded files with metadata
      "status": "draft" | "ready" | "minting" | "minted",
      "createdAt": "2025-10-20T...",
      "updatedAt": "2025-10-20T...",
      "mintedTxId": "..." // Collection inscription txid when minted
    },
    "collection-uuid-2": { ... }
  },
  "activeCollectionId": "collection-uuid-1" // Currently open collection
}
```

### Optional File Export
Users can export collection config as JSON for:
- Version control (git)
- Sharing with team
- Backup

```json
// .vscode-bitcoin/collections/my-collection.json
{
  "name": "Cool Punks",
  "description": "...",
  "config": {...},
  "files": [...],
  // Does NOT include actual image data, only paths
}
```

## UI Structure

### 1. Collections Manager Panel (New Top-Level)

```
┌─────────────────────────────────────────────────┐
│  Collections                                     │
├─────────────────────────────────────────────────┤
│  [+ Create New Collection]                       │
│                                                   │
│  📁 Workspace: /project-a                        │
│  ┌──────────────────────────────────────────┐   │
│  │  Cool Punks                      [Draft] │   │
│  │  100 items • 5 traits • 3 rarities       │   │
│  │  Updated 2 hours ago                     │   │
│  │  [Open] [Export] [Delete]                │   │
│  └──────────────────────────────────────────┘   │
│                                                   │
│  ┌──────────────────────────────────────────┐   │
│  │  Cyber Warriors                  [Ready] │   │
│  │  50 items • 8 traits • 4 rarities        │   │
│  │  Updated yesterday                       │   │
│  │  [Open] [Export] [Delete]                │   │
│  └──────────────────────────────────────────┘   │
│                                                   │
│  📁 Workspace: /project-b                        │
│  ┌──────────────────────────────────────────┐   │
│  │  Space Cats                    [Minted]  │   │
│  │  1000 items • 12 traits • 5 rarities     │   │
│  │  Minted 3 days ago                       │   │
│  │  TxID: abc123...                         │   │
│  │  [View] [Export]                         │   │
│  └──────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

### 2. Collection Minter Panel (Modified)

Now receives a `collectionId` parameter and auto-saves all changes:

```typescript
// Open specific collection
CollectionMinterPanel.show(vault, extensionUri, collectionId);

// Create new collection
const newId = generateUUID();
CollectionMinterPanel.show(vault, extensionUri, newId);
```

**Auto-save behavior:**
- Every config change → save to workspace state
- Every file selection → save
- Every trait assignment → save
- Debounced (500ms) to avoid excessive writes

**State restoration:**
- On panel open → load from workspace state
- All tabs restore to previous state
- Can close/reopen without losing work

## Implementation Plan

### Phase 1: State Persistence
- [ ] Add workspace state service
- [ ] Modify CollectionMinter to accept collectionId
- [ ] Auto-save on all state changes
- [ ] Restore state on panel open

### Phase 2: Collections Manager
- [ ] Create CollectionsManagerPanel
- [ ] List all collections from workspace state
- [ ] Group by workspace folder
- [ ] Create/Delete collection operations
- [ ] Export collection config to JSON

### Phase 3: Multi-Workspace Support
- [ ] Detect all workspace folders
- [ ] Show collections grouped by folder
- [ ] Handle workspace folder add/remove events

### Phase 4: Import/Export
- [ ] Export collection config to JSON file
- [ ] Import collection config from JSON
- [ ] Smart path resolution for imported files

## File Structure

```
src/
  services/
    collectionsStateService.ts    # Workspace state CRUD
  views/
    collectionsManager/
      index.tsx                    # Manager panel (backend)
    collectionMinter/
      index.tsx                    # Minter panel (modified)
    webview/
      src/
        panels/
          CollectionsManagerPanel.tsx
          CollectionMinterPanel.tsx (modified)
```

## API Surface

### CollectionsStateService

```typescript
class CollectionsStateService {
  // CRUD
  async createCollection(workspaceFolder: string): Promise<string>
  async getCollection(id: string): Promise<Collection | null>
  async updateCollection(id: string, updates: Partial<Collection>): Promise<void>
  async deleteCollection(id: string): Promise<void>

  // List
  async listCollections(): Promise<Collection[]>
  async listCollectionsByWorkspace(folder: string): Promise<Collection[]>

  // Active
  async getActiveCollectionId(): Promise<string | null>
  async setActiveCollectionId(id: string): Promise<void>

  // Export/Import
  async exportCollection(id: string, filePath: string): Promise<void>
  async importCollection(filePath: string, workspaceFolder: string): Promise<string>
}
```

### Collection Type

```typescript
interface Collection {
  id: string;
  workspaceFolder: string;
  config: CollectionConfig;
  selectedFolder: string | null;
  files: CollectionFile[];
  status: 'draft' | 'ready' | 'minting' | 'minted';
  createdAt: string;
  updatedAt: string;
  mintedTxId?: string;
}

type CollectionStatus =
  | 'draft'      // Not ready to mint
  | 'ready'      // Config complete, ready to mint
  | 'minting'    // Currently minting
  | 'minted';    // Successfully minted
```

## User Flows

### Creating a New Collection

1. User clicks "Create New Collection" in Collections Manager
2. Collections Manager generates new UUID
3. Opens Collection Minter with new ID
4. User configures collection (auto-saves to workspace state)
5. User can close panel anytime
6. Reopen from Collections Manager to continue

### Working on Multiple Collections

1. User has multiple workspace folders open in VSCode
2. Collections Manager shows all collections grouped by folder
3. User can switch between collections
4. Each collection maintains independent state

### Minting a Collection

1. User opens collection from Collections Manager
2. Completes all steps in Collection Minter
3. Clicks "Mint Collection"
4. Status changes to "minting" → "minted"
5. Collection record updated with txId
6. Collections Manager shows minted status

## Migration Path

For existing Collection Minter users (if any):
- First open: Detect no collectionId → create new collection
- Import from old state if exists
- Future opens: use Collections Manager

## Benefits

✅ **Never lose work** - Auto-save on every change
✅ **Multiple collections** - Work on many projects simultaneously
✅ **Organized workspace** - Group by workspace folder
✅ **Shareable configs** - Export/import JSON files
✅ **Clear status** - Draft → Ready → Minting → Minted
✅ **Resume anytime** - Close and reopen without losing context
