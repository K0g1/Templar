import type { FontMetricRequest, FontMetrics, TemplarNoteStyle } from '../types';
import { fitToGrid } from '../utils/grid';
import { round } from '../utils/value';
import type { PageMetricSet } from './style-compiler';

/**
 * Returns the baseline coordinate inside the measured line box.
 *
 * The marker is a zero-height inline block with a one-pixel transparent top
 * border. Its bottom edge—not its top edge—is the CSS inline baseline. Keeping
 * this calculation pure makes the easy-to-miss one-pixel distinction testable.
 */
export function baselineOffsetFromMarker(
  rulerTop: number,
  markerBottom: number,
  lineHeight: number,
  fontSize: number,
): number {
  const measured = markerBottom - rulerTop;
  const fallback = lineHeight / 2 + fontSize * 0.36;
  return round(Number.isFinite(measured) && measured > 0 ? measured : fallback);
}

/**
 * The browser may expand a line box beyond the requested line-height when a
 * font's own ascent/descent cannot fit inside it. Rhythm padding must use the
 * box the browser actually laid out, otherwise that excess accumulates after
 * headings and code even though the declared line-height is grid-sized.
 */
export function renderedLineBoxHeight(
  requestedLineHeight: number,
  measuredHeight: number,
): number {
  return round(
    Number.isFinite(measuredHeight) && measuredHeight > 0
      ? Math.max(requestedLineHeight, measuredHeight)
      : requestedLineHeight,
  );
}

export class FontMetricsService {
  private readonly cache = new Map<string, FontMetrics>();
  private readonly documentIds = new WeakMap<Document, number>();
  private nextDocumentId = 1;

  public constructor(private readonly maxEntries: () => number) {}

  public async measurePage(style: TemplarNoteStyle, document: Document): Promise<PageMetricSet> {
    const gridded = style.baseline.enabled && style.baseline.mode !== 'free';
    const bodyLineHeight = gridded
      ? style.baseline.unit
      : style.typography.bodyLineHeight > 0
        ? style.typography.bodyLineHeight
        : Math.max(style.typography.bodySize * 1.55, 22);
    const headingLineHeight = (size: number): number =>
      gridded ? fitToGrid(size * 1.18, style.baseline.unit) : size * 1.2;

    const [body, h1, h2, h3, h4, h5, h6, code] = await Promise.all([
      this.measure(
        {
          family: style.typography.bodyFont,
          fontSize: style.typography.bodySize,
          fontWeight: style.typography.bodyWeight,
          lineHeight: bodyLineHeight,
        },
        document,
      ),
      this.measure(
        {
          family: style.headings.h1.font,
          fontSize: style.headings.h1.size,
          fontWeight: style.headings.h1.weight,
          lineHeight: headingLineHeight(style.headings.h1.size),
        },
        document,
      ),
      this.measure(
        {
          family: style.headings.h2.font,
          fontSize: style.headings.h2.size,
          fontWeight: style.headings.h2.weight,
          lineHeight: headingLineHeight(style.headings.h2.size),
        },
        document,
      ),
      this.measure(
        {
          family: style.headings.h3.font,
          fontSize: style.headings.h3.size,
          fontWeight: style.headings.h3.weight,
          lineHeight: headingLineHeight(style.headings.h3.size),
        },
        document,
      ),
      this.measure(
        {
          family: style.headings.h4.font,
          fontSize: style.headings.h4.size,
          fontWeight: style.headings.h4.weight,
          lineHeight: headingLineHeight(style.headings.h4.size),
        },
        document,
      ),
      this.measure(
        {
          family: style.headings.h5.font,
          fontSize: style.headings.h5.size,
          fontWeight: style.headings.h5.weight,
          lineHeight: headingLineHeight(style.headings.h5.size),
        },
        document,
      ),
      this.measure(
        {
          family: style.headings.h6.font,
          fontSize: style.headings.h6.size,
          fontWeight: style.headings.h6.weight,
          lineHeight: headingLineHeight(style.headings.h6.size),
        },
        document,
      ),
      this.measure(
        {
          family: style.blocks.codeFont,
          fontSize: style.blocks.codeSize,
          fontWeight: style.typography.bodyWeight,
          lineHeight: bodyLineHeight,
        },
        document,
      ),
    ]);
    return { body, h1, h2, h3, h4, h5, h6, code };
  }

  public async measure(request: FontMetricRequest, document: Document): Promise<FontMetrics> {
    const key = this.cacheKey(request, document);
    const cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached;
    }

    await this.loadFont(request, document);
    const metrics = this.measureWithDom(request, document);
    this.cache.set(key, metrics);
    this.trimCache();
    return metrics;
  }

  public clear(): void {
    this.cache.clear();
  }

  public get size(): number {
    return this.cache.size;
  }

  private async loadFont(request: FontMetricRequest, document: Document): Promise<void> {
    if (!document.fonts) {
      return;
    }
    try {
      await document.fonts.load(
        `${String(request.fontWeight)} ${String(request.fontSize)}px ${request.family}`,
        'Hgpx',
      );
    } catch {
      // A fallback family will still produce valid browser metrics.
    }
  }

  private measureWithDom(request: FontMetricRequest, document: Document): FontMetrics {
    const ruler = document.createElement('span');
    ruler.className = 'templar-font-ruler';
    ruler.style.fontFamily = request.family;
    ruler.style.fontSize = `${String(request.fontSize)}px`;
    ruler.style.fontWeight = String(request.fontWeight);
    ruler.style.lineHeight = `${String(request.lineHeight)}px`;

    const text = document.createElement('span');
    text.textContent = 'Hgpx';
    const marker = document.createElement('span');
    marker.className = 'templar-baseline-marker';
    ruler.append(text, marker);
    document.body.append(ruler);

    const rulerRect = ruler.getBoundingClientRect();
    const markerRect = marker.getBoundingClientRect();
    const baseline = baselineOffsetFromMarker(
      rulerRect.top,
      markerRect.bottom,
      request.lineHeight,
      request.fontSize,
    );

    let ascent = baseline;
    let descent = Math.max(0, request.lineHeight - baseline);
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (context) {
      context.font = `${String(request.fontWeight)} ${String(request.fontSize)}px ${request.family}`;
      const canvasMetrics = context.measureText('Hgpx');
      if (canvasMetrics.actualBoundingBoxAscent > 0) {
        ascent = canvasMetrics.actualBoundingBoxAscent;
        descent = canvasMetrics.actualBoundingBoxDescent;
      }
    }
    ruler.remove();

    return {
      baseline: round(baseline),
      ascent: round(ascent),
      descent: round(descent),
      lineHeight: renderedLineBoxHeight(request.lineHeight, rulerRect.height),
      measuredAt: Date.now(),
    };
  }

  private cacheKey(request: FontMetricRequest, document: Document): string {
    let documentId = this.documentIds.get(document);
    if (documentId === undefined) {
      documentId = this.nextDocumentId;
      this.nextDocumentId += 1;
      this.documentIds.set(document, documentId);
    }
    const scale = document.defaultView?.devicePixelRatio ?? 1;
    return [
      documentId,
      request.family,
      request.fontSize,
      request.fontWeight,
      request.lineHeight,
      scale,
    ].join('|');
  }

  private trimCache(): void {
    const maximum = Math.max(8, this.maxEntries());
    while (this.cache.size > maximum) {
      const oldest = this.cache.keys().next().value;
      if (!oldest) {
        break;
      }
      this.cache.delete(oldest);
    }
  }
}
