import type { TemplarTemplate } from '../types';
import { clone } from '../utils/value';
import { ensureReadableTemplate } from './accessibility';
import { DEFAULT_TEMPLATE } from './defaults';
import { PACKED_BUILT_IN_TEMPLATES } from './packs/catalog';

function builtIn(
  id: string,
  name: string,
  description: string,
  configure: (template: TemplarTemplate) => void,
): TemplarTemplate {
  const template = clone(DEFAULT_TEMPLATE);
  template.id = id;
  template.name = name;
  template.builtIn = true;
  template.metadata = {
    author: 'Templar',
    description,
    folder: 'Essentials',
    tags: [],
  };
  configure(template);
  if (template.headings.h4.font === DEFAULT_TEMPLATE.headings.h4.font) {
    template.headings.h4.font = template.headings.h3.font;
  }
  if (template.headings.h4.color === DEFAULT_TEMPLATE.headings.h4.color) {
    template.headings.h4.color = template.headings.h3.color;
  }
  if (template.headings.h5.font === DEFAULT_TEMPLATE.headings.h5.font) {
    template.headings.h5.font = template.headings.h4.font;
  }
  if (template.headings.h5.color === DEFAULT_TEMPLATE.headings.h5.color) {
    template.headings.h5.color = template.headings.h4.color;
  }
  if (template.headings.h6.font === DEFAULT_TEMPLATE.headings.h6.font) {
    template.headings.h6.font = template.headings.h4.font;
  }
  if (template.headings.h6.color === DEFAULT_TEMPLATE.headings.h6.color) {
    template.headings.h6.color = template.headings.h4.color;
  }
  if (template.blocks.quoteTextColor === DEFAULT_TEMPLATE.blocks.quoteTextColor) {
    template.blocks.quoteTextColor = template.typography.textColor;
  }
  if (template.blocks.codeTextColor === DEFAULT_TEMPLATE.blocks.codeTextColor) {
    template.blocks.codeTextColor = template.typography.textColor;
  }
  return template;
}

