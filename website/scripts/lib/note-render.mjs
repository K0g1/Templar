// note-render.mjs — minimal YAML-subset parser + Obsidian-reading-view markdown renderer.
// Written specifically for the YAML shape the Templar plugin persists and the markdown
// features used by the field-guide notes. Kept dependency-free so the website CI needs
// no extra packages.

// ---------------------------------------------------------------- YAML subset -----

function isBlank(line) { return !line || !line.trim(); }

function scalarValue(raw) {
  const value = raw.trim();
  if (value === '{}') return {};
  if (value === '[]') return [];
  if (value === '') return '';
  const first = value[0];
  if ((first === String.fromCharCode(39) || first === String.fromCharCode(34)) && value.length >= 2) {
    const last = value[value.length - 1];
    if (last === first) return value.slice(1, -1).replace(/\\n/g, '\n');
  }
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}

function parseBlock(lines, start, indent) {
  const result = {};
  let index = start;
  let effectiveIndent = indent;
  while (index < lines.length) {
    const line = lines[index];
    if (isBlank(line)) { index += 1; continue; }
    const currentIndent = line.match(/^ */)[0].length;
    if (currentIndent < indent) break;
    // Adopt the first real line's indentation when the caller passed a shallower anchor.
    if (currentIndent > effectiveIndent && Object.keys(result).length === 0) {
      effectiveIndent = currentIndent;
    }
    if (currentIndent > effectiveIndent) { index += 1; continue; }
    const listMatch = line.slice(effectiveIndent).match(/^-\s+(.*)$/);
    if (listMatch) {
      // Consume a list at this indentation level.
      const items = [];
      while (index < lines.length) {
        const itemLine = lines[index];
        if (isBlank(itemLine)) { index += 1; break; }
        const itemIndent = itemLine.match(/^ */)[0].length;
        if (itemIndent !== effectiveIndent) break;
        const itemMatch = itemLine.slice(effectiveIndent).match(/^-\s+(.*)$/);
        if (!itemMatch) break;
        const itemValue = itemMatch[1].trim();
        index += 1;
        if (itemValue === '') {
          const nested = parseBlock(lines, index, effectiveIndent + 2);
          items.push(nested.value);
          index = nested.nextIndex;
        } else if (itemValue.startsWith('{') && itemValue.endsWith('}')) {
          items.push({});
        } else {
          items.push(scalarValue(itemValue));
        }
      }
      result.list = items;
      return { value: result, nextIndex: index };
    }
    const keyMatch = line.slice(effectiveIndent).match(/^([\w-]+)\s*:\s*(.*)$/);
    if (!keyMatch) { index += 1; continue; }
    const key = keyMatch[1];
    const rest = keyMatch[2].trim();
    index += 1;
    if (rest === '|' || rest === '|-' || rest === '>' || rest === '>-') {
      const scalarLines = [];
      while (index < lines.length) {
        const entry = lines[index];
        if (isBlank(entry)) { scalarLines.push(''); index += 1; continue; }
        if (entry.match(/^ */)[0].length <= effectiveIndent) break;
        scalarLines.push(entry.slice(effectiveIndent + 2));
        index += 1;
      }
      let value = scalarLines.join('\n');
      if (rest.endsWith('-')) value = value.replace(/\n+$/, '');
      result[key] = value;
    } else if (rest === '' ) {
      const nested = parseBlock(lines, index, effectiveIndent + 2);
      result[key] = nested.value;
      index = nested.nextIndex;
    } else {
      result[key] = scalarValue(rest);
    }
  }
  return { value: result, nextIndex: index };
}

export function parseTemplarBlock(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const parsed = parseBlock(lines, 0, 0);
  return parsed.value;
}

function camelize(key) {
  return key.replace(/-([a-z])/g, (match, letter) => letter.toUpperCase());
}

function camelizeKeys(value) {
  if (Array.isArray(value)) return value.map(camelizeKeys);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, entry] of Object.entries(value)) {
      if (key === 'list') { return value.list.map(camelizeKeys); }
      out[camelize(key)] = camelizeKeys(entry);
    }
    return out;
  }
  return value;
}

