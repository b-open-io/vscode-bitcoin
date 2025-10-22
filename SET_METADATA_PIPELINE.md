# Set-Metadata Pipeline Operation

## Overview

Added a new `set-metadata` pipeline operation that allows the AI structure analysis (Step 4: Transform) to set item metadata including name, rarity, and traits. This enables the AI to handle initial rarity assignments based on semantic analysis of filenames and folder structure.

## Problem Solved

**Before**: The AI on Step 4 could only transform filenames and folder structure. Rarity and trait assignments had to be done manually in Step 3 (Traits) after running the pipeline.

**After**: The AI can now set metadata directly in the pipeline, allowing semantic rarity rules like:
- "golden apple" → Legendary (has "golden" indicator)
- "bacon" → Common (simple food item)
- "diamond sword" → Legendary (has "diamond" indicator)

## What Was Added

### 1. New Pipeline Operation Type (src/views/collectionMinter/index.tsx:124-134)

```typescript
| {
    type: 'set-metadata';
    target: string; // Specific file path (e.g., 'Items/golden_apple.png')
    metadata: {
      name?: string; // Set item name
      rarityLabel?: string; // Set rarity
      traits?: Array<{ name: string; value: string }>; // Set or add traits
      description?: string; // Set description
    };
    reason?: string;
  }
| {
    type: 'rename-file';
    target: string; // Exact file path to rename
    newName: string; // New filename (without path)
    reason?: string;
  }
```

### 2. AI Schema Definition (src/views/collectionMinter/index.tsx:2033-2046)

Added to the Zod schema so AI can generate these operations:

```typescript
z.object({
  type: z.literal('set-metadata'),
  target: z.string().describe('Exact file path to modify (e.g., "Items/golden_apple.png")'),
  metadata: z.object({
    name: z.string().optional().describe('Set item name'),
    rarityLabel: z.string().optional().describe('Set rarity label'),
    traits: z.array(z.object({
      name: z.string(),
      value: z.string()
    })).optional().describe('Set or add traits'),
    description: z.string().optional().describe('Set item description')
  }).describe('Metadata to set for this specific item'),
  reason: z.string().optional().describe('Why this metadata needs to be set')
})
```

### 3. AI Prompt Documentation (src/views/collectionMinter/index.tsx:2130-2135)

```
6. **set-metadata** - Set item metadata (name, rarity, traits)
   - {type: 'set-metadata', target: 'items/golden_apple.png', metadata: {name: 'Golden Apple', rarityLabel: 'Legendary'}, reason: 'This item has special golden modifier'}
   - {type: 'set-metadata', target: 'items/bacon.png', metadata: {name: 'Bacon', rarityLabel: 'Common', traits: [{name: 'Type', value: 'Food'}]}, reason: 'Simple food item'}
   - Use for: Setting initial rarity/traits based on semantic analysis of filename/folder
   - **CRITICAL**: Apply semantic rarity rules here! "golden X" = Legendary, "diamond X" = Legendary, plain items = Common
   - Can set: name (display name), rarityLabel (rarity tier), traits (array of {name, value}), description
```

### 4. Execution Logic (src/views/collectionMinter/index.tsx:2842-2881)

Handles the actual metadata setting during pipeline execution:

```typescript
case 'set-metadata': {
  // Set metadata for a specific file
  const affectedFiles = files.map(f => {
    const relativePath = this.getRelativePath(f.path);
    const targetPath = operation.target.startsWith('/') ? operation.target.slice(1) : operation.target;

    if (relativePath === targetPath || f.path.endsWith(targetPath)) {
      filesAffected++;

      // Merge new metadata with existing, preserving existing values not being updated
      const updatedMetadata = { ...f.metadata };

      if (operation.metadata.name) {
        updatedMetadata.name = operation.metadata.name;
      }
      if (operation.metadata.rarityLabel) {
        updatedMetadata.rarityLabel = operation.metadata.rarityLabel;
      }
      if (operation.metadata.description) {
        updatedMetadata.description = operation.metadata.description;
      }
      if (operation.metadata.traits) {
        // Merge traits - replace traits with same name, add new ones
        const existingTraits = updatedMetadata.traits || [];
        const newTraits = operation.metadata.traits;

        updatedMetadata.traits = [
          ...existingTraits.filter(et => !newTraits.some(nt => nt.name === et.name)),
          ...newTraits
        ];
      }

      log(`Set metadata for ${relativePath}: ${operation.metadata.name ? `name="${operation.metadata.name}"` : ''} ${operation.metadata.rarityLabel ? `rarity="${operation.metadata.rarityLabel}"` : ''} ${operation.metadata.traits ? `traits=[${operation.metadata.traits.map(t => `${t.name}:${t.value}`).join(', ')}]` : ''}`);

      return { ...f, metadata: updatedMetadata };
    }
    return f;
  });
  return { files: affectedFiles, excluded, filesAffected };
}
```

### 5. Simulation Logic (src/views/collectionMinter/index.tsx:1664-1680)

Shows preview of metadata changes in the AFTER panel:

```typescript
} else if (operation.type === 'set-metadata') {
  // Set metadata for specific file
  const targetPath = operation.target.startsWith('/') ? operation.target.slice(1) : operation.target;
  fileStates.forEach(state => {
    if (!state.excluded && (state.currentPath === targetPath || state.currentPath.endsWith(targetPath))) {
      const metaParts: string[] = [];
      if (operation.metadata.name) metaParts.push(`name="${operation.metadata.name}"`);
      if (operation.metadata.rarityLabel) metaParts.push(`rarity="${operation.metadata.rarityLabel}"`);
      if (operation.metadata.traits) metaParts.push(`traits=[${operation.metadata.traits.map(t => `${t.name}:${t.value}`).join(', ')}]`);
      state.transformations.push(`Set metadata: ${metaParts.join(', ')}`);
      changes.push({
        originalPath: state.originalPath,
        newPath: state.currentPath,
        action: 'transformed'
      });
    }
  });
}
```

