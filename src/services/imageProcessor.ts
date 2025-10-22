import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import sharp from 'sharp';
import vsApi from '../vsShim';

export interface ImageProcessingOptions {
  // Size options
  width?: number;
  height?: number;
  fit?: 'cover' | 'contain' | 'fill' | 'inside' | 'outside';

  // Format options
  format?: 'original' | 'webp' | 'avif' | 'jpeg' | 'png';
  quality?: number; // 1-100

  // Optimization options
  compression?: 'none' | 'lossless' | 'lossy';

  // Quick presets
  thumbnail?: boolean; // 200x200 webp quality 80
  preview?: boolean;   // 800x800 webp quality 85

  // Cache control
  noCache?: boolean;
}

/**
 * Image processing service with caching support
 * Handles resizing, format conversion, optimization, and effects
 */
export class ImageProcessor {
  private cacheDir: string;

  constructor(workspaceRoot?: string) {
    const bitcoinDir = this.getBitcoinDirectory(workspaceRoot);
    this.cacheDir = path.join(bitcoinDir, 'cache', 'images');
    this.ensureDirectories();
  }

  private getBitcoinDirectory(workspaceRoot?: string): string {
    const config = vsApi.workspace.getConfiguration('bitcoin');
    const bitcoinPath = config.get<string>('workspace.path') || '.bitcoin';

    if (workspaceRoot) {
      return path.join(workspaceRoot, bitcoinPath);
    }

    const useProjectLevel = config.get<boolean>('storage.useProjectLevel') || false;

    if (useProjectLevel && vsApi?.workspace?.workspaceFolders?.length) {
      const wsRoot = vsApi.workspace.workspaceFolders[0].uri.fsPath;
      return path.join(wsRoot, bitcoinPath);
    }

    const homeDir = process.env.HOME || process.env.USERPROFILE || '.';
    return path.join(homeDir, bitcoinPath);
  }

  private ensureDirectories(): void {
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  /**
   * Generate cache key from file path and options
   * Uses SHA-256 hash to keep filenames short regardless of path length
   */
  private getCacheKey(filePath: string, options: ImageProcessingOptions): string {
    // Create a hash of the file path to keep cache key short
    const pathHash = crypto.createHash('sha256')
      .update(filePath)
      .digest('hex')
      .substring(0, 16); // Use first 16 chars of hash

    // Build options string
    const opts = [
      options.width || 'w',
      options.height || 'h',
      options.format || 'orig',
      options.quality || 'q',
      options.fit || 'f',
      options.compression || 'c',
      options.thumbnail ? 'thumb' : '',
      options.preview ? 'prev' : ''
    ].filter(Boolean).join('-');

    return `${pathHash}-${opts}`;
  }

  /**
   * Get cached image path
   */
  private getCachePath(cacheKey: string, format: string): string {
    const ext = format === 'original' ? 'cache' : format;
    return path.join(this.cacheDir, `${cacheKey}.${ext}`);
  }

  /**
   * Process image with sharp
   */
  async processImage(filePath: string, options: ImageProcessingOptions = {}): Promise<Buffer> {
    console.log(`[ImageProcessor] Processing: ${path.basename(filePath)}`, options);

    // Apply presets
    if (options.thumbnail) {
      options = {
        width: 200,
        height: 200,
        fit: 'inside',
        format: 'webp',
        quality: 80,
        compression: 'lossy',
        ...options
      };
    } else if (options.preview) {
      options = {
        width: 800,
        height: 800,
        fit: 'inside',
        format: 'webp',
        quality: 85,
        compression: 'lossy',
        ...options
      };
    }

    // Check cache first (unless noCache is set)
    if (!options.noCache) {
      const cacheKey = this.getCacheKey(filePath, options);
      const cachePath = this.getCachePath(cacheKey, options.format || 'webp');

      if (fs.existsSync(cachePath)) {
        console.log(`[ImageProcessor] Cache hit: ${path.basename(cachePath)}`);
        return fs.readFileSync(cachePath);
      }
    }

    // Start processing pipeline
    let pipeline = sharp(filePath);

    // Get metadata to determine original format
    const metadata = await pipeline.metadata();
    const outputFormat = options.format === 'original' ? metadata.format : options.format;

    // Resize if needed
    if (options.width || options.height) {
      pipeline = pipeline.resize(options.width, options.height, {
        fit: options.fit || 'inside',
        withoutEnlargement: true
      });
    }

    // Apply format-specific options
    switch (outputFormat) {
      case 'webp':
        pipeline = pipeline.webp({
          quality: options.quality || 85,
          lossless: options.compression === 'lossless',
          nearLossless: options.compression === 'lossless',
          effort: 4 // Balance between speed and compression
        });
        break;

      case 'avif':
        pipeline = pipeline.avif({
          quality: options.quality || 85,
          lossless: options.compression === 'lossless',
          effort: 4
        });
        break;

      case 'jpeg':
      case 'jpg':
        pipeline = pipeline.jpeg({
          quality: options.quality || 85,
          progressive: true,
          mozjpeg: true
        });
        break;

      case 'png':
        pipeline = pipeline.png({
          quality: options.quality || 85,
          compressionLevel: options.compression === 'lossless' ? 9 : 6,
          progressive: true
        });
        break;
    }

    // Process and get buffer
    const buffer = await pipeline.toBuffer();

    // Cache the result (unless noCache is set)
    if (!options.noCache) {
      const cacheKey = this.getCacheKey(filePath, options);
      const cachePath = this.getCachePath(cacheKey, outputFormat || 'webp');
      fs.writeFileSync(cachePath, buffer);
      console.log(`[ImageProcessor] Cached: ${path.basename(cachePath)} (${(buffer.length / 1024).toFixed(1)} KB)`);
    }

    return buffer;
  }

  /**
   * Process image and return as base64 data URL
   */
  async processImageAsDataUrl(filePath: string, options: ImageProcessingOptions = {}): Promise<string> {
    const buffer = await this.processImage(filePath, options);
    const format = options.format === 'original' ? 'image/png' : `image/${options.format || 'webp'}`;
    const base64 = buffer.toString('base64');
    return `data:${format};base64,${base64}`;
  }

  /**
   * Clear all cached images
   */
  clearCache(): number {
    let count = 0;
    if (fs.existsSync(this.cacheDir)) {
      const files = fs.readdirSync(this.cacheDir);
      for (const file of files) {
        fs.unlinkSync(path.join(this.cacheDir, file));
        count++;
      }
    }
    console.log(`[ImageProcessor] Cleared ${count} cached images`);
    return count;
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { count: number; totalSize: number; totalSizeMB: number } {
    let count = 0;
    let totalSize = 0;

    if (fs.existsSync(this.cacheDir)) {
      const files = fs.readdirSync(this.cacheDir);
      for (const file of files) {
        const filePath = path.join(this.cacheDir, file);
        const stats = fs.statSync(filePath);
        totalSize += stats.size;
        count++;
      }
    }

    return {
      count,
      totalSize,
      totalSizeMB: totalSize / (1024 * 1024)
    };
  }
}

// Singleton instance
export const imageProcessor = new ImageProcessor();
