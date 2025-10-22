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
  // Internal pipeline tracking (NOT written to ordinal)
  _transformedPath?: string; // Target path after pipeline transformations
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

// Transformation rule types
export interface RenamePattern {
  type: 'prefix-remove' | 'suffix-remove' | 'replace' | 'regex-replace';
  pattern: string;
  replacement?: string;
}

export interface FilenamePattern {
  type: 'prefix' | 'suffix' | 'contains' | 'regex';
  pattern: string;
  targetField: string;
  matchValue?: string;
}

export interface NameStandardization {
  enabled: boolean;
  template: string;
}

export interface TransformationRule {
  id: string;
  enabled: boolean;
  scope: {
    type: 'root' | 'folder' | 'file-pattern';
    pattern?: string; // For folder paths or file patterns (glob or regex)
  };
  transforms: {
    renamePatterns?: RenamePattern[];
    filenamePatterns?: FilenamePattern[];
    nameStandardization?: NameStandardization;
  };
}

export interface ExclusionRule {
  id: string;
  enabled: boolean;
  type: 'folder' | 'file' | 'pattern';
  pattern: string; // Path, glob, or regex
  reason?: string;
}

// Pipeline operation types
export type PipelineOperation =
  | { type: 'exclude'; path: string; reason: string; }
  | { type: 'move'; from: string; to: string; reason?: string; }
  | { type: 'rename-folder'; from: string; to: string; reason?: string; }
  | {
      type: 'transform';
      scope: string | 'all'; // Folder path or 'all' for global
      renamePatterns: RenamePattern[];
      reason?: string;
    }
  | {
      type: 'map-traits';
      scope: string | 'all';
      filenamePatterns: FilenamePattern[];
      reason?: string;
    }
  | {
      type: 'map-folders';
      scope: string | 'all';
      traitMapping: {
        level1TraitName?: string;
        level2TraitName?: string;
        folderAsItemName?: boolean;
      };
      reason?: string;
    }
  | {
      type: 'standardize-names';
      scope: string | 'all';
      nameStandardization: NameStandardization;
      reason?: string;
    }
  | {
      type: 'compress';
      scope: string | 'all';
      quality: number; // 1-100
      maxWidth?: number;
      maxHeight?: number;
      format?: 'jpeg' | 'png' | 'webp';
      reason?: string;
    }
  | {
      type: 'filter';
      scope: string | 'all';
      rules: Array<{
        field: string; // 'itemName', 'rarity', trait name, 'fileName', 'folderName'
        operator: 'equals' | 'contains' | 'startsWith' | 'endsWith' | 'regex';
        value: string;
        action: 'include' | 'exclude';
      }>;
      reason?: string;
    }
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
    };

export interface Pipeline {
  operations: PipelineOperation[];
  reasoning: string; // Overall strategy explanation
  warnings?: string[];
}

// Folder tree structure for AI
export interface FolderNode {
  name: string;
  type: 'folder' | 'file';
  path: string;
  children: FolderNode[];
}

// Pipeline simulation result
export interface PipelineStepResult {
  stepNumber: number;
  operation: PipelineOperation;
  filesAffected: number;
  changes: Array<{
    originalPath: string;
    newPath: string;
    action: 'excluded' | 'moved' | 'renamed' | 'transformed';
  }>;
  structureAfter: FolderNode; // Tree structure after this step
}

