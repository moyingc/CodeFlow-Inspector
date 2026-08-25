type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
type TauriWindow = Window & {
  __TAURI__?: { invoke?: TauriInvoke; core?: { invoke?: TauriInvoke } };
  __TAURI_INTERNALS__?: { invoke?: TauriInvoke };
};

const PAGE_WIDTH = 1240;
const PAGE_HEIGHT = 1754;
const MARGIN = 92;

type ReportBlockKind = "section" | "subsection" | "paragraph" | "bullet" | "note" | "metric" | "code";
type ReportBlock = { kind: ReportBlockKind; text: string };
type StructuredReport = { title: string; subtitle: string; description: string; blocks: ReportBlock[]; sections: string[] };

export async function exportElementAsLocalPdf(element: HTMLElement, fileName: string) {
  const report = collectStructuredReport(element);
  const pages = renderReportPages(report);
  const pdf = buildImagePdf(pages);
  const safeName = `${sanitizeFileName(fileName)}.pdf`;
  const invoke = nativeInvoke();
  if (invoke) {
    const path = await invoke<string>("codeflow_save_report_pdf", { fileName: safeName, bytes: Array.from(pdf) });
    return `${path} · ${pages.length} 页`;
  }
  const blob = new Blob([pdf.buffer as ArrayBuffer], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = safeName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  return `${safeName} · ${pages.length} 页`;
}

function collectStructuredReport(element: HTMLElement): StructuredReport {
  const snapshot = element.cloneNode(true) as HTMLElement;
  snapshot.querySelectorAll("button, input, select, textarea, nav, [data-pdf-exclude='true']").forEach((node) => node.remove());
  snapshot.querySelectorAll("details").forEach((details) => details.setAttribute("open", ""));
  const title = cleanText(snapshot.querySelector("h2")?.textContent) || "CodeFlow Analysis Report";
  const subtitle = cleanText(snapshot.querySelector(".panel-heading span")?.textContent);
  const english = document.documentElement.lang.toLowerCase().startsWith("en");
  const description = english
    ? "This report is generated locally from the imported project's parser, rule, runtime, experiment, and verification evidence. Unverified findings remain leads rather than confirmed defects."
    : "本报告在本机根据当前导入项目的解析、规则、运行、实验与验证证据生成。未验证的发现只作为待核实线索，不视为已经确认的缺陷。";
  const blocks: ReportBlock[] = [];

  snapshot.querySelectorAll<HTMLElement>(".report-section").forEach((section) => {
    const heading = cleanText(section.querySelector("h3")?.textContent);
    const context = cleanText(section.querySelector(".software-subheading span")?.textContent);
    if (heading) blocks.push({ kind: "section", text: context ? `${heading} · ${context}` : heading });
    collectReportChildren(section, blocks);
  });

  return {
    title,
    subtitle,
    description,
    blocks,
    sections: blocks.filter((block) => block.kind === "section").map((block) => block.text.split(" · ")[0]),
  };
}

function collectReportChildren(root: HTMLElement, blocks: ReportBlock[]) {
  const walk = (element: Element) => {
    if (element.matches(".software-subheading, .panel-heading")) return;
    const text = cleanText(element.textContent);
    if (!text) return;
    if (element.matches("h4, h5, summary")) {
      blocks.push({ kind: "subsection", text });
      return;
    }
    if (element.matches("p")) {
      blocks.push({ kind: "paragraph", text });
      return;
    }
    if (element.matches("li")) {
      blocks.push({ kind: "bullet", text });
      return;
    }
    if (element.matches("pre, code")) {
      blocks.push({ kind: "code", text });
      return;
    }
    if (element.matches("small")) {
      blocks.push({ kind: "note", text });
      return;
    }
    if (element.matches(".report-summary-grid > div, .report-repair-grid > div, .extension-adapter-grid > div")) {
      const parts = Array.from(element.children).map((child) => cleanText(child.textContent)).filter(Boolean);
      const summaryMetric = Boolean(element.closest(".report-summary-grid"));
      const label = summaryMetric ? parts[1] : parts[0];
      const value = summaryMetric ? parts[0] : parts[1];
      blocks.push({ kind: "metric", text: parts.length > 1 ? `${label}：${value}${parts.slice(2).map((part) => ` · ${part}`).join("")}` : text });
      return;
    }
    Array.from(element.children).forEach(walk);
  };
  Array.from(root.children).forEach(walk);
}

function renderReportPages(report: StructuredReport) {
  const pages: Uint8Array[] = [renderCoverPage(report)];
  let canvas = createPage();
  let context = canvas.getContext("2d");
  if (!context) throw new Error("无法创建 PDF 绘图画布。");
  let currentSection = report.sections[0] ?? report.title;
  let y = drawPageHeader(context, report.title, currentSection, 2);

  report.blocks.forEach((block) => {
    if (block.kind === "section") currentSection = block.text.split(" · ")[0];
    const style = blockStyle(block.kind);
    context!.font = style.font;
    const width = PAGE_WIDTH - MARGIN * 2 - style.indent;
    const wrapped = wrapCanvasText(context!, block.text, width);
    const required = style.before + wrapped.length * style.lineHeight + style.after;
    if (y + required > PAGE_HEIGHT - 104) {
      pages.push(jpegBytes(canvas));
      canvas = createPage();
      context = canvas.getContext("2d");
      if (!context) throw new Error("无法创建 PDF 绘图画布。");
      y = drawPageHeader(context, report.title, currentSection, pages.length + 1);
      context.font = style.font;
    }
    y += style.before;
    if (block.kind === "section") {
      context!.fillStyle = "#0f766e";
      context!.fillRect(MARGIN, y - 25, 8, Math.max(38, wrapped.length * style.lineHeight));
    }
    context!.fillStyle = style.color;
    wrapped.forEach((part, index) => {
      const marker = block.kind === "bullet" && index === 0 ? "• " : "";
      context!.fillText(`${marker}${part}`, MARGIN + style.indent, y);
      y += style.lineHeight;
    });
    y += style.after;
  });
  pages.push(jpegBytes(canvas));
  return pages;
}

function renderCoverPage(report: StructuredReport) {
  const canvas = createPage();
  const context = canvas.getContext("2d");
  if (!context) throw new Error("无法创建 PDF 绘图画布。");
  context.fillStyle = "#0f766e";
  context.fillRect(MARGIN, 114, 14, 104);
  context.font = "700 48px system-ui, sans-serif";
  context.fillStyle = "#143f3a";
  let y = 170;
  wrapCanvasText(context, report.title, PAGE_WIDTH - MARGIN * 2 - 40).forEach((line) => { context.fillText(line, MARGIN + 38, y); y += 58; });
  if (report.subtitle) {
    context.font = "500 22px system-ui, sans-serif";
    context.fillStyle = "#60736f";
    wrapCanvasText(context, report.subtitle, PAGE_WIDTH - MARGIN * 2).forEach((line) => { context.fillText(line, MARGIN, y + 24); y += 32; });
  }
  context.strokeStyle = "#d5e2df";
  context.beginPath();
  context.moveTo(MARGIN, y + 60);
  context.lineTo(PAGE_WIDTH - MARGIN, y + 60);
  context.stroke();
  y += 122;
  context.font = "700 28px system-ui, sans-serif";
  context.fillStyle = "#143f3a";
  context.fillText(document.documentElement.lang.toLowerCase().startsWith("en") ? "About this report" : "报告说明", MARGIN, y);
  y += 48;
  context.font = "400 22px system-ui, sans-serif";
  context.fillStyle = "#273633";
  wrapCanvasText(context, report.description, PAGE_WIDTH - MARGIN * 2).forEach((line) => { context.fillText(line, MARGIN, y); y += 34; });
  y += 54;
  context.font = "700 28px system-ui, sans-serif";
  context.fillStyle = "#143f3a";
  context.fillText(document.documentElement.lang.toLowerCase().startsWith("en") ? "Contents" : "目录", MARGIN, y);
  y += 48;
  context.font = "600 22px system-ui, sans-serif";
  report.sections.forEach((section, index) => {
    context.fillStyle = "#273633";
    context.fillText(`${String(index + 1).padStart(2, "0")}  ${section}`, MARGIN, y);
    y += 38;
  });
  context.font = "500 18px system-ui, sans-serif";
  context.fillStyle = "#60736f";
  context.fillText(`CodeFlow Inspector · ${new Date().toLocaleString()}`, MARGIN, PAGE_HEIGHT - 86);
  return jpegBytes(canvas);
}

function createPage() {
  const canvas = document.createElement("canvas");
  canvas.width = PAGE_WIDTH;
  canvas.height = PAGE_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) return canvas;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
  return canvas;
}

