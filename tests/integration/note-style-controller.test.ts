import { beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  (globalThis as Record<string, unknown>).__lastNotice = null;
});

import { NoteStyleController } from '../../src/services/note-style-controller';
import { BUILT_IN_TEMPLATES } from '../../src/templates/builtins';
import { templateToNoteStyle } from '../../src/templates/note-format';
import { DEFAULT_SETTINGS } from '../../src/templates/defaults';
import { clone } from '../../src/utils/value';
import type { TemplarNoteStyle } from '../../src/types';

interface MockFile {
  path: string;
  basename: string;
  parent: { path: string } | null;
}

interface MockPlugin {
  settings: typeof DEFAULT_SETTINGS & { styleRules: unknown[] };
  frontmatter: {
    getStyle: ReturnType<typeof vi.fn>;
    hasStyle: ReturnType<typeof vi.fn>;
    applyTemplate: ReturnType<typeof vi.fn>;
    removeStyle: ReturnType<typeof vi.fn>;
    writeStyle: ReturnType<typeof vi.fn>;
  };
  library: {
    get: ReturnType<typeof vi.fn>;
    recordRecent: ReturnType<typeof vi.fn>;
  };
  usageIndex: {
    isBuilt: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  renderer: {
    refreshFile: ReturnType<typeof vi.fn>;
  };
  preview: {
    cancelAll: ReturnType<typeof vi.fn>;
  };
  app: {
    metadataCache: {
      getFileCache: ReturnType<typeof vi.fn>;
    };
  };
  refreshSidebars: ReturnType<typeof vi.fn>;
  updateStatusBar: ReturnType<typeof vi.fn>;
}

function makeStyle(): TemplarNoteStyle {
  return templateToNoteStyle(BUILT_IN_TEMPLATES[0]!);
}

function makePluginMock(): MockPlugin {
  const settings = clone(DEFAULT_SETTINGS) as MockPlugin['settings'];
  const frontmatter = {
    getStyle: vi.fn().mockReturnValue(null),
    hasStyle: vi.fn().mockReturnValue(false),
    applyTemplate: vi.fn().mockResolvedValue(undefined),
    removeStyle: vi.fn().mockResolvedValue(undefined),
    writeStyle: vi.fn().mockResolvedValue(undefined),
  };
  const library = {
    get: vi.fn().mockReturnValue(BUILT_IN_TEMPLATES[0]!),
    recordRecent: vi.fn().mockResolvedValue(undefined),
  };
  const usageIndex = {
    isBuilt: vi.fn().mockReturnValue(false),
    update: vi.fn(),
  };
  const renderer = {
    refreshFile: vi.fn().mockResolvedValue(undefined),
  };
  const preview = {
    cancelAll: vi.fn().mockResolvedValue(undefined),
  };
  return {
    settings,
    frontmatter,
    library,
    usageIndex,
    renderer,
    preview,
    app: {
      metadataCache: {
        getFileCache: vi.fn().mockReturnValue(null),
      },
    },
    refreshSidebars: vi.fn(),
    updateStatusBar: vi.fn(),
  };
}

describe('NoteStyleController lifecycle', () => {
  it('applyTemplate applies through frontmatter and refreshes the renderer', async () => {
    const plugin = makePluginMock();
    const controller = new NoteStyleController(plugin);
    const file = { path: 'notes/a.md', basename: 'a', parent: { path: 'notes' } } as MockFile;

    await controller.applyTemplate(BUILT_IN_TEMPLATES[0]!, file as never);

    expect(plugin.frontmatter.applyTemplate).toHaveBeenCalledTimes(1);
    expect(plugin.renderer.refreshFile).toHaveBeenCalledWith(file);
    expect(plugin.refreshSidebars).toHaveBeenCalled();
    expect(plugin.updateStatusBar).toHaveBeenCalled();
  });

  it('applyTemplate cancels previews when not applied by rule', async () => {
    const plugin = makePluginMock();
    const controller = new NoteStyleController(plugin);
    const file = { path: 'notes/a.md', basename: 'a', parent: { path: 'notes' } } as MockFile;

    await controller.applyTemplate(BUILT_IN_TEMPLATES[0]!, file as never);
    expect(plugin.preview.cancelAll).toHaveBeenCalled();
  });

  it('applyTemplate skips preview cancellation when applied by rule', async () => {
    const plugin = makePluginMock();
    const controller = new NoteStyleController(plugin);
    const file = { path: 'notes/a.md', basename: 'a', parent: { path: 'notes' } } as MockFile;

    await controller.applyTemplate(
      BUILT_IN_TEMPLATES[0]!,
      file as never,
      undefined,
      { appliedByRule: { id: 'rule-1', name: 'Rule' } },
    );
    expect(plugin.preview.cancelAll).not.toHaveBeenCalled();
  });

  it('removeStyle refuses when no style exists', async () => {
    const plugin = makePluginMock();
    const controller = new NoteStyleController(plugin);
    const file = { path: 'notes/a.md', basename: 'a', parent: { path: 'notes' } } as MockFile;

    await controller.removeStyle(file as never);
    expect(plugin.frontmatter.removeStyle).not.toHaveBeenCalled();
  });

  it('removeStyle removes when style exists', async () => {
    const plugin = makePluginMock();
    plugin.frontmatter.hasStyle.mockReturnValue(true);
    const controller = new NoteStyleController(plugin);
    const file = { path: 'notes/a.md', basename: 'a', parent: { path: 'notes' } } as MockFile;

    await controller.removeStyle(file as never);
    expect(plugin.frontmatter.removeStyle).toHaveBeenCalledWith(file);
    expect(plugin.renderer.refreshFile).toHaveBeenCalledWith(file);
  });

  it('writeAndRefresh persists and refreshes', async () => {
    const plugin = makePluginMock();
    const controller = new NoteStyleController(plugin);
    const file = { path: 'notes/a.md', basename: 'a', parent: { path: 'notes' } } as MockFile;
    const style = makeStyle();

    await controller.writeAndRefresh(file as never, style);
    expect(plugin.frontmatter.writeStyle).toHaveBeenCalledWith(file, style);
    expect(plugin.renderer.refreshFile).toHaveBeenCalledWith(file);
  });

  it('evaluateStyleRules does nothing before rules are ready', async () => {
    const plugin = makePluginMock();
    const controller = new NoteStyleController(plugin);
    const file = { path: 'notes/a.md', basename: 'a', parent: { path: 'notes' } } as MockFile;

    await controller.evaluateStyleRules(file as never, true);
    expect(plugin.frontmatter.applyTemplate).not.toHaveBeenCalled();
  });

  it('evaluateStyleRules applies a matching rule after readiness', async () => {
    const plugin = makePluginMock();
    plugin.settings.styleRules = [
      {
        id: 'rule-1',
        name: 'Folder rule',
        enabled: true,
        conditions: [{ type: 'folder', folder: 'notes', includeSubfolders: false }],
        templateId: BUILT_IN_TEMPLATES[0]!.id,
        pageFlow: 'default',
      },
    ] as unknown as typeof plugin.settings.styleRules;
    const controller = new NoteStyleController(plugin);
    controller.markRulesReady();
    const file = { path: 'notes/a.md', basename: 'a', parent: { path: 'notes' } } as MockFile;

    await controller.evaluateStyleRules(file as never, true);
    expect(plugin.frontmatter.applyTemplate).toHaveBeenCalled();
  });
});
