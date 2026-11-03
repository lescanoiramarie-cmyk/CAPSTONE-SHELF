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

const LOWERCASE_CATEGORY_WORDS = new Set([
  'a',
  'an',
  'and',
  'for',
  'in',
  'of',
  'on',
  'the',
  'to',
]);

export function formatBookCategory(value) {
  let isFirstWord = true;

  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\p{L}[\p{L}\p{M}]*(?:['’]\p{L}[\p{L}\p{M}]*)?/gu, (word) => {
      const lower = word.toLocaleLowerCase();
      const formatted =
        !isFirstWord && LOWERCASE_CATEGORY_WORDS.has(lower)
          ? lower
          : lower.replace(/^(\p{L})/u, (firstLetter) =>
              firstLetter.toLocaleUpperCase()
            );

      isFirstWord = false;
      return formatted;
    });
}

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
