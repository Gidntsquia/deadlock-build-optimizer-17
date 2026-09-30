/**
 * Helpers for rendering assets data: local image lookup, HTML cleanup for item and ability text,
 * and stat-line formatting. Everything works from the snapshot; nothing is requested from the network.
 */
import type { CatalogItem, PropertyInfo, SlotType, TooltipSection } from '../types';

export type ImageManifest = Record<string, string>;

/** Path of the local copy of a remote image, or undefined when the snapshot has no copy. */
export function localImage(manifest: ImageManifest, remote: string | undefined | null, base: string = import.meta.env?.BASE_URL ?? '/'): string | undefined {
  if (!remote) return undefined;
  const local = manifest[remote];
  return local ? `${base}data/${local}` : undefined;
}

export function itemImage(manifest: ImageManifest, item: CatalogItem | undefined): string | undefined {
  if (!item) return undefined;
  return localImage(manifest, item.shop_image_webp) ?? localImage(manifest, item.shop_image) ?? localImage(manifest, item.image_webp) ?? localImage(manifest, item.image);
}

export const SLOT_LABEL: Record<SlotType, string> = { weapon: 'Weapon', vitality: 'Vitality', spirit: 'Spirit' };

export function fmtSouls(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

export function fmtMinutes(min: number): string {
  if (!Number.isFinite(min)) return '–';
  const m = Math.max(0, Math.round(min));
  return `${m} min`;
}

// ------------------------------------------------------------------ html cleanup

const ALLOWED_TAGS = new Set(['SPAN', 'BR', 'B', 'I', 'EM', 'STRONG', 'IMG']);
const CLASS_TOKEN = /^[A-Za-z][\w-]*$/;

/**
 * Item and ability texts come from the assets API as small HTML fragments (spans with classes, line breaks,
 * inline property icons). This keeps only those, drops styles and scripts, and swaps inline icons for the local
 * copies. Icons that have no local copy are removed so the page never asks the network for them.
 */
export function cleanHtml(html: string | undefined, manifest: ImageManifest): string {
  if (!html) return '';
  if (typeof DOMParser === 'undefined') return html.replace(/<[^>]*>/g, '');
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const out = document.createElement('div');

  const walk = (src: Node, dst: Node): void => {
    src.childNodes.forEach((n) => {
      if (n.nodeType === Node.TEXT_NODE) {
        dst.appendChild(document.createTextNode(n.textContent ?? ''));
        return;
      }
      if (n.nodeType !== Node.ELEMENT_NODE) return;
      const el = n as Element;
      if (!ALLOWED_TAGS.has(el.tagName)) {
        // unknown wrapper: keep its text, drop the element itself
        if (!/^(SCRIPT|STYLE|IFRAME|OBJECT|EMBED|SVG)$/i.test(el.tagName)) walk(el, dst);
        return;
      }
      if (el.tagName === 'IMG') {
        const local = localImage(manifest, el.getAttribute('src'));
        if (!local) return;
        const img = document.createElement('img');
        img.setAttribute('src', local);
        img.setAttribute('alt', el.getAttribute('alt') ?? '');
        img.setAttribute('class', 'inline-icon');
        img.setAttribute('loading', 'lazy');
        dst.appendChild(img);
        return;
      }
      const copy = document.createElement(el.tagName.toLowerCase());
      const cls = (el.getAttribute('class') ?? '').split(/\s+/).filter((t) => CLASS_TOKEN.test(t));
      if (cls.length) copy.setAttribute('class', cls.join(' '));
      walk(el, copy);
      dst.appendChild(copy);
    });
  };
  walk(doc.body, out);
  return out.innerHTML;
}

/** Text content of an HTML fragment, for comparisons and accessible labels. */
export function htmlToText(html: string | undefined): string {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

// ------------------------------------------------------------------ stat lines

export interface StatLine {
  key: string;
  label: string;
  value: string;
  cssClass: string;
}

function numeric(v: string | number | undefined): number | null {
  if (v === undefined || v === null) return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^\d.+-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * Text of one property as the game shows it. "{s:sign}" asks for an explicit plus sign on positive numbers.
 * Some values already carry their unit ("8m" with postfix "m"), so the postfix is only added to a bare number.
 */
export function formatProperty(p: PropertyInfo, forceSign: boolean): string {
  const raw = p.value === undefined || p.value === null ? '' : String(p.value).trim();
  const n = numeric(p.value);
  let prefix = (p.prefix ?? '').replace(/\{s:sign\}/g, n !== null && n > 0 ? '+' : '').replace(/\{[^}]*\}/g, '');
  if (!prefix && forceSign && n !== null && n > 0 && !raw.startsWith('+')) prefix = '+';
  const post = p.postfix ?? '';
  const m = /^([+-]?\d*\.?\d+)\s*([^\d\s].*)?$/.exec(raw);
  let body: string;
  if (m && m[2]) body = post.trim().startsWith(m[2].trim()) ? `${m[1]}${post}` : raw;
  else body = `${raw}${post}`;
  // a value that already starts with its own sign needs no prefix
  if (/^[+-]/.test(body)) prefix = '';
  return `${prefix}${body}`.trim();
}

export function statLine(item: CatalogItem, key: string, forceSign: boolean): StatLine | null {
  const p = item.properties[key];
  if (!p || p.value === undefined || p.value === null || p.value === '') return null;
  return { key, label: p.label ?? key, value: formatProperty(p, forceSign), cssClass: p.css_class ?? '' };
}

export interface ItemSection {
  type: 'innate' | 'passive' | 'active';
  /** description html, one per attribute block */
  texts: string[];
  stats: StatLine[];
  /** stats the assets data marks as important or elevated */
  keyStats: StatLine[];
}

/** Sections of an item in display order: innate stats first, then passive and active effects. */
export function itemSections(item: CatalogItem): ItemSection[] {
  const rank = { innate: 0, passive: 1, active: 2 } as const;
  const sections: ItemSection[] = [];
  (item.tooltip_sections as TooltipSection[]).forEach((s) => {
    const type = s.section_type ?? 'passive';
    const seen = new Set<string>();
    const stats: StatLine[] = [];
    const keyStats: StatLine[] = [];
    const texts: string[] = [];
    for (const a of s.section_attributes) {
      if (a.loc_string) texts.push(a.loc_string);
      for (const k of a.properties ?? []) {
        if (seen.has(k)) continue;
        seen.add(k);
        const l = statLine(item, k, type === 'innate');
        if (l) stats.push(l);
      }
      for (const k of [...(a.important_properties ?? []), ...(a.elevated_properties ?? [])]) {
        if (seen.has(k)) continue;
        seen.add(k);
        const l = statLine(item, k, type === 'innate');
        if (l) keyStats.push(l);
      }
    }
    sections.push({ type, texts, stats, keyStats });
  });
  return sections.sort((a, b) => rank[a.type] - rank[b.type]);
}

/** Items that list `item` as a direct component, and the component items of `item`. */
export function componentsOf(item: CatalogItem, byClass: Map<string, CatalogItem>): CatalogItem[] {
  return item.component_items.map((c) => byClass.get(c)).filter((x): x is CatalogItem => !!x);
}

export function upgradesOf(item: CatalogItem, all: CatalogItem[]): CatalogItem[] {
  return all.filter((x) => x.shopable && !x.disabled && x.component_items.includes(item.class_name));
}
