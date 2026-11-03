export async function claimNotification(client, table, row) {
  try {
    const { error } = await client.from(table).insert(row);
    if (!error) return { status: "claimed" };
    if (error.code === "23505") return { status: "duplicate" };
    return { status: "failed", error };
  } catch (error) {
    return { status: "unknown", error };
  }
}

export async function releaseNotificationClaim(client, table, key) {
  try {
    let query = client.from(table).delete();
    for (const [column, value] of Object.entries(key)) {
      query = query.eq(column, value);
    }
    const { data, error } = await query.select("id");
    if (error) return { released: false, error };
    return { released: Array.isArray(data) && data.length === 1 };
  } catch (error) {
    return { released: false, error };
  }
}

export async function sendWithNotificationClaim(client, table, key, send) {
  let response;
  try {
    response = await send();
  } catch {
    return { status: "ambiguous" };
  }

  if (response.ok) return { status: "accepted", response };
  // Treat client rejection as definite; redirects and server failures may be ambiguous.
  if (response.status < 400 || response.status >= 500) {
    return { status: "ambiguous", response };
  }

  const cleanup = await releaseNotificationClaim(client, table, key);
  if (!cleanup.released) {
    return { status: "cleanup_failed", error: cleanup.error, response };
  }

  return { status: "rejected", response };
}
