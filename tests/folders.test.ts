import { describe, expect, it, vi } from 'vitest';
import { TemplateLibrary } from '../src/services/template-library';
import { BUILT_IN_TEMPLATES } from '../src/templates/builtins';
import { DEFAULT_SETTINGS } from '../src/templates/defaults';
import {
  frontmatterToNoteStyle,
  noteStyleToFrontmatter,
  templateToExportObject,
  templateToNoteStyle,
} from '../src/templates/note-format';
import { normalizeTemplate, normalizeTemplateFolder } from '../src/templates/schema';
import type { TemplarSettings, TemplarTemplate } from '../src/types';
import { clone } from '../src/utils/value';
import { SettingsStore } from '../src/services/settings-store';

function customTemplate(id: string, folder: string): TemplarTemplate {
  const template = clone(BUILT_IN_TEMPLATES[0]!);
  template.id = id;
  template.name = id;
  template.builtIn = false;
  template.metadata.folder = folder;
  return template;
}

describe('template folders', () => {
  it('defaults legacy templates to Unfiled', () => {
    const template = normalizeTemplate({
      'style-name': 'Legacy style',
      'template-id': 'legacy-style',
      metadata: { author: 'A', description: 'Old format', tags: [] },
    });
    expect(template.metadata.folder).toBe('Unfiled');
  });

  it('sanitizes folder names without creating filesystem paths', () => {
    expect(normalizeTemplateFolder('  Study \\ Packs / Autumn:*  ')).toBe(
      'Study Packs Autumn',
    );
    expect(normalizeTemplateFolder('\u0000 / ..')).toBe('Unfiled');
    expect(normalizeTemplateFolder('x'.repeat(120))).toHaveLength(80);
  });

  it('round-trips folders through note frontmatter and portable exports', () => {
    const original = customTemplate('cozy-study', 'Study Packs');
    const frontmatter = noteStyleToFrontmatter(templateToNoteStyle(original));
    expect(frontmatter).toHaveProperty('metadata.folder', 'Study Packs');
    expect(frontmatterToNoteStyle(frontmatter)?.metadata.folder).toBe('Study Packs');
    expect(templateToExportObject(original)).toHaveProperty(
      'templar-template.metadata.folder',
      'Study Packs',
    );
  });

  it('returns unique, sorted folders with Unfiled last', () => {
    const settings: TemplarSettings = {
      ...clone(DEFAULT_SETTINGS),
      userTemplates: [
        customTemplate('z', 'Zines'),
        customTemplate('a', 'Academic'),
        customTemplate('a-two', 'Academic'),
        customTemplate('loose', 'Unfiled'),
      ],
    };
    const library = new TemplateLibrary(settings, new SettingsStore(settings, async () => undefined));
    const folders = library.folders(settings.userTemplates);
    expect(folders).toEqual(['Academic', 'Zines', 'Unfiled']);
  });

  it('deduplicates case variants without merging different diacritics', () => {
    const settings = clone(DEFAULT_SETTINGS);
    const library = new TemplateLibrary(settings, new SettingsStore(settings, async () => undefined));
    const templates = [
      customTemplate('work-upper', 'Work'),
      customTemplate('work-lower', 'work'),
      customTemplate('resume-plain', 'Resume'),
      customTemplate('resume-accented', 'Résumé'),
    ];
    expect(library.folders(templates)).toEqual(['Resume', 'Résumé', 'Work']);
  });

  it('normalizes the folder before persisting a custom template', async () => {
    const settings = clone(DEFAULT_SETTINGS);
    const persist = vi.fn(async () => undefined);
    const library = new TemplateLibrary(settings, new SettingsStore(settings, persist));
    const template = customTemplate('field-notes-custom', '  Field / Notes  ');
    const saved = await library.saveAsNew(template);
    expect(saved.metadata.folder).toBe('Field Notes');
    expect(settings.userTemplates[0]?.metadata.folder).toBe('Field Notes');
    expect(persist).toHaveBeenCalledOnce();
  });
});