const CORE_BUILT_IN_TEMPLATES: readonly TemplarTemplate[] = [
  builtIn(
    'classic-ruled',
    'Classic Ruled',
    'Warm ruled paper with a measured baseline, red margin, and Polaroid photographs.',
    (template) => {
      template.metadata.tags = ['journal', 'ruled', 'warm'];
      template.paper.pattern = 'ruled';
      template.paper.marginLine = true;
      template.paper.color = '#fffdf4';
      template.paper.patternColor = 'rgba(107, 155, 190, 0.43)';
      template.paper.marginColor = 'rgba(210, 92, 92, 0.62)';
      template.baseline.mode = 'strict';
      template.typography.bodyFont = 'Georgia, "Times New Roman", serif';
      template.typography.bodySize = 18;
      template.blocks.highlightBackground = 'rgba(244, 210, 83, 0.48)';
      template.blocks.highlightTextColor = '#302e2b';
      template.images.frame = 'polaroid';
      template.images.borderWidth = 10;
      template.images.bottomBorderWidth = 34;
      template.images.rotation = -1.2;
      template.images.shadow = '0 8px 20px rgba(69, 58, 42, 0.18)';
      template.css = `.page h1 {
  letter-spacing: -0.025em;
}

.page blockquote {
  font-style: italic;
}`;
    },
  ),
  builtIn(
    'vintage-journal',
    'Vintage Journal',
    'Aged cream stock, bookish type, and softly weathered scrapbook imagery.',
    (template) => {
      template.metadata.tags = ['journal', 'vintage', 'scrapbook'];
      template.paper.color = '#eee0bf';
      template.paper.pattern = 'ruled';
      template.paper.patternColor = 'rgba(108, 83, 53, 0.16)';
      template.baseline.mode = 'balanced';
      template.typography.bodyFont = '"Iowan Old Style", Baskerville, Georgia, serif';
      template.typography.textColor = '#4b3928';
      template.typography.mutedColor = '#7a654e';
      template.headings.h1.color = '#6f382c';
      template.headings.h2.color = '#744c31';
      template.images.frame = 'vintage';
      template.images.borderWidth = 8;
      template.images.borderColor = '#f5ead1';
      template.images.rotation = 0.7;
      template.images.shadow = '0 7px 18px rgba(68, 43, 23, 0.25)';
      template.images.sepia = 0.18;
      template.blocks.linkColor = '#84512f';
      template.blocks.highlightBackground = 'rgba(190, 137, 57, 0.32)';
      template.blocks.highlightTextColor = '#4b3928';
      template.blocks.dividerStyle = 'fade';
      template.blocks.dividerColor = 'rgba(111, 56, 44, 0.65)';
      template.blocks.dividerWidth = 1;
      template.css = `.page-content {
  background-image: radial-gradient(circle at 12% 4%, rgba(111, 70, 31, 0.06), transparent 24%);
}`;
    },
  ),
  builtIn(
    'minimal-journal',
    'Minimal Journal',
    'Generous margins and clean editorial typography on a quiet white page.',
    (template) => {
      template.metadata.tags = ['minimal', 'editorial', 'clean'];
      template.paper.color = '#fcfcfb';
      template.paper.pattern = 'blank';
      template.baseline.enabled = false;
      template.baseline.mode = 'free';
      template.typography.bodyFont = 'Inter, system-ui, -apple-system, sans-serif';
      template.typography.bodySize = 17;
      template.typography.textColor = '#222426';
      template.headings.h1.font = 'Inter, system-ui, -apple-system, sans-serif';
      template.headings.h2.font = template.headings.h1.font;
      template.headings.h3.font = template.headings.h1.font;
      template.headings.h1.weight = 620;
      template.blocks.highlightBackground = 'rgba(255, 224, 92, 0.42)';
      template.blocks.highlightTextColor = '#222426';
      template.layout.maxWidth = 720;
      template.layout.paddingLeft = 84;
      template.layout.paddingRight = 84;
      template.images.frame = 'rounded';
      template.images.cornerRadius = 12;
      template.images.shadow = '0 12px 36px rgba(28, 30, 32, 0.12)';
      template.css = `.page h1 {
  letter-spacing: -0.04em;
}

.page p {
  letter-spacing: 0.005em;
}`;
    },
  ),
  builtIn(
    'dot-grid',
    'Dot Grid',
    'A bullet-journal surface with crisp dots, structured headings, and clear checkboxes.',
    (template) => {
      template.metadata.tags = ['bullet-journal', 'dots', 'planning'];
      template.paper.color = '#fbfaf5';
      template.paper.pattern = 'dot-grid';
      template.paper.patternColor = 'rgba(78, 91, 99, 0.25)';
      template.baseline.mode = 'balanced';
      template.baseline.unit = 28;
      template.typography.bodyFont = 'Inter, system-ui, -apple-system, sans-serif';
      template.typography.bodySize = 16;
      template.headings.h1.font = template.typography.bodyFont;
      template.headings.h2.font = template.typography.bodyFont;
      template.headings.h3.font = template.typography.bodyFont;
      template.headings.h1.decoration = 'highlight';
      template.blocks.highlightBackground = 'rgba(151, 191, 157, 0.42)';
      template.blocks.highlightTextColor = '#26352b';
      template.blocks.checkboxAccent = '#4f785f';
      template.images.frame = 'thin';
      template.images.borderWidth = 1;
      template.images.borderColor = '#9da8a1';
      template.css = `.page input[type="checkbox"] {
  border-radius: 2px;
}

.page h2 {
  text-transform: uppercase;
  letter-spacing: 0.08em;
}`;
    },
  ),
  builtIn(
    'graph-paper',
    'Graph Paper',
    'Minor and major graph lines with technical typography for diagrams and engineering notes.',
    (template) => {
      template.metadata.tags = ['technical', 'graph', 'engineering'];
      template.paper.color = '#f8fbf8';
      template.paper.pattern = 'graph';
      template.paper.patternColor = 'rgba(71, 138, 121, 0.18)';
      template.paper.majorPatternColor = 'rgba(53, 114, 103, 0.30)';
      template.baseline.mode = 'balanced';
      template.baseline.unit = 24;
      template.typography.bodyFont = '"IBM Plex Mono", "Courier New", monospace';
      template.typography.bodySize = 15;
      template.typography.textColor = '#1f3935';
      template.headings.h1.font = template.typography.bodyFont;
      template.headings.h2.font = template.typography.bodyFont;
      template.headings.h3.font = template.typography.bodyFont;
      template.headings.h1.color = '#155c52';
      template.images.frame = 'technical';
      template.images.borderWidth = 2;
      template.images.borderColor = '#4d7771';
      template.images.cornerRadius = 2;
      template.blocks.linkColor = '#126d75';
      template.blocks.highlightBackground = 'rgba(118, 196, 177, 0.34)';
      template.blocks.highlightTextColor = '#16342f';
      template.css = `.page h1,
.page h2,
.page h3 {
  text-transform: uppercase;
  letter-spacing: 0.045em;
}

.page table {
  background: rgba(248, 251, 248, 0.86);
}`;
    },
  ),
  builtIn(
    'sketchbook',
    'Sketchbook',
    'Warm blank stock, an open composition, and gently rotated creative work.',
    (template) => {
      template.metadata.tags = ['sketchbook', 'creative', 'blank'];
      template.paper.color = '#f5f0df';
      template.paper.pattern = 'blank';
      template.baseline.enabled = false;
      template.baseline.mode = 'free';
      template.typography.bodyFont = '"Avenir Next", Avenir, system-ui, sans-serif';
      template.typography.textColor = '#37342f';
      template.blocks.highlightBackground = 'rgba(230, 190, 92, 0.40)';
      template.blocks.highlightTextColor = '#37342f';
      template.layout.maxWidth = 980;
      template.layout.paddingLeft = 72;
      template.layout.paddingRight = 72;
      template.images.frame = 'scrapbook';
      template.images.borderWidth = 8;
      template.images.borderColor = '#fffdf6';
      template.images.rotation = -1.8;
      template.images.shadow = '3px 7px 18px rgba(55, 48, 37, 0.18)';
      template.css = `.page blockquote {
  border: 0;
  padding-left: 0;
  font-size: 1.15em;
}

.page hr {
  width: 28%;
  margin-inline: 0;
}`;
    },
  ),
  builtIn(
    'legal-pad',
    'Legal Pad',
    'Yellow ruled paper with a strong red margin and strict writing rhythm.',
    (template) => {
      template.metadata.tags = ['legal-pad', 'ruled', 'writing'];
      template.paper.color = '#fff4a8';
      template.paper.pattern = 'ruled';
      template.paper.patternColor = 'rgba(75, 128, 177, 0.43)';
      template.paper.marginLine = true;
      template.paper.marginColor = 'rgba(211, 74, 69, 0.72)';
      template.baseline.mode = 'strict';
      template.baseline.unit = 30;
      template.typography.bodyFont = '"Avenir Next", Avenir, system-ui, sans-serif';
      template.typography.bodySize = 17;
      template.typography.textColor = '#292b2a';
      template.blocks.highlightBackground = 'rgba(244, 175, 66, 0.42)';
      template.blocks.highlightTextColor = '#292b2a';
      template.layout.paddingLeft = 104;
      template.images.frame = 'photo';
      template.images.borderWidth = 6;
      template.images.borderColor = '#fffbe1';
      template.css = `.page h1 {
  text-transform: uppercase;
  letter-spacing: 0.035em;
}`;
    },
  ),
  builtIn(
    'dark-academia',
    'Dark Academia',
    'Ink-dark paper, cream text, muted gold details, and vintage photographic treatment.',
    (template) => {
      template.metadata.tags = ['dark', 'academic', 'vintage'];
      template.paper.color = '#201d1b';
      template.paper.pattern = 'ruled';
      template.paper.patternColor = 'rgba(214, 191, 143, 0.12)';
      template.baseline.mode = 'balanced';
      template.typography.bodyFont = 'Baskerville, Georgia, serif';
      template.typography.textColor = '#e9dfc9';
      template.typography.mutedColor = '#b4a78e';
      template.headings.h1.color = '#d7bd79';
      template.headings.h2.color = '#cdb77f';
      template.headings.h3.color = '#c3b390';
      template.images.frame = 'dark';
      template.images.borderWidth = 8;
      template.images.borderColor = '#332d28';
      template.images.sepia = 0.22;
      template.images.contrast = 1.08;
      template.images.shadow = '0 10px 26px rgba(0, 0, 0, 0.45)';
      template.blocks.linkColor = '#d0b76f';
      template.blocks.highlightBackground = 'rgba(184, 143, 64, 0.58)';
      template.blocks.highlightTextColor = '#201d1b';
      template.blocks.quoteAccent = '#8c7646';
      template.blocks.quoteBackground = 'rgba(215, 189, 121, 0.07)';
      template.blocks.codeBackground = 'rgba(0, 0, 0, 0.28)';
      template.blocks.tableBorder = 'rgba(215, 189, 121, 0.25)';
      template.blocks.checkboxAccent = '#b89952';
      template.css = `.page h1 {
  letter-spacing: 0.02em;
}

.page hr {
  border-color: rgba(215, 189, 121, 0.4);
}`;
    },
  ),
] as const;