function drawPageHeader(context: CanvasRenderingContext2D, title: string, section: string, page: number) {
  context.fillStyle = "#0f766e";
  context.fillRect(MARGIN, 64, 12, 58);
  context.font = "700 34px system-ui, sans-serif";
  context.fillText(title, MARGIN + 30, 105);
  context.font = "500 18px system-ui, sans-serif";
  context.fillStyle = "#60736f";
  context.fillText(`CodeFlow Inspector · ${section} · ${page}`, MARGIN, 148);
  context.strokeStyle = "#d5e2df";
  context.beginPath();
  context.moveTo(MARGIN, 170);
  context.lineTo(PAGE_WIDTH - MARGIN, 170);
  context.stroke();
  return 216;
}

function blockStyle(kind: ReportBlockKind) {
  if (kind === "section") return { font: "700 30px system-ui, sans-serif", color: "#143f3a", lineHeight: 42, before: 24, after: 22, indent: 22 };
  if (kind === "subsection") return { font: "700 24px system-ui, sans-serif", color: "#174f49", lineHeight: 36, before: 14, after: 10, indent: 0 };
  if (kind === "metric") return { font: "700 21px system-ui, sans-serif", color: "#234c47", lineHeight: 32, before: 5, after: 7, indent: 18 };
  if (kind === "bullet") return { font: "400 21px system-ui, sans-serif", color: "#273633", lineHeight: 32, before: 3, after: 5, indent: 22 };
  if (kind === "note") return { font: "400 18px system-ui, sans-serif", color: "#60736f", lineHeight: 29, before: 2, after: 7, indent: 18 };
  if (kind === "code") return { font: "500 18px ui-monospace, monospace", color: "#284642", lineHeight: 29, before: 5, after: 8, indent: 18 };
  return { font: "400 21px system-ui, sans-serif", color: "#273633", lineHeight: 33, before: 3, after: 9, indent: 0 };
}