### 6. Added `rename-file` Operation

Also added the missing `rename-file` operation type that was referenced in the prompt but not in the TypeScript type definition or execution logic.

## How It Works

### Example AI Pipeline

The AI can now generate pipelines like this:

```json
{
  "operations": [
    {
      "type": "exclude",
      "path": "**/.DS_Store",
      "reason": "System files"
    },
    {
      "type": "set-metadata",
      "target": "Food/golden_apple.png",
      "metadata": {
        "name": "Golden Apple",
        "rarityLabel": "Legendary",
        "traits": [
          {"name": "Type", "value": "Food"},
          {"name": "Special", "value": "Golden"}
        ]
      },
      "reason": "Golden modifier indicates legendary rarity"
    },
    {
      "type": "set-metadata",
      "target": "Food/bacon.png",
      "metadata": {
        "name": "Bacon",
        "rarityLabel": "Common",
        "traits": [
          {"name": "Type", "value": "Food"}
        ]
      },
      "reason": "Simple food item with no rarity indicators"
    },
    {
      "type": "transform",
      "scope": "all",
      "renamePatterns": [
        {"type": "prefix-remove", "pattern": "nft_"}
      ],
      "reason": "Clean up filename prefixes"
    }
  ],
  "reasoning": "Applied semantic rarity analysis to food items based on modifiers"
}
```

### Execution Flow

1. **User runs "Auto-Configure with AI" in Transform tab**
2. **AI analyzes file structure and names**
3. **AI generates pipeline with `set-metadata` operations**
4. **Pipeline preview shows metadata changes**
5. **User approves and executes pipeline**
6. **Files copied to workspace with metadata set**
7. **Review & Mint tab shows items with correct rarities**

## Benefits

### 1. Automated Rarity Assignment

The AI can apply semantic rules directly in the pipeline:
- "golden X" → Legendary
- "diamond X" → Legendary
- "bacon" → Common
- "apple" → Common

### 2. Single-Step Configuration

Before:
1. Run pipeline to clean up filenames
2. Manually assign rarities in Traits tab
3. Or run AI rarity assignment separately

After:
1. Run AI pipeline configuration (includes rarity assignments)
2. Done!

### 3. Semantic Context

The AI sees the full file structure and can make better decisions about rarity based on:
- Filename keywords ("golden", "diamond", etc.)
- Folder structure (items in "legendary/" folder)
- Naming patterns (numbered series, etc.)

### 4. Logging and Transparency

All metadata changes are logged:
```
[Pipeline] Set metadata for Food/golden_apple.png: name="Golden Apple" rarity="Legendary" traits=[Type:Food, Special:Golden]
[Pipeline] Set metadata for Food/bacon.png: name="Bacon" rarity="Common" traits=[Type:Food]
```

## User Experience

### Transform Tab (Step 4)

**BEFORE Preview:**
```
📁 Food/
  📄 golden_apple.png
  📄 bacon.png
```

**Pipeline Operations:**
1. Set metadata: Food/golden_apple.png (Golden modifier indicates legendary rarity)
2. Set metadata: Food/bacon.png (Simple food item)

**AFTER Preview:**
```
📁 Food/
  📄 golden_apple.png
    ✨ Set metadata: name="Golden Apple", rarity="Legendary", traits=[Type:Food]
  📄 bacon.png
    ✨ Set metadata: name="Bacon", rarity="Common", traits=[Type:Food]
```

### Review & Mint Tab

Items now appear with correct rarities already set:
- ⭐ Golden Apple (Legendary)
- 📦 Bacon (Common)

No need to go back to Traits tab!

## Technical Details

### Metadata Merging

The operation intelligently merges metadata:
- **Preserves existing values** not being updated
- **Replaces values** when specified
- **Merges traits** by name (replaces traits with same name, adds new ones)

### Path Matching

Supports both:
- Relative paths: `Food/bacon.png`
- Paths with leading slash: `/Food/bacon.png`
- Partial path matching: matches if file path ends with target

### Logging

Each metadata change is logged with full details for debugging and transparency.

## Files Modified

1. **src/views/collectionMinter/index.tsx**
   - Lines 124-140: Added type definitions
   - Lines 1664-1697: Added simulation logic
   - Lines 2033-2046: Added AI schema
   - Lines 2130-2135: Added prompt documentation
   - Lines 2842-2902: Added execution logic

## Testing

To test the new functionality:

1. Create a collection with items like:
   - `golden_apple.png`
   - `diamond_sword.png`
   - `bacon.png`
   - `apple.png`

2. Go to Transform tab and click "Auto-Configure with AI"

3. Check if AI generates `set-metadata` operations with semantic rarities:
   - golden_apple → Legendary
   - diamond_sword → Legendary
   - bacon → Common
   - apple → Common

4. Execute pipeline and verify metadata is set in Review & Mint tab

## Next Steps

Consider adding more advanced metadata operations:
- Batch set-metadata (apply to multiple files matching a pattern)
- Conditional metadata (set based on file properties)
- Metadata templates (apply predefined metadata sets)

But the current implementation covers the core use case: semantic rarity assignment based on file analysis.
