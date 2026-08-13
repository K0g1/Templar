export class MarkdownView {}
export class TFile {}
export class Notice {
  public static readonly messages: string[] = [];

  public constructor(public readonly message: string) {
    Notice.messages.push(message);
  }
}
export const Platform = { isMobile: false };
