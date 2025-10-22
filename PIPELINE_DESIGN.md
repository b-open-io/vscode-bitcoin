# Collection Minter Pipeline System Design

## Problem Statement

The AI needs to:
1. **See** the actual folder hierarchy (not flat paths)
2. **Propose** restructuring operations (move files, rename folders, exclude files)
3. **Configure** transformations (rename patterns, name standardization)
4. **Test** the complete pipeline before committing
5. **Return** a structured pipeline that can be executed step-by-step

## Pipeline Operations

### 1. File Operations (Restructuring)
```typescript
type FileOperation =
  | { type: 'move', from: string, to: string }      // Move file to different path
  | { type: 'exclude', path: string, reason: string } // Exclude file from collection
  | { type: 'rename-folder', from: string, to: string } // Rename a folder
```

### 2. Transformation Operations
```typescript
type TransformOperation = {
  type: 'transform',
  scope: string | 'all',  // Apply to specific folder or all files
  renamePatterns?: RenamePattern[],
  nameStandardization?: NameStandardization
}
```

### 3. Complete Pipeline
```typescript
type Pipeline = {
  operations: Array<FileOperation | TransformOperation>,
  reasoning: string,  // Explain the overall strategy
  warnings?: string[] // Warn about potential issues
}
```

## AI Tool: simulatePipeline

```typescript
simulatePipeline({
  operations: [
    // Step 1: Exclude non-image files
    { type: 'exclude', path: 'items/.DS_Store', reason: 'System file' },

    // Step 2: Rename folders for clarity
    { type: 'rename-folder', from: 'items/char1', to: 'items/warrior' },

    // Step 3: Move misplaced files
    { type: 'move', from: 'items/sword.png', to: 'items/warrior/sword.png' },

    // Step 4: Apply transformations to specific folders
    {
      type: 'transform',
      scope: 'items/warrior',
      renamePatterns: [
        { type: 'prefix-remove', pattern: 'char1_' }
      ],
      nameStandardization: {
        enabled: true,
        template: '{itemName}'
      }
    },

    // Step 5: Global cleanup
    {
      type: 'transform',
      scope: 'all',
      renamePatterns: [
        { type: 'suffix-remove', pattern: '_final' }
      ]
    }
  ]
})
```

Returns:
```typescript
{
  success: true,
  preview: [
    {
      originalPath: 'items/char1/char1_sword_final.png',
      finalPath: 'items/warrior/warrior.png',
      steps: [
        'Folder renamed: char1 → warrior',
        'Removed prefix: char1_',
        'Removed suffix: _final',
        'Standardized name: {itemName}'
      ]
    }
  ],
  structure: {
    before: {/* tree */},
    after: {/* tree */}
  }
}
```

## Folder Hierarchy Format for AI

Instead of sending flat paths, send structured hierarchy:

```typescript
type FolderNode = {
  name: string,
  type: 'folder' | 'file',
  path: string,
  children?: FolderNode[]
}

// Example:
{
  name: 'items',
  type: 'folder',
  path: 'items',
  children: [
    {
      name: 'sword',
      type: 'folder',
      path: 'items/sword',
      children: [
        { name: 'red.png', type: 'file', path: 'items/sword/red.png' },
        { name: 'blue.png', type: 'file', path: 'items/sword/blue.png' }
      ]
    },
    {
      name: 'shield',
      type: 'folder',
      path: 'items/shield',
      children: [
        { name: 'gold.png', type: 'file', path: 'items/shield/gold.png' }
      ]
    }
  ]
}
```

## Implementation Plan

1. **Build folder hierarchy from file list**
   - Create utility function `buildFolderTree(files: FileItem[]): FolderNode`

2. **Update BEFORE panel UI**
   - Recursive component to render nested folders with proper indentation
   - Visually show parent-child relationships

3. **Send hierarchy to AI**
   - Serialize `FolderNode` tree to JSON
   - Include in AI prompt

4. **Create pipeline simulation tool**
   - Execute operations in order
   - Track transformations at each step
   - Return before/after comparison

5. **Update AI prompt**
   - Ask for pipeline instead of config
   - Explain pipeline operations
   - Emphasize iterative testing with simulatePipeline

6. **Execute pipeline**
   - Apply file operations (move/rename/exclude)
   - Apply transformations
   - Update UI to show results

## Example AI Response

```json
{
  "pipeline": {
    "operations": [
      {
        "type": "exclude",
        "path": ".DS_Store",
        "reason": "System file"
      },
      {
        "type": "transform",
        "scope": "all",
        "renamePatterns": [
          { "type": "prefix-remove", "pattern": "nft-" },
          { "type": "suffix-remove", "pattern": "_final" }
        ],
        "nameStandardization": {
          "enabled": true,
          "template": "{itemName}"
        }
      }
    ],
    "reasoning": "Files have consistent nft- prefix and _final suffix that should be removed. Folders represent item names with variants inside.",
    "warnings": [
      "Some files have very long names - consider shortening manually"
    ]
  }
}
```

## Benefits

1. **AI can restructure** - Not limited to just renaming
2. **Clear hierarchy** - AI understands folder relationships
3. **Testable** - simulatePipeline lets AI iterate
4. **Explainable** - Each operation has clear purpose
5. **Flexible** - Can mix file ops and transformations
6. **Scoped transforms** - Different rules for different folders
