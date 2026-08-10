import { beforeEach, describe, expect, it, vi } from 'vitest';

// Obsidian stub: capture registrations instead of no-op'ing them.
interface CapturedCommand {
  id: string;
  name: string;
  checkCallback?: (checking: boolean) => boolean;
  callback?: () => void;
}
interface CapturedEventRef {
  type: string;
}

function makeCapturingPlugin() {
  const commands: CapturedCommand[] = [];
  const events: CapturedEventRef[] = [];
  const postProcessors: unknown[] = [];
  const plugin = {
    settings: {
      recentTemplateIds: [] as string[],
      favouriteTemplateIds: [] as string[],
      defaultTemplateId: '',
      defaultNewPageFlow: 'pageless',
      styleRules: [],
    },
    library: {
      get: vi.fn().mockReturnValue(null),
    },
    frontmatter: {
      hasStyle: vi.fn().mockReturnValue(false),
      getStyle: vi.fn().mockReturnValue(null),
    },
    preview: {
      current: vi.fn().mockReturnValue(null),
      cancelAll: vi.fn().mockResolvedValue(undefined),
    },
    printService: {
      available: vi.fn().mockReturnValue(false),
    },
    app: {
      workspace: {
        on: vi.fn().mockReturnValue({ type: 'workspace-event' }),
        getActiveViewOfType: vi.fn().mockReturnValue(null),
      },
      vault: {
        on: vi.fn().mockReturnValue({ type: 'vault-event' }),
      },
      metadataCache: {
        on: vi.fn().mockReturnValue({ type: 'metadata-event' }),
      },
    },
    fontMetrics: { clear: vi.fn() },
    renderer: {
      scheduleRefreshAll: vi.fn(),
      refreshFile: vi.fn().mockResolvedValue(undefined),
      registerReadingSection: vi.fn(),
    },
    usageIndex: {
      isBuilt: vi.fn().mockReturnValue(false),
      update: vi.fn(),
      rename: vi.fn(),
      remove: vi.fn(),
    },
    styleController: {
      markRulesReady: vi.fn(),
      evaluateStyleRules: vi.fn().mockResolvedValue(undefined),
    },
    lastMarkdownLeaf: null,
    activeFile: vi.fn().mockReturnValue(null),
    activeMarkdownLeaf: vi.fn().mockReturnValue(null),
    updateStatusBar: vi.fn(),
    refreshSidebars: vi.fn(),
    addCommand: vi.fn((command: CapturedCommand) => {
      commands.push(command);
    }),
    registerEvent: vi.fn((ref: CapturedEventRef) => {
      events.push(ref);
    }),
    registerMarkdownPostProcessor: vi.fn((pp: unknown) => {
      postProcessors.push(pp);
    }),
    showStylePicker: vi.fn(),
    showCurrentNoteInspector: vi.fn(),
    showRawStyleEditor: vi.fn(),
    showTemplateCreator: vi.fn(),
    showNewNoteStylePicker: vi.fn(),
    showPageMode: vi.fn(),
    showSynchronizationReview: vi.fn(),
    showStyleRules: vi.fn(),
    showTemplateImporter: vi.fn(),
    showBatchApply: vi.fn(),
    printStyledNote: vi.fn(),
    openStylesView: vi.fn().mockResolvedValue(undefined),
    focusStyleSearch: vi.fn().mockResolvedValue(undefined),
    cycleFavouritePreview: vi.fn().mockResolvedValue(undefined),
    applyCurrentPreview: vi.fn().mockResolvedValue(undefined),
    applyTemplate: vi.fn().mockResolvedValue(undefined),
    removeStyle: vi.fn().mockResolvedValue(undefined),
    writeAndRefresh: vi.fn().mockResolvedValue(undefined),
    copyAuthoringKit: vi.fn().mockResolvedValue(undefined),
  };
  return { plugin, commands, events, postProcessors };
}

beforeEach(() => {
  vi.resetModules();
});

