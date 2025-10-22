# Changelog

## [Unreleased]

## [0.1.6] - WIP (Not Ready for Release)

### Added - Collection Minter
- **Collection Minter Panel** - Full-featured NFT collection creator
  - Multi-step wizard: Setup → Files → Traits → Review & Mint
  - Resizable split-panel layout with independent scroll areas
  - Real-time cost estimation (inscription outputs + transaction fees)
  - Batch minting support (configurable items per transaction)
  - Collections state persistence in `~/.bitcoin/collections/`
  - Collections Manager for viewing/managing saved collections

### Added - AI-Powered Features
- **Intelligent Rarity Assignment** - GPT-4o analyzes collection context
  - Semantic analysis of file names (e.g., "golden apple" → Legendary)
  - Pattern recognition (numbered items, folder structure)
  - Contextual indicators (golden, diamond, legendary, rare, etc.)
  - Respects existing manual assignments
  - Distributes rarities to match target percentages
- **AI Generation Dialogs** - Generate rarity labels and trait definitions
  - Natural language prompts for rarity tiers
  - Automatic trait value generation with percentages
  - Validates percentages sum to 100%

### Added - Collection Features
- **Folder Structure Detection** - Auto-detect flat, one-level, or two-level structures
  - Automatic trait extraction from folder hierarchy
  - Trait mapping configuration for two-level structures
- **File Management** - Lightweight table view for large collections
  - Lazy image loading (only loads when Review tab is active)
  - On-demand image loading for selected items
  - "Open in Editor" integration
  - Performance optimized for 200-400+ item collections
- **Rarity & Trait Editors** - Visual editors for collection metadata
  - Percentage sliders with real-time validation
  - Drag-to-reorder support
  - Add/remove values dynamically
- **Item Metadata Editor** - Per-item customization
  - Source file display with open button
  - Name and description fields
  - Rarity dropdown selection
  - Traits override dialog
  - Live inscription metadata preview

### Fixed - Collection Minter
- **Form Performance** - Converted all forms to shadcn/ui with react-hook-form
  - Debounced updates (500ms) prevent UI lag
  - Local state updates instantly, backend syncs periodically
  - No more character loss or input overwrites
  - Eliminated excessive re-renders from computed arrays
- **State Management** - Proper separation of local vs persisted state
  - Form state only resets when switching items
  - Prevents overwriting user edits during backend updates
  - Fixed rarity dropdown not persisting selections
- **Layout Issues** - Fixed scrolling and layout structure
  - ScrollArea components with proper `min-h-0` constraints
  - Fixed headers stay visible while content scrolls
  - Preview image and mint controls always visible
  - Resizable panels with independent scroll areas
- **Data Persistence** - Optimized collection storage
  - Strips base64 image data when saving (99.7% size reduction)
  - Auto-migration for old collections with embedded images
  - File size reduced from ~150MB to ~500KB
  - 50x faster loading after migration
- **Item Count Display** - Shows actual selected files count
  - Caches `selectedFilesCount` in collection index
  - Updates in real-time as files are selected/deselected
- **Command Registration** - Fixed missing `bitcoin.openCollectionsManager` command
- **Inscription Format** - Corrected metadata structure per 1sat-api spec
  - `rarityLabel` is a string, not object (e.g., "Common")
  - `traits` array has no `percentage` field on items
  - Percentages only at collection level, items reference values
- **Pipeline Type Definitions** - Added missing operation types to union
  - Added `exclude-file`, `move-file`, `rename-file`, `set-metadata` types
  - Removed unreachable default cases from exhaustive switch statements

### Fixed - Transaction Parser
- **Command Registration** - Registered missing `bitcoin.openTransactionParser` command
- **Parse Button Handlers** - All "Parse Transaction" buttons now work correctly
  - Fixed parse from decode history dropdown
  - Fixed parse from Transaction Decoder panel
  - Fixed parse from Bitcoin Tools decode component
  - Added `transaction:openParser` message handlers in all backends

### Fixed - BAP Profile Panel
- **Singleton Pattern** - Implemented proper singleton per BAP identity
  - One panel per unique BAP identity (idKey)
  - Opening same profile reuses and updates existing panel
  - Different profiles can each have their own panel open
  - Proper cleanup when panels are closed

### Performance Improvements
- Lazy image loading reduces initial load time by 30-60x
- Debounced form updates (500ms) eliminate keystroke lag
- Fixed useEffect dependencies to prevent infinite loops
- Removed base64 data from saved collections
- Optimized file scanning (no image loading during scan)

### Technical Improvements
- React-hook-form integration for all forms
- Proper debouncing with useCallback and useRef
- ScrollArea components with correct flex constraints
- ResizablePanel layout matching Script Debugger pattern
- OpenAI API integration with GPT-4o
- Environment variable support (OPENAI_API_KEY)

## [0.1.5] - 2024-01-XX

### Fixed
- **🎉 SPV Database Persistence** - Replaced fake-indexeddb with indexeddbshim
  - SPV sync now persists between VS Code restarts
  - Uses SQLite3 for disk storage in VS Code's global storage directory
  - Balance shows immediately from cache on restart
  - Only syncs new blocks since last session (~seconds instead of ~minutes)
  - No more 5-10 minute full resync on every restart!

### Added
- Real-time balance updates during SPV sync (updates every 5 seconds)
- InscriptionIndexer for ordinals/NFTs tracking in SPV store
- Granular sync progress in VS Code status bar (bottom of IDE)
- Immediate balance refresh when sync starts (shows cached data)

### Changed
- SPV database location: VS Code extension global storage
- Database files: SQLite3 format (persistent)

## Previous Versions
See git history for older changes.
