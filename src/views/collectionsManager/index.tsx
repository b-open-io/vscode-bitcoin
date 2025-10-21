import * as vscode from 'vscode';
import type { KeyVault } from '../../keyVault';
import { collectionsState, type Collection } from '../../services/collectionsStateService';
import vsApi from '../../vsShim';
import { CollectionMinterPanel } from '../collectionMinter/index';

export class CollectionsManagerPanel {
  public static currentPanel: CollectionsManagerPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _vault: KeyVault;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];

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
    if (CollectionsManagerPanel.currentPanel) {
      CollectionsManagerPanel.currentPanel._panel.reveal(vscode.ViewColumn.One);
      CollectionsManagerPanel.currentPanel.sendCollectionsList();
    } else {
      const panel = vscode.window.createWebviewPanel(
        'collectionsManager',
        'Collections',
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [extensionUri]
        }
      );
      CollectionsManagerPanel.currentPanel = new CollectionsManagerPanel(panel, vault, extensionUri);
      CollectionsManagerPanel.currentPanel.sendCollectionsList();
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
        <title>Collections Manager</title>
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
          window.PANEL_TYPE = 'collections-manager';
        </script>
        <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
      </body>
      </html>`;
  }

  private async handleMessage(msg: any) {
    switch (msg.command) {
      case 'createCollection':
        await this.createCollection();
        break;

      case 'openCollection':
        if (msg.collectionId) {
          await this.openCollection(msg.collectionId);
        }
        break;

      case 'deleteCollection':
        if (msg.collectionId) {
          await this.deleteCollection(msg.collectionId);
        }
        break;

      case 'exportCollection':
        if (msg.collectionId) {
          await this.exportCollection(msg.collectionId);
        }
        break;

      case 'refreshCollections':
        this.sendCollectionsList();
        break;
    }
  }

  private async createCollection() {
    try {
      const collectionId = collectionsState.createCollection();

      // Open the new collection in Collection Minter
      await CollectionMinterPanel.show(this._vault, this._extensionUri, collectionId);

      // Refresh list
      this.sendCollectionsList();

      vsApi.window.showInformationMessage('New collection created');
    } catch (error) {
      vsApi.window.showErrorMessage(`Failed to create collection: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async openCollection(collectionId: string) {
    try {
      await CollectionMinterPanel.show(this._vault, this._extensionUri, collectionId);
    } catch (error) {
      vsApi.window.showErrorMessage(`Failed to open collection: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async deleteCollection(collectionId: string) {
    const collection = collectionsState.getCollection(collectionId);
    if (!collection) return;

    const collectionName = collection.config.name || 'Untitled Collection';
    const confirm = await vsApi.window.showWarningMessage(
      `Delete collection "${collectionName}"? This cannot be undone.`,
      { modal: true },
      'Delete'
    );

    if (confirm === 'Delete') {
      const success = collectionsState.deleteCollection(collectionId);
      if (success) {
        this.sendCollectionsList();
        vsApi.window.showInformationMessage(`Collection "${collectionName}" deleted`);
      } else {
        vsApi.window.showErrorMessage('Failed to delete collection');
      }
    }
  }

  private async exportCollection(collectionId: string) {
    const collection = collectionsState.getCollection(collectionId);
    if (!collection) return;

    const defaultName = `${collection.config.name || 'collection'}.json`.replace(/[^a-z0-9.-]/gi, '_');
    const uri = await vsApi.window.showSaveDialog({
      defaultUri: vscode.Uri.file(defaultName),
      filters: {
        'JSON Files': ['json']
      }
    });

    if (uri) {
      const success = collectionsState.exportCollection(collectionId, uri.fsPath);
      if (success) {
        vsApi.window.showInformationMessage(`Collection exported to ${uri.fsPath}`);
      } else {
        vsApi.window.showErrorMessage('Failed to export collection');
      }
    }
  }

  private sendCollectionsList() {
    const collections = collectionsState.listCollections();

    this._panel.webview.postMessage({
      command: 'collectionsList',
      collections: collections.map(c => ({
        id: c.id,
        name: c.config.name || 'Untitled Collection',
        description: c.config.description,
        itemCount: (c as any).selectedFilesCount || 0, // Use actual selected files count
        traitCount: c.config.traits?.length || 0,
        rarityCount: c.config.rarityLabels?.length || 0,
        status: c.status,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        mintedTxId: c.mintedTxId,
        mintedItemCount: c.mintedItemCount
      }))
    });
  }

  public dispose() {
    CollectionsManagerPanel.currentPanel = undefined;
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
