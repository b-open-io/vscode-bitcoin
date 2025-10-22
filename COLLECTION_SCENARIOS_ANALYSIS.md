# Collection Minting Scenarios - Gap Analysis

## Scenario 1: Artist Portfolio with Inconsistent Naming
**Structure:**
```
Portraits/
  john_smith_commission_2024_final_v3.png
  Jane-Doe-Portrait (1).jpg
  SARAH_WILLIAMS_headshot.PNG
  MikeJohnson_profileV2_EDITED.jpg
Landscapes/
  sunset_beach_FINAL (copy).png
  mountain-vista-v1-compressed.jpg
```

**Current System Issues:**
1. ❌ Can't target specific files for individual rename (e.g., only fix "Jane-Doe-Portrait (1).jpg")
2. ❌ Can't apply different transforms to different files within same folder
3. ❌ No way to handle "(copy)" suffix vs "_EDITED" suffix selectively
4. ✅ Can handle global prefix/suffix removal but not file-specific

**What's Missing:**
- **Individual file targeting**: `{type: 'rename-file', target: 'exact/path/to/file.png', newName: 'Clean Name.png'}`
- **Pattern-based targeting**: `{type: 'transform', pattern: '*.*(copy).*', renamePatterns: [...]}`
- **Conditional transforms**: Apply different patterns based on file matching criteria

---

## Scenario 2: Game Assets with Complex Variant System
**Structure:**
```
Characters/
  Warrior/
    warrior_common_skin1_idle.png
    warrior_common_skin1_attack.png
    warrior_rare_skin2_idle.png
    warrior_legendary_skin3_special_attack_GOLDEN.png
Weapons/
  sword_tier1_basic.png
  sword_tier2_enchanted_FIRE.png
  sword_tier3_legendary_FROST_ANIMATED.png
```

**Current System Issues:**
1. ❌ Multiple variant dimensions (skin1/skin2, tier1/tier2, idle/attack)
2. ❌ Trait extraction from middle of filename (not just prefix/suffix)
3. ❌ Some files should be variants, others should be separate items
4. ❌ Rarity + special modifiers (GOLDEN, FIRE, FROST) need extraction
5. ❌ Animation state (idle/attack) should be metadata not part of name

**What's Missing:**
- **Multi-dimensional variants**: Support multiple variant fields per item
- **Mid-string extraction**: Regex capture groups for trait extraction
- **Conditional item splitting**: Decide if files are variants or separate items based on patterns
- **Metadata extraction**: Extract non-NFT metadata (animation states) without affecting name

---

## Scenario 3: Generative Art with Trait Combinations
**Structure:**
```
Generated_Collection/
  0001_red_circle_large_animated.png
  0002_blue_square_small_static.png
  0003_red_triangle_medium_animated_RARE.png
  ...
  9999_green_circle_large_static_LEGENDARY.png
```

**Current System Issues:**
1. ❌ Need to split single filename into multiple traits
2. ❌ Sequential numbering should become token number
3. ❌ Rarity flags are optional (not all files have them)
4. ❌ Need to extract: color, shape, size, animation as separate traits
5. ❌ Item name should be generated from traits, not filename

**What's Missing:**
- **Filename decomposition**: Split filename by delimiter into trait values
- **Token number mapping**: Use filename prefix as NFT token ID
- **Optional trait extraction**: Handle files with/without certain traits
- **Name generation from traits**: Template like "{color} {shape}" from extracted traits

---

## Scenario 4: Photography Collection with Metadata in Folders
**Structure:**
```
2024_March_Rare/
  DSC_0234.JPG
  DSC_0235.JPG
  IMG_4521.JPG
2024_April_Common/
  DSC_0456.JPG
  DSC_0457_BEST_SHOT.JPG
Featured/
  hero_image_001.JPG
  hero_image_002_SOLD.JPG
```

**Current System Issues:**
1. ❌ Camera filenames (DSC_*, IMG_*) are meaningless - need descriptive names
2. ❌ Date + rarity in folder name needs extraction
3. ❌ Some files have manual annotations (_BEST_SHOT, _SOLD)
4. ❌ Featured folder should override rarity from other folders
5. ❌ Need to generate meaningful names from context, not camera IDs

**What's Missing:**
- **Folder metadata extraction**: Parse "2024_March_Rare" into date=2024-03, rarity=Rare
- **Context-based naming**: Generate names from folder context + index
- **Override rules**: Featured folder overrides rarity assignments
- **Annotation extraction**: Pull _SOLD, _BEST_SHOT into metadata
- **Default name generation**: "March 2024 #1" instead of "DSC 0234"

