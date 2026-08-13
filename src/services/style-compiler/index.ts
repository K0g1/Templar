import { MAX_GENERATED_STYLE_BYTES } from '../../constants';
import { compileCustomCss } from '../css-compiler';
import { createStyleCompilerContext } from './context';
import { compileAttachments } from './attachments';
import { compileBlocks } from './blocks';
import { compileHeadings } from './headings';
import { compileImages } from './images';
import { compileLists } from './lists';
import { compilePageBase } from './page';
import { compilePagedGuards } from './paged-guards';
import { compileTypography } from './typography';
import { compileWatermark } from './watermark';
import type { PageMetricSet, StyleCompilation } from './types';

export type { PageMetricSet, StyleCompilation, StyleCompilerContext } from './types';

/** Public composition layer for the pure stylesheet fragments. */
export function compilePageStyle(
  style: Parameters<typeof createStyleCompilerContext>[0],
  scope: string,
  scopeId: string,
  metrics: PageMetricSet,
): StyleCompilation {
  const context = createStyleCompilerContext(style, scope, scopeId, metrics);
  const custom = compileCustomCss(style.css, scope, scopeId, context.gridded);
  const fragments = [
    compilePageBase(context),
    compileWatermark(context),
    compileTypography(context),
    compileHeadings(context),
    compileBlocks(context),
    compileLists(context),
    compileImages(context),
    compileAttachments(context),
    custom.css,
    compilePagedGuards(context),
  ].filter(Boolean);
  const css = fragments.join('\n\n');
  if (new TextEncoder().encode(css).length > MAX_GENERATED_STYLE_BYTES) {
    return {
      css: '',
      issues: [
        ...custom.issues,
        {
          severity: 'error',
          path: 'css.generated',
          message: 'The generated note stylesheet exceeds the 1 MiB safety limit.',
          fix: 'Reduce callout variants, attachment overrides, and repeated custom CSS.',
        },
      ],
    };
  }
  return { css, issues: custom.issues };
}