interface AestheticPreset {
  tags: string[];
  pattern: TemplarTemplate['paper']['pattern'];
  paper: string;
  line: string;
  major?: string;
  text: string;
  muted: string;
  accent: string;
  highlight: string;
  highlightText: string;
  font: string;
  headingFont?: string;
  unit?: number;
  mode?: TemplarTemplate['baseline']['mode'];
  margin?: string;
  frame?: TemplarTemplate['images']['frame'];
  code?: string;
  quote?: string;
  radius?: number;
  css?: string;
}

function aesthetic(
  id: string,
  name: string,
  description: string,
  preset: AestheticPreset,
): TemplarTemplate {
  return builtIn(id, name, description, (template) => {
    template.metadata.tags = preset.tags;
    template.paper.pattern = preset.pattern;
    template.paper.color = preset.paper;
    template.paper.patternColor = preset.line;
    template.paper.majorPatternColor = preset.major ?? preset.line;
    template.paper.marginLine = preset.margin !== undefined;
    template.paper.marginColor = preset.margin ?? preset.accent;
    template.baseline.enabled = preset.mode !== 'free';
    template.baseline.mode = preset.mode ?? 'balanced';
    template.baseline.unit = preset.unit ?? 28;
    template.typography.bodyFont = preset.font;
    template.typography.textColor = preset.text;
    template.typography.mutedColor = preset.muted;
    for (const level of ['h1', 'h2', 'h3', 'h4'] as const) {
      const heading = template.headings[level];
      heading.font = preset.headingFont ?? preset.font;
      heading.color = preset.accent;
    }
    template.blocks.linkColor = preset.accent;
    template.blocks.highlightBackground = preset.highlight;
    template.blocks.highlightTextColor = preset.highlightText;
    template.blocks.quoteAccent = preset.accent;
    template.blocks.quoteBackground = preset.quote ?? 'transparent';
    template.blocks.quoteTextColor = preset.text;
    template.blocks.codeBackground = preset.code ?? 'rgba(0, 0, 0, 0.08)';
    template.blocks.codeTextColor = preset.text;
    template.blocks.tableBorder = preset.line;
    template.blocks.tableHeaderBackground = preset.quote ?? preset.highlight;
    template.blocks.checkboxAccent = preset.accent;
    template.images.frame = preset.frame ?? 'thin';
    template.images.borderColor = preset.accent;
    template.images.borderWidth = template.images.frame === 'none' ? 0 : 2;
    template.layout.pageRadius = preset.radius ?? 0;
    template.css = preset.css ?? '';
  });
}

