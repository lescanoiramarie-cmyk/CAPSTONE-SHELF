const CATEGORY_ACRONYMS = new Set([
  'AI',
  'AR',
  'CS',
  'ICT',
  'IT',
  'ML',
  'STEM',
  'UI',
  'UX',
  'VR',
]);

export function normalizeBookCategory(value) {
  const category = String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');

  if (!category) return '';

  return category.replace(/\S+/g, (word) => {
    if (CATEGORY_ACRONYMS.has(word.toUpperCase())) {
      return word.toUpperCase();
    }

    return word
      .toLocaleLowerCase()
      .split(/([-/'’])/)
      .map((part) =>
        /^[-/'’]$/.test(part)
          ? part
          : part.replace(/^(\p{L})/u, (firstLetter) =>
              firstLetter.toLocaleUpperCase()
            )
      )
      .join('');
  });
}

export function getBookCategoryKey(value) {
  return normalizeBookCategory(value).toLocaleLowerCase();
}
