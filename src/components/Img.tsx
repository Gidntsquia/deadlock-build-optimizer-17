import { useState } from 'react';

interface ImgProps {
  src: string | undefined;
  alt: string;
  size: number;
  className?: string;
  /** shown when the image is missing; first letters of the name by default */
  fallback?: string;
}

/** Fixed-size image from the local snapshot; a neutral tile with initials when it is missing. */
export function Img({ src, alt, size, className, fallback }: ImgProps) {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size };
  if (!src || failed) {
    return (
      <span className={`img-fallback ${className ?? ''}`} style={style} role="img" aria-label={alt}>
        {(fallback ?? alt).slice(0, 2)}
      </span>
    );
  }
  return <img className={className} src={src} alt={alt} width={size} height={size} style={style} decoding="async" onError={() => setFailed(true)} />;
}
