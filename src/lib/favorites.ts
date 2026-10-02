export const FAVORITES_KEY = 'shenzhen-food-guide:favorites:v1';
export function parseFavorites(input: unknown, knownIds:Set<string>) {
  if (!input || typeof input !== 'object' || !('version' in input) || input.version !== 1 || !('ids' in input) || !Array.isArray(input.ids) || input.ids.length > 10000 || !input.ids.every(v => typeof v === 'string' && v.length <= 100)) throw new Error('收藏文件格式不正确，请使用本站导出的 JSON');
  const ids = [...new Set(input.ids as string[])];
  return { ids: ids.filter(id => knownIds.has(id)), removed:ids.filter(id => !knownIds.has(id)).length, duplicates:(input.ids as string[]).length - ids.length };
}
