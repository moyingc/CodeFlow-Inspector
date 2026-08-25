export function countLines(text: string) {
  return text.split("\n").length;
}

export function indexOfLine(content: string, line: number) {
  if (line <= 1) return 0;
  let position = 0;
  for (let currentLine = 1; currentLine < line; currentLine += 1) {
    const next = content.indexOf("\n", position);
    if (next === -1) return content.length;
    position = next + 1;
  }
  return position;
}

export function shorten(value: string, maxLength: number) {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > maxLength ? `${clean.slice(0, maxLength - 1)}...` : clean;
}

export function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