const EXPANDED_BUILT_IN_TEMPLATES: readonly TemplarTemplate[] = [
  aesthetic('botanical-field-notes', 'Botanical Field Notes', 'Pressed-leaf greens and warm field-journal ruling.', {
    tags: ['botanical', 'field-notes', 'green'], pattern: 'ruled', paper: '#f3f0d8', line: 'rgba(72, 116, 76, 0.24)', text: '#334336', muted: '#6d7868', accent: '#3f704d', highlight: 'rgba(142, 181, 117, 0.38)', highlightText: '#26372b', font: 'Georgia, "Times New Roman", serif', unit: 30, margin: 'rgba(155, 92, 65, 0.42)', frame: 'vintage', quote: 'rgba(74, 112, 73, 0.09)', css: '.page h1 { letter-spacing: 0.01em; }',
  }),
  aesthetic('midnight-blueprint', 'Midnight Blueprint', 'Deep navy drafting paper with cyan engineering lines.', {
    tags: ['blueprint', 'dark', 'technical'], pattern: 'graph', paper: '#10283a', line: 'rgba(94, 194, 215, 0.22)', major: 'rgba(108, 215, 232, 0.42)', text: '#d9eef1', muted: '#8fb1b9', accent: '#72d5e4', highlight: 'rgba(77, 199, 218, 0.34)', highlightText: '#071c29', font: '"IBM Plex Mono", "Courier New", monospace', unit: 24, frame: 'technical', code: 'rgba(0, 0, 0, 0.28)', quote: 'rgba(85, 201, 220, 0.08)', css: '.page h1, .page h2 { text-transform: uppercase; letter-spacing: 0.08em; }',
  }),
  aesthetic('sakura-study', 'Sakura Study', 'Soft blush dot paper with ink and cherry-blossom accents.', {
    tags: ['sakura', 'pastel', 'study'], pattern: 'dot-grid', paper: '#fff7f7', line: 'rgba(190, 109, 130, 0.24)', text: '#4c343b', muted: '#8b6872', accent: '#b85f7a', highlight: 'rgba(244, 172, 191, 0.42)', highlightText: '#4c2834', font: '"Avenir Next", Avenir, system-ui, sans-serif', unit: 28, frame: 'rounded', quote: 'rgba(226, 123, 153, 0.08)', radius: 12,
  }),
  aesthetic('solarized-lab', 'Solarized Lab', 'Scientific graph paper inspired by the Solarized palette.', {
    tags: ['solarized', 'lab', 'graph'], pattern: 'graph', paper: '#fdf6e3', line: 'rgba(38, 139, 210, 0.18)', major: 'rgba(38, 139, 210, 0.34)', text: '#586e75', muted: '#839496', accent: '#268bd2', highlight: 'rgba(181, 137, 0, 0.28)', highlightText: '#3d453f', font: '"IBM Plex Sans", system-ui, sans-serif', headingFont: '"IBM Plex Mono", monospace', unit: 26, frame: 'technical', quote: 'rgba(42, 161, 152, 0.08)',
  }),
  aesthetic('nordic-snow', 'Nordic Snow', 'Airy Scandinavian minimalism with cool gray-blue accents.', {
    tags: ['nordic', 'minimal', 'clean'], pattern: 'blank', paper: '#f7f9fa', line: '#d8e0e5', text: '#263238', muted: '#718087', accent: '#527a8a', highlight: 'rgba(156, 197, 214, 0.36)', highlightText: '#20343c', font: 'Inter, system-ui, sans-serif', mode: 'free', frame: 'rounded', quote: 'rgba(82, 122, 138, 0.07)', radius: 16, css: '.page h1 { letter-spacing: -0.04em; }',
  }),
  aesthetic('cyber-neon', 'Cyber Neon', 'Black graph stock with electric magenta and cyan signals.', {
    tags: ['cyberpunk', 'neon', 'dark'], pattern: 'graph', paper: '#101014', line: 'rgba(0, 229, 255, 0.14)', major: 'rgba(255, 45, 170, 0.26)', text: '#e9f7f8', muted: '#889ca2', accent: '#00e5ff', highlight: 'rgba(255, 45, 170, 0.55)', highlightText: '#fff7fc', font: '"SFMono-Regular", Consolas, monospace', unit: 24, frame: 'dark', code: 'rgba(0, 229, 255, 0.08)', quote: 'rgba(255, 45, 170, 0.08)', css: '.page h1 { color: #ff2daa; text-shadow: 0 0 8px rgba(255, 45, 170, 0.35); }',
  }),
  aesthetic('lavender-letters', 'Lavender Letters', 'Gentle lavender ruling and literary serif typography.', {
    tags: ['lavender', 'letters', 'soft'], pattern: 'ruled', paper: '#fbf8ff', line: 'rgba(129, 103, 174, 0.22)', text: '#433a50', muted: '#7c7088', accent: '#7358a4', highlight: 'rgba(195, 172, 232, 0.44)', highlightText: '#382d48', font: 'Baskerville, Georgia, serif', unit: 30, margin: 'rgba(190, 111, 148, 0.38)', frame: 'photo', quote: 'rgba(115, 88, 164, 0.07)',
  }),
  aesthetic('ocean-log', 'Ocean Log', 'Sea-glass ruled paper for travel logs and reflective writing.', {
    tags: ['ocean', 'travel', 'ruled'], pattern: 'ruled', paper: '#eef9f7', line: 'rgba(49, 133, 145, 0.25)', text: '#24454a', muted: '#648086', accent: '#237f91', highlight: 'rgba(95, 192, 185, 0.38)', highlightText: '#18383c', font: '"Avenir Next", Avenir, sans-serif', unit: 29, margin: 'rgba(225, 119, 91, 0.42)', frame: 'rounded', quote: 'rgba(35, 127, 145, 0.08)',
  }),
  aesthetic('desert-explorer', 'Desert Explorer', 'Sand-toned dot grid with canyon and turquoise accents.', {
    tags: ['desert', 'travel', 'dots'], pattern: 'dot-grid', paper: '#f6ecd5', line: 'rgba(139, 92, 50, 0.25)', text: '#4d3929', muted: '#806b56', accent: '#2f7f78', highlight: 'rgba(222, 155, 82, 0.42)', highlightText: '#49301f', font: 'Georgia, serif', unit: 28, frame: 'scrapbook', quote: 'rgba(47, 127, 120, 0.08)',
  }),
  aesthetic('cafe-manuscript', 'Café Manuscript', 'Coffee-stained manuscript paper with warm espresso ink.', {
    tags: ['cafe', 'manuscript', 'warm'], pattern: 'ruled', paper: '#efe1c8', line: 'rgba(106, 70, 45, 0.18)', text: '#4c3325', muted: '#7e6452', accent: '#8b4d35', highlight: 'rgba(196, 139, 73, 0.36)', highlightText: '#402a20', font: '"Iowan Old Style", Georgia, serif', unit: 30, frame: 'vintage', quote: 'rgba(105, 63, 40, 0.08)', css: '.page blockquote { font-style: italic; }',
  }),
  aesthetic('art-deco-ledger', 'Art Deco Ledger', 'Ivory graph stock with geometric black and gold detailing.', {
    tags: ['art-deco', 'ledger', 'gold'], pattern: 'graph', paper: '#fbf6e8', line: 'rgba(32, 31, 29, 0.13)', major: 'rgba(171, 129, 43, 0.36)', text: '#272521', muted: '#746c5c', accent: '#9c7223', highlight: 'rgba(213, 177, 91, 0.42)', highlightText: '#292216', font: 'Futura, "Avenir Next", sans-serif', unit: 26, frame: 'thin', quote: 'rgba(156, 114, 35, 0.08)', css: '.page h1 { text-transform: uppercase; letter-spacing: 0.12em; }',
  }),
  aesthetic('cottage-recipe', 'Cottage Recipe', 'Cream kitchen notebook paper with berry-red details.', {
    tags: ['cottage', 'recipe', 'cozy'], pattern: 'ruled', paper: '#fff9e9', line: 'rgba(126, 151, 111, 0.22)', text: '#443c31', muted: '#7b7162', accent: '#a64f4b', highlight: 'rgba(237, 196, 108, 0.42)', highlightText: '#3d3429', font: 'Georgia, serif', unit: 30, margin: 'rgba(166, 79, 75, 0.55)', frame: 'photo', quote: 'rgba(126, 151, 111, 0.10)',
  }),
  aesthetic('monochrome-zine', 'Monochrome Zine', 'High-contrast editorial black and white for bold notes.', {
    tags: ['zine', 'monochrome', 'editorial'], pattern: 'blank', paper: '#fafafa', line: '#c8c8c8', text: '#111111', muted: '#666666', accent: '#111111', highlight: '#d8d8d8', highlightText: '#000000', font: 'Helvetica, Arial, sans-serif', headingFont: 'Impact, "Arial Black", sans-serif', mode: 'free', frame: 'thin', quote: '#eeeeee', css: '.page h1 { text-transform: uppercase; letter-spacing: -0.02em; }',
  }),
  aesthetic('forest-ranger', 'Forest Ranger', 'Dark evergreen field ruling with trail-map orange accents.', {
    tags: ['forest', 'outdoors', 'field'], pattern: 'ruled', paper: '#e9efe2', line: 'rgba(53, 91, 60, 0.24)', text: '#2e4031', muted: '#637166', accent: '#b35f32', highlight: 'rgba(146, 177, 100, 0.42)', highlightText: '#273529', font: '"Avenir Next", sans-serif', headingFont: 'Rockwell, Georgia, serif', unit: 29, margin: 'rgba(179, 95, 50, 0.5)', frame: 'technical', quote: 'rgba(53, 91, 60, 0.08)',
  }),
  aesthetic('candy-pop', 'Candy Pop', 'Playful pastel dot paper with bright candy-color accents.', {
    tags: ['candy', 'playful', 'pastel'], pattern: 'dot-grid', paper: '#fff8fb', line: 'rgba(79, 177, 202, 0.24)', text: '#3f3541', muted: '#7d7080', accent: '#ed4f9a', highlight: 'rgba(255, 210, 73, 0.55)', highlightText: '#40331a', font: 'Nunito, "Avenir Next", sans-serif', unit: 28, frame: 'rounded', quote: 'rgba(237, 79, 154, 0.08)', radius: 18, css: '.page h1 { letter-spacing: -0.035em; }',
  }),
  aesthetic('museum-catalog', 'Museum Catalog', 'Restrained gallery typography and warm archival white.', {
    tags: ['museum', 'catalog', 'editorial'], pattern: 'blank', paper: '#f7f4ed', line: '#d1cbc0', text: '#25231f', muted: '#777168', accent: '#6d4935', highlight: 'rgba(190, 166, 118, 0.32)', highlightText: '#30291f', font: '"Helvetica Neue", Arial, sans-serif', headingFont: 'Baskerville, Georgia, serif', mode: 'free', frame: 'thin', quote: 'rgba(109, 73, 53, 0.06)', css: '.page h1 { font-weight: 500; letter-spacing: 0.015em; }',
  }),
  aesthetic('lunar-research', 'Lunar Research', 'Moonlit graph paper for observations and technical logs.', {
    tags: ['lunar', 'science', 'dark'], pattern: 'graph', paper: '#181b25', line: 'rgba(153, 171, 205, 0.14)', major: 'rgba(192, 205, 231, 0.26)', text: '#e0e5ef', muted: '#929bae', accent: '#b9c8ee', highlight: 'rgba(112, 130, 182, 0.48)', highlightText: '#f3f6ff', font: '"IBM Plex Mono", monospace', unit: 24, frame: 'dark', code: 'rgba(0, 0, 0, 0.28)', quote: 'rgba(185, 200, 238, 0.07)',
  }),
  aesthetic('coral-classroom', 'Coral Classroom', 'Friendly ruled study paper with coral and blue accents.', {
    tags: ['classroom', 'study', 'coral'], pattern: 'ruled', paper: '#fffaf4', line: 'rgba(91, 148, 184, 0.26)', text: '#35424a', muted: '#738087', accent: '#df6b62', highlight: 'rgba(255, 201, 93, 0.46)', highlightText: '#3e3523', font: '"Avenir Next", system-ui, sans-serif', unit: 30, margin: 'rgba(223, 107, 98, 0.56)', frame: 'rounded', quote: 'rgba(91, 148, 184, 0.08)',
  }),
  aesthetic('zen-ink', 'Zen Ink', 'Quiet rice-paper minimalism with charcoal brush accents.', {
    tags: ['zen', 'ink', 'minimal'], pattern: 'blank', paper: '#f4f1e8', line: '#c9c3b5', text: '#292824', muted: '#77736a', accent: '#3e3d38', highlight: 'rgba(169, 157, 126, 0.34)', highlightText: '#26251f', font: '"Hiragino Mincho ProN", "Yu Mincho", Georgia, serif', mode: 'free', frame: 'none', quote: 'rgba(62, 61, 56, 0.06)', css: '.page blockquote { border-inline-start-width: 1px; }',
  }),
  aesthetic('retro-terminal', 'Retro Terminal', 'Phosphor-green terminal grid on near-black glass.', {
    tags: ['terminal', 'retro', 'dark'], pattern: 'dot-grid', paper: '#101510', line: 'rgba(87, 255, 116, 0.20)', text: '#9ff5a7', muted: '#5e9b68', accent: '#63ff7b', highlight: 'rgba(99, 255, 123, 0.36)', highlightText: '#071108', font: '"SFMono-Regular", Consolas, monospace', unit: 24, frame: 'dark', code: 'rgba(99, 255, 123, 0.07)', quote: 'rgba(99, 255, 123, 0.06)', css: '.page h1, .page h2 { text-transform: uppercase; text-shadow: 0 0 6px rgba(99, 255, 123, 0.3); }',
  }),
] as const;

