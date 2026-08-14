"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// scripts/vendor/style-library-entry.ts
var style_library_entry_exports = {};
__export(style_library_entry_exports, {
  STYLE_LIBRARY: () => STYLE_LIBRARY
});
module.exports = __toCommonJS(style_library_entry_exports);

// ../src/utils/value.ts
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

// ../src/templates/accessibility.ts
function parseColor(value) {
  const color = value.trim();
  const hex = /^#([\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i.exec(color)?.[1];
  if (hex) {
    const expanded = hex.length === 3 ? [...hex].map((character) => `${character}${character}`).join("") : hex;
    return {
      red: Number.parseInt(expanded.slice(0, 2), 16),
      green: Number.parseInt(expanded.slice(2, 4), 16),
      blue: Number.parseInt(expanded.slice(4, 6), 16),
      alpha: expanded.length === 8 ? Number.parseInt(expanded.slice(6, 8), 16) / 255 : 1
    };
  }
  const functional = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i.exec(color);
  if (!functional) {
    return null;
  }
  return {
    red: Number(functional[1]),
    green: Number(functional[2]),
    blue: Number(functional[3]),
    alpha: functional[4] === void 0 ? 1 : Number(functional[4])
  };
}
function composite(foreground, background) {
  return {
    red: foreground.red * foreground.alpha + background.red * (1 - foreground.alpha),
    green: foreground.green * foreground.alpha + background.green * (1 - foreground.alpha),
    blue: foreground.blue * foreground.alpha + background.blue * (1 - foreground.alpha),
    alpha: 1
  };
}
function luminance(color) {
  const channel = (value) => {
    const normalized = value / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return channel(color.red) * 0.2126 + channel(color.green) * 0.7152 + channel(color.blue) * 0.0722;
}
function contrastRatio(foreground, background, underlay = "#ffffff") {
  const foregroundColor = parseColor(foreground);
  const backgroundColor = parseColor(background);
  const underlayColor = parseColor(underlay);
  if (!foregroundColor || !backgroundColor || !underlayColor) {
    return 0;
  }
  const opaqueBackground = backgroundColor.alpha < 1 ? composite(backgroundColor, underlayColor) : backgroundColor;
  const opaqueForeground = foregroundColor.alpha < 1 ? composite(foregroundColor, opaqueBackground) : foregroundColor;
  const lighter = Math.max(luminance(opaqueForeground), luminance(opaqueBackground));
  const darker = Math.min(luminance(opaqueForeground), luminance(opaqueBackground));
  return (lighter + 0.05) / (darker + 0.05);
}
function mixColor(source, target, amount) {
  return {
    red: source.red + (target.red - source.red) * amount,
    green: source.green + (target.green - source.green) * amount,
    blue: source.blue + (target.blue - source.blue) * amount,
    alpha: 1
  };
}
function hexColor(color) {
  const channel = (value) => Math.round(value).toString(16).padStart(2, "0");
  return `#${channel(color.red)}${channel(color.green)}${channel(color.blue)}`;
}
function minimumContrast(color, layers) {
  return Math.min(...layers.map((layer) => contrastRatio(color, layer.background, layer.underlay)));
}
function readableAcross(preferred, layers, requiredContrast = 4.5) {
  if (minimumContrast(preferred, layers) >= requiredContrast) {
    return preferred;
  }
  const source = parseColor(preferred);
  const dark = "#151719";
  const light = "#f7f8fa";
  const endpoint = minimumContrast(dark, layers) >= minimumContrast(light, layers) ? dark : light;
  const target = parseColor(endpoint);
  if (!source || !target) {
    return endpoint;
  }
  let low = 0;
  let high = 1;
  for (let iteration = 0; iteration < 20; iteration += 1) {
    const midpoint = (low + high) / 2;
    const candidate = hexColor(mixColor(source, target, midpoint));
    if (minimumContrast(candidate, layers) >= requiredContrast) {
      high = midpoint;
    } else {
      low = midpoint;
    }
  }
  return hexColor(mixColor(source, target, high));
}
function readableColor(preferred, background, underlay = "#ffffff", requiredContrast = 4.5) {
  return readableAcross(preferred, [{ background, underlay }], requiredContrast);
}
function ensureReadableTemplate(template) {
  const paper = template.paper.color;
  template.typography.textColor = readableAcross(
    template.typography.textColor,
    [
      { background: paper },
      { background: template.blocks.embedBackground, underlay: paper }
    ]
  );
  template.typography.mutedColor = readableColor(template.typography.mutedColor, paper);
  for (const level of ["h1", "h2", "h3", "h4", "h5", "h6"]) {
    const heading = template.headings[level];
    const isLargeText = heading.weight >= 700 ? heading.size >= 18.66 : heading.size >= 24;
    heading.color = readableColor(
      heading.color,
      paper,
      "#ffffff",
      isLargeText ? 3 : 4.5
    );
  }
  template.lists.markerColor = readableColor(template.lists.markerColor, paper, "#ffffff", 3);
  template.lists.indentGuideColor = readableColor(
    template.lists.indentGuideColor,
    paper,
    "#ffffff",
    3
  );
  template.blocks.linkColor = readableColor(template.blocks.linkColor, paper);
  template.blocks.highlightTextColor = readableColor(
    template.blocks.highlightTextColor,
    template.blocks.highlightBackground,
    paper
  );
  template.blocks.quoteTextColor = readableColor(
    template.blocks.quoteTextColor,
    template.blocks.quoteBackground,
    paper
  );
  template.blocks.quoteAccent = readableColor(
    template.blocks.quoteAccent,
    template.blocks.quoteBackground,
    paper,
    3
  );
  template.blocks.codeTextColor = readableColor(
    template.blocks.codeTextColor,
    template.blocks.codeBackground,
    paper
  );
  template.blocks.calloutTextColor = readableColor(
    template.blocks.calloutTextColor,
    template.blocks.calloutBackground,
    paper
  );
  template.blocks.calloutTitleColor = readableColor(
    template.blocks.calloutTitleColor,
    template.blocks.calloutBackground,
    paper
  );
  template.blocks.calloutIconColor = readableColor(
    template.blocks.calloutIconColor,
    template.blocks.calloutBackground,
    paper
  );
  template.blocks.calloutAccent = readableColor(
    template.blocks.calloutAccent,
    template.blocks.calloutBackground,
    paper,
    3
  );
  template.blocks.checkboxAccent = readableColor(
    template.blocks.checkboxAccent,
    paper,
    "#ffffff",
    3
  );
  template.blocks.tableTextColor = readableAcross(
    template.blocks.tableTextColor,
    [
      { background: paper },
      { background: template.blocks.tableStripeColor, underlay: paper }
    ]
  );
  template.blocks.tableHeaderTextColor = readableColor(
    template.blocks.tableHeaderTextColor,
    template.blocks.tableHeaderBackground,
    paper
  );
  template.blocks.tableBorder = readableColor(
    template.blocks.tableBorder,
    paper,
    "#ffffff",
    3
  );
  template.blocks.dividerColor = readableColor(
    template.blocks.dividerColor,
    paper,
    "#ffffff",
    3
  );
  template.blocks.embedAccent = readableColor(
    template.blocks.embedAccent,
    template.blocks.embedBackground,
    paper
  );
  for (const variant of Object.values(template.blocks.calloutVariants)) {
    const background = variant.background ?? template.blocks.calloutBackground;
    variant.textColor = readableColor(
      variant.textColor ?? template.blocks.calloutTextColor,
      background,
      paper
    );
    variant.titleColor = readableColor(
      variant.titleColor ?? template.blocks.calloutTitleColor,
      background,
      paper
    );
    variant.iconColor = readableColor(
      variant.iconColor ?? template.blocks.calloutIconColor,
      background,
      paper
    );
    variant.accent = readableColor(
      variant.accent ?? template.blocks.calloutAccent,
      background,
      paper,
      3
    );
  }
  return template;
}

// ../src/templates/defaults.ts
var serif = 'Georgia, "Times New Roman", serif';
var DEFAULT_TEMPLATE = {
  version: 1,
  id: "untitled-style",
  name: "Untitled style",
  metadata: {
    author: "Templar user",
    description: "A custom Templar style.",
    folder: "Unfiled",
    tags: []
  },
  paper: {
    color: "#fffdf7",
    pattern: "blank",
    patternColor: "#c7d8e5",
    majorPatternColor: "#9fb8ca",
    marginLine: false,
    marginColor: "#df8a8a",
    marginOffset: 72,
    patternOpacity: 1,
    patternScale: 1,
    dotRadius: 1,
    graphMajorInterval: 5
  },
  baseline: {
    enabled: true,
    mode: "balanced",
    unit: 30,
    snapImages: true
  },
  typography: {
    bodyFont: serif,
    bodySize: 18,
    bodyWeight: 400,
    textColor: "#302e2b",
    mutedColor: "#706c66",
    bodyLineHeight: 0,
    firstLineIndent: 0,
    dropCap: false
  },
  headings: {
    h1: {
      font: serif,
      size: 42,
      weight: 700,
      color: "#302e2b",
      decoration: "none",
      letterSpacing: 0,
      textTransform: "none"
    },
    h2: {
      font: serif,
      size: 31,
      weight: 700,
      color: "#393631",
      decoration: "none",
      letterSpacing: 0,
      textTransform: "none"
    },
    h3: {
      font: serif,
      size: 24,
      weight: 700,
      color: "#46413b",
      decoration: "none",
      letterSpacing: 0,
      textTransform: "none"
    },
    h4: {
      font: serif,
      size: 20,
      weight: 700,
      color: "#514b44",
      decoration: "none",
      letterSpacing: 0,
      textTransform: "none"
    },
    h5: {
      font: serif,
      size: 17,
      weight: 700,
      color: "#5a534b",
      decoration: "none",
      letterSpacing: 0,
      textTransform: "none"
    },
    h6: {
      font: serif,
      size: 15,
      weight: 700,
      color: "#635c53",
      decoration: "none",
      letterSpacing: 0,
      textTransform: "none"
    }
  },
  lists: {
    markerStyle: "disc",
    markerColor: "#706c66",
    indentGuides: false,
    indentGuideColor: "rgba(48, 46, 43, 0.18)",
    nestedIndent: 0
  },
  layout: {
    maxWidth: 820,
    paddingTop: 60,
    paddingRight: 72,
    paddingBottom: 120,
    paddingLeft: 96,
    pageRadius: 0,
    pageShadow: "none"
  },
  images: {
    frame: "none",
    borderWidth: 0,
    borderColor: "#ffffff",
    bottomBorderWidth: 0,
    cornerRadius: 0,
    rotation: 0,
    shadow: "none",
    maxWidth: 100,
    topSpacing: 30,
    bottomSpacing: 30,
    opacity: 1,
    sepia: 0,
    grayscale: 0,
    saturation: 1,
    contrast: 1,
    float: "none",
    objectFit: "contain",
    duotone: "none"
  },
  blocks: {
    linkColor: "#315f86",
    highlightBackground: "rgba(246, 210, 74, 0.52)",
    highlightTextColor: "#302e2b",
    quoteAccent: "#9fb8ca",
    quoteBackground: "rgba(159, 184, 202, 0.12)",
    quoteTextColor: "#302e2b",
    codeBackground: "rgba(48, 46, 43, 0.08)",
    codeTextColor: "#302e2b",
    codeFont: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
    codeSize: 16,
    tableBorder: "rgba(48, 46, 43, 0.24)",
    tableHeaderBackground: "rgba(48, 46, 43, 0.07)",
    tableBorderWidth: 1,
    tableFontSize: 15,
    tableTextColor: "#302e2b",
    tableHeaderTextColor: "#302e2b",
    tablePadding: 8,
    tableStriped: false,
    tableStripeColor: "rgba(48, 46, 43, 0.045)",
    checkboxAccent: "#507b5c",
    dividerColor: "rgba(48, 46, 43, 0.35)",
    dividerWidth: 1,
    dividerStyle: "solid",
    calloutAccent: "#9fb8ca",
    calloutBackground: "rgba(159, 184, 202, 0.12)",
    calloutTextColor: "#302e2b",
    calloutTitleColor: "#302e2b",
    calloutIconColor: "#9fb8ca",
    calloutBorderWidth: 3,
    calloutRadius: 8,
    calloutVariants: {},
    embedBackground: "rgba(48, 46, 43, 0.06)",
    embedAccent: "#9fb8ca",
    embedRadius: 10
  },
  watermark: {
    text: "",
    color: "rgba(48, 46, 43, 0.1)",
    size: 96,
    rotation: -30,
    opacity: 0.5
  },
  css: ""
};

// ../src/templates/packs/catalog.ts
var serif2 = 'Georgia, "Times New Roman", serif';
var literarySerif = 'Baskerville, "Iowan Old Style", Georgia, serif';
var modern = "Inter, system-ui, -apple-system, sans-serif";
var rounded = 'Nunito, "Avenir Next", system-ui, sans-serif';
var humanist = '"Avenir Next", Avenir, system-ui, sans-serif';
var mono = '"SFMono-Regular", Consolas, "Liberation Mono", monospace';
var technical = '"IBM Plex Mono", "Courier New", monospace';
var editorial = '"Helvetica Neue", Helvetica, Arial, sans-serif';
var geometric = 'Futura, "Avenir Next", system-ui, sans-serif';
var moodCss = {
  clean: `.page h1 { letter-spacing: -0.04em; }
.page hr { opacity: 0.55; }`,
  editorial: `.page h1 { text-transform: uppercase; letter-spacing: 0.055em; }
.page h2 { letter-spacing: 0.025em; }`,
  literary: `.page blockquote { font-style: italic; }
.page h1 { letter-spacing: 0.012em; }`,
  playful: `.page h1 { letter-spacing: -0.025em; }
.page blockquote { border-radius: 10px; }`,
  technical: `.page h1, .page h2 { text-transform: uppercase; letter-spacing: 0.07em; }
.page table { font-variant-numeric: tabular-nums; }`,
  dramatic: `.page h1 { text-transform: uppercase; letter-spacing: 0.09em; }
.page hr { opacity: 0.8; }`
};
function createPackedTemplate(pack, seed) {
  const template = clone(DEFAULT_TEMPLATE);
  const bodyColor = readableColor(seed.text, seed.paper);
  const linkColor = readableColor(seed.accent, seed.paper);
  const highlightText = readableColor(seed.highlightText, seed.highlight, seed.paper);
  template.id = seed.id;
  template.name = seed.name;
  template.builtIn = true;
  template.metadata.author = "Templar";
  template.metadata.description = seed.description;
  template.metadata.tags = [.../* @__PURE__ */ new Set([...pack.tags, ...seed.tags])];
  Object.assign(template.metadata, { folder: pack.folder });
  template.paper.color = seed.paper;
  template.paper.pattern = seed.pattern;
  template.paper.patternColor = seed.line;
  template.paper.majorPatternColor = seed.major ?? seed.accent;
  template.paper.marginLine = seed.margin !== void 0;
  template.paper.marginColor = seed.margin ?? seed.accent;
  template.paper.patternOpacity = seed.pattern === "blank" ? 0 : 0.82;
  template.paper.patternScale = seed.pattern === "scallop" ? 1.35 : seed.pattern === "hex" ? 1.18 : 1;
  template.paper.dotRadius = seed.variantSeed % 3 === 0 ? 1.25 : 1;
  template.paper.graphMajorInterval = seed.variantSeed % 2 === 0 ? 5 : 4;
  template.baseline.enabled = seed.pattern !== "blank";
  template.baseline.mode = seed.pattern === "blank" ? "free" : "balanced";
  template.baseline.unit = seed.unit ?? (seed.pattern === "graph" ? 24 : 28 + seed.variantSeed % 3);
  template.baseline.snapImages = seed.pattern !== "blank";
  template.typography.bodyFont = seed.font;
  template.typography.bodySize = seed.mood === "technical" ? 15 : seed.mood === "literary" ? 18 : 16;
  template.typography.bodyWeight = seed.mood === "dramatic" ? 450 : 400;
  template.typography.textColor = bodyColor;
  template.typography.mutedColor = seed.muted;
  template.typography.firstLineIndent = seed.mood === "literary" ? 24 : 0;
  template.typography.dropCap = seed.mood === "literary" && seed.variantSeed % 2 === 0;
  const headingFont = seed.headingFont ?? seed.font;
  const levels = ["h1", "h2", "h3", "h4", "h5", "h6"];
  for (const [headingIndex, level] of levels.entries()) {
    const heading = template.headings[level];
    heading.font = headingFont;
    heading.color = headingIndex < 2 ? linkColor : bodyColor;
    heading.letterSpacing = seed.mood === "technical" ? 1.2 : seed.mood === "dramatic" ? 1.6 : 0;
    heading.textTransform = seed.mood === "technical" || seed.mood === "dramatic" ? "uppercase" : "none";
  }
  template.headings.h1.decoration = seed.variantSeed % 4 === 1 ? "rule" : seed.variantSeed % 4 === 2 ? "highlight" : "none";
  template.headings.h2.decoration = seed.variantSeed % 4 === 3 ? "underline" : "none";
  template.lists.markerStyle = seed.variantSeed % 4 === 1 ? "circle" : seed.variantSeed % 4 === 2 ? "square" : "disc";
  template.lists.markerColor = seed.accent;
  template.lists.indentGuides = seed.mood === "technical" || seed.variantSeed % 3 === 0;
  template.lists.indentGuideColor = seed.line;
  template.lists.nestedIndent = seed.mood === "technical" ? 28 : 32;
  const layout = seed.layout ?? "soft";
  template.layout.maxWidth = layout === "wide" ? 980 : layout === "compact" ? 680 : layout === "airy" ? 740 : 820;
  template.layout.paddingTop = layout === "compact" ? 48 : 64;
  template.layout.paddingRight = layout === "airy" ? 88 : 72;
  template.layout.paddingBottom = layout === "compact" ? 92 : 120;
  template.layout.paddingLeft = seed.margin ? 102 : layout === "airy" ? 88 : 72;
  template.layout.pageRadius = layout === "soft" ? 16 : layout === "airy" ? 8 : 2;
  template.layout.pageShadow = seed.mood === "dramatic" ? "0 18px 48px rgba(0, 0, 0, 0.38)" : "0 12px 34px rgba(31, 37, 43, 0.14)";
  template.images.frame = seed.frame;
  template.images.borderWidth = seed.frame === "none" ? 0 : seed.frame === "polaroid" ? 9 : 2 + seed.variantSeed % 3;
  template.images.bottomBorderWidth = seed.frame === "polaroid" ? 32 : template.images.borderWidth;
  template.images.borderColor = seed.accent;
  template.images.cornerRadius = seed.frame === "rounded" ? 14 : seed.frame === "technical" ? 2 : 5;
  template.images.rotation = seed.frame === "scrapbook" || seed.frame === "polaroid" ? seed.variantSeed % 5 - 2 : 0;
  template.images.shadow = seed.frame === "none" ? "none" : "0 9px 24px rgba(20, 25, 30, 0.22)";
  template.images.sepia = seed.frame === "vintage" ? 0.22 : 0;
  template.images.grayscale = seed.mood === "editorial" && seed.variantSeed % 2 === 0 ? 0.16 : 0;
  template.images.saturation = seed.mood === "playful" ? 1.12 : 1;
  template.images.contrast = seed.mood === "dramatic" ? 1.08 : 1;
  template.blocks.linkColor = linkColor;
  template.blocks.highlightBackground = seed.highlight;
  template.blocks.highlightTextColor = highlightText;
  template.blocks.quoteAccent = seed.accent;
  template.blocks.quoteBackground = seed.line;
  template.blocks.quoteTextColor = bodyColor;
  template.blocks.codeBackground = seed.mood === "dramatic" ? "rgba(0, 0, 0, 0.28)" : seed.line;
  template.blocks.codeTextColor = bodyColor;
  template.blocks.tableBorder = seed.line;
  template.blocks.tableHeaderBackground = seed.highlight;
  template.blocks.tableTextColor = bodyColor;
  template.blocks.tableHeaderTextColor = highlightText;
  template.blocks.tableStriped = seed.variantSeed % 2 === 0;
  template.blocks.tableStripeColor = seed.line;
  template.blocks.checkboxAccent = seed.accent;
  template.blocks.dividerColor = seed.accent;
  template.blocks.dividerStyle = seed.variantSeed % 4 === 0 ? "fade" : seed.variantSeed % 4 === 1 ? "dashed" : seed.variantSeed % 4 === 2 ? "double" : "solid";
  template.blocks.calloutAccent = seed.accent;
  template.blocks.calloutBackground = seed.line;
  template.blocks.calloutTextColor = bodyColor;
  template.blocks.calloutTitleColor = seed.accent;
  template.blocks.calloutIconColor = seed.accent;
  template.blocks.calloutRadius = seed.mood === "playful" ? 14 : 6;
  template.blocks.embedBackground = seed.line;
  template.blocks.embedAccent = seed.accent;
  template.blocks.embedRadius = seed.mood === "playful" ? 14 : 6;
  template.watermark.text = seed.watermark ?? "";
  template.watermark.color = seed.accent;
  template.watermark.opacity = seed.watermark ? 0.07 : 0.05;
  template.watermark.rotation = seed.mood === "dramatic" ? -18 : -12;
  template.css = moodCss[seed.mood];
  return ensureReadableTemplate(template);
}
var PACKS = [
  {
    folder: "Essentials",
    tags: ["essentials", "everyday"],
    templates: [
      { id: "clean-slate", name: "Clean Slate", description: "A distraction-free white canvas for clear everyday notes.", tags: ["minimal", "blank"], paper: "#ffffff", line: "rgba(67, 76, 86, 0.14)", text: "#252a2e", muted: "#707981", accent: "#3f6f91", highlight: "rgba(144, 195, 225, 0.36)", highlightText: "#183247", pattern: "blank", font: modern, frame: "rounded", mood: "clean", layout: "airy", variantSeed: 0 },
      { id: "daily-ruled", name: "Daily Ruled", description: "A familiar blue-rule notebook for daily writing and quick capture.", tags: ["daily", "ruled"], paper: "#fffef8", line: "rgba(74, 139, 184, 0.28)", text: "#30343a", muted: "#747b82", accent: "#3f78a0", highlight: "rgba(252, 220, 86, 0.48)", highlightText: "#3a321b", pattern: "ruled", font: humanist, frame: "photo", mood: "clean", margin: "rgba(214, 89, 89, 0.48)", variantSeed: 1 },
      { id: "focus-dots", name: "Focus Dots", description: "Crisp dot-grid paper tuned for lists, tasks, and focused planning.", tags: ["planning", "dot-grid"], paper: "#fafaf6", line: "rgba(71, 91, 98, 0.26)", text: "#293438", muted: "#6b787c", accent: "#3b756d", highlight: "rgba(139, 195, 164, 0.4)", highlightText: "#1e3c35", pattern: "dot-grid", font: modern, frame: "thin", mood: "clean", variantSeed: 2 },
      { id: "project-graph", name: "Project Graph", description: "Balanced graph paper for diagrams, estimates, and project thinking.", tags: ["projects", "graph"], paper: "#f7faf9", line: "rgba(60, 133, 119, 0.19)", major: "rgba(43, 105, 96, 0.34)", text: "#243a37", muted: "#677d79", accent: "#2e786e", highlight: "rgba(110, 193, 173, 0.35)", highlightText: "#173d37", pattern: "graph", font: modern, headingFont: technical, frame: "technical", mood: "technical", variantSeed: 3 },
      { id: "meeting-ledger", name: "Meeting Ledger", description: "A tidy column-friendly ledger for agendas, decisions, and owners.", tags: ["meetings", "ledger"], paper: "#fbfaf5", line: "rgba(74, 88, 121, 0.2)", major: "rgba(74, 88, 121, 0.34)", text: "#2f3440", muted: "#737987", accent: "#4b5e91", highlight: "rgba(153, 170, 220, 0.36)", highlightText: "#252f50", pattern: "ledger", font: editorial, headingFont: geometric, frame: "thin", mood: "editorial", layout: "wide", variantSeed: 4 },
      { id: "reading-notes", name: "Reading Notes", description: "Bookish cream paper for excerpts, reactions, and reading lists.", tags: ["reading", "books"], paper: "#f8f3e7", line: "rgba(112, 87, 55, 0.18)", text: "#43382c", muted: "#796d5e", accent: "#815437", highlight: "rgba(219, 180, 104, 0.36)", highlightText: "#382819", pattern: "ruled", font: literarySerif, frame: "vintage", mood: "literary", margin: "rgba(129, 84, 55, 0.38)", variantSeed: 5 },
      { id: "idea-canvas", name: "Idea Canvas", description: "An open, wide page for sketches, loose thoughts, and connections.", tags: ["ideas", "creative"], paper: "#fdfcf8", line: "rgba(75, 90, 101, 0.13)", text: "#2f3539", muted: "#747d82", accent: "#b15e3e", highlight: "rgba(241, 177, 111, 0.38)", highlightText: "#4a2d20", pattern: "blank", font: humanist, frame: "scrapbook", mood: "playful", layout: "wide", variantSeed: 6 },
      { id: "checklist-desk", name: "Checklist Desk", description: "Structured cross-hatch paper that keeps checklists calm and legible.", tags: ["checklist", "tasks"], paper: "#f8faf7", line: "rgba(74, 109, 83, 0.16)", text: "#29372d", muted: "#6a766c", accent: "#4f7e5b", highlight: "rgba(171, 205, 153, 0.42)", highlightText: "#294125", pattern: "cross-hatch", font: modern, frame: "rounded", mood: "clean", layout: "compact", variantSeed: 7 }
    ]
  },
  {
    folder: "Color Stories",
    tags: ["color-story", "palette"],
    templates: [
      { id: "terracotta-teal", name: "Terracotta & Teal", description: "Sun-baked terracotta balanced by cool, confident teal.", tags: ["terracotta", "teal"], paper: "#f7eadf", line: "rgba(44, 113, 110, 0.18)", text: "#4a342d", muted: "#826c64", accent: "#277873", highlight: "rgba(211, 116, 78, 0.38)", highlightText: "#48271c", pattern: "scallop", font: humanist, headingFont: serif2, frame: "rounded", mood: "playful", variantSeed: 0 },
      { id: "cobalt-citrus", name: "Cobalt Citrus", description: "Electric cobalt typography with a bright citrus highlight.", tags: ["cobalt", "citrus"], paper: "#f8f9f2", line: "rgba(34, 76, 168, 0.2)", text: "#26365e", muted: "#6d7896", accent: "#2452b6", highlight: "rgba(228, 211, 48, 0.5)", highlightText: "#34310d", pattern: "dot-grid", font: geometric, frame: "thin", mood: "editorial", variantSeed: 1 },
      { id: "plum-mustard", name: "Plum & Mustard", description: "Rich plum ink and warm mustard accents with editorial character.", tags: ["plum", "mustard"], paper: "#f7f0e8", line: "rgba(92, 48, 82, 0.18)", text: "#4b3046", muted: "#7d6879", accent: "#6c375f", highlight: "rgba(211, 164, 48, 0.42)", highlightText: "#3b2e0c", pattern: "ruled", font: literarySerif, frame: "vintage", mood: "literary", variantSeed: 2 },
      { id: "sage-clay", name: "Sage & Clay", description: "Grounded sage and soft clay for thoughtful, earthy notes.", tags: ["sage", "clay"], paper: "#eef0e3", line: "rgba(111, 130, 91, 0.2)", text: "#394137", muted: "#737b6e", accent: "#a45f49", highlight: "rgba(162, 188, 135, 0.42)", highlightText: "#2f3d29", pattern: "cross-hatch", font: serif2, frame: "scrapbook", mood: "literary", variantSeed: 3 },
      { id: "rose-espresso", name: "Rose & Espresso", description: "Muted rose paper grounded by deep espresso-brown type.", tags: ["rose", "espresso"], paper: "#f5e6e4", line: "rgba(91, 57, 50, 0.16)", text: "#49322e", muted: "#806b67", accent: "#a4515d", highlight: "rgba(220, 139, 147, 0.36)", highlightText: "#47252b", pattern: "blank", font: editorial, headingFont: literarySerif, frame: "photo", mood: "editorial", layout: "airy", variantSeed: 4 },
      { id: "glacier-ember", name: "Glacier & Ember", description: "Icy blue structure animated by a small ember-orange spark.", tags: ["glacier", "ember"], paper: "#edf7fa", line: "rgba(62, 135, 161, 0.2)", text: "#28434d", muted: "#6b8690", accent: "#dd6843", highlight: "rgba(116, 197, 220, 0.4)", highlightText: "#203b44", pattern: "hex", font: modern, frame: "technical", mood: "technical", variantSeed: 5 },
      { id: "aubergine-mint", name: "Aubergine & Mint", description: "Velvety aubergine paired with a fresh mint glow.", tags: ["aubergine", "mint"], paper: "#2b2130", line: "rgba(157, 232, 196, 0.15)", text: "#f2eaf4", muted: "#b9aabd", accent: "#9de8c4", highlight: "rgba(173, 90, 146, 0.54)", highlightText: "#fff5fb", pattern: "dot-grid", font: modern, headingFont: geometric, frame: "dark", mood: "dramatic", variantSeed: 6 },
      { id: "indigo-saffron", name: "Indigo & Saffron", description: "Deep indigo lines with luminous saffron highlights.", tags: ["indigo", "saffron"], paper: "#f5f2e8", line: "rgba(51, 57, 121, 0.19)", text: "#303258", muted: "#71738f", accent: "#3b418b", highlight: "rgba(226, 170, 33, 0.46)", highlightText: "#3b2c08", pattern: "diagonal", font: humanist, headingFont: geometric, frame: "rounded", mood: "editorial", variantSeed: 7 }
    ]
  },
  {
    folder: "Seasons",
    tags: ["seasonal", "atmosphere"],
    templates: [
      { id: "spring-meadow", name: "Spring Meadow", description: "New-leaf greens and flower-petal pink on fresh cream.", tags: ["spring", "meadow"], paper: "#f7fae9", line: "rgba(102, 153, 91, 0.2)", text: "#354936", muted: "#718173", accent: "#db7590", highlight: "rgba(178, 218, 128, 0.42)", highlightText: "#31451f", pattern: "scallop", font: rounded, frame: "rounded", mood: "playful", variantSeed: 0 },
      { id: "summer-solstice", name: "Summer Solstice", description: "Sunlit yellow and clear-sky blue for energetic summer plans.", tags: ["summer", "sunshine"], paper: "#fff8d8", line: "rgba(49, 145, 190, 0.2)", text: "#304853", muted: "#71868e", accent: "#248db6", highlight: "rgba(247, 182, 45, 0.48)", highlightText: "#46300a", pattern: "dot-grid", font: humanist, frame: "photo", mood: "playful", watermark: "\u2600", variantSeed: 1 },
      { id: "autumn-harvest", name: "Autumn Harvest", description: "Burnished pumpkin, wheat, and chestnut for crisp autumn days.", tags: ["autumn", "harvest"], paper: "#f3e4c8", line: "rgba(126, 74, 40, 0.18)", text: "#493527", muted: "#7d6855", accent: "#a64d2c", highlight: "rgba(211, 151, 57, 0.42)", highlightText: "#422b13", pattern: "ruled", font: literarySerif, frame: "vintage", mood: "literary", margin: "rgba(155, 71, 46, 0.42)", variantSeed: 2 },
      { id: "winter-frost", name: "Winter Frost", description: "Pale blue geometry and charcoal type with a quiet wintry hush.", tags: ["winter", "frost"], paper: "#f3f8fb", line: "rgba(109, 158, 187, 0.2)", text: "#34454f", muted: "#768994", accent: "#527e9a", highlight: "rgba(188, 220, 235, 0.5)", highlightText: "#294453", pattern: "hex", font: modern, frame: "thin", mood: "clean", layout: "airy", variantSeed: 3 },
      { id: "rainy-day", name: "Rainy Day", description: "Blue-gray ruling and inky accents for reflective rainy afternoons.", tags: ["rain", "cozy"], paper: "#eaf0f1", line: "rgba(80, 118, 134, 0.24)", text: "#31434b", muted: "#718188", accent: "#466f83", highlight: "rgba(130, 172, 190, 0.42)", highlightText: "#223b46", pattern: "ruled", font: serif2, frame: "photo", mood: "literary", variantSeed: 4 },
      { id: "golden-hour", name: "Golden Hour", description: "Warm apricot light and dusky violet for end-of-day reflections.", tags: ["sunset", "golden-hour"], paper: "#fff0dc", line: "rgba(114, 74, 115, 0.17)", text: "#50394d", muted: "#836f80", accent: "#8b527b", highlight: "rgba(239, 163, 74, 0.44)", highlightText: "#4b2c0f", pattern: "diagonal", font: humanist, frame: "polaroid", mood: "playful", variantSeed: 5 },
      { id: "first-snow", name: "First Snow", description: "A nearly white page with fine silver dots and evergreen details.", tags: ["snow", "evergreen"], paper: "#fbfcfc", line: "rgba(128, 145, 150, 0.22)", text: "#303b3d", muted: "#778386", accent: "#3f7167", highlight: "rgba(190, 218, 213, 0.42)", highlightText: "#27423d", pattern: "dot-grid", font: editorial, headingFont: serif2, frame: "rounded", mood: "clean", variantSeed: 6 },
      { id: "monsoon-garden", name: "Monsoon Garden", description: "Saturated leaf green and rainwater blue on moody garden paper.", tags: ["monsoon", "garden"], paper: "#172c2a", line: "rgba(90, 181, 172, 0.17)", text: "#e4f1eb", muted: "#9bb9af", accent: "#75c7b4", highlight: "rgba(94, 143, 87, 0.58)", highlightText: "#f2fff7", pattern: "cross-hatch", font: serif2, headingFont: geometric, frame: "dark", mood: "dramatic", variantSeed: 7 }
    ]
  },
  {
    folder: "Celebrations & Occasions",
    tags: ["celebration", "occasion"],
    templates: [
      { id: "birthday-confetti", name: "Birthday Confetti", description: "A colorful, buoyant page for birthday plans and memories.", tags: ["birthday", "confetti"], paper: "#fff8fb", line: "rgba(75, 165, 195, 0.2)", text: "#413542", muted: "#7d7080", accent: "#e34891", highlight: "rgba(255, 209, 56, 0.52)", highlightText: "#42340a", pattern: "scallop", font: rounded, frame: "polaroid", mood: "playful", watermark: "\u2726", variantSeed: 0 },
      { id: "wedding-vows", name: "Wedding Vows", description: "Elegant ivory and dusty rose for vows, toasts, and keepsakes.", tags: ["wedding", "romantic"], paper: "#fdf9f2", line: "rgba(174, 122, 128, 0.16)", text: "#4b3c3b", muted: "#837573", accent: "#aa6f78", highlight: "rgba(226, 190, 178, 0.44)", highlightText: "#4a3232", pattern: "blank", font: literarySerif, frame: "photo", mood: "literary", layout: "airy", variantSeed: 1 },
      { id: "baby-shower", name: "Baby Shower", description: "Soft mint, peach, and cloud-like curves for joyful planning.", tags: ["baby-shower", "soft"], paper: "#f6fcf7", line: "rgba(100, 175, 156, 0.19)", text: "#3a4a45", muted: "#74847e", accent: "#e79779", highlight: "rgba(183, 226, 208, 0.46)", highlightText: "#2b443a", pattern: "scallop", font: rounded, frame: "rounded", mood: "playful", variantSeed: 2 },
      { id: "graduation-day", name: "Graduation Day", description: "Confident navy and gold for speeches, goals, and milestones.", tags: ["graduation", "milestone"], paper: "#f8f5ea", line: "rgba(36, 58, 103, 0.2)", text: "#29354e", muted: "#6b7485", accent: "#a77a21", highlight: "rgba(223, 187, 88, 0.43)", highlightText: "#3a2b0c", pattern: "ruled", font: serif2, headingFont: geometric, frame: "thin", mood: "editorial", margin: "rgba(167, 122, 33, 0.42)", variantSeed: 3 },
      { id: "holiday-cheer", name: "Holiday Cheer", description: "Evergreen and cranberry details on warm festive stationery.", tags: ["holiday", "festive"], paper: "#f8f3e8", line: "rgba(55, 113, 76, 0.18)", text: "#374139", muted: "#747e76", accent: "#9d3f48", highlight: "rgba(198, 164, 74, 0.4)", highlightText: "#3a2f12", pattern: "cross-hatch", font: serif2, frame: "scrapbook", mood: "literary", watermark: "\u2727", variantSeed: 4 },
      { id: "new-year-sparkle", name: "New Year Sparkle", description: "Midnight blue and champagne gold for resolutions and countdowns.", tags: ["new-year", "sparkle"], paper: "#161b2b", line: "rgba(214, 188, 117, 0.17)", text: "#f1ecdf", muted: "#aaa594", accent: "#d6bc75", highlight: "rgba(103, 128, 201, 0.52)", highlightText: "#f8f5ea", pattern: "dot-grid", font: geometric, frame: "dark", mood: "dramatic", watermark: "\u2726", variantSeed: 5 },
      { id: "dinner-party", name: "Dinner Party", description: "Sophisticated aubergine and olive for menus and hosting notes.", tags: ["dinner", "hosting"], paper: "#f3eadf", line: "rgba(93, 91, 59, 0.18)", text: "#493b42", muted: "#7c7075", accent: "#6f3d59", highlight: "rgba(166, 164, 91, 0.42)", highlightText: "#333315", pattern: "ledger", font: editorial, headingFont: literarySerif, frame: "photo", mood: "editorial", variantSeed: 6 },
      { id: "thank-you-note", name: "Thank You Note", description: "Graceful blue-gray stationery for sincere letters of thanks.", tags: ["gratitude", "letter"], paper: "#f8faf8", line: "rgba(93, 123, 137, 0.19)", text: "#39464b", muted: "#748086", accent: "#597f8f", highlight: "rgba(185, 210, 205, 0.42)", highlightText: "#2d4849", pattern: "ruled", font: literarySerif, frame: "rounded", mood: "literary", margin: "rgba(180, 116, 108, 0.35)", variantSeed: 7 }
    ]
  },
  {
    folder: "Academia",
    tags: ["academia", "study"],
    templates: [
      { id: "cornell-lecture", name: "Cornell Lecture", description: "Clear ruled notes with a strong cue column and study-friendly contrast.", tags: ["cornell", "lecture"], paper: "#fffdf2", line: "rgba(63, 120, 165, 0.24)", text: "#303941", muted: "#717d85", accent: "#346e99", highlight: "rgba(247, 211, 80, 0.45)", highlightText: "#3d3414", pattern: "ruled", font: modern, frame: "thin", mood: "clean", margin: "rgba(208, 80, 79, 0.58)", layout: "wide", variantSeed: 0 },
      { id: "literature-seminar", name: "Literature Seminar", description: "Bookish seminar paper for close reading and textual discussion.", tags: ["literature", "seminar"], paper: "#f5eddd", line: "rgba(107, 78, 52, 0.17)", text: "#46362a", muted: "#796959", accent: "#783f36", highlight: "rgba(201, 155, 82, 0.36)", highlightText: "#3d2a17", pattern: "ruled", font: literarySerif, frame: "vintage", mood: "literary", variantSeed: 1 },
      { id: "chemistry-lab", name: "Chemistry Lab", description: "Cool graph paper engineered for observations, formulas, and results.", tags: ["chemistry", "lab"], paper: "#f1f9f8", line: "rgba(39, 136, 145, 0.19)", major: "rgba(26, 111, 122, 0.36)", text: "#234247", muted: "#648086", accent: "#167886", highlight: "rgba(113, 204, 194, 0.38)", highlightText: "#16413f", pattern: "graph", font: technical, frame: "technical", mood: "technical", variantSeed: 2 },
      { id: "mathematics-proof", name: "Mathematics Proof", description: "Precise monochrome grid paper for derivations and formal proofs.", tags: ["mathematics", "proof"], paper: "#fbfbf8", line: "rgba(46, 55, 64, 0.16)", major: "rgba(46, 55, 64, 0.28)", text: "#22282d", muted: "#697177", accent: "#354d62", highlight: "rgba(167, 188, 203, 0.38)", highlightText: "#233643", pattern: "graph", font: technical, headingFont: serif2, frame: "technical", mood: "technical", layout: "wide", variantSeed: 3 },
      { id: "history-archive", name: "History Archive", description: "Archival buff paper for timelines, sources, and historical arguments.", tags: ["history", "archive"], paper: "#eaddbd", line: "rgba(107, 78, 45, 0.17)", text: "#493624", muted: "#7a654d", accent: "#7d4634", highlight: "rgba(185, 137, 63, 0.36)", highlightText: "#3c2a16", pattern: "ledger", font: literarySerif, frame: "vintage", mood: "literary", variantSeed: 4 },
      { id: "language-study", name: "Language Study", description: "Friendly divided paper for vocabulary, translations, and examples.", tags: ["language", "vocabulary"], paper: "#fff9ef", line: "rgba(78, 133, 165, 0.2)", text: "#35434a", muted: "#728087", accent: "#cf5e55", highlight: "rgba(246, 198, 87, 0.44)", highlightText: "#453713", pattern: "ledger", font: humanist, frame: "rounded", mood: "clean", variantSeed: 5 },
      { id: "thesis-draft", name: "Thesis Draft", description: "Calm editorial white space for long-form academic arguments.", tags: ["thesis", "writing"], paper: "#fcfcfa", line: "rgba(55, 65, 74, 0.13)", text: "#252b30", muted: "#6d757b", accent: "#394f61", highlight: "rgba(190, 200, 207, 0.4)", highlightText: "#273640", pattern: "blank", font: serif2, headingFont: editorial, frame: "thin", mood: "editorial", layout: "airy", variantSeed: 6 },
      { id: "research-index", name: "Research Index", description: "Index-card-inspired structure for sources, claims, and cross-references.", tags: ["research", "index"], paper: "#f9f5e8", line: "rgba(62, 105, 139, 0.21)", text: "#313d46", muted: "#6d7981", accent: "#3d739a", highlight: "rgba(225, 184, 88, 0.42)", highlightText: "#3c3012", pattern: "cross-hatch", font: mono, frame: "photo", mood: "technical", layout: "compact", variantSeed: 7 }
    ]
  },
  {
    folder: "Professional",
    tags: ["professional", "work"],
    templates: [
      { id: "executive-brief", name: "Executive Brief", description: "A restrained navy brief for decisions, summaries, and key metrics.", tags: ["executive", "brief"], paper: "#f8f9fa", line: "rgba(45, 63, 84, 0.16)", text: "#26313e", muted: "#697581", accent: "#294e73", highlight: "rgba(147, 180, 208, 0.36)", highlightText: "#203a53", pattern: "blank", font: editorial, headingFont: geometric, frame: "thin", mood: "editorial", layout: "wide", variantSeed: 0 },
      { id: "product-strategy", name: "Product Strategy", description: "Modern indigo dot-grid paper for roadmaps and product bets.", tags: ["product", "strategy"], paper: "#f7f7fc", line: "rgba(75, 78, 157, 0.2)", text: "#30324c", muted: "#71738b", accent: "#4b4f9d", highlight: "rgba(167, 167, 224, 0.4)", highlightText: "#292b58", pattern: "dot-grid", font: modern, frame: "rounded", mood: "clean", layout: "wide", variantSeed: 1 },
      { id: "design-critique", name: "Design Critique", description: "Generous white space and vivid coral for thoughtful design feedback.", tags: ["design", "critique"], paper: "#fdfcfb", line: "rgba(54, 66, 75, 0.13)", text: "#293238", muted: "#707a80", accent: "#e05d50", highlight: "rgba(250, 180, 131, 0.42)", highlightText: "#4b2a1c", pattern: "blank", font: modern, headingFont: geometric, frame: "none", mood: "clean", layout: "airy", variantSeed: 2 },
      { id: "client-workshop", name: "Client Workshop", description: "Approachable teal graph paper for collaborative workshop capture.", tags: ["client", "workshop"], paper: "#f1f8f6", line: "rgba(38, 127, 117, 0.18)", major: "rgba(38, 127, 117, 0.31)", text: "#28423f", muted: "#6b807c", accent: "#277f75", highlight: "rgba(122, 202, 183, 0.38)", highlightText: "#1b443d", pattern: "graph", font: humanist, frame: "technical", mood: "technical", layout: "wide", variantSeed: 3 },
      { id: "sales-pipeline", name: "Sales Pipeline", description: "A confident green ledger for accounts, stages, and next actions.", tags: ["sales", "pipeline"], paper: "#f5f8f3", line: "rgba(55, 115, 73, 0.18)", major: "rgba(55, 115, 73, 0.31)", text: "#2e4033", muted: "#6d7c70", accent: "#39784b", highlight: "rgba(150, 201, 143, 0.42)", highlightText: "#254224", pattern: "ledger", font: editorial, headingFont: geometric, frame: "thin", mood: "editorial", variantSeed: 4 },
      { id: "project-retrospective", name: "Project Retrospective", description: "Warm structured paper for wins, lessons, and next experiments.", tags: ["project", "retrospective"], paper: "#fcf6eb", line: "rgba(171, 104, 63, 0.18)", text: "#493b32", muted: "#7e7167", accent: "#b2633d", highlight: "rgba(236, 177, 98, 0.42)", highlightText: "#4a2d17", pattern: "cross-hatch", font: modern, frame: "rounded", mood: "clean", variantSeed: 5 },
      { id: "conference-notes", name: "Conference Notes", description: "Portable ruled notes for sessions, speakers, and follow-ups.", tags: ["conference", "notes"], paper: "#fbfaf5", line: "rgba(74, 116, 151, 0.22)", text: "#32404a", muted: "#707e86", accent: "#39739c", highlight: "rgba(244, 195, 83, 0.44)", highlightText: "#40330f", pattern: "ruled", font: humanist, frame: "photo", mood: "clean", margin: "rgba(211, 90, 82, 0.44)", variantSeed: 6 },
      { id: "finance-ledger", name: "Finance Ledger", description: "Numerically precise green-gray ledger paper for financial analysis.", tags: ["finance", "ledger"], paper: "#f4f7f3", line: "rgba(54, 101, 74, 0.18)", major: "rgba(54, 101, 74, 0.33)", text: "#2b3930", muted: "#68766c", accent: "#34664a", highlight: "rgba(161, 194, 151, 0.38)", highlightText: "#294126", pattern: "ledger", font: technical, frame: "technical", mood: "technical", layout: "wide", variantSeed: 7 }
    ]
  },
  {
    folder: "Journaling & Wellness",
    tags: ["journaling", "wellness"],
    templates: [
      { id: "morning-pages", name: "Morning Pages", description: "Warm, easygoing ruled paper for uncensored morning writing.", tags: ["morning", "freewriting"], paper: "#fff9eb", line: "rgba(122, 148, 167, 0.2)", text: "#453d33", muted: "#7c7368", accent: "#c47745", highlight: "rgba(238, 187, 103, 0.4)", highlightText: "#493018", pattern: "ruled", font: literarySerif, frame: "photo", mood: "literary", variantSeed: 0 },
      { id: "gratitude-garden", name: "Gratitude Garden", description: "Soft botanical greens for noticing and recording small joys.", tags: ["gratitude", "botanical"], paper: "#f1f5e7", line: "rgba(85, 129, 79, 0.18)", text: "#344234", muted: "#6e7b6c", accent: "#5f865a", highlight: "rgba(175, 205, 139, 0.42)", highlightText: "#304322", pattern: "scallop", font: serif2, frame: "scrapbook", mood: "playful", variantSeed: 1 },
      { id: "mood-tracker", name: "Mood Tracker", description: "A gentle rainbow dot grid for patterns, feelings, and check-ins.", tags: ["mood", "tracker"], paper: "#fff8fa", line: "rgba(120, 134, 196, 0.2)", text: "#403b4a", muted: "#777181", accent: "#9c67ad", highlight: "rgba(242, 175, 190, 0.44)", highlightText: "#4b2f3a", pattern: "dot-grid", font: rounded, frame: "rounded", mood: "playful", variantSeed: 2 },
      { id: "dream-journal", name: "Dream Journal", description: "Moonlit lavender paper for fragments, symbols, and dream recall.", tags: ["dreams", "sleep"], paper: "#272438", line: "rgba(190, 178, 232, 0.15)", text: "#eee9f5", muted: "#aaa2ba", accent: "#bba9e3", highlight: "rgba(110, 90, 161, 0.55)", highlightText: "#f7f3ff", pattern: "diagonal", font: literarySerif, frame: "dark", mood: "dramatic", watermark: "\u263E", variantSeed: 3 },
      { id: "meditation-log", name: "Meditation Log", description: "Quiet rice-white space for sits, observations, and intentions.", tags: ["meditation", "mindfulness"], paper: "#f5f2e9", line: "rgba(105, 111, 102, 0.14)", text: "#343632", muted: "#777972", accent: "#6e786a", highlight: "rgba(185, 188, 166, 0.36)", highlightText: "#34382f", pattern: "blank", font: serif2, frame: "none", mood: "clean", layout: "airy", variantSeed: 4 },
      { id: "therapy-reflection", name: "Therapy Reflection", description: "A grounded blue-gray page for private reflection and reframing.", tags: ["therapy", "reflection"], paper: "#f0f5f5", line: "rgba(82, 128, 139, 0.18)", text: "#33454a", muted: "#718287", accent: "#527f89", highlight: "rgba(168, 205, 202, 0.4)", highlightText: "#2c4747", pattern: "ruled", font: humanist, frame: "rounded", mood: "clean", variantSeed: 5 },
      { id: "habit-bloom", name: "Habit Bloom", description: "Cheerful petal-pattern paper for routines and gentle consistency.", tags: ["habits", "tracker"], paper: "#fff6ed", line: "rgba(213, 121, 117, 0.18)", text: "#4c3b39", muted: "#816f6d", accent: "#d16f78", highlight: "rgba(247, 190, 119, 0.44)", highlightText: "#4c321a", pattern: "scallop", font: rounded, frame: "rounded", mood: "playful", variantSeed: 6 },
      { id: "self-care-sunday", name: "Self-Care Sunday", description: "Cozy peach and lilac notes for rest, reset, and restoration.", tags: ["self-care", "rest"], paper: "#fbefeb", line: "rgba(139, 112, 164, 0.17)", text: "#493c4c", muted: "#7d7080", accent: "#8c70a5", highlight: "rgba(236, 169, 140, 0.45)", highlightText: "#492f26", pattern: "cross-hatch", font: rounded, frame: "polaroid", mood: "playful", variantSeed: 7 }
    ]
  },
  {
    folder: "Travel",
    tags: ["travel", "places"],
    templates: [
      { id: "alpine-trek", name: "Alpine Trek", description: "Crisp mountain-air paper for routes, peaks, and trail memories.", tags: ["alpine", "hiking"], paper: "#eef4ed", line: "rgba(58, 105, 78, 0.2)", text: "#304037", muted: "#6b7a70", accent: "#477c5c", highlight: "rgba(161, 192, 137, 0.4)", highlightText: "#2d4225", pattern: "graph", font: humanist, frame: "technical", mood: "technical", variantSeed: 0 },
      { id: "coastal-postcard", name: "Coastal Postcard", description: "Sea-glass blue and coral for breezy coastal travel stories.", tags: ["coast", "postcard"], paper: "#eff9f7", line: "rgba(44, 131, 145, 0.19)", text: "#29464a", muted: "#688185", accent: "#dd745f", highlight: "rgba(110, 197, 190, 0.4)", highlightText: "#20403f", pattern: "ruled", font: humanist, frame: "polaroid", mood: "playful", variantSeed: 1 },
      { id: "tokyo-night", name: "Tokyo Night", description: "Electric signs and midnight indigo for after-dark city notes.", tags: ["tokyo", "night"], paper: "#17182b", line: "rgba(83, 215, 224, 0.14)", major: "rgba(242, 72, 171, 0.25)", text: "#edf1fa", muted: "#9ca5bd", accent: "#55d8df", highlight: "rgba(240, 65, 167, 0.54)", highlightText: "#fff5fc", pattern: "graph", font: mono, frame: "dark", mood: "dramatic", variantSeed: 2 },
      { id: "paris-cafe", name: "Paris Caf\xE9", description: "Cream caf\xE9 stationery with burgundy ink and literary charm.", tags: ["paris", "cafe"], paper: "#f2e5cf", line: "rgba(102, 69, 49, 0.17)", text: "#4a3428", muted: "#7d6958", accent: "#843d48", highlight: "rgba(196, 148, 82, 0.38)", highlightText: "#3e2917", pattern: "ruled", font: literarySerif, frame: "vintage", mood: "literary", variantSeed: 3 },
      { id: "mediterranean-diary", name: "Mediterranean Diary", description: "Whitewashed paper, cobalt ink, and lemon-yellow sunlight.", tags: ["mediterranean", "diary"], paper: "#fffdf0", line: "rgba(39, 91, 173, 0.2)", text: "#2e3d5a", muted: "#6f7890", accent: "#2d5eb1", highlight: "rgba(239, 207, 65, 0.48)", highlightText: "#40370d", pattern: "scallop", font: serif2, frame: "photo", mood: "playful", variantSeed: 4 },
      { id: "desert-roadtrip", name: "Desert Roadtrip", description: "Canyon orange and turquoise on sun-faded map paper.", tags: ["desert", "roadtrip"], paper: "#f3e3c7", line: "rgba(135, 83, 49, 0.2)", text: "#4b3829", muted: "#806a56", accent: "#267c7a", highlight: "rgba(219, 143, 66, 0.42)", highlightText: "#462c13", pattern: "dot-grid", font: geometric, frame: "scrapbook", mood: "playful", variantSeed: 5 },
      { id: "tropical-escape", name: "Tropical Escape", description: "Palm green and hibiscus pink for vivid island adventures.", tags: ["tropical", "island"], paper: "#eef8e8", line: "rgba(48, 126, 76, 0.19)", text: "#2f4935", muted: "#6e826f", accent: "#dd5579", highlight: "rgba(151, 210, 118, 0.43)", highlightText: "#2c451f", pattern: "hex", font: rounded, frame: "polaroid", mood: "playful", variantSeed: 6 },
      { id: "city-explorer", name: "City Explorer", description: "A compact transit-map grid for neighborhoods, stops, and discoveries.", tags: ["city", "urban"], paper: "#f5f5f2", line: "rgba(55, 69, 79, 0.17)", major: "rgba(202, 70, 62, 0.3)", text: "#293238", muted: "#6d777c", accent: "#c94b45", highlight: "rgba(244, 180, 62, 0.44)", highlightText: "#42300d", pattern: "graph", font: editorial, headingFont: geometric, frame: "technical", mood: "technical", layout: "compact", variantSeed: 7 }
    ]
  },
  {
    folder: "Nature",
    tags: ["nature", "outdoors"],
    templates: [
      { id: "woodland-herbarium", name: "Woodland Herbarium", description: "Pressed-leaf greens and archival cream for botanical records.", tags: ["woodland", "herbarium"], paper: "#eee8cf", line: "rgba(73, 105, 66, 0.18)", text: "#3b4634", muted: "#727b69", accent: "#52734a", highlight: "rgba(153, 181, 117, 0.4)", highlightText: "#304025", pattern: "ruled", font: literarySerif, frame: "vintage", mood: "literary", variantSeed: 0 },
      { id: "coastal-fog", name: "Coastal Fog", description: "Mist gray, muted blue, and spacious typography for quiet observations.", tags: ["coast", "fog"], paper: "#edf1f0", line: "rgba(90, 119, 127, 0.17)", text: "#344247", muted: "#748186", accent: "#5b7d86", highlight: "rgba(175, 199, 199, 0.4)", highlightText: "#304747", pattern: "blank", font: editorial, headingFont: serif2, frame: "rounded", mood: "clean", layout: "airy", variantSeed: 1 },
      { id: "alpine-wildflower", name: "Alpine Wildflower", description: "Cool stone paper scattered with violet wildflower accents.", tags: ["alpine", "wildflower"], paper: "#f0f2e9", line: "rgba(91, 113, 96, 0.18)", text: "#38433a", muted: "#737d74", accent: "#7b659d", highlight: "rgba(188, 181, 218, 0.42)", highlightText: "#3e3255", pattern: "dot-grid", font: humanist, frame: "photo", mood: "playful", variantSeed: 2 },
      { id: "desert-bloom", name: "Desert Bloom", description: "Sand, cactus green, and coral flowers in a sunlit dot grid.", tags: ["desert", "bloom"], paper: "#f4e6cf", line: "rgba(112, 100, 67, 0.19)", text: "#473c2d", muted: "#7b705e", accent: "#c45f51", highlight: "rgba(145, 177, 109, 0.42)", highlightText: "#304023", pattern: "dot-grid", font: rounded, frame: "scrapbook", mood: "playful", variantSeed: 3 },
      { id: "moss-and-stone", name: "Moss & Stone", description: "Deep moss, mineral gray, and quiet cross-hatching for field notes.", tags: ["moss", "stone"], paper: "#dde3d7", line: "rgba(69, 85, 69, 0.19)", text: "#354036", muted: "#6b756c", accent: "#536f50", highlight: "rgba(137, 161, 121, 0.42)", highlightText: "#2c3d27", pattern: "cross-hatch", font: serif2, frame: "technical", mood: "literary", variantSeed: 4 },
      { id: "river-sketches", name: "River Sketches", description: "Flowing blue lines and open cream space for waterside sketches.", tags: ["river", "sketches"], paper: "#f7f5e9", line: "rgba(64, 126, 148, 0.18)", text: "#34464b", muted: "#708086", accent: "#43809a", highlight: "rgba(151, 199, 208, 0.4)", highlightText: "#28444b", pattern: "diagonal", font: humanist, frame: "scrapbook", mood: "playful", layout: "wide", variantSeed: 5 },
      { id: "night-garden", name: "Night Garden", description: "Moonlit leaves and pale blossoms on deep garden green.", tags: ["night", "garden"], paper: "#152622", line: "rgba(139, 197, 169, 0.14)", text: "#e6f0e9", muted: "#9db0a4", accent: "#a7d6bb", highlight: "rgba(104, 126, 84, 0.55)", highlightText: "#f4fbf6", pattern: "scallop", font: literarySerif, frame: "dark", mood: "dramatic", watermark: "\u263E", variantSeed: 6 },
      { id: "sunflower-field", name: "Sunflower Field", description: "Sunny gold and leaf green for bright outdoor memories.", tags: ["sunflower", "field"], paper: "#fff7d9", line: "rgba(81, 123, 72, 0.18)", text: "#394331", muted: "#727d68", accent: "#598047", highlight: "rgba(238, 183, 45, 0.48)", highlightText: "#443209", pattern: "ruled", font: rounded, frame: "polaroid", mood: "playful", margin: "rgba(198, 112, 48, 0.42)", variantSeed: 7 }
    ]
  },
  {
    folder: "Vintage & Editorial",
    tags: ["vintage", "editorial"],
    templates: [
      { id: "twenties-gazette", name: "1920s Gazette", description: "Newsprint ivory, condensed headlines, and bold black rules.", tags: ["1920s", "newspaper"], paper: "#e8dfc8", line: "rgba(45, 42, 36, 0.16)", text: "#292722", muted: "#68645b", accent: "#171715", highlight: "rgba(178, 159, 111, 0.4)", highlightText: "#292315", pattern: "ledger", font: serif2, headingFont: 'Impact, "Arial Narrow", sans-serif', frame: "vintage", mood: "editorial", layout: "wide", variantSeed: 0 },
      { id: "midcentury-magazine", name: "Midcentury Magazine", description: "Optimistic coral, aqua, and geometric midcentury typography.", tags: ["midcentury", "magazine"], paper: "#f3ead8", line: "rgba(49, 121, 126, 0.17)", text: "#3e3b31", muted: "#777265", accent: "#d45f45", highlight: "rgba(89, 177, 174, 0.4)", highlightText: "#243f3e", pattern: "diagonal", font: geometric, frame: "photo", mood: "editorial", variantSeed: 1 },
      { id: "victorian-correspondence", name: "Victorian Correspondence", description: "Formal cream stationery with oxblood ink and ornate restraint.", tags: ["victorian", "letter"], paper: "#eee2c5", line: "rgba(106, 73, 45, 0.17)", text: "#473424", muted: "#796550", accent: "#753f3a", highlight: "rgba(185, 141, 72, 0.35)", highlightText: "#3b2916", pattern: "ruled", font: literarySerif, frame: "vintage", mood: "literary", margin: "rgba(117, 63, 58, 0.4)", variantSeed: 2 },
      { id: "pulp-paperback", name: "Pulp Paperback", description: "Punchy scarlet and yellow inspired by dramatic paperback covers.", tags: ["pulp", "paperback"], paper: "#eee0b6", line: "rgba(77, 47, 31, 0.17)", text: "#3b2d22", muted: "#716050", accent: "#b83e2e", highlight: "rgba(230, 178, 45, 0.52)", highlightText: "#392b0b", pattern: "cross-hatch", font: serif2, headingFont: 'Impact, "Arial Black", sans-serif', frame: "vintage", mood: "dramatic", variantSeed: 3 },
      { id: "bauhaus-review", name: "Bauhaus Review", description: "Primary shapes, sharp grids, and functional geometric type.", tags: ["bauhaus", "modernism"], paper: "#f3f0e5", line: "rgba(33, 39, 45, 0.17)", major: "rgba(29, 85, 147, 0.32)", text: "#24292d", muted: "#666d72", accent: "#cf342d", highlight: "rgba(226, 185, 36, 0.48)", highlightText: "#352e09", pattern: "graph", font: geometric, frame: "technical", mood: "technical", layout: "wide", variantSeed: 4 },
      { id: "film-noir-dossier", name: "Film Noir Dossier", description: "Shadowy charcoal dossier paper with hard-boiled cream type.", tags: ["film-noir", "dossier"], paper: "#1e1e1c", line: "rgba(224, 217, 194, 0.12)", text: "#e5dfcc", muted: "#a29d90", accent: "#d2c39b", highlight: "rgba(123, 28, 28, 0.62)", highlightText: "#fff0e7", pattern: "ledger", font: mono, headingFont: 'Impact, "Arial Narrow", sans-serif', frame: "dark", mood: "dramatic", variantSeed: 5 },
      { id: "library-card", name: "Library Card", description: "Catalog-card buff with typewriter text and stamped blue details.", tags: ["library", "catalog"], paper: "#e9dfc4", line: "rgba(68, 89, 104, 0.19)", text: "#3c352a", muted: "#746c5e", accent: "#41657b", highlight: "rgba(183, 157, 93, 0.4)", highlightText: "#3c3016", pattern: "ledger", font: mono, frame: "photo", mood: "technical", layout: "compact", variantSeed: 6 },
      { id: "sunday-supplement", name: "Sunday Supplement", description: "Warm newsprint, elegant serif copy, and magazine-red accents.", tags: ["newspaper", "supplement"], paper: "#f0e8d5", line: "rgba(59, 55, 47, 0.14)", text: "#302d27", muted: "#6d685e", accent: "#a23f36", highlight: "rgba(206, 174, 107, 0.4)", highlightText: "#3c301b", pattern: "blank", font: serif2, headingFont: editorial, frame: "thin", mood: "editorial", layout: "wide", variantSeed: 7 }
    ]
  },
  {
    folder: "Dark & Neon",
    tags: ["dark", "neon"],
    templates: [
      { id: "neon-arcade", name: "Neon Arcade", description: "Hot pink and cyan lights on a black arcade grid.", tags: ["arcade", "cyber"], paper: "#101017", line: "rgba(0, 224, 239, 0.15)", major: "rgba(255, 51, 166, 0.27)", text: "#edf8f8", muted: "#91a5aa", accent: "#00e0ef", highlight: "rgba(255, 51, 166, 0.56)", highlightText: "#fff7fc", pattern: "graph", font: mono, frame: "dark", mood: "dramatic", variantSeed: 0 },
      { id: "synthwave-sunset", name: "Synthwave Sunset", description: "Purple night, laser grids, and a blazing synthwave sunset.", tags: ["synthwave", "sunset"], paper: "#1b1534", line: "rgba(74, 226, 245, 0.14)", major: "rgba(229, 69, 180, 0.28)", text: "#f0eafa", muted: "#aaa0c1", accent: "#f04bb3", highlight: "rgba(247, 139, 54, 0.58)", highlightText: "#30190a", pattern: "graph", font: geometric, frame: "dark", mood: "dramatic", watermark: "\u25E2", variantSeed: 1 },
      { id: "hacker-console", name: "Hacker Console", description: "Phosphor green terminal paper for code notes and system logs.", tags: ["terminal", "code"], paper: "#0e150f", line: "rgba(91, 245, 112, 0.16)", text: "#a0f2a9", muted: "#62996a", accent: "#61ee72", highlight: "rgba(97, 238, 114, 0.34)", highlightText: "#0b1d0d", pattern: "dot-grid", font: mono, frame: "dark", mood: "technical", variantSeed: 2 },
      { id: "ultraviolet-club", name: "Ultraviolet Club", description: "Deep violet and ultraviolet glow for bold creative notes.", tags: ["ultraviolet", "club"], paper: "#181225", line: "rgba(190, 96, 255, 0.16)", text: "#f1eafb", muted: "#ad9dbd", accent: "#c064ff", highlight: "rgba(51, 224, 226, 0.5)", highlightText: "#092e30", pattern: "hex", font: modern, headingFont: geometric, frame: "dark", mood: "dramatic", variantSeed: 3 },
      { id: "acid-lime", name: "Acid Lime", description: "Near-black paper with sharp acid-lime signals and angular structure.", tags: ["acid", "lime"], paper: "#131511", line: "rgba(190, 255, 64, 0.15)", text: "#eaf4df", muted: "#95a08d", accent: "#bfff42", highlight: "rgba(99, 72, 218, 0.58)", highlightText: "#faf8ff", pattern: "diagonal", font: mono, frame: "dark", mood: "dramatic", variantSeed: 4 },
      { id: "crimson-circuit", name: "Crimson Circuit", description: "Crimson signals and steel-gray circuitry on black technical paper.", tags: ["crimson", "circuit"], paper: "#151618", line: "rgba(207, 68, 76, 0.17)", major: "rgba(198, 207, 216, 0.23)", text: "#edf0f2", muted: "#999fa4", accent: "#e04b55", highlight: "rgba(105, 122, 142, 0.54)", highlightText: "#f4f7f9", pattern: "cross-hatch", font: technical, frame: "technical", mood: "technical", variantSeed: 5 },
      { id: "midnight-oled", name: "Midnight OLED", description: "True-black minimalism with calm ice-blue highlights.", tags: ["oled", "minimal"], paper: "#090a0c", line: "rgba(126, 167, 196, 0.13)", text: "#e9edf0", muted: "#8d969d", accent: "#7eb4d5", highlight: "rgba(62, 104, 137, 0.54)", highlightText: "#f2f8fb", pattern: "blank", font: modern, frame: "none", mood: "clean", layout: "airy", variantSeed: 6 },
      { id: "electric-aquarium", name: "Electric Aquarium", description: "Bioluminescent aqua and coral drifting through a deep ocean page.", tags: ["aquarium", "bioluminescent"], paper: "#071d28", line: "rgba(76, 218, 207, 0.15)", text: "#dcf4f2", muted: "#88aaa9", accent: "#4cdacf", highlight: "rgba(255, 103, 125, 0.52)", highlightText: "#fff7f8", pattern: "scallop", font: rounded, frame: "dark", mood: "playful", variantSeed: 7 }
    ]
  },
  {
    folder: "Fantasy & Whimsy",
    tags: ["fantasy", "whimsical"],
    templates: [
      { id: "enchanted-forest", name: "Enchanted Forest", description: "Emerald shadows and antique gold for woodland tales and quests.", tags: ["forest", "enchanted"], paper: "#1c3027", line: "rgba(185, 201, 134, 0.14)", text: "#e8eedf", muted: "#a2ae96", accent: "#c0b66f", highlight: "rgba(91, 139, 93, 0.58)", highlightText: "#f2f8ed", pattern: "cross-hatch", font: literarySerif, frame: "dark", mood: "dramatic", watermark: "\u2726", variantSeed: 0 },
      { id: "dragon-scholar", name: "Dragon Scholar", description: "Charcoal parchment and ember-red annotations from a dragon archive.", tags: ["dragon", "scholar"], paper: "#2a2420", line: "rgba(205, 164, 112, 0.14)", text: "#eee2d0", muted: "#b0a28f", accent: "#d06a48", highlight: "rgba(181, 124, 55, 0.55)", highlightText: "#25170c", pattern: "hex", font: serif2, headingFont: literarySerif, frame: "dark", mood: "dramatic", variantSeed: 1 },
      { id: "fairy-garden", name: "Fairy Garden", description: "Dewy mint and petal pink with playful garden scallops.", tags: ["fairy", "garden"], paper: "#f1faec", line: "rgba(109, 169, 113, 0.19)", text: "#3b493a", muted: "#748472", accent: "#d878a4", highlight: "rgba(179, 220, 157, 0.44)", highlightText: "#304526", pattern: "scallop", font: rounded, frame: "scrapbook", mood: "playful", watermark: "\u2727", variantSeed: 2 },
      { id: "celestial-oracle", name: "Celestial Oracle", description: "Midnight indigo, silver stars, and luminous oracle violet.", tags: ["celestial", "oracle"], paper: "#181a35", line: "rgba(179, 189, 231, 0.15)", text: "#eceefa", muted: "#a2a7c1", accent: "#b6a5ed", highlight: "rgba(79, 91, 163, 0.56)", highlightText: "#f8f7ff", pattern: "dot-grid", font: literarySerif, frame: "dark", mood: "dramatic", watermark: "\u263E", variantSeed: 3 },
      { id: "alchemist-ledger", name: "Alchemist Ledger", description: "Weathered laboratory ledger for formulas, ingredients, and discoveries.", tags: ["alchemy", "ledger"], paper: "#e6d7b5", line: "rgba(87, 72, 44, 0.18)", major: "rgba(84, 111, 79, 0.3)", text: "#453a29", muted: "#776b56", accent: "#527056", highlight: "rgba(183, 141, 67, 0.38)", highlightText: "#3c2d16", pattern: "ledger", font: technical, headingFont: literarySerif, frame: "vintage", mood: "technical", variantSeed: 4 },
      { id: "mermaid-cove", name: "Mermaid Cove", description: "Seafoam, pearl, and coral curves for stories beneath the waves.", tags: ["mermaid", "ocean"], paper: "#eaf8f5", line: "rgba(63, 153, 159, 0.18)", text: "#2f4b4c", muted: "#6c8585", accent: "#c76483", highlight: "rgba(121, 210, 197, 0.44)", highlightText: "#23433f", pattern: "scallop", font: rounded, headingFont: serif2, frame: "rounded", mood: "playful", variantSeed: 5 },
      { id: "hearthling-nook", name: "Hearthling Nook", description: "Cozy moss, honey, and fireplace warmth for homely adventures.", tags: ["cozy", "hearth"], paper: "#efe2c4", line: "rgba(93, 105, 67, 0.18)", text: "#443a28", muted: "#756b56", accent: "#9b5c35", highlight: "rgba(205, 166, 75, 0.42)", highlightText: "#3d2e12", pattern: "ruled", font: literarySerif, frame: "vintage", mood: "literary", margin: "rgba(117, 126, 75, 0.4)", variantSeed: 6 },
      { id: "storybook-castle", name: "Storybook Castle", description: "Royal blue, rose, and parchment for timeless storybook chapters.", tags: ["storybook", "castle"], paper: "#f1e8d5", line: "rgba(62, 76, 132, 0.18)", text: "#383850", muted: "#737386", accent: "#6a4e92", highlight: "rgba(207, 139, 155, 0.42)", highlightText: "#492e38", pattern: "diagonal", font: serif2, headingFont: literarySerif, frame: "polaroid", mood: "literary", watermark: "\u265C", variantSeed: 7 }
    ]
  },
  {
    folder: "Pastels",
    tags: ["pastel", "soft"],
    templates: [
      { id: "blush-milk", name: "Blush Milk", description: "Milky blush paper with soft cocoa type and rose details.", tags: ["blush", "rose"], paper: "#fff5f4", line: "rgba(187, 114, 121, 0.17)", text: "#4b3a3a", muted: "#817171", accent: "#b76e79", highlight: "rgba(239, 182, 184, 0.44)", highlightText: "#4b3033", pattern: "ruled", font: rounded, frame: "rounded", mood: "playful", variantSeed: 0 },
      { id: "lilac-cloud", name: "Lilac Cloud", description: "Airy lilac and cloud white for gentle, spacious notes.", tags: ["lilac", "cloud"], paper: "#faf7ff", line: "rgba(139, 112, 183, 0.18)", text: "#453d50", muted: "#7d7488", accent: "#846bb0", highlight: "rgba(205, 189, 232, 0.48)", highlightText: "#3c3150", pattern: "blank", font: modern, frame: "none", mood: "clean", layout: "airy", variantSeed: 1 },
      { id: "pistachio-cream", name: "Pistachio Cream", description: "Pale pistachio dots and cream highlights for fresh planning.", tags: ["pistachio", "cream"], paper: "#f5f8e9", line: "rgba(119, 151, 91, 0.19)", text: "#3d4937", muted: "#75816f", accent: "#78965f", highlight: "rgba(207, 220, 157, 0.46)", highlightText: "#354121", pattern: "dot-grid", font: rounded, frame: "rounded", mood: "playful", variantSeed: 2 },
      { id: "peach-sorbet", name: "Peach Sorbet", description: "Juicy peach, vanilla, and coral for bright daily pages.", tags: ["peach", "sorbet"], paper: "#fff3e7", line: "rgba(212, 129, 97, 0.18)", text: "#4a3c36", muted: "#7d706a", accent: "#d87a61", highlight: "rgba(249, 190, 125, 0.46)", highlightText: "#4a2f1c", pattern: "scallop", font: rounded, frame: "polaroid", mood: "playful", variantSeed: 3 },
      { id: "baby-blue", name: "Baby Blue", description: "Clean baby-blue ruling with soft navy typography.", tags: ["blue", "calm"], paper: "#f0f8fc", line: "rgba(94, 156, 190, 0.2)", text: "#344957", muted: "#728591", accent: "#6296b2", highlight: "rgba(180, 218, 235, 0.48)", highlightText: "#2c4856", pattern: "ruled", font: humanist, frame: "photo", mood: "clean", margin: "rgba(220, 142, 151, 0.36)", variantSeed: 4 },
      { id: "buttercup-paper", name: "Buttercup Paper", description: "Creamy yellow paper with warm honey and soft gray details.", tags: ["buttercup", "yellow"], paper: "#fff9df", line: "rgba(158, 139, 73, 0.18)", text: "#494432", muted: "#7d7867", accent: "#a88735", highlight: "rgba(241, 210, 101, 0.48)", highlightText: "#42370e", pattern: "cross-hatch", font: serif2, frame: "rounded", mood: "literary", variantSeed: 5 },
      { id: "mint-macaron", name: "Mint Macaron", description: "Confectionery mint with cocoa type and a crisp dotted rhythm.", tags: ["mint", "macaron"], paper: "#effaf5", line: "rgba(78, 158, 129, 0.18)", text: "#374a42", muted: "#70847b", accent: "#5a9d84", highlight: "rgba(181, 226, 207, 0.48)", highlightText: "#2c4a3e", pattern: "dot-grid", font: rounded, frame: "rounded", mood: "playful", variantSeed: 6 },
      { id: "cotton-candy-sky", name: "Cotton Candy Sky", description: "Dreamy pink and blue diagonals inspired by a pastel sunset.", tags: ["cotton-candy", "sky"], paper: "#fff5fb", line: "rgba(109, 160, 207, 0.18)", text: "#443c4c", muted: "#7b7383", accent: "#9a79b6", highlight: "rgba(244, 174, 203, 0.46)", highlightText: "#4b3040", pattern: "diagonal", font: rounded, frame: "polaroid", mood: "playful", watermark: "\u2601", variantSeed: 7 }
    ]
  }
];
var PACK_NAMES = PACKS.map((pack) => pack.folder);
var PACKED_BUILT_IN_TEMPLATES = PACKS.flatMap(
  (pack) => pack.templates.map((seed) => createPackedTemplate(pack, seed))
);

// ../src/templates/builtins.ts
function builtIn(id, name, description, configure) {
  const template = clone(DEFAULT_TEMPLATE);
  template.id = id;
  template.name = name;
  template.builtIn = true;
  template.metadata = {
    author: "Templar",
    description,
    folder: "Essentials",
    tags: []
  };
  configure(template);
  if (template.headings.h4.font === DEFAULT_TEMPLATE.headings.h4.font) {
    template.headings.h4.font = template.headings.h3.font;
  }
  if (template.headings.h4.color === DEFAULT_TEMPLATE.headings.h4.color) {
    template.headings.h4.color = template.headings.h3.color;
  }
  if (template.headings.h5.font === DEFAULT_TEMPLATE.headings.h5.font) {
    template.headings.h5.font = template.headings.h4.font;
  }
  if (template.headings.h5.color === DEFAULT_TEMPLATE.headings.h5.color) {
    template.headings.h5.color = template.headings.h4.color;
  }
  if (template.headings.h6.font === DEFAULT_TEMPLATE.headings.h6.font) {
    template.headings.h6.font = template.headings.h4.font;
  }
  if (template.headings.h6.color === DEFAULT_TEMPLATE.headings.h6.color) {
    template.headings.h6.color = template.headings.h4.color;
  }
  if (template.blocks.quoteTextColor === DEFAULT_TEMPLATE.blocks.quoteTextColor) {
    template.blocks.quoteTextColor = template.typography.textColor;
  }
  if (template.blocks.codeTextColor === DEFAULT_TEMPLATE.blocks.codeTextColor) {
    template.blocks.codeTextColor = template.typography.textColor;
  }
  return template;
}
var CORE_BUILT_IN_TEMPLATES = [
  builtIn(
    "classic-ruled",
    "Classic Ruled",
    "Warm ruled paper with a measured baseline, red margin, and Polaroid photographs.",
    (template) => {
      template.metadata.tags = ["journal", "ruled", "warm"];
      template.paper.pattern = "ruled";
      template.paper.marginLine = true;
      template.paper.color = "#fffdf4";
      template.paper.patternColor = "rgba(107, 155, 190, 0.43)";
      template.paper.marginColor = "rgba(210, 92, 92, 0.62)";
      template.baseline.mode = "strict";
      template.typography.bodyFont = 'Georgia, "Times New Roman", serif';
      template.typography.bodySize = 18;
      template.blocks.highlightBackground = "rgba(244, 210, 83, 0.48)";
      template.blocks.highlightTextColor = "#302e2b";
      template.images.frame = "polaroid";
      template.images.borderWidth = 10;
      template.images.bottomBorderWidth = 34;
      template.images.rotation = -1.2;
      template.images.shadow = "0 8px 20px rgba(69, 58, 42, 0.18)";
      template.css = `.page h1 {
  letter-spacing: -0.025em;
}

.page blockquote {
  font-style: italic;
}`;
    }
  ),
  builtIn(
    "vintage-journal",
    "Vintage Journal",
    "Aged cream stock, bookish type, and softly weathered scrapbook imagery.",
    (template) => {
      template.metadata.tags = ["journal", "vintage", "scrapbook"];
      template.paper.color = "#eee0bf";
      template.paper.pattern = "ruled";
      template.paper.patternColor = "rgba(108, 83, 53, 0.16)";
      template.baseline.mode = "balanced";
      template.typography.bodyFont = '"Iowan Old Style", Baskerville, Georgia, serif';
      template.typography.textColor = "#4b3928";
      template.typography.mutedColor = "#7a654e";
      template.headings.h1.color = "#6f382c";
      template.headings.h2.color = "#744c31";
      template.images.frame = "vintage";
      template.images.borderWidth = 8;
      template.images.borderColor = "#f5ead1";
      template.images.rotation = 0.7;
      template.images.shadow = "0 7px 18px rgba(68, 43, 23, 0.25)";
      template.images.sepia = 0.18;
      template.blocks.linkColor = "#84512f";
      template.blocks.highlightBackground = "rgba(190, 137, 57, 0.32)";
      template.blocks.highlightTextColor = "#4b3928";
      template.blocks.dividerStyle = "fade";
      template.blocks.dividerColor = "rgba(111, 56, 44, 0.65)";
      template.blocks.dividerWidth = 1;
      template.css = `.page-content {
  background-image: radial-gradient(circle at 12% 4%, rgba(111, 70, 31, 0.06), transparent 24%);
}`;
    }
  ),
  builtIn(
    "minimal-journal",
    "Minimal Journal",
    "Generous margins and clean editorial typography on a quiet white page.",
    (template) => {
      template.metadata.tags = ["minimal", "editorial", "clean"];
      template.paper.color = "#fcfcfb";
      template.paper.pattern = "blank";
      template.baseline.enabled = false;
      template.baseline.mode = "free";
      template.typography.bodyFont = "Inter, system-ui, -apple-system, sans-serif";
      template.typography.bodySize = 17;
      template.typography.textColor = "#222426";
      template.headings.h1.font = "Inter, system-ui, -apple-system, sans-serif";
      template.headings.h2.font = template.headings.h1.font;
      template.headings.h3.font = template.headings.h1.font;
      template.headings.h1.weight = 620;
      template.blocks.highlightBackground = "rgba(255, 224, 92, 0.42)";
      template.blocks.highlightTextColor = "#222426";
      template.layout.maxWidth = 720;
      template.layout.paddingLeft = 84;
      template.layout.paddingRight = 84;
      template.images.frame = "rounded";
      template.images.cornerRadius = 12;
      template.images.shadow = "0 12px 36px rgba(28, 30, 32, 0.12)";
      template.css = `.page h1 {
  letter-spacing: -0.04em;
}

.page p {
  letter-spacing: 0.005em;
}`;
    }
  ),
  builtIn(
    "dot-grid",
    "Dot Grid",
    "A bullet-journal surface with crisp dots, structured headings, and clear checkboxes.",
    (template) => {
      template.metadata.tags = ["bullet-journal", "dots", "planning"];
      template.paper.color = "#fbfaf5";
      template.paper.pattern = "dot-grid";
      template.paper.patternColor = "rgba(78, 91, 99, 0.25)";
      template.baseline.mode = "balanced";
      template.baseline.unit = 28;
      template.typography.bodyFont = "Inter, system-ui, -apple-system, sans-serif";
      template.typography.bodySize = 16;
      template.headings.h1.font = template.typography.bodyFont;
      template.headings.h2.font = template.typography.bodyFont;
      template.headings.h3.font = template.typography.bodyFont;
      template.headings.h1.decoration = "highlight";
      template.blocks.highlightBackground = "rgba(151, 191, 157, 0.42)";
      template.blocks.highlightTextColor = "#26352b";
      template.blocks.checkboxAccent = "#4f785f";
      template.images.frame = "thin";
      template.images.borderWidth = 1;
      template.images.borderColor = "#9da8a1";
      template.css = `.page input[type="checkbox"] {
  border-radius: 2px;
}

.page h2 {
  text-transform: uppercase;
  letter-spacing: 0.08em;
}`;
    }
  ),
  builtIn(
    "graph-paper",
    "Graph Paper",
    "Minor and major graph lines with technical typography for diagrams and engineering notes.",
    (template) => {
      template.metadata.tags = ["technical", "graph", "engineering"];
      template.paper.color = "#f8fbf8";
      template.paper.pattern = "graph";
      template.paper.patternColor = "rgba(71, 138, 121, 0.18)";
      template.paper.majorPatternColor = "rgba(53, 114, 103, 0.30)";
      template.baseline.mode = "balanced";
      template.baseline.unit = 24;
      template.typography.bodyFont = '"IBM Plex Mono", "Courier New", monospace';
      template.typography.bodySize = 15;
      template.typography.textColor = "#1f3935";
      template.headings.h1.font = template.typography.bodyFont;
      template.headings.h2.font = template.typography.bodyFont;
      template.headings.h3.font = template.typography.bodyFont;
      template.headings.h1.color = "#155c52";
      template.images.frame = "technical";
      template.images.borderWidth = 2;
      template.images.borderColor = "#4d7771";
      template.images.cornerRadius = 2;
      template.blocks.linkColor = "#126d75";
      template.blocks.highlightBackground = "rgba(118, 196, 177, 0.34)";
      template.blocks.highlightTextColor = "#16342f";
      template.css = `.page h1,
.page h2,
.page h3 {
  text-transform: uppercase;
  letter-spacing: 0.045em;
}

.page table {
  background: rgba(248, 251, 248, 0.86);
}`;
    }
  ),
  builtIn(
    "sketchbook",
    "Sketchbook",
    "Warm blank stock, an open composition, and gently rotated creative work.",
    (template) => {
      template.metadata.tags = ["sketchbook", "creative", "blank"];
      template.paper.color = "#f5f0df";
      template.paper.pattern = "blank";
      template.baseline.enabled = false;
      template.baseline.mode = "free";
      template.typography.bodyFont = '"Avenir Next", Avenir, system-ui, sans-serif';
      template.typography.textColor = "#37342f";
      template.blocks.highlightBackground = "rgba(230, 190, 92, 0.40)";
      template.blocks.highlightTextColor = "#37342f";
      template.layout.maxWidth = 980;
      template.layout.paddingLeft = 72;
      template.layout.paddingRight = 72;
      template.images.frame = "scrapbook";
      template.images.borderWidth = 8;
      template.images.borderColor = "#fffdf6";
      template.images.rotation = -1.8;
      template.images.shadow = "3px 7px 18px rgba(55, 48, 37, 0.18)";
      template.css = `.page blockquote {
  border: 0;
  padding-left: 0;
  font-size: 1.15em;
}

.page hr {
  width: 28%;
  margin-inline: 0;
}`;
    }
  ),
  builtIn(
    "legal-pad",
    "Legal Pad",
    "Yellow ruled paper with a strong red margin and strict writing rhythm.",
    (template) => {
      template.metadata.tags = ["legal-pad", "ruled", "writing"];
      template.paper.color = "#fff4a8";
      template.paper.pattern = "ruled";
      template.paper.patternColor = "rgba(75, 128, 177, 0.43)";
      template.paper.marginLine = true;
      template.paper.marginColor = "rgba(211, 74, 69, 0.72)";
      template.baseline.mode = "strict";
      template.baseline.unit = 30;
      template.typography.bodyFont = '"Avenir Next", Avenir, system-ui, sans-serif';
      template.typography.bodySize = 17;
      template.typography.textColor = "#292b2a";
      template.blocks.highlightBackground = "rgba(244, 175, 66, 0.42)";
      template.blocks.highlightTextColor = "#292b2a";
      template.layout.paddingLeft = 104;
      template.images.frame = "photo";
      template.images.borderWidth = 6;
      template.images.borderColor = "#fffbe1";
      template.css = `.page h1 {
  text-transform: uppercase;
  letter-spacing: 0.035em;
}`;
    }
  ),
  builtIn(
    "dark-academia",
    "Dark Academia",
    "Ink-dark paper, cream text, muted gold details, and vintage photographic treatment.",
    (template) => {
      template.metadata.tags = ["dark", "academic", "vintage"];
      template.paper.color = "#201d1b";
      template.paper.pattern = "ruled";
      template.paper.patternColor = "rgba(214, 191, 143, 0.12)";
      template.baseline.mode = "balanced";
      template.typography.bodyFont = "Baskerville, Georgia, serif";
      template.typography.textColor = "#e9dfc9";
      template.typography.mutedColor = "#b4a78e";
      template.headings.h1.color = "#d7bd79";
      template.headings.h2.color = "#cdb77f";
      template.headings.h3.color = "#c3b390";
      template.images.frame = "dark";
      template.images.borderWidth = 8;
      template.images.borderColor = "#332d28";
      template.images.sepia = 0.22;
      template.images.contrast = 1.08;
      template.images.shadow = "0 10px 26px rgba(0, 0, 0, 0.45)";
      template.blocks.linkColor = "#d0b76f";
      template.blocks.highlightBackground = "rgba(184, 143, 64, 0.58)";
      template.blocks.highlightTextColor = "#201d1b";
      template.blocks.quoteAccent = "#8c7646";
      template.blocks.quoteBackground = "rgba(215, 189, 121, 0.07)";
      template.blocks.codeBackground = "rgba(0, 0, 0, 0.28)";
      template.blocks.tableBorder = "rgba(215, 189, 121, 0.25)";
      template.blocks.checkboxAccent = "#b89952";
      template.css = `.page h1 {
  letter-spacing: 0.02em;
}

.page hr {
  border-color: rgba(215, 189, 121, 0.4);
}`;
    }
  )
];
function aesthetic(id, name, description, preset) {
  return builtIn(id, name, description, (template) => {
    template.metadata.tags = preset.tags;
    template.paper.pattern = preset.pattern;
    template.paper.color = preset.paper;
    template.paper.patternColor = preset.line;
    template.paper.majorPatternColor = preset.major ?? preset.line;
    template.paper.marginLine = preset.margin !== void 0;
    template.paper.marginColor = preset.margin ?? preset.accent;
    template.baseline.enabled = preset.mode !== "free";
    template.baseline.mode = preset.mode ?? "balanced";
    template.baseline.unit = preset.unit ?? 28;
    template.typography.bodyFont = preset.font;
    template.typography.textColor = preset.text;
    template.typography.mutedColor = preset.muted;
    for (const level of ["h1", "h2", "h3", "h4"]) {
      const heading = template.headings[level];
      heading.font = preset.headingFont ?? preset.font;
      heading.color = preset.accent;
    }
    template.blocks.linkColor = preset.accent;
    template.blocks.highlightBackground = preset.highlight;
    template.blocks.highlightTextColor = preset.highlightText;
    template.blocks.quoteAccent = preset.accent;
    template.blocks.quoteBackground = preset.quote ?? "transparent";
    template.blocks.quoteTextColor = preset.text;
    template.blocks.codeBackground = preset.code ?? "rgba(0, 0, 0, 0.08)";
    template.blocks.codeTextColor = preset.text;
    template.blocks.tableBorder = preset.line;
    template.blocks.tableHeaderBackground = preset.quote ?? preset.highlight;
    template.blocks.checkboxAccent = preset.accent;
    template.images.frame = preset.frame ?? "thin";
    template.images.borderColor = preset.accent;
    template.images.borderWidth = template.images.frame === "none" ? 0 : 2;
    template.layout.pageRadius = preset.radius ?? 0;
    template.css = preset.css ?? "";
  });
}
var EXPANDED_BUILT_IN_TEMPLATES = [
  aesthetic("botanical-field-notes", "Botanical Field Notes", "Pressed-leaf greens and warm field-journal ruling.", {
    tags: ["botanical", "field-notes", "green"],
    pattern: "ruled",
    paper: "#f3f0d8",
    line: "rgba(72, 116, 76, 0.24)",
    text: "#334336",
    muted: "#6d7868",
    accent: "#3f704d",
    highlight: "rgba(142, 181, 117, 0.38)",
    highlightText: "#26372b",
    font: 'Georgia, "Times New Roman", serif',
    unit: 30,
    margin: "rgba(155, 92, 65, 0.42)",
    frame: "vintage",
    quote: "rgba(74, 112, 73, 0.09)",
    css: ".page h1 { letter-spacing: 0.01em; }"
  }),
  aesthetic("midnight-blueprint", "Midnight Blueprint", "Deep navy drafting paper with cyan engineering lines.", {
    tags: ["blueprint", "dark", "technical"],
    pattern: "graph",
    paper: "#10283a",
    line: "rgba(94, 194, 215, 0.22)",
    major: "rgba(108, 215, 232, 0.42)",
    text: "#d9eef1",
    muted: "#8fb1b9",
    accent: "#72d5e4",
    highlight: "rgba(77, 199, 218, 0.34)",
    highlightText: "#071c29",
    font: '"IBM Plex Mono", "Courier New", monospace',
    unit: 24,
    frame: "technical",
    code: "rgba(0, 0, 0, 0.28)",
    quote: "rgba(85, 201, 220, 0.08)",
    css: ".page h1, .page h2 { text-transform: uppercase; letter-spacing: 0.08em; }"
  }),
  aesthetic("sakura-study", "Sakura Study", "Soft blush dot paper with ink and cherry-blossom accents.", {
    tags: ["sakura", "pastel", "study"],
    pattern: "dot-grid",
    paper: "#fff7f7",
    line: "rgba(190, 109, 130, 0.24)",
    text: "#4c343b",
    muted: "#8b6872",
    accent: "#b85f7a",
    highlight: "rgba(244, 172, 191, 0.42)",
    highlightText: "#4c2834",
    font: '"Avenir Next", Avenir, system-ui, sans-serif',
    unit: 28,
    frame: "rounded",
    quote: "rgba(226, 123, 153, 0.08)",
    radius: 12
  }),
  aesthetic("solarized-lab", "Solarized Lab", "Scientific graph paper inspired by the Solarized palette.", {
    tags: ["solarized", "lab", "graph"],
    pattern: "graph",
    paper: "#fdf6e3",
    line: "rgba(38, 139, 210, 0.18)",
    major: "rgba(38, 139, 210, 0.34)",
    text: "#586e75",
    muted: "#839496",
    accent: "#268bd2",
    highlight: "rgba(181, 137, 0, 0.28)",
    highlightText: "#3d453f",
    font: '"IBM Plex Sans", system-ui, sans-serif',
    headingFont: '"IBM Plex Mono", monospace',
    unit: 26,
    frame: "technical",
    quote: "rgba(42, 161, 152, 0.08)"
  }),
  aesthetic("nordic-snow", "Nordic Snow", "Airy Scandinavian minimalism with cool gray-blue accents.", {
    tags: ["nordic", "minimal", "clean"],
    pattern: "blank",
    paper: "#f7f9fa",
    line: "#d8e0e5",
    text: "#263238",
    muted: "#718087",
    accent: "#527a8a",
    highlight: "rgba(156, 197, 214, 0.36)",
    highlightText: "#20343c",
    font: "Inter, system-ui, sans-serif",
    mode: "free",
    frame: "rounded",
    quote: "rgba(82, 122, 138, 0.07)",
    radius: 16,
    css: ".page h1 { letter-spacing: -0.04em; }"
  }),
  aesthetic("cyber-neon", "Cyber Neon", "Black graph stock with electric magenta and cyan signals.", {
    tags: ["cyberpunk", "neon", "dark"],
    pattern: "graph",
    paper: "#101014",
    line: "rgba(0, 229, 255, 0.14)",
    major: "rgba(255, 45, 170, 0.26)",
    text: "#e9f7f8",
    muted: "#889ca2",
    accent: "#00e5ff",
    highlight: "rgba(255, 45, 170, 0.55)",
    highlightText: "#fff7fc",
    font: '"SFMono-Regular", Consolas, monospace',
    unit: 24,
    frame: "dark",
    code: "rgba(0, 229, 255, 0.08)",
    quote: "rgba(255, 45, 170, 0.08)",
    css: ".page h1 { color: #ff2daa; text-shadow: 0 0 8px rgba(255, 45, 170, 0.35); }"
  }),
  aesthetic("lavender-letters", "Lavender Letters", "Gentle lavender ruling and literary serif typography.", {
    tags: ["lavender", "letters", "soft"],
    pattern: "ruled",
    paper: "#fbf8ff",
    line: "rgba(129, 103, 174, 0.22)",
    text: "#433a50",
    muted: "#7c7088",
    accent: "#7358a4",
    highlight: "rgba(195, 172, 232, 0.44)",
    highlightText: "#382d48",
    font: "Baskerville, Georgia, serif",
    unit: 30,
    margin: "rgba(190, 111, 148, 0.38)",
    frame: "photo",
    quote: "rgba(115, 88, 164, 0.07)"
  }),
  aesthetic("ocean-log", "Ocean Log", "Sea-glass ruled paper for travel logs and reflective writing.", {
    tags: ["ocean", "travel", "ruled"],
    pattern: "ruled",
    paper: "#eef9f7",
    line: "rgba(49, 133, 145, 0.25)",
    text: "#24454a",
    muted: "#648086",
    accent: "#237f91",
    highlight: "rgba(95, 192, 185, 0.38)",
    highlightText: "#18383c",
    font: '"Avenir Next", Avenir, sans-serif',
    unit: 29,
    margin: "rgba(225, 119, 91, 0.42)",
    frame: "rounded",
    quote: "rgba(35, 127, 145, 0.08)"
  }),
  aesthetic("desert-explorer", "Desert Explorer", "Sand-toned dot grid with canyon and turquoise accents.", {
    tags: ["desert", "travel", "dots"],
    pattern: "dot-grid",
    paper: "#f6ecd5",
    line: "rgba(139, 92, 50, 0.25)",
    text: "#4d3929",
    muted: "#806b56",
    accent: "#2f7f78",
    highlight: "rgba(222, 155, 82, 0.42)",
    highlightText: "#49301f",
    font: "Georgia, serif",
    unit: 28,
    frame: "scrapbook",
    quote: "rgba(47, 127, 120, 0.08)"
  }),
  aesthetic("cafe-manuscript", "Caf\xE9 Manuscript", "Coffee-stained manuscript paper with warm espresso ink.", {
    tags: ["cafe", "manuscript", "warm"],
    pattern: "ruled",
    paper: "#efe1c8",
    line: "rgba(106, 70, 45, 0.18)",
    text: "#4c3325",
    muted: "#7e6452",
    accent: "#8b4d35",
    highlight: "rgba(196, 139, 73, 0.36)",
    highlightText: "#402a20",
    font: '"Iowan Old Style", Georgia, serif',
    unit: 30,
    frame: "vintage",
    quote: "rgba(105, 63, 40, 0.08)",
    css: ".page blockquote { font-style: italic; }"
  }),
  aesthetic("art-deco-ledger", "Art Deco Ledger", "Ivory graph stock with geometric black and gold detailing.", {
    tags: ["art-deco", "ledger", "gold"],
    pattern: "graph",
    paper: "#fbf6e8",
    line: "rgba(32, 31, 29, 0.13)",
    major: "rgba(171, 129, 43, 0.36)",
    text: "#272521",
    muted: "#746c5c",
    accent: "#9c7223",
    highlight: "rgba(213, 177, 91, 0.42)",
    highlightText: "#292216",
    font: 'Futura, "Avenir Next", sans-serif',
    unit: 26,
    frame: "thin",
    quote: "rgba(156, 114, 35, 0.08)",
    css: ".page h1 { text-transform: uppercase; letter-spacing: 0.12em; }"
  }),
  aesthetic("cottage-recipe", "Cottage Recipe", "Cream kitchen notebook paper with berry-red details.", {
    tags: ["cottage", "recipe", "cozy"],
    pattern: "ruled",
    paper: "#fff9e9",
    line: "rgba(126, 151, 111, 0.22)",
    text: "#443c31",
    muted: "#7b7162",
    accent: "#a64f4b",
    highlight: "rgba(237, 196, 108, 0.42)",
    highlightText: "#3d3429",
    font: "Georgia, serif",
    unit: 30,
    margin: "rgba(166, 79, 75, 0.55)",
    frame: "photo",
    quote: "rgba(126, 151, 111, 0.10)"
  }),
  aesthetic("monochrome-zine", "Monochrome Zine", "High-contrast editorial black and white for bold notes.", {
    tags: ["zine", "monochrome", "editorial"],
    pattern: "blank",
    paper: "#fafafa",
    line: "#c8c8c8",
    text: "#111111",
    muted: "#666666",
    accent: "#111111",
    highlight: "#d8d8d8",
    highlightText: "#000000",
    font: "Helvetica, Arial, sans-serif",
    headingFont: 'Impact, "Arial Black", sans-serif',
    mode: "free",
    frame: "thin",
    quote: "#eeeeee",
    css: ".page h1 { text-transform: uppercase; letter-spacing: -0.02em; }"
  }),
  aesthetic("forest-ranger", "Forest Ranger", "Dark evergreen field ruling with trail-map orange accents.", {
    tags: ["forest", "outdoors", "field"],
    pattern: "ruled",
    paper: "#e9efe2",
    line: "rgba(53, 91, 60, 0.24)",
    text: "#2e4031",
    muted: "#637166",
    accent: "#b35f32",
    highlight: "rgba(146, 177, 100, 0.42)",
    highlightText: "#273529",
    font: '"Avenir Next", sans-serif',
    headingFont: "Rockwell, Georgia, serif",
    unit: 29,
    margin: "rgba(179, 95, 50, 0.5)",
    frame: "technical",
    quote: "rgba(53, 91, 60, 0.08)"
  }),
  aesthetic("candy-pop", "Candy Pop", "Playful pastel dot paper with bright candy-color accents.", {
    tags: ["candy", "playful", "pastel"],
    pattern: "dot-grid",
    paper: "#fff8fb",
    line: "rgba(79, 177, 202, 0.24)",
    text: "#3f3541",
    muted: "#7d7080",
    accent: "#ed4f9a",
    highlight: "rgba(255, 210, 73, 0.55)",
    highlightText: "#40331a",
    font: 'Nunito, "Avenir Next", sans-serif',
    unit: 28,
    frame: "rounded",
    quote: "rgba(237, 79, 154, 0.08)",
    radius: 18,
    css: ".page h1 { letter-spacing: -0.035em; }"
  }),
  aesthetic("museum-catalog", "Museum Catalog", "Restrained gallery typography and warm archival white.", {
    tags: ["museum", "catalog", "editorial"],
    pattern: "blank",
    paper: "#f7f4ed",
    line: "#d1cbc0",
    text: "#25231f",
    muted: "#777168",
    accent: "#6d4935",
    highlight: "rgba(190, 166, 118, 0.32)",
    highlightText: "#30291f",
    font: '"Helvetica Neue", Arial, sans-serif',
    headingFont: "Baskerville, Georgia, serif",
    mode: "free",
    frame: "thin",
    quote: "rgba(109, 73, 53, 0.06)",
    css: ".page h1 { font-weight: 500; letter-spacing: 0.015em; }"
  }),
  aesthetic("lunar-research", "Lunar Research", "Moonlit graph paper for observations and technical logs.", {
    tags: ["lunar", "science", "dark"],
    pattern: "graph",
    paper: "#181b25",
    line: "rgba(153, 171, 205, 0.14)",
    major: "rgba(192, 205, 231, 0.26)",
    text: "#e0e5ef",
    muted: "#929bae",
    accent: "#b9c8ee",
    highlight: "rgba(112, 130, 182, 0.48)",
    highlightText: "#f3f6ff",
    font: '"IBM Plex Mono", monospace',
    unit: 24,
    frame: "dark",
    code: "rgba(0, 0, 0, 0.28)",
    quote: "rgba(185, 200, 238, 0.07)"
  }),
  aesthetic("coral-classroom", "Coral Classroom", "Friendly ruled study paper with coral and blue accents.", {
    tags: ["classroom", "study", "coral"],
    pattern: "ruled",
    paper: "#fffaf4",
    line: "rgba(91, 148, 184, 0.26)",
    text: "#35424a",
    muted: "#738087",
    accent: "#df6b62",
    highlight: "rgba(255, 201, 93, 0.46)",
    highlightText: "#3e3523",
    font: '"Avenir Next", system-ui, sans-serif',
    unit: 30,
    margin: "rgba(223, 107, 98, 0.56)",
    frame: "rounded",
    quote: "rgba(91, 148, 184, 0.08)"
  }),
  aesthetic("zen-ink", "Zen Ink", "Quiet rice-paper minimalism with charcoal brush accents.", {
    tags: ["zen", "ink", "minimal"],
    pattern: "blank",
    paper: "#f4f1e8",
    line: "#c9c3b5",
    text: "#292824",
    muted: "#77736a",
    accent: "#3e3d38",
    highlight: "rgba(169, 157, 126, 0.34)",
    highlightText: "#26251f",
    font: '"Hiragino Mincho ProN", "Yu Mincho", Georgia, serif',
    mode: "free",
    frame: "none",
    quote: "rgba(62, 61, 56, 0.06)",
    css: ".page blockquote { border-inline-start-width: 1px; }"
  }),
  aesthetic("retro-terminal", "Retro Terminal", "Phosphor-green terminal grid on near-black glass.", {
    tags: ["terminal", "retro", "dark"],
    pattern: "dot-grid",
    paper: "#101510",
    line: "rgba(87, 255, 116, 0.20)",
    text: "#9ff5a7",
    muted: "#5e9b68",
    accent: "#63ff7b",
    highlight: "rgba(99, 255, 123, 0.36)",
    highlightText: "#071108",
    font: '"SFMono-Regular", Consolas, monospace',
    unit: 24,
    frame: "dark",
    code: "rgba(99, 255, 123, 0.07)",
    quote: "rgba(99, 255, 123, 0.06)",
    css: ".page h1, .page h2 { text-transform: uppercase; text-shadow: 0 0 6px rgba(99, 255, 123, 0.3); }"
  })
];
var EXISTING_TEMPLATE_FOLDERS = {
  "classic-ruled": "Essentials",
  "vintage-journal": "Vintage & Editorial",
  "minimal-journal": "Essentials",
  "dot-grid": "Essentials",
  "graph-paper": "Academia",
  sketchbook: "Journaling & Wellness",
  "legal-pad": "Professional",
  "dark-academia": "Academia",
  "botanical-field-notes": "Nature",
  "midnight-blueprint": "Professional",
  "sakura-study": "Pastels",
  "solarized-lab": "Academia",
  "nordic-snow": "Color Stories",
  "cyber-neon": "Dark & Neon",
  "lavender-letters": "Pastels",
  "ocean-log": "Travel",
  "desert-explorer": "Travel",
  "cafe-manuscript": "Vintage & Editorial",
  "art-deco-ledger": "Vintage & Editorial",
  "cottage-recipe": "Celebrations & Occasions",
  "monochrome-zine": "Vintage & Editorial",
  "forest-ranger": "Nature",
  "candy-pop": "Pastels",
  "museum-catalog": "Vintage & Editorial",
  "lunar-research": "Dark & Neon",
  "coral-classroom": "Academia",
  "zen-ink": "Journaling & Wellness",
  "retro-terminal": "Dark & Neon"
};
for (const template of [...CORE_BUILT_IN_TEMPLATES, ...EXPANDED_BUILT_IN_TEMPLATES]) {
  Object.assign(template.metadata, {
    folder: EXISTING_TEMPLATE_FOLDERS[template.id] ?? "Essentials"
  });
  ensureReadableTemplate(template);
}
var BUILT_IN_TEMPLATES = [
  ...CORE_BUILT_IN_TEMPLATES,
  ...EXPANDED_BUILT_IN_TEMPLATES,
  ...PACKED_BUILT_IN_TEMPLATES
];

// scripts/vendor/style-library-entry.ts
var STYLE_LIBRARY = BUILT_IN_TEMPLATES;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  STYLE_LIBRARY
});
