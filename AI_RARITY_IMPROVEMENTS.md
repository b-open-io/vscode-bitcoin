# AI Rarity Assignment Improvements

## Problem Statement

The AI rarity assignment system was assigning inappropriate rarities to simple items. For example:
- "bacon" → Majestic ❌ (should be Common)
- Simple food items getting high rarities without semantic justification
- No visibility into why assignments were made
- No validation to catch suspicious assignments

## Root Cause

1. **Weak Prompt**: The AI prompt didn't strongly emphasize semantic analysis
2. **No Logging**: No way to see what data was sent to AI or what it returned
3. **No Validation**: No post-processing checks to flag questionable assignments
4. **Distribution Priority**: Prompt prioritized hitting target percentages over semantic correctness

## Solutions Implemented

### 1. Comprehensive Logging (src/views/collectionMinter/index.tsx:1225-1233)

**Input Data Logging:**
```typescript
console.log('[AI Rarity Assignment] ===== INPUT DATA =====');
console.log(`[AI Rarity Assignment] Total items: ${itemsContext.length}`);
console.log(`[AI Rarity Assignment] Items with existing rarity: ${itemsContext.filter(i => i.existingRarity).length}`);
console.log(`[AI Rarity Assignment] Target distribution:`, rarityLabels.map(r => `${r.label}: ${r.percentage}%`).join(', '));
console.log('[AI Rarity Assignment] Sample items (first 20):');
itemsContext.slice(0, 20).forEach(item => {
  console.log(`  - "${item.nameWithoutExt}" (folder: ${item.folderPath || 'root'}, existing: ${item.existingRarity || 'none'})`);
});
```

**AI Response Logging (lines 1365-1375):**
```typescript
console.log('[AI Rarity Assignment] ===== AI RESPONSE =====');
console.log(`[AI Rarity Assignment] Summary: ${aiResponse.summary}`);
console.log(`[AI Rarity Assignment] Assignments received: ${aiResponse.assignments.length}`);

// Log first 10 assignments with reasoning
console.log('[AI Rarity Assignment] Sample assignments with reasoning:');
aiResponse.assignments.slice(0, 10).forEach(a => {
  const item = itemsContext.find(i => i.id === a.id);
  console.log(`  - "${item?.nameWithoutExt}" → ${a.rarityLabel}`);
  console.log(`    Reasoning: ${a.reasoning}`);
});
```

### 2. Distribution Analysis (lines 1398-1422)

**Tracks actual vs target percentages:**
```typescript
console.log('[AI Rarity Assignment] ===== DISTRIBUTION ANALYSIS =====');
console.log('[AI Rarity Assignment] Target vs Actual:');
rarityLabels.forEach(r => {
  const actual = rarityDistribution[r.label] || 0;
  const actualPercent = ((actual / assignedCount) * 100).toFixed(1);
  console.log(`  ${r.label}: Target ${r.percentage}% | Actual ${actualPercent}% (${actual} items)`);
});
```

**Example Output:**
```
[AI Rarity Assignment] Target vs Actual:
  Common: Target 50% | Actual 48.5% (97 items)
  Uncommon: Target 30% | Actual 32.0% (64 items)
  Rare: Target 15% | Actual 14.5% (29 items)
  Legendary: Target 5% | Actual 5.0% (10 items)
```

**Warns if distribution is >15% off target:**
```
[AI Rarity Assignment] ⚠️  DISTRIBUTION WARNINGS:
  - Legendary is 18.5% off target (23.5% vs 5%)
```

### 3. Strengthened AI Prompt (lines 1276-1315)

**BEFORE:**
```
CRITICAL RARITY ASSIGNMENT RULES:
1. **Semantic Indicators**: Look for words/phrases that indicate rarity:
   - LEGENDARY indicators: "golden", "diamond", "platinum"...
   - COMMON: simple, plain names without special descriptors
```

**AFTER:**
```
CRITICAL RARITY ASSIGNMENT RULES:

⚠️  **IMPORTANT**: Default to COMMON unless there are CLEAR semantic indicators of higher rarity!

1. **Semantic Indicators** (STRICT MATCHING REQUIRED):
   - LEGENDARY/EPIC/MYTHIC indicators: "golden", "diamond", "platinum", "legendary", "epic"...
   - COMMON: **Everything else** - simple food items, basic objects, plain names without special descriptors

EXAMPLES OF CORRECT ASSIGNMENTS:
✅ "golden apple" → Legendary (has "golden" indicator word)
✅ "apple" → Common (simple food, no descriptors)
✅ "bacon" → Common (simple food, no descriptors)

EXAMPLES OF WRONG ASSIGNMENTS:
❌ "bacon" → Majestic (NO semantic indicator - this is a simple food item!)
❌ "apple" → Rare (NO semantic indicator - this is common)

**DEFAULT BEHAVIOR**: When in doubt, assign COMMON. Only assign higher rarities when you can clearly identify semantic indicators in the name itself.
```

