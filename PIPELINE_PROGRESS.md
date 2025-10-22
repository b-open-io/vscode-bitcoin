# Collection Minter Pipeline System - Progress Report

## ✅ COMPLETED

### 1. UI Improvements
- **Hierarchical folder tree** in BEFORE panel (CollectionMinterPanel.tsx:1412-1561)
  - Shows proper nesting with indentation
  - Displays folder/file counts
  - Recursive TreeNode component
  - Visual parent-child relationships

- **Icon buttons** replacing large buttons
  - Added Plus icon import
  - "Add Rename Pattern" moved to small icon button in header (line 1653-1669)

### 2. Backend Pipeline System
- **TypeScript types** defined (index.tsx:71-123):
  ```typescript
  - PipelineOperation: exclude | move | rename-folder | transform
  - Pipeline: { operations[], reasoning, warnings }
  - FolderNode: hierarchical tree structure
  - PipelineSimulationResult: step-by-step results
  ```

- **Tree builder** (index.tsx:1351-1413):
  - `buildFolderTree()` converts flat files to hierarchical tree
  - Properly handles nested folders
  - Sorts folders first, then files alphabetically

- **Pipeline simulator** (index.tsx:1415-1591):
  - `simulatePipeline()` executes operations sequentially
  - Tracks file state at each step
  - Returns detailed step-by-step results
  - Shows structure changes after each operation

- **AI Tool** (index.tsx:2083-2149):
  - `simulatePipeline` tool for AI testing
  - Accepts array of pipeline operations
  - Returns step-by-step preview
  - Allows iterative refinement

- **Hierarchical structure sent to AI** (index.tsx:2047-2070):
  - `buildFolderTree()` creates tree from files
  - `renderTree()` visualizes structure with emoji icons
  - AI receives tree visualization showing folder nesting
  - Example: `📁 items/ → 📁 sword/ → 📄 red.png`
  - Also sends sample flat paths for reference

### 3. Design Documentation
- PIPELINE_DESIGN.md - Complete system architecture
- PIPELINE_PROGRESS.md - This progress report
- Pipeline operations spec
- Simulation tool spec
- AI interaction patterns

## ⏳ REMAINING WORK

### 1. Complete UI Transformation (HIGH PRIORITY)
**Goal**: Dynamic pipeline builder instead of fixed steps

**Current state**: Still has "Step 1: Rename Patterns", "Step 2: Folder Structure", etc.

**Target state**:
```
┌─ Pipeline Operations ────────────────────┐ [+]
│                                            │
│ [≡][↑][↓] 1. Exclude .DS_Store files      │ [🗑]
│ [≡][↑][↓] 2. Rename folders: char1→warrior│ [🗑]
│ [≡][↑][↓] 3. Transform: Remove prefix nft_│ [🗑]
│ [≡][↑][↓] 4. Standardize names: {itemName}│ [🗑]
└────────────────────────────────────────────┘
```

**Changes needed**:
1. Remove "Step 1, Step 2" labels
2. Add drag handle ([≡]) to each operation
3. Add up/down buttons ([↑][↓]) for reordering
4. Add delete button ([🗑]) to each operation
5. Move "Add" buttons to section headers as small icons
6. Create "Add Pipeline Operation" dropdown menu:
   - Exclude files
   - Move files
   - Rename folder
   - Transform (rename patterns)
   - Name standardization

### 2. ✅ ~~Send Hierarchical Structure to AI~~ COMPLETED
**Status**: DONE - AI now receives visual tree structure with emoji icons

### 3. Update AI Output Schema
**Current**: AI returns old config format
```typescript
const configSchema = z.object({
  folderStructure: z.enum([...]),
  renamePatterns: z.array(...),
  // ...
});
```

**Target**: AI returns Pipeline
```typescript
const pipelineSchema = z.object({
  operations: z.array(z.union([
    z.object({ type: z.literal('exclude'), ... }),
    z.object({ type: z.literal('move'), ... }),
    z.object({ type: z.literal('rename-folder'), ... }),
    z.object({ type: z.literal('transform'), ... })
  ])),
  reasoning: z.string(),
  warnings: z.array(z.string()).optional()
});
```

### 4. Update AI System Prompt
**Current**: Asks for config with folderStructure, renamePatterns, etc.

**Target**: Ask for Pipeline
- Explain pipeline operations
- Emphasize restructuring capabilities
- Show example pipelines
- Explain operation order matters

### 5. Display Pipeline in UI
**Current**: Shows old config fields (rename patterns, folder mapping, etc.)

**Target**: Shows pipeline operations as ordered list
- Numbered list (1, 2, 3...)
- Each operation shows:
  - Operation type icon
  - Human-readable description
  - Drag handle for reordering
  - Up/Down buttons
  - Delete button
  - Expand/collapse for details

### 6. Pipeline Execution Engine
**File**: index.tsx

**Need**: Method to actually apply pipeline to files
```typescript
private async executePipeline(
  files: CollectionFile[],
  pipeline: Pipeline
): Promise<{
  transformedFiles: CollectionFile[],
  excludedFiles: string[],
  report: string
}>
```

### 7. Integrate with File Processing
**Current**: Uses old config (renamePatterns, nameStandardization, etc.)

**Target**: Use pipeline operations
- When user clicks "Apply Structure Mapping"
- Execute pipeline on actual files
- Create transformed duplicates in workspace
- Update file metadata
- Show before/after comparison

### 8. Testing
- Test with flat folder structure
- Test with one-level folders (items with variants)
- Test with two-level folders (category/item/variants)
- Test with messy filenames needing cleanup
- Test AI pipeline generation with real collections

## PRIORITY ORDER

1. ✅ **AI Input**: Send hierarchical tree instead of flat paths - DONE
2. ⏳ **AI Output**: Update schema to return Pipeline (30 min) - NEXT
3. ⏳ **UI**: Display pipeline as ordered list (1 hour)
4. ⏳ **Backend**: Pipeline execution engine (1 hour)
5. ⏳ **Integration**: Connect pipeline to file processing (30 min)
6. ⏳ **Testing**: Test with real collections (ongoing)

## FILES TO MODIFY

1. `/Users/satchmo/code/vscode-bitcoin/src/views/webview/src/panels/CollectionMinterPanel.tsx`
   - Complete icon button refactor
   - Build pipeline operations UI
   - Add drag-and-drop (future)

2. `/Users/satchmo/code/vscode-bitcoin/src/views/collectionMinter/index.tsx`
   - Update `autoConfigureStructureMappings()` to send tree
   - Update AI schema to Pipeline
   - Update AI prompt
   - Build pipeline execution engine
   - Integrate with existing file processing

## STATUS SUMMARY

✅ **Foundation Complete**:
- Pipeline types defined
- Tree builder working
- Pipeline simulator with step-by-step tracking
- AI tool for testing pipelines
- Hierarchical structure sent to AI
- UI shows proper folder nesting

⏳ **Next Steps**:
1. Update AI schema to return Pipeline (not old config)
2. Build dynamic pipeline UI
3. Pipeline execution engine
4. Testing

**Ready for**: AI schema update and pipeline UI development