export function styleFromYaml(templarBlock) {
  const raw = camelizeKeys(parseTemplarBlock(templarBlock));
  const style = {
    version: 1,
    id: raw.templateId || raw.styleName || 'custom',
    name: raw.styleName || raw.templateId || 'Custom',
    metadata: raw.metadata || {},
    paper: raw.paper || {},
    baseline: raw.baseline || {},
    typography: raw.typography || {},
    headings: raw.headings || {},
    lists: raw.lists || {},
    layout: raw.layout || {},
    images: raw.images || {},
    blocks: raw.blocks || {},
    watermark: raw.watermark || {},
    css: raw.css || '',
  };
  style.sourceTemplateId = raw.sourceTemplateId;
  style.page = raw.page || { mode: 'pageless', size: 'a4', width: 794, height: 1123, gap: 32, scaleToFit: true };
  return style;
}

// ------------------------------------------------------------- Markdown to DOM -----

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const CALLOUT_DEFAULT_TITLES = {
  note: 'Note', abstract: 'Abstract', summary: 'Summary', tldr: 'TL;DR',
  info: 'Info', todo: 'Todo', tip: 'Tip', hint: 'Hint', important: 'Important',
  success: 'Success', check: 'Check', done: 'Done', question: 'Question', help: 'Help',
  faq: 'FAQ', warning: 'Warning', caution: 'Caution', attention: 'Attention',
  failure: 'Failure', fail: 'Fail', missing: 'Missing', danger: 'Danger', error: 'Error',
  bug: 'Bug', example: 'Example', quote: 'Quote', cite: 'Cite',
};

const CALLOUT_ICONS = {
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><circle cx="12" cy="8" r="0.6" fill="currentColor" stroke="none"/>',
  tip: '<path d="M12 3c3.5 4.5 6 7.2 6 10a6 6 0 0 1-12 0c0-2.8 2.5-5.5 6-10Z"/><path d="M12 16v.01"/>',
  warning: '<path d="m12 3 10 18H2L12 3Z"/><path d="M12 10v4"/><circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none"/>',
  note: '<path d="M4 4h16v16H4z"/><path d="M8 9h8M8 13h5"/>',
  success: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.4 2.4L15.5 9.5"/>',
  question: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.8 2.8 0 0 1 5.5.6c0 1.9-2.7 2.5-2.7 3.9"/><circle cx="12" cy="17.5" r="0.6" fill="currentColor" stroke="none"/>',
  example: '<path d="M9 3h6M10 3v5.5L4.5 18a2 2 0 0 0 1.8 3h11.4a2 2 0 0 0 1.8-3L14 8.5V3"/><path d="M7.5 14h9"/>',
  quote: '<path d="M7 7h4v6c0 2-1 3-3 3.5M13 7h4v6c0 2-1 3-3 3.5"/>',
  danger: '<path d="M13 2 3 14h7l-1 8 10-12h-7l1-8Z"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.4 2.4L15.5 9.5"/>',
  todo: '<circle cx="12" cy="12" r="9"/><path d="M8.5 12l2.4 2.4L15.5 9.5"/>',
};

function calloutIcon(type) {
  const path = CALLOUT_ICONS[type] || CALLOUT_ICONS.info;
  return '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + path + '</svg>';
}

