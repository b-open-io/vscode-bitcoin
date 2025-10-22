# Collection Minter - Remaining Tasks

## Phase 1: UI Improvements (Frontend - CollectionMinterPanel.tsx)

### Task 1.1: Wrap App in TooltipProvider
**File**: `src/views/webview/src/panels/CollectionMinterPanel.tsx`
**Location**: Root return statement
**Action**: Wrap entire component return in `<TooltipProvider>`
```tsx
return (
  <TooltipProvider>
    <div className="h-full flex flex-col">
      {/* existing content */}
    </div>
  </TooltipProvider>
);
```

### Task 1.2: Replace AI Strategy Section with Info Icon + Tooltip
**File**: `src/views/webview/src/panels/CollectionMinterPanel.tsx`
**Location**: Lines 3189-3200 (Structure tab, after pipeline operations list)
**Current**: Full section with purple background showing reasoning
**New**:
- Remove the entire AI Strategy section
- Add info icon next to "Pipeline Operations" header (line 1809)
- Show AI strategy in tooltip on hover
```tsx
<div className="flex items-center gap-2">
  <h3 className="font-semibold text-sm mb-1">Pipeline Operations</h3>
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
```

### Task 1.3: Add Copy Button to BEFORE Panel Header
**File**: `src/views/webview/src/panels/CollectionMinterPanel.tsx`
**Location**: BEFORE panel header (search for "BEFORE" in Transform tab)
**Action**: Add copy button next to header text
```tsx
const copyBeforeStructure = () => {
  const structure = buildTreeStructure(files); // Use existing tree builder
  const text = renderTreeAsText(structure);
  navigator.clipboard.writeText(text);
  showNotification('Copied BEFORE structure to clipboard', 'success');
};

// In header:
<div className="flex items-center justify-between">
  <h3>BEFORE</h3>
  <Button size="sm" variant="ghost" onClick={copyBeforeStructure}>
    <Copy className="h-3 w-3" />
  </Button>
</div>
```

### Task 1.4: Add Copy Button to AFTER Panel Header
**File**: `src/views/webview/src/panels/CollectionMinterPanel.tsx`
**Location**: AFTER panel header (search for "AFTER" in Transform tab)
**Action**: Same as 1.3 but for transformed files
```tsx
const copyAfterStructure = () => {
  const structure = buildTreeStructure(transformedFiles || files);
  const text = renderTreeAsText(structure);
  navigator.clipboard.writeText(text);
  showNotification('Copied AFTER structure to clipboard', 'success');
};
```

### Task 1.5: Enhance Pipeline Operation Display
**File**: `src/views/webview/src/panels/CollectionMinterPanel.tsx`
**Location**: Pipeline operations list rendering (line 1997+)
**Current**: Only shows `type` and `scope`
**New**: Show detailed info per operation type:

```tsx
// For exclude operation:
{op.type === 'exclude' && (
  <div className="text-xs text-muted-foreground">
    <p>Pattern: <code>{op.path}</code></p>
    {op.reason && <p className="mt-1">Reason: {op.reason}</p>}
  </div>
)}

// For rename-file:
{op.type === 'rename-file' && (
  <div className="text-xs text-muted-foreground">
    <p>Target: <code>{op.target}</code></p>
    <p>New name: <code>{op.newName}</code></p>
    {op.reason && <p className="mt-1">Reason: {op.reason}</p>}
  </div>
)}

// For transform:
{op.type === 'transform' && (
  <div className="text-xs text-muted-foreground">
    <p>Scope: <code>{op.scope}</code></p>
    {op.pattern && <p>Pattern: <code>{op.pattern}</code></p>}
    <p>Patterns: {op.renamePatterns.map(p => p.type).join(', ')}</p>
    {op.reason && <p className="mt-1">Reason: {op.reason}</p>}
  </div>
)}

// Similar for other operation types...
```

### Task 1.6: Add Settings Link in Collection Minter Header
**File**: `src/views/webview/src/panels/CollectionMinterPanel.tsx`
**Location**: Top header next to collection name
**Action**: Add settings icon that opens VSCode settings
```tsx
<Button
  size="sm"
  variant="ghost"
  onClick={() => {
    vscode.postMessage({ command: 'openSettings', filter: 'bitcoinWallet.collectionMinter' });
  }}
  title="Configure Collection Minter Settings"
>
  <Settings className="h-4 w-4" />
</Button>
```

