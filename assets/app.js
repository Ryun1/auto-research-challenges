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
  function decimalsFor(c) {
    var vals = [c.baseline && c.baseline.value, c.record && c.record.value, c.to_beat];
    (c.attempts || []).forEach(function (a) { vals.push(a.value); });
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
    var a = c.attempts && c.attempts[0];
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
  function targetText(c) {
    if (num(c.to_beat) === null) return "–";
    var maxi = c.direction === "maximise";
    return (maxi ? (c.min_improvement_bips ? "≥ " : "> ") : (c.min_improvement_bips ? "≤ " : "< ")) + fmt(c.to_beat);
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
        el("p", "goal-unit", c.metric + ", " + better(c)));
      var rows = el("dl", "goal-rows");
      var rec = c.record ? num(c.record.value) : null;
      var maxi = c.direction === "maximise";
      function row(k, v, cls) { add(rows, add(el("div", cls), el("dt", null, k), add(el("dd"), v))); }
      row("Current record", rec !== null ? fmt(rec) : fmt(base), "rec");
      row("Held by", c.record ? str(c.record.by) || "unknown" : "the baseline");
      row("Margin", c.min_improvement_bips ? (c.min_improvement_bips / 100).toFixed(c.min_improvement_bips % 100 ? 2 : 0) + "% past the record" : "any improvement");
      if (rec !== null && base) row("Improvement", pct((maxi ? rec - base : base - rec) / Math.abs(base) * 100));
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
    [["key-rec", "Record"], ["key-claim", "PR claiming a record"], ["key-plain", "Valid, not a record"], ["key-bad", "Rejected"], ["key-tgt", "Bar to beat"]]
      .forEach(function (k) { add(legend, add(el("li"), el("span", "key " + k[0]), k[1])); });
    return add(box, ch, ch.className === "chart" ? legend : null);
  }

  // Record progression: every scored attempt as a point, the record as a
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
    var pts = (c.attempts || []).filter(function (a) { return num(a.value) !== null && !isNaN(Date.parse(a.at)); })
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
    s.setAttribute("aria-label", "Record progression for " + c.slug + ": baseline " + fmt(base) + ", record " + fmt(rec !== null ? rec : base) +
      (target !== null ? ", the next record needs " + targetText(c) : "") + " " + c.metric + ", " + better(c) + ". " + pts.length + " scored runs.");

    // grid and y labels
    for (var v = lo; v <= hi + step / 2; v += step) {
      var yy = y(v);
      add(s, svg("line", { x1: L, x2: W - R, y1: yy, y2: yy, "class": "grid" }));
      var lab = svg("text", { x: L - 10, y: yy + 4, "text-anchor": "end" });
      lab.textContent = v.toFixed(tickDec);
      add(s, lab);
    }
    // x labels: the first point's date and now
    function dateText(t) { return new Date(t).toISOString().slice(5, 10).replace("-", "/"); }
    var xl = svg("text", { x: L, y: H - 6, "text-anchor": "start" }); xl.textContent = dateText(t0);
    var xr = svg("text", { x: W - R, y: H - 6, "text-anchor": "end" }); xr.textContent = "now";
    add(s, xl, xr);

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
      add(s, svg("line", { x1: L, x2: W - R, y1: ty, y2: ty, "class": "tgt-line" }));
      var tl = svg("text", { x: W - R, y: ty - 8, "text-anchor": "end", "class": "tgt-label" });
      tl.textContent = "Beat this: " + targetText(c);
      add(s, tl);
    }
    var line = svg("path", { d: d, "class": "rec-line" });
    add(s, line);

    // attempts
    pts.forEach(function (p) {
      var px = x(p.t), py = y(p.v), mark;
      if (p.s === "rejected") {
        mark = svg("path", { d: "M" + (px - 4) + " " + (py - 4) + " L" + (px + 4) + " " + (py + 4) + " M" + (px + 4) + " " + (py - 4) + " L" + (px - 4) + " " + (py + 4), "class": "pt-rejected" });
      } else {
        mark = svg("circle", { cx: px, cy: py, r: p.s === "baseline" || p.s === "promoted" ? 5.5 : 4.5, "class": "pt-" + (OUTCOMES[p.s] ? p.s : "valid_not_promoted") });
      }
      var tt = svg("title", {});
      tt.textContent = (OUTCOMES[p.s] ? OUTCOMES[p.s][0] : p.s) + ": " + fmt(p.v) + " " + c.metric + (p.by ? ", " + p.by : "") + ", " + (STAGES[p.stage] || p.stage) + ", " + new Date(p.t).toISOString().slice(0, 16).replace("T", " ") + " UTC";
      add(mark, tt);
      add(s, mark);
    });

    // the standing record, at the right edge
    add(s, svg("circle", { cx: endX, cy: endY, r: 5, "class": "halo" }), svg("circle", { cx: endX, cy: endY, r: 4, "class": "pt-promoted" }));
    var nl = svg("text", { x: endX - 10, y: endY + 18, "text-anchor": "end", "class": "now-label" });
    nl.textContent = "Record " + fmt(steps[steps.length - 1].v);
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
    if (str(c.family)) add(kicker, el("span", null, cap(c.family) + " challenge"));
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
    add(lead, "Open a pull request that changes only ");
    (c.editable || []).forEach(function (e, i) {
      if (i) add(lead, ", ");
      add(lead, el("code", null, "challenges/" + c.slug + "/" + e));
    });
    add(lead, ". CI scores it and comments the result on the PR.");
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
      if (c.baseline) add(p, el("strong", null, "No one is on the board yet."), " The first submission that reaches " + targetText(c) + " " + c.metric + " and passes promotion takes first place.");
      else add(p, "Empty until the baseline is recorded.");
      add(s, p);
      return s;
    }
    add(s, table([["#", "n"], ["Solver"], [c.metric, "n"], ["vs baseline", "n"], ["When"], ["Commit"]],
      c.board.map(function (r) {
        var who = el("span", null, str(r.solver) || "unknown");
        if (str(r.model)) add(who, el("span", "sub", " " + r.model));
        return [el("span", "rank", String(r.rank)), who, fmt(r.value), pct(r.delta_pct), time(r.at), el("code", null, short(r.commit))];
      }), "board"));
    return s;
  }

  function attempts(c) {
    var list = c.attempts || [];
    var counts = {};
    list.forEach(function (a) { counts[a.status] = (counts[a.status] || 0) + 1; });
    var note = el("span", "block-note", list.length ? list.length + (list.length === 1 ? " entry" : " entries") + ", newest first" : "");
    var s = section("Attempt history", note);
    if (!list.length) {
      add(s, empty(c.state === "draft" ? "No attempts: the challenge isn't open yet." : "No attempts yet. Every PR check and promotion run is recorded here, including rejections."));
      return s;
    }
    var sum = el("p", "tally");
    Object.keys(OUTCOMES).forEach(function (k) {
      if (counts[k]) add(sum, el("span", "outcome o-" + OUTCOMES[k][1], OUTCOMES[k][0] + " " + counts[k]));
    });
    add(s, sum);
    add(s, table([["When"], ["Stage"], ["Outcome"], [c.metric, "n"], ["By"], ["Commit"], ["Detail", "detail"]],
      list.map(function (a) {
        var o = OUTCOMES[a.status] || [str(a.status) || "unknown", "plain"];
        return [time(a.at), STAGES[a.stage] || str(a.stage), el("span", "outcome o-" + o[1], o[0]), fmt(a.value),
          str(a.by), el("code", null, short(a.commit)), el("span", "reason", str(a.reason))];
      }), "attempts"));
    return s;
  }

  function activity(c) {
    var s = section("Pipeline activity", STATE && STATE.generated_at ? add(el("span", "block-note"), "as of ", time(STATE.generated_at)) : null);
    if (!STATE) {
      add(s, empty("Live pipeline state isn't published with this build. Results above are complete as of the generation time."));
      return s;
    }
    var pulls = pullsFor(c);
    add(s, el("h3", null, pulls.length ? "Open pull requests (" + pulls.length + ")" : "Open pull requests"));
    if (!pulls.length) add(s, empty("No open pull requests touch " + c.slug + ". Yours could be the first."));
    else {
      var ul = el("ul", "list");
      pulls.slice(0, 20).forEach(function (p) {
        var li = el("li");
        var title = link((num(p.number) !== null ? "#" + p.number + " " : "") + str(p.title), p.url, "item-title");
        add(li, title, p.draft === true ? el("span", "tag", "draft") : null,
          add(el("span", "item-meta"), str(p.author) ? str(p.author) + ", opened " : "opened ", time(p.created_at)));
        ul.appendChild(li);
      });
      add(s, ul);
    }
    // Runs that name their challenges are filtered; the rest are shown as repo-wide.
    var allRuns = Array.isArray(STATE.runs) ? STATE.runs : [];
    var tagged = allRuns.some(function (r) { return Array.isArray(r.challenges); });
    var runs = allRuns.filter(function (r) {
      return !Array.isArray(r.challenges) || r.challenges.indexOf(c.slug) >= 0;
    }).slice(0, 8);
    add(s, el("h3", null, tagged ? "Recent workflow runs" : "Recent workflow runs, all challenges"));
    if (!runs.length) add(s, empty("No recent runs."));
    else {
      var ul2 = el("ul", "list");
      runs.forEach(function (r) {
        var li = el("li");
        var st = str(r.status) === "completed" ? str(r.conclusion) || "completed" : str(r.status) || "unknown";
        var cls = { success: "good", failure: "bad", cancelled: "plain", skipped: "plain", timed_out: "bad", action_required: "warn" }[st] || "run";
        add(li, el("span", "outcome o-" + cls, st.replace(/_/g, " ")), " ",
          link(str(r.workflow) || "workflow", r.url, "item-title"),
          add(el("span", "item-meta"), [str(r.title), str(r.branch), str(r.event).replace(/_/g, " ")].filter(Boolean).join(", ") + ", ", time(r.updated_at || r.created_at)));
        ul2.appendChild(li);
      });
      add(s, ul2);
    }
    return s;
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
      var val = c.record ? fmt(c.record.value, d) : c.baseline ? fmt(c.baseline.value, d) : null;
      var prs = pullsFor(c).length;
      var meta = (val !== null ? "Record " + val + " " + c.metric : STATES[c.state] ? STATES[c.state].short : "Draft") + (prs ? ", " + prs + " open PR" + (prs > 1 ? "s" : "") : "");
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
    var main = el("main");
    main.setAttribute("id", "main");
    var content = add(el("div", "content"), board(c), attempts(c), activity(c));
    var aside = add(el("div", "aside"), enter(c), facts(c));
    add(main, stage(c), add(el("div", "wrap body"), content, aside));
    add(app, main);
    document.title = c.slug + ": auto-research challenges";
    drawCharts();
  }
  function drawCharts() {
    var c = current();
    var host = document.querySelector(".chart");
    if (c && host) drawChart(c, host);
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