describe('CommandRegistrar registration symmetry', () => {
  it('registers the full command set with stable IDs', async () => {
    const { CommandRegistrar } = await import('../../src/registration/commands');
    const { plugin, commands } = makeCapturingPlugin();
    new CommandRegistrar(plugin as never).register();

    const expected = [
      'open-page-styles',
      'choose-page-style',
      'focus-style-search',
      'customize-current-note',
      'apply-last-used-style',
      'next-favorite-style',
      'previous-favorite-style',
      'apply-previewed-style',
      'cancel-style-preview',
      'apply-default-page-style',
      'remove-page-style',
      'edit-raw-style',
      'create-page-style',
      'create-styled-note',
      'change-page-mode',
      'toggle-paged-pageless',
      'toggle-fit-narrow-screens',
      'review-template-updates',
      'manage-style-rules',
      'print-export-styled-note',
      'import-page-style',
      'batch-apply-page-style',
      'copy-template-authoring-skill',
    ];
    expect(commands.map((c) => c.id).sort()).toEqual([...expected].sort());
  });

  it('apply-default-page-style falls back to DEFAULT_TEMPLATE_ID when settings ID is stale', async () => {
    const { CommandRegistrar } = await import('../../src/registration/commands');
    const { plugin, commands } = makeCapturingPlugin();
    // Settings default points at a deleted template; only the constant exists.
    plugin.settings.defaultTemplateId = 'deleted-template';
    const fallbackTemplate = { id: 'classic-ruled', name: 'Classic Ruled' };
    plugin.library.get.mockImplementation((id: string) =>
      id === 'deleted-template' ? null : fallbackTemplate,
    );
    plugin.activeFile.mockReturnValue({ path: 'n.md', basename: 'n', parent: null });
    new CommandRegistrar(plugin as never).register();

    const command = commands.find((c) => c.id === 'apply-default-page-style')!;
    expect(command.checkCallback).toBeDefined();
    command.checkCallback!(false);
    expect(plugin.applyTemplate).toHaveBeenCalledWith(fallbackTemplate, expect.anything());
  });

  it('commands gate on availability through checkCallback', async () => {
    const { CommandRegistrar } = await import('../../src/registration/commands');
    const { plugin, commands } = makeCapturingPlugin();
    plugin.activeFile.mockReturnValue(null);
    new CommandRegistrar(plugin as never).register();

    const choose = commands.find((c) => c.id === 'choose-page-style')!;
    expect(choose.checkCallback!(true)).toBe(false);
    expect(plugin.showStylePicker).not.toHaveBeenCalled();
  });
});

describe('WorkspaceEventController registration symmetry', () => {
  it('registers workspace, vault, metadata, and postprocessor listeners', async () => {
    const { WorkspaceEventController } = await import('../../src/registration/events');
    const { plugin, events, postProcessors } = makeCapturingPlugin();
    new WorkspaceEventController(plugin as never).register();

    // workspace.on x5 (css-change, active-leaf-change, file-open,
    // layout-change, editor-menu) + vault.on x2 (rename, delete) +
    // metadataCache.on x1 (changed) = 8 event refs. The deferred
    // vault.create listener is registered separately in registerDeferred.
    expect(events.length).toBe(8);
    expect(plugin.registerEvent).toHaveBeenCalledTimes(8);
    // One Markdown post-processor for Reading View reconciliation.
    expect(postProcessors.length).toBe(1);
  });

  it('registerDeferred records the active leaf and marks rules ready', async () => {
    const { WorkspaceEventController } = await import('../../src/registration/events');
    const { plugin } = makeCapturingPlugin();
    const leaf = { leafId: 'active' };
    plugin.app.workspace.getActiveViewOfType = vi.fn().mockReturnValue({ leaf });
    new WorkspaceEventController(plugin as never).registerDeferred();

    expect(plugin.lastMarkdownLeaf).toBe(leaf);
    expect(plugin.styleController.markRulesReady).toHaveBeenCalled();
    // vault create listener registered.
    expect(plugin.registerEvent).toHaveBeenCalledTimes(1);
  });
});