## Phase 2: Backend Configuration (Extension)

### Task 2.1: Add Configuration Schema
**File**: `package.json`
**Location**: `contributes.configuration` section
**Action**: Add new configuration properties
```json
{
  "bitcoinWallet.collectionMinter.prompts.structureAnalysis": {
    "type": "string",
    "default": "",
    "markdownDescription": "Custom system prompt for AI structure analysis. Leave empty to use default. Supports multi-line text.",
    "editPresentation": "multilineText"
  },
  "bitcoinWallet.collectionMinter.prompts.rarityAssignment": {
    "type": "string",
    "default": "",
    "markdownDescription": "Custom system prompt for AI rarity assignment. Leave empty to use default.",
    "editPresentation": "multilineText"
  },
  "bitcoinWallet.collectionMinter.prompts.traitAssignment": {
    "type": "string",
    "default": "",
    "markdownDescription": "Custom system prompt for AI trait assignment. Leave empty to use default.",
    "editPresentation": "multilineText"
  }
}
```

### Task 2.2: Update Backend to Read Configuration
**File**: `src/views/collectionMinter/index.tsx`
**Location**: Lines 1920+ (where systemPrompt is defined for structure analysis)
**Action**: Read from config with fallback
```typescript
// At top of handleAutoConfigurePipeline method:
const config = vscode.workspace.getConfiguration('bitcoinWallet.collectionMinter.prompts');
const customPrompt = config.get<string>('structureAnalysis');

const systemPrompt = customPrompt && customPrompt.trim()
  ? customPrompt
  : `You are an expert in NFT collection structure...`; // existing default
```

### Task 2.3: Update Rarity Assignment Prompt Reader
**File**: `src/views/collectionMinter/index.tsx`
**Location**: Lines 1258+ (rarity assignment system prompt)
**Action**: Same pattern as 2.2
```typescript
const config = vscode.workspace.getConfiguration('bitcoinWallet.collectionMinter.prompts');
const customPrompt = config.get<string>('rarityAssignment');

const systemPrompt = customPrompt && customPrompt.trim()
  ? customPrompt
  : `You are an expert in NFT collection curation...`; // existing
```

### Task 2.4: Add openSettings Command Handler
**File**: `src/views/collectionMinter/index.tsx`
**Location**: Message handler switch statement (around line 800+)
**Action**: Add case for openSettings
```typescript
case 'openSettings': {
  vscode.commands.executeCommand('workbench.action.openSettings', data.filter || 'bitcoinWallet.collectionMinter');
  break;
}
```

## Phase 3: Helper Functions

### Task 3.1: Create Tree Text Renderer
**File**: `src/views/webview/src/panels/CollectionMinterPanel.tsx`
**Location**: Add helper function near other utility functions
**Purpose**: Convert tree structure to text format for clipboard
```typescript
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
```

## Implementation Order

1. **Start with Phase 1, Task 1.1** (TooltipProvider wrapper) - Required for tooltips to work
2. **Phase 1, Task 1.2** - Replace AI Strategy section with tooltip
3. **Phase 3, Task 3.1** - Create tree text renderer helper
4. **Phase 1, Tasks 1.3-1.4** - Add copy buttons (depends on 3.1)
5. **Phase 1, Task 1.5** - Enhance pipeline operation display
6. **Phase 2, Task 2.1** - Add configuration schema to package.json
7. **Phase 2, Tasks 2.2-2.4** - Update backend to use configuration
8. **Phase 1, Task 1.6** - Add settings link (depends on 2.4)

## Testing Checklist

After each task:
- [ ] Build frontend: `cd src/views/webview && VITE_CJS_IGNORE_WARNING=true bunx vite build`
- [ ] Test in VSCode: F5 to run extension
- [ ] Verify functionality works as expected
- [ ] Check dark mode compatibility
- [ ] Verify no console errors

## Files to Modify

1. `src/views/webview/src/panels/CollectionMinterPanel.tsx` - Most UI changes
2. `src/views/collectionMinter/index.tsx` - Backend config reading + message handler
3. `package.json` - Configuration schema

## Estimated Effort

- Phase 1 (UI): ~45 minutes
- Phase 2 (Backend): ~20 minutes
- Phase 3 (Helpers): ~10 minutes
- Testing: ~15 minutes
- **Total: ~90 minutes**
