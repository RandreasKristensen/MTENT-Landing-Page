// POST /api/event
// Body (JSON, usually sent as text/plain by navigator.sendBeacon):
//   { name, src, session_id }
// Only known event names are stored; anything else is ignored with a 204.

const EVENTS = new Set([
  // demo (/)
  "demo_view",
  "demo_step_1",
  "demo_step_2",
  "demo_step_3",
  "demo_step_4",
  "demo_step_5",
  "demo_autoplay",
  "demo_audio_play",
  "demo_knob_turn",
  "demo_version_restore",
  "signup_click",
  // signup (/signup)
  "signup_view",
  "ring_click",
  "signup_submit_error",
]);

const SRC_RE = /^[A-Za-z0-9_-]{1,64}$/;
const SID_RE = /^[a-f0-9]{32}$/;

const noContent = () => new Response(null, { status: 204, headers: { "cache-control": "no-store" } });

export async function onRequest({ request, env }) {
  if (request.method !== "POST") {
    return new Response(null, { status: 405, headers: { allow: "POST" } });
  }

  let data;
  try {
    const text = await request.text();
    if (text.length > 1024) return noContent();
    data = JSON.parse(text);
  } catch {
    return noContent();
  }

  const name = data && typeof data.name === "string" ? data.name : "";
  if (!EVENTS.has(name) || !env.DB) return noContent();

  const src = typeof data.src === "string" && SRC_RE.test(data.src) ? data.src : null;
  const sid = typeof data.session_id === "string" && SID_RE.test(data.session_id) ? data.session_id : null;

  try {
    await env.DB.prepare("INSERT INTO events (name, src, session_id) VALUES (?1, ?2, ?3)")
      .bind(name, src, sid)
      .run();
  } catch (err) {
    console.error("event insert failed", err);
  }
  return noContent();
}