function wrapCanvasText(context: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const result: string[] = [];
  let line = "";
  Array.from(text).forEach((character) => {
    const candidate = line + character;
    if (line && context.measureText(candidate).width > maxWidth) {
      result.push(line);
      line = character;
    } else {
      line = candidate;
    }
  });
  if (line) result.push(line);
  return result.length ? result : [""];
}

function jpegBytes(canvas: HTMLCanvasElement) {
  const base64 = canvas.toDataURL("image/jpeg", 0.9).split(",")[1];
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function buildImagePdf(images: Uint8Array[]) {
  const objects = new Map<number, Uint8Array>();
  const pageObjects = images.map((_, index) => 3 + index * 3);
  objects.set(1, ascii("<< /Type /Catalog /Pages 2 0 R >>"));
  objects.set(2, ascii(`<< /Type /Pages /Kids [${pageObjects.map((id) => `${id} 0 R`).join(" ")}] /Count ${images.length} >>`));
  images.forEach((image, index) => {
    const pageId = pageObjects[index];
    const contentId = pageId + 1;
    const imageId = pageId + 2;
    const imageName = `Im${index + 1}`;
    objects.set(pageId, ascii(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /${imageName} ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`));
    const drawing = ascii(`q 595 0 0 842 0 0 cm /${imageName} Do Q`);
    objects.set(contentId, streamObject(`<< /Length ${drawing.length} >>`, drawing));
    objects.set(imageId, streamObject(`<< /Type /XObject /Subtype /Image /Width ${PAGE_WIDTH} /Height ${PAGE_HEIGHT} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.length} >>`, image));
  });

  const chunks: Uint8Array[] = [ascii("%PDF-1.4\n%CodeFlow\n")];
  const offsets = [0];
  let length = chunks[0].length;
  const maxObject = Math.max(...objects.keys());
  for (let id = 1; id <= maxObject; id += 1) {
    const body = objects.get(id);
    if (!body) continue;
    offsets[id] = length;
    const object = concat([ascii(`${id} 0 obj\n`), body, ascii("\nendobj\n")]);
    chunks.push(object);
    length += object.length;
  }
  const xrefOffset = length;
  const xref = [`xref\n0 ${maxObject + 1}\n`, "0000000000 65535 f \n"];
  for (let id = 1; id <= maxObject; id += 1) xref.push(`${String(offsets[id] ?? 0).padStart(10, "0")} 00000 n \n`);
  chunks.push(ascii(xref.join("")), ascii(`trailer\n<< /Size ${maxObject + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`));
  return concat(chunks);
}

function streamObject(dictionary: string, data: Uint8Array) {
  return concat([ascii(`${dictionary}\nstream\n`), data, ascii("\nendstream")]);
}

function ascii(value: string) {
  return new TextEncoder().encode(value);
}

function concat(parts: Uint8Array[]) {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  parts.forEach((part) => { result.set(part, offset); offset += part.length; });
  return result;
}

function normalizeReportText(value: string) {
  return value
    .replace(/打印 \/ 存为 PDF/g, "")
    .replace(/[\t ]{2,}/g, " ")
    .replace(/\n[\t ]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanText(value?: string | null) {
  return normalizeReportText(value ?? "").replace(/\s*\n\s*/g, " ");
}

function sanitizeFileName(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim() || "CodeFlow-Report";
}

function nativeInvoke(): TauriInvoke | null {
  if (typeof window === "undefined") return null;
  const tauriWindow = window as TauriWindow;
  return tauriWindow.__TAURI__?.core?.invoke ?? tauriWindow.__TAURI__?.invoke ?? tauriWindow.__TAURI_INTERNALS__?.invoke ?? null;
}
