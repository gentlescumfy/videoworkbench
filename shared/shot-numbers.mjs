const listPattern = String.raw`\d+(?:\s*(?:-|至|到)\s*\d+)?(?:\s*(?:,|，|、|和|及)\s*\d+(?:\s*(?:-|至|到)\s*\d+)?)*`;

export function parseNumberList(input) {
  const normalized = input.trim()
    .replace(/[，、和及]/g, ',')
    .replace(/\s*(?:至|到)\s*/g, '-');
  if (!/^\d+(?:\s*-\s*\d+)?(?:\s*,\s*\d+(?:\s*-\s*\d+)?)*$/.test(normalized)) return [];

  const result = new Set();
  for (const token of normalized.match(/\d+\s*-\s*\d+|\d+/g) || []) {
    const range = token.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      if (from < 1 || to > 100 || from > to || to - from > 99) return [];
      for (let number = from; number <= to; number++) result.add(number);
    } else {
      const number = Number(token);
      if (number < 1 || number > 100) return [];
      result.add(number);
    }
  }
  return [...result];
}

export function parseShotNumbers(prompt) {
  if (!/(生成|继续|先做|开始|重试|制作|做|补|重跑)/.test(prompt)) return [];
  const values = new Set();
  const patterns = [
    new RegExp(`(?:分镜|镜头)\\s*(?:(?:编号|号|第)\\s*)?(${listPattern})`, 'g'),
    new RegExp(`第\\s*(${listPattern})\\s*(?:个)?(?:分镜|镜头)`, 'g'),
  ];
  for (const pattern of patterns) {
    for (const match of prompt.matchAll(pattern)) {
      for (const number of parseNumberList(match[1])) values.add(number);
    }
  }
  return [...values];
}
