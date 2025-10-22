import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { getVscode } from '../vscode';

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

interface ProcessedImageProps {
  fileId: string;
  options?: ImageProcessingOptions;
  alt?: string;
  className?: string;
  onLoad?: () => void;
  onError?: (error: string) => void;
  // Standard img props
  style?: React.CSSProperties;
}

/**
 * ProcessedImage component
 * Loads images via backend image processor with caching and effects
 *
 * Usage:
 *   <ProcessedImage fileId="abc123" options={{ thumbnail: true }} />
 *   <ProcessedImage fileId="abc123" options={{ width: 200, height: 200, format: 'webp' }} />
 */
export function ProcessedImage({
  fileId,
  options = {},
  alt = '',
  className = '',
  onLoad,
  onError,
  style
}: ProcessedImageProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Generate cache key from fileId + options
  const cacheKey = `${fileId}-${JSON.stringify(options)}`;

  useEffect(() => {
    setLoading(true);
    setError(null);
    setDataUrl(null);

    console.log('[ProcessedImage] Requesting image:', fileId, options);

    // Request processed image from backend
    const vscode = getVscode();
    vscode.postMessage({
      command: 'processImage',
      fileId,
      options
    });

    // Set up message listener for response
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;

      if (message.command === 'imageProcessed' && message.fileId === fileId) {
        // Check if this response matches our options (simple comparison)
        const responseKey = `${message.fileId}-${JSON.stringify(message.options)}`;
        if (responseKey === cacheKey) {
          console.log('[ProcessedImage] Received processed image:', fileId);
          setDataUrl(message.dataUrl);
          setLoading(false);
          onLoad?.();
        }
      } else if (message.command === 'imageProcessError' && message.fileId === fileId) {
        console.error('[ProcessedImage] Error processing image:', message.error);
        setError(message.error);
        setLoading(false);
        onError?.(message.error);
      }
    };

    window.addEventListener('message', handleMessage);

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [cacheKey]); // Re-request if fileId or options change

  if (error) {
    return (
      <div className={`flex items-center justify-center bg-red-500/10 text-red-500 text-sm p-4 ${className}`} style={style}>
        <span>Failed to load image</span>
      </div>
    );
  }

  if (loading || !dataUrl) {
    return (
      <div className={`flex items-center justify-center bg-muted ${className}`} style={style}>
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <img
      src={dataUrl}
      alt={alt}
      className={className}
      style={style}
    />
  );
}

/**
 * Hook for loading processed images programmatically
 * Returns dataUrl and loading state
 *
 * Usage:
 *   const { dataUrl, loading, error } = useProcessedImage(fileId, { thumbnail: true });
 */
export function useProcessedImage(fileId: string, options: ImageProcessingOptions = {}) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cacheKey = `${fileId}-${JSON.stringify(options)}`;

  useEffect(() => {
    setLoading(true);
    setError(null);
    setDataUrl(null);

    console.log('[useProcessedImage] Requesting image:', fileId, options);

    const vscode = getVscode();
    vscode.postMessage({
      command: 'processImage',
      fileId,
      options
    });

    const handleMessage = (event: MessageEvent) => {
      const message = event.data;

      if (message.command === 'imageProcessed' && message.fileId === fileId) {
        const responseKey = `${message.fileId}-${JSON.stringify(message.options)}`;
        if (responseKey === cacheKey) {
          setDataUrl(message.dataUrl);
          setLoading(false);
        }
      } else if (message.command === 'imageProcessError' && message.fileId === fileId) {
        setError(message.error);
        setLoading(false);
      }
    };

    window.addEventListener('message', handleMessage);

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [cacheKey]);

  return { dataUrl, loading, error };
}
