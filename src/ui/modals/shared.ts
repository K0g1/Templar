import {
  Notice,
  Setting,
  type DropdownComponent,
  type TextComponent,
} from 'obsidian';
import type { ImageFrame, NotePageOptions, TemplarTemplate } from '../../types';

export function renderPageOptionSettings(
  container: HTMLElement,
  page: NotePageOptions,
  onUpdate: () => void,
): void {
  let sizeDropdown: DropdownComponent | null = null;
  let widthInput: TextComponent | null = null;
  let heightInput: TextComponent | null = null;
  new Setting(container).setName('Page flow').setHeading();
  new Setting(container)
    .setName('Mode')
    .setDesc('Paged uses a fixed canvas; pageless reflows to the available width.')
    .addDropdown((dropdown) =>
      dropdown
        .addOptions({ pageless: 'Pageless', paged: 'Paged' })
        .setValue(page.mode)
        .onChange((value) => {
          page.mode = value as NotePageOptions['mode'];
          onUpdate();
        }),
    );
  new Setting(container)
    .setName('Page size')
    .setDesc('Used in paged mode and retained when switching modes.')
    .addDropdown((dropdown) => {
      sizeDropdown = dropdown;
      dropdown
        .addOptions({ a4: 'A4', letter: 'US Letter', custom: 'Custom' })
        .setValue(page.size)
        .onChange((value) => {
          page.size = value as NotePageOptions['size'];
          if (value === 'a4') {
            page.width = 794;
            page.height = 1123;
          } else if (value === 'letter') {
            page.width = 816;
            page.height = 1056;
          }
          widthInput?.setValue(String(page.width));
          heightInput?.setValue(String(page.height));
          onUpdate();
        });
    });
  new Setting(container)
    .setName('Page width')
    .setDesc('Width in CSS pixels for the selected preset.')
    .addText((text) => {
      widthInput = text;
      text.setValue(String(page.width)).onChange((value) => {
        const next = Number(value);
        if (Number.isFinite(next) && next >= 480 && next <= 1800) {
          page.width = next;
          page.size = 'custom';
          sizeDropdown?.setValue('custom');
          onUpdate();
        }
      });
    });
  new Setting(container)
    .setName('Page height')
    .setDesc('Height in CSS pixels for the selected preset.')
    .addText((text) => {
      heightInput = text;
      text.setValue(String(page.height)).onChange((value) => {
        const next = Number(value);
        if (Number.isFinite(next) && next >= 640 && next <= 2400) {
          page.height = next;
          page.size = 'custom';
          sizeDropdown?.setValue('custom');
          onUpdate();
        }
      });
    });
  new Setting(container)
    .setName('Page gap')
    .setDesc('Space between sheets in paged mode (8–120 CSS pixels).')
    .addText((text) =>
      text.setValue(String(page.gap)).onChange((value) => {
        const next = Number(value);
        if (Number.isFinite(next) && next >= 8 && next <= 120) {
          page.gap = next;
          onUpdate();
        }
      }),
    );
  new Setting(container)
    .setName('Fit narrow screens')
    .setDesc('Scale the fixed page as a whole on phones and narrow panes without reflowing its text.')
    .addToggle((toggle) =>
      toggle.setValue(page.scaleToFit).onChange((value) => {
        page.scaleToFit = value;
        onUpdate();
      }),
    );
}

export function applyFramePreset(template: TemplarTemplate, frame: ImageFrame): void {
  const images = template.images;
  switch (frame) {
    case 'none':
      Object.assign(images, { borderWidth: 0, bottomBorderWidth: 0, cornerRadius: 0, shadow: 'none' });
      break;
    case 'thin':
      Object.assign(images, { borderWidth: 1, bottomBorderWidth: 1, cornerRadius: 0 });
      break;
    case 'photo':
      Object.assign(images, { borderWidth: 6, bottomBorderWidth: 6, cornerRadius: 0 });
      break;
    case 'polaroid':
      Object.assign(images, { borderWidth: 10, bottomBorderWidth: 34, cornerRadius: 0 });
      break;
    case 'scrapbook':
      Object.assign(images, { borderWidth: 8, bottomBorderWidth: 8, cornerRadius: 1 });
      break;
    case 'rounded':
      Object.assign(images, { borderWidth: 0, bottomBorderWidth: 0, cornerRadius: 12 });
      break;
    case 'technical':
      Object.assign(images, { borderWidth: 2, bottomBorderWidth: 2, cornerRadius: 2 });
      break;
    case 'dark':
      Object.assign(images, { borderWidth: 8, bottomBorderWidth: 8, borderColor: '#2b2724', cornerRadius: 1 });
      break;
    case 'vintage':
      Object.assign(images, { borderWidth: 8, bottomBorderWidth: 8, borderColor: '#f0e2c5', cornerRadius: 2 });
      break;
  }
}

export async function runButtonAction(
  button: HTMLButtonElement,
  action: () => Promise<void>,
): Promise<void> {
  if (button.disabled) return;
  button.disabled = true;
  try {
    await action();
  } catch (error) {
    new Notice(error instanceof Error ? error.message : String(error));
  } finally {
    if (button.isConnected) button.disabled = false;
  }
}

export function stripCodeFence(value: string): string {
  const trimmed = value.trim();
  const match = /^```(?:yaml|yml)?\s*\n([\s\S]*?)\n```$/i.exec(trimmed);
  return match?.[1] ?? trimmed;
}
