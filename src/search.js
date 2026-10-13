// Client-side list search modelled on the filter shipped in Holded's web bundle
// (cdn.holded.com/frontend-next-gen/app-utils-search-search.*.js):
//   - query and each item's text are normalised the same way
//   - normalisation = trim -> NFD -> strip combining marks -> lowercase
//   - an empty query returns the list unchanged
//   - match = substring ("includes") on the normalised text
// Re-implemented independently; no Holded code is copied.

export const normalize = (value) =>
  String(value ?? '')
    .trim()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/**
 * @template T
 * @param {T[]} items
 * @param {string} query
 * @param {(item: T) => string} getText  text to match against (e.g. name + email)
 * @returns {T[]}
 */
export function searchItems(items, query, getText) {
  const q = normalize(query);
  if (!q) return items;
  return items.filter((item) => normalize(getText(item)).includes(q));
}
