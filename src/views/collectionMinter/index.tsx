import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { KeyVault } from '../../keyVault';
import vsApi from '../../vsShim';

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

  private constructor(panel: vscode.WebviewPanel, vault: KeyVault, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._vault = vault;
    this._extensionUri = extensionUri;

    // Set up webview content
    this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);

    // Handle panel disposal
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    // Handle messages from webview
    this._panel.webview.onDidReceiveMessage(
      (msg) => this.handleMessage(msg),
      null,
      this._disposables
    );
  }

  public static async show(vault: KeyVault, extensionUri: vscode.Uri) {
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

    // Show panel
    if (CollectionMinterPanel.currentPanel) {
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
      CollectionMinterPanel.currentPanel = new CollectionMinterPanel(panel, vault, extensionUri);
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

      case 'estimateCosts':
        await this.estimateCosts();
        break;
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
    }
  }

  private async loadFilesFromFolder() {
    if (!this._selectedFolder) return;

    try {
      const entries = await fs.readdir(this._selectedFolder, { withFileTypes: true });
      const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'];

      this._files = [];

      for (const entry of entries) {
        if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (imageExtensions.includes(ext)) {
            const filePath = path.join(this._selectedFolder, entry.name);
            const stats = await fs.stat(filePath);

            // Read file and convert to data URL
            const fileData = await fs.readFile(filePath);
            const base64 = fileData.toString('base64');
            const contentType = this.getContentType(ext);
            const dataUrl = `data:${contentType};base64,${base64}`;

            this._files.push({
              id: crypto.randomUUID(),
              path: filePath,
              name: entry.name,
              dataUrl,
              contentType,
              size: stats.size,
              selected: true,
              metadata: {
                name: path.parse(entry.name).name,
                traits: []
              }
            });
          }
        }
      }

      this.sendUpdate();
      vscode.window.showInformationMessage(`Loaded ${this._files.length} images from folder`);
    } catch (error) {
      vscode.window.showErrorMessage(`Error loading files: ${error instanceof Error ? error.message : String(error)}`);
    }
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
    }
  }

  private updateFileMetadata(fileId: string, metadata: Partial<CollectionItemMetadata>) {
    const file = this._files.find(f => f.id === fileId);
    if (file) {
      file.metadata = { ...file.metadata, ...metadata } as CollectionItemMetadata;
      this.sendUpdate();
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

  private async estimateCosts() {
    const selectedFiles = this._files.filter(f => f.selected);

    // Calculate inscription costs
    const totalDataSize = selectedFiles.reduce((sum, f) => sum + f.size, 0);
    const inscriptionCost = (totalDataSize / 1000) * 0.00001; // Rough estimate

    // Calculate TX fees
    const txFees = selectedFiles.length * 0.00001; // Rough estimate

    this._panel.webview.postMessage({
      command: 'costEstimate',
      estimate: {
        itemCount: selectedFiles.length,
        totalDataSize,
        inscriptionCost,
        txFees,
        totalBSV: inscriptionCost + txFees
      }
    });
  }

  private async mintCollection() {
    // TODO: Implement minting logic with js-1sat-ord
    vscode.window.showInformationMessage('Minting functionality will be implemented next!');
  }

  public dispose() {
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
