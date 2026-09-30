import { useMemo, useState } from 'react';
import { localImage } from '../data/assets';
import type { HeroBasics } from '../types';
import { Img } from './Img';
import { Sheet } from './Sheet';
import { useUi } from './context';

export function heroPortrait(manifest: Record<string, string>, hero: HeroBasics | undefined): string | undefined {
  if (!hero) return undefined;
  return localImage(manifest, hero.images.icon_hero_card_webp) ?? localImage(manifest, hero.images.icon_image_small_webp);
}

interface HeroPickerProps {
  heroes: HeroBasics[];
  selectedId: number;
  onSelect: (id: number) => void;
  onClose: () => void;
}

export function HeroPicker({ heroes, selectedId, onSelect, onClose }: HeroPickerProps) {
  const { app } = useUi();
  const [query, setQuery] = useState('');
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...heroes].sort((a, b) => a.name.localeCompare(b.name)).filter((h) => !q || h.name.toLowerCase().includes(q));
  }, [heroes, query]);

  return (
    <Sheet title="Choose a hero" onClose={onClose} testId="hero-picker">
      <input className="search" type="search" placeholder="Search heroes" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search heroes" data-testid="hero-search" />
      {list.length === 0 ? (
        <p className="empty">No hero matches “{query}”.</p>
      ) : (
        <div className="hero-grid">
          {list.map((h) => (
            <button key={h.id} type="button" className="hero-cell" aria-pressed={h.id === selectedId} onClick={() => onSelect(h.id)} data-testid={`hero-option-${h.id}`} data-hero-name={h.name}>
              <Img className="portrait" src={heroPortrait(app.manifest, h)} alt="" size={48} fallback={h.name} />
              <span>{h.name}</span>
            </button>
          ))}
        </div>
      )}
    </Sheet>
  );
}
