/* gitster funnel helper, shared by / and /signup.
   - keeps ?src= from the URL (falls back to this tab's session) and carries it
     onto every internal link to / and /signup
   - keeps a random per-visit session id in sessionStorage, so the same id is
     sent from the demo and from the signup page
   - sends events to /api/event with navigator.sendBeacon */
(function () {
  "use strict";

  var SRC_RE = /^[A-Za-z0-9_-]{1,64}$/;

  function store(key, value) {
    try {
      if (value === undefined) return window.sessionStorage.getItem(key);
      window.sessionStorage.setItem(key, value);
    } catch (e) { /* private mode or storage blocked */ }
    return null;
  }

  var fromUrl = null;
  try { fromUrl = new URLSearchParams(location.search).get("src"); } catch (e) {}
  var src = fromUrl && SRC_RE.test(fromUrl) ? fromUrl : null;
  if (src) store("gitster_src", src);
  else {
    var kept = store("gitster_src");
    if (kept && SRC_RE.test(kept)) src = kept;
  }

  function newId() {
    var bytes = new Uint8Array(16);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(bytes);
    else for (var i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
    var out = "";
    for (var j = 0; j < bytes.length; j++) out += (bytes[j] < 16 ? "0" : "") + bytes[j].toString(16);
    return out;
  }

  var sid = store("gitster_sid");
  if (!sid || !/^[a-f0-9]{32}$/.test(sid)) {
    sid = newId();
    store("gitster_sid", sid);
  }

  function track(name) {
    var body = JSON.stringify({ name: name, src: src, session_id: sid });
    try {
      // A plain string goes out as text/plain, which never needs a preflight.
      if (navigator.sendBeacon && navigator.sendBeacon("/api/event", body)) return;
    } catch (e) {}
    try {
      fetch("/api/event", { method: "POST", body: body, keepalive: true }).catch(function () {});
    } catch (e) {}
  }

  /* Once per visit (per tab session), not once per page load. */
  function once(name) {
    var key = "gitster_once_" + name;
    if (store(key)) return;
    store(key, "1");
    track(name);
  }

  function carrySrc(root) {
    if (!src) return;
    var links = (root || document).querySelectorAll('a[href^="/"]');
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      var url = new URL(a.getAttribute("href"), location.origin);
      var path = url.pathname.replace(/\/+$/, "") || "/";
      if (path !== "/signup" && path !== "/") continue;
      url.searchParams.set("src", src);
      a.setAttribute("href", url.pathname + url.search + url.hash);
    }
  }

  window.gitster = { src: src, sid: sid, track: track, once: once, carrySrc: carrySrc };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { carrySrc(); });
  } else {
    carrySrc();
  }
})();
