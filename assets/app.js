// Challenge status page. Written by `cb feed` (crates/cb/src/pages.rs).
// Every string from data or state.json is untrusted: it goes into the DOM
// through textContent or setAttribute only, and links must be github.com.
"use strict";
(function () {
  var DATA = JSON.parse(document.getElementById("site-data").textContent);
  var STATE = null; // state.json, when published
  var app = document.getElementById("app");

  var STATES = {
    pending: { word: "Open, baseline pending", short: "Baseline pending", order: 0 },
    open: { word: "Open", short: "Open", order: 1 },
    draft: { word: "Draft", short: "Draft", order: 2 },
    closed: { word: "Closed", short: "Closed", order: 3 }
  };
  var OUTCOMES = {
    baseline: ["Baseline", "base"],
    promoted: ["Promoted", "good"],
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
    if (!b) return "Any improvement counts";
    return (b / 100).toFixed(b % 100 ? 2 : 0) + "% (" + b + " bips) past the record";
  }
  function better(c) { return c.direction === "maximise" ? "Higher is better" : "Lower is better"; }
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
    var s = el("section", "block");
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

  // ---------- the ratchet: baseline, each record, the bar to beat ----------
  function ratchet(c) {
    var box = el("div", "ratchet");
    var readouts = el("div", "readouts");
    var base = c.baseline && num(c.baseline.value);
    var rec = c.record && num(c.record.value);
    function readout(label, value, sub, cls) {
      var r = el("div", "readout " + (cls || ""));
      add(r, el("div", "readout-label", label), el("div", "readout-value", value), sub ? add(el("div", "readout-sub"), sub) : null);
      return r;
    }
    var unit = c.metric;
    if (base === null) {
      add(readouts,
        readout("Baseline", "–", c.state === "draft" ? "Recorded when the challenge opens" : "First run on main sets it", "pending"),
        readout("Record", "–", "None yet"),
        readout("To beat", "–", bipsText(c.min_improvement_bips)));
      add(box, readouts);
      var track = el("div", "track track-empty");
      add(track, el("span", "track-note", c.state === "draft"
        ? "Not open yet. Results appear here once the baseline is recorded."
        : "Baseline pending. Submissions are scored against it once it is recorded."));
      add(box, track);
      return box;
    }
    var recSub = c.record
      ? add(el("span"), "by " + (str(c.record.by) || "unknown") + ", ", time(c.record.at))
      : "No promotion yet: the baseline stands";
    var gain = rec !== null && base ? pct((rec - base) / base * 100) : "";
    var maxi = c.direction === "maximise";
    add(readouts,
      readout("Baseline", fmt(base), add(el("span"), unit + ", ", time(c.baseline.at))),
      readout("Record", rec !== null ? fmt(rec) : fmt(base), rec !== null ? add(el("span"), recSub, gain ? " (" + gain + ")" : "") : recSub, "record"),
      readout("To beat", (num(c.to_beat) === null ? "" : (maxi ? (c.min_improvement_bips ? "≥ " : "> ") : (c.min_improvement_bips ? "≤ " : "< "))) + fmt(c.to_beat),
        bipsText(c.min_improvement_bips), "target"));
    add(box, readouts);

    // Scale: better is always to the right.
    var points = [{ v: base, kind: "base", label: "baseline" }];
    (c.attempts || []).slice().reverse().forEach(function (a) {
      if (a.status === "promoted" && num(a.value) !== null) points.push({ v: a.value, kind: "rec", label: str(a.by) });
    });
    var target = num(c.to_beat);
    var vals = points.map(function (p) { return p.v; });
    if (target !== null) vals.push(target);
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    var span = hi - lo || Math.abs(hi) * 0.02 || 1;
    lo -= span * 0.08; hi += span * 0.08;
    function pos(v) { var f = (v - lo) / (hi - lo); return (maxi ? f : 1 - f) * 100; }
    var track = el("div", "track");
    track.setAttribute("role", "img");
    track.setAttribute("aria-label", "Baseline " + fmt(base) + ", record " + fmt(rec !== null ? rec : base) + ", next record needs " + fmt(target) + " " + unit + ". " + better(c) + ".");
    var bestPos = pos(rec !== null ? rec : base);
    var fill = el("span", "track-fill");
    fill.style.left = Math.min(pos(base), bestPos) + "%";
    fill.style.width = Math.abs(bestPos - pos(base)) + "%";
    track.appendChild(fill);
    points.forEach(function (p, i) {
      var m = el("span", "mark mark-" + p.kind + (i === points.length - 1 ? " mark-current" : ""));
      m.style.left = pos(p.v) + "%";
      m.setAttribute("title", p.label + ": " + fmt(p.v));
      track.appendChild(m);
    });
    if (target !== null) {
      var t = el("span", "mark mark-target");
      t.style.left = pos(target) + "%";
      t.setAttribute("title", "to beat: " + fmt(target));
      track.appendChild(t);
    }
    add(box, track, add(el("div", "axis"), el("span", null, maxi ? "lower" : "higher"), el("span", null, better(c).replace(" is better", "") + " is better, to the right")));
    return box;
  }

  // ---------- sections ----------
  function facts(c) {
    var dl = el("dl", "facts");
    function row(k, v) { add(dl, add(el("div"), el("dt", null, k), add(el("dd"), v))); }
    row("Metric", el("span", "mono", c.metric));
    row("Direction", better(c));
    row("Bar", bipsText(c.min_improvement_bips));
    var paths = el("span");
    (c.editable || []).forEach(function (p, i) { if (i) paths.appendChild(document.createTextNode(", ")); paths.appendChild(el("code", null, "challenges/" + c.slug + "/" + p)); });
    row("Editable", paths);
    row("Size cap", fmt(c.max_bytes, 0) + " bytes");
    row("Kind", c.family);
    return dl;
  }

  function activity(c) {
    var s = section("Pipeline activity", STATE && STATE.generated_at ? add(el("span", "block-note"), "as of ", time(STATE.generated_at)) : null);
    if (!STATE) {
      add(s, empty("Live pipeline state isn't published with this build. Results below are complete as of the generation time."));
      return s;
    }
    var pulls = (Array.isArray(STATE.pulls) ? STATE.pulls : []).filter(function (p) {
      return Array.isArray(p.challenges) && p.challenges.indexOf(c.slug) >= 0;
    });
    add(s, el("h3", null, pulls.length ? "Open pull requests (" + pulls.length + ")" : "Open pull requests"));
    if (!pulls.length) add(s, empty("No open pull requests touch " + c.slug + "."));
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

  function board(c) {
    var s = section("Leaderboard", el("span", "block-note", "Promoted results: two agreeing sandboxed runs on main, fresh seeds"));
    if (!(c.board || []).length) {
      add(s, empty(c.baseline ? "No promoted submission yet. The baseline is the record to beat." : "Empty until the baseline is recorded."));
      return s;
    }
    add(s, table([["#", "n"], ["Solver"], [c.metric, "n"], ["vs baseline", "n"], ["When"], ["Commit"]],
      c.board.map(function (r) {
        var who = el("span", null, str(r.solver) || "unknown");
        if (str(r.model)) add(who, el("span", "sub", " " + r.model));
        return [String(r.rank), who, fmt(r.value), pct(r.delta_pct), time(r.at), el("code", null, short(r.commit))];
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

  function submit(c) {
    var s = section("How to submit");
    var steps = c.submit_steps || [];
    if (c.state === "draft" || c.state === "closed") add(s, el("p", "callout", c.state === "draft" ? "This challenge is a draft: submissions aren't scored yet." : "This challenge is closed to new submissions."));
    if (steps.length) {
      var ol = el("ol", "steps");
      steps.forEach(function (t) { ol.appendChild(el("li", null, t)); });
      add(s, ol);
    } else add(s, empty("See SUBMITTING.md in the challenge directory."));
    var p = el("p", "fine");
    add(p, "Edit only ", ...(c.editable || []).map(function (e, i) {
      var f = document.createDocumentFragment();
      if (i) f.appendChild(document.createTextNode(", "));
      f.appendChild(el("code", null, "challenges/" + c.slug + "/" + e));
      return f;
    }), "; at most " + fmt(c.max_bytes, 0) + " bytes. Details are in the challenge's SUBMITTING.md and README.md.");
    add(s, p);
    return s;
  }

  // ---------- page ----------
  function nav(sel) {
    var n = el("nav", "rail");
    n.setAttribute("aria-label", "Challenges");
    var ul = el("ul");
    challenges.forEach(function (c) {
      var a = el("a", "rail-item" + (c === sel ? " is-current" : ""));
      a.setAttribute("href", "#" + encodeURIComponent(c.slug));
      if (c === sel) a.setAttribute("aria-current", "page");
      var d = decimalsFor(c);
      var val = c.record ? fmt(c.record.value, d) : c.baseline ? fmt(c.baseline.value, d) : "–";
      var prs = STATE && Array.isArray(STATE.pulls) ? STATE.pulls.filter(function (p) { return Array.isArray(p.challenges) && p.challenges.indexOf(c.slug) >= 0; }).length : 0;
      add(a, el("span", "rail-slug", c.slug), add(el("span", "rail-meta"), badge(c.state), prs ? el("span", "tag", prs + " PR" + (prs > 1 ? "s" : "")) : null),
        add(el("span", "rail-value"), val, el("span", "rail-unit", " " + c.metric)));
      ul.appendChild(add(el("li"), a));
    });
    return add(n, ul);
  }

  function detail(c) {
    var main = el("main", "detail");
    main.setAttribute("id", "main");
    if (!c) return add(main, empty("No challenges are defined."));
    DEC = decimalsFor(c);
    var head = el("header", "detail-head");
    add(head, add(el("div", "title-row"), el("h1", "slug", c.slug), badge(c.state, true)));
    if (str(c.title)) add(head, el("p", "title", c.title));
    if (str(c.summary)) add(head, el("p", "summary", c.summary));
    add(main, head, ratchet(c), facts(c), activity(c), board(c), attempts(c), submit(c));
    var foot = el("p", "fine sources");
    add(foot, "Data: ");
    if (c.feed) {
      var f = el("a", null, c.feed);
      f.setAttribute("href", c.feed);
      add(foot, f, ", ");
    }
    var all = el("a", null, "challenges.json");
    all.setAttribute("href", "challenges.json");
    add(foot, all, ".");
    add(main, foot);
    return main;
  }

  function render() {
    var c = current();
    var top = el("header", "top");
    var brand = add(el("div", "brand"), el("span", "brand-name", "Challenge status"));
    var gen = add(el("p", "generated"), "Results generated ", time(DATA.generated_at), " (" + absTime(DATA.generated_at) + ")");
    var toggle = el("button", "theme", "Theme");
    toggle.setAttribute("type", "button");
    toggle.setAttribute("aria-label", "Switch light or dark theme");
    toggle.addEventListener("click", flipTheme);
    add(top, brand, gen, toggle);
    var shell = add(el("div", "shell"), nav(c), detail(c));
    app.textContent = "";
    add(app, top, shell);
    document.title = c ? c.slug + ": challenge status" : "Challenge status";
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