### 4. Suspicious Assignment Detection (lines 1437-1475)

**Validates assignments against semantic rules:**
```typescript
const rarityKeywords = {
  legendary: ['golden', 'diamond', 'platinum', 'legendary', 'epic', 'mythic', 'supreme', 'ultimate', 'divine', 'celestial', 'transcendent'],
  rare: ['special', 'unique', 'premium', 'elite', 'champion', 'hero', 'master', 'royal', 'ancient', 'sacred'],
  uncommon: ['enhanced', 'improved', 'advanced', 'superior', 'polished', 'refined', 'quality']
};

aiResponse.assignments.forEach(a => {
  const nameLower = item.nameWithoutExt.toLowerCase();
  const rarity = a.rarityLabel.toLowerCase();

  // Check if high rarity assignment lacks semantic indicators
  if (rarity.includes('legendary') || rarity.includes('epic') || rarity.includes('mythic') || rarity.includes('majestic')) {
    const hasIndicator = rarityKeywords.legendary.some(keyword => nameLower.includes(keyword));
    if (!hasIndicator && !item.folderPath.toLowerCase().includes('legendary')) {
      suspiciousAssignments.push(`"${item.nameWithoutExt}" → ${a.rarityLabel} (no legendary indicator found)`);
    }
  }
});
```

**Example Output:**
```
[AI Rarity Assignment] ⚠️  SUSPICIOUS ASSIGNMENTS (may need review):
  - "bacon" → Majestic (no legendary indicator found)
  - "apple" → Rare (no rare indicator found)
  - "sword" → Epic (no legendary indicator found)
```

## How to Use the Logs

### 1. Check Input Data
Look for the first log block to see what the AI received:
```
[AI Rarity Assignment] ===== INPUT DATA =====
[AI Rarity Assignment] Total items: 200
[AI Rarity Assignment] Sample items (first 20):
  - "bacon" (folder: Food, existing: none)
  - "golden apple" (folder: Food, existing: none)
```

### 2. Review AI Reasoning
See why the AI made specific assignments:
```
[AI Rarity Assignment] Sample assignments with reasoning:
  - "golden apple" → Legendary
    Reasoning: Contains "golden" keyword indicating legendary rarity
  - "bacon" → Common
    Reasoning: Simple food item with no rarity indicators
```

### 3. Check Distribution
Verify the AI hit target percentages:
```
[AI Rarity Assignment] ✅ Distribution is within acceptable range
```

### 4. Review Suspicious Assignments
Catch potential errors immediately:
```
[AI Rarity Assignment] ⚠️  SUSPICIOUS ASSIGNMENTS (may need review):
  - "bacon" → Majestic (no legendary indicator found)
```

## Expected Behavior After Fix

✅ **Correct Assignments:**
- "golden apple" → Legendary (has "golden" indicator)
- "diamond sword" → Legendary (has "diamond" indicator)
- "enhanced shield" → Uncommon (has "enhanced" indicator)
- "apple", "bacon", "sword" → Common (no indicators)

✅ **Semantic Priority:** AI defaults to Common unless clear indicators exist
✅ **Full Visibility:** Every assignment logged with reasoning
✅ **Automatic Validation:** Suspicious assignments flagged immediately
✅ **Distribution Tracking:** See how close AI got to target percentages

## Testing Checklist

When running AI rarity assignment, check the Developer Console (Help → Toggle Developer Tools) for:

1. ✅ Input data shows correct file names
2. ✅ Target distribution percentages are correct
3. ✅ AI reasoning makes sense for sample assignments
4. ✅ Actual distribution is close to target (within ~15%)
5. ✅ No suspicious assignments flagged (or very few)
6. ✅ Simple items like "bacon", "apple" get Common rarity
7. ✅ Items with indicators like "golden X", "diamond Y" get high rarity

## Future Improvements

### Move to Pipeline System (Recommended)

Currently rarity assignment happens in Tab 3 (Traits) at the end. Consider moving it to a pipeline operation:

**Benefits:**
- Rarity becomes part of the transformation workflow
- Can be re-run easily
- Results cached in workspace with other transformations
- More consistent with structure analysis pattern

**Implementation:**
```typescript
{
  type: 'assign-rarity',
  scope: 'all',
  method: 'ai',
  rarityLabels: [...],
  traits: [...]
}
```

This would make the entire collection preparation flow fully automated and repeatable.

## Files Modified

1. **src/views/collectionMinter/index.tsx** (lines 1225-1475)
   - Added comprehensive logging
   - Strengthened AI prompt with explicit examples
   - Added distribution analysis
   - Added suspicious assignment detection

## How to View Logs

1. Press `F5` to run extension in development mode
2. Open Collection Minter
3. Navigate to Traits tab
4. Click "Auto-Assign with AI"
5. Open Developer Tools: **Help → Toggle Developer Tools → Console**
6. Look for `[AI Rarity Assignment]` log entries

All logs are prefixed with `[AI Rarity Assignment]` for easy filtering.
