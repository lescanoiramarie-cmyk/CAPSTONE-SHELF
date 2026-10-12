import { supabase } from '../lib/supabaseClient.js';
import {
  mapBook,
  resolveVisitorAuthUserId,
} from '../data/store.js';

export async function toggleReadingList(visitorId, bookId) {
  if (!visitorId) {
    throw new Error('Visitor ID is required.');
  }

  if (!bookId) {
    throw new Error('Book ID is required.');
  }

  const resolvedVisitorId = await resolveVisitorAuthUserId(visitorId);

  const { data, error } = await supabase.rpc('toggle_reading_list_item', {
    p_visitor_id: resolvedVisitorId,
    p_book_id: bookId,
  });

  if (error) {
    throw new Error(error.message || 'Unable to update the reading list.');
  }

  return Boolean(data);
}

export async function fetchReadingList(visitorId) {
  if (!visitorId) {
    throw new Error('Visitor ID is required.');
  }

  const resolvedVisitorId = await resolveVisitorAuthUserId(visitorId);

  const { data, error } = await supabase.rpc('fetch_visitor_reading_list', {
    p_visitor_id: resolvedVisitorId,
  });

  if (error) {
    throw new Error(error.message || 'Unable to fetch the reading list.');
  }

  return (data || []).map((book) => mapBook(book));
}