function renderInline(text) {
  let source = text || '';
  const stash = [];
  const protect = (value) => { stash.push(value); return '\u0000' + (stash.length - 1) + '\u0000'; };
  // Raw inline HTML used by the field-guide notes (<code>, <br>).
  source = source.replace(/<(code|kbd|sub|sup|mark|u|small|br)\b([^>]*)\/?>([\s\S]*?)<\/\1>|<(code|kbd|sub|sup|mark|u|small|br)\b([^>]*)\/?>/gi, (match) => protect(match));
  // Backtick code spans.
  source = source.replace(/`([^`\n]+)`/g, (match, inner) => protect('<code>' + escapeHtml(inner) + '</code>'));
  // Wikilink/embed-free internal links.
  source = source.replace(/\[\[([^\]|]+)\]\]/g, (match, target) => protect('<a class="internal-link" data-href="' + escapeHtml(target) + '">' + escapeHtml(target) + '</a>'));
  // Standard links.
  source = source.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label, href) => protect('<a class="external-link" href="' + escapeHtml(href) + '" target="_blank" rel="noopener">' + escapeHtml(label) + '</a>'));
  // Escape the remaining text first so later rules can safely emit real tags.
  source = escapeHtml(source);
  // Highlight, bold, strikethrough, italic on the escaped text.
  source = source.replace(/==([^=\n]+)==/g, (match, inner) => '<mark>' + inner + '</mark>');
  source = source.replace(/\*\*([^*\n]+)\*\*/g, (match, inner) => '<strong>' + inner + '</strong>');
  source = source.replace(/~~([^~\n]+)~~/g, (match, inner) => '<del>' + inner + '</del>');
  source = source.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, (match, prefix, inner) => prefix + '<em>' + inner + '</em>');
  return source.replace(/\u0000(\d+)\u0000/g, (match, index) => stash[Number(index)]);
}

function wrapBlock(kind, inner, snap) {
  const extra = snap ? ' templar-grid-snap-block' : '';
  return '<div class="el-' + kind + extra + '">' + inner + '</div>';
}

function renderBlocks(lines) {
  const html = [];
  let index = 0;
  const inline = renderInline;
  while (index < lines.length) {
    const line = lines[index];
    if (isBlank(line)) { index += 1; continue; }
    const trimmed = line.trim();
    // Fenced code.
    const fence = trimmed.match(/^(~~~|```)\s*(\w+)?\s*$/);
    if (fence) {
      const language = fence[2] || '';
      const marker = fence[1];
      index += 1;
      const codeLines = [];
      while (index < lines.length && !lines[index].trim().startsWith(marker)) { codeLines.push(lines[index]); index += 1; }
      index += 1;
      const className = language ? 'language-' + escapeHtml(language) + ' is-loaded' : 'is-loaded';
      html.push(wrapBlock('pre', '<pre><code class="' + className + '">' + escapeHtml(codeLines.join('\n')) + '</code></pre>', true));
      continue;
    }
    // Headings.
    const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      html.push(wrapBlock('h' + level, '<h' + level + '><span class="heading-collapse-indicator collapse-indicator collapse-icon"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg></span>' + inline(heading[2]) + '</h' + level + '>', false));
      index += 1;
      continue;
    }
    // Callout.
    if (/^>\s*\[!(\w+)\](.*)$/.test(trimmed)) {
      const startIndex = index;
      const calloutLines = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) { calloutLines.push(lines[index].replace(/^\s*>\s?/, '')); index += 1; }
      const header = calloutLines[0].match(/\[!(\w+)\](.*)$/);
      const type = header[1].toLowerCase();
      const title = header[2].trim() || CALLOUT_DEFAULT_TITLES[type] || type;
      const bodyLines = calloutLines.slice(1);
      html.push(wrapBlock('div', '<div class="callout" data-callout="' + escapeHtml(type) + '"><div class="callout-title"><div class="callout-icon">' + calloutIcon(type) + '</div><div class="callout-title-inner">' + inline(title) + '</div></div><div class="callout-content">' + renderBlocks(bodyLines).join('\n') + '</div></div>', true));
      if (index === startIndex) index += 1;
      continue;
    }
    // Blockquote (non-callout).
    if (/^\s*>/.test(line)) {
      const quoteLines = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) { quoteLines.push(lines[index].replace(/^\s*>\s?/, '')); index += 1; }
      html.push(wrapBlock('blockquote', '<blockquote>' + quoteLines.map((entry) => '<p>' + inline(entry) + '</p>').join('') + '</blockquote>', false));
      continue;
    }
    // Horizontal rule.
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      html.push(wrapBlock('div', '<hr>', false));
      index += 1;
      continue;
    }
    // Table.
    if (trimmed.includes('|') && index + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[index + 1].trim()) && !lines[index + 1].trim().match(/[^\s:|\-]/)) {
      const headerCells = trimmed.replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
      const alignmentLine = lines[index + 1].trim().replace(/^\|/, '').replace(/\|$/, '');
      const alignments = alignmentLine.split('|').map((cell) => {
        const trimmedCell = cell.trim();
        if (trimmedCell.startsWith(':') && trimmedCell.endsWith(':')) return 'center';
        if (trimmedCell.endsWith(':')) return 'right';
        return 'left';
      });
      index += 2;
      const rows = [];
      while (index < lines.length && lines[index].trim().includes('|')) {
        rows.push(lines[index].trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim()));
        index += 1;
      }
      const headHtml = '<tr>' + headerCells.map((cell, cellIndex) => '<th style="text-align:' + (alignments[cellIndex] || 'left') + '">' + inline(cell) + '</th>').join('') + '</tr>';
      const bodyHtml = rows.map((row) => '<tr>' + row.map((cell, cellIndex) => '<td style="text-align:' + (alignments[cellIndex] || 'left') + '">' + inline(cell) + '</td>').join('') + '</tr>').join('');
      html.push(wrapBlock('table', '<table><thead>' + headHtml + '</thead><tbody>' + bodyHtml + '</tbody></table>', true));
      continue;
    }
    // Lists (task, unordered, ordered) with nesting.
    const listMatch = trimmed.match(/^([-*+]|\d+[.)])\s+(.*)$/);
    if (listMatch) {
      const ordered = /^\d+[.)]/.test(listMatch[1]);
      const items = [];
      while (index < lines.length) {
        const entry = lines[index];
        if (isBlank(entry)) { index += 1; break; }
        const entryIndent = entry.match(/^ */)[0].length;
        const baseIndent = line.match(/^ */)[0].length;
        if (entryIndent > baseIndent) {
          // Nested content belongs to the previous item: parse deeper list lines only.
          const nestedStart = index;
          let cursor = index;
          const nestedLines = [];
          while (cursor < lines.length) {
            const nestedEntry = lines[cursor];
            if (isBlank(nestedEntry)) { break; }
            if (nestedEntry.match(/^ */)[0].length <= baseIndent) break;
            nestedLines.push(nestedEntry.slice(baseIndent));
            cursor += 1;
          }
          if (nestedLines.some((nestedLine) => /^([-*+]|\d+[.)])\s+/.test(nestedLine.trim()))) {
            const last = items[items.length - 1];
            last.nested = renderBlocks(nestedLines).join('\n');
            index = cursor;
          } else {
            index = nestedStart;
            break;
          }
        } else if (entryIndent < baseIndent) {
          break;
        } else {
          const itemMatch = entry.slice(baseIndent).match(/^([-*+]|\d+[.)])\s+(.*)$/);
          if (!itemMatch) break;
          index += 1;
          const task = itemMatch[2].match(/^\[([ xX])\]\s+(.*)$/);
          items.push(task
            ? { task: true, checked: task[1].toLowerCase() === 'x', text: task[2], nested: '' }
            : { task: false, text: itemMatch[2], nested: '' });
        }
      }
      const listTag = ordered ? 'ol' : 'ul';
      const listHtml = '<' + listTag + '>' + items.map((item) => {
        const checkbox = item.task ? '<input class="task-list-item-checkbox" type="checkbox"' + (item.checked ? ' checked' : '') + ' disabled>' : '';
        const liClass = item.task ? ' class="task-list-item"' : '';
        const dataTask = item.task ? ' data-task="' + (item.checked ? 'x' : ' ') + '"' : '';
        return '<li' + liClass + dataTask + '>' + checkbox + inline(item.text) + (item.nested ? '\n' + item.nested : '') + '</li>';
      }).join('') + '</' + listTag + '>';
      html.push(wrapBlock(ordered ? 'ol' : 'ul', listHtml, false));
      continue;
    }
    // Paragraph (collect consecutive non-blank lines that do not start a new block).
    const paragraphLines = [trimmed];
    index += 1;
    while (index < lines.length && !isBlank(lines[index])) {
      const next = lines[index].trim();
      if (/^(#{1,6})\s+/.test(next) || /^>/.test(next) || /^(~~~|```)/.test(next) || /^([-*+]|\d+[.)])\s+/.test(next) || /^(-{3,}|\*{3,}|_{3,})$/.test(next) || (next.includes('|') && index + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[index + 1].trim()))) break;
      paragraphLines.push(next);
      index += 1;
    }
    const paragraphText = paragraphLines.join(' ');
    const embed = paragraphText.match(/^!\[\[([^\]]+)\]\]$/);
    if (embed) {
      const target = embed[1];
      if (/\.(svg|png|jpe?g|gif|webp|avif)$/i.test(target)) {
        html.push(wrapBlock('p', '<p><span class="internal-embed media-embed image-embed is-loaded"><img src="' + escapeHtml(target) + '" alt="' + escapeHtml(target) + '"></span></p>', true));
      } else {
        html.push(wrapBlock('p', '<p>' + inline(paragraphText) + '</p>', false));
      }
      continue;
    }
    const image = paragraphText.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/);
    if (image) {
      html.push(wrapBlock('p', '<p><img src="' + escapeHtml(image[2]) + '" alt="' + escapeHtml(image[1]) + '"></p>', true));
      continue;
    }
    html.push(wrapBlock('p', '<p>' + inline(paragraphText) + '</p>', false));
  }
  return html;
}

export function renderMarkdown(markdown) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const title = lines.find((line) => /^#\s+/.test(line.trim()));
  return {
    title: title ? title.trim().replace(/^#\s+/, '') : 'Untitled',
    html: renderBlocks(lines).join('\n'),
  };
}
