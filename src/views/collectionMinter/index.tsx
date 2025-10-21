import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { KeyVault } from '../../keyVault';
import vsApi from '../../vsShim';
import { collectionsState } from '../../services/collectionsStateService';

export interface CollectionFile {
  id: string;
  path: string;
  name: string;
  dataUrl?: string;
  contentType: string;
  size: number;
  selected: boolean;
  metadata?: CollectionItemMetadata;
}

export interface CollectionItemMetadata {
  name: string;
  description?: string;
  traits?: Array<{ name: string; value: string; }>;
  rarityLabel?: string;
  rank?: number;
  mintNumber?: number;
}

export type FolderStructure = 'flat' | 'one-level' | 'two-level';

export interface CollectionConfig {
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
    level1TraitName: string;  // e.g., "Type" or "Category"
    level2TraitName: string;  // e.g., "Material" or "Variant"
  };
}

export class CollectionMinterPanel {
  public static currentPanel: CollectionMinterPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _vault: KeyVault;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];
  private _selectedFolder: string | null = null;
  private _files: CollectionFile[] = [];
  private _collectionConfig: Partial<CollectionConfig> = {};
  private _collectionId: string;
  private _saveDebounceTimeout: NodeJS.Timeout | null = null;

  private constructor(panel: vscode.WebviewPanel, vault: KeyVault, extensionUri: vscode.Uri, collectionId: string) {
    this._panel = panel;
    this._vault = vault;
    this._extensionUri = extensionUri;
    this._collectionId = collectionId;

    // Set up webview content first (async load will update later)
    this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);

    // Load collection state asynchronously (won't block UI)
    this.loadCollectionState();

    // Handle panel disposal
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    // Handle messages from webview
    this._panel.webview.onDidReceiveMessage(
      (msg) => this.handleMessage(msg),
      null,
      this._disposables
    );
  }

  public static async show(vault: KeyVault, extensionUri: vscode.Uri, collectionId: string) {
    // Check if vault is unlocked
    if (!vault.isUnlocked) {
      const hasExistingVault = await vault.hasExistingVault();
      const password = await vsApi.window.showInputBox({
        prompt: hasExistingVault ? 'Enter vault password to unlock' : 'Set a password for your key vault',
        password: true,
        placeHolder: hasExistingVault ? undefined : 'Choose a strong password'
      });
      if (!password) return;

      try {
        await vault.unlockVault(password);
      } catch (err) {
        vsApi.window.showErrorMessage(String(err));
        return;
      }
    }

    // Check if user has an ordinals key
    const ordinalsKey = await vault.getOrdinalsKey();
    if (!ordinalsKey || ordinalsKey.type !== 'wif') {
      vsApi.window.showErrorMessage(
        'You must designate an ordinals key before using the Collection Minter. Go to the Key Vault and designate a key for ordinals.'
      );
      return;
    }

    // Show panel
    if (CollectionMinterPanel.currentPanel) {
      CollectionMinterPanel.currentPanel._collectionId = collectionId;
      CollectionMinterPanel.currentPanel.loadCollectionState();
      CollectionMinterPanel.currentPanel._panel.reveal(vscode.ViewColumn.One);
    } else {
      const panel = vscode.window.createWebviewPanel(
        'collectionMinter',
        'Collection Minter',
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [extensionUri]
        }
      );
      CollectionMinterPanel.currentPanel = new CollectionMinterPanel(panel, vault, extensionUri, collectionId);
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'src', 'views', 'webview', 'dist', 'assets', 'index.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'src', 'views', 'webview', 'dist', 'assets', 'index.css')
    );

    const nonce = getNonce();

    return `<!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data: https:;">
        <link href="${styleUri}" rel="stylesheet">
        <title>Collection Minter</title>
        <style>
          .loader-container {
            position: fixed;
            inset: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            background-color: var(--vscode-editor-background);
          }
          .loader {
            border: 3px solid transparent;
            border-top-color: var(--vscode-progressBar-background);
            border-radius: 50%;
            width: 32px;
            height: 32px;
            animation: spin 0.8s linear infinite;
          }
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        </style>
      </head>
      <body>
        <div class="loader-container" id="initial-loader">
          <div class="loader"></div>
        </div>
        <div id="root"></div>
        <script nonce="${nonce}">
          window.PANEL_TYPE = 'collection-minter';
          window.COLLECTION_PAYLOAD = ${JSON.stringify({
            files: this._files,
            collectionConfig: this._collectionConfig,
            selectedFolder: this._selectedFolder
          })};
        </script>
        <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
      </body>
      </html>`;
  }

  private async handleMessage(msg: any) {
    switch (msg.command) {
      case 'selectFolder':
        await this.selectFolder();
        break;

      case 'loadFiles':
        await this.loadFilesFromFolder();
        break;

      case 'updateFileSelection':
        if (msg.fileId && typeof msg.selected === 'boolean') {
          this.updateFileSelection(msg.fileId, msg.selected);
        }
        break;

      case 'updateCollectionConfig':
        if (msg.config) {
          this._collectionConfig = { ...this._collectionConfig, ...msg.config };
          this.sendUpdate();
          this.saveCollectionState();
        }
        break;

      case 'updateFileMetadata':
        if (msg.fileId && msg.metadata) {
          this.updateFileMetadata(msg.fileId, msg.metadata);
        }
        break;

      case 'mintCollection':
        await this.mintCollection();
        break;

      case 'autoAssignTraits':
        this.autoAssignTraits();
        break;

      case 'generateAI':
        if (msg.type && msg.prompt && msg.requestId) {
          await this.handleAIGeneration(msg.type, msg.prompt, msg.collectionName, msg.requestId);
        }
        break;

      case 'checkAIAvailable':
        this.checkAIAvailable();
        break;

      case 'openSettings':
        if (msg.setting) {
          vscode.commands.executeCommand('workbench.action.openSettings', msg.setting);
        }
        break;

      case 'backToCollections':
        vscode.commands.executeCommand('bitcoin.openCollectionsManager');
        this.dispose();
        break;

      case 'loadImage':
        if (msg.fileId) {
          await this.loadImageData(msg.fileId);
        }
        break;

      case 'openFileInEditor':
        if (msg.filePath) {
          const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(msg.filePath));
          await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Beside });
        }
        break;
    }
  }

  private async loadImageData(fileId: string) {
    const file = this._files.find(f => f.id === fileId);
    if (!file || file.dataUrl) return; // Already loaded

    try {
      const fileData = await fs.readFile(file.path);
      const base64 = fileData.toString('base64');
      file.dataUrl = `data:${file.contentType};base64,${base64}`;

      // Send update with loaded image
      this.sendUpdate();
    } catch (error) {
      console.error('Failed to load image:', error);
    }
  }

  private async selectFolder() {
    const result = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: 'Select Folder',
      title: 'Select folder containing collection images'
    });

    if (result && result.length > 0) {
      this._selectedFolder = result[0].fsPath;
      await this.loadFilesFromFolder();
      this.saveCollectionState();
    }
  }

  private async loadFilesFromFolder() {
    if (!this._selectedFolder) return;

    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'Loading Collection Files',
      cancellable: false
    }, async (progress) => {
      try {
        const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'];
        this._files = [];

        progress.report({ increment: 0, message: 'Detecting folder structure...' });

        // Detect folder structure
        const structure = await this.detectFolderStructure(this._selectedFolder!, imageExtensions);

        // Set default trait names based on structure
        if (!this._collectionConfig.traitMapping) {
          this._collectionConfig.traitMapping = {
            level1TraitName: structure === 'two-level' ? 'Category' : 'Type',
            level2TraitName: 'Variant'
          };
        }
        this._collectionConfig.folderStructure = structure;

        progress.report({ increment: 10, message: 'Counting files...' });

        // Count total files first
        const totalFiles = await this.countFiles(this._selectedFolder!, imageExtensions, structure);

        if (totalFiles === 0) {
          vscode.window.showWarningMessage('No image files found in the selected folder.');
          return;
        }

        progress.report({ increment: 10, message: `Loading ${totalFiles} files...` });

        // Track progress
        let loadedFiles = 0;
        const progressCallback = () => {
          loadedFiles++;
          const percentComplete = Math.floor((loadedFiles / totalFiles) * 80);
          progress.report({
            increment: 80 / totalFiles,
            message: `Loading file ${loadedFiles}/${totalFiles}...`
          });
        };

        // Load files based on detected structure
        switch (structure) {
          case 'flat':
            await this.loadFlatFiles(this._selectedFolder!, imageExtensions, progressCallback);
            break;
          case 'one-level':
            await this.loadOneLevelFiles(this._selectedFolder!, imageExtensions, progressCallback);
            break;
          case 'two-level':
            await this.loadTwoLevelFiles(this._selectedFolder!, imageExtensions, progressCallback);
            break;
        }

        progress.report({ increment: 100, message: 'Complete!' });

        this.sendUpdate();
        this.saveCollectionState();
        vscode.window.showInformationMessage(
          `Loaded ${this._files.length} images (${structure} structure detected)`
        );
      } catch (error) {
        vscode.window.showErrorMessage(`Error loading files: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }

  private async countFiles(
    folderPath: string,
    imageExtensions: string[],
    structure: FolderStructure
  ): Promise<number> {
    let count = 0;

    switch (structure) {
      case 'flat': {
        const entries = await fs.readdir(folderPath, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (imageExtensions.includes(ext)) {
              count++;
            }
          }
        }
        break;
      }
      case 'one-level': {
        const entries = await fs.readdir(folderPath, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && !entry.name.startsWith('.')) {
            const subfolderPath = path.join(folderPath, entry.name);
            const subEntries = await fs.readdir(subfolderPath, { withFileTypes: true });
            for (const subEntry of subEntries) {
              if (subEntry.isFile()) {
                const ext = path.extname(subEntry.name).toLowerCase();
                if (imageExtensions.includes(ext)) {
                  count++;
                }
              }
            }
          }
        }
        break;
      }
      case 'two-level': {
        const entries = await fs.readdir(folderPath, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && !entry.name.startsWith('.')) {
            const level1Path = path.join(folderPath, entry.name);
            const level1Entries = await fs.readdir(level1Path, { withFileTypes: true });
            for (const level1Entry of level1Entries) {
              if (level1Entry.isDirectory() && !level1Entry.name.startsWith('.')) {
                const level2Path = path.join(level1Path, level1Entry.name);
                const level2Entries = await fs.readdir(level2Path, { withFileTypes: true });
                for (const level2Entry of level2Entries) {
                  if (level2Entry.isFile()) {
                    const ext = path.extname(level2Entry.name).toLowerCase();
                    if (imageExtensions.includes(ext)) {
                      count++;
                    }
                  }
                }
              } else if (level1Entry.isFile()) {
                const ext = path.extname(level1Entry.name).toLowerCase();
                if (imageExtensions.includes(ext)) {
                  count++;
                }
              }
            }
          }
        }
        break;
      }
    }

    return count;
  }

  private async detectFolderStructure(
    folderPath: string,
    imageExtensions: string[]
  ): Promise<FolderStructure> {
    const entries = await fs.readdir(folderPath, { withFileTypes: true });

    let hasFiles = false;
    let hasSubfolders = false;
    let hasNestedSubfolders = false;

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue; // Skip hidden files

      if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (imageExtensions.includes(ext)) {
          hasFiles = true;
        }
      } else if (entry.isDirectory()) {
        hasSubfolders = true;
        // Check if this subfolder has more subfolders
        const subPath = path.join(folderPath, entry.name);
        const subEntries = await fs.readdir(subPath, { withFileTypes: true });
        for (const subEntry of subEntries) {
          if (subEntry.isDirectory() && !subEntry.name.startsWith('.')) {
            hasNestedSubfolders = true;
            break;
          }
        }
      }
    }

    // Determine structure
    if (hasFiles && !hasSubfolders) {
      return 'flat';
    } else if (hasSubfolders && !hasNestedSubfolders) {
      return 'one-level';
    } else if (hasNestedSubfolders) {
      return 'two-level';
    }

    return 'flat'; // Default fallback
  }

  private async loadFlatFiles(folderPath: string, imageExtensions: string[], progressCallback: () => void) {
    const entries = await fs.readdir(folderPath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (imageExtensions.includes(ext)) {
          await this.addFileToCollection(folderPath, entry.name, ext, []);
          progressCallback();
        }
      }
    }
  }

  private async loadOneLevelFiles(folderPath: string, imageExtensions: string[], progressCallback: () => void) {
    const entries = await fs.readdir(folderPath, { withFileTypes: true });
    const traitName = this._collectionConfig.traitMapping?.level1TraitName || 'Type';

    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        const subfolderPath = path.join(folderPath, entry.name);
        const subEntries = await fs.readdir(subfolderPath, { withFileTypes: true });

        for (const subEntry of subEntries) {
          if (subEntry.isFile()) {
            const ext = path.extname(subEntry.name).toLowerCase();
            if (imageExtensions.includes(ext)) {
              const traits = [{ name: traitName, value: entry.name }];
              await this.addFileToCollection(subfolderPath, subEntry.name, ext, traits);
              progressCallback();
            }
          }
        }
      }
    }
  }

  private async loadTwoLevelFiles(folderPath: string, imageExtensions: string[], progressCallback: () => void) {
    const entries = await fs.readdir(folderPath, { withFileTypes: true });
    const level1TraitName = this._collectionConfig.traitMapping?.level1TraitName || 'Category';
    const level2TraitName = this._collectionConfig.traitMapping?.level2TraitName || 'Variant';

    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        const level1Path = path.join(folderPath, entry.name);
        const level1Entries = await fs.readdir(level1Path, { withFileTypes: true });

        for (const level1Entry of level1Entries) {
          if (level1Entry.isDirectory() && !level1Entry.name.startsWith('.')) {
            const level2Path = path.join(level1Path, level1Entry.name);
            const level2Entries = await fs.readdir(level2Path, { withFileTypes: true });

            for (const level2Entry of level2Entries) {
              if (level2Entry.isFile()) {
                const ext = path.extname(level2Entry.name).toLowerCase();
                if (imageExtensions.includes(ext)) {
                  const traits = [
                    { name: level1TraitName, value: entry.name },
                    { name: level2TraitName, value: level1Entry.name }
                  ];
                  await this.addFileToCollection(level2Path, level2Entry.name, ext, traits);
                  progressCallback();
                }
              }
            }
          } else if (level1Entry.isFile()) {
            // Handle files directly in level 1 folders (treat as single trait)
            const ext = path.extname(level1Entry.name).toLowerCase();
            if (imageExtensions.includes(ext)) {
              const traits = [{ name: level1TraitName, value: entry.name }];
              await this.addFileToCollection(level1Path, level1Entry.name, ext, traits);
              progressCallback();
            }
          }
        }
      }
    }
  }

  private async addFileToCollection(
    filePath: string,
    fileName: string,
    ext: string,
    traits: Array<{ name: string; value: string; }>
  ) {
    const fullPath = path.join(filePath, fileName);
    const stats = await fs.stat(fullPath);

    // Don't load image data here - we'll load it lazily when needed
    const contentType = this.getContentType(ext);

    this._files.push({
      id: crypto.randomUUID(),
      path: fullPath,
      name: fileName,
      dataUrl: undefined, // Will be loaded lazily
      contentType,
      size: stats.size,
      selected: true,
      metadata: {
        name: path.parse(fileName).name,
        traits
      }
    });
  }

  private getContentType(ext: string): string {
    const map: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.webp': 'image/webp'
    };
    return map[ext] || 'image/png';
  }

  private updateFileSelection(fileId: string, selected: boolean) {
    const file = this._files.find(f => f.id === fileId);
    if (file) {
      file.selected = selected;
      this.sendUpdate();
      this.saveCollectionState();
    }
  }

  private updateFileMetadata(fileId: string, metadata: Partial<CollectionItemMetadata>) {
    const file = this._files.find(f => f.id === fileId);
    if (file) {
      file.metadata = { ...file.metadata, ...metadata } as CollectionItemMetadata;
      this.sendUpdate();
      this.saveCollectionState();
    }
  }

  private sendUpdate() {
    this._panel.webview.postMessage({
      command: 'update',
      files: this._files,
      collectionConfig: this._collectionConfig,
      selectedFolder: this._selectedFolder
    });
  }

  /**
   * Load collection state from collectionsState service
   */
  private async loadCollectionState() {
    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'Loading Collection',
      cancellable: false
    }, async (progress) => {
      progress.report({ increment: 0, message: 'Reading collection data...' });

      const collection = collectionsState.getCollection(this._collectionId);

      if (collection) {
        progress.report({ increment: 50, message: `Loading ${collection.files.length} items...` });

        this._selectedFolder = collection.selectedFolder;
        this._files = collection.files;
        this._collectionConfig = collection.config;

        console.log(`[CollectionMinter] Loaded collection ${this._collectionId}:`, {
          name: collection.config.name,
          fileCount: collection.files.length,
          status: collection.status
        });

        progress.report({ increment: 100, message: 'Complete!' });

        // Send loaded data to webview
        this.sendUpdate();

        // Auto-save to migrate old collections (strips base64 data if present)
        if (collection.files.some(f => f.dataUrl)) {
          console.log(`[CollectionMinter] Migrating collection to remove embedded images...`);
          this.saveCollectionState();
          vscode.window.showInformationMessage(
            'Collection migrated to new format for faster loading. File size reduced significantly.'
          );
        }
      } else {
        console.log(`[CollectionMinter] New collection ${this._collectionId}, starting with empty state`);
      }
    });
  }

  /**
   * Save collection state to collectionsState service
   * Debounced to avoid excessive writes (500ms)
   */
  private saveCollectionState() {
    // Clear existing timeout
    if (this._saveDebounceTimeout) {
      clearTimeout(this._saveDebounceTimeout);
    }

    // Set new timeout
    this._saveDebounceTimeout = setTimeout(() => {
      try {
        collectionsState.updateCollection(this._collectionId, {
          config: this._collectionConfig as CollectionConfig,
          selectedFolder: this._selectedFolder,
          files: this._files
        });

        console.log(`[CollectionMinter] Saved collection ${this._collectionId}`);
      } catch (error) {
        console.error('[CollectionMinter] Failed to save collection state:', error);
        vscode.window.showErrorMessage(
          `Failed to save collection: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }, 500);
  }

  private checkAIAvailable() {
    // Check for API key in environment variable or settings
    const apiKey = process.env.OPENAI_API_KEY ||
                   vscode.workspace.getConfiguration('bitcoin.ai').get<string>('openaiApiKey');

    const hasEnvKey = !!process.env.OPENAI_API_KEY;
    const hasConfigKey = !!vscode.workspace.getConfiguration('bitcoin.ai').get<string>('openaiApiKey');

    this._panel.webview.postMessage({
      command: 'aiAvailability',
      available: !!apiKey,
      hasEnvKey,
      hasConfigKey
    });
  }

  private async autoAssignTraits() {
    const selectedFiles = this._files.filter(f => f.selected);
    const { rarityLabels, traits } = this._collectionConfig;

    if (!rarityLabels || rarityLabels.length === 0) {
      vscode.window.showWarningMessage('Please define rarity labels first');
      return;
    }

    // Validate percentages add up to 100
    const rarityTotal = rarityLabels.reduce((sum, r) => sum + (parseFloat(r.percentage) || 0), 0);
    if (Math.abs(rarityTotal - 100) > 0.01) {
      vscode.window.showWarningMessage('Rarity percentages must add up to 100%');
      return;
    }

    // Use AI to intelligently assign traits and rarities
    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'AI Assignment',
      cancellable: false
    }, async (progress) => {
      try {
        progress.report({ increment: 0, message: 'Analyzing collection...' });

        // Get OpenAI API key
        const apiKey = process.env.OPENAI_API_KEY ||
                       vscode.workspace.getConfiguration('bitcoin.ai').get<string>('openaiApiKey');

        if (!apiKey) {
          vscode.window.showErrorMessage('OpenAI API key not configured. Please set OPENAI_API_KEY environment variable or bitcoin.ai.openaiApiKey in settings.');
          return;
        }

        // Build context for AI
        const itemsContext = selectedFiles.map(file => {
          // Extract folder hierarchy from path
          const relativePath = this._selectedFolder ? file.path.replace(this._selectedFolder, '') : file.path;
          const pathParts = relativePath.split(path.sep).filter(p => p && !p.startsWith('.'));

          return {
            id: file.id,
            fileName: file.name,
            nameWithoutExt: path.parse(file.name).name,
            folderPath: pathParts.slice(0, -1).join('/'),
            existingTraits: file.metadata?.traits || [],
            existingRarity: file.metadata?.rarityLabel || null,
            existingDescription: file.metadata?.description || null
          };
        });

        progress.report({ increment: 20, message: 'Requesting AI analysis...' });

        // Call OpenAI
        const OpenAI = (await import('openai')).default;
        const openai = new OpenAI({ apiKey });

        const systemPrompt = `You are an expert in NFT collection curation and design. Your task is to intelligently assign rarity labels and traits to collection items based on semantic analysis and context.

You will receive:
1. Collection metadata (name, description)
2. Available rarity labels with target percentages
3. Available trait definitions with possible values
4. List of all items with their file names, folder structure, and any existing assignments

CRITICAL RARITY ASSIGNMENT RULES:
1. **Semantic Indicators**: Look for words/phrases that indicate rarity:
   - LEGENDARY/EPIC/MYTHIC indicators: "golden", "diamond", "platinum", "legendary", "epic", "mythic", "supreme", "ultimate", "divine", "celestial"
   - RARE indicators: "special", "unique", "premium", "elite", "champion", "hero", "master", "royal"
   - UNCOMMON indicators: "enhanced", "improved", "advanced", "superior", "polished"
   - COMMON: simple, plain names without special descriptors

2. **Contextual Analysis**:
   - More descriptive/complex names = higher rarity (e.g., "Golden Dragon Knight" > "Dragon" > "Knight" > "Basic")
   - Items in special folders (like "legendary/", "rare/") = match folder rarity
   - Lower numbered items (#1-10) are often more desirable
   - Items with prefixes/suffixes like "X", "Plus", "Pro" = higher rarity

3. **Pattern Recognition**:
   - If most items are simple (e.g., "apple", "banana"), those with descriptors are rarer (e.g., "golden apple", "diamond banana")
   - Unique combinations are rarer than single-word names
   - Items with special characters (★, ⚡, etc.) = higher rarity

4. **Distribution**: Match target percentages as closely as possible

5. **Preserve Manual Assignments**: If an item already has rarity/traits assigned, keep them

EXAMPLES OF GOOD ASSIGNMENTS:
- "golden apple" → Legendary (has "golden" indicator)
- "apple" → Common (simple, no descriptors)
- "Diamond Sword #1" → Legendary (has "diamond" + low number)
- "Iron Sword #523" → Common (common material + high number)
- "Enhanced Shield" → Uncommon (has "enhanced" descriptor)

Return a JSON object with this EXACT structure:
{
  "assignments": [
    {
      "id": "file-id-here",
      "rarityLabel": "Common",
      "traits": [
        { "name": "TraitName", "value": "TraitValue" }
      ],
      "reasoning": "Brief explanation of semantic/contextual indicators found"
    }
  ],
  "summary": "Brief overview of your assignment strategy and key patterns identified"
}`;

        const userPrompt = `Collection Name: ${this._collectionConfig.name || 'Untitled Collection'}
Collection Description: ${this._collectionConfig.description || 'No description'}

Available Rarity Labels (match these percentages as closely as possible):
${rarityLabels.map(r => `- ${r.label}: ${r.percentage}%`).join('\n')}

${traits && traits.length > 0 ? `Available Traits:
${traits.map(t => `- ${t.name}: ${t.values.join(', ')} (percentages: ${t.occurancePercentages.join(', ')}%)`).join('\n')}` : 'No additional traits defined.'}

Collection Items (${itemsContext.length} total):
${JSON.stringify(itemsContext, null, 2)}

TASK: Analyze this collection using SEMANTIC ANALYSIS and CONTEXTUAL PATTERNS.

Key Analysis Steps:
1. **Scan all file names** for rarity indicator words (golden, diamond, legendary, rare, special, etc.)
2. **Identify patterns** (numbered series, folder-based grouping, naming conventions)
3. **Compare complexity** (multi-word names vs single words, descriptive vs plain)
4. **Look for special features** (numbers, special characters, unique combinations)
5. **Assign rarities** based on semantic meaning, NOT random distribution
6. **Match target percentages** by assigning the most items with common indicators to Common, fewer with rare indicators to higher rarities

Remember: "golden apple" should be MUCH rarer than "apple" because "golden" is a semantic indicator of higher value/rarity!`;

        const completion = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.7,
          response_format: { type: 'json_object' }
        });

        progress.report({ increment: 60, message: 'Applying assignments...' });

        const result = completion.choices[0]?.message?.content;
        if (!result) {
          throw new Error('No response from AI');
        }

        const aiResponse = JSON.parse(result);

        if (!aiResponse.assignments || !Array.isArray(aiResponse.assignments)) {
          throw new Error('Invalid AI response format');
        }

        // Apply assignments
        let assignedCount = 0;
        for (const assignment of aiResponse.assignments) {
          const file = selectedFiles.find(f => f.id === assignment.id);
          if (file) {
            file.metadata = {
              ...file.metadata,
              name: file.metadata?.name || path.parse(file.name).name,
              rarityLabel: assignment.rarityLabel,
              traits: assignment.traits || []
            };
            assignedCount++;
          }
        }

        progress.report({ increment: 100, message: 'Complete!' });

        this.sendUpdate();
        this.saveCollectionState();

        // Send completion message to frontend
        this._panel.webview.postMessage({
          command: 'assignmentComplete',
          success: true,
          message: `AI assigned rarities and traits to ${assignedCount} items. ${aiResponse.summary || ''}`
        });

        vscode.window.showInformationMessage(
          `AI assigned rarities and traits to ${assignedCount} items. ${aiResponse.summary || ''}`
        );

      } catch (error) {
        // Send error message to frontend
        this._panel.webview.postMessage({
          command: 'assignmentComplete',
          success: false,
          message: `AI assignment failed: ${error instanceof Error ? error.message : String(error)}`
        });

        vscode.window.showErrorMessage(
          `AI assignment failed: ${error instanceof Error ? error.message : String(error)}`
        );
        console.error('AI assignment error:', error);
      }
    });
  }

  private async handleAIGeneration(type: 'rarities' | 'traits', prompt: string, collectionName: string, requestId: string) {
    try {
      // Build the system prompt based on type
      const systemPrompt = type === 'rarities'
        ? `You are an expert in NFT collection design. Generate rarity labels for an NFT collection based on the user's requirements.

Return a JSON object with this exact structure:
{
  "rarityLabels": [
    { "label": "Common", "percentage": "60" },
    { "label": "Rare", "percentage": "40" }
  ]
}

Requirements:
- Percentages must be whole numbers (no decimals) that sum to exactly 100
- Use descriptive, appealing rarity names
- Include 3-6 rarity tiers typically
- Higher rarities should have lower percentages`
        : `You are an expert in NFT collection design. Generate trait definitions for an NFT collection based on the user's requirements.

Return a JSON object with this exact structure:
{
  "traits": [
    {
      "name": "Background",
      "values": ["Blue", "Red", "Green"],
      "occurancePercentages": ["40", "35", "25"]
    }
  ]
}

Requirements:
- Each trait must have a descriptive name
- Each trait should have 3-8 possible values
- Percentages for each trait must be whole numbers that sum to exactly 100
- Create 3-6 traits typically
- Make trait values creative and thematic`;

      const userPrompt = `Collection Name: ${collectionName}

User Instructions: ${prompt}

Generate the appropriate ${type} structure based on these instructions. Respond ONLY with valid JSON, no additional text.`;

      // Get OpenAI API key from environment variable or settings
      // Prioritize environment variable for easier setup
      const apiKey = process.env.OPENAI_API_KEY ||
                     vscode.workspace.getConfiguration('bitcoin.ai').get<string>('openaiApiKey');

      if (!apiKey) {
        throw new Error('OpenAI API key not configured. Please set OPENAI_API_KEY environment variable or bitcoin.ai.openaiApiKey in settings.');
      }

      // Call OpenAI API
      const OpenAI = (await import('openai')).default;
      const openai = new OpenAI({ apiKey });

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.7,
        response_format: { type: 'json_object' }
      });

      const result = completion.choices[0]?.message?.content;

      if (!result) {
        throw new Error('No response from AI');
      }

      // Parse the result
      let parsedData;
      try {
        // Extract JSON from markdown code blocks if present
        const jsonMatch = result.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/) || result.match(/(\{[\s\S]*\})/);
        const jsonString = jsonMatch ? jsonMatch[1] : result;
        parsedData = JSON.parse(jsonString);
      } catch (parseError) {
        console.error('Failed to parse AI response:', result);
        throw new Error('Invalid JSON response from AI');
      }

      // Validate the structure
      if (type === 'rarities') {
        if (!parsedData.rarityLabels || !Array.isArray(parsedData.rarityLabels)) {
          throw new Error('Invalid rarity structure');
        }

        // Validate percentages sum to 100
        const total = parsedData.rarityLabels.reduce((sum: number, r: any) => sum + parseFloat(r.percentage), 0);
        if (Math.abs(total - 100) > 0.1) {
          // Auto-adjust to sum to 100
          const adjustment = 100 - total;
          const largestIndex = parsedData.rarityLabels.reduce((maxIdx: number, r: any, idx: number, arr: any[]) =>
            parseFloat(r.percentage) > parseFloat(arr[maxIdx].percentage) ? idx : maxIdx, 0);
          parsedData.rarityLabels[largestIndex].percentage =
            (parseFloat(parsedData.rarityLabels[largestIndex].percentage) + adjustment).toFixed(0);
        }
      } else {
        if (!parsedData.traits || !Array.isArray(parsedData.traits)) {
          throw new Error('Invalid traits structure');
        }

        // Validate each trait's percentages sum to 100
        for (const trait of parsedData.traits) {
          const total = trait.occurancePercentages.reduce((sum: number, p: string) => sum + parseFloat(p), 0);
          if (Math.abs(total - 100) > 0.1) {
            const adjustment = 100 - total;
            const largestIndex = trait.occurancePercentages.reduce((maxIdx: number, p: string, idx: number, arr: string[]) =>
              parseFloat(p) > parseFloat(arr[maxIdx]) ? idx : maxIdx, 0);
            trait.occurancePercentages[largestIndex] =
              (parseFloat(trait.occurancePercentages[largestIndex]) + adjustment).toFixed(0);
          }
        }
      }

      // Send success response
      this._panel.webview.postMessage({
        command: 'aiGenerationResult',
        requestId,
        data: parsedData
      });

    } catch (error) {
      console.error('AI generation error:', error);
      this._panel.webview.postMessage({
        command: 'aiGenerationResult',
        requestId,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      });
    }
  }

  private async mintCollection() {
    try {
      // Validate configuration
      const { name, description, quantity, rarityLabels, traits } = this._collectionConfig;

      if (!name || !description) {
        vscode.window.showErrorMessage('Please provide a collection name and description');
        return;
      }

      const selectedFiles = this._files.filter(f => f.selected);
      if (selectedFiles.length === 0) {
        vscode.window.showErrorMessage('No files selected for minting');
        return;
      }

      // Get autoBroadcast setting
      const autoBroadcast = vscode.workspace.getConfiguration('bitcoin.wallet').get('autoBroadcast', false);

      // Get ordinals key
      const ordinalsKey = await this._vault.getOrdinalsKey();
      if (!ordinalsKey || ordinalsKey.type !== 'wif') {
        vscode.window.showErrorMessage('Ordinals key not found or invalid');
        return;
      }

      // Get funding key for payment
      const fundingKey = await this._vault.getFundingKey();
      if (!fundingKey || fundingKey.type !== 'wif') {
        vscode.window.showErrorMessage('Funding key not found. Please designate a funding key.');
        return;
      }

      // Show progress
      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Minting Collection',
        cancellable: false
      }, async (progress) => {
        progress.report({ increment: 0, message: 'Preparing collection...' });

        // Import required modules
        const { PrivateKey } = await import('@bsv/sdk');
        const {
          createOrdinals,
          fetchPayUtxos,
          stringifyMetaData
        } = await import('js-1sat-ord');
        const { ordinalsService } = await import('../../services/ordinalsService');

        const ordPk = PrivateKey.fromWif(ordinalsKey.value);
        const paymentPk = PrivateKey.fromWif(fundingKey.value);
        const ordAddress = ordinalsService.deriveOrdAddress(ordinalsKey.value);
        const payAddress = paymentPk.toAddress();

        // Fetch payment UTXOs
        progress.report({ increment: 10, message: 'Fetching UTXOs...' });
        const paymentUtxos = await fetchPayUtxos(payAddress, 'base64');

        if (paymentUtxos.length === 0) {
          vscode.window.showErrorMessage('No payment UTXOs available. Please fund your wallet.');
          return;
        }

        // Step 1: Create collection inscription
        progress.report({ increment: 20, message: 'Creating collection inscription...' });

        // Helper function to convert percentage string to decimal format (0.0000-1.0000)
        const toDecimalPercentage = (percentage: string): string => {
          const num = parseFloat(percentage);
          if (isNaN(num)) return '0.0000';
          // Convert from 0-100 range to 0-1 range with 4 decimal places
          return (num / 100).toFixed(4);
        };

        // Normalize percentages to ensure they sum to exactly 1.0000 (like 1sat-website does)
        const normalizePercentages = (percentages: string[]): string[] => {
          const decimals = percentages.map(toDecimalPercentage);
          const sum = decimals.reduce((acc, val) => acc + parseFloat(val), 0);

          if (Math.abs(sum - 1.0) < 0.0001) {
            return decimals; // Already correct
          }

          // Adjust largest value to make total exactly 1.0000
          const remainder = 1.0 - sum;
          const largestIndex = decimals.reduce((maxIdx, val, idx, arr) =>
            parseFloat(val) > parseFloat(arr[maxIdx]) ? idx : maxIdx, 0);

          decimals[largestIndex] = (parseFloat(decimals[largestIndex]) + remainder).toFixed(4);
          return decimals;
        };

        // Build collection traits in the format expected by js-1sat-ord
        const collectionTraits: Record<string, { values: string[]; occurancePercentages: string[] }> = {};
        if (traits && traits.length > 0) {
          for (const trait of traits) {
            collectionTraits[trait.name] = {
              values: trait.values,
              // Convert and normalize percentages to sum exactly 1.0000
              occurancePercentages: normalizePercentages(trait.occurancePercentages)
            };
          }
        }

        // Build rarity labels array with normalized decimal percentages
        let rarityLabelsArray: Array<{ [key: string]: string }> = [];
        if (rarityLabels && rarityLabels.length > 0) {
          const normalizedRarities = normalizePercentages(rarityLabels.map(r => r.percentage));
          rarityLabelsArray = rarityLabels.map((r, i) => ({
            [r.label]: normalizedRarities[i]
          }));
        }

        const collectionMetadata = {
          app: 'vscode-bitcoin',
          type: 'ord' as const,
          name: name,
          subType: 'collection' as const,
          subTypeData: {
            description: description || '',
            quantity: quantity || selectedFiles.length,
            rarityLabels: rarityLabelsArray,
            traits: collectionTraits
          }
        };

        // Stringify the metadata
        const collectionMetaData = stringifyMetaData(collectionMetadata);

        // Create collection inscription
        const collectionResult = await createOrdinals({
          utxos: paymentUtxos,
          destinations: [{
            address: ordAddress
          }],
          paymentPk,
          metaData: collectionMetaData
        });

        const collectionTxHex = collectionResult.tx.toHex();

        // Broadcast collection or load into decoder
        let collectionOrigin: string;
        if (autoBroadcast) {
          progress.report({ increment: 10, message: 'Broadcasting collection inscription...' });
          const { transactionService } = await import('../../services/transactionService');
          const broadcastResult = await transactionService.broadcastTransaction(collectionTxHex);

          if (broadcastResult.status !== 'success' || !broadcastResult.txid) {
            vscode.window.showErrorMessage(`Failed to broadcast collection: ${broadcastResult.message}`);
            return;
          }

          collectionOrigin = `${broadcastResult.txid}_0`;
          vscode.window.showInformationMessage(`Collection inscription broadcast: ${broadcastResult.txid}`);
        } else {
          // Load into transaction decoder for review
          vscode.commands.executeCommand('bitcoin.openTransactionDecoder', collectionTxHex);
          vscode.window.showInformationMessage(
            'Collection inscription created. Review in the Transaction Decoder and broadcast when ready. After broadcasting, you can mint the items by providing the collection origin (txid_0).'
          );
          return;
        }

        // Wait a moment for the transaction to propagate
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Step 2: Mint collection items in batches
        progress.report({ increment: 20, message: 'Minting collection items...' });

        const batchSize = this._collectionConfig.batchSize || 8;
        const totalItems = selectedFiles.length;
        const totalBatches = Math.ceil(totalItems / batchSize);

        vscode.window.showInformationMessage(
          `Starting mint: ${totalItems} items in ${totalBatches} batch${totalBatches !== 1 ? 'es' : ''} (${batchSize} items per batch)`
        );

        const itemTxs: string[] = [];

        // Process items in batches
        for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
          const batchStart = batchIndex * batchSize;
          const batchEnd = Math.min(batchStart + batchSize, totalItems);
          const batchItems = selectedFiles.slice(batchStart, batchEnd);

          progress.report({
            increment: (40 / totalBatches),
            message: `Processing batch ${batchIndex + 1}/${totalBatches}...`
          });

          // Process each item in the current batch
          for (let i = 0; i < batchItems.length; i++) {
            const globalIndex = batchStart + i;
            const file = batchItems[i];
            const fileMetadata = file.metadata;

            progress.report({
              message: `Batch ${batchIndex + 1}/${totalBatches}: Item ${i + 1}/${batchItems.length} (${globalIndex + 1}/${totalItems} total)`
            });

            // Fetch fresh UTXOs for each item
            const itemPaymentUtxos = await fetchPayUtxos(payAddress, 'base64');
            if (itemPaymentUtxos.length === 0) {
              vscode.window.showWarningMessage(`Insufficient funds to mint item ${globalIndex + 1}. Stopping.`);
              break;
            }

            // Build item traits (just name and value, no percentage on items)
            const itemTraits = fileMetadata?.traits?.map(t => ({
              name: t.name,
              value: t.value
            })) || [];

            // Read file data
            const fileBuffer = await fs.readFile(file.path);
            const fileDataB64 = fileBuffer.toString('base64');

            // Rarity label for item is just the string (e.g. "Common")
            const itemRarityLabel = fileMetadata?.rarityLabel || undefined;

            const itemMetadata = {
              app: 'vscode-bitcoin',
              type: 'ord' as const,
              name: fileMetadata?.name || file.name,
              subType: 'collectionItem' as const,
              subTypeData: {
                collectionId: collectionOrigin,
                mintNumber: globalIndex + 1,
                rarityLabel: itemRarityLabel,
                traits: itemTraits
              }
            };

            const itemMetaData = stringifyMetaData(itemMetadata);

            // Create item inscription
            const itemResult = await createOrdinals({
              utxos: itemPaymentUtxos,
              destinations: [{
                address: ordAddress,
                inscription: {
                  dataB64: fileDataB64,
                  contentType: file.contentType
                }
              }],
              paymentPk,
              metaData: itemMetaData
            });

            const itemTxHex = itemResult.tx.toHex();
            itemTxs.push(itemTxHex);

            // Broadcast item
            if (autoBroadcast) {
              const { transactionService } = await import('../../services/transactionService');
              const itemBroadcastResult = await transactionService.broadcastTransaction(itemTxHex);

              if (itemBroadcastResult.status !== 'success' || !itemBroadcastResult.txid) {
                vscode.window.showWarningMessage(`Failed to broadcast item ${globalIndex + 1}: ${itemBroadcastResult.message}`);
              } else {
                vscode.window.showInformationMessage(`Batch ${batchIndex + 1}: Item ${i + 1} minted: ${itemBroadcastResult.txid}`);
              }
            }

            // Small delay between items
            await new Promise(resolve => setTimeout(resolve, 1000));
          }

          // Longer delay between batches to improve origin indexing
          if (batchIndex < totalBatches - 1) {
            progress.report({
              message: `Batch ${batchIndex + 1} complete. Waiting before next batch...`
            });
            await new Promise(resolve => setTimeout(resolve, 3000));
          }
        }

        progress.report({ increment: 100, message: 'Complete!' });

        if (!autoBroadcast && itemTxs.length > 0) {
          // If not auto-broadcasting, open the first item transaction in decoder
          vscode.commands.executeCommand('bitcoin.openTransactionDecoder', itemTxs[0]);
          vscode.window.showInformationMessage(
            `Created ${itemTxs.length} collection item transactions. Review and broadcast them manually. Collection origin: ${collectionOrigin}`
          );
        } else {
          // Save minted state
          collectionsState.updateCollection(this._collectionId, {
            status: 'minted',
            mintedTxId: collectionOrigin.split('_')[0], // Extract txid from origin
            mintedItemCount: selectedFiles.length
          });

          vscode.window.showInformationMessage(
            `Collection minted successfully! ${selectedFiles.length} items created.`
          );
        }
      });
    } catch (error) {
      vscode.window.showErrorMessage(
        `Error minting collection: ${error instanceof Error ? error.message : String(error)}`
      );
      console.error('Minting error:', error);
    }
  }

  public dispose() {
    // Clear debounce timeout and save immediately if needed
    if (this._saveDebounceTimeout) {
      clearTimeout(this._saveDebounceTimeout);
      this._saveDebounceTimeout = null;
    }

    // Perform final save on dispose
    try {
      collectionsState.updateCollection(this._collectionId, {
        config: this._collectionConfig as CollectionConfig,
        selectedFolder: this._selectedFolder,
        files: this._files
      });
      console.log(`[CollectionMinter] Final save on dispose for collection ${this._collectionId}`);
    } catch (error) {
      console.error('[CollectionMinter] Failed to save on dispose:', error);
    }

    CollectionMinterPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const disposable = this._disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 16; i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}
