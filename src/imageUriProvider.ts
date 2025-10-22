import * as vscode from 'vscode';
import * as path from 'path';
import { imageProcessor, ImageProcessingOptions } from './services/imageProcessor';
import { collectionsState } from './services/collectionsStateService';

/**
 * URI Provider for vscode-bitcoin-image:// scheme
 *
 * Supports URIs like:
 * - vscode-bitcoin-image://item/{fileId}?thumbnail=true
 * - vscode-bitcoin-image://item/{fileId}?width=200&height=200&format=webp&quality=85
 * - vscode-bitcoin-image://item/{fileId}?preview=true
 * - vscode-bitcoin-image://file/{absolutePath}?thumbnail=true
 *
 * For webviews, use the processImageFromUri() method via message handlers
 */
export class ImageUriProvider implements vscode.TextDocumentContentProvider {

  /**
   * Parse URI and return processing options
   */
  private parseUri(uri: vscode.Uri): { type: 'item' | 'file'; identifier: string; options: ImageProcessingOptions } {
    // URI format: vscode-bitcoin-image://item/{fileId} or vscode-bitcoin-image://file/{path}
    const pathParts = uri.path.split('/').filter(Boolean);

    if (pathParts.length < 2) {
      throw new Error(`Invalid URI format: ${uri.toString()}`);
    }

    const type = pathParts[0] as 'item' | 'file';
    const identifier = pathParts.slice(1).join('/'); // Rejoin in case path has slashes

    // Parse query parameters
    const options: ImageProcessingOptions = {};

    // Parse query string manually (vscode.Uri doesn't have URLSearchParams-like API)
    const queryString = uri.query;
    if (queryString) {
      const params = new URLSearchParams(queryString);

      // Preset modes
      if (params.get('thumbnail') === 'true') {
        options.thumbnail = true;
      }
      if (params.get('preview') === 'true') {
        options.preview = true;
      }

      // Size options
      const width = params.get('width');
      if (width) options.width = parseInt(width, 10);

      const height = params.get('height');
      if (height) options.height = parseInt(height, 10);

      const fit = params.get('fit');
      if (fit) options.fit = fit as any;

      // Format options
      const format = params.get('format');
      if (format) options.format = format as any;

      const quality = params.get('quality');
      if (quality) options.quality = parseInt(quality, 10);

      // Compression
      const compression = params.get('compression');
      if (compression) options.compression = compression as any;

      // Cache control
      if (params.get('noCache') === 'true') {
        options.noCache = true;
      }
    }

    return { type, identifier, options };
  }

  /**
   * Resolve file path from URI
   */
  private async resolveFilePath(type: 'item' | 'file', identifier: string): Promise<string> {
    if (type === 'file') {
      // Direct file path
      return identifier;
    }

    // type === 'item': Look up file from collection
    const fileId = identifier;

    // Get active collection
    const activeCollectionId = collectionsState.getActiveCollectionId();
    if (!activeCollectionId) {
      throw new Error('No active collection');
    }

    const collection = collectionsState.getCollection(activeCollectionId);
    if (!collection) {
      throw new Error(`Collection not found: ${activeCollectionId}`);
    }

    // Find file by ID
    const file = collection.files.find(f => f.id === fileId);
    if (!file) {
      throw new Error(`File not found: ${fileId}`);
    }

    return file.path;
  }

  /**
   * TextDocumentContentProvider implementation
   * This allows opening images in VS Code editor via the custom URI
   */
  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    try {
      const { type, identifier, options } = this.parseUri(uri);
      const filePath = await this.resolveFilePath(type, identifier);

      // Process image and return as data URL
      const dataUrl = await imageProcessor.processImageAsDataUrl(filePath, options);

      // Return HTML that displays the image
      // This is what shows when you open the URI in VS Code
      return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body {
      margin: 0;
      padding: 20px;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      background: #1e1e1e;
    }
    img {
      max-width: 100%;
      max-height: 100vh;
      object-fit: contain;
    }
    .info {
      position: fixed;
      top: 10px;
      right: 10px;
      background: rgba(0,0,0,0.7);
      color: #fff;
      padding: 10px;
      border-radius: 4px;
      font-family: monospace;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div class="info">
    ${path.basename(filePath)}<br>
    ${options.width ? `${options.width}x${options.height || 'auto'}` : 'original size'}<br>
    ${options.format || 'original format'}<br>
    ${options.quality ? `quality: ${options.quality}` : ''}
  </div>
  <img src="${dataUrl}" alt="${path.basename(filePath)}">
</body>
</html>`;
    } catch (error) {
      console.error('[ImageUriProvider] Error providing content:', error);
      return `<!DOCTYPE html>
<html>
<body>
  <h1>Error loading image</h1>
  <pre>${error}</pre>
</body>
</html>`;
    }
  }

  /**
   * Process image from URI string (for use in message handlers)
   * Returns data URL that can be sent to webview
   */
  async processImageFromUri(uriString: string): Promise<string> {
    const uri = vscode.Uri.parse(uriString);
    const { type, identifier, options } = this.parseUri(uri);
    const filePath = await this.resolveFilePath(type, identifier);
    return imageProcessor.processImageAsDataUrl(filePath, options);
  }

  /**
   * Process image from fileId with options (helper method)
   */
  async processImageFromFileId(fileId: string, options: ImageProcessingOptions = {}): Promise<string> {
    const filePath = await this.resolveFilePath('item', fileId);
    return imageProcessor.processImageAsDataUrl(filePath, options);
  }

  /**
   * Build URI string for use in webview HTML
   */
  static buildUri(fileId: string, options: ImageProcessingOptions = {}): string {
    const params = new URLSearchParams();

    // Add options as query parameters
    if (options.thumbnail) params.set('thumbnail', 'true');
    if (options.preview) params.set('preview', 'true');
    if (options.width) params.set('width', options.width.toString());
    if (options.height) params.set('height', options.height.toString());
    if (options.fit) params.set('fit', options.fit);
    if (options.format) params.set('format', options.format);
    if (options.quality) params.set('quality', options.quality.toString());
    if (options.compression) params.set('compression', options.compression);
    if (options.noCache) params.set('noCache', 'true');

    const queryString = params.toString();
    return `vscode-bitcoin-image://item/${fileId}${queryString ? `?${queryString}` : ''}`;
  }
}
