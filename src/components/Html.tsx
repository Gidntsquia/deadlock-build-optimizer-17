import { useMemo } from 'react';
import { cleanHtml, type ImageManifest } from '../data/assets';

/** Renders a fragment of assets-API text (spans, line breaks, property icons) after cleaning it. */
export function Html({ html, manifest, className }: { html: string | undefined; manifest: ImageManifest; className?: string }) {
  const clean = useMemo(() => cleanHtml(html, manifest), [html, manifest]);
  if (!clean) return null;
  return <div className={`rich ${className ?? ''}`} dangerouslySetInnerHTML={{ __html: clean }} />;
}
