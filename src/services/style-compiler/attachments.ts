import type { TemplarNoteStyle, ImageFrame } from '../../types';
import type { StyleCompilerContext } from './types';

export function attachmentSelector(): string {
  return '.internal-embed, .file-embed';
}

function attachmentFrameDeclarations(frame: ImageFrame): string[] {
  switch (frame) {
    case 'none':
      return ['background: transparent', 'border-width: 0', 'border-radius: 0', 'box-shadow: none'];
    case 'thin':
      return ['background: transparent', 'border-width: 1px'];
    case 'photo':
      return ['background: var(--templar-image-border)', 'border-width: 6px'];
    case 'polaroid':
      return [
        'background: var(--templar-image-border)',
        'border-width: 10px',
        'border-bottom-width: 32px',
      ];
    case 'scrapbook':
      return ['background: var(--templar-image-border)', 'border-width: 8px'];
    case 'rounded':
      return ['background: transparent', 'border-width: 0', 'border-radius: 12px', 'overflow: hidden'];
    case 'technical':
      return ['background: transparent', 'border-width: 2px', 'border-radius: 2px'];
    case 'dark':
      return ['background: #2b2724', 'border-color: #2b2724', 'border-width: 8px'];
    case 'vintage':
      return ['background: #f0e2c5', 'border-color: #f0e2c5', 'border-width: 8px'];
  }
}

function attachmentRules(style: TemplarNoteStyle, scope: string): string {
  if (!style.attachments) {
    return '';
  }
  const rules: string[] = [];
  for (const [fileName, override] of Object.entries(style.attachments)) {
    const encoded = encodeURIComponent(fileName).replace(/"/g, '%22');
    const declarations: string[] = [];
    if (override.rotation !== undefined) {
      declarations.push(`transform: rotate(${String(override.rotation)}deg)`);
    }
    if (override.width !== undefined) {
      declarations.push(`width: ${String(override.width)}px`, 'max-width: 100%');
    }
    if (override.frame) {
      declarations.push(...attachmentFrameDeclarations(override.frame));
    }
    if (declarations.length > 0) {
      rules.push(
        `${scope} .templar-page img[src*="${encoded}"] { ${declarations.join('; ')}; }`,
      );
    }
  }
  return rules.join('\n');
}


export function compileAttachments(context: StyleCompilerContext): string {
  return attachmentRules(context.style, context.scope);
}
