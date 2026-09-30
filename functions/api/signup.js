// POST /api/signup
// Body (JSON): { email, daw, pain, src, consent, website }
// `website` is a honeypot: people never see it, so if it's filled we pretend
// everything worked and store nothing.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SRC_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_BODY = 8 * 1024;

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

function clip(value, max) {
  if (typeof value !== "string") return null;
  const chars = Array.from(value.trim()).slice(0, max).join("");
  return chars || null;
}

export async function onRequest({ request, env }) {
  if (request.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405, { allow: "POST" });
  }

  let data;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY) return json({ ok: false, error: "too_large" }, 413);
    data = JSON.parse(text);
  } catch {
    return json({ ok: false, error: "bad_json" }, 400);
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return json({ ok: false, error: "bad_json" }, 400);
  }

  // Honeypot filled: reject silently.
  if (typeof data.website === "string" && data.website.trim() !== "") {
    return json({ ok: true });
  }

  const email = typeof data.email === "string" ? data.email.trim().toLowerCase() : "";
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    return json({ ok: false, error: "invalid_email" }, 400);
  }
  if (data.consent !== true) {
    return json({ ok: false, error: "consent_required" }, 400);
  }

  const daw = clip(data.daw, 40);
  const pain = clip(data.pain, 500);
  const src = typeof data.src === "string" && SRC_RE.test(data.src) ? data.src : null;

  if (!env.DB) return json({ ok: false, error: "no_database" }, 500);

  try {
    // A duplicate email is not an error for the visitor: they're on the list.
    await env.DB.prepare(
      "INSERT INTO signups (email, daw, pain, src, consent) VALUES (?1, ?2, ?3, ?4, 1) ON CONFLICT(email) DO NOTHING"
    )
      .bind(email, daw, pain, src)
      .run();
  } catch (err) {
    console.error("signup insert failed", err);
    return json({ ok: false, error: "db_error" }, 500);
  }

  return json({ ok: true });
}