export interface PipelineSimulationResult {
  success: boolean;
  steps: PipelineStepResult[];
  finalPreview: Array<{
    before: string;
    after: string;
    allSteps: string[]; // Transformation applied at each step
  }>;
  structureBefore: FolderNode;
  structureAfter: FolderNode;
  totalFilesAffected: number;
  filesExcluded: number;
}

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
  batchSize?: number;
  aiPromptContext?: string;  // Optional user-provided context for AI configuration

  // Legacy simple rules (kept for backward compatibility)
  renamePatterns?: RenamePattern[];
  filenamePatterns?: FilenamePattern[];
  nameStandardization?: NameStandardization;

  // Enhanced rule system
  rootTransformations?: TransformationRule[];
  folderTransformations?: TransformationRule[];
  exclusions?: ExclusionRule[];

  // Pipeline system (replaces legacy rules)
  pipeline?: Pipeline;

  // Workspace settings
  workspaceFolder?: string; // Where to create duplicate structure (default: ~/.bitcoin/collections/<id>)
  useTransformedFiles?: boolean; // Whether to use transformed duplicates for minting
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
  private _outputSettings: any = {}; // Image processing settings from Output tab

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
      async (msg) => {
        try {
          await this.handleMessage(msg);
        } catch (error) {
          console.error('[CollectionMinter] Error handling message:', error);
          vscode.window.showErrorMessage(`Error: ${error instanceof Error ? error.message : String(error)}`);
        }
      },
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
    // Only log non-loadImage commands to reduce noise
    if (msg.command !== 'loadImage' && msg.command !== 'updateConfig') {
      console.log(`[CollectionMinter ${new Date().toISOString()}] handleMessage:`, msg.command);
    }

    if (!msg || !msg.command) {
      console.error('[CollectionMinter] Invalid message:', msg);
      return;
    }

    switch (msg.command) {
      case 'selectFolder':
        await this.selectFolder();
        break;

      case 'loadFiles':
        await this.loadFilesFromFolder();
        break;

      case 'reloadFiles':
        await this.loadFilesFromFolder();
        break;

      case 'updateFileSelection':
        if (msg.fileId && typeof msg.selected === 'boolean') {
          this.updateFileSelection(msg.fileId, msg.selected);
        }
        break;

      case 'updateConfig':
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
        console.log(`[CollectionMinter ${new Date().toISOString()}] ✅ MINT COMMAND RECEIVED - Starting minting process`);
        // Store output settings if provided
        if (msg.outputSettings) {
          this._outputSettings = msg.outputSettings;
          console.log('[CollectionMinter] Output settings received:', this._outputSettings);
        }
        // Send immediate acknowledgment to frontend
        this._panel.webview.postMessage({
          command: 'mintStarted',
          total: this._files.filter(f => f.selected).length
        });
        // Don't await - let it run in background to avoid blocking message handler
        this.mintCollection().catch(error => {
          console.error('[CollectionMinter] Background minting error:', error);
        });
        break;

      case 'autoAssignTraits':
        this.autoAssignTraits();
        break;

      case 'autoConfigureStructureMappings':
        this.autoConfigureStructureMappings(msg.userContext);
        break;

      case 'executePipeline':
        this.executePipeline();
        break;

      case 'applyStructureMappings':
        this.applyStructureMappings();
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

      case 'processImage':
        if (msg.fileId) {
          await this.processImage(msg.fileId, msg.options || {});
        }
        break;

      case 'openFileInEditor':
        if (msg.filePath) {
          // Use vscode.open command which handles both text and binary files (images, etc)
          await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(msg.filePath), {
            preview: false,
            viewColumn: vscode.ViewColumn.Beside
          });
        }
        break;

      case 'openTransaction':
        if (msg.txid) {
          // Open transaction in Transaction Decoder
          vscode.commands.executeCommand('bitcoin.decodeTransaction', msg.txid);
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

  /**
   * Process image with options using ImageUriProvider
   * Sends processed image back to webview
   */
  private async processImage(fileId: string, options: any) {
    const file = this._files.find(f => f.id === fileId);
    if (!file) {
      console.error(`[CollectionMinter] File not found: ${fileId}`);
      return;
    }

    try {
      console.log(`[CollectionMinter] Processing image: ${file.name}`, options);

      // Import ImageUriProvider
      const { ImageUriProvider } = await import('../../imageUriProvider');
      const imageUriProvider = new ImageUriProvider();

      // Process image
      const dataUrl = await imageUriProvider.processImageFromFileId(fileId, options);

      // Send processed image back to webview
      this._panel.webview.postMessage({
        command: 'imageProcessed',
        fileId,
        dataUrl,
        options
      });

      console.log(`[CollectionMinter] Processed image: ${file.name} (${(dataUrl.length / 1024).toFixed(1)} KB)`);
    } catch (error) {
      console.error(`[CollectionMinter] Failed to process image ${file.name}:`, error);
      this._panel.webview.postMessage({
        command: 'imageProcessError',
        fileId,
        error: String(error)
      });
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

  /**
   * Check if a file/folder should be excluded based on exclusion rules
   */
  private shouldExclude(relativePath: string, isDirectory: boolean): boolean {
    const exclusions = this._collectionConfig.exclusions || [];

    for (const rule of exclusions) {
      if (!rule.enabled) continue;

      const pathToCheck = relativePath;

      if (rule.type === 'folder' && isDirectory) {
        // Check if folder path matches
        if (pathToCheck === rule.pattern || pathToCheck.startsWith(rule.pattern + '/')) {
          return true;
        }
      } else if (rule.type === 'file' && !isDirectory) {
        // Check if file path matches
        if (pathToCheck === rule.pattern) {
          return true;
        }
      } else if (rule.type === 'pattern') {
        // Support glob patterns
        const pattern = rule.pattern;

        // Simple glob matching (**, *, ?)
        const regexPattern = pattern
          .replace(/\./g, '\\.')
          .replace(/\*\*/g, '.*')
          .replace(/\*/g, '[^/]*')
          .replace(/\?/g, '.');

        const regex = new RegExp(`^${regexPattern}$`);
        if (regex.test(pathToCheck)) {
          return true;
        }
      }
    }

    return false;
  }

  private async loadFlatFiles(folderPath: string, imageExtensions: string[], progressCallback: () => void) {
    const entries = await fs.readdir(folderPath, { withFileTypes: true });

    for (const entry of entries) {
      // Check exclusions
      if (this.shouldExclude(entry.name, entry.isDirectory())) {
        continue;
      }

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
      // Check if folder should be excluded
      if (this.shouldExclude(entry.name, entry.isDirectory())) {
        continue;
      }

      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        const subfolderPath = path.join(folderPath, entry.name);
        const subEntries = await fs.readdir(subfolderPath, { withFileTypes: true });

        for (const subEntry of subEntries) {
          // Check if file should be excluded
          const relativePath = path.join(entry.name, subEntry.name);
          if (this.shouldExclude(relativePath, subEntry.isDirectory())) {
            continue;
          }

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
      // Check if level 1 folder should be excluded
      if (this.shouldExclude(entry.name, entry.isDirectory())) {
        continue;
      }

      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        const level1Path = path.join(folderPath, entry.name);
        const level1Entries = await fs.readdir(level1Path, { withFileTypes: true });

        for (const level1Entry of level1Entries) {
          // Check if level 2 folder or file should be excluded
          const level1RelativePath = path.join(entry.name, level1Entry.name);
          if (this.shouldExclude(level1RelativePath, level1Entry.isDirectory())) {
            continue;
          }

          if (level1Entry.isDirectory() && !level1Entry.name.startsWith('.')) {
            const level2Path = path.join(level1Path, level1Entry.name);
            const level2Entries = await fs.readdir(level2Path, { withFileTypes: true });

            for (const level2Entry of level2Entries) {
              // Check if level 2 file should be excluded
              const level2RelativePath = path.join(entry.name, level1Entry.name, level2Entry.name);
              if (this.shouldExclude(level2RelativePath, level2Entry.isDirectory())) {
                continue;
              }

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

        // RECOVERY: If we have a selectedFolder but no files, reload from disk
        if (this._selectedFolder && this._files.length === 0) {
          console.log(`[CollectionMinter] Collection has folder but no files - reloading from ${this._selectedFolder}`);
          await this.loadFilesFromFolder();
          vscode.window.showInformationMessage(
            `Recovered ${this._files.length} files from ${this._selectedFolder}`
          );
        }

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

  /**
   * Get the workspace folder path for this collection
   */
  private getWorkspaceFolder(): string {
    const workspaceFolder = this._collectionConfig.workspaceFolder;
    if (workspaceFolder) {
      return workspaceFolder;
    }

    // Default: ~/.bitcoin/collections/<collection-id>
    const homeDir = require('os').homedir();
    return path.join(homeDir, '.bitcoin', 'collections', this._collectionId);
  }

  /**
   * Create duplicate file structure in workspace folder
   * This creates a safe copy of all files that will be transformed
   */
  private async createWorkspaceStructure(): Promise<void> {
    const workspaceFolder = this.getWorkspaceFolder();
    const selectedFiles = this._files.filter(f => f.selected);

    if (selectedFiles.length === 0) {
      throw new Error('No files selected');
    }

    if (!this._selectedFolder) {
      throw new Error('No source folder selected');
    }

    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'Creating Workspace Structure',
      cancellable: false
    }, async (progress) => {
      try {
        // Ensure workspace folder exists
        await fs.mkdir(workspaceFolder, { recursive: true });

        progress.report({ increment: 0, message: 'Copying files...' });

        let copied = 0;
        const total = selectedFiles.length;

        for (const file of selectedFiles) {
          // Get relative path from source folder
          const relativePath = file.path.replace(this._selectedFolder!, '').replace(/^\//, '');

          // Determine destination path in workspace
          const destPath = path.join(workspaceFolder, relativePath);
          const destDir = path.dirname(destPath);

          // Create destination directory if it doesn't exist
          await fs.mkdir(destDir, { recursive: true });

          // Copy file
          await fs.copyFile(file.path, destPath);

          copied++;
          progress.report({
            increment: (100 / total),
            message: `Copied ${copied}/${total} files...`
          });
        }

        // Save workspace folder path to config
        this._collectionConfig.workspaceFolder = workspaceFolder;
        this._collectionConfig.useTransformedFiles = true;
        await this.saveCollectionState();

        progress.report({ increment: 100, message: 'Complete!' });

        vscode.window.showInformationMessage(
          `Created workspace structure at: ${workspaceFolder}`
        );
      } catch (error) {
        throw new Error(`Failed to create workspace structure: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }

  /**
   * Clean/remove workspace structure
   */
  private async cleanWorkspaceStructure(): Promise<void> {
    const workspaceFolder = this.getWorkspaceFolder();

    try {
      const stats = await fs.stat(workspaceFolder);
      if (stats.isDirectory()) {
        await fs.rm(workspaceFolder, { recursive: true, force: true });

        this._collectionConfig.workspaceFolder = undefined;
        this._collectionConfig.useTransformedFiles = false;
        await this.saveCollectionState();

        vscode.window.showInformationMessage('Workspace structure cleaned');
      }
    } catch (error) {
      // Folder doesn't exist, that's fine
      if ((error as any).code !== 'ENOENT') {
        throw error;
      }
    }
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

        // Get AI configuration - use FAST model for trait analysis batch processing
        const config = vscode.workspace.getConfiguration('bitcoin.ai');
        const provider = config.get<string>('provider') || 'openai';

        // Get API key and FAST model based on provider (prioritize env vars)
        let apiKey: string | undefined;
        let model: string;

        if (provider === 'openai') {
          model = config.get<string>('openai.fastModel') || config.get<string>('openai.model') || 'gpt-5-mini';
          apiKey = process.env.OPENAI_API_KEY || config.get<string>('openai.apiKey');
        } else if (provider === 'anthropic') {
          model = config.get<string>('anthropic.fastModel') || config.get<string>('anthropic.model') || 'claude-haiku-4-5';
          apiKey = process.env.ANTHROPIC_API_KEY || config.get<string>('anthropic.apiKey');
        } else if (provider === 'xai') {
          model = config.get<string>('xai.fastModel') || config.get<string>('xai.model') || 'grok-3-mini';
          apiKey = process.env.XAI_API_KEY || config.get<string>('xai.apiKey');
        } else {
          vscode.window.showErrorMessage(`Unknown AI provider: ${provider}`);
          return;
        }

        if (!apiKey) {
          vscode.window.showErrorMessage(`${provider.toUpperCase()} API key not found. Set ${provider.toUpperCase()}_API_KEY environment variable or configure in settings.`);
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

        progress.report({ increment: 20, message: `Requesting ${provider} analysis...` });

        // Log input data for debugging
        console.log('[AI Rarity Assignment] ===== INPUT DATA =====');
        console.log(`[AI Rarity Assignment] Total items: ${itemsContext.length}`);
        console.log(`[AI Rarity Assignment] Items with existing rarity: ${itemsContext.filter(i => i.existingRarity).length}`);
        console.log(`[AI Rarity Assignment] Target distribution:`, rarityLabels.map(r => `${r.label}: ${r.percentage}%`).join(', '));
        console.log('[AI Rarity Assignment] Sample items (first 20):');
        itemsContext.slice(0, 20).forEach(item => {
          console.log(`  - "${item.nameWithoutExt}" (folder: ${item.folderPath || 'root'}, existing: ${item.existingRarity || 'none'})`);
        });

        // Import AI SDK and provider
        const { generateObject } = await import('ai');
        const { z } = await import('zod');
        let aiModel;

        if (provider === 'openai') {
          const { createOpenAI } = await import('@ai-sdk/openai');
          const openai = createOpenAI({ apiKey });
          aiModel = openai(model);
        } else if (provider === 'anthropic') {
          const { createAnthropic } = await import('@ai-sdk/anthropic');
          const anthropic = createAnthropic({ apiKey });
          aiModel = anthropic(model);
        } else if (provider === 'xai') {
          const { createXai } = await import('@ai-sdk/xai');
          const xai = createXai({ apiKey });
          aiModel = xai(model);
        }

        // Define schema for assignment output
        const assignmentSchema = z.object({
          assignments: z.array(z.object({
            id: z.string(),
            rarityLabel: z.string(),
            traits: z.array(z.object({
              name: z.string(),
              value: z.string()
            })),
            reasoning: z.string()
          })),
          summary: z.string()
        });

        const systemPrompt = `You are an expert in NFT collection curation and design. Your task is to intelligently assign rarity labels and traits to collection items based on semantic analysis and context.

You will receive:
1. Collection metadata (name, description)
2. Available rarity labels with target percentages
3. Available trait definitions with possible values
4. List of all items with their file names, folder structure, and any existing assignments

CRITICAL RARITY ASSIGNMENT RULES:

⚠️  **IMPORTANT**: Default to COMMON unless there are CLEAR semantic indicators of higher rarity!

1. **Semantic Indicators** (STRICT MATCHING REQUIRED):
   - LEGENDARY/EPIC/MYTHIC indicators: "golden", "diamond", "platinum", "legendary", "epic", "mythic", "supreme", "ultimate", "divine", "celestial", "transcendent"
   - RARE indicators: "special", "unique", "premium", "elite", "champion", "hero", "master", "royal", "ancient", "sacred"
   - UNCOMMON indicators: "enhanced", "improved", "advanced", "superior", "polished", "refined", "quality"
   - COMMON: **Everything else** - simple food items, basic objects, plain names without special descriptors

2. **Contextual Analysis**:
   - More descriptive/complex names = higher rarity (e.g., "Golden Dragon Knight" > "Dragon" > "Knight")
   - Items in special folders (like "legendary/", "rare/") = match folder rarity
   - Lower numbered items (#1-10) MAY be more desirable IF collection has numbered series
   - Items with prefixes/suffixes like "X", "Plus", "Pro" = higher rarity

3. **Pattern Recognition**:
   - If most items are simple (e.g., "apple", "banana", "bacon"), those with descriptors are rarer (e.g., "golden apple", "diamond bacon")
   - **BUT**: "apple" and "bacon" by themselves are COMMON - they need modifiers to be rare!
   - Unique combinations are rarer than single-word names
   - Items with special characters (★, ⚡, etc.) = higher rarity

4. **Distribution**: Match target percentages as closely as possible, but NEVER assign high rarity without semantic justification

5. **Preserve Manual Assignments**: If an item already has rarity/traits assigned, keep them

EXAMPLES OF CORRECT ASSIGNMENTS:
✅ "golden apple" → Legendary (has "golden" indicator word)
✅ "apple" → Common (simple food, no descriptors)
✅ "bacon" → Common (simple food, no descriptors)
✅ "Diamond Sword #1" → Legendary (has "diamond" + low number)
✅ "Iron Sword #523" → Common (common material + high number)
✅ "Enhanced Shield" → Uncommon (has "enhanced" descriptor)

EXAMPLES OF WRONG ASSIGNMENTS:
❌ "bacon" → Majestic (NO semantic indicator - this is a simple food item!)
❌ "apple" → Rare (NO semantic indicator - this is common)
❌ "sword" → Epic (NO semantic indicator - needs descriptor like "Epic Sword")

**DEFAULT BEHAVIOR**: When in doubt, assign COMMON. Only assign higher rarities when you can clearly identify semantic indicators in the name itself.

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

        // Process in batches to avoid output token limits
        const BATCH_SIZE = 200;
        const batches: typeof itemsContext[] = [];
        for (let i = 0; i < itemsContext.length; i += BATCH_SIZE) {
          batches.push(itemsContext.slice(i, i + BATCH_SIZE));
        }

        console.log(`[AI Rarity Assignment] Processing ${itemsContext.length} items in ${batches.length} batches of ${BATCH_SIZE}`);

        console.log(`[AI Rarity Assignment] Processing ${batches.length} batches in parallel`);

        // Process all batches in parallel
        const batchPromises = batches.map(async (batch, batchIndex) => {
          const batchStart = batchIndex * BATCH_SIZE;

          console.log(`[AI Rarity Assignment] Starting batch ${batchIndex + 1}/${batches.length}: ${batch.length} items`);

          const userPrompt = `Collection Name: ${this._collectionConfig.name || 'Untitled Collection'}
Collection Description: ${this._collectionConfig.description || 'No description'}

Available Rarity Labels (match these percentages as closely as possible):
${rarityLabels.map(r => `- ${r.label}: ${r.percentage}%`).join('\n')}

${traits && traits.length > 0 ? `Available Traits:
${traits.map(t => `- ${t.name}: ${t.values.join(', ')} (percentages: ${t.occurancePercentages.join(', ')}%)`).join('\n')}` : 'No additional traits defined.'}

Batch ${batchIndex + 1} of ${batches.length} (Items ${batchStart + 1}-${batchStart + batch.length} of ${itemsContext.length} total):
${JSON.stringify(batch, null, 2)}

TASK: Analyze this collection using SEMANTIC ANALYSIS and CONTEXTUAL PATTERNS.

Key Analysis Steps:
1. **Scan all file names** for rarity indicator words (golden, diamond, legendary, rare, special, etc.)
2. **Identify patterns** (numbered series, folder-based grouping, naming conventions)
3. **Compare complexity** (multi-word names vs single words, descriptive vs plain)
4. **Look for special features** (numbers, special characters, unique combinations)
5. **Assign rarities** based on semantic meaning, NOT random distribution
6. **Match target percentages** by assigning the most items with common indicators to Common, fewer with rare indicators to higher rarities

Remember: "golden apple" should be MUCH rarer than "apple" because "golden" is a semantic indicator of higher value/rarity!`;

          // Call AI for this batch
          const { object: batchResponse } = await generateObject({
            model: aiModel,
            system: systemPrompt,
            prompt: userPrompt,
            schema: assignmentSchema,
            temperature: 0.7
          });

          console.log(`[AI Rarity Assignment] Batch ${batchIndex + 1} complete: ${batchResponse.assignments.length} assignments`);

          // Report progress for this batch
          progress.report({
            increment: (60 / batches.length),
            message: `Completed batch ${batchIndex + 1}/${batches.length}`
          });

          return {
            assignments: batchResponse.assignments,
            summary: batchResponse.summary ? `Batch ${batchIndex + 1}: ${batchResponse.summary}` : null
          };
        });

        // Wait for all batches to complete
        const batchResults = await Promise.all(batchPromises);

        // Combine all batch results
        const allAssignments = batchResults.flatMap(r => r.assignments);
        const batchSummaries = batchResults.map(r => r.summary).filter(Boolean);

        const aiResponse = {
          assignments: allAssignments,
          summary: batchSummaries.join(' | ')
        };

        console.log(`[AI Rarity Assignment] All batches complete: ${allAssignments.length} total assignments`);

        progress.report({ increment: 60, message: 'Applying assignments...' });

        if (!aiResponse.assignments || !Array.isArray(aiResponse.assignments)) {
          throw new Error('Invalid AI response format');
        }

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

        // Apply assignments
        let assignedCount = 0;
        const rarityDistribution: Record<string, number> = {};

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

            // Track distribution
            rarityDistribution[assignment.rarityLabel] = (rarityDistribution[assignment.rarityLabel] || 0) + 1;
          }
        }

        // Log actual vs target distribution
        console.log('[AI Rarity Assignment] ===== DISTRIBUTION ANALYSIS =====');
        console.log('[AI Rarity Assignment] Target vs Actual:');
        rarityLabels.forEach(r => {
          const actual = rarityDistribution[r.label] || 0;
          const actualPercent = ((actual / assignedCount) * 100).toFixed(1);
          console.log(`  ${r.label}: Target ${r.percentage}% | Actual ${actualPercent}% (${actual} items)`);
        });

        // Identify potential issues
        const issues: string[] = [];
        rarityLabels.forEach(r => {
          const actual = rarityDistribution[r.label] || 0;
          const actualPercent = (actual / assignedCount) * 100;
          const diff = Math.abs(actualPercent - r.percentage);
          if (diff > 15) {
            issues.push(`${r.label} is ${diff.toFixed(1)}% off target (${actualPercent.toFixed(1)}% vs ${r.percentage}%)`);
          }
        });

        if (issues.length > 0) {
          console.log('[AI Rarity Assignment] ⚠️  DISTRIBUTION WARNINGS:');
          issues.forEach(issue => console.log(`  - ${issue}`));
        } else {
          console.log('[AI Rarity Assignment] ✅ Distribution is within acceptable range');
        }

        // Validate assignments for suspicious patterns
        console.log('[AI Rarity Assignment] ===== VALIDATION CHECKS =====');
        const suspiciousAssignments: string[] = [];
        const rarityKeywords = {
          legendary: ['golden', 'diamond', 'platinum', 'legendary', 'epic', 'mythic', 'supreme', 'ultimate', 'divine', 'celestial', 'transcendent'],
          rare: ['special', 'unique', 'premium', 'elite', 'champion', 'hero', 'master', 'royal', 'ancient', 'sacred'],
          uncommon: ['enhanced', 'improved', 'advanced', 'superior', 'polished', 'refined', 'quality']
        };

        aiResponse.assignments.forEach(a => {
          const item = itemsContext.find(i => i.id === a.id);
          if (!item) return;

          const nameLower = item.nameWithoutExt.toLowerCase();
          const rarity = a.rarityLabel.toLowerCase();

          // Check if high rarity assignment lacks semantic indicators
          if (rarity.includes('legendary') || rarity.includes('epic') || rarity.includes('mythic') || rarity.includes('majestic')) {
            const hasIndicator = rarityKeywords.legendary.some(keyword => nameLower.includes(keyword));
            if (!hasIndicator && !item.folderPath.toLowerCase().includes('legendary')) {
              suspiciousAssignments.push(`"${item.nameWithoutExt}" → ${a.rarityLabel} (no legendary indicator found)`);
            }
          } else if (rarity.includes('rare') && !rarity.includes('uncommon')) {
            const hasIndicator = rarityKeywords.rare.some(keyword => nameLower.includes(keyword)) ||
                                rarityKeywords.legendary.some(keyword => nameLower.includes(keyword));
            if (!hasIndicator && !item.folderPath.toLowerCase().includes('rare')) {
              suspiciousAssignments.push(`"${item.nameWithoutExt}" → ${a.rarityLabel} (no rare indicator found)`);
            }
          }
        });

        if (suspiciousAssignments.length > 0) {
          console.log('[AI Rarity Assignment] ⚠️  SUSPICIOUS ASSIGNMENTS (may need review):');
          suspiciousAssignments.slice(0, 20).forEach(s => console.log(`  - ${s}`));
          if (suspiciousAssignments.length > 20) {
            console.log(`  ... and ${suspiciousAssignments.length - 20} more`);
          }
        } else {
          console.log('[AI Rarity Assignment] ✅ All assignments appear semantically justified');
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

  /**
   * Build hierarchical folder tree from file list
   */
  private buildFolderTree(files: CollectionFile[]): FolderNode {
    const root: FolderNode = {
      name: 'Root',
      type: 'folder',
      path: '',
      children: []
    };

    files.forEach(file => {
      // Get relative path from root
      let relativePath = this._selectedFolder
        ? file.path.replace(this._selectedFolder, '').replace(/^\//, '')
        : file.path;

      const pathParts = relativePath.split('/').filter(Boolean);
      let currentNode = root;

      // Navigate/create folders
      for (let i = 0; i < pathParts.length - 1; i++) {
        const folderName = pathParts[i];
        let folder = currentNode.children.find(
          c => c.name === folderName && c.type === 'folder'
        );

        if (!folder) {
          folder = {
            name: folderName,
            type: 'folder',
            path: pathParts.slice(0, i + 1).join('/'),
            children: []
          };
          currentNode.children.push(folder);
        }

        currentNode = folder;
      }

      // Add file
      currentNode.children.push({
        name: pathParts[pathParts.length - 1],
        type: 'file',
        path: relativePath,
        children: []
      });
    });

    // Sort children: folders first, then alphabetically
    const sortChildren = (node: FolderNode) => {
      node.children.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      node.children.forEach(child => {
        if (child.type === 'folder') sortChildren(child);
      });
    };

    sortChildren(root);
    return root;
  }

  /**
   * Simulate entire pipeline with step-by-step state tracking
   */
  private simulatePipeline(
    files: CollectionFile[],
    operations: PipelineOperation[]
  ): PipelineSimulationResult {
    // Track current state of files
    type FileState = {
      originalPath: string;
      currentPath: string;
      excluded: boolean;
      transformations: string[];
    };

    let fileStates: FileState[] = files.map(f => ({
      originalPath: this._selectedFolder ? f.path.replace(this._selectedFolder, '').replace(/^\//, '') : f.path,
      currentPath: this._selectedFolder ? f.path.replace(this._selectedFolder, '').replace(/^\//, '') : f.path,
      excluded: false,
      transformations: []
    }));

    const steps: PipelineStepResult[] = [];
    const structureBefore = this.buildFolderTree(files);

    // Execute each operation sequentially
    operations.forEach((operation, index) => {
      const changes: Array<{
        originalPath: string;
        newPath: string;
        action: 'excluded' | 'moved' | 'renamed' | 'transformed';
      }> = [];

      if (operation.type === 'exclude') {
        // Exclude matching files
        fileStates.forEach(state => {
          if (!state.excluded && state.currentPath === operation.path) {
            state.excluded = true;
            state.transformations.push(`Excluded: ${operation.reason}`);
            changes.push({
              originalPath: state.originalPath,
              newPath: '[EXCLUDED]',
              action: 'excluded'
            });
          }
        });
      } else if (operation.type === 'move') {
        // Move file from -> to
        fileStates.forEach(state => {
          if (!state.excluded && state.currentPath === operation.from) {
            const oldPath = state.currentPath;
            state.currentPath = operation.to;
            state.transformations.push(`Moved: ${operation.from} → ${operation.to}`);
            changes.push({
              originalPath: state.originalPath,
              newPath: operation.to,
              action: 'moved'
            });
          }
        });
      } else if (operation.type === 'rename-folder') {
        // Rename folder: update all files in that folder
        fileStates.forEach(state => {
          if (!state.excluded && state.currentPath.startsWith(operation.from + '/')) {
            const oldPath = state.currentPath;
            state.currentPath = state.currentPath.replace(operation.from + '/', operation.to + '/');
            state.transformations.push(`Folder renamed: ${operation.from} → ${operation.to}`);
            changes.push({
              originalPath: state.originalPath,
              newPath: state.currentPath,
              action: 'renamed'
            });
          }
        });
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
      } else if (operation.type === 'rename-file') {
        // Rename specific file
        const targetPath = operation.target.startsWith('/') ? operation.target.slice(1) : operation.target;
        fileStates.forEach(state => {
          if (!state.excluded && (state.currentPath === targetPath || state.currentPath.endsWith(targetPath))) {
            const pathParts = state.currentPath.split('/');
            pathParts[pathParts.length - 1] = operation.newName;
            const newPath = pathParts.join('/');
            state.transformations.push(`Renamed file: ${operation.newName}`);
            changes.push({
              originalPath: state.originalPath,
              newPath: newPath,
              action: 'renamed'
            });
            state.currentPath = newPath;
          }
        });
      } else if (operation.type === 'transform') {
        // Apply transformations to files in scope
        fileStates.forEach(state => {
          if (state.excluded) return;

          // Check if file is in scope
          const inScope = operation.scope === 'all' ||
            state.currentPath.startsWith(operation.scope + '/');

          if (!inScope) return;

          const pathParts = state.currentPath.split('/').filter(Boolean);
          const fileName = pathParts[pathParts.length - 1];
          const fileNameWithoutExt = fileName.replace(/\.[^/.]+$/, '');
          const ext = fileName.match(/\.[^/.]+$/)?.[0] || '';
          let transformed = fileNameWithoutExt;

          // Apply rename patterns
          if (operation.renamePatterns) {
            operation.renamePatterns.forEach(pattern => {
              const before = transformed;
              if (pattern.type === 'prefix-remove' && transformed.startsWith(pattern.pattern)) {
                transformed = transformed.slice(pattern.pattern.length);
                state.transformations.push(`Removed prefix: "${pattern.pattern}"`);
              } else if (pattern.type === 'suffix-remove' && transformed.endsWith(pattern.pattern)) {
                transformed = transformed.slice(0, -pattern.pattern.length);
                state.transformations.push(`Removed suffix: "${pattern.pattern}"`);
              } else if (pattern.type === 'replace') {
                transformed = transformed.replace(new RegExp(pattern.pattern, 'g'), pattern.replacement || '');
                if (before !== transformed) {
                  state.transformations.push(`Replaced: "${pattern.pattern}" → "${pattern.replacement}"`);
                }
              } else if (pattern.type === 'regex-replace') {
                try {
                  transformed = transformed.replace(new RegExp(pattern.pattern), pattern.replacement || '');
                  if (before !== transformed) {
                    state.transformations.push(`Regex replace: ${pattern.pattern}`);
                  }
                } catch {}
              }
            });
          }

          // Apply name standardization
          if (operation.nameStandardization?.enabled) {
            const template = operation.nameStandardization.template;
            const itemName = transformed; // For now, use transformed name as item name
            transformed = template.replace(/{itemName}/g, itemName).replace(/{fileName}/g, transformed);
            state.transformations.push(`Standardized: ${template}`);
          }

          if (transformed !== fileNameWithoutExt) {
            const oldPath = state.currentPath;
            const folderPath = pathParts.slice(0, -1).join('/');
            state.currentPath = folderPath ? `${folderPath}/${transformed}${ext}` : `${transformed}${ext}`;
            changes.push({
              originalPath: state.originalPath,
              newPath: state.currentPath,
              action: 'transformed'
            });
          }
        });
      }

      // Build tree after this step
      const filesAfterStep = fileStates
        .filter(s => !s.excluded)
        .map((s, i) => ({
          ...files[i],
          path: this._selectedFolder ? `${this._selectedFolder}/${s.currentPath}` : s.currentPath
        }));
      const structureAfter = this.buildFolderTree(filesAfterStep);

      steps.push({
        stepNumber: index + 1,
        operation,
        filesAffected: changes.length,
        changes,
        structureAfter
      });
    });

    // Build final preview
    const finalPreview = fileStates
      .filter(s => !s.excluded)
      .map(s => ({
        before: s.originalPath,
        after: s.currentPath,
        allSteps: s.transformations
      }));

    const filesExcluded = fileStates.filter(s => s.excluded).length;

    return {
      success: true,
      steps,
      finalPreview,
      structureBefore,
      structureAfter: steps.length > 0 ? steps[steps.length - 1].structureAfter : structureBefore,
      totalFilesAffected: new Set(fileStates.filter(s => s.transformations.length > 0).map(s => s.originalPath)).size,
      filesExcluded
    };
  }

  /**
   * Simulate transformation pipeline - used by AI to test configurations
   * Returns what the transformed names would look like
   */
  private simulateTransformations(
    filePaths: string[],
    config: {
      renamePatterns?: Array<{ type: string; pattern: string; replacement?: string }>;
      nameStandardization?: { enabled: boolean; template: string };
      folderAsItemName?: boolean;
    }
  ): Array<{ original: string; transformed: string }> {
    const results: Array<{ original: string; transformed: string }> = [];

    for (const filePath of filePaths) {
      const relativePath = this._selectedFolder
        ? filePath.replace(this._selectedFolder, '').replace(/^\//, '')
        : filePath;

      const pathParts = relativePath.split('/').filter(Boolean);
      const fileName = pathParts[pathParts.length - 1];
      const fileNameWithoutExt = fileName.replace(/\.[^/.]+$/, '');
      const folders = pathParts.slice(0, -1);

      let transformedName = fileNameWithoutExt;

      // Apply rename patterns
      if (config.renamePatterns) {
        for (const pattern of config.renamePatterns) {
          if (pattern.type === 'prefix-remove' && transformedName.startsWith(pattern.pattern)) {
            transformedName = transformedName.slice(pattern.pattern.length);
          } else if (pattern.type === 'suffix-remove' && transformedName.endsWith(pattern.pattern)) {
            transformedName = transformedName.slice(0, -pattern.pattern.length);
          } else if (pattern.type === 'replace') {
            transformedName = transformedName.replace(new RegExp(pattern.pattern, 'g'), pattern.replacement || '');
          } else if (pattern.type === 'regex-replace') {
            try {
              transformedName = transformedName.replace(new RegExp(pattern.pattern), pattern.replacement || '');
            } catch {}
          }
        }
      }

      // Apply name standardization
      if (config.nameStandardization?.enabled) {
        let finalName = config.nameStandardization.template;

        // Determine item name based on folderAsItemName setting
        let itemName = transformedName;
        if (config.folderAsItemName && folders.length > 0) {
          // Use the deepest folder as item name
          itemName = folders[folders.length - 1];
        }

        // Replace template variables
        finalName = finalName
          .replace(/{itemName}/g, itemName)
          .replace(/{fileName}/g, transformedName);

        transformedName = finalName;
      }

      results.push({
        original: relativePath,
        transformed: transformedName
      });
    }

    return results;
  }

  private async autoConfigureStructureMappings(userContext?: string) {
    const selectedFiles = this._files.filter(f => f.selected);

    if (selectedFiles.length === 0) {
      vscode.window.showWarningMessage('No files selected');
      return;
    }

    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'AI Auto-Configuration',
      cancellable: false
    }, async (progress) => {
      try {
        progress.report({ increment: 0, message: 'Analyzing file structure...' });

        // Get AI configuration
        const config = vscode.workspace.getConfiguration('bitcoin.ai');
        const provider = config.get<string>('provider') || 'openai';

        // Get API key and model based on provider (prioritize env vars)
        let apiKey: string | undefined;
        let model: string;

        if (provider === 'openai') {
          model = config.get<string>('openai.model') || 'gpt-5-mini';
          apiKey = process.env.OPENAI_API_KEY || config.get<string>('openai.apiKey');
        } else if (provider === 'anthropic') {
          model = config.get<string>('anthropic.model') || 'claude-sonnet-4-5';
          apiKey = process.env.ANTHROPIC_API_KEY || config.get<string>('anthropic.apiKey');
        } else if (provider === 'xai') {
          model = config.get<string>('xai.model') || 'grok-4';
          apiKey = process.env.XAI_API_KEY || config.get<string>('xai.apiKey');
        } else {
          vscode.window.showErrorMessage(`Unknown AI provider: ${provider}`);
          return;
        }

        if (!apiKey) {
          vscode.window.showErrorMessage(`${provider.toUpperCase()} API key not found. Set ${provider.toUpperCase()}_API_KEY environment variable or configure in settings.`);
          return;
        }

        // Build context for AI: Sample file paths (max 20 representative files)
        const sampleSize = Math.min(20, selectedFiles.length);
        const sampledFiles = selectedFiles
          .sort(() => Math.random() - 0.5) // Random sampling
          .slice(0, sampleSize);

        const beforePaths = sampledFiles.map(file => {
          const relativePath = this._selectedFolder ? file.path.replace(this._selectedFolder, '').replace(/^\//, '') : file.path;
          return relativePath;
        });

        // Generate AFTER examples based on current config to show AI what transformations would look like
        const afterExamples = sampledFiles.map(file => {
          let relativePath = this._selectedFolder ? file.path.replace(this._selectedFolder, '').replace(/^\//, '') : file.path;
          const pathParts = relativePath.split('/').filter(p => p && p !== '.' && p !== '..');
          if (pathParts.length === 0) return { before: relativePath, after: relativePath };

          const fileName = pathParts[pathParts.length - 1];
          const fileNameWithoutExt = fileName.replace(/\.[^/.]+$/, '');
          const ext = fileName.match(/\.[^/.]+$/)?.[0] || '';

          let transformedName = fileNameWithoutExt;

          // Apply existing rename patterns
          if (this._collectionConfig.renamePatterns) {
            for (const pattern of this._collectionConfig.renamePatterns) {
              if (pattern.type === 'prefix-remove' && transformedName.startsWith(pattern.pattern)) {
                transformedName = transformedName.slice(pattern.pattern.length);
              } else if (pattern.type === 'suffix-remove' && transformedName.endsWith(pattern.pattern)) {
                transformedName = transformedName.slice(0, -pattern.pattern.length);
              } else if (pattern.type === 'replace') {
                transformedName = transformedName.replace(new RegExp(pattern.pattern, 'g'), pattern.replacement || '');
              } else if (pattern.type === 'regex-replace') {
                try {
                  transformedName = transformedName.replace(new RegExp(pattern.pattern), pattern.replacement || '');
                } catch {}
              }
            }
          }

          return { before: relativePath, after: transformedName + ext };
        });

        progress.report({ increment: 20, message: `Requesting ${provider} analysis...` });

        // Import AI SDK and provider
        const { generateObject } = await import('ai');
        const { z } = await import('zod');
        let aiModel;

        if (provider === 'openai') {
          const { createOpenAI } = await import('@ai-sdk/openai');
          const openai = createOpenAI({ apiKey });
          aiModel = openai(model);
        } else if (provider === 'anthropic') {
          const { createAnthropic } = await import('@ai-sdk/anthropic');
          const anthropic = createAnthropic({ apiKey });
          aiModel = anthropic(model);
        } else if (provider === 'xai') {
          const { createXai } = await import('@ai-sdk/xai');
          const xai = createXai({ apiKey });
          aiModel = xai(model);
        }

        // Define the schema for Pipeline-based structured output
        const pipelineSchema = z.object({
          mode: z.enum(['replace', 'merge']).describe('replace: Replace entire pipeline, merge: Add/remove/modify specific operations'),
          operations: z.array(z.union([
            z.object({
              type: z.literal('exclude'),
              path: z.string().describe('File path pattern to exclude (supports glob: *.DS_Store, **/*_DRAFT*)'),
              reason: z.string().describe('Why this file is being excluded')
            }),
            z.object({
              type: z.literal('move'),
              from: z.string().describe('Source path'),
              to: z.string().describe('Destination path'),
              reason: z.string().optional().describe('Why this file is being moved')
            }),
            z.object({
              type: z.literal('rename-file'),
              target: z.string().describe('Exact file path to rename'),
              newName: z.string().describe('New filename (without path)'),
              reason: z.string().optional().describe('Why this specific file needs renaming')
            }),
            z.object({
              type: z.literal('move-file'),
              target: z.string().describe('Exact file path to move'),
              to: z.string().describe('Destination folder path (not including filename)'),
              reason: z.string().optional().describe('Why this specific file needs moving')
            }),
            z.object({
              type: z.literal('exclude-file'),
              target: z.string().describe('Exact file path to exclude'),
              reason: z.string().describe('Why this specific file should be excluded')
            }),
            z.object({
              type: z.literal('rename-folder'),
              from: z.string().describe('Current folder name/path'),
              to: z.string().describe('New folder name/path'),
              reason: z.string().optional().describe('Why this folder is being renamed')
            }),
            z.object({
              type: z.literal('transform'),
              scope: z.string().describe('Folder path or "all" for global'),
              pattern: z.string().optional().describe('Optional glob pattern to match specific files (e.g., "**/*_copy*", "*.png")'),
              renamePatterns: z.array(z.object({
                type: z.enum(['prefix-remove', 'suffix-remove', 'replace', 'regex-replace']),
                pattern: z.string(),
                replacement: z.string().optional()
              })).describe('Patterns to clean up filenames'),
              reason: z.string().optional().describe('What this transformation achieves')
            }),
            z.object({
              type: z.literal('map-traits'),
              scope: z.string().describe('Folder path or "all" for global'),
              filenamePatterns: z.array(z.object({
                type: z.enum(['prefix', 'suffix', 'contains', 'regex']),
                targetField: z.string().describe('Field to map to: variant, rarity, or trait name'),
                pattern: z.string(),
                matchValue: z.string().optional().describe('Value to assign when pattern matches')
              })).describe('Extract trait values from filenames'),
              reason: z.string().optional()
            }),
            z.object({
              type: z.literal('map-folders'),
              scope: z.string().describe('Folder path or "all" for global'),
              traitMapping: z.object({
                level1TraitName: z.string().optional().describe('What level 1 folders map to: itemName, rarity, or trait name'),
                level2TraitName: z.string().optional().describe('What level 2 folders map to: rarity or trait name'),
                folderAsItemName: z.boolean().optional().describe('Use folder name as item name')
              }).describe('Map folder structure to traits'),
              reason: z.string().optional()
            }),
            z.object({
              type: z.literal('standardize-names'),
              scope: z.string().describe('Folder path or "all" for global'),
              nameStandardization: z.object({
                enabled: z.boolean(),
                template: z.string().describe('Template like "{itemName}", "{rarity}", "{trait:Name}"')
              }).describe('Apply naming template'),
              reason: z.string().optional()
            }),
            z.object({
              type: z.literal('compress'),
              scope: z.string().describe('Folder path or "all" for global'),
              quality: z.number().min(1).max(100).describe('Image quality 1-100'),
              maxWidth: z.number().optional().describe('Maximum width in pixels'),
              maxHeight: z.number().optional().describe('Maximum height in pixels'),
              format: z.enum(['jpeg', 'png', 'webp']).optional().describe('Output format (default: jpeg)'),
              reason: z.string().optional().describe('Why compression is needed')
            }),
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
            }),
            z.object({
              type: z.literal('filter'),
              scope: z.string().describe('Folder path or "all" for global'),
              rules: z.array(z.object({
                field: z.string().describe('Field to filter on (e.g., "filename", "itemName", "rarity")'),
                operator: z.enum(['equals', 'contains', 'startsWith', 'endsWith', 'regex']).describe('Comparison operator'),
                value: z.string().describe('Value to match against'),
                action: z.enum(['include', 'exclude']).describe('Whether to include or exclude matching items')
              })).describe('Filter rules to apply'),
              reason: z.string().optional().describe('Why filtering is needed')
            })
          ])).describe('In replace mode: Full array of operations. In merge mode: Operations to add'),
          removeOperations: z.array(z.object({
            index: z.number().optional().describe('Index of operation to remove (if known)'),
            matchType: z.string().optional().describe('Remove all operations of this type'),
            matchPattern: z.string().optional().describe('Remove operations matching this pattern (e.g., target path, scope)')
          })).optional().describe('In merge mode: Operations to remove from existing pipeline'),
          insertAt: z.number().optional().describe('In merge mode: Insert new operations at this index (default: append)'),
          reasoning: z.string().describe('Overall strategy and explanation of the pipeline. If refining, explain what you noticed was wrong and how you fixed it.'),
          warnings: z.array(z.string()).optional().describe('Any warnings or potential issues'),
          message: z.string().describe('User-friendly summary. If this is a refinement, explain what you improved (e.g., "Refined pipeline: fixed UUID removal pattern, added exclude for system files")')
        });

        const systemPrompt = `You are an expert in NFT collection structure and file organization, specializing in 1SAT Ordinals (Bitcoin NFTs) collections. Your task is to analyze a collection's file structure and create a PIPELINE of operations to transform messy files into a well-organized, professional NFT collection.

## NFT COLLECTION BEST PRACTICES (1SAT Ordinals Specification):

**Primary Goals:**
1. **Clarity**: Item names and folder structure should be immediately understandable
2. **Accuracy**: Organization must reflect the creator's artistic intent and collection concept
3. **Consistency**: Naming conventions must be uniform across the entire collection
4. **NFT-Ready**: Structure must align with 1SAT Ordinals standards for on-chain inscriptions

**Quality Standards:**
- Remove ALL technical artifacts (camera IDs, export timestamps, UUID suffixes, version numbers)
- Use human-readable names that describe the actual content/artwork
- Organize logically by category, rarity, or item type (depending on collection concept)
- Ensure variant systems are clear (if one item has multiple visual variants)
- Clean folder structure with meaningful hierarchy (avoid flat dumps or over-nesting)
- Preserve artist intent - if folders represent a meaningful categorization, respect it

**Common Issues to Fix:**
- Generic filenames (IMG_0234.jpg, DSC_4521.png) → Descriptive names
- Technical prefixes (nft_, export_, final_, item_) → Remove
- UUID/hash suffixes → Remove
- Inconsistent naming (some PascalCase, some snake_case) → Standardize
- Meaningless folder names (NewFolder, assets, exports) → Clarify or flatten
- Files in wrong locations → Move to proper categories
- **AI-generated descriptive filenames** (black_lotus_petals_on_wooden_table_night_time_photo.png) → Extract item name, normalize to clean pattern

**CRITICAL PATTERN: Extract → Set Metadata → Normalize Filenames**
Many collections have messy AI-generated or descriptive filenames that contain the actual item information buried in them.

**The Pipeline Pattern:**
1. **Extract item info from filename** - Parse "black_lotus_petals_on_wooden_table..." → item name is "Black Lotus Petals"
2. **Set metadata** - Use set-metadata to store the extracted name, rarity, traits
3. **Normalize ALL filenames** - Rename to clean uniform pattern: `{item-name}-{rarity}-v{n}.png` or `{item-name}-v{n}.png`
4. **Detect variants** - Use map-traits to mark v1, v2, v3 as variants

**Example transformation:**
- BEFORE: `Black Lotus Petals/black_lotus_petals_on_wooden_table_night_time_photo.png`
- Extract: "Black Lotus Petals" from folder, determine rarity = "Rare"
- Set metadata: name="Black Lotus Petals", rarityLabel="Rare"
- Normalize filename: `black-lotus-petals-rare-v1.png`
- Mark as variant

This creates a completely uniform, predictable file structure where filenames encode the metadata.

## CONTEXT YOU RECEIVE:
1. Collection metadata (name, description)
2. BEFORE: Hierarchical folder structure showing file organization
3. CURRENT CONFIGURATION: Existing settings (may be empty or incomplete)
4. AFTER: Examples of current transformations
5. Available trait names

## CRITICAL: All file paths are RELATIVE to the collection root folder
- Paths like "items/sword/v1.png" are correct
- NEVER use absolute paths like "/Users/..." or include parent directories
- All operations should use relative paths from the collection root

## YOUR TASK: Return a PIPELINE of operations

You must return a sequential pipeline where operations execute in order:

**Operation Types:**

1. **exclude** - Remove unwanted files (pattern-based)
   - {type: 'exclude', path: '**/.DS_Store', reason: 'System files'}
   - {type: 'exclude', path: '**/*_DRAFT*', reason: 'Draft files not ready'}
   - Supports glob patterns: *, **, ? wildcards
   - Use for: System files, drafts, backups, temp files

2. **exclude-file** - Remove specific unwanted file
   - {type: 'exclude-file', target: 'misc/old_logo.png', reason: 'Not part of collection'}
   - Use for: Excluding one specific file by exact path

3. **move** - Relocate files to correct folders (bulk)
   - {type: 'move', from: 'items/sword.png', to: 'items/weapons/sword.png', reason: 'Reorganizing structure'}
   - Use when: Moving entire folders or path prefixes

4. **move-file** - Move specific individual file
   - {type: 'move-file', target: 'wrong_folder/item.png', to: 'correct_folder/', reason: 'Fix misplaced file'}
   - Use for: Moving one specific file to different folder

5. **rename-file** - Rename specific individual file
   - {type: 'rename-file', target: 'items/IMG_0234.png', newName: 'Sunset Beach.png', reason: 'Fix camera filename'}
   - Use for: Fixing one specific filename that needs custom name

6. **set-metadata** - Set item metadata (name, rarity, traits)
   - {type: 'set-metadata', target: 'items/golden_apple.png', metadata: {name: 'Golden Apple', rarityLabel: 'Legendary'}, reason: 'This item has special golden modifier'}
   - {type: 'set-metadata', target: 'items/bacon.png', metadata: {name: 'Bacon', rarityLabel: 'Common', traits: [{name: 'Type', value: 'Food'}]}, reason: 'Simple food item'}
   - Use for: Setting initial rarity/traits based on semantic analysis of filename/folder
   - **CRITICAL**: Apply semantic rarity rules here! "golden X" = Legendary, "diamond X" = Legendary, plain items = Common
   - Can set: name (display name), rarityLabel (rarity tier), traits (array of {name, value}), description

7. **rename-folder** - Fix folder names
   - {type: 'rename-folder', from: 'char1', to: 'warrior', reason: 'Clarify folder name'}
   - Use when: Folder names need clarification

8. **transform** - Clean up filenames (bulk pattern-based)
   - {type: 'transform', scope: 'all', renamePatterns: [{type: 'prefix-remove', pattern: 'nft_'}]}
   - {type: 'transform', scope: 'all', pattern: '**/*_(copy)*', renamePatterns: [{type: 'suffix-remove', pattern: ' (copy)'}]}
   - Use for: Removing prefixes/suffixes, find/replace in filenames
   - Can be scoped to specific folders or 'all'
   - Optional pattern field to target only matching files

8. **map-traits** - Extract trait values from filenames
   - {type: 'map-traits', scope: 'all', filenamePatterns: [{type: 'prefix', targetField: 'rarity', pattern: 'rare_', matchValue: 'Rare'}]}
   - Use for: Mapping filename patterns to trait values
   - Example: "rare_sword.png" → rarity='Rare'

9. **map-folders** - Map folder structure to traits
   - {type: 'map-folders', scope: 'all', traitMapping: {level1TraitName: 'itemName', folderAsItemName: true}}
   - Use for: Using folder names as item names or trait values
   - Example: folder "sword" → itemName='sword'

10. **standardize-names** - Apply naming templates
    - {type: 'standardize-names', scope: 'all', nameStandardization: {enabled: true, template: '{itemName}'}}
    - Use for: Final name standardization using variables
    - Variables: {itemName}, {rarity}, {trait:TraitName}

11. **compress** - Image compression with quality/dimensions
    - {type: 'compress', scope: 'all', quality: 85, maxWidth: 1920, maxHeight: 1920, format: 'jpeg'}
    - Use for: Reducing file sizes, standardizing dimensions
    - Quality: 1-100 (85-90 recommended for JPEG)
    - Can limit max width/height while preserving aspect ratio

12. **filter** - Include/exclude rules
    - {type: 'filter', scope: 'all', rules: [{field: 'filename', operator: 'contains', value: 'test', action: 'exclude'}]}
    - Use for: Removing test files, only including certain items
    - Operators: equals, contains, startsWith, endsWith, regex
    - Actions: include (only these), exclude (remove these)

**Recommended Order:**
1. Exclude unwanted files first (exclude, exclude-file)
2. Fix individual problematic files (rename-file, move-file)
3. Restructure folders (move, rename-folder)
4. Clean filenames (transform)
5. Map traits (map-traits, map-folders)
6. Standardize names (standardize-names)
7. Compress images (compress)
8. Filter items (filter)

**When to Use Individual vs Bulk Operations:**
- Use rename-file/move-file/exclude-file for 1-5 specific files that need custom handling
- Use transform with pattern for groups of files matching a pattern (e.g., all files with "(copy)")
- Use transform without pattern for global filename cleanup affecting many/all files
- Bulk operations are more maintainable - only use individual operations when necessary

## COMMON USER SCENARIOS (What we need to handle):

**Scenario 1: Flat folder with all images**
- Structure: /my-collection/image1.png, image2.png, ...
- Each file = one unique NFT item
- No variants, simple 1:1 mapping

**Scenario 2: Folders as items with variant files**
- Structure: /Apple/v1.png, v2.png, v3.png | /Banana/v1.png, v2.png
- Each folder = one NFT item
- Files inside = visual variants of that item (user picks random variant at mint)
- Set folderAsItemName=true, level1TraitName="itemName"
- Mark v1/v2/v3 patterns as variants

**Scenario 3: Category → Items structure**
- Structure: /Weapons/Sword/image.png | /Weapons/Axe/image.png | /Potions/Health/image.png
- Level 1 (Weapons, Potions) = trait category
- Level 2 (Sword, Axe, Health) = item name
- level1TraitName = trait name (e.g., "Type")
- Each deepest file = one NFT item

**Scenario 4: Category → Items → Variants**
- Structure: /Weapons/Sword/v1.png, v2.png | /Potions/Health/v1.png, v2.png
- Level 1 = trait category
- Level 2 = item name
- Files = variants
- level1TraitName = trait, folderAsItemName=true for level2

**Scenario 5: Rarity folders**
- Structure: /Common/item1.png | /Rare/item2.png | /Legendary/item3.png
- Folders indicate rarity levels
- level1TraitName="rarity"

**Scenario 6: Messy filenames need cleanup**
- Files have prefixes like "nft_", "final_", "export_", UUIDs, timestamps
- Use renamePatterns to clean before processing
- Remove prefixes/suffixes, strip UUIDs, standardize naming

## CONFIGURATION OPTIONS YOU MUST ANALYZE AND CONFIGURE:

**1. FOLDER STRUCTURE DETECTION** (First, determine the hierarchy):
- "flat": All images in root folder, no subfolders (all files = items)
- "one-level": One level of folders (folders could be items, categories, or rarities)
- "two-level": Two levels of folders (Category/Item, Item/Variant, etc.)

**2. RENAME PATTERNS** (Applied FIRST to clean up filenames before any processing):
- "prefix-remove": Strip prefix from start (e.g., "nft_" → "")
- "suffix-remove": Strip suffix from end (e.g., "_final" → "")
- "replace": Replace string (e.g., "_" → " " for spaces)
- "regex-replace": Complex pattern replacement (e.g., remove UUIDs: "[a-f0-9]{8}-[a-f0-9]{4}-.*" → "")
- ORDER MATTERS: Applied sequentially in array order
- Examples:
  * {"type": "prefix-remove", "pattern": "wildsatchmo_"} removes "wildsatchmo_" from start
  * {"type": "regex-replace", "pattern": "_[a-f0-9]{32}", "replacement": ""} removes UUID suffixes
  * {"type": "replace", "pattern": "_", "replacement": " "} converts underscores to spaces

**3. FOLDER MAPPINGS** (How to interpret folder hierarchy):
- **level1TraitName**: What first-level folders represent:
  * "itemName": Folder IS the item name (files inside are variants) → folderAsItemName=true
  * "rarity": Folder indicates rarity (Common/, Rare/, Legendary/)
  * "Type" (or any trait): Folder is a trait value (Weapons/, Potions/, Armor/)
  * null: Don't map level 1

- **level2TraitName**: What second-level folders represent (only for two-level):
  * Same options as level1
  * Often used for item names when level1 is a category

- **folderAsItemName**: CRITICAL flag
  * true: Folders = items, files = variants (one NFT per folder, multiple image options)
  * false: Each file = separate NFT item

**4. FILENAME PATTERNS** (Extract metadata FROM filenames):
- **Pattern Types**:
  * "prefix": Match start of filename (e.g., "v" matches "v1.png", "v2.png")
  * "suffix": Match end before extension (e.g., "_rare" matches "sword_rare.png")
  * "contains": Match anywhere (e.g., "legendary" matches "super_legendary_axe.png")
  * "regex": Full regex pattern (e.g., "^v[0-9]+$" matches exactly "v1", "v23", etc.)

- **Target Fields** (what to extract):
  * "variant": Mark as variant image (IMPORTANT for variant systems)
  * "rarity": Extract rarity from filename
  * Any trait name: Extract trait value from filename

- **matchValue**: The value to assign (optional)
  * If provided: Files matching pattern get this exact value
  * If omitted: Extracted from the match itself

- Examples:
  * {"type": "prefix", "pattern": "v", "targetField": "variant"} → marks v1, v2, v3 as variants
  * {"type": "contains", "pattern": "rare", "targetField": "rarity", "matchValue": "Rare"}
  * {"type": "regex", "pattern": "^(legendary|epic|common)", "targetField": "rarity"}

**5. NAME STANDARDIZATION** (Applied LAST to generate final NFT names):
- enabled: true/false to turn on standardization
- template: String template with variables:
  * {itemName}: The item name (from folder or filename)
  * {rarity}: Rarity value (if detected)
  * {trait:TraitName}: Value of specific trait
  * {variant}: Variant identifier (if using variants)
- Examples:
  * "{itemName}" → simple item name
  * "{itemName} - {rarity}" → "Sword - Legendary"
  * "{trait:Type} #{itemName}" → "Weapon #Sword"

## DECISION-MAKING LOGIC (How to analyze and configure):

**STEP 1: Determine Folder Structure**
- Count folder depth levels in sample paths
- If all files in root → "flat"
- If 1 level of folders → "one-level"
- If 2+ levels of folders → "two-level"

**STEP 2: Identify Cleanup Needs (Rename Patterns)**
- Scan ALL filenames for common patterns:
  * Prefixes: "nft_", "item_", "final_", "export_", project name, etc.
  * Suffixes: "_final", "_v1", "_export", timestamps, etc.
  * UUIDs: Long hex strings (8-4-4-4-12 format or 32 chars)
  * Special chars: Underscores that should be spaces, hyphens, etc.
- Create rename patterns to strip these BEFORE any other processing

**STEP 3: Understand Folder Semantics** (CRITICAL - This determines everything!)
Ask: "What do the folders represent?"

- **🚨 Check for VARIANT patterns first** (HIGHEST PRIORITY - Most common scenario!):
  * Do folders contain 2+ files with similar/variant names? (v1.png, v2.png, 1.png, 2.png, egg.png/young.png/adult.png)?
  * → **FOLDERS ARE ITEM NAMES**, files inside are visual variants
  * → **MUST SET: folderAsItemName=true**
  * → **MUST SET: level1TraitName to either "itemName" OR an actual trait name if folders represent a trait**
  * → Add filename pattern with targetField="variant" to mark variants
  * → nameStandardization template should use {itemName} which will be the FOLDER NAME
  * → Example: Folder "Fire Dragon" with v1.png, v2.png → Item name is "Fire Dragon", user picks random variant at mint

- **Check for CATEGORY/TYPE patterns** (Only if NOT variants!):
  * Folder names look like categories? (Weapons, Potions, Foods, Types, Classes)
  * AND each folder has just ONE file per item (not multiple variants)?
  * → Folders are trait values
  * → level1TraitName = trait name (create or use existing trait)
  * → **folderAsItemName=false**

- **Check for RARITY patterns** (Only if NOT variants!):
  * Folder names are rarity levels? (Common, Rare, Epic, Legendary, Uncommon)
  * → level1TraitName="rarity"
  * → **folderAsItemName=false**

**STEP 4: Handle Two-Level Structures**
If folder structure is "two-level":
- Level 1 is usually: Category/Type/Class trait
- Level 2 is usually: Item name
- Set level1TraitName to the trait, leave level2 for item naming
- If level 2 ALSO has variants inside → set folderAsItemName=true too

**STEP 5: Configure Filename Patterns**
Look for patterns IN filenames that indicate metadata:
- "v1", "v2", "v3", "var_1", "variant-a" → variant marker
- "rare", "legendary", "common", "epic" → rarity indicator
- Numbered sequences: "1.png", "2.png" → could be variants
- Trait indicators in names → extract to traits

**STEP 6: Name Standardization** (CRITICAL - ALWAYS CONFIGURE THIS)
Name standardization is the FINAL TRANSFORMATION that generates the actual NFT names users will see. This is ESSENTIAL and should ALMOST ALWAYS be enabled.

**When to enable** (default to YES unless files already have perfect names):
- Files have messy/technical names that need cleanup → enabled=true
- Want consistent naming format across all items → enabled=true
- Need to combine folder names with filenames → enabled=true
- Want to include traits/rarity in the display name → enabled=true
- Files already have perfect names and need no changes → enabled=false (rare)

**Template Variables** (use these to build the final name):
- {itemName} → The item name (from folder name or filename after all cleanup)
- {rarity} → Rarity value if detected/assigned
- {trait:TraitName} → Value of any specific trait (replace TraitName with actual trait)
- {variant} → Variant identifier if using variants
- {index} → Sequential number

**Common Template Patterns**:
- "{itemName}" → Use cleaned item name as-is (MOST COMMON)
- "{itemName} #{index}" → Add sequential numbers (Item #1, Item #2)
- "{rarity} {itemName}" → Prefix with rarity (Legendary Sword)
- "{itemName} - {trait:Type}" → Include trait info (Sword - Weapon)
- "{itemName} ({variant})" → Show variant in name (Sword (v1))

**IMPORTANT**:
- Even if just using "{itemName}", you should still enable standardization to apply rename patterns
- The template creates the FINAL name that appears in the NFT metadata
- This is applied AFTER all rename patterns and folder mappings

**STEP 7: Write Clear Message**
Generate a user-friendly message field explaining:
- What structure you detected
- What configuration choices you made
- Why those choices make sense
- What the result will be

## WEAVING TOGETHER ALL CLUES - COHESIVE STRATEGY (CRITICAL!)

You must analyze ALL available information to create a cohesive, intelligent strategy that makes semantic sense. Look for these patterns and COMBINE them:

**1. THEME DETECTION FROM NAMES**
- Look at ALL filenames and folder names together
- Identify the collection theme: Fantasy RPG? Food items? Abstract art? Animals? Avatars?
- Examples:
  * "sword", "shield", "axe" folders → Medieval/Fantasy weapon collection
  * "bacon", "apple", "golden_apple" → Food collection
  * "warrior", "mage", "ranger" → Character class collection
- Use theme to inform trait mappings and rarity decisions

**2. SEMANTIC RARITY INDICATORS IN NAMES**
- Scan filenames/folders for words that indicate rarity level:
  * **Legendary/Epic**: "golden", "diamond", "platinum", "legendary", "epic", "mythic", "supreme", "celestial", "divine"
  * **Rare**: "rare", "special", "unique", "elite", "champion", "hero", "master", "royal", "ancient"
  * **Uncommon**: "enhanced", "improved", "advanced", "superior", "polished", "quality"
  * **Common**: Simple, plain names with no modifiers
- **IMPORTANT**: Use set-metadata operations to assign rarities based on these semantic clues!
- Example: "golden_apple.png" should get {type: 'set-metadata', target: 'golden_apple.png', metadata: {rarityLabel: 'Legendary'}, reason: 'Golden modifier indicates legendary rarity'}

**3. NAMING CONVENTIONS & PATTERNS**
- Identify consistent patterns across ALL files:
  * Numbering: "item_001", "item_002" → Sequential numbering
  * Variants: "sword_v1", "sword_v2" → Variant system
  * Traits in name: "fire_sword", "ice_sword" → Trait extraction
  * Rarity in name: "rare_sword", "legendary_axe" → Rarity extraction
- Configure operations to extract these patterns into proper metadata

**4. FOLDER STRUCTURE SEMANTICS**
- What do folders mean in THIS collection?
  * Categories? (Weapons/, Armor/, Potions/)
  * Rarities? (Common/, Rare/, Legendary/)
  * Items? (Sword/, Axe/, Shield/ with variants inside)
  * Artists? (Alice/, Bob/, Charlie/)
- Map folders to appropriate trait fields based on collection theme

**5. COHESIVE PIPELINE STRATEGY**
Build operations that work TOGETHER:

**Example: Food Collection with Golden Items**
(Example JSON structure - use similar approach in your response)

**6. BE ELABORATE AND SPECIFIC**
- Don't just clean filenames - understand WHY files are named that way
- Don't just map folders - understand what folders MEAN in this collection's context
- Don't assign random rarities - use semantic clues from names and structure
- **Generate detailed reasoning field explaining**:
  * What theme you detected
  * What naming patterns you found
  * How you decided folder mappings
  * Why you chose specific rarity assignments
  * How all operations work together cohesively

**7. SEMANTIC RARITY ASSIGNMENT IS KEY**
- If you see semantic indicators in filenames, USE set-metadata operations!
- Don't leave rarities for manual assignment if you can infer them
- Examples:
  * "golden_apple.png" → Legendary (has "golden")
  * "diamond_sword.png" → Legendary (has "diamond")
  * "enhanced_shield.png" → Uncommon (has "enhanced")
  * "bacon.png" → Common (no indicators)
  * "apple.png" → Common (no indicators)

**8. CONNECT THE DOTS**
Look at EVERYTHING together:
- If folders are "Weapons/", "Armor/" AND files have "golden_", "rare_" prefixes → Extract both folder (type) and filename (rarity)
- If collection is avatars with "warrior/", "mage/" folders → These are likely character classes (trait)
- If files are numbered "001", "002" but folders have meaningful names → Folders are items, numbers are variants
- **Think holistically about the collection's purpose and structure**

## CRITICAL RULES:

1. **WEAVE ALL CLUES TOGETHER**: Don't just process files mechanically - understand the collection's theme, semantics, and intent
2. **USE SEMANTIC RARITY INDICATORS**: If filenames contain "golden", "diamond", "rare", etc. → assign rarities with set-metadata
3. **ALWAYS ENABLE NAME STANDARDIZATION**: Unless files have perfect names already, set enabled=true with an appropriate template
4. **VARIANTS ARE KEY**: If you see v1/v2/v3 or numbered files per folder → ALWAYS configure as variants
5. **ONE CONFIG PER CONCERN**: Don't mix folder-as-items with folder-as-categories in same level
6. **ORDER MATTERS**: Rename patterns apply first, then folder mappings, then filename patterns, then name standardization (final)
7. **BE SPECIFIC**: Use regex patterns when simple string matching isn't enough
8. **BE ELABORATE**: Write detailed reasoning explaining how you connected all the clues into a cohesive strategy
9. **TEST YOUR LOGIC**: Check that AFTER examples would produce clean, sensible names with correct rarities
10. **EXPLAIN YOURSELF**: The message field should clearly explain your complete strategy, not just list operations

Return a JSON object with this EXACT structure:
{
  "folderStructure": "one-level" | "two-level" | "flat",
  "renamePatterns": [
    {"type": "prefix-remove", "pattern": "item_"},
    {"type": "suffix-remove", "pattern": "_final"}
  ],
  "traitMapping": {
    "level1TraitName": "itemName" | "rarity" | "TraitName" | null,
    "level2TraitName": "rarity" | "TraitName" | null,
    "folderAsItemName": true | false
  },
  "filenamePatterns": [
    {"type": "prefix", "pattern": "v", "targetField": "variant"},
    {"type": "contains", "pattern": "rare", "targetField": "rarity", "matchValue": "Rare"}
  ],
  "nameStandardization": {
    "enabled": true,
    "template": "{itemName}"
  },
  "reasoning": "Detailed explanation of patterns detected and configuration choices"
}`;

        const availableTraits = this._collectionConfig.traits?.map(t => t.name).join(', ') || 'None defined';

        // Serialize current config for AI context
        const currentConfig = {
          folderStructure: this._collectionConfig.folderStructure || 'flat',
          renamePatterns: this._collectionConfig.renamePatterns || [],
          traitMapping: this._collectionConfig.traitMapping || {},
          filenamePatterns: this._collectionConfig.filenamePatterns || [],
          nameStandardization: this._collectionConfig.nameStandardization || { enabled: false, template: '{itemName}' }
        };

        // Build hierarchical folder tree for AI
        const folderTree = this.buildFolderTree(selectedFiles);
        const renderTree = (node: FolderNode, indent = ''): string => {
          if (node.type === 'file') {
            return `${indent}📄 ${node.name}`;
          }
          const lines = [`${indent}📁 ${node.name}/`];
          node.children.forEach(child => {
            lines.push(renderTree(child, indent + '  '));
          });
          return lines.join('\n');
        };
        const treeVisualization = folderTree.children.map(c => renderTree(c)).join('\n');

        const existingPipeline = this._collectionConfig.pipeline;
        const hasPipeline = existingPipeline && existingPipeline.operations && existingPipeline.operations.length > 0;

        const userPrompt = `Collection Name: ${this._collectionConfig.name || 'Untitled Collection'}
Collection Description: ${this._collectionConfig.description || 'No description'}

Available Trait Names: ${availableTraits}

=== BEFORE: Folder Structure (${selectedFiles.length} files) ===
${treeVisualization}

=== BEFORE: Sample File Paths (for reference) ===
${beforePaths.slice(0, 10).join('\n')}

=== CURRENT CONFIGURATION ===
${JSON.stringify(currentConfig, null, 2)}

${hasPipeline ? `=== EXISTING PIPELINE (${existingPipeline.operations.length} operations) ===
${JSON.stringify(existingPipeline.operations, null, 2)}

Previous reasoning: ${existingPipeline.reasoning || 'None'}

` : ''}=== AFTER: Current Transformation Results ===
${afterExamples.map(ex => `${ex.before} → ${ex.after}`).join('\n')}

${userContext ? `=== USER CONTEXT ===
${userContext}

` : ''}TASK: Analyze the BEFORE paths, review the CURRENT configuration${hasPipeline ? ' and EXISTING PIPELINE' : ''}, and see the AFTER results. ${userContext ? 'Consider the USER CONTEXT provided above. ' : ''}Then ${hasPipeline ? 'refine' : 'create'} the pipeline configuration.

## MODE SELECTION (CRITICAL!)

**Use mode: "replace"** when:
- No existing pipeline exists (creating from scratch)
- Major structural changes needed (complete redesign)
- User wants to start over

**Use mode: "merge"** when:
- Existing pipeline works mostly well, just needs adjustments
- User provides specific refinement request (e.g., "consider crafting progression for rarity")
- Adding new operations without changing existing structure
- Removing specific problematic operations
- Small targeted improvements

## Merge Mode Instructions
When using merge mode:
1. **operations**: Only include NEW operations you want to ADD
2. **removeOperations**: Specify operations to remove (by index, type, or pattern match)
3. **insertAt**: Where to insert new operations (default: append to end)
4. **message**: Clearly explain what you added/removed and why

Example merge scenarios:
- "Add rarity assignments based on crafting progression" → mode: merge, add set-metadata operations for specific items
- "Remove all the golden apple special rarity assignments" → mode: merge, removeOperations with matchPattern: "Golden Apple"
- "The UUID cleanup isn't working" → mode: merge, remove old UUID operation, add improved one

## Replace Mode Instructions
When using replace mode:
1. **operations**: Complete array of ALL operations needed
2. Return full pipeline from scratch
3. **message**: Explain your overall strategy

## Iterative Refinement Pattern
If EXISTING PIPELINE exists, you are REFINING:
1. **Evaluate the AFTER results** - Are the transformations working correctly?
2. **Identify specific problems** - What's still wrong?
3. **Choose mode** - merge for targeted fixes, replace for major changes
4. **Execute changes** - Add/remove/modify operations as needed
5. **Use the message field** to explain what you changed and why

If no EXISTING PIPELINE, you are creating from scratch:
1. **Use mode: "replace"**
2. **Review BEFORE paths** - What patterns do you see?
3. **Design complete pipeline** - What operations are needed?
4. **Use the message field** to explain your strategy

## Key Analysis Steps:
1. **Check AFTER results first** - If they exist, do they look correct?
2. **Review BEFORE paths** - What patterns need handling?
3. **Identify issues**:
   - Common prefixes/suffixes to remove (e.g., "item_", "_final", "nft-", UUIDs)
   - Variant patterns (v1, v2, variant_a, version-1, numbered files, etc.)
   - Folder structure usage (are folders items with variants, or categories/types?)
   - Rarity indicators in filenames or folders
   - Trait extraction opportunities from filenames
   - Name standardization templates
   - Files in wrong locations
   - System files to exclude

Be thorough but conservative - only suggest patterns you're confident about based on the actual file paths shown.

**IMPORTANT**: Return a pipeline of operations in this exact format:
- {type: 'exclude', path, reason} - Exclude system files
- {type: 'move', from, to, reason?} - Move files to different paths
- {type: 'rename-folder', from, to, reason?} - Rename folders
- {type: 'transform', scope, renamePatterns, reason?} - Clean up filenames (prefix/suffix removal, find/replace)
- {type: 'map-traits', scope, filenamePatterns, reason?} - Extract trait values from filenames
- {type: 'map-folders', scope, traitMapping, reason?} - Map folder names to traits/item names
- {type: 'standardize-names', scope, nameStandardization, reason?} - Apply naming templates
- {type: 'compress', scope, quality, maxWidth?, maxHeight?, format?, reason?} - Compress images
- {type: 'filter', scope, rules, reason?} - Include/exclude items with field/operator/value/action rules

You must return a structured response with:
- operations: Array of pipeline operations (in the order they should execute)
- reasoning: String explaining your overall strategy (if refining, note what was wrong and how you fixed it)
- warnings: Optional array of strings for potential issues
- message: User-friendly summary (if refining, mention what you improved; examples: "Refined pipeline: fixed UUID pattern", "Initial configuration: variant-based collection with folder mapping")`;

        // Call AI using generateObject for guaranteed structured output
        // NOTE: generateObject does NOT support tools - it's single-shot deterministic output
        // If you want tool calling (simulatePipeline), you would need to:
        // 1. Use generateText with experimental_output instead
        // 2. Accept that tool calling with structured output can fail if AI completes on a tool call step
        // 3. Handle the AI_NoOutputSpecifiedError when that happens
        // Current approach: AI analyzes structure and returns pipeline in one shot (no simulation)
        const result = await generateObject({
          model: aiModel,
          system: systemPrompt,
          prompt: userPrompt,
          schema: pipelineSchema,
          temperature: 0.3
        });

        const aiResponse = result.object;

        // Log the full result for debugging
        console.log('[CollectionMinter] AI Result:', {
          mode: aiResponse.mode || 'replace',
          operations: aiResponse.operations?.length || 0,
          reasoning: aiResponse.reasoning?.slice(0, 100) || '',
          hasWarnings: !!aiResponse.warnings
        });

        progress.report({ increment: 60, message: 'Applying pipeline...' });

        if (!aiResponse.operations || !Array.isArray(aiResponse.operations)) {
          throw new Error('Invalid AI response: missing operations array. Response: ' + JSON.stringify(aiResponse).slice(0, 200));
        }

        // Handle merge mode vs replace mode
        let finalOperations = aiResponse.operations;

        if (aiResponse.mode === 'merge' && this._collectionConfig.pipeline?.operations) {
          // Merge mode: modify existing pipeline
          let existingOps = [...this._collectionConfig.pipeline.operations];

          // Step 1: Remove operations if specified
          if (aiResponse.removeOperations && aiResponse.removeOperations.length > 0) {
            for (const removeSpec of aiResponse.removeOperations) {
              if (removeSpec.index !== undefined) {
                // Remove by index
                existingOps.splice(removeSpec.index, 1);
              } else if (removeSpec.matchType) {
                // Remove by type
                existingOps = existingOps.filter(op => op.type !== removeSpec.matchType);
              } else if (removeSpec.matchPattern) {
                // Remove by pattern match
                existingOps = existingOps.filter(op => {
                  const opStr = JSON.stringify(op);
                  return !opStr.includes(removeSpec.matchPattern!);
                });
              }
            }
          }

          // Step 2: Insert new operations
          if (aiResponse.insertAt !== undefined) {
            // Insert at specific position
            existingOps.splice(aiResponse.insertAt, 0, ...aiResponse.operations);
          } else {
            // Append to end
            existingOps.push(...aiResponse.operations);
          }

          finalOperations = existingOps;
          console.log('[CollectionMinter] Merged pipeline:', {
            originalCount: this._collectionConfig.pipeline.operations.length,
            removedCount: (this._collectionConfig.pipeline.operations.length + aiResponse.operations.length) - finalOperations.length,
            addedCount: aiResponse.operations.length,
            finalCount: finalOperations.length
          });
        }

        // Log the AI response for debugging
        console.log('[CollectionMinter] AI Pipeline Response:', {
          mode: aiResponse.mode || 'replace',
          operations: finalOperations,
          reasoning: aiResponse.reasoning,
          warnings: aiResponse.warnings,
          message: aiResponse.message
        });

        // Store the pipeline in collection config
        const pipeline: Pipeline = {
          operations: finalOperations,
          reasoning: aiResponse.reasoning,
          warnings: aiResponse.warnings || []
        };

        const updates: Partial<CollectionConfig> = {
          pipeline: pipeline
        };

        console.log('[CollectionMinter] Applying pipeline:', updates);

        this._collectionConfig = { ...this._collectionConfig, ...updates };

        progress.report({ increment: 100, message: 'Complete!' });

        this.saveCollectionState();

        // Create configuration log entry
        const configLog: Array<{ timestamp: string; message: string; level: 'info' | 'warning' | 'error' }> = [];
        const timestamp = new Date().toISOString();

        // Add AI reasoning to log
        configLog.push({
          timestamp,
          message: `AI Strategy: ${aiResponse.reasoning}`,
          level: 'info'
        });

        // Add warnings to log
        if (aiResponse.warnings && aiResponse.warnings.length > 0) {
          aiResponse.warnings.forEach(warning => {
            configLog.push({
              timestamp,
              message: `Warning: ${warning}`,
              level: 'warning'
            });
          });
        }

        // Send completion message to frontend with updated config
        this._panel.webview.postMessage({
          command: 'autoConfigureComplete',
          success: true,
          message: aiResponse.message || `AI configured pipeline with ${pipeline.operations.length} operations.`,
          operations: pipeline.operations.map(op => ({
            type: op.type,
            scope: (op as any).scope,
            reason: (op as any).reason
          })),
          collectionConfig: this._collectionConfig,
          configLog: configLog,
          aiStrategy: aiResponse.reasoning
        });

        // Send update after completion message
        this.sendUpdate();

        // Clean message for VSCode notification (remove emojis)
        const cleanMessage = (aiResponse.message || `AI configured pipeline with ${pipeline.operations.length} operations.`)
          .replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu, '')
          .replace(/✅|❌|⚠️|🎉|🔧|📝|🗑️|📁|📄/g, '')
          .trim();

        vscode.window.showInformationMessage(cleanMessage);

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;

        console.error('AI configuration error:', {
          message: errorMessage,
          stack: errorStack,
          error
        });

        // Send error message to frontend
        this._panel.webview.postMessage({
          command: 'autoConfigureComplete',
          success: false,
          message: `AI configuration failed: ${errorMessage}`
        });

        vscode.window.showErrorMessage(
          `AI configuration failed: ${errorMessage}`
        );
      }
    });
  }

  private async executePipeline() {
    const pipeline = this._collectionConfig.pipeline;
    if (!pipeline || !pipeline.operations || pipeline.operations.length === 0) {
      vscode.window.showErrorMessage('No pipeline operations to execute');
      return;
    }

    // Initialize execution log
    const executionLog: Array<{ timestamp: string; message: string; level: 'info' | 'warning' | 'error' }> = [];
    const log = (message: string, level: 'info' | 'warning' | 'error' = 'info') => {
      const timestamp = new Date().toISOString();
      executionLog.push({ timestamp, message, level });
      console.log(`[Pipeline ${level.toUpperCase()}] ${message}`);
    };

    try {
      // Get workspace directory for this collection
      const collectionName = this._collectionConfig.name || 'unnamed';
      const workspaceDir = path.join(
        collectionsState.getCollectionsDir(),
        collectionName,
        'transformed'
      );

      log(`Starting pipeline execution for collection: ${collectionName}`);
      log(`Workspace directory: ${workspaceDir}`);

      // CLEAR workspace directory before execution to avoid duplicates
      try {
        await fs.rm(workspaceDir, { recursive: true, force: true });
        log(`Cleared existing workspace directory`);
      } catch (err) {
        // Directory doesn't exist yet, that's fine
        log(`No existing workspace to clear`, 'info');
      }

      // Create fresh workspace directory
      await fs.mkdir(workspaceDir, { recursive: true });
      log(`Workspace directory created`);

      // Initialize progress
      const steps = pipeline.operations.map((op, index) => ({
        operationType: op.type,
        status: 'pending' as const,
        message: `Waiting to execute ${op.type} operation...`,
        filesAffected: 0
      }));

      this._panel.webview.postMessage({
        command: 'pipelineProgress',
        currentStep: 0,
        steps
      });

      // Track file state through pipeline
      let currentFiles = [...this._files.filter(f => f.selected)];
      const excludedFiles: string[] = [];

      log(`Starting with ${currentFiles.length} selected files`);

      // Execute each operation
      for (let i = 0; i < pipeline.operations.length; i++) {
        const operation = pipeline.operations[i];

        log(`[${i + 1}/${pipeline.operations.length}] Starting ${operation.type} operation`);

        // Mark as in progress
        steps[i] = {
          ...steps[i],
          status: 'in_progress',
          message: `Executing ${operation.type} operation...`
        };

        this._panel.webview.postMessage({
          command: 'pipelineProgress',
          currentStep: i + 1,
          steps: [...steps]
        });

        // Execute the operation
        const result = await this.executeOperation(operation, currentFiles, excludedFiles, workspaceDir, log);
        currentFiles = result.files;
        excludedFiles.push(...result.excluded);

        log(`[${i + 1}/${pipeline.operations.length}] Completed ${operation.type}: ${result.filesAffected} files affected, ${result.excluded.length} excluded`);

        // Mark as completed
        steps[i] = {
          ...steps[i],
          status: 'completed',
          message: `${operation.type} operation completed`,
          filesAffected: result.filesAffected
        };

        this._panel.webview.postMessage({
          command: 'pipelineProgress',
          currentStep: i + 1,
          steps: [...steps]
        });
      }

      // Copy final files to workspace (if not already copied by compress operation)
      log(`Copying final files to workspace...`);
      let copiedCount = 0;
      for (const file of currentFiles) {
        // Use _transformedPath if operations changed the structure, otherwise use original relative path
        const relativePath = file._transformedPath || this.getRelativePath(file.path);
        const outputPath = path.join(workspaceDir, relativePath);

        // Only copy if file doesn't already exist in workspace
        if (!file.path.startsWith(workspaceDir)) {
          log(`[Copy] Copying: ${file.name} -> ${outputPath} (_transformedPath: ${file._transformedPath || 'none'})`);
          await fs.mkdir(path.dirname(outputPath), { recursive: true });
          await fs.copyFile(file.path, outputPath);
          file.path = outputPath;
          // Update file.name to match the actual filename in the output path
          file.name = path.basename(outputPath);
          copiedCount++;
        } else {
          log(`[Copy] Skipping (already in workspace): ${file.path}`);
        }
      }
      log(`Copied ${copiedCount} files to workspace`);

      // DO NOT overwrite this._files - keep original files intact!
      // The transformed files exist in the workspace and are sent to frontend via transformedFiles message
      // this._files should always contain the ORIGINAL source files

      log(`Pipeline execution completed successfully!`);
      log(`Final stats: ${currentFiles.length} files processed, ${excludedFiles.length} excluded`);

      // Send completion message with transformed files and execution log
      this._panel.webview.postMessage({
        command: 'pipelineComplete',
        message: `Pipeline executed successfully! ${pipeline.operations.length} operations completed. ${currentFiles.length} files processed, ${excludedFiles.length} excluded.`,
        transformedFiles: currentFiles.map(f => ({
          id: f.id,
          path: f.path,
          name: f.name,
          metadata: f.metadata
        })),
        executionLog
      });

      vscode.window.showInformationMessage(`Pipeline executed successfully! ${currentFiles.length} files in workspace at ${workspaceDir}`);

      // Save collection state - this._files still contains original files, which is correct
      await this.saveCollectionState();
      console.log('[CollectionMinter] Collection state saved after pipeline execution');

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      log(`Pipeline execution failed: ${errorMessage}`, 'error');
      if (error instanceof Error && error.stack) {
        log(`Stack trace: ${error.stack}`, 'error');
      }

      this._panel.webview.postMessage({
        command: 'pipelineError',
        message: `Pipeline execution failed: ${errorMessage}`,
        executionLog
      });

      vscode.window.showErrorMessage(`Pipeline execution failed: ${errorMessage}`);
    }
  }

  private async executeOperation(
    operation: PipelineOperation,
    files: CollectionFile[],
    excludedFiles: string[],
    workspaceDir: string,
    log: (message: string, level?: 'info' | 'warning' | 'error') => void
  ): Promise<{ files: CollectionFile[]; excluded: string[]; filesAffected: number }> {
    const excluded: string[] = [];
    let filesAffected = 0;

    switch (operation.type) {
      case 'exclude': {
        // Filter out files matching the exclude pattern
        const pattern = operation.path;
        const remaining = files.filter(f => {
          const relativePath = this.getRelativePath(f.path);
          const matches = this.matchesPattern(relativePath, pattern);
          if (matches) {
            excluded.push(relativePath);
            filesAffected++;
          }
          return !matches;
        });
        return { files: remaining, excluded, filesAffected };
      }

      case 'move': {
        // Move files from one path to another - just update metadata, actual move happens during copy
        const affectedFiles = files.map(f => {
          const relativePath = this.getRelativePath(f.path);
          if (relativePath.startsWith(operation.from)) {
            const newRelativePath = relativePath.replace(operation.from, operation.to);
            filesAffected++;
            // Store new relative path for later use during copy
            return { ...f, _transformedPath: newRelativePath };
          }
          return f;
        });
        return { files: affectedFiles, excluded, filesAffected };
      }

      case 'rename-folder': {
        // Rename folder - just update path, actual rename happens during copy
        const affectedFiles = files.map(f => {
          const relativePath = this.getRelativePath(f.path);
          if (relativePath.startsWith(operation.from)) {
            const newRelativePath = relativePath.replace(operation.from, operation.to);
            filesAffected++;
            // Store new relative path for later use during copy
            return { ...f, _transformedPath: newRelativePath };
          }
          return f;
        });
        return { files: affectedFiles, excluded, filesAffected };
      }

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

      case 'rename-file': {
        // Rename specific file
        const affectedFiles = files.map(f => {
          const relativePath = this.getRelativePath(f.path);
          const targetPath = operation.target.startsWith('/') ? operation.target.slice(1) : operation.target;

          if (relativePath === targetPath || f.path.endsWith(targetPath)) {
            filesAffected++;
            const pathParts = relativePath.split('/');
            pathParts[pathParts.length - 1] = operation.newName;
            const newRelativePath = pathParts.join('/');

            log(`Renamed ${relativePath} to ${newRelativePath}`);

            return { ...f, metadata: { ...f.metadata, targetPath: newRelativePath } };
          }
          return f;
        });
        return { files: affectedFiles, excluded, filesAffected };
      }

      case 'transform': {
        // Apply rename patterns to filenames
        log(`[Transform] Starting transform operation with ${operation.renamePatterns.length} patterns on scope: ${operation.scope}`);
        const affectedFiles = await Promise.all(files.map(async f => {
          const relativePath = this.getRelativePath(f.path);
          const shouldTransform = operation.scope === 'all' || relativePath.startsWith(operation.scope);

          // If pattern is specified, check if file matches the pattern
          const matchesPattern = !operation.pattern || this.matchesPattern(relativePath, operation.pattern);

          if (shouldTransform && matchesPattern) {
            let newName = f.name;
            const originalName = f.name;
            for (const pattern of operation.renamePatterns) {
              newName = this.applyRenamePattern(newName, pattern);
            }

            if (newName !== f.name) {
              filesAffected++;
              const newRelativePath = relativePath.replace(f.name, newName);
              log(`[Transform] Renaming: "${originalName}" -> "${newName}" (relativePath: "${relativePath}" -> "${newRelativePath}")`);
              // Store new name and path for later use during copy
              return { ...f, name: newName, _transformedPath: newRelativePath };
            }
          }
          return f;
        }));
        log(`[Transform] Completed transform operation, affected ${filesAffected} files`);
        return { files: affectedFiles, excluded, filesAffected };
      }

      case 'map-traits': {
        // Extract trait values from filenames
        const affectedFiles = files.map(f => {
          const relativePath = this.getRelativePath(f.path);
          const shouldMap = operation.scope === 'all' || relativePath.startsWith(operation.scope);

          if (shouldMap) {
            const traits: Array<{ name: string; value: string }> = [];
            for (const pattern of operation.filenamePatterns) {
              const value = this.extractTraitFromFilename(f.name, pattern);
              if (value) {
                traits.push({ name: pattern.targetField, value });
              }
            }

            if (traits.length > 0) {
              filesAffected++;
              return {
                ...f,
                metadata: {
                  ...f.metadata,
                  name: f.metadata?.name || f.name,
                  traits: [...(f.metadata?.traits || []), ...traits]
                }
              };
            }
          }
          return f;
        });
        return { files: affectedFiles, excluded, filesAffected };
      }

      case 'map-folders': {
        // Map folder structure to traits
        const affectedFiles = files.map(f => {
          const relativePath = this.getRelativePath(f.path);
          const shouldMap = operation.scope === 'all' || relativePath.startsWith(operation.scope);

          if (shouldMap) {
            const pathParts = relativePath.split('/').filter(Boolean);
            const traits: Array<{ name: string; value: string }> = [];

            if (operation.traitMapping.level1TraitName && pathParts.length >= 2) {
              traits.push({ name: operation.traitMapping.level1TraitName, value: pathParts[0] });
            }

            if (operation.traitMapping.level2TraitName && pathParts.length >= 3) {
              traits.push({ name: operation.traitMapping.level2TraitName, value: pathParts[1] });
            }

            if (traits.length > 0) {
              filesAffected++;
              return {
                ...f,
                metadata: {
                  ...f.metadata,
                  name: f.metadata?.name || f.name,
                  traits: [...(f.metadata?.traits || []), ...traits]
                }
              };
            }
          }
          return f;
        });
        return { files: affectedFiles, excluded, filesAffected };
      }

      case 'standardize-names': {
        // Apply name standardization template
        const affectedFiles = files.map(f => {
          const relativePath = this.getRelativePath(f.path);
          const shouldStandardize = operation.scope === 'all' || relativePath.startsWith(operation.scope);

          if (shouldStandardize && operation.nameStandardization.enabled) {
            const standardizedName = this.applyNameTemplate(f, operation.nameStandardization.template);
            if (standardizedName !== f.name) {
              filesAffected++;
              return {
                ...f,
                metadata: {
                  ...f.metadata,
                  name: standardizedName
                }
              };
            }
          }
          return f;
        });
        return { files: affectedFiles, excluded, filesAffected };
      }

      case 'compress': {
        // Compress images and copy to workspace
        const { ImageProcessor } = await import('../../services/imageProcessor');
        const imageProcessor = new ImageProcessor();

        const affectedFiles = await Promise.all(files.map(async f => {
          const relativePath = this.getRelativePath(f.path);
          const shouldCompress = operation.scope === 'all' || relativePath.startsWith(operation.scope);

          if (shouldCompress && this.isImage(f.contentType)) {
            filesAffected++;

            // Process and compress image
            const buffer = await imageProcessor.processImage(f.path, {
              quality: operation.quality,
              maxWidth: operation.maxWidth,
              maxHeight: operation.maxHeight,
              format: operation.format || 'jpeg',
              noCache: true
            });

            // Write to workspace
            const outputPath = path.join(workspaceDir, relativePath);
            await fs.mkdir(path.dirname(outputPath), { recursive: true });
            await fs.writeFile(outputPath, buffer);

            return {
              ...f,
              path: outputPath,
              size: buffer.length
            };
          }
          return f;
        }));
        return { files: affectedFiles, excluded, filesAffected };
      }

      case 'filter': {
        // Apply filter rules
        const remaining = files.filter(f => {
          const relativePath = this.getRelativePath(f.path);
          const shouldFilter = operation.scope === 'all' || relativePath.startsWith(operation.scope);

          if (shouldFilter) {
            for (const rule of operation.rules) {
              const matches = this.matchesFilterRule(f, relativePath, rule);
              if (matches) {
                if (rule.action === 'exclude') {
                  excluded.push(relativePath);
                  filesAffected++;
                  return false;
                } else if (rule.action === 'include') {
                  return true;
                }
              }
            }
          }
          return true;
        });
        return { files: remaining, excluded, filesAffected };
      }

      case 'rename-file': {
        // Rename a specific file
        log(`Renaming file: ${operation.target} → ${operation.newName}`, 'info');
        const affectedFiles = files.map(f => {
          const relativePath = this.getRelativePath(f.path);
          if (relativePath === operation.target) {
            filesAffected++;
            const dirPath = operation.target.substring(0, operation.target.lastIndexOf('/'));
            const newRelativePath = dirPath ? `${dirPath}/${operation.newName}` : operation.newName;
            log(`File renamed: ${operation.target} → ${newRelativePath}`, 'info');
            return { ...f, name: operation.newName, metadata: { ...f.metadata, targetPath: newRelativePath } };
          }
          return f;
        });
        return { files: affectedFiles, excluded, filesAffected };
      }

      case 'move-file': {
        // Move a specific file
        log(`Moving file: ${operation.target} → ${operation.to}`, 'info');
        const affectedFiles = files.map(f => {
          const relativePath = this.getRelativePath(f.path);
          if (relativePath === operation.target) {
            filesAffected++;
            const newRelativePath = `${operation.to}${operation.to.endsWith('/') ? '' : '/'}${f.name}`;
            log(`File moved: ${operation.target} → ${newRelativePath}`, 'info');
            return { ...f, metadata: { ...f.metadata, targetPath: newRelativePath } };
          }
          return f;
        });
        return { files: affectedFiles, excluded, filesAffected };
      }

      case 'exclude-file': {
        // Exclude a specific file
        log(`Excluding file: ${operation.target}`, 'info');
        const remaining = files.filter(f => {
          const relativePath = this.getRelativePath(f.path);
          if (relativePath === operation.target) {
            excluded.push(relativePath);
            filesAffected++;
            log(`File excluded: ${operation.target}`, 'info');
            return false;
          }
          return true;
        });
        return { files: remaining, excluded, filesAffected };
      }

      default:
        return { files, excluded, filesAffected: 0 };
    }
  }

  private getRelativePath(filePath: string): string {
    const selectedFolder = this._selectedFolder;
    if (selectedFolder && filePath.startsWith(selectedFolder)) {
      return filePath.substring(selectedFolder.length).replace(/^\/+/, '');
    }
    return filePath;
  }

  private matchesPattern(text: string, pattern: string): boolean {
    // Simple pattern matching - can be enhanced with glob or regex
    if (pattern.includes('*')) {
      const regexPattern = pattern.replace(/\*/g, '.*');
      return new RegExp(regexPattern).test(text);
    }
    return text.includes(pattern);
  }

  private applyRenamePattern(name: string, pattern: RenamePattern): string {
    switch (pattern.type) {
      case 'prefix-remove':
        return name.startsWith(pattern.pattern) ? name.substring(pattern.pattern.length) : name;
      case 'suffix-remove':
        return name.endsWith(pattern.pattern) ? name.substring(0, name.length - pattern.pattern.length) : name;
      case 'replace':
        return name.replace(pattern.pattern, pattern.replacement || '');
      case 'regex-replace':
        return name.replace(new RegExp(pattern.pattern, 'g'), pattern.replacement || '');
      default:
        return name;
    }
  }

  private extractTraitFromFilename(name: string, pattern: FilenamePattern): string | null {
    switch (pattern.type) {
      case 'prefix':
        if (name.startsWith(pattern.pattern)) {
          return name.substring(pattern.pattern.length);
        }
        break;
      case 'suffix':
        if (name.endsWith(pattern.pattern)) {
          return name.substring(0, name.length - pattern.pattern.length);
        }
        break;
      case 'contains':
        if (name.includes(pattern.pattern)) {
          return pattern.matchValue || pattern.pattern;
        }
        break;
      case 'regex':
        const match = name.match(new RegExp(pattern.pattern));
        if (match) {
          return match[1] || match[0];
        }
        break;
    }
    return null;
  }

  private applyNameTemplate(file: CollectionFile, template: string): string {
    let result = template;

    // Replace {itemName} with folder name or base name
    const relativePath = this.getRelativePath(file.path);
    const pathParts = relativePath.split('/').filter(Boolean);
    const itemName = pathParts.length > 1 ? pathParts[pathParts.length - 2] : file.name.replace(/\.[^/.]+$/, '');

    result = result.replace(/\{itemName\}/g, itemName);
    result = result.replace(/\{fileName\}/g, file.name.replace(/\.[^/.]+$/, ''));

    // Replace trait placeholders
    if (file.metadata?.traits) {
      for (const trait of file.metadata.traits) {
        result = result.replace(new RegExp(`\\{${trait.name}\\}`, 'g'), trait.value);
      }
    }

    return result;
  }

  private isImage(contentType: string): boolean {
    return contentType.startsWith('image/');
  }

  private matchesFilterRule(
    file: CollectionFile,
    relativePath: string,
    rule: { field: string; operator: string; value: string; action: string }
  ): boolean {
    let fieldValue = '';

    // Get field value
    switch (rule.field) {
      case 'itemName':
        fieldValue = file.metadata?.name || file.name;
        break;
      case 'fileName':
        fieldValue = file.name;
        break;
      case 'folderName':
        const pathParts = relativePath.split('/').filter(Boolean);
        fieldValue = pathParts.length > 1 ? pathParts[pathParts.length - 2] : '';
        break;
      case 'rarity':
        fieldValue = file.metadata?.rarityLabel || '';
        break;
      default:
        // Check if it's a trait name
        const trait = file.metadata?.traits?.find(t => t.name === rule.field);
        fieldValue = trait?.value || '';
    }

    // Apply operator
    switch (rule.operator) {
      case 'equals':
        return fieldValue === rule.value;
      case 'contains':
        return fieldValue.includes(rule.value);
      case 'startsWith':
        return fieldValue.startsWith(rule.value);
      case 'endsWith':
        return fieldValue.endsWith(rule.value);
      case 'regex':
        return new RegExp(rule.value).test(fieldValue);
      default:
        return false;
    }
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

      // Get AI configuration
      const config = vscode.workspace.getConfiguration('bitcoin.ai');
      const provider = config.get<string>('provider') || 'openai';

      // Get API key and model based on provider (prioritize env vars)
      let apiKey: string | undefined;
      let model: string;

      if (provider === 'openai') {
        model = config.get<string>('openai.model') || 'gpt-5-mini';
        apiKey = process.env.OPENAI_API_KEY || config.get<string>('openai.apiKey');
      } else if (provider === 'anthropic') {
        model = config.get<string>('anthropic.model') || 'claude-sonnet-4-5';
        apiKey = process.env.ANTHROPIC_API_KEY || config.get<string>('anthropic.apiKey');
      } else if (provider === 'xai') {
        model = config.get<string>('xai.model') || 'grok-4';
        apiKey = process.env.XAI_API_KEY || config.get<string>('xai.apiKey');
      } else {
        throw new Error(`Unknown AI provider: ${provider}`);
      }

      if (!apiKey) {
        throw new Error(`${provider.toUpperCase()} API key not found. Set ${provider.toUpperCase()}_API_KEY environment variable or configure in settings.`);
      }

      // Import AI SDK and provider
      const { generateObject } = await import('ai');
      const { z } = await import('zod');
      let aiModel;

      if (provider === 'openai') {
        const { createOpenAI } = await import('@ai-sdk/openai');
        const openai = createOpenAI({ apiKey });
        aiModel = openai(model);
      } else if (provider === 'anthropic') {
        const { createAnthropic } = await import('@ai-sdk/anthropic');
        const anthropic = createAnthropic({ apiKey });
        aiModel = anthropic(model);
      } else if (provider === 'xai') {
        const { createXai } = await import('@ai-sdk/xai');
        const xai = createXai({ apiKey });
        aiModel = xai(model);
      }

      // Define schemas based on type
      const raritySchema = z.object({
        rarityLabels: z.array(z.object({
          label: z.string(),
          percentage: z.string()
        }))
      });

      const traitSchema = z.object({
        traits: z.array(z.object({
          name: z.string(),
          values: z.array(z.string()),
          occurancePercentages: z.array(z.string())
        }))
      });

      // Call AI using unified SDK with structured output
      const { object: parsedData } = await generateObject({
        model: aiModel,
        system: systemPrompt,
        prompt: userPrompt,
        schema: type === 'rarities' ? raritySchema : traitSchema,
        temperature: 0.7
      });

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

  /**
   * Apply structure mappings to all files based on folder hierarchy and filenames
   * Pipeline order:
   * 1) Rename patterns - Transform filenames
   * 2) Folder as item name - Use folder names as item identifiers
   * 3) Filename patterns - Extract metadata from filenames
   * 4) Level 1 folder mapping - Map top-level folders to traits/rarity
   * 5) Level 2 folder mapping - Map second-level folders to traits/rarity
   * 6) Name standardization - Standardize final item names based on all mapped metadata
   */
  private applyStructureMappings() {
    const selectedFiles = this._files.filter(f => f.selected);
    const { folderStructure, traitMapping, filenamePatterns, renamePatterns, nameStandardization, traits, rarityLabels } = this._collectionConfig;

    const hasFolderMappings = traitMapping && (traitMapping.level1TraitName || traitMapping.level2TraitName || traitMapping.folderAsItemName);
    const hasPatterns = filenamePatterns && filenamePatterns.length > 0;
    const hasRenames = renamePatterns && renamePatterns.length > 0;
    const hasStandardization = nameStandardization && nameStandardization.enabled;

    if (!hasFolderMappings && !hasPatterns && !hasRenames && !hasStandardization) {
      vscode.window.showInformationMessage('No structure mappings configured. Please configure folder mappings, filename patterns, rename patterns, or name standardization in the Structure tab.');
      return;
    }

    let updatedCount = 0;

    selectedFiles.forEach(file => {
      const relativePath = this._selectedFolder ? file.path.replace(this._selectedFolder, '').replace(/^\//, '') : file.path;
      const pathParts = relativePath.split(path.sep).filter(p => p && !p.startsWith('.'));
      const fileName = pathParts[pathParts.length - 1];
      const fileNameWithoutExt = path.parse(fileName).name;

      // Get folder names (excluding the filename)
      const folders = pathParts.slice(0, -1);

      const updatedMetadata = { ...file.metadata };
      if (!updatedMetadata.traits) {
        updatedMetadata.traits = [];
      }

      let hasChanges = false;

      // STEP 1: Apply rename patterns first (transforms the filename)
      let renamedFileName = fileNameWithoutExt;
      if (renamePatterns && renamePatterns.length > 0) {
        for (const pattern of renamePatterns) {
          switch (pattern.type) {
            case 'prefix-remove':
              if (renamedFileName.startsWith(pattern.pattern)) {
                renamedFileName = renamedFileName.substring(pattern.pattern.length);
              }
              break;
            case 'suffix-remove':
              if (renamedFileName.endsWith(pattern.pattern)) {
                renamedFileName = renamedFileName.substring(0, renamedFileName.length - pattern.pattern.length);
              }
              break;
            case 'replace':
              renamedFileName = renamedFileName.replace(new RegExp(pattern.pattern, 'g'), pattern.replacement || '');
              break;
            case 'regex-replace':
              try {
                renamedFileName = renamedFileName.replace(new RegExp(pattern.pattern, 'g'), pattern.replacement || '');
              } catch (e) {
                console.warn(`Invalid regex pattern: ${pattern.pattern}`, e);
              }
              break;
          }
        }

        // If name changed, update metadata name
        if (renamedFileName !== fileNameWithoutExt) {
          const ext = path.extname(fileName);
          updatedMetadata.name = renamedFileName + ext;
          hasChanges = true;
        }
      }

      // STEP 2: Apply folder mappings
      if (traitMapping && traitMapping.folderAsItemName && folders.length >= 1) {
        // Use folder name as item name, current file is a variant
        const folderName = folders[folders.length - 1]; // Immediate parent folder
        if (updatedMetadata.name !== folderName) {
          updatedMetadata.name = folderName;
          hasChanges = true;
        }
      }

      // STEP 3: Apply filename patterns (use renamed filename)
      if (filenamePatterns && filenamePatterns.length > 0) {
        for (const pattern of filenamePatterns) {
          let matches = false;
          let extractedValue = pattern.matchValue || '';

          switch (pattern.type) {
            case 'prefix':
              if (renamedFileName.toLowerCase().startsWith(pattern.pattern.toLowerCase())) {
                matches = true;
              }
              break;
            case 'suffix':
              if (renamedFileName.toLowerCase().endsWith(pattern.pattern.toLowerCase())) {
                matches = true;
              }
              break;
            case 'contains':
              if (renamedFileName.toLowerCase().includes(pattern.pattern.toLowerCase())) {
                matches = true;
              }
              break;
            case 'regex':
              try {
                const regex = new RegExp(pattern.pattern, 'i');
                const match = renamedFileName.match(regex);
                if (match) {
                  matches = true;
                  // If regex has capture group, use that as extracted value
                  extractedValue = match[1] || pattern.matchValue || '';
                }
              } catch (e) {
                // Invalid regex, skip
                console.warn(`Invalid regex pattern: ${pattern.pattern}`, e);
              }
              break;
          }

          if (matches && extractedValue) {
            if (pattern.targetField === 'rarity') {
              if (updatedMetadata.rarityLabel !== extractedValue) {
                updatedMetadata.rarityLabel = extractedValue;
                hasChanges = true;
              }
            } else {
              // Map to trait
              const traitIndex = updatedMetadata.traits.findIndex(t => t.name === pattern.targetField);
              if (traitIndex >= 0) {
                if (updatedMetadata.traits[traitIndex].value !== extractedValue) {
                  updatedMetadata.traits[traitIndex].value = extractedValue;
                  hasChanges = true;
                }
              } else {
                updatedMetadata.traits.push({
                  name: pattern.targetField,
                  value: extractedValue
                });
                hasChanges = true;
              }
            }
          }
        }
      }

      // STEP 4: Apply level 1 folder mapping (parent folder for one-level, grandparent for two-level)
      // Skip if using folder as item name
      if (traitMapping && traitMapping.level1TraitName && !traitMapping.folderAsItemName && folders.length >= 1) {
        const folderIndex = folderStructure === 'two-level' && folders.length >= 2 ? 0 : folders.length - 1;
        const folderValue = folders[folderIndex];

        if (traitMapping.level1TraitName === 'rarity') {
          // Map to rarity
          if (updatedMetadata.rarityLabel !== folderValue) {
            updatedMetadata.rarityLabel = folderValue;
            hasChanges = true;
          }
        } else {
          // Map to trait
          const traitIndex = updatedMetadata.traits.findIndex(t => t.name === traitMapping.level1TraitName);
          if (traitIndex >= 0) {
            if (updatedMetadata.traits[traitIndex].value !== folderValue) {
              updatedMetadata.traits[traitIndex].value = folderValue;
              hasChanges = true;
            }
          } else {
            updatedMetadata.traits.push({
              name: traitMapping.level1TraitName,
              value: folderValue
            });
            hasChanges = true;
          }
        }
      }

      // STEP 5: Apply level 2 folder mapping (only for two-level structure)
      // Skip if using folder as item name
      if (traitMapping && traitMapping.level2TraitName && !traitMapping.folderAsItemName && folderStructure === 'two-level' && folders.length >= 2) {
        const folderValue = folders[1]; // Second level folder

        if (traitMapping.level2TraitName === 'rarity') {
          // Map to rarity
          if (updatedMetadata.rarityLabel !== folderValue) {
            updatedMetadata.rarityLabel = folderValue;
            hasChanges = true;
          }
        } else {
          // Map to trait
          const traitIndex = updatedMetadata.traits.findIndex(t => t.name === traitMapping.level2TraitName);
          if (traitIndex >= 0) {
            if (updatedMetadata.traits[traitIndex].value !== folderValue) {
              updatedMetadata.traits[traitIndex].value = folderValue;
              hasChanges = true;
            }
          } else {
            updatedMetadata.traits.push({
              name: traitMapping.level2TraitName,
              value: folderValue
            });
            hasChanges = true;
          }
        }
      }

      // STEP 6: Apply name standardization (final step, uses all mapped metadata)
      if (this._collectionConfig.nameStandardization?.enabled && this._collectionConfig.nameStandardization.template) {
        const currentName = updatedMetadata.name || fileNameWithoutExt;
        let standardizedName = this._collectionConfig.nameStandardization.template;

        // Get base item name (without extension)
        let baseItemName = currentName;
        const ext = path.extname(currentName);
        if (ext) {
          baseItemName = currentName.substring(0, currentName.length - ext.length);
        }

        // Replace template variables
        standardizedName = standardizedName.replace('{itemName}', baseItemName);
        standardizedName = standardizedName.replace('{rarity}', updatedMetadata.rarityLabel || '');

        // Replace trait variables {trait:TraitName}
        if (updatedMetadata.traits && updatedMetadata.traits.length > 0) {
          for (const trait of updatedMetadata.traits) {
            standardizedName = standardizedName.replace(`{trait:${trait.name}}`, trait.value);
          }
        }

        // Clean up any remaining unreplaced variables (replace with empty string)
        standardizedName = standardizedName.replace(/\{[^}]+\}/g, '');

        // Remove any double spaces or trailing/leading spaces
        standardizedName = standardizedName.replace(/\s+/g, ' ').trim();

        // If standardization resulted in a different name, update it
        if (standardizedName && standardizedName !== baseItemName) {
          updatedMetadata.name = standardizedName;
          hasChanges = true;
        }
      }

      if (hasChanges) {
        // Update file metadata
        const fileIndex = this._files.findIndex(f => f.id === file.id);
        if (fileIndex >= 0) {
          this._files[fileIndex] = {
            ...this._files[fileIndex],
            metadata: updatedMetadata
          };
          updatedCount++;
        }
      }
    });

    // Save state and notify
    this.saveCollectionState();
    this.sendUpdate();

    vscode.window.showInformationMessage(
      `Applied structure mappings to ${updatedCount} item${updatedCount !== 1 ? 's' : ''}`
    );
  }

  private async mintCollection() {
    console.log('[CollectionMinter] mintCollection() function entered');
    try {
      // Validate configuration
      const { name, description, quantity, rarityLabels, traits } = this._collectionConfig;
      console.log('[CollectionMinter] Config validation:', {
        name,
        description,
        quantity,
        filesCount: this._files.length,
        selectedFilesCount: this._files.filter(f => f.selected).length
      });

      if (!name || !description) {
        console.log('[CollectionMinter] Validation failed: missing name or description');
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

      // mintStarted message already sent from message handler
      // Yield to event loop to let other messages process
      await new Promise(resolve => setImmediate(resolve));

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

        // Create collection inscription with minimal inscription data
        // Collection inscriptions typically don't have image data, just metadata
        const collectionResult = await createOrdinals({
          utxos: paymentUtxos,
          destinations: [{
            address: ordAddress,
            inscription: {
              dataB64: '', // Empty data for collection inscription
              contentType: 'application/bsv-20' // Standard collection content type
            }
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

            // Log file path to verify we're using transformed workspace files
            console.log(`[CollectionMinter] Minting item ${globalIndex + 1}/${totalItems} from: ${file.path}`);

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

            // Process image with output settings
            let fileDataB64: string;

            // Check if we should process the image
            const shouldProcessImage = this._outputSettings && Object.keys(this._outputSettings).length > 0;

            if (shouldProcessImage) {
              // Send progress update for image processing
              this._panel.webview.postMessage({
                command: 'mintProgress',
                current: globalIndex + 1,
                total: totalItems,
                status: 'processing',
                message: `Processing image ${globalIndex + 1}/${totalItems}...`
              });
              await new Promise(resolve => setImmediate(resolve));

              // Import and use ImageProcessor
              const { imageProcessor } = await import('../../services/imageProcessor');

              // Convert output settings to ImageProcessingOptions
              const processingOptions: any = {
                format: this._outputSettings.format !== 'original' ? this._outputSettings.format : undefined,
                quality: this._outputSettings.quality,
                compression: this._outputSettings.compression,
                width: this._outputSettings.maxWidth,
                height: this._outputSettings.maxHeight,
                fit: 'inside' // Don't enlarge, maintain aspect ratio
              };

              console.log(`[CollectionMinter] Processing image ${file.name} with options:`, processingOptions);

              // Process image and get buffer
              const processedBuffer = await imageProcessor.processImage(file.path, processingOptions);
              fileDataB64 = processedBuffer.toString('base64');

              console.log(`[CollectionMinter] Processed ${file.name}: ${(processedBuffer.length / 1024).toFixed(1)} KB`);
            } else {
              // No processing - just read the file
              const fileBuffer = await fs.readFile(file.path);
              fileDataB64 = fileBuffer.toString('base64');
            }

            // Yield to event loop after heavy operation
            await new Promise(resolve => setImmediate(resolve));

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
            const collectionName = this._collectionConfig.name || 'Collection';
            const safeCollectionName = collectionName.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
            const txLabel = `${safeCollectionName}-${globalIndex + 1}-of-${totalItems}`;

            // Broadcast item or save to cache
            if (autoBroadcast) {
              const { transactionService } = await import('../../services/transactionService');
              const itemBroadcastResult = await transactionService.broadcastTransaction(itemTxHex);

              if (itemBroadcastResult.status !== 'success' || !itemBroadcastResult.txid) {
                vscode.window.showWarningMessage(`Failed to broadcast item ${globalIndex + 1}: ${itemBroadcastResult.message}`);
                // Send progress update to webview
                this._panel.webview.postMessage({
                  command: 'mintProgress',
                  current: globalIndex + 1,
                  total: totalItems,
                  status: 'error',
                  message: `Failed to broadcast item ${globalIndex + 1}`
                });
              } else {
                itemTxs.push(itemBroadcastResult.txid);
                // Send progress update to webview
                this._panel.webview.postMessage({
                  command: 'mintProgress',
                  current: globalIndex + 1,
                  total: totalItems,
                  status: 'success',
                  txid: itemBroadcastResult.txid,
                  label: txLabel
                });
                // Yield immediately so webview can update
                await new Promise(resolve => setImmediate(resolve));
              }
            } else {
              // Save to tx cache with label
              const { TxCache } = await import('../../services/txCache');
              const cache = new TxCache();

              // Get txid from transaction
              const txid = itemResult.tx.id('hex') as string;

              // Save to cache
              cache.set(txid, itemTxHex, 'main', {
                inputCount: itemResult.tx.inputs.length,
                outputCount: itemResult.tx.outputs.length
              });

              // Set label for easy identification
              cache.setLabel(txid, txLabel);

              itemTxs.push(txid);

              // Send progress update to webview
              this._panel.webview.postMessage({
                command: 'mintProgress',
                current: globalIndex + 1,
                total: totalItems,
                status: 'saved',
                txid,
                label: txLabel
              });
              // Yield immediately so webview can update
              await new Promise(resolve => setImmediate(resolve));
            }

            // Small delay between items (reduced from 500ms to 100ms since we yield frequently now)
            await new Promise(resolve => setTimeout(resolve, 100));
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
      console.error('[CollectionMinter] Minting error:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`Error minting collection: ${errorMessage}`);

      // Send error to webview
      this._panel.webview.postMessage({
        command: 'mintError',
        message: errorMessage
      });
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