---

## Scenario 5: Multi-Artist Collaboration with Mixed Standards
**Structure:**
```
Artist_Alice/
  character-01-sword.png
  character-02-shield.png
Contributor_Bob/
  bob_creation_v1_final.png
  bob_creation_v2_final.png
SharedAssets/
  background_template_DO_NOT_MINT.png
  logo_watermark_SKIP.png
TeamReview/
  APPROVED_alice_character-03.png
  NEEDS_REVISION_bob_item-01.png
  APPROVED_shared_background-01.png
```

**Current System Issues:**
1. ❌ Different naming conventions per artist
2. ❌ Files marked for exclusion (_DO_NOT_MINT, _SKIP)
3. ❌ Approval workflow embedded in filenames/folders
4. ❌ Need to preserve artist attribution but clean up names
5. ❌ Some files should be excluded, others need status metadata

**What's Missing:**
- **Exclude by marker**: `{type: 'exclude', pattern: '*DO_NOT_MINT*'}`
- **Metadata extraction with exclusion**: Extract APPROVED/NEEDS_REVISION without minting rejected items
- **Artist attribution**: Extract creator from folder structure
- **Per-folder transform rules**: Different patterns for different artists
- **Status filtering**: Only include APPROVED items in final collection

---

## Summary of Missing Features

### 1. Individual File Operations (HIGH PRIORITY)
```typescript
{type: 'rename-file', target: 'Portraits/jane-doe.png', newName: 'Jane Doe Portrait.png', reason: 'Fix specific file'}
{type: 'move-file', target: 'wrong_folder/item.png', to: 'correct_folder/', reason: 'Move misplaced file'}
{type: 'exclude-file', target: 'exact/path/to/exclude.png', reason: 'Exclude specific file'}
```

### 2. Pattern-Based File Targeting (HIGH PRIORITY)
```typescript
{
  type: 'transform',
  pattern: '**/*_(copy)*',  // Only files with (copy)
  scope: 'all',
  renamePatterns: [{type: 'suffix-remove', pattern: ' (copy)'}]
}
```

### 3. Advanced Trait Extraction (MEDIUM PRIORITY)
```typescript
{
  type: 'extract-traits',
  pattern: '{number}_{color}_{shape}_{size}_{animation}',
  delimiter: '_',
  traitMappings: {
    number: 'tokenId',
    color: 'Color',
    shape: 'Shape',
    size: 'Size',
    animation: 'Animation'
  }
}
```

### 4. Conditional Operations (MEDIUM PRIORITY)
```typescript
{
  type: 'conditional-transform',
  condition: {field: 'rarity', operator: 'equals', value: 'Legendary'},
  operations: [/* apply these operations only to matching files */]
}
```

### 5. Metadata Extraction (LOW PRIORITY)
```typescript
{
  type: 'extract-metadata',
  pattern: '*_SOLD*',
  targetField: 'salesStatus',
  value: 'sold',
  removeFromName: true  // Extract but remove from filename
}
```

### 6. Name Generation (MEDIUM PRIORITY)
```typescript
{
  type: 'generate-names',
  template: '{folderName} #{index}',
  applyTo: 'files-without-meaningful-names',  // e.g., DSC_*, IMG_*
  padding: 3  // 001, 002, etc.
}
```

### 7. Multi-Pattern Matching (MEDIUM PRIORITY)
```typescript
{
  type: 'transform',
  patterns: ['**/*DRAFT*', '**/*WIP*', '**/*TODO*'],  // Match any of these
  scope: 'all',
  renamePatterns: [{type: 'find-replace', find: /DRAFT|WIP|TODO/gi, replace: ''}]
}
```

---

## Recommendations for Implementation Priority

### Phase 1: Individual File Targeting (Immediate)
- `rename-file` operation for specific file renames
- `move-file` operation for specific file moves
- `exclude-file` operation for specific file exclusion
- Pattern matching in existing operations (transform, exclude)

### Phase 2: Advanced Pattern Matching (Soon)
- Regex support in all pattern fields
- Multiple patterns per operation (OR logic)
- Glob pattern support (**/*.png, **/variants_*)

### Phase 3: Smart Extraction (Later)
- Delimiter-based trait extraction
- Folder metadata parsing
- Context-aware name generation

### Phase 4: Conditional Logic (Future)
- Conditional operations based on extracted traits
- Override rules (later operations can override earlier ones)
- Multi-dimensional variant support
