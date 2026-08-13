import { Notice, type Plugin } from 'obsidian';
import type TemplarPlugin from '../main';

/** Profile-build-only command surface; never call this from a release build. */
export function registerPerformanceCommands(plugin: TemplarPlugin & Pick<Plugin, 'addCommand'>): void {
  plugin.addCommand({
    id: 'perf-reset-capture',
    name: 'Perf reset capture',
    callback: () => {
      plugin.perf.reset();
      new Notice('Templar performance capture reset.');
    },
  });
  plugin.addCommand({
    id: 'perf-start-scenario',
    name: 'Perf start scenario',
    callback: () => {
      if (plugin.perf.isActive()) {
        new Notice('Templar performance capture is already active.');
        return;
      }
      plugin.perf.startScenario({
        scenarioId: 'manual',
        pluginVersion: plugin.manifest.version,
        ownerWindow: plugin.app.workspace.containerEl.ownerDocument.defaultView,
        metadata: {
          platform: 'desktop',
          environmentId: 'manual-host',
          leafCount: plugin.app.workspace.getLeavesOfType('markdown').length,
          notes: ['Started from the profile command surface.'],
        },
      });
      new Notice('Templar performance capture started.');
    },
  });
  plugin.addCommand({
    id: 'perf-stop-scenario',
    name: 'Perf stop scenario',
    callback: () => {
      const capture = plugin.perf.stopScenario();
      if (!capture) {
        new Notice('No active templar performance capture.');
        return;
      }
      new Notice(`Templar performance capture stopped (${String(capture.durationMs.toFixed(1))} ms).`);
    },
  });
  plugin.addCommand({
    id: 'perf-export-latest-capture',
    name: 'Perf export latest capture',
    callback: () => {
      void plugin.exportLatestPerformanceCapture().then((path) => {
        new Notice(path ? `Templar performance capture exported to ${path}.` : 'No Templar performance capture is available.');
      }).catch((error: unknown) => {
        new Notice(`Could not export Templar performance capture: ${error instanceof Error ? error.message : String(error)}`);
      });
    },
  });
  plugin.addCommand({
    id: 'perf-show-current-state',
    name: 'Perf show current state',
    callback: () => {
      const state = plugin.renderer.stateSnapshot();
      console.warn('[Templar Perf] current state', state);
      new Notice(`Templar state: ${JSON.stringify(state)}`);
    },
  });
  plugin.addCommand({
    id: 'perf-set-feature-mask',
    name: 'Perf set feature mask',
    callback: () => {
      const input = plugin.app.workspace.containerEl.ownerDocument.defaultView?.prompt(
        'Templar feature mask JSON (blank restores all enabled):',
        JSON.stringify(plugin.renderer.getFeatureMask()),
      );
      if (input === null || input === undefined) return;
      try {
        const parsed = input.trim() ? JSON.parse(input) as Record<string, unknown> : {};
        const mask = plugin.renderer.setFeatureMask({
          pageLayout: typeof parsed.pageLayout === 'boolean' ? parsed.pageLayout : undefined,
          readingWhitespace: typeof parsed.readingWhitespace === 'boolean' ? parsed.readingWhitespace : undefined,
          paperOrigin: typeof parsed.paperOrigin === 'boolean' ? parsed.paperOrigin : undefined,
          variableRhythm: typeof parsed.variableRhythm === 'boolean' ? parsed.variableRhythm : undefined,
          imageSnap: typeof parsed.imageSnap === 'boolean' ? parsed.imageSnap : undefined,
        });
        new Notice(`Templar feature mask: ${JSON.stringify(mask)}`);
      } catch (error) {
        new Notice(`Invalid Templar feature mask: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  });
}
