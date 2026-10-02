export function normalizeSearchText(value:string) {
  return value.normalize('NFKC').toLowerCase();
}

export function createSearchTokens(query:string) {
  return normalizeSearchText(query).trim().split(/\s+/u).filter(Boolean);
}

export function matchesSearchTokens(normalizedText:string,tokens:readonly string[]) {
  return tokens.every(token=>normalizedText.includes(token));
}
