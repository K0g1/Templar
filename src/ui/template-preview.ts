import type { NotePageOptions, TemplarNoteStyle, TemplarTemplate } from '../types';
import { templateToNoteStyle } from '../templates/note-format';
import type { FontMetricsService } from '../services/font-metrics';
import { compilePageStyle } from '../services/style-compiler';

let previewCounter = 0;

export async function renderTemplatePreview(
  container: HTMLElement,
  template: TemplarTemplate | TemplarNoteStyle,
  metricsService: FontMetricsService,
  pageOptions?: NotePageOptions,
): Promise<void> {
  container.empty();
  previewCounter += 1;
  const scopeId = `preview-${String(previewCounter)}`;
  const scopeValue = `templar-${scopeId}`;
  const scope = `[data-templar-scope="${scopeValue}"]`;
  const style =
    'sourceTemplateId' in template
      ? template
      : templateToNoteStyle(template, pageOptions);
  const metrics = await metricsService.measurePage(style, container.ownerDocument);
  const compiled = compilePageStyle(style, scope, scopeId, metrics);

  if (compiled.css) {
    const styleEl = container.ownerDocument.createElement('style');
    styleEl.textContent = compiled.css;
    container.appendChild(styleEl);
  }

  const shell = container.createDiv({ cls: 'templar-preview-shell' });
  shell.dataset.templarScope = scopeValue;
  shell.dataset.templarMode = style.page.mode;
  if (style.page.mode === 'paged' && style.page.scaleToFit) {
    shell.style.setProperty(
      '--templar-page-scale',
      String(Math.min(1, 390 / style.page.width)),
    );
  }
  const page = shell.createDiv({ cls: 'templar-page' });
  const content = page.createDiv({ cls: 'templar-page-content' });
  content.createEl('h1', { text: template.name });
  content.createEl('p', {
    text: 'The paper follows the typography. Every line remains ordinary Markdown.',
  });
  const quote = content.createEl('blockquote');
  quote.createEl('p', { text: 'A self-contained writing surface for one note.' });
  const list = content.createEl('ul');
  const item = list.createEl('li');
  const checkbox = item.createEl('input', { type: 'checkbox' });
  checkbox.checked = true;
  item.appendText(' Baseline grid aligned');
  const nested = list.createEl('li');
  const nestedList = nested.createEl('ul');
  const nestedItem = nestedList.createEl('li');
  const nestedCheckbox = nestedItem.createEl('input', { type: 'checkbox' });
  nestedCheckbox.checked = false;
  nestedItem.appendText(' Nested bullet');
  const paragraph = content.createEl('p');
  paragraph.createEl('mark', { text: 'Highlights stay readable' });
  paragraph.appendText('. Links, ');
  paragraph.createEl('a', { href: '#' }).appendText('images');
  paragraph.appendText(', quotes, and ');
  paragraph.createEl('code').appendText('code');
  paragraph.appendText(' share one design language.');
  const callout = content.createDiv({ cls: 'callout', attr: { 'data-callout': 'note' } });
  const calloutTitle = callout.createDiv({ cls: 'callout-title' });
  calloutTitle.createDiv({ cls: 'callout-icon' });
  calloutTitle.createDiv({ cls: 'callout-title-inner', text: 'Callout title' });
  const calloutContent = callout.createDiv({ cls: 'callout-content' });
  calloutContent.createEl('p', { text: 'Callouts pick up the accent, border, and radius.' });
  content.createEl('h2', { text: 'Subheading' });
  const table = content.createEl('table');
  const header = table.createEl('thead').createEl('tr');
  header.createEl('th', { text: 'Item' });
  header.createEl('th', { text: 'Status' });
  const body = table.createEl('tbody');
  const rowOne = body.createEl('tr');
  rowOne.createEl('td', { text: 'First row' });
  rowOne.createEl('td', { text: 'Done' });
  const rowTwo = body.createEl('tr');
  rowTwo.createEl('td', { text: 'Second row' });
  rowTwo.createEl('td', { text: 'Pending' });
  content.createEl('hr');
  content.createEl('h4', { text: 'Detailed heading level' });
  const pre = content.createEl('pre');
  const code = pre.createEl('code');
  code.textContent = ['const rhythm = "aligned";', 'return rhythm;'].join('\n');
  content.createEl('h5', { text: 'Small heading level' });
  content.createEl('p', { text: 'Even the deepest heading levels stay on the grid.' });
}
