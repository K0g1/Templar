import { Notice, type App } from 'obsidian';
import { TEMPLAR_LLM_AUTHORING_KIT } from '../templates/llm-kit';
import { writeTextToClipboard } from '../utils/clipboard';

/** Owns clipboard and vault-file delivery of the authoring kit. */
export class AuthoringKitService {
  public constructor(private readonly app: App) {}

  public async copy(): Promise<void> {
    try {
      await writeTextToClipboard(TEMPLAR_LLM_AUTHORING_KIT);
      new Notice('Template authoring skill copied.');
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error));
    }
  }

  public async export(): Promise<void> {
    const base = 'Templar Template Authoring Skill';
    let path = `${base}.md`;
    let suffix = 2;
    while (this.app.vault.getAbstractFileByPath(path)) {
      path = `${base} ${String(suffix)}.md`;
      suffix += 1;
    }
    await this.app.vault.create(path, TEMPLAR_LLM_AUTHORING_KIT);
    new Notice(`Exported ${path}.`);
  }
}
