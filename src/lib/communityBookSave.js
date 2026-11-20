export async function persistCommunityBookSaveState({ bookId, shouldBeSaved, save, unsave }) {
  const result = await (shouldBeSaved ? save(bookId) : unsave(bookId));
  if (result?.success !== true) {
    throw new Error(result?.message || (shouldBeSaved
      ? 'Unable to save book for later.'
      : 'Unable to remove book from saved list.'));
  }
  return shouldBeSaved;
}