const EXISTING_TEMPLATE_FOLDERS: Readonly<Record<string, string>> = {
  'classic-ruled': 'Essentials',
  'vintage-journal': 'Vintage & Editorial',
  'minimal-journal': 'Essentials',
  'dot-grid': 'Essentials',
  'graph-paper': 'Academia',
  sketchbook: 'Journaling & Wellness',
  'legal-pad': 'Professional',
  'dark-academia': 'Academia',
  'botanical-field-notes': 'Nature',
  'midnight-blueprint': 'Professional',
  'sakura-study': 'Pastels',
  'solarized-lab': 'Academia',
  'nordic-snow': 'Color Stories',
  'cyber-neon': 'Dark & Neon',
  'lavender-letters': 'Pastels',
  'ocean-log': 'Travel',
  'desert-explorer': 'Travel',
  'cafe-manuscript': 'Vintage & Editorial',
  'art-deco-ledger': 'Vintage & Editorial',
  'cottage-recipe': 'Celebrations & Occasions',
  'monochrome-zine': 'Vintage & Editorial',
  'forest-ranger': 'Nature',
  'candy-pop': 'Pastels',
  'museum-catalog': 'Vintage & Editorial',
  'lunar-research': 'Dark & Neon',
  'coral-classroom': 'Academia',
  'zen-ink': 'Journaling & Wellness',
  'retro-terminal': 'Dark & Neon',
};

for (const template of [...CORE_BUILT_IN_TEMPLATES, ...EXPANDED_BUILT_IN_TEMPLATES]) {
  Object.assign(template.metadata, {
    folder: EXISTING_TEMPLATE_FOLDERS[template.id] ?? 'Essentials',
  });
  ensureReadableTemplate(template);
}

export const BUILT_IN_TEMPLATES: readonly TemplarTemplate[] = [
  ...CORE_BUILT_IN_TEMPLATES,
  ...EXPANDED_BUILT_IN_TEMPLATES,
  ...PACKED_BUILT_IN_TEMPLATES,
] as const;
