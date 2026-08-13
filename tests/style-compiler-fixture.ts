import { BUILT_IN_TEMPLATES } from '../src/templates/builtins';
import { templateToNoteStyle } from '../src/templates/note-format';
import { createStyleCompilerContext } from '../src/services/style-compiler/context';
import type { StyleCompilerContext } from '../src/services/style-compiler/types';

export function fragmentContext(
  mutate: (style: ReturnType<typeof templateToNoteStyle>) => void = () => undefined,
): StyleCompilerContext {
  const style = templateToNoteStyle(BUILT_IN_TEMPLATES[0]!);
  mutate(style);
  const metric = { baseline: 21, ascent: 14, descent: 4, lineHeight: 30, measuredAt: 0 };
  return createStyleCompilerContext(style, '[data-templar-scope="fragment"]', 'fragment', {
    body: metric,
    h1: { ...metric, baseline: 48, ascent: 38, lineHeight: 60 },
    h2: { ...metric, baseline: 37, ascent: 29, lineHeight: 60 },
    h3: { ...metric, baseline: 24, ascent: 19 },
    h4: metric,
    h5: { ...metric, baseline: 18 },
    h6: { ...metric, baseline: 16 },
    code: { ...metric, baseline: 20 },
  });
}
