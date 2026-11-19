// Challenge status page. Written by `cb feed` (crates/cb/src/pages.rs).
// Every string from data or state.json is untrusted: it goes into the DOM
// through textContent or setAttribute only, and links must be github.com.
"use strict";
(function () {
  var DATA = JSON.parse(document.getElementById("site-data").textContent);
  var STATE = null; // state.json, when published
  var app = document.getElementById("app");
  var SVG = "http://www.w3.org/2000/svg";
  var LOADED = Date.now(); // the record line draws in on load only (and on the re-render state.json triggers)

  var STATES = {
    pending: { word: "Open, baseline pending", short: "Baseline pending", order: 0 },
    open: { word: "Open for submissions", short: "Open", order: 1 },
    draft: { word: "Draft", short: "Draft", order: 2 },
    closed: { word: "Closed", short: "Closed", order: 3 }
  };
  var OUTCOMES = {
    baseline: ["Baseline", "base"],
    promoted: ["New record", "good"],
    valid_claim_better: ["Claims a record", "claim"],
    valid_not_promoted: ["Valid, not a record", "plain"],
    rejected: ["Rejected", "bad"],
    infra_failed: ["Infra failure", "warn"]
  };
  // What the record history shows: the baseline, each promotion, and each PR
  // that claimed a record. Rejections and failed runs stay in the data.
  var HISTORY = { baseline: 1, promoted: 1, valid_claim_better: 1 };
  // What the chart shows: the record line's own points.
  var RECORDS = { baseline: 1, promoted: 1 };
  var STAGES = { pr: "PR check", promotion: "Promotion on main", baseline: "Baseline on main" };

  // ---------- helpers ----------
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = String(text);
    return e;
  }
  function svg(tag, attrs) {
    var e = document.createElementNS(SVG, tag);
    for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) e.setAttribute(k, String(attrs[k]));
    return e;
  }
  function add(parent) {
    for (var i = 1; i < arguments.length; i++) {
      var c = arguments[i];
      if (c === null || c === undefined || c === false) continue;
      parent.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return parent;
  }
  function str(v) { return typeof v === "string" ? v : ""; }
  function num(v) { return typeof v === "number" && isFinite(v) ? v : null; }
  function safeUrl(u) {
    if (typeof u !== "string") return null;
    try {
      var p = new URL(u);
      return p.protocol === "https:" && p.hostname === "github.com" && u.indexOf("https://github.com/") === 0 ? p.href : null;
    } catch (e) { return null; }
  }
  function link(text, url, cls) {
    var href = safeUrl(url);
    if (!href) return el("span", cls, text);
    var a = el("a", cls, text);
    a.setAttribute("href", href);
    a.setAttribute("rel", "noreferrer noopener");
    return a;
  }
  var DEC = 0; // decimals for the challenge being rendered: 4 when its values aren't whole
  var TIMES = false; // the challenge being rendered scores a speedup: values read as "1.024×"
  // A maximised speedup is a multiple of the baseline's speed, so it reads as "1.024× faster".
  function isSpeedup(c) { return c.direction === "maximise" && /speedup/i.test(str(c.metric)); }
  function decimalsFor(c) {
    if (isSpeedup(c)) return 3;
    var vals = [c.baseline && c.baseline.value, c.record && c.record.value, c.to_beat];
    if (Array.isArray(c.attempts)) c.attempts.forEach(function (a) { vals.push(a.value); });
    return vals.some(function (v) { return num(v) !== null && !Number.isInteger(v); }) ? 4 : 0;
  }
  function fmt(v, dec) {
    v = num(v);
    if (v === null) return "–";
    var a = Math.abs(v);
    dec = dec === undefined ? DEC : dec;
    if (dec && a < 1000) return v.toFixed(dec);
    if (Number.isInteger(v)) return v.toLocaleString("en-US");
    if (a >= 1000) return Math.round(v).toLocaleString("en-US");
    return String(Number(v.toPrecision(5)));
  }
  // A score with its unit: "1.024×" for a speedup, the bare number otherwise.
  function val(v, dec, times) {
    var t = fmt(v, dec);
    return t !== "–" && (times === undefined ? TIMES : times) ? t + "×" : t;
  }
  // A score as a phrase: "1.024× faster", or "41 length".
  function scoreText(c, v, dec) {
    return isSpeedup(c) ? val(v, dec, true) + " faster" : fmt(v, dec) + " " + c.metric;
  }
  function pct(v) {
    v = num(v);
    if (v === null) return "";
    return (v > 0 ? "+" : v < 0 ? "−" : "±") + Math.abs(v).toFixed(2) + "%";
  }
  function time(iso) {
    var s = str(iso);
    var d = s ? new Date(s) : null;
    var t = el("time", "when");
    if (!d || isNaN(d.getTime())) { t.textContent = s || "–"; return t; }
    t.setAttribute("datetime", d.toISOString());
    t.setAttribute("title", d.toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC"));
    t.textContent = ago(d);
    return t;
  }
  function ago(d) {
    var s = (Date.now() - d.getTime()) / 1000;
    if (s < 0) s = 0;
    if (s < 90) return "just now";
    if (s < 5400) return Math.round(s / 60) + " min ago";
    if (s < 129600) return Math.round(s / 3600) + " h ago";
    if (s < 3888000) return Math.round(s / 86400) + " days ago";
    return d.toISOString().slice(0, 10);
  }
  function absTime(iso) {
    var d = new Date(str(iso));
    return isNaN(d.getTime()) ? str(iso) || "–" : d.toISOString().slice(0, 16).replace("T", " ") + " UTC";
  }
  function bipsText(b) {
    if (!b) return "Any improvement on the record counts";
    return (b / 100).toFixed(b % 100 ? 2 : 0) + "% (" + b + " bips) past the record";
  }
  function better(c) { return c.direction === "maximise" ? "higher is better" : "lower is better"; }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function lastActivity(c) {
    var a = Array.isArray(c.attempts) ? c.attempts[0] : null;
    if (c.type === "research") a = subs(c).slice().sort(function (x, y) { return str(y.at) < str(x.at) ? -1 : 1; })[0];
    var t = a ? Date.parse(a.at) : NaN;
    return isNaN(t) ? 0 : t;
  }
  function badge(state, long) {
    var s = STATES[state] || STATES.draft;
    var b = el("span", "state state-" + (STATES[state] ? state : "draft"));
    add(b, el("span", "dot"), long ? s.word : s.short);
    return b;
  }
  function section(title, note) {
    var s = el("section", "panel block");
    var h = add(el("div", "block-head"), el("h2", null, title));
    if (note) add(h, note);
    add(s, h);
    return s;
  }
  function empty(text) { return el("p", "empty", text); }
  function table(headers, rows, cls) {
    var wrap = el("div", "table-wrap");
    var t = el("table", cls);
    var tr = el("tr");
    headers.forEach(function (h) {
      var th = el("th", h[1] || null, h[0]);
      th.setAttribute("scope", "col");
      tr.appendChild(th);
    });
    add(t, add(el("thead"), tr));
    var tb = el("tbody");
    rows.forEach(function (r) {
      var row = el("tr");
      r.forEach(function (cell, i) {
        var td = el("td", headers[i][1] || null);
        td.setAttribute("data-label", headers[i][0]);
        if (cell && cell.nodeType) td.appendChild(cell); else td.textContent = cell === null || cell === undefined ? "" : String(cell);
        row.appendChild(td);
      });
      tb.appendChild(row);
    });
    add(t, tb);
    return add(wrap, t);
  }
  function short(sha) { return str(sha).slice(0, 7); }
  function pullsFor(c) {
    return STATE && Array.isArray(STATE.pulls) ? STATE.pulls.filter(function (p) {
      return Array.isArray(p.challenges) && p.challenges.indexOf(c.slug) >= 0;
    }) : [];
  }
  // The bar, rounded away from the record so the shown number is never short of it.
  function targetText(c) {
    var t = num(c.to_beat);
    if (t === null) return "–";
    var maxi = c.direction === "maximise";
    if (DEC) { var k = Math.pow(10, DEC); t = (maxi ? Math.ceil(t * k - 1e-9) : Math.floor(t * k + 1e-9)) / k; }
    return (maxi ? (c.min_improvement_bips ? "≥ " : "> ") : (c.min_improvement_bips ? "≤ " : "< ")) + val(t);
  }

  // ---------- ordering & routing ----------
  var challenges = (DATA.challenges || []).slice().sort(function (a, b) {
    var oa = (STATES[a.state] || STATES.draft).order, ob = (STATES[b.state] || STATES.draft).order;
    if (oa !== ob) return oa - ob;
    var la = lastActivity(a), lb = lastActivity(b);
    if (la !== lb) return lb - la;
    return a.slug < b.slug ? -1 : 1;
  });
  function current() {
    var h = location.hash.replace(/^#/, "");
    try { h = decodeURIComponent(h); } catch (e) { /* "#%": not a slug, fall through to the first */ }
    for (var i = 0; i < challenges.length; i++) if (challenges[i].slug === h) return challenges[i];
    return challenges[0] || null;
  }

  // ---------- the scoreboard ----------
  function goal(c) {
    var box = el("aside", "goal");
    box.setAttribute("aria-label", "The bar to beat");
    var base = c.baseline && num(c.baseline.value);
    if (base === null) {
      add(box, el("p", "goal-label", "The bar to beat"), el("p", "goal-value", "–"),
        el("p", "goal-unit", c.state === "draft" ? "Set when the challenge opens." : "Set by the first run on main. Submissions are scored against it."));
    } else {
      add(box, el("p", "goal-label", "Your submission needs"), el("p", "goal-value", targetText(c)),
        el("p", "goal-unit", TIMES ? "faster than the original code" : c.metric + ", " + better(c)));
      var rows = el("dl", "goal-rows");
      var rec = c.record ? num(c.record.value) : null;
      var maxi = c.direction === "maximise";
      function row(k, v, cls) { add(rows, add(el("div", cls), el("dt", null, k), add(el("dd"), v))); }
      row("Current record", val(rec !== null ? rec : base), "rec");
      row("Held by", c.record ? str(c.record.by) || "unknown" : "the baseline");
      row("Margin", c.min_improvement_bips ? (c.min_improvement_bips / 100).toFixed(c.min_improvement_bips % 100 ? 2 : 0) + "% past the record" : "any improvement");
      if (rec !== null && base) row(TIMES ? "Record vs original" : "Improvement", TIMES
        ? (rec >= base ? pct((rec - base) / base * 100).slice(1) + " faster" : pct((rec - base) / base * 100).slice(1) + " slower")
        : pct((maxi ? rec - base : base - rec) / Math.abs(base) * 100));
      add(box, rows);
    }
    var go = el("button", "cta", c.state === "open" || c.state === "pending" ? "How to enter" : "How submissions work");
    go.setAttribute("type", "button");
    go.addEventListener("click", function () {
      var t = document.getElementById("enter");
      if (t) { t.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }); t.focus({ preventScroll: true }); }
    });
    add(box, go);
    return box;
  }

  function stats(c) {
    var list = (c.attempts || []).filter(function (a) { return a.status !== "baseline"; });
    var people = {};
    list.forEach(function (a) { if (str(a.by)) people[a.by] = 1; });
    var lastRec = (c.attempts || []).filter(function (a) { return a.status === "promoted" || a.status === "baseline"; })[0];
    var dl = el("dl", "stats");
    function stat(k, v) { add(dl, add(el("div", "stat"), el("dt", null, k), add(el("dd"), v))); }
    stat("Attempts", String(list.length));
    stat("Contributors", String(Object.keys(people).length));
    stat("Open PRs", STATE ? String(pullsFor(c).length) : "–");
    stat(c.record ? "Last record" : "Baseline set", lastRec ? time(lastRec.at) : "–");
    return dl;
  }

  function chartBox(c) {
    var box = el("div", "chart-box");
    var ch = el("div", "chart" + (c.baseline && num(c.baseline.value) !== null ? "" : " chart-pending"));
    ch.setAttribute("data-slug", c.slug);
    var legend = el("ul", "legend");
    [["key-rec", "Record (baseline, then each promotion)"],
      ["key-tgt", "Bar the next record must reach"], ["key-zone", "New-record zone"]]
      .forEach(function (k) { if (k) add(legend, add(el("li"), el("span", "key " + k[0]), k[1])); });
    return add(box, ch, ch.className === "chart" ? legend : null);
  }

  // Record progression: the baseline and each promotion as points on a
  // stepped line, the bar to beat as a dashed line. Better is always up.
  function drawChart(c, host) {
    host.textContent = "";
    var W = host.clientWidth, H = host.clientHeight;
    if (!W || !H) return;
    var base = c.baseline && num(c.baseline.value);
    if (base === null) {
      add(host, el("div", "chart-empty", c.state === "draft"
        ? "Not open yet. The record line starts when the baseline is recorded."
        : "Baseline pending. Submissions are scored against it once it is recorded."));
      return;
    }
    var maxi = c.direction === "maximise";
    var now = Date.parse(DATA.generated_at) || Date.now();
    var pts = (c.attempts || []).filter(function (a) { return RECORDS[a.status] && num(a.value) !== null && !isNaN(Date.parse(a.at)); })
      .map(function (a) { return { t: Date.parse(a.at), v: a.value, s: str(a.status), by: str(a.by), stage: str(a.stage) }; })
      .sort(function (a, b) { return a.t - b.t; });
    var steps = pts.filter(function (p) { return p.s === "baseline" || p.s === "promoted"; });
    if (!steps.length) steps = [{ t: Date.parse(c.baseline.at) || now, v: base, s: "baseline" }];
    var target = num(c.to_beat);

    var vals = pts.map(function (p) { return p.v; }).concat(steps.map(function (p) { return p.v; }));
    if (target !== null) vals.push(target);
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    var span = hi - lo || Math.abs(hi) * 0.02 || 1;
    lo -= span * 0.18; hi += span * 0.22;
    // Round ticks: a step of 1, 2 or 5 times a power of ten, about four of them.
    var raw = (hi - lo) / 4, mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag;
    var step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * mag;
    lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
    var tickDec = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
    var t0 = Math.min.apply(null, pts.map(function (p) { return p.t; }).concat([steps[0].t])), t1 = Math.max(now, t0 + 1);
    t0 -= (t1 - t0) * 0.03;
    var narrow = W < 520;
    var L = narrow ? 44 : 60, R = narrow ? 12 : 24, T = 14, B = 26;
    function x(t) { return L + (t - t0) / (t1 - t0) * (W - L - R); }
    function y(v) { var f = (v - lo) / (hi - lo); return T + (maxi ? 1 - f : f) * (H - T - B); }

    var s = svg("svg", { width: W, height: H, viewBox: "0 0 " + W + " " + H, role: "img" });
    var rec = c.record ? num(c.record.value) : null;
    s.setAttribute("aria-label", "Record progression for " + c.slug + ": baseline " + val(base) + ", record " + val(rec !== null ? rec : base) +
      (target !== null ? ", the next record needs " + targetText(c) : "") + " " + (TIMES ? "faster" : c.metric + ", " + better(c)) + ". " + steps.length + " records.");

    // grid and y labels
    for (var v = lo; v <= hi + step / 2; v += step) {
      var yy = y(v);
      add(s, svg("line", { x1: L, x2: W - R, y1: yy, y2: yy, "class": "grid" }));
      var lab = svg("text", { x: L - 10, y: yy + 4, "text-anchor": "end" });
      lab.textContent = v.toFixed(tickDec) + (TIMES ? "×" : "");
      add(s, lab);
    }
    // x labels: the first point's date and now
    function dateText(t) { return new Date(t).toISOString().slice(5, 10).replace("-", "/"); }
    var xr = svg("text", { x: W - R, y: H - 6, "text-anchor": "end" }); xr.textContent = "now";
    add(s, xr);
    var DAY = 86400000, every = Math.max(1, Math.ceil(70 / ((W - L - R) * DAY / (t1 - t0))));
    for (var dt = Math.ceil(t0 / DAY) * DAY, i = 0; dt < t1; dt += DAY, i++) {
      if (i % every || x(dt) > W - R - 50) continue;
      add(s, svg("line", { x1: x(dt), x2: x(dt), y1: H - B, y2: H - B + 4, "class": "grid" }));
      var xt = svg("text", { x: x(dt), y: H - 6, "text-anchor": "middle" }); xt.textContent = dateText(dt);
      add(s, xt);
    }

    // record step path, extended to now
    var d = "", prev = null;
    steps.forEach(function (p) {
      var px = x(p.t), py = y(p.v);
      d += prev === null ? "M" + px + " " + py : " H" + px + " V" + py;
      prev = p;
    });
    var endX = x(t1), endY = y(steps[steps.length - 1].v);
    d += " H" + endX;
    var floor = H - B;
    add(s, svg("path", { d: d + " V" + floor + " H" + x(steps[0].t) + " Z", "class": "rec-area" }));

    // the bar to beat
    if (target !== null) {
      var ty = y(target);
      var zy = maxi ? T : ty, zh = maxi ? ty - T : H - B - ty;
      if (zh > 0) add(s, svg("rect", { x: L, y: zy, width: W - L - R, height: zh, "class": "tgt-zone" }));
      add(s, svg("line", { x1: L, x2: W - R, y1: ty, y2: ty, "class": "tgt-line" }));
      var tl = svg("text", { x: W - R, y: ty - 8, "text-anchor": "end", "class": "tgt-label" });
      tl.textContent = "Beat this: " + targetText(c) + (TIMES ? " faster" : "");
      add(s, tl);
    }
    var line = svg("path", { d: d, "class": "rec-line" });
    add(s, line);

    // value labels: records always, claims when there is room
    var boxes = [];
    function room(bx) {
      return !boxes.some(function (o) { return bx.x < o.x + o.w && o.x < bx.x + bx.w && bx.y < o.y + o.h && o.y < bx.y + bx.h; });
    }
    function label(p, text, cls, below) {
      var px = x(p.t), py = y(p.v), w = text.length * 6.6 + 4, h = 14;
      var anchor = px + w / 2 > W - R ? "end" : px - w / 2 < L ? "start" : "middle";
      var lx = anchor === "end" ? px - w : anchor === "start" ? px : px - w / 2;
      var tries = below ? [py + 8, py - 10 - h] : [py - 10 - h, py + 8];
      for (var k = 0; k < tries.length; k++) {
        var bx = { x: lx, y: tries[k], w: w, h: h };
        if (bx.y < 0 || bx.y + h > H - B) continue;
        if (!room(bx)) continue;
        boxes.push(bx);
        var t = svg("text", { x: anchor === "end" ? px : anchor === "start" ? px : px, y: bx.y + 11, "text-anchor": anchor, "class": cls });
        t.textContent = text;
        add(s, t);
        return;
      }
    }
    // reserve the fixed labels first
    if (target !== null) boxes.push({ x: W - R - 200, y: y(target) - 22, w: 200, h: 16 }, { x: L, y: y(target) - 2, w: W - L - R, h: 4 });
    boxes.push({ x: endX - 130, y: endY + 6, w: 130, h: 16 });
    pts.forEach(function (p) { boxes.push({ x: x(p.t) - 6, y: y(p.v) - 6, w: 12, h: 12 }); });
    // the standing record is labelled at the right edge already
    steps.slice(0, -1).forEach(function (p) { label(p, (p.s === "baseline" ? "Baseline " : "") + val(p.v), "rec-label", true); });

    // records
    pts.forEach(function (p) {
      var mark = svg("circle", { cx: x(p.t), cy: y(p.v), r: 5.5, "class": "pt-" + p.s });
      var tt = svg("title", {});
      tt.textContent = (OUTCOMES[p.s] ? OUTCOMES[p.s][0] : p.s) + ": " + scoreText(c, p.v) + (p.by ? ", " + p.by : "") + ", " + (STAGES[p.stage] || p.stage) + ", " + new Date(p.t).toISOString().slice(0, 16).replace("T", " ") + " UTC";
      add(mark, tt);
      add(s, mark);
    });

    // the standing record, at the right edge
    add(s, svg("circle", { cx: endX, cy: endY, r: 5, "class": "halo" }), svg("circle", { cx: endX, cy: endY, r: 4, "class": "pt-promoted" }));
    var nl = svg("text", { x: endX - 10, y: endY + 18, "text-anchor": "end", "class": "now-label" });
    nl.textContent = "Record " + val(steps[steps.length - 1].v);
    add(s, nl);

    add(host, s);
    if (Date.now() - LOADED < 1500) {
      var len = Math.ceil(line.getTotalLength ? line.getTotalLength() : 0);
      if (len) { host.style.setProperty("--len", String(len)); host.classList.add("animate"); }
    }
  }

  function stage(c) {
    var band = el("section", "stage");
    band.setAttribute("aria-label", "Scoreboard");
    var w = el("div", "wrap");
    var left = el("div", "hero-text");
    var kicker = add(el("div", "kicker"), badge(c.state, true));
    if (c.type === "research") add(kicker, el("span", null, "Research challenge"));
    else if (str(c.family)) add(kicker, el("span", null, cap(c.family) + " challenge"));
    add(left, kicker, el("h1", "slug", c.slug));
    if (str(c.title)) add(left, el("p", "title", c.title));
    if (str(c.summary)) {
      var sum = el("p", "summary clamped", c.summary);
      sum.setAttribute("id", "summary");
      var more = el("button", "more", "Read more");
      more.setAttribute("type", "button");
      more.setAttribute("aria-expanded", "false");
      more.setAttribute("aria-controls", "summary");
      more.addEventListener("click", function () {
        var open = sum.classList.toggle("clamped") === false;
        more.textContent = open ? "Show less" : "Read more";
        more.setAttribute("aria-expanded", open ? "true" : "false");
      });
      add(left, sum, more);
    }
    if (c.type === "research") return add(band, add(w, add(el("div", "hero hero-solo"), left), researchStats(c), el("div", "chart-gap")));
    add(w, add(el("div", "hero"), left, goal(c)), stats(c), chartBox(c));
    return add(band, w);
  }

  // ---------- sections ----------
  // Copies text; done(true) on success. The async clipboard API needs a secure
  // context and permission, so a hidden textarea + execCommand is the fallback.
  function copyText(text, done) {
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.setAttribute("aria-hidden", "true");
      ta.style.cssText = "position:fixed;top:-1000px;left:0;opacity:0";
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      done(ok);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, fallback);
    } else fallback();
  }

  // The participant prompt (PROMPT.md): pasted into a coding agent to start on
  // the challenge. Copy is the main action; the text itself is one click away.
  function promptBox(c) {
    var box = el("div", "prompt");
    add(box, el("h3", null, "Start with your coding agent"),
      el("p", "prompt-lead", "Paste this prompt into Claude Code, Codex or another coding agent. It gives the agent the goal, the rules and how to submit."));
    var row = el("div", "prompt-actions");
    var btn = el("button", "copy", "Copy prompt");
    btn.setAttribute("type", "button");
    var status = el("span", "copy-status");
    status.setAttribute("role", "status");
    var details = el("details", "prompt-text");
    var pre = el("pre", null, c.prompt);
    pre.setAttribute("tabindex", "0");
    add(details, el("summary", null, "Read the prompt"), pre);
    var timer = null;
    btn.addEventListener("click", function () {
      copyText(c.prompt, function (ok) {
        clearTimeout(timer);
        if (ok) {
          btn.textContent = "Copied";
          status.textContent = "Prompt copied. Paste it into your agent.";
          timer = setTimeout(function () { btn.textContent = "Copy prompt"; status.textContent = ""; }, 4000);
        } else {
          // Leave the text selected so a manual copy is one keystroke.
          details.open = true;
          var range = document.createRange();
          range.selectNodeContents(pre);
          var sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
          status.textContent = "Copying is blocked here. The prompt is selected below: copy it with Ctrl+C or Cmd+C.";
        }
      });
    });
    add(row, btn, status);
    return add(box, row, details);
  }

  function enter(c) {
    var s = el("section", "panel enter");
    s.setAttribute("id", "enter");
    s.setAttribute("tabindex", "-1");
    add(s, el("h2", null, "How to enter"));
    if (c.state === "draft" || c.state === "closed") add(s, el("p", "callout", c.state === "draft" ? "This challenge is a draft: submissions aren't scored yet." : "This challenge is closed to new submissions."));
    var lead = el("p", "enter-lead");
    if (c.type === "research") {
      add(lead, "Open a pull request that adds one directory under ", el("code", null, "challenges/" + c.slug + "/submissions/"),
        ". CI judges it and comments the result on the PR.");
    } else {
      add(lead, "Open a pull request that changes only ");
      (c.editable || []).forEach(function (e, i) {
        if (i) add(lead, ", ");
        add(lead, el("code", null, "challenges/" + c.slug + "/" + e));
      });
      add(lead, ". CI scores it and comments the result on the PR.");
    }
    add(s, lead);
    if (str(c.prompt) && (c.state === "open" || c.state === "pending")) add(s, promptBox(c));
    var steps = c.submit_steps || [];
    if (steps.length) {
      var ol = el("ol", "steps");
      steps.forEach(function (t) {
        var i = t.indexOf(". ");
        var li = el("li");
        if (i > 0 && i < 80) add(li, el("span", "step-head", t.slice(0, i + 1)), el("span", "step-body", t.slice(i + 2)));
        else add(li, el("span", "step-head", t));
        ol.appendChild(li);
      });
      add(s, ol);
    } else add(s, empty("See SUBMITTING.md in the challenge directory."));
    add(s, el("p", "sources", "The full walkthrough is in the challenge's SUBMITTING.md, the rules in its README.md."));
    return s;
  }

  function facts(c) {
    var s = el("section", "panel");
    add(s, el("h2", null, "Rules at a glance"));
    var dl = el("dl", "facts");
    function row(k, v) { add(dl, add(el("div"), el("dt", null, k), add(el("dd"), v))); }
    row("Metric", el("span", "mono", c.metric));
    row("Direction", cap(better(c)));
    row("Bar", bipsText(c.min_improvement_bips));
    var paths = el("span");
    (c.editable || []).forEach(function (p, i) { if (i) paths.appendChild(document.createTextNode(", ")); paths.appendChild(el("code", null, "challenges/" + c.slug + "/" + p)); });
    row("Editable", paths);
    row("Size cap", fmt(c.max_bytes, 0) + " bytes");
    var data = el("span");
    if (c.feed) {
      var f = el("a", null, c.feed);
      f.setAttribute("href", c.feed);
      add(data, f, ", ");
    }
    var all = el("a", null, "challenges.json");
    all.setAttribute("href", "challenges.json");
    add(data, all);
    row("Data", data);
    return add(s, dl);
  }

  function board(c) {
    var s = section("Leaderboard", el("span", "block-note", "Promoted results: two agreeing sandboxed runs on main"));
    if (!(c.board || []).length) {
      var p = el("p", "empty");
      if (c.baseline) add(p, el("strong", null, "No one is on the board yet."), " The first submission that reaches " + targetText(c) + " " + (TIMES ? "faster" : c.metric) + " and passes promotion takes first place.");
      else add(p, "Empty until the baseline is recorded.");
      add(s, p);
      return s;
    }
    add(s, table([["#", "n"], ["Solver"], [TIMES ? "Speedup" : c.metric, "n"], ["vs baseline", "n"], ["When"], ["Commit"]],
      c.board.map(function (r) {
        var who = el("span", null, str(r.solver) || "unknown");
        if (str(r.model)) add(who, el("span", "sub", " " + r.model));
        return [el("span", "rank", String(r.rank)), who, val(r.value), pct(r.delta_pct), time(r.at), commitCell(c, r.commit, (str(r.solver) || "unknown") + ", " + val(r.value))];
      }), "board"));
    return s;
  }

  // The history of the record: the baseline, each promotion, and each PR that
  // claimed a record. Rejections and failed runs stay in the data, not here.
  // Long measured floats in a reason ("1.0963363298988489") read as "1.0963".
  function tidy(t) { return t.replace(/\d+\.\d{5,}/g, function (m) { return Number(m).toFixed(4); }); }
  function attempts(c) {
    var list = (c.attempts || []).filter(function (a) { return HISTORY[a.status]; });
    var counts = {};
    list.forEach(function (a) { counts[a.status] = (counts[a.status] || 0) + 1; });
    var note = el("span", "block-note", list.length ? "Baseline, records and claims, newest first" : "");
    var s = section("Record history", note);
    if (!list.length) {
      add(s, empty(c.state === "draft" ? "Nothing yet: the challenge isn't open." : "Nothing yet. The baseline, every new record and every PR claiming one are listed here."));
      return s;
    }
    var sum = el("p", "tally");
    Object.keys(OUTCOMES).forEach(function (k) {
      if (counts[k]) add(sum, el("span", "outcome o-" + OUTCOMES[k][1], OUTCOMES[k][0] + " " + counts[k]));
    });
    add(s, sum);
    add(s, table([["When"], ["Outcome"], [TIMES ? "Speedup" : c.metric, "n"], ["By"], ["Commit"], ["Detail", "detail"]],
      list.map(function (a) {
        var o = OUTCOMES[a.status] || [str(a.status) || "unknown", "plain"];
        return [time(a.at), el("span", "outcome o-" + o[1], o[0]), val(a.value),
          str(a.by), commitCell(c, a.commit, o[0] + ": " + val(a.value) + (str(a.by) ? ", " + a.by : "")), el("span", "reason", tidy(str(a.reason)))];
      }), "attempts"));
    return s;
  }

  // ---------- diffs ----------
  // A submission's diff, diffs/<slug>/<commit>.patch, fetched when opened.
  // Its text is the submission's own: rendered line by line as textContent.
  function diffPath(p) {
    p = str(p);
    return /^diffs\/[A-Za-z0-9._-]+\/[0-9a-f]{40}\.patch$/.test(p) ? p : null;
  }
  function diffFor(c, commit) {
    var a = (c.attempts || []).filter(function (a) { return a.commit === commit && diffPath(a.diff); })[0];
    return a ? a.diff : null;
  }
  // The commit, with a button opening its diff when there is one.
  function commitCell(c, commit, title) {
    var wrap = el("span", "commit");
    add(wrap, el("code", null, short(commit)));
    var p = diffPath(diffFor(c, commit));
    if (p) {
      var b = el("button", "diff-btn", "Diff");
      b.setAttribute("type", "button");
      b.setAttribute("aria-label", "View the diff of " + short(commit));
      b.addEventListener("click", function () { openDiff(p, short(commit), title); });
      add(wrap, b);
    }
    return wrap;
  }
  function diffLines(text) {
    var files = el("div", "diff-files");
    var file = null, body = null, stat = null, adds = 0, dels = 0;
    function close() { if (stat) stat.textContent = "+" + adds + " −" + dels; }
    text.replace(/\n$/, "").split("\n").forEach(function (line) {
      if (/^diff --git /.test(line)) {
        close();
        adds = dels = 0;
        var m = /^diff --git a\/(.*) b\/(.*)$/.exec(line);
        var name = m ? m[2] : line.slice(11);
        file = el("details", "diff-file");
        file.open = true;
        stat = el("span", "diff-stat");
        add(file, add(el("summary"), el("span", "diff-name", name), stat));
        body = el("div", "diff-body");
        add(file, body);
        add(files, file);
        return;
      }
      if (!body) { body = el("div", "diff-body"); add(files, body); }
      var cls = "dl";
      if (/^(index |--- |\+\+\+ |new file|deleted file|similarity|rename |old mode|new mode|Binary )/.test(line) && !/^@@/.test(line)) {
        if (/^(--- |\+\+\+ |index )/.test(line)) return; // the file header says it
        cls += " dl-meta";
      } else if (line.charAt(0) === "@") cls += " dl-hunk";
      else if (line.charAt(0) === "+") { cls += " dl-add"; adds++; }
      else if (line.charAt(0) === "-") { cls += " dl-del"; dels++; }
      else if (line.charAt(0) === "[") cls += " dl-meta";
      add(body, el("div", cls, line || " "));
    });
    close();
    return files;
  }
  var dialog = null;
  function openDiff(path, sha, title) {
    if (!dialog) {
      dialog = el("dialog", "diff-dialog");
      dialog.addEventListener("click", function (e) { if (e.target === dialog) dialog.close(); });
      document.body.appendChild(dialog);
    }
    dialog.textContent = "";
    var head = el("div", "diff-head");
    var raw = el("a", "ghost", "Raw patch");
    raw.setAttribute("href", path);
    raw.setAttribute("download", sha + ".patch");
    var close = el("button", "ghost", "Close");
    close.setAttribute("type", "button");
    close.addEventListener("click", function () { dialog.close(); });
    add(head, add(el("div", "diff-title"), el("h2", null, "Diff " + sha), title ? el("p", "diff-sub", title) : null), raw, close);
    var bodyBox = el("div", "diff-scroll");
    add(bodyBox, el("p", "empty", "Loading…"));
    add(dialog, head, bodyBox);
    if (typeof dialog.showModal === "function") dialog.showModal(); else dialog.setAttribute("open", "");
    close.focus();
    fetch(path).then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.text();
    }).then(function (t) {
      bodyBox.textContent = "";
      add(bodyBox, diffLines(t));
    }).catch(function () {
      bodyBox.textContent = "";
      add(bodyBox, el("p", "empty", "The diff could not be loaded."));
    });
  }

  // ---------- research challenges ----------
  // The view the status page gives a research challenge: a trade-off map over
  // its declared axes, the direction tree, one submission's panel, the
  // taxonomy and the deferred contracts. State of the view (selected
  // submission, chosen axes) lives in R and is reset when the slug changes.
  var R = { slug: null, id: null, x: 0, y: 1, nd: false };
  var PALETTE = 8; // --d0 .. --d7 in style.css

  function axisLabel(a) {
    return a.id + " (" + (str(a.unit) || "no unit") + ", " + (a.direction === "maximise" ? "higher" : "lower") + " is better)";
  }
  function subs(c) { return Array.isArray(c.submissions) ? c.submissions : []; }
  function subById(c, id) {
    var l = subs(c);
    for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i];
    return null;
  }
  // Colour slot per direction; the baseline's own direction has none (it is a ring).
  function dirSlots(c) {
    var slots = {}, n = 0;
    subs(c).forEach(function (s) {
      var d = str(s.direction);
      if (s.baseline || d in slots) return;
      slots[d] = n++ % PALETTE;
    });
    return slots;
  }
  function stat3(s, axis) {
    var a = s.axes && s.axes[axis];
    if (!a || num(a.median) === null) return null;
    var med = a.median;
    return { med: med, min: num(a.min) === null ? med : a.min, max: num(a.max) === null ? med : a.max, n: a.n };
  }
  // Not dominated: nothing else is at least as good on both axes and better on one.
  function nonDominated(c, pts, ax, ay) {
    var sx = ax.direction === "maximise" ? 1 : -1, sy = ay.direction === "maximise" ? 1 : -1;
    var out = {};
    pts.forEach(function (p) {
      out[p.s.id] = !pts.some(function (q) {
        if (q === p) return false;
        var dx = (q.x - p.x) * sx, dy = (q.y - p.y) * sy;
        return dx >= 0 && dy >= 0 && (dx > 0 || dy > 0);
      });
    });
    return out;
  }
  function niceTicks(lo, hi, n) {
    var span = hi - lo;
    var raw = span / n, mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    var step = [1, 2, 5, 10].map(function (m) { return m * mag; }).filter(function (s) { return s >= raw; })[0];
    var out = [];
    for (var t = Math.ceil(lo / step - 1e-9) * step; t <= hi + step * 1e-9; t += step) out.push(Math.abs(t) < step * 1e-9 ? 0 : t);
    return out;
  }
  function extent(vals) {
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    if (hi === lo) { var d = Math.abs(lo) * 0.1 || 1; return [lo - d, hi + d]; }
    var pad = (hi - lo) * 0.08;
    return [lo - pad, hi + pad];
  }

  function drawMap(c, host) {
    host.textContent = "";
    var axes = c.axes || [];
    if (axes.length < 2) { add(host, empty("This challenge declares fewer than two axes, so there is nothing to plot.")); return; }
    var ax = axes[R.x], ay = axes[R.y];
    var slots = dirSlots(c);
    var pts = [];
    subs(c).forEach(function (s) {
      var px = stat3(s, ax.id), py = stat3(s, ay.id);
      if (px && py) pts.push({ s: s, x: px.med, y: py.med, xr: px, yr: py });
    });
    if (!pts.length) { add(host, empty("No accepted submissions have measurements on these axes yet.")); return; }
    var W = Math.max(280, Math.round(host.clientWidth || 600));
    var H = Math.round(Math.min(420, Math.max(300, W * 0.6)));
    var m = { l: W < 520 ? 60 : 66, r: 16, t: 14, b: 50 };
    var xe = extent(pts.reduce(function (a, p) { return a.concat([p.xr.min, p.xr.max]); }, []));
    var ye = extent(pts.reduce(function (a, p) { return a.concat([p.yr.min, p.yr.max]); }, []));
    function X(v) { return m.l + (v - xe[0]) / (xe[1] - xe[0]) * (W - m.l - m.r); }
    function Y(v) { return H - m.b - (v - ye[0]) / (ye[1] - ye[0]) * (H - m.t - m.b); }
    var root = svg("svg", { width: "100%", viewBox: "0 0 " + W + " " + H, role: "group", "aria-label": "Trade-off map: " + ax.id + " against " + ay.id, "class": "map-svg" });
    // grid and ticks
    niceTicks(ye[0], ye[1], H < 360 ? 4 : 5).forEach(function (t) {
      add(root, svg("line", { x1: m.l, x2: W - m.r, y1: Y(t), y2: Y(t), "class": "grid" }));
      var l = svg("text", { x: m.l - 8, y: Y(t) + 4, "text-anchor": "end" });
      l.textContent = fmt(t, 0 + (Math.abs(t) < 10 && !Number.isInteger(t) ? 2 : 0));
      add(root, l);
    });
    niceTicks(xe[0], xe[1], W < 520 ? 4 : 6).forEach(function (t) {
      add(root, svg("line", { x1: X(t), x2: X(t), y1: m.t, y2: H - m.b, "class": "grid" }));
      var l = svg("text", { x: X(t), y: H - m.b + 17, "text-anchor": "middle" });
      l.textContent = fmt(t, 0 + (Math.abs(t) < 10 && !Number.isInteger(t) ? 2 : 0));
      add(root, l);
    });
    var xt = svg("text", { x: m.l + (W - m.l - m.r) / 2, y: H - 8, "text-anchor": "middle", "class": "axis-title" });
    xt.textContent = axisLabel(ax);
    var yt = svg("text", { x: 0, y: 0, "text-anchor": "middle", "class": "axis-title", transform: "translate(13," + (m.t + (H - m.t - m.b) / 2) + ") rotate(-90)" });
    yt.textContent = axisLabel(ay);
    add(root, xt, yt);
    var nd = R.nd ? nonDominated(c, pts, ax, ay) : null;
    var label = svg("text", { "class": "pt-label", x: 0, y: 0, visibility: "hidden" });
    function showLabel(p) {
      var t = p.s.id + (p.s.baseline ? " (baseline)" : " · " + str(p.s.direction));
      label.textContent = t;
      var px = X(p.x), py = Y(p.y);
      var right = px > W * 0.6;
      label.setAttribute("text-anchor", right ? "end" : "start");
      label.setAttribute("x", px + (right ? -12 : 12));
      label.setAttribute("y", Math.max(m.t + 10, py - 12));
      label.setAttribute("visibility", "visible");
    }
    function hideLabel() { label.setAttribute("visibility", "hidden"); }
    // Selected last so it draws on top; others in data order.
    pts.slice().sort(function (a, b) { return (a.s.id === R.id) - (b.s.id === R.id); }).forEach(function (p) {
      var g = svg("g", { "class": "pt" + (p.s.id === R.id ? " sel" : ""), tabindex: 0, role: "button", "data-id": p.s.id,
        "aria-label": "Submission " + p.s.id + ", direction " + str(p.s.direction) + ", " + ax.id + " " + fmt(p.x) + ", " + ay.id + " " + fmt(p.y) + (nd && nd[p.s.id] ? ", not dominated" : "") });
      var cx = X(p.x), cy = Y(p.y);
      if (p.xr.min !== p.xr.max) add(g, svg("line", { x1: X(p.xr.min), x2: X(p.xr.max), y1: cy, y2: cy, "class": "bar" }));
      if (p.yr.min !== p.yr.max) add(g, svg("line", { x1: cx, x2: cx, y1: Y(p.yr.min), y2: Y(p.yr.max), "class": "bar" }));
      add(g, svg("circle", { cx: cx, cy: cy, r: 16, "class": "hit" }));
      if (nd && nd[p.s.id]) add(g, svg("circle", { cx: cx, cy: cy, r: 11, "class": "nd" }));
      if (p.s.baseline) add(g, svg("circle", { cx: cx, cy: cy, r: 8, "class": "base" }));
      else add(g, svg("circle", { cx: cx, cy: cy, r: 6, "class": "dot", style: "fill: var(--d" + (slots[str(p.s.direction)] || 0) + ")" }));
      add(g, svg("circle", { cx: cx, cy: cy, r: 13, "class": "focus-ring" }));
      var title = svg("title", {});
      title.textContent = p.s.id + " · " + str(p.s.direction);
      add(g, title);
      g.addEventListener("mouseenter", function () { showLabel(p); });
      g.addEventListener("mouseleave", hideLabel);
      g.addEventListener("focus", function () { showLabel(p); });
      g.addEventListener("blur", hideLabel);
      g.addEventListener("click", function () { selectSub(c, p.s.id); });
      g.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectSub(c, p.s.id); }
      });
      add(root, g);
    });
    add(root, label);
    add(host, root);
    if (pts.length === 1) add(host, el("p", "block-note", "One accepted submission so far: the map fills in as more are accepted."));
  }

  function mapSection(c) {
    var s = section("Trade-off map", el("span", "block-note", "Each point is a submission's median; bars span min to max."));
    var axes = c.axes || [];
    if (!subs(c).length) { add(s, empty("No submissions have been accepted yet.")); return s; }
    if (axes.length < 2) { add(s, empty("This challenge declares fewer than two axes.")); return s; }
    var host = el("div", "map");
    host.setAttribute("data-slug", c.slug);
    function pick(label, key) {
      var id = "axis-" + key;
      var sel = el("select");
      sel.setAttribute("id", id);
      axes.forEach(function (a, i) {
        var o = el("option", null, axisLabel(a));
        o.setAttribute("value", String(i));
        if (i === R[key]) o.selected = true;
        add(sel, o);
      });
      sel.addEventListener("change", function () { R[key] = Number(sel.value); drawMap(c, host); });
      var lab = el("label", "pick-axis", label + " ");
      lab.setAttribute("for", id);
      return add(lab, sel);
    }
    var nd = el("input");
    nd.setAttribute("type", "checkbox");
    nd.setAttribute("id", "map-nd");
    nd.checked = R.nd;
    nd.addEventListener("change", function () { R.nd = nd.checked; drawMap(c, host); });
    var ndl = el("label", "pick-nd");
    ndl.setAttribute("for", "map-nd");
    add(ndl, nd, " Highlight non-dominated");
    add(s, add(el("div", "map-controls"), pick("X", "x"), pick("Y", "y"), ndl));
    add(s, host);
    var slots = dirSlots(c);
    var legend = el("ul", "legend map-legend");
    var base = subs(c).filter(function (x) { return x.baseline; })[0];
    if (base) add(legend, add(el("li"), el("span", "key key-base"), "Baseline"));
    Object.keys(slots).forEach(function (d) {
      var k = el("span", "key");
      k.setAttribute("style", "background: var(--d" + slots[d] + ")");
      add(legend, add(el("li"), k, d));
    });
    add(legend, add(el("li"), el("span", "key key-nd"), "Not dominated (when highlighted)"));
    add(s, legend);
    drawMap(c, host);
    return s;
  }

  // The tree: baseline at the root, each direction's root under it, builds-on chains nested.
  function treeSection(c) {
    var s = section("Directions", el("span", "block-note", "Choose a submission to read it."));
    var list = subs(c);
    if (!list.length) { add(s, empty("No submissions have been accepted yet.")); return s; }
    var slots = dirSlots(c);
    var kids = {}, seen = {};
    var base = list.filter(function (x) { return x.baseline; })[0];
    var tops = [];
    list.forEach(function (x) {
      if (x.baseline) return;
      var p = x.novelty === "builds-on" ? subById(c, str(x.parent)) : null;
      if (p && p !== x) (kids[p.id] = kids[p.id] || []).push(x);
      else tops.push(x);
    });
    function nest(list2) {
      var u = el("ul");
      list2.forEach(function (y) { add(u, node(y)); });
      return u;
    }
    function node(x) {
      seen[x.id] = true;
      var li = el("li");
      var b = el("button", "node");
      b.setAttribute("type", "button");
      b.setAttribute("data-id", x.id);
      if (x.id === R.id) b.setAttribute("aria-current", "true");
      var k = el("span", "key" + (x.baseline ? " key-base" : ""));
      if (!x.baseline) k.setAttribute("style", "background: var(--d" + (slots[str(x.direction)] || 0) + ")");
      add(b, k, el("span", "node-id", x.id), el("span", "node-dir", x.baseline ? "baseline" : x.novelty === "new" ? str(x.direction) : "builds on " + str(x.parent)));
      b.addEventListener("click", function () { selectSub(c, x.id); });
      add(li, b);
      var ch = (kids[x.id] || []).filter(function (y) { return !seen[y.id]; });
      if (ch.length) add(li, nest(ch));
      return li;
    }
    var ul = el("ul", "tree");
    if (base) add(ul, (function () {
      var li = node(base);
      if (tops.length) add(li, nest(tops));
      return li;
    })());
    else tops.forEach(function (x) { add(ul, node(x)); });
    return add(s, ul);
  }

  function checksTable(s) {
    var rows = [];
    (s.checks || []).forEach(function (k) {
      var r = el("span", "outcome " + (k.ok ? "o-good" : "o-bad"), k.ok ? "pass" : "fail");
      rows.push([str(k.property), str(k.check), r, str(k.detail)]);
    });
    (s.claims || []).forEach(function (k) {
      rows.push([str(k.property), "claim", el("span", "outcome o-claim", "declared — unverified"), str(k.argument)]);
    });
    if (!rows.length) return empty("No checks recorded.");
    return table([["Property"], ["Kind"], ["Result"], ["Detail", "detail"]], rows, "checks");
  }
  function axesTable(c, s) {
    var rows = (c.axes || []).map(function (a) {
      var t = stat3(s, a.id);
      return [a.id, t ? fmt(t.med) : "–", t ? fmt(t.min) + " – " + fmt(t.max) : "–", t && t.n !== undefined ? String(t.n) : "–", str(a.unit)];
    });
    return table([["Axis"], ["Median", "n"], ["Min – max"], ["Runs", "n"], ["Unit"]], rows, "axes");
  }
  function taxTuple(s) {
    var dl = el("dl", "facts tuple");
    var t = s.taxonomy && typeof s.taxonomy === "object" ? s.taxonomy : {};
    var proposed = Array.isArray(s.proposed) ? s.proposed : [];
    Object.keys(t).forEach(function (k) {
      var v = el("span", null, str(t[k]));
      if (proposed.indexOf(k) >= 0) add(v, " ", el("span", "outcome o-claim", "(proposed)"));
      add(dl, add(el("div"), el("dt", null, k), add(el("dd"), v)));
    });
    return dl;
  }
  function renderSub(c, host) {
    host.textContent = "";
    var s = R.id ? subById(c, R.id) : null;
    if (!s) {
      add(host, empty("Choose a point on the map or a node in the tree to read that submission."));
      return;
    }
    var head = add(el("div", "sub-head"), el("h3", null, s.id));
    if (s.baseline) add(head, el("span", "outcome o-base", "Baseline"));
    add(host, head);
    var facts = el("dl", "facts");
    function row(k, v) { if (v !== null && v !== "") add(facts, add(el("div"), el("dt", null, k), add(el("dd"), v))); }
    row("Direction", str(s.direction));
    if (s.novelty === "builds-on") {
      var pb = el("button", "link-btn", str(s.parent));
      pb.setAttribute("type", "button");
      pb.addEventListener("click", function () { selectSub(c, str(s.parent)); });
      row("Novelty", add(el("span"), "builds on ", subById(c, str(s.parent)) ? pb : str(s.parent)));
    } else row("Novelty", "new");
    row("By", str(s.by));
    row("Model", str(s.model));
    row("When", absTime(s.at));
    row("Commit", el("code", null, short(s.commit)));
    row("Contract", str(s.contract));
    add(host, facts);
    if (str(s.summary)) add(host, el("p", "sub-summary", s.summary));
    add(host, el("h3", null, "Taxonomy"), taxTuple(s));
    add(host, el("h3", null, "Checks"), checksTable(s));
    add(host, el("h3", null, "Axes"), axesTable(c, s));
    if (s.novelty === "builds-on") {
      var p = diffPath2(s.diff);
      add(host, el("h3", null, "Change"));
      if (p) {
        var b = el("button", "copy diff-open", "View diff against " + str(s.parent));
        b.setAttribute("type", "button");
        b.addEventListener("click", function () { openDiff(p, s.id, "Against " + str(s.parent)); });
        add(host, b);
      } else add(host, empty("No difference from " + str(s.parent) + " was recorded."));
    } else {
      add(host, el("h3", null, "Files"));
      var files = Array.isArray(s.files) ? s.files : [];
      if (files.length) {
        var ul = el("ul", "files");
        files.forEach(function (f) { add(ul, add(el("li"), el("code", null, str(f)))); });
        add(host, ul);
        if (files.length >= 200) add(host, el("p", "block-note", "The list stops at 200 files."));
      } else add(host, empty("No files listed."));
      if (str(s.readme)) add(host, el("h3", null, "README"), el("p", "readme-excerpt", s.readme));
    }
  }
  function diffPath2(p) {
    p = str(p);
    return /^diffs\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\.patch$/.test(p) ? p : null;
  }
  function subPanel(c) {
    var s = section("Submission");
    s.setAttribute("id", "sub-panel");
    s.setAttribute("tabindex", "-1");
    var host = el("div", "sub");
    host.setAttribute("aria-live", "polite");
    add(s, host);
    renderSub(c, host);
    return s;
  }
  // Chosen from a point or a node: redraw the pieces that show the selection.
  function selectSub(c, id) {
    if (!subById(c, id)) return;
    R.id = id;
    var panel = document.getElementById("sub-panel");
    var host = panel && panel.querySelector(".sub");
    if (host) renderSub(c, host);
    Array.prototype.forEach.call(document.querySelectorAll(".node"), function (n) {
      if (n.getAttribute("data-id") === id) n.setAttribute("aria-current", "true"); else n.removeAttribute("aria-current");
    });
    var map = document.querySelector(".map");
    if (map) drawMap(c, map);
    if (panel) panel.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "nearest" });
  }

  function taxSection(c) {
    var t = c.taxonomy || {};
    var s = section("Taxonomy", el("span", "block-note", "Axes of variation, with how many submissions use each value."));
    var axes = t.axes || [];
    if (!axes.length) return add(s, empty("No taxonomy is defined."));
    axes.forEach(function (a) {
      add(s, el("h3", null, a.id));
      if (str(a.definition)) add(s, el("p", "tax-def", a.definition));
      var ul = el("ul", "tax-values");
      (a.values || []).forEach(function (v) {
        var li = add(el("li"), el("code", null, str(v.id)), " ", el("span", "tax-count", v.count + (v.count === 1 ? " submission" : " submissions")));
        if (v.proposed) add(li, " ", el("span", "outcome o-claim", "(proposed)"));
        if (str(v.definition)) add(li, el("span", "tax-vdef", str(v.definition)));
        add(ul, li);
      });
      add(s, ul);
    });
    return s;
  }
  function deferredSection(c) {
    var d = (c.contracts || []).filter(function (k) { return k.status === "deferred"; });
    if (!d.length) return null;
    var s = section("Deferred contracts", el("span", "block-note", "Not open yet. Each says when it would be."));
    var ul = el("ul", "deferred");
    d.forEach(function (k) { add(ul, add(el("li"), el("code", null, str(k.id)), " — admits when: " + str(k.admits_when))); });
    return add(s, ul);
  }
  function researchStats(c) {
    var a = c.attempts || {};
    var dl = el("dl", "stats");
    function stat(k, v) { add(dl, add(el("div", "stat"), el("dt", null, k), add(el("dd"), v))); }
    stat("Accepted submissions", String(subs(c).filter(function (x) { return !x.baseline; }).length));
    stat("Directions", String((c.directions || []).filter(function (d) { return d.name !== "baseline"; }).length));
    stat("PR attempts", String(a.total || 0));
    stat("Rejected", String(a.rejected || 0));
    return dl;
  }
  function researchAside(c) {
    var s = el("section", "panel");
    add(s, el("h2", null, "Rules at a glance"));
    var dl = el("dl", "facts");
    function row(k, v) { add(dl, add(el("div"), el("dt", null, k), add(el("dd"), v))); }
    row("Axes", (c.axes || []).map(function (a) { return a.id; }).join(", ") || "–");
    row("Open contracts", (c.contracts || []).filter(function (k) { return k.status !== "deferred"; }).map(function (k) { return k.id; }).join(", ") || "–");
    row("Runner", str(c.runner) || "–");
    var data = el("span");
    if (c.feed) { var f = el("a", null, c.feed); f.setAttribute("href", c.feed); add(data, f, ", "); }
    var all = el("a", null, "challenges.json");
    all.setAttribute("href", "challenges.json");
    add(data, all);
    row("Data", data);
    return add(s, dl);
  }

  // ---------- page ----------
  function picker(sel) {
    if (challenges.length < 2) return null;
    var n = el("nav", "picker");
    n.setAttribute("aria-label", "Challenges");
    challenges.forEach(function (c) {
      var a = el("a", "pick");
      a.setAttribute("href", "#" + encodeURIComponent(c.slug));
      if (c === sel) a.setAttribute("aria-current", "page");
      var d = decimalsFor(c);
      var v = c.record ? c.record.value : c.baseline ? c.baseline.value : null;
      var prs = pullsFor(c).length;
      var meta = (v !== null ? "Record " + scoreText(c, v, d) : STATES[c.state] ? STATES[c.state].short : "Draft") + (prs ? ", " + prs + " open PR" + (prs > 1 ? "s" : "") : "");
      add(a, el("span", "pick-slug", c.slug), el("span", "pick-meta", meta));
      n.appendChild(a);
    });
    return n;
  }

  function mark() {
    // A stepped line rising to a dashed bar: the ratchet.
    var s = svg("svg", { viewBox: "0 0 24 24", "class": "brand-mark", "aria-hidden": "true" });
    add(s, svg("path", { d: "M3 19 H8 V14 H13 V10 H21", fill: "none", stroke: "#3ddba6", "stroke-width": 2.4, "stroke-linejoin": "round" }),
      svg("path", { d: "M3 5 H21", fill: "none", stroke: "#aaa3ff", "stroke-width": 2, "stroke-dasharray": "3 2.5" }));
    return s;
  }

  function render() {
    var c = current();
    var band = el("div", "top-band");
    var top = el("header", "top wrap");
    var brand = add(el("div", "brand"), mark(), "Auto-research challenges");
    var gen = add(el("p", "generated"), "Results updated ", time(DATA.generated_at), " (" + absTime(DATA.generated_at) + ")");
    var repo = STATE && str(STATE.repo) ? link("Repository", "https://github.com/" + STATE.repo, "ghost") : null;
    var toggle = el("button", "ghost", "Theme");
    toggle.setAttribute("type", "button");
    toggle.setAttribute("aria-label", "Switch light or dark theme");
    toggle.addEventListener("click", flipTheme);
    add(top, brand, gen, repo, toggle);
    add(band, top);
    var pick = picker(c);
    if (pick) add(band, add(el("div", "wrap"), pick));
    app.textContent = "";
    add(app, band);
    if (!c) {
      add(app, add(el("main", "wrap body"), empty("No challenges are open right now.")));
      document.title = "Auto-research challenges";
      return;
    }
    DEC = decimalsFor(c);
    TIMES = isSpeedup(c);
    var main = el("main");
    main.setAttribute("id", "main");
    var content, aside;
    if (c.type === "research") {
      if (R.slug !== c.slug) R = { slug: c.slug, id: null, x: 0, y: 1, nd: false };
      content = add(el("div", "content"), mapSection(c), treeSection(c), subPanel(c), taxSection(c), deferredSection(c));
      aside = add(el("div", "aside"), enter(c), researchAside(c));
    } else {
      content = add(el("div", "content"), board(c), attempts(c));
      aside = add(el("div", "aside"), enter(c), facts(c));
    }
    add(main, stage(c), add(el("div", "wrap body" + (c.type === "research" ? " body-research" : "")), content, aside));
    add(app, main);
    document.title = c.slug + ": auto-research challenges";
    drawCharts();
  }
  function drawCharts() {
    var c = current();
    var host = document.querySelector(".chart");
    if (c && host) drawChart(c, host);
    var map = document.querySelector(".map");
    if (c && c.type === "research" && map) drawMap(c, map);
  }

  // ---------- theme ----------
  function flipTheme() {
    var root = document.documentElement;
    var dark = root.getAttribute("data-theme") ? root.getAttribute("data-theme") === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    var next = dark ? "light" : "dark";
    root.setAttribute("data-theme", next);
    try { localStorage.setItem("theme", next); } catch (e) { /* storage unavailable */ }
  }
  try {
    var saved = localStorage.getItem("theme");
    if (saved === "light" || saved === "dark") document.documentElement.setAttribute("data-theme", saved);
  } catch (e) { /* storage unavailable */ }

  window.addEventListener("hashchange", function () { render(); window.scrollTo(0, 0); });
  var resizeTimer = null, lastW = window.innerWidth;
  window.addEventListener("resize", function () {
    if (window.innerWidth === lastW) return;
    lastW = window.innerWidth;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(drawCharts, 120);
  });
  render();

  // state.json: optional, same directory. A placeholder (no generated_at) means unpublished.
  if (typeof fetch === "function") {
    fetch("state.json", { cache: "no-store" }).then(function (r) {
      return r.ok ? r.json() : null;
    }).then(function (s) {
      if (s && typeof s === "object" && str(s.generated_at)) { STATE = s; render(); }
    }).catch(function () { /* absent or malformed: render without it */ });
  }
})();
