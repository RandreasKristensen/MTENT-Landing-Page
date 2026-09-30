/* gitster demo: a scripted, simulated collaborative DAW.
   Nothing here connects to anything. The sound is synthesized with the
   Web Audio API and only starts after the visitor presses play. */
(function () {
  "use strict";

  var G = window.gitster || { src: null, track: function () {}, once: function () {} };
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  function $(id) { return document.getElementById(id); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function smooth() { return reduced ? "auto" : "smooth"; }

  /* ================================================================
     Music
     ================================================================ */

  var BPM = 96;
  var BEATS = 16;                // a 4-bar loop
  var SPB = 60 / BPM;            // seconds per beat
  var SIXT = SPB / 4;            // seconds per 16th
  var STEPS = BEATS * 4;         // 16ths in the loop

  var TRACKS = [
    { id: "drums", name: "Drums", kind: "wave" },
    { id: "bass",  name: "Bass",  kind: "midi" },
    { id: "keys",  name: "Keys",  kind: "midi" },
    { id: "vocal", name: "Vocal", kind: "wave" },
    { id: "synth", name: "Synth", kind: "midi" }
  ];

  var ICONS = {
    drums: '<ellipse cx="10" cy="7.5" rx="7" ry="2.6"/><path d="M3 7.5v5.5c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6V7.5"/><path d="M5.5 2.2l3.2 4M14.5 2.2l-3.2 4"/>',
    bass:  '<path d="M2 11c1.8-5.5 3.6-5.5 5.4 0s3.6 5.5 5.4 0 3.6-5.5 5.2-1.5"/>',
    keys:  '<rect x="2.5" y="4" width="15" height="12" rx="1"/><path d="M6.25 4v12M10 4v12M13.75 4v12"/>',
    vocal: '<rect x="7" y="2.5" width="6" height="9" rx="3"/><path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v2.5M7 17.5h6"/>',
    synth: '<path d="M2 10h2.2l2.3-5.5 3 11 3-11 2.3 5.5H18"/>'
  };

  var PEOPLE = {
    y: { initial: "Y", name: "You",     cls: "av-y" },
    n: { initial: "N", name: "Nikolaj", cls: "" },
    t: { initial: "T", name: "Tobias",  cls: "" },
    s: { initial: "S", name: "Sofie",   cls: "av-s" }
  };

  // Tonight's mix (v16) vs. "The good one" (v4). MIDI note numbers.
  var CHORDS = {
    now: [[57, 60, 64], [53, 57, 60], [52, 55, 60], [55, 59, 62]], // Am  F  C/E  G
    v4:  [[57, 60, 64], [57, 60, 64], [53, 57, 60], [52, 55, 59]]  // Am  Am F    Em
  };
  var ROOTS = { now: [45, 41, 40, 43], v4: [45, 45, 41, 40] };
  var VOCAL = {
    now: [[8, 1.5, 76], [9.5, 0.5, 74], [10, 2, 72], [12, 1, 71], [13, 1, 72], [14, 2, 69]],
    v4:  [[0, 2, 69], [2, 1, 72], [3, 1, 71], [4, 2, 69], [6, 2, 64],
          [8, 1.5, 65], [9.5, 0.5, 67], [10, 2, 69], [12, 2, 67], [14, 2, 64]]
  };

  function buildNotes(v) {
    var n = { drums: [], bass: [], keys: [], vocal: [], synth: [] };
    for (var bar = 0; bar < 4; bar++) {
      var b0 = bar * 4, ch = CHORDS[v][bar], root = ROOTS[v][bar];
      for (var s = 0; s < 16; s++) {
        var b = b0 + s / 4;
        if (v === "now") {
          if (s === 0 || s === 8 || (s === 11 && bar % 2 === 1)) n.drums.push({ b: b, l: 0.5, p: "k" });
          if (s === 4 || s === 12) n.drums.push({ b: b, l: 0.5, p: "s" });
          if (s % 4 === 2) n.drums.push({ b: b, l: 0.25, p: "h" });
          if ([0, 3, 6, 8, 11, 14].indexOf(s) >= 0) n.bass.push({ b: b, l: 0.6, p: s === 14 ? root + 12 : root });
          n.synth.push({ b: b, l: 0.25, p: ch[[0, 1, 2, 1][s % 4]] + 12 + (s % 8 >= 4 ? 12 : 0) });
        } else {
          if (s === 0 || s === 6 || s === 10) n.drums.push({ b: b, l: 0.5, p: "k" });
          if (s === 4 || s === 12) n.drums.push({ b: b, l: 0.5, p: "s" });
          if (s % 2 === 0) n.drums.push({ b: b, l: 0.25, p: "h" });
          if (s === 0 || s === 8) n.bass.push({ b: b, l: 1.8, p: root });
        }
      }
      if (v === "now") n.keys.push({ b: b0, l: 4, p: ch });
      else { n.keys.push({ b: b0, l: 1.5, p: ch }); n.keys.push({ b: b0 + 2, l: 1.5, p: ch }); }
    }
    n.vocal = VOCAL[v].map(function (x) { return { b: x[0], l: x[1], p: x[2] }; });
    return n;
  }

  var NOTES = { now: buildNotes("now"), v4: buildNotes("v4") };
  var BY_STEP = {};
  Object.keys(NOTES).forEach(function (v) {
    BY_STEP[v] = {};
    TRACKS.forEach(function (t) {
      var map = {};
      NOTES[v][t.id].forEach(function (note) {
        var st = Math.round(note.b * 4);
        (map[st] = map[st] || []).push(note);
      });
      BY_STEP[v][t.id] = map;
    });
  });

  // Clip arrangements. `v` picks the note data a clip plays and draws.
  var ARR = {
    now: [
      { t: "drums", s: 0, l: 16, n: "Beat",            by: "n", v: "now" },
      { t: "bass",  s: 0, l: 16, n: "Bassline",        by: "t", v: "now" },
      { t: "keys",  s: 0, l: 8,  n: "Pad A",           by: "y", v: "now" },
      { t: "keys",  s: 8, l: 8,  n: "Pad B",           by: "y", v: "now" },
      { t: "synth", s: 0, l: 16, n: "Arp",             by: "y", v: "now" }
    ],
    v4: [
      { t: "drums", s: 0, l: 16, n: "Borrowed break",  by: "n", v: "v4" },
      { t: "bass",  s: 0, l: 8,  n: "Bass take",       by: "t", v: "v4" },
      { t: "keys",  s: 0, l: 16, n: "Old chorus",      by: "y", v: "v4" },
      { t: "vocal", s: 0, l: 16, n: "Chorus, first words", by: "y", v: "v4" }
    ]
  };
  var SOFIE_CLIP = { t: "vocal", s: 8, l: 8, n: "Sofie · vocal", by: "s", v: "now", merged: true };

  var state = {
    step: 1,
    opened: false,
    view: "now",       // "now" (v16) or "v4"
    sofieHere: false,  // avatar in the transport
    sofie: false,      // her clip is merged
    panel: null,
    mute: {},
    solo: {}
  };

  function clips() {
    if (state.view === "v4") return ARR.v4;
    return state.sofie ? ARR.now.concat([SOFIE_CLIP]) : ARR.now;
  }

  /* ================================================================
     Audio engine
     ================================================================ */

  var FX_DEFAULT = { cutoff: 0.62, res: 0.22, mix: 0.3, decay: 0.4 };
  var fx = { cutoff: FX_DEFAULT.cutoff, res: FX_DEFAULT.res, mix: FX_DEFAULT.mix, decay: FX_DEFAULT.decay };
  function cutoffHz(v) { return 140 * Math.pow(2, (v == null ? fx.cutoff : v) * 7); }
  function resQ(v) { return 0.7 + (v == null ? fx.res : v) * 13; }
  function decaySec(v) { return 0.5 + (v == null ? fx.decay : v) * 4.5; }
  function freq(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  var A = null;
  var soundOn = true;

  function initAudio() {
    if (A) return A;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    var ctx = new AC();

    var master = ctx.createGain();
    master.gain.value = soundOn ? 0.85 : 0;
    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.005;
    comp.release.value = 0.2;
    master.connect(comp);
    comp.connect(ctx.destination);

    var bus = {};
    TRACKS.forEach(function (t) {
      var g = ctx.createGain();
      g.connect(master);
      bus[t.id] = g;
    });

    // Synth effect chain: Glasswave (filter) -> Driftverb (reverb)
    var synthIn = ctx.createGain();
    var filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    var dry = ctx.createGain();
    var wet = ctx.createGain();
    var verb = ctx.createConvolver();
    synthIn.connect(filter);
    filter.connect(dry);
    dry.connect(bus.synth);
    filter.connect(verb);
    verb.connect(wet);
    wet.connect(bus.synth);

    var noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    var nd = noise.getChannelData(0);
    for (var i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

    A = { ctx: ctx, master: master, bus: bus, synthIn: synthIn, filter: filter, dry: dry, wet: wet, verb: verb, noise: noise, irDecay: -1 };
    applyFx(true);
    applyMix(true);
    return A;
  }

  function makeIR(sec) {
    var ctx = A.ctx, rate = ctx.sampleRate, len = Math.floor(rate * sec);
    var buf = ctx.createBuffer(2, len, rate);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch);
      for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    return buf;
  }

  var irTimer = 0;
  function applyFx(immediate) {
    if (!A) return;
    var t = A.ctx.currentTime, k = immediate ? 0.001 : 0.04;
    A.filter.frequency.setTargetAtTime(cutoffHz(), t, k);
    A.filter.Q.setTargetAtTime(resQ(), t, k);
    A.wet.gain.setTargetAtTime(fx.mix * 1.5, t, k);
    A.dry.gain.setTargetAtTime(1 - fx.mix * 0.55, t, k);
    var dec = decaySec();
    if (Math.abs(dec - A.irDecay) > 0.05) {
      clearTimeout(irTimer);
      irTimer = setTimeout(function () { A.verb.buffer = makeIR(dec); A.irDecay = dec; }, immediate ? 0 : 120);
    }
  }

  function audible(id) {
    var anySolo = TRACKS.some(function (t) { return state.solo[t.id]; });
    return anySolo ? !!state.solo[id] : !state.mute[id];
  }

  function applyMix(immediate) {
    TRACKS.forEach(function (t) {
      rows[t.id].lane.classList.toggle("muted", !audible(t.id));
      if (A) A.bus[t.id].gain.setTargetAtTime(audible(t.id) ? 1 : 0, A.ctx.currentTime, immediate ? 0.001 : 0.015);
    });
  }

  function envGain(t, peak, attack, hold, release) {
    var g = A.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    if (hold > 0) g.gain.setValueAtTime(peak, t + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
    return g;
  }

  function kick(t, out) {
    var o = A.ctx.createOscillator(), g = envGain(t, 0.95, 0.003, 0.02, 0.32);
    o.frequency.setValueAtTime(155, t);
    o.frequency.exponentialRampToValueAtTime(44, t + 0.13);
    o.connect(g); g.connect(out);
    o.start(t); o.stop(t + 0.4);
  }

  function noiseHit(t, out, type, f, peak, release) {
    var c = A.ctx, src = c.createBufferSource(), flt = c.createBiquadFilter(), g = envGain(t, peak, 0.002, 0, release);
    src.buffer = A.noise;
    flt.type = type;
    flt.frequency.value = f;
    src.connect(flt); flt.connect(g); g.connect(out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + release + 0.05);
  }

  function snare(t, out) {
    noiseHit(t, out, "bandpass", 1800, 0.55, 0.17);
    var o = A.ctx.createOscillator(), g = envGain(t, 0.3, 0.002, 0, 0.1);
    o.type = "triangle";
    o.frequency.setValueAtTime(210, t);
    o.frequency.exponentialRampToValueAtTime(140, t + 0.08);
    o.connect(g); g.connect(out);
    o.start(t); o.stop(t + 0.15);
  }

  function hat(t, out) { noiseHit(t, out, "highpass", 7500, 0.16, 0.045); }

  function bass(t, out, m, dur) {
    var c = A.ctx, o = c.createOscillator(), sub = c.createOscillator(), f = c.createBiquadFilter();
    var g = envGain(t, 0.32, 0.006, dur * 0.45, dur * 0.5);
    o.type = "sawtooth"; o.frequency.value = freq(m);
    sub.type = "sine"; sub.frequency.value = freq(m);
    f.type = "lowpass"; f.Q.value = 3;
    f.frequency.setValueAtTime(950, t);
    f.frequency.exponentialRampToValueAtTime(240, t + dur);
    o.connect(f); f.connect(g); sub.connect(g); g.connect(out);
    o.start(t); sub.start(t);
    o.stop(t + dur + 0.05); sub.stop(t + dur + 0.05);
  }

  function pad(t, out, notes, dur) {
    var c = A.ctx, f = c.createBiquadFilter(), g = c.createGain(), lvl = 0.07;
    f.type = "lowpass"; f.frequency.value = 1500;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(lvl, t + Math.min(0.35, dur * 0.3));
    g.gain.setValueAtTime(lvl, t + dur - 0.1);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.45);
    f.connect(g); g.connect(out);
    notes.forEach(function (m) {
      [-7, 7].forEach(function (det) {
        var o = c.createOscillator();
        o.type = "triangle";
        o.frequency.value = freq(m);
        o.detune.value = det;
        o.connect(f);
        o.start(t); o.stop(t + dur + 0.5);
      });
    });
  }

  function pluck(t, out, m) {
    var o = A.ctx.createOscillator(), g = envGain(t, 0.16, 0.003, 0.02, 0.16);
    o.type = "sawtooth"; o.frequency.value = freq(m);
    o.connect(g); g.connect(out);
    o.start(t); o.stop(t + 0.22);
  }

  // A wordless "oo" voice: a sawtooth through two formant filters, with vibrato.
  function voice(t, out, m, dur) {
    var c = A.ctx, o = c.createOscillator(), lfo = c.createOscillator(), depth = c.createGain();
    var f1 = c.createBiquadFilter(), f2 = c.createBiquadFilter(), f2g = c.createGain(), g = c.createGain();
    o.type = "sawtooth";
    o.frequency.value = freq(m);
    o.detune.setValueAtTime(-60, t);
    o.detune.linearRampToValueAtTime(0, t + 0.08);
    lfo.frequency.value = 5.3;
    depth.gain.setValueAtTime(0, t);
    depth.gain.linearRampToValueAtTime(22, t + Math.min(0.5, dur));
    lfo.connect(depth); depth.connect(o.detune);
    f1.type = "bandpass"; f1.frequency.value = 420; f1.Q.value = 5;
    f2.type = "bandpass"; f2.frequency.value = 1050; f2.Q.value = 7;
    f2g.gain.value = 0.55;
    o.connect(f1); o.connect(f2); f2.connect(f2g);
    f1.connect(g); f2g.connect(g);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.9, t + 0.07);
    g.gain.setValueAtTime(0.9, t + Math.max(0.08, dur - 0.08));
    g.gain.linearRampToValueAtTime(0, t + dur + 0.18);
    g.connect(out);
    o.start(t); lfo.start(t);
    o.stop(t + dur + 0.25); lfo.stop(t + dur + 0.25);
  }

  function playNote(track, n, t) {
    var out = A.bus[track];
    if (track === "drums") {
      if (n.p === "k") kick(t, out);
      else if (n.p === "s") snare(t, out);
      else hat(t, out);
    } else if (track === "bass") bass(t, out, n.p, n.l * SPB);
    else if (track === "keys") pad(t, out, n.p, n.l * SPB);
    else if (track === "vocal") voice(t, out, n.p, n.l * SPB);
    else if (track === "synth") pluck(t, A.synthIn, n.p);
  }

  function schedule(step, t) {
    var beat = step / 4, list = clips();
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (beat < c.s || beat >= c.s + c.l) continue;
      var notes = BY_STEP[c.v][c.t][step];
      if (!notes) continue;
      for (var j = 0; j < notes.length; j++) playNote(c.t, notes[j], t);
    }
  }

  /* ---------- transport clock ---------- */

  var clock = { playing: false, pos: 0, t0: 0, b0: 0, next: 0, nextT: 0, timer: 0, raf: 0 };
  var audioPlayLogged = false;

  function now() { return A ? A.ctx.currentTime : performance.now() / 1000; }
  function beatAt(t) {
    var b = clock.b0 + (t - clock.t0) / SPB;
    return ((b % BEATS) + BEATS) % BEATS;
  }

  function pump() {
    if (!A) return;
    var horizon = A.ctx.currentTime + 0.12;
    while (clock.nextT < horizon) {
      schedule(clock.next % STEPS, clock.nextT);
      clock.next++;
      clock.nextT += SIXT;
    }
  }

  function startPlayback() {
    if (clock.playing) return;
    ensureOpen(true);
    initAudio();
    if (A && A.ctx.state !== "running") A.ctx.resume();
    clock.t0 = now() + 0.06;
    clock.b0 = clock.pos;
    var st = Math.ceil(clock.pos * 4 - 1e-6);
    clock.next = st;
    clock.nextT = clock.t0 + (st - clock.pos * 4) * SIXT;
    clock.playing = true;
    pump();
    clock.timer = setInterval(pump, 25);
    frame();
    setPlayUi(true);
    if (!audioPlayLogged) { audioPlayLogged = true; G.track("demo_audio_play"); }
  }

  function stopPlayback() {
    if (!clock.playing) return;
    clock.pos = beatAt(now());
    clock.playing = false;
    clearInterval(clock.timer);
    cancelAnimationFrame(clock.raf);
    setPlayUi(false);
    renderClock(clock.pos);
  }

  function frame() {
    var lat = A && A.ctx.outputLatency ? A.ctx.outputLatency : 0;
    renderClock(clock.playing ? beatAt(now() - lat) : clock.pos);
    if (clock.playing) clock.raf = requestAnimationFrame(frame);
  }

  /* ================================================================
     DAW UI
     ================================================================ */

  var daw = $("daw");
  var grid = $("grid");
  var arrange = $("arrange");
  var playhead = $("playhead");
  var peer = $("peer");
  var clockEl = $("clock");
  var toastEl = $("toast");
  var rows = {};

  // Ruler
  var ruler = $("ruler");
  for (var bi = 0; bi < 4; bi++) {
    var span = document.createElement("span");
    span.textContent = String(bi + 1);
    span.style.left = "calc(" + (bi * 25) + "% + 6px)";
    ruler.appendChild(span);
  }

  // Track rows
  TRACKS.forEach(function (t, i) {
    var trk = document.createElement("div");
    trk.className = "trk";
    trk.style.setProperty("--r", i);
    trk.innerHTML =
      '<span class="icw"><svg class="ic" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      ICONS[t.id] + '</svg><span class="av"></span></span>' +
      '<span class="nm">' + t.name + '</span>' +
      (t.id === "synth" ? '<button class="fx" type="button" aria-expanded="false" aria-controls="fxPanel" title="Effect chain">FX</button>' : "") +
      '<span class="ms">' +
      '<button class="m" type="button" aria-pressed="false" aria-label="Mute ' + t.name + '" title="Mute">M</button>' +
      '<button class="s" type="button" aria-pressed="false" aria-label="Solo ' + t.name + '" title="Solo">S</button>' +
      "</span>";
    var lane = document.createElement("div");
    lane.className = "lane";
    lane.style.setProperty("--r", i);
    lane.setAttribute("aria-label", t.name + " lane");
    grid.insertBefore(trk, playhead);
    grid.insertBefore(lane, playhead);
    rows[t.id] = { trk: trk, lane: lane, av: trk.querySelector(".av") };

    trk.querySelector(".m").addEventListener("click", function () {
      state.mute[t.id] = !state.mute[t.id];
      this.setAttribute("aria-pressed", String(state.mute[t.id]));
      applyMix();
    });
    trk.querySelector(".s").addEventListener("click", function () {
      state.solo[t.id] = !state.solo[t.id];
      this.setAttribute("aria-pressed", String(state.solo[t.id]));
      applyMix();
    });
  });
  var fxBtn = rows.synth.trk.querySelector(".fx");
  fxBtn.addEventListener("click", function () {
    ensureOpen(true);
    showPanel(state.panel === "fx" ? null : "fx", true);
  });

  /* ---------- clip drawing ---------- */

  function rnd(seed) {
    var x = Math.sin(seed * 91.7 + 17.3) * 43758.5453;
    return x - Math.floor(x);
  }

  function clipSvg(c) {
    var W = c.l * 16, H = 40;
    var notes = NOTES[c.v][c.t].filter(function (n) { return n.b >= c.s && n.b < c.s + c.l; });
    var svg = '<svg viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" aria-hidden="true">';

    if (TRACKS.filter(function (t) { return t.id === c.t; })[0].kind === "midi") {
      var pitches = [];
      notes.forEach(function (n) { pitches = pitches.concat(n.p); });
      var lo = Math.min.apply(null, pitches), hi = Math.max.apply(null, pitches), span = Math.max(1, hi - lo);
      notes.forEach(function (n) {
        [].concat(n.p).forEach(function (p) {
          var y = (1 - (p - lo) / span) * (H - 5);
          var x = (n.b - c.s) * 16;
          var w = Math.max(1.6, n.l * 16 - 0.8);
          svg += '<rect x="' + x.toFixed(2) + '" y="' + y.toFixed(2) + '" width="' + w.toFixed(2) + '" height="4" rx="0.6" fill="currentColor"/>';
        });
      });
    } else {
      // Waveform: an amplitude envelope built from the clip's actual hits/notes.
      var N = Math.round(c.l * 12), top = "", bottom = "";
      for (var i = 0; i <= N; i++) {
        var beat = c.s + (i / N) * c.l, a = 0;
        notes.forEach(function (n) {
          var d = beat - n.b;
          if (c.t === "drums") {
            if (d < 0) return;
            var k = n.p === "k" ? [1, 0.32] : n.p === "s" ? [0.62, 0.22] : [0.22, 0.07];
            a += k[0] * Math.exp(-d / k[1]);
          } else if (d >= 0 && d < n.l + 0.2) {
            var body = d < 0.08 ? d / 0.08 : d > n.l ? 1 - (d - n.l) / 0.2 : 0.78 + 0.22 * Math.sin(d * 9);
            a += 0.72 * body;
          }
        });
        a = Math.min(1, a) * (0.62 + 0.38 * rnd(i + c.s * 31 + c.l * 7 + (c.by === "s" ? 99 : 0)));
        a = Math.max(0.03, a);
        var x = (i / N) * W;
        top += (i ? "L" : "M") + x.toFixed(2) + " " + (H / 2 - a * (H / 2 - 1)).toFixed(2);
        bottom = "L" + x.toFixed(2) + " " + (H / 2 + a * (H / 2 - 1)).toFixed(2) + bottom;
      }
      svg += '<path d="' + top + bottom + 'Z" fill="currentColor" opacity=".8"/>';
    }
    return svg + "</svg>";
  }

  function clipEl(c) {
    var el = document.createElement("div");
    el.className = "clip" + (c.by === "s" ? " by-s" : "");
    el.style.setProperty("--s", c.s);
    el.style.setProperty("--l", c.l);
    el.innerHTML = '<span class="cn">' + c.n + "</span>" + (c.merged ? '<span class="mt">Merged</span>' : "") + clipSvg(c);
    return el;
  }

  function renderClips(animate) {
    TRACKS.forEach(function (t) {
      var old = rows[t.id].lane.querySelectorAll(".clip");
      for (var i = 0; i < old.length; i++) old[i].remove();
    });
    clips().forEach(function (c, i) {
      var el = clipEl(c);
      if (animate && !reduced) { el.classList.add("enter"); el.style.setProperty("--d", i); }
      rows[c.t].lane.appendChild(el);
    });
    renderEditors();
  }

  function setAvatar(el, key, pop) {
    var p = PEOPLE[key];
    el.className = "av " + (p ? p.cls : "av-none") + (pop && !reduced ? " pop" : "");
    el.textContent = p ? p.initial : "";
    el.title = p ? "Last edited by " + p.name : "No edits yet";
  }

  function renderEditors(popTrack) {
    var list = clips();
    TRACKS.forEach(function (t) {
      var by = null;
      list.forEach(function (c) { if (c.t === t.id) by = c.by; });
      setAvatar(rows[t.id].av, by, popTrack === t.id);
    });
  }

  function renderPeople(popSofie) {
    var box = $("people");
    box.innerHTML = "";
    ["y", "n"].concat(state.sofieHere ? ["s"] : []).forEach(function (k) {
      var el = document.createElement("span");
      el.className = "av " + PEOPLE[k].cls + (k === "s" && popSofie && !reduced ? " pop" : "");
      el.textContent = PEOPLE[k].initial;
      el.title = PEOPLE[k].name + (k === "y" ? "" : " is here");
      box.appendChild(el);
    });
    box.setAttribute("aria-label", "In this project: " + ["You", "Nikolaj"].concat(state.sofieHere ? ["Sofie"] : []).join(", "));
  }

  function renderClock(b) {
    var shown = reduced ? Math.floor(b * 4) / 4 : b;
    grid.style.setProperty("--p", (shown / BEATS).toFixed(5));
    var bar = Math.floor(b / 4) + 1, beat = Math.floor(b % 4) + 1, six = Math.floor((b * 4) % 4) + 1;
    var sec = b * SPB;
    clockEl.firstChild.nodeValue = pad2(bar) + "." + beat + "." + six;
    clockEl.lastChild.textContent = pad2(Math.floor(sec / 60)) + ":" + pad2(Math.floor(sec % 60)) + "." + Math.floor((sec * 10) % 10);
  }

  function setPlayUi(on) {
    var btn = $("playBtn");
    btn.setAttribute("aria-label", on ? "Pause" : "Play");
    $("playIcon").innerHTML = on
      ? '<path d="M3.5 2h3v12h-3zM9.5 2h3v12h-3z" fill="currentColor"/>'
      : '<path d="M3 1.5v13l11-6.5z" fill="currentColor"/>';
  }

  var toastTimer = 0;
  function toast(msg, ms) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("show"); }, ms || 3200);
  }

  function reveal(el, block) {
    var r = el.getBoundingClientRect();
    if (r.top >= 0 && r.bottom <= window.innerHeight) return;
    el.scrollIntoView({ block: block || "nearest", behavior: smooth() });
  }

  /* ---------- transport controls ---------- */

  $("playBtn").addEventListener("click", function () {
    if (clock.playing) stopPlayback(); else startPlayback();
  });

  $("soundBtn").addEventListener("click", function () {
    soundOn = !soundOn;
    this.setAttribute("aria-pressed", String(!soundOn));
    $("soundLbl").textContent = soundOn ? "Sound on" : "Muted";
    $("soundWaves").style.display = soundOn ? "" : "none";
    $("soundX").hidden = soundOn;
    this.setAttribute("aria-label", soundOn ? "Mute all sound" : "Turn sound on");
    if (A) A.master.gain.setTargetAtTime(soundOn ? 0.85 : 0, A.ctx.currentTime, 0.02);
  });
  $("soundBtn").setAttribute("aria-label", "Mute all sound");

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) stopPlayback();
  });

  /* ---------- knobs ---------- */

  var KNOB_FMT = {
    cutoff: function (v) { var hz = cutoffHz(v); return hz >= 1000 ? (hz / 1000).toFixed(1) + " kHz" : Math.round(hz) + " Hz"; },
    res:    function (v) { return resQ(v).toFixed(1) + " Q"; },
    mix:    function (v) { return Math.round(v * 100) + "%"; },
    decay:  function (v) { return decaySec(v).toFixed(1) + " s"; }
  };

  function arcPath(a0, a1) {
    if (a1 - a0 < 0.5) return "";
    var r = 20, cx = 25, cy = 25;
    function pt(a) { var rad = a * Math.PI / 180; return (cx + r * Math.sin(rad)).toFixed(2) + " " + (cy - r * Math.cos(rad)).toFixed(2); }
    return "M" + pt(a0) + " A" + r + " " + r + " 0 " + (a1 - a0 > 180 ? 1 : 0) + " 1 " + pt(a1);
  }

  var hintedAt = 0;
  function userTurnedKnob() {
    G.once("demo_knob_turn");
    if (!clock.playing && Date.now() - hintedAt > 5000) {
      hintedAt = Date.now();
      toast("Press play to hear it.");
    }
  }

  var knobs = {};
  Array.prototype.forEach.call(document.querySelectorAll(".knob"), function (el) {
    var param = el.dataset.param, label = el.dataset.label;
    el.tabIndex = 0;
    el.setAttribute("role", "slider");
    el.setAttribute("aria-label", label);
    el.setAttribute("aria-valuemin", "0");
    el.setAttribute("aria-valuemax", "100");
    el.innerHTML =
      '<svg viewBox="0 0 50 50" aria-hidden="true">' +
      '<path class="trackarc" d="' + arcPath(-135, 135) + '" fill="none" stroke-width="3" stroke-linecap="round"/>' +
      '<path class="valarc" fill="none" stroke-width="3" stroke-linecap="round"/>' +
      '<circle class="cap" cx="25" cy="25" r="13.5" stroke-width="1"/>' +
      '<line class="needle" x1="25" y1="25" x2="25" y2="14" stroke-width="2" stroke-linecap="round"/>' +
      '</svg><span class="kl">' + label + '</span><span class="kv"></span>';
    var valarc = el.querySelector(".valarc"), needle = el.querySelector(".needle"), kv = el.querySelector(".kv");

    function render() {
      var v = fx[param], a = -135 + 270 * v;
      valarc.setAttribute("d", arcPath(-135, a));
      needle.setAttribute("transform", "rotate(" + a.toFixed(1) + " 25 25)");
      kv.textContent = KNOB_FMT[param](v);
      el.setAttribute("aria-valuenow", String(Math.round(v * 100)));
      el.setAttribute("aria-valuetext", KNOB_FMT[param](v));
    }
    function set(v, byUser) {
      v = clamp(v, 0, 1);
      if (v === fx[param]) return;
      fx[param] = v;
      render();
      applyFx();
      if (byUser) userTurnedKnob();
    }

    var drag = null;
    el.addEventListener("pointerdown", function (e) {
      e.preventDefault();
      el.focus();
      el.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, y: e.clientY, v: fx[param] };
    });
    el.addEventListener("pointermove", function (e) {
      if (!drag) return;
      set(drag.v + (drag.y - e.clientY) / 150 + (e.clientX - drag.x) / 300, true);
    });
    function end() { drag = null; }
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    el.addEventListener("keydown", function (e) {
      var d = { ArrowUp: 0.04, ArrowRight: 0.04, ArrowDown: -0.04, ArrowLeft: -0.04, PageUp: 0.15, PageDown: -0.15 }[e.key];
      if (d != null) set(fx[param] + d, true);
      else if (e.key === "Home") set(0, true);
      else if (e.key === "End") set(1, true);
      else return;
      e.preventDefault();
    });

    render();
    knobs[param] = { el: el, set: set, render: render };
  });

  /* ---------- panels ---------- */

  var fxPanel = $("fxPanel"), histPanel = $("histPanel");

  function showPanel(which, scroll) {
    var was = state.panel;
    state.panel = which;
    fxPanel.hidden = which !== "fx";
    histPanel.hidden = which !== "hist";
    fxBtn.setAttribute("aria-expanded", String(which === "fx"));
    rows.synth.trk.classList.toggle("sel", which === "fx");
    var el = which === "fx" ? fxPanel : which === "hist" ? histPanel : null;
    if (!el) return;
    if (which !== was && !reduced) {
      el.classList.remove("enter");
      void el.offsetWidth;
      el.classList.add("enter");
    }
    if (which === "hist") rings.show();
    if (scroll) reveal(el);
  }

  /* ================================================================
     Version history rings (ported from the landing page)
     ================================================================ */

  var rings = (function () {
    var VERSIONS = [
      { v: 1,  t: "First demo",         d: "Voice memo and one loop" },
      { v: 2,  t: "Drums swapped",      d: "Borrowed break, slowed down" },
      { v: 3,  t: "Bass take",          d: "Recorded in one pass" },
      { v: 4,  t: "The good one",       d: "Chorus before the rewrite" },
      { v: 5,  t: "Chorus rewrite",     d: "New words, same melody" },
      { v: 6,  t: "Vocal comp",         d: "Nine takes, one line" },
      { v: 7,  t: "Nikolaj's pass",     d: "He joined from his laptop" },
      { v: 8,  t: "Guitar layers",      d: "Three, then two" },
      { v: 9,  t: "Synths from Berlin", d: "Plugin we don't own" },
      { v: 10, t: "Cut verse two",      d: "Song got shorter" },
      { v: 11, t: "Back to v4",         d: "Pulled the old chorus forward" },
      { v: 12, t: "Mix pass",           d: "Low end finally sits" },
      { v: 13, t: "Reference match",    d: "A little brighter" },
      { v: 14, t: "Stems for Tobias",   d: "Sent without exporting" },
      { v: 15, t: "Master, first try",  d: "Too loud" },
      { v: 16, t: "Tonight's mix",      d: "What's playing right now" }
    ];

    var HIGHLIGHT = 3;               // v4 — "The good one"
    var LATEST = VERSIONS.length - 1; // v16 — tonight's mix

    var canvas = $("ringCanvas");
    var pill = $("ringPill");
    var readout = $("ringReadout");
    var readTitle = readout.querySelector('[data-slot="title"]');
    var readDetail = readout.querySelector('[data-slot="detail"]');
    var readHint = readout.querySelector('[data-slot="hint"]');
    var ctx = canvas.getContext("2d");

    /* Deterministic wobble: each ring gets its own harmonics, so the shape is
       stable across redraws and resizes. */
    function rand(seed) {
      var x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
      return x - Math.floor(x);
    }

    var shapes = VERSIONS.map(function (_, i) {
      var h = [];
      for (var k = 0; k < 4; k++) {
        h.push({
          freq: 2 + k + Math.floor(rand(i * 9 + k) * 3),
          amp: (0.012 + rand(i * 5 + k + 40) * 0.026) / (k * 0.7 + 1),
          phase: rand(i * 3 + k + 80) * Math.PI * 2
        });
      }
      return {
        harmonics: h,
        labelAngle: (-1.05 + rand(i + 200) * 1.9) // right-hand side, top to bottom
      };
    });

    var geom = { cx: 0, cy: 0, r0: 0, step: 0, size: 0 };
    var selected = LATEST;
    var hovered = -1;
    var revealed = reduced ? VERSIONS.length : 0;
    var started = false;

    function ringRadius(i, angle) {
      var base = geom.r0 + geom.step * i;
      var w = 1;
      var h = shapes[i].harmonics;
      for (var k = 0; k < h.length; k++) w += h[k].amp * Math.sin(h[k].freq * angle + h[k].phase);
      // outer rings wander more, like the poster
      var growth = 0.45 + (i / (VERSIONS.length - 1)) * 0.9;
      return base * (1 + (w - 1) * growth);
    }

    function layout() {
      var rect = canvas.getBoundingClientRect();
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (!rect.width) return;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      geom.size = rect.width;
      geom.cx = rect.width / 2;
      geom.cy = rect.height / 2;
      var outer = Math.min(rect.width, rect.height) * 0.455;
      geom.r0 = outer * 0.075;
      geom.step = (outer - geom.r0) / (VERSIONS.length - 1);
    }

    function styles() {
      var cs = getComputedStyle(document.documentElement);
      return {
        ring: cs.getPropertyValue("--ring").trim() || "#1D2150",
        alpha: parseFloat(cs.getPropertyValue("--ring-alpha")) || 0.42,
        orange: cs.getPropertyValue("--orange").trim() || "#FE5B1E"
      };
    }

    function tracePath(i) {
      var steps = 200;
      ctx.beginPath();
      for (var s = 0; s <= steps; s++) {
        var a = (s / steps) * Math.PI * 2;
        var r = ringRadius(i, a);
        var x = geom.cx + Math.cos(a) * r;
        var y = geom.cy + Math.sin(a) * r;
        if (s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
    }

    function draw() {
      if (!geom.size) return;
      var c = styles();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.lineJoin = "round";

      for (var i = 0; i < VERSIONS.length; i++) {
        var appear = Math.max(0, Math.min(1, revealed - i));
        if (appear <= 0) continue;
        var isSel = i === selected;
        var isHov = i === hovered;
        tracePath(i);
        if (isSel) {
          ctx.strokeStyle = c.orange;
          ctx.lineWidth = Math.max(3, geom.size * 0.0085);
          ctx.globalAlpha = appear;
        } else if (i === HIGHLIGHT) {
          // demo only: point at the version worth restoring
          ctx.strokeStyle = c.orange;
          ctx.lineWidth = isHov ? 2.6 : 1.8;
          ctx.globalAlpha = appear * (isHov ? 0.95 : 0.6);
        } else {
          ctx.strokeStyle = c.ring;
          ctx.lineWidth = isHov ? 2.4 : 1.5;
          ctx.globalAlpha = appear * (isHov ? c.alpha + 0.35 : c.alpha);
        }
        ctx.stroke();
      }

      // the core: v1 is always there
      ctx.globalAlpha = Math.max(0, Math.min(1, revealed));
      ctx.fillStyle = selected === 0 ? c.orange : c.ring;
      ctx.beginPath();
      ctx.arc(geom.cx, geom.cy, Math.max(2.5, geom.size * 0.008), 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    function placePill() {
      if (!geom.size || revealed < selected + 1) { pill.hidden = true; return; }
      var item = VERSIONS[selected];
      var a = shapes[selected].labelAngle;
      var r = ringRadius(selected, a);
      pill.querySelector(".v").textContent = "v" + item.v;
      pill.querySelector(".t").textContent = item.t;
      pill.hidden = false;
      pill.style.left = (geom.cx + Math.cos(a) * r) + "px";
      pill.style.top = (geom.cy + Math.sin(a) * r) + "px";
    }

    function select(i, hint) {
      if (i < 0 || i >= VERSIONS.length) return;
      selected = i;
      var item = VERSIONS[i];
      readTitle.textContent = "v" + item.v + " · " + item.t;
      readDetail.textContent = item.d;
      readHint.textContent = hint || "";
      draw();
      placePill();
    }

    function ringAt(px, py) {
      var dx = px - geom.cx, dy = py - geom.cy;
      var dist = Math.sqrt(dx * dx + dy * dy);
      var angle = Math.atan2(dy, dx);
      var best = -1, bestGap = Infinity;
      for (var i = 0; i < VERSIONS.length; i++) {
        var gap = Math.abs(dist - ringRadius(i, angle));
        if (gap < bestGap) { bestGap = gap; best = i; }
      }
      return bestGap <= Math.max(10, geom.step * 0.62) ? best : -1;
    }

    function pointerPos(e) {
      var rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    function pick(i) {
      if (i === HIGHLIGHT) restoreV4();
      else if (i === LATEST) backToLatest();
      else select(i, "Only v4 and v16 play in this demo. Tap v4.");
    }

    canvas.addEventListener("pointermove", function (e) {
      var p = pointerPos(e);
      var i = ringAt(p.x, p.y);
      if (i !== hovered) { hovered = i; draw(); }
      canvas.style.cursor = i >= 0 ? "pointer" : "default";
    });
    canvas.addEventListener("pointerleave", function () {
      if (hovered !== -1) { hovered = -1; draw(); }
    });
    canvas.addEventListener("click", function (e) {
      var p = pointerPos(e);
      var i = ringAt(p.x, p.y);
      if (i >= 0) pick(i);
    });

    function redrawAll() { layout(); draw(); placePill(); }
    window.addEventListener("resize", redrawAll);

    function show() {
      redrawAll();
      if (started) return;
      started = true;
      if (reduced) { draw(); placePill(); return; }
      var start = null;
      (function step(ts) {
        if (start === null) start = ts;
        var p = Math.min(1, (ts - start) / 1250);
        revealed = VERSIONS.length * (1 - Math.pow(1 - p, 2.4));
        draw();
        if (p < 1) requestAnimationFrame(step);
        else { revealed = VERSIONS.length; draw(); placePill(); }
      })(performance.now());
    }

    // Where ring i sits on screen, for the guided pointer.
    function screenPoint(i) {
      var rect = canvas.getBoundingClientRect();
      var a = shapes[i].labelAngle + Math.PI; // left-hand side, away from the pill
      var r = ringRadius(i, a);
      return { x: rect.left + geom.cx + Math.cos(a) * r, y: rect.top + geom.cy + Math.sin(a) * r };
    }

    if (window.matchMedia) {
      var mq = window.matchMedia("(prefers-color-scheme: dark)");
      if (mq.addEventListener) mq.addEventListener("change", draw);
    }

    return { show: show, select: select, pick: pick, screenPoint: screenPoint, HIGHLIGHT: HIGHLIGHT, LATEST: LATEST };
  })();

  /* ---------- restore ---------- */

  var restoreLogged = false;

  function restoreV4() {
    rings.select(rings.HIGHLIGHT, "Tonight's mix is still there. Nothing was overwritten.");
    $("restoreBtn").disabled = true;
    $("latestBtn").disabled = false;
    $("viewTag").hidden = false;
    rows.vocal.lane.classList.remove("merged");
    if (state.view !== "v4") {
      state.view = "v4";
      renderClips(true);
    }
    toast("Restored v4. Tonight's mix is still v16.", 4200);
    if (!restoreLogged) { restoreLogged = true; G.track("demo_version_restore"); }
  }

  function backToLatest(silent) {
    rings.select(rings.LATEST, "Tap v4 to go back to the good one");
    $("restoreBtn").disabled = false;
    $("latestBtn").disabled = true;
    $("viewTag").hidden = true;
    if (state.view !== "now") {
      state.view = "now";
      renderClips(!silent);
      if (!silent) toast("Back on v16, tonight's mix.");
    }
  }

  $("restoreBtn").addEventListener("click", restoreV4);
  $("latestBtn").addEventListener("click", function () { backToLatest(false); });

  /* ================================================================
     Opening the shared link
     ================================================================ */

  var cover = $("cover");
  var opening = null;

  function openProject(instant) {
    if (state.opened) return Promise.resolve();
    if (opening) return opening;
    var card = cover.querySelector(".link-card");
    var fast = instant || reduced;
    if (!fast) {
      var bar = document.createElement("div");
      bar.className = "loadbar";
      card.appendChild(bar);
      $("openBtn").disabled = true;
      $("openBtn").textContent = "Opening…";
    }
    opening = wait(fast ? 0 : 750).then(function () {
      state.opened = true;
      daw.classList.add("open");
      cover.classList.add("leaving");
      setTimeout(function () { cover.hidden = true; }, fast ? 0 : 380);
      setTimeout(function () { daw.classList.add("settled"); }, fast ? 0 : 1000);
      var tag = $("installTag");
      tag.hidden = false;
      if (!reduced) tag.classList.add("pop");
      if (!instant) toast("Opened in your browser. Nothing to install.");
      renderClips(false);
      if (!stepsSeen[1]) { stepsSeen[1] = true; G.track("demo_step_1"); }
      renderStep();
      opening = null;
    });
    return opening;
  }

  function ensureOpen(instant) {
    if (!state.opened) openProject(instant);
  }

  $("openBtn").addEventListener("click", function () { openProject(false); });

  /* ================================================================
     Sofie joins
     ================================================================ */

  var peerPos = { x: 0.92, y: 0 };
  var sofieRun = null;

  function trackIndex(id) {
    for (var i = 0; i < TRACKS.length; i++) if (TRACKS[i].id === id) return i;
    return 0;
  }

  function gridMetrics() {
    var cs = getComputedStyle(grid);
    var hdr = parseFloat(cs.getPropertyValue("--hdr")) || 236;
    var row = parseFloat(cs.getPropertyValue("--row")) || 58;
    return { hdr: hdr, row: row, lane: grid.clientWidth - hdr };
  }

  // x is a fraction of the loop (0..1), y is a track index (fractional is fine).
  function placePeer() {
    var m = gridMetrics();
    var x = m.hdr + m.lane * peerPos.x;
    var y = 28 + m.row * (peerPos.y + 0.5) - 6;
    peer.style.transform = "translate(" + x.toFixed(1) + "px," + y.toFixed(1) + "px)";
    // keep her in view when the timeline scrolls sideways (phones)
    if (peer.classList.contains("on") && arrange.scrollWidth > arrange.clientWidth + 2) {
      var visL = arrange.scrollLeft + m.hdr + 16, visR = arrange.scrollLeft + arrange.clientWidth - 60;
      if (x < visL || x > visR) arrange.scrollLeft = x - m.hdr - (arrange.clientWidth - m.hdr) / 2;
    }
  }
  window.addEventListener("resize", placePeer);

  function movePeer(x, y, ms) {
    var from = { x: peerPos.x, y: peerPos.y };
    if (reduced || !ms) {
      peerPos.x = x; peerPos.y = y; placePeer();
      return wait(reduced ? Math.min(ms, 250) : 0);
    }
    return new Promise(function (resolve) {
      var t0 = performance.now();
      (function tick(ts) {
        var p = Math.min(1, (ts - t0) / ms);
        var e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
        // a slight arc, like a hand moving a mouse
        var lift = Math.sin(p * Math.PI) * 0.18;
        peerPos.x = from.x + (x - from.x) * e;
        peerPos.y = from.y + (y - from.y) * e - lift;
        placePeer();
        if (p < 1) requestAnimationFrame(tick); else resolve();
      })(t0);
    });
  }

  function sofieJoin() {
    if (state.sofie) return Promise.resolve();
    if (sofieRun) return sofieRun;
    sofieRun = (async function () {
      state.sofieHere = true;
      renderPeople(true);
      toast("Sofie joined from her laptop.");
      reveal(arrange);
      await wait(900);

      peerPos = { x: 0.95, y: 0 };
      placePeer();
      peer.classList.add("on");
      await movePeer(0.62, 2, 900);
      await movePeer(0.3, 1, 800);
      await movePeer(0.8, 4.2, 900);

      // she picks up a vocal take and drags it onto the Vocal lane at bar 3
      var m = gridMetrics();
      var carry = clipEl(SOFIE_CLIP);
      carry.classList.add("carry");
      carry.style.cssText = "left:10px;top:8px;bottom:auto;height:" + (m.row - 14) + "px;width:" + (m.lane * 0.5 - 2) + "px;margin:0;";
      carry.querySelector(".mt") && carry.querySelector(".mt").remove();
      peer.appendChild(carry);
      await wait(350);
      await movePeer(0.5, trackIndex("vocal") - 0.35, 1300);
      await wait(200);

      carry.remove();
      state.sofie = true;
      if (state.view === "now") {
        renderClips(false);
        var lane = rows.vocal.lane;
        var dropped = lane.querySelector(".by-s");
        if (dropped && !reduced) dropped.classList.add("enter");
        lane.classList.remove("merged");
        void lane.offsetWidth;
        lane.classList.add("merged");
        renderEditors("vocal");
      }
      toast("Sofie's vocal merged. Nobody overwrote anything.", 3600);
      await wait(900);
      await movePeer(0.66, 3.6, 900);
      sofieRun = null;
    })();
    return sofieRun;
  }

  /* ================================================================
     Steps
     ================================================================ */

  var LABELS = ["Open a shared link", "Bring your own setup", "Everyone works at once", "Every version, kept", "Your turn"];
  var CAPTIONS = [
    "Nikolaj sent you a link. Open it: the whole project loads in your browser.",
    "Your synth runs through your own plugins. Press play, then turn a knob.",
    "Sofie opens the same link. She drops in a vocal while you listen. The edits merge.",
    "Every change is a ring. Tap v4 to go back to the chorus before the rewrite.",
    "That's the idea. We're building it now."
  ];
  var stepsSeen = {};
  var stepItems = document.querySelectorAll("#steps li");
  var nextBtn = $("nextBtn"), backBtn = $("backBtn"), cta = $("cta");

  function renderStep() {
    var n = state.step;
    for (var i = 0; i < stepItems.length; i++) {
      var s = i + 1;
      stepItems[i].classList.toggle("current", s === n);
      stepItems[i].classList.toggle("done", s < n);
      if (s === n) stepItems[i].setAttribute("aria-current", "step"); else stepItems[i].removeAttribute("aria-current");
    }
    $("caption").innerHTML = '<span class="k">' + pad2(n) + " / 05 · " + LABELS[n - 1] + "</span><br>" + CAPTIONS[n - 1];
    backBtn.disabled = n === 1;
    nextBtn.disabled = n === 5;
    nextBtn.textContent = n === 1 && !state.opened ? "Open project" : n === 5 ? "Done" : "Next";
  }

  function goStep(n, fromUser) {
    n = clamp(n, 1, 5);
    state.step = n;
    if (n > 1 && !stepsSeen[n]) { stepsSeen[n] = true; G.track("demo_step_" + n); }
    if (n > 1) ensureOpen(true);
    cta.classList.remove("lit");

    if (n === 1) showPanel(null);
    else if (n === 2) showPanel("fx", fromUser);
    else if (n === 3) { showPanel(null); if (!state.sofie) sofieJoin(); else if (fromUser) reveal(arrange); }
    else if (n === 4) showPanel("hist", fromUser);
    else if (n === 5) {
      showPanel(null);
      void cta.offsetWidth;
      cta.classList.add("lit");
      cta.scrollIntoView({ block: "start", behavior: smooth() });
    }
    renderStep();
  }

  nextBtn.addEventListener("click", function () {
    if (state.step === 1 && !state.opened) { openProject(false); return; }
    goStep(state.step + 1, true);
  });
  backBtn.addEventListener("click", function () { goStep(state.step - 1, true); });

  /* ================================================================
     Play demo automatically
     ================================================================ */

  var autoBtn = $("autoBtn");
  var ghost = $("ghost");
  var gpos = { x: -60, y: -60 };
  var auto = { on: false, token: 0 };
  var CANCEL = { cancelled: true };

  function guard(tok) { if (!auto.on || auto.token !== tok) throw CANCEL; }
  function pause(ms, tok) { return wait(ms).then(function () { guard(tok); }); }

  function ghostPlace() { ghost.style.transform = "translate(" + gpos.x.toFixed(1) + "px," + gpos.y.toFixed(1) + "px)"; }

  function ghostTo(x, y, ms) {
    ghost.classList.add("on");
    var from = { x: gpos.x, y: gpos.y };
    if (from.x < 0) from = { x: window.innerWidth * 0.5, y: window.innerHeight * 0.8 };
    if (reduced) { gpos.x = x; gpos.y = y; ghostPlace(); return wait(120); }
    return new Promise(function (resolve) {
      var t0 = performance.now();
      (function tick(ts) {
        var p = Math.min(1, (ts - t0) / ms);
        var e = 1 - Math.pow(1 - p, 3);
        gpos.x = from.x + (x - from.x) * e;
        gpos.y = from.y + (y - from.y) * e;
        ghostPlace();
        if (p < 1) requestAnimationFrame(tick); else resolve();
      })(t0);
    });
  }

  function ghostTap() {
    ghost.classList.remove("click");
    void ghost.offsetWidth;
    ghost.classList.add("click");
  }

  async function bringIntoView(el, tok) {
    var r = el.getBoundingClientRect();
    if (r.top < 70 || r.bottom > window.innerHeight - 30) {
      el.scrollIntoView({ block: "center", behavior: smooth() });
      await pause(reduced ? 80 : 550, tok);
    }
  }

  async function ghostClick(el, tok) {
    await bringIntoView(el, tok);
    var r = el.getBoundingClientRect();
    await ghostTo(r.left + r.width * 0.55, r.top + r.height * 0.6, 650);
    guard(tok);
    ghostTap();
    await pause(170, tok);
    el.click();
  }

  async function ghostKnob(param, values, tok) {
    var k = knobs[param];
    await bringIntoView(k.el, tok);
    var r = k.el.getBoundingClientRect();
    var cx = r.left + r.width / 2, cy = r.top + 25;
    await ghostTo(cx + 4, cy + 4, 650);
    guard(tok);
    ghostTap();
    for (var i = 0; i < values.length; i++) {
      var from = fx[param], to = values[i][0], ms = values[i][1];
      var t0 = performance.now();
      await new Promise(function (resolve) {
        (function tick(ts) {
          if (!auto.on || auto.token !== tok) return resolve();
          var p = Math.min(1, (ts - t0) / ms);
          var e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
          var v = from + (to - from) * e;
          k.set(v, false);
          gpos.y = cy + 4 - (v - 0.5) * 60;
          ghostPlace();
          if (p < 1) requestAnimationFrame(tick); else resolve();
        })(t0);
      });
      guard(tok);
    }
  }

  async function ghostRing(i, tok) {
    var canvas = $("ringCanvas");
    await bringIntoView(canvas, tok);
    await pause(300, tok);
    var p = rings.screenPoint(i);
    await ghostTo(p.x, p.y, 800);
    guard(tok);
    ghostTap();
    await pause(170, tok);
    rings.pick(i);
  }

  function resetForTour() {
    if (state.view !== "now") backToLatest(true);
    Object.keys(FX_DEFAULT).forEach(function (k) { knobs[k].set(FX_DEFAULT[k], false); });
  }

  async function runAuto() {
    var tok = ++auto.token;
    auto.on = true;
    autoBtn.textContent = "Stop autoplay";
    autoBtn.setAttribute("aria-pressed", "true");
    G.track("demo_autoplay");
    try {
      resetForTour();
      if (state.step !== 1) goStep(1);
      await pause(200, tok);

      // 1. open the shared link
      if (!state.opened) {
        await ghostClick($("openBtn"), tok);
        await pause(reduced ? 600 : 1700, tok);
      }
      if (!clock.playing) {
        await ghostClick($("playBtn"), tok);
      }
      await pause(2600, tok);

      // 2. bring your own setup
      await ghostClick(nextBtn, tok);
      await pause(900, tok);
      await ghostKnob("cutoff", [[0.12, 1700], [0.85, 1500], [0.5, 800]], tok);
      await pause(400, tok);
      await ghostKnob("mix", [[0.78, 1400]], tok);
      await pause(1600, tok);

      // 3. everyone works at once
      await ghostClick(nextBtn, tok);
      ghost.classList.remove("on");
      await pause(300, tok);
      if (sofieRun) await sofieRun;
      guard(tok);
      await pause(1600, tok);

      // 4. every version, kept
      await ghostClick(nextBtn, tok);
      await pause(1300, tok);
      await ghostRing(rings.HIGHLIGHT, tok);
      await pause(3800, tok);

      // 5. closing CTA
      await ghostClick(nextBtn, tok);
      await pause(900, tok);
    } catch (e) {
      if (e !== CANCEL) console.error(e);
    }
    if (auto.token === tok) endAuto();
  }

  function endAuto() {
    auto.on = false;
    auto.token++;
    ghost.classList.remove("on");
    autoBtn.textContent = "Play demo automatically";
    autoBtn.setAttribute("aria-pressed", "false");
  }

  autoBtn.addEventListener("click", function () {
    if (auto.on) endAuto(); else runAuto();
  });

  // Any real interaction takes the wheel back from the tour.
  function interrupt(e) {
    if (!auto.on || !e.isTrusted) return;
    if (autoBtn.contains(e.target)) return;
    endAuto();
  }
  document.addEventListener("pointerdown", interrupt, true);
  document.addEventListener("keydown", interrupt, true);

  /* ================================================================
     Funnel + boot
     ================================================================ */

  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a[href]");
    if (!a) return;
    var url = new URL(a.getAttribute("href"), location.href);
    if (url.origin === location.origin && url.pathname.replace(/\/+$/, "") === "/signup") G.track("signup_click");
  });

  renderPeople(false);
  renderClips(false);
  renderClock(0);
  renderStep();
  applyMix(true);
  G.track("demo_view");
})();
