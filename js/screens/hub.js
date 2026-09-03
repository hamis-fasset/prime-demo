/* ————————————————————————————————————————————————
   Fasset Prime — Onboarding status hub (J4 monitor + J5 act entry).
   Built in wave 2, ported from prime-v2.standalone.html.

   The whole screen is: the state as the 30px title, the application's
   lifecycle as a UI.timeline (labels and timestamps only), what the
   reviewer flagged as rows that open the drawer, and one ink action.

   Every review state is reachable: not_started · in_progress · parked
   (deliberately no progress figure: nothing is progressing, and the
   product won't pretend otherwise) · in_review · needs_info (the
   reviewer's comments as rows; the text and a "Fix" live in the
   drawer; only affected steps reopen) · approved with rails being
   issued (no Deposit yet) · approved with rails issued (Deposit opens
   a sheet with copy-ready details, Data.ACCOUNT_NAME verbatim) ·
   rejected (the reason in the drawer, never on the page).

   Reviewer pushes come from Data.reviewerAction(state). The client
   side never asserts an outcome; the hub reflects a decision made in
   Optimus and pushed here.

   States per element: loading (one skeleton pass per app load) ·
   empty (not_started: no application yet) · error/failed (rejected) ·
   stale/degraded (status feed interrupted: one line with the time of
   the last status received) · permission-denied (a viewer teammate
   can follow the application but can't work on it).
   Data API: Data.state.journey · Data.reviewerAction · Data.setJourney.

   Approval carries the shared completion mark (UI.settleFlash: one
   accent hairline under the title), fired only on the transition into
   approved, never on arriving at an already-approved account.

   2026-09-04 (Hamis taste pass): the three-stage "journey" spine with
   its subtitles, the eyebrow, the reassurance lines, the "live" footer,
   the pinned comment cards and the on-page deposit block are gone. The
   hub claims the journey scope and repaints its body in place, so a
   reviewer push never replays the page entrance twice.
   ———————————————————————————————————————————————— */
(function () {
  "use strict";

  var loadedOnce = false;
  var lastSig = null;   // the review signature last painted, for the settle
  var ROOT = null;

  function J() { return Data.state.journey; }
  function canAct() { return Data.state.role !== "viewer"; }
  function region() { return ROOT ? ROOT.querySelector('[data-hubsec="body"]') : null; }

  // the review state, plus whether the rails exist yet. The two together
  // are what "approved" actually means to a client
  function sig() {
    var j = J();
    return j.review + (j.review === "approved" ? (j.railsIssuing ? ":issuing" : ":issued") : "");
  }

  // ————— the state, as a title —————

  function titleFor(r) {
    return {
      not_started: "Verify your account.",
      in_progress: "Verification in progress.",
      parked: "Pending review.",
      in_review: "Pending review.",
      needs_info: "Needs your input.",
      approved: "Approved.",
      rejected: "Rejected."
    }[r] || "Verify your account.";
  }

  // ————— the lifecycle: labels and timestamps only —————

  function timelineItems() {
    var j = J(), r = j.review;
    var sub = j.submittedIso ? UI.fmtTs(j.submittedIso) : "";
    var t = [{ label: "Account created", state: "done" }];

    if (r === "not_started" || r === "in_progress") {
      t.push({ label: "Verification", state: r === "in_progress" ? "active" : "todo" });
      t.push({ label: "Pending review", state: "todo" });
      t.push({ label: "Approved", state: "todo" });
      return t;
    }
    if (r === "parked") {
      t.push({ label: "Pending review", state: "pending" });
      t.push({ label: "Approved", state: "todo" });
      return t;
    }
    t.push({ label: "Submitted", state: "done", time: sub });
    if (r === "in_review") {
      // waiting on the reviewer, a human: amber, never the in-process blue
      t.push({ label: "Pending review", state: "pending" });
      t.push({ label: "Approved", state: "todo" });
    } else if (r === "needs_info") {
      t.push({ label: "Needs your input", state: "pending" });
      t.push({ label: "Approved", state: "todo" });
    } else if (r === "approved") {
      t.push({ label: "Approved", state: "done" });
      if (j.railsIssuing) t.push({ label: "Deposit details", state: "active" });
    } else if (r === "rejected") {
      t.push({ label: "Rejected", state: "failed" });
    }
    return t;
  }

  // ————— what the reviewer flagged: rows, the text in the drawer —————

  function rowHtml(name, detail, key) {
    return '<button class="option-row ob-row" data-hubrow="' + UI.esc(key) + '" type="button">' +
      '<span class="ob-row-main"><span class="opt-name">' + UI.esc(name) + "</span>" +
      (detail ? '<span class="opt-detail">' + UI.esc(detail) + "</span>" : "") + "</span>" +
      icon("chevronRight", 14, "chev") + "</button>";
  }

  function rowsHtml() {
    var j = J();
    if (j.review === "needs_info") {
      var cs = j.comments || [];
      if (!cs.length) return "";
      return '<div class="ob-rows hub-rows">' + cs.map(function (c, i) {
        return rowHtml(c.target, c.stepName, "c" + i);
      }).join("") + "</div>";
    }
    if (j.review === "rejected") {
      return '<div class="ob-rows hub-rows">' + rowHtml("Reason for the decision", "", "reason") + "</div>";
    }
    return "";
  }

  function openComment(c) {
    var h = UI.drawer(c.target, '<p class="ob-text">' + UI.esc(c.text) + "</p>", {
      width: 440,
      subtitle: c.stepName,
      foot: '<button class="btn btn-secondary" id="hcClose" type="button">Close</button>' +
        (canAct() ? '<button class="btn btn-primary" id="hcFix" type="button">Fix</button>' : "")
    });
    h.el.querySelector("#hcClose").addEventListener("click", h.close);
    var fix = h.el.querySelector("#hcFix");
    if (fix) fix.addEventListener("click", function () {
      h.close();
      if (window.PrimeKyc && PrimeKyc.goTo) PrimeKyc.goTo(c.stepIdx);
      App.go("kyc");
    });
  }

  function openReason() {
    var reason = J().rejectedReason || "Source of funds could not be verified";
    var h = UI.drawer("Decision",
      '<div class="def-group">' +
        '<div class="def-row"><span class="def-label">Status</span><span class="def-value">' + UI.statusDot("error", "Rejected") + "</span></div>" +
        '<div class="def-row"><span class="def-label">Reason</span><span class="def-value">' + UI.esc(reason) + "</span></div>" +
      "</div>" +
      '<p class="ob-text mt-16">Reapply after 30 days with bank statements covering the last 6 months.</p>' +
      '<p class="ob-text mt-8">To appeal, reply to the decision email with supporting documents.</p>',
      {
        width: 440,
        foot: '<button class="btn btn-secondary" id="hrClose" type="button">Close</button>'
      });
    h.el.querySelector("#hrClose").addEventListener("click", h.close);
  }

  // ————— deposit: a sheet from a button, never a block on the page —————
  // Mirrors balance.js's openDeposit: the same copy-ready rows, the account
  // name verbatim (the sending bank's confirmation-of-payee check fails on
  // any edited version of that string).

  function openDeposit() {
    var v = Data.VIBANS.AED;
    var h = UI.drawer("Deposit",
      '<div class="hub-dep-cur">' + UI.ccy("AED") + "</div>" +
      UI.copyRow("IBAN", v.iban, { mono: true, copy: v.copy }) +
      UI.copyRow("Account name", Data.ACCOUNT_NAME, { copy: Data.ACCOUNT_NAME }) +
      '<div class="copy-row"><span class="cr-label">Bank</span><span class="cr-value">Zand Bank · Dubai, UAE</span></div>' +
      '<div class="hub-dep-cur mt-16">' + UI.ccy("USDT") + "</div>" +
      UI.copyRow("Address", Data.USDT_ADDRS.TRC20, { mono: true, copy: Data.USDT_ADDRS.TRC20 }) +
      '<div class="copy-row"><span class="cr-label">Network</span><span class="cr-value">TRC20 · Tron</span></div>',
      {
        width: 480,
        foot: '<button class="btn btn-secondary" id="hdClose" type="button">Close</button>'
      });
    h.el.querySelector("#hdClose").addEventListener("click", h.close);
  }

  // ————— the one action —————

  function actionsHtml() {
    var r = J().review;
    var viewerLine = '<p class="ob-sub">Only an admin can work on the application.</p>';
    var contact = '<a class="btn btn-secondary" href="mailto:onboarding@fasset.com">Contact us</a>';

    if (r === "approved") {
      return '<div class="ob-cta-row">' +
        '<button class="btn btn-primary btn-lg" id="hubGo" type="button">Open Prime</button>' +
        (J().railsIssuing ? "" : '<button class="btn btn-ghost" id="hubDeposit" type="button">Deposit</button>') +
        "</div>";
    }
    if (r === "not_started" || r === "in_progress") {
      if (!canAct()) return viewerLine;
      return '<div class="ob-cta-row"><button class="btn btn-primary btn-lg" id="hubResume" type="button">' +
        (r === "not_started" ? "Start" : "Resume") + "</button></div>";
    }
    if (r === "needs_info") {
      if (!canAct()) return viewerLine;
      return '<div class="ob-cta-row"><button class="btn btn-primary btn-lg" id="hubFix" type="button">Fix and resubmit</button></div>';
    }
    // in_review · parked · rejected: nothing to do here but reach us
    return '<div class="ob-cta-row">' + contact + "</div>";
  }

  // ————— the body —————

  function staleHtml() {
    if (!Data.state.stale) return "";
    return '<div class="hub-stale">' +
      UI.statusDot("warning", "Connection interrupted. Status as of " + UI.fmtTime(new Date(Date.now() - 9 * 60000).toISOString()) + ".") +
      "</div>";
  }

  function bodyHtml() {
    return '<h1 class="ob-title">' + UI.esc(titleFor(J().review)) + "</h1>" +
      // the settle's host. It reserves exactly the 9px the hairline occupies
      // (8px offset + 1px rule), so the completion mark arrives and leaves
      // without moving a word of the copy under it.
      '<div class="hub-settle"></div>' +
      staleHtml() +
      '<div class="hub-timeline">' + UI.timeline(timelineItems()) + "</div>" +
      rowsHtml() +
      actionsHtml();
  }

  var PUSHES = [
    { s: "in_review", label: "Submitted → in review" },
    { s: "needs_info", label: "Reviewer: request info (2 comments)" },
    { s: "approved_issuing", label: "Reviewer: approve (rails being issued)" },
    { s: "approved", label: "Reviewer: approve (rails issued)" },
    { s: "rejected", label: "Reviewer: reject" },
    { s: "parked", label: "Triage: park" },
    { s: "in_progress", label: "Reset: journey in progress" }
  ];

  function demoHtml() {
    var r = J().review;
    return '<div class="ob-demo-row">' +
      PUSHES.map(function (p) {
        return '<button class="db-btn' + (r === p.s ? " on" : "") + '" data-push="' + p.s + '" type="button">' +
          UI.esc(p.label) + "</button>";
      }).join("") + "</div>" +
      '<span class="freshline">Demo · stands in for the human review in Optimus.</span>';
  }

  function skeletonHtml() {
    return '<div class="bare-sheet ob-sheet ob-hub">' +
      UI.skel("60%", "30px") +
      '<div class="mt-24">' + UI.skel("100%", "14px") + "</div>" +
      '<div class="mt-12">' + UI.skel("80%", "14px") + "</div>" +
      '<div class="mt-12">' + UI.skel("70%", "14px") + "</div>" +
      '<div class="mt-24">' + UI.skel("120px", "38px") + "</div>" +
      "</div>";
  }

  // — the completion moment. An application clearing compliance is the
  //   single biggest thing that happens to a client in this product, so
  //   the line that says so gets the settle: one accent hairline, 740ms,
  //   self-removing. It fires on the transition only. Landing on a hub
  //   that was already approved is not an event, and marking it would be
  //   a lie about when it happened. —
  function settleIfApproved(host) {
    var now = sig(), was = lastSig;
    lastSig = now;
    if (was && was !== now && now.indexOf("approved") === 0) {
      UI.settleFlash(host.querySelector(".hub-settle"));
    }
  }

  function wireBody(host) {
    var resume = host.querySelector("#hubResume");
    if (resume) resume.addEventListener("click", function () {
      if (J().review === "not_started") Data.setJourney({ review: "in_progress" });
      App.go("kyc");
    });
    var fix = host.querySelector("#hubFix");
    if (fix) fix.addEventListener("click", function () { App.go("kyc"); });
    var goApp = host.querySelector("#hubGo");
    if (goApp) goApp.addEventListener("click", function () { App.go("dashboard"); });
    var dep = host.querySelector("#hubDeposit");
    if (dep) dep.addEventListener("click", openDeposit);

    host.querySelectorAll("[data-hubrow]").forEach(function (b) {
      b.addEventListener("click", function () {
        var k = b.getAttribute("data-hubrow");
        if (k === "reason") { openReason(); return; }
        var c = (J().comments || [])[+k.slice(1)];
        if (c) openComment(c);
      });
    });
  }

  function paintBody() {
    var host = region();
    if (!host) return;
    UI.repaint(host, bodyHtml());
    wireBody(host);
    settleIfApproved(host);
    var demo = ROOT.querySelector(".ob-demo");
    if (demo) demo.innerHTML = demoHtml();
  }

  function render(el) {
    if (!loadedOnce) {
      var body = document.createElement("div");
      body.innerHTML = skeletonHtml();
      el.appendChild(body);
      setTimeout(function () {
        loadedOnce = true;
        if (document.body.contains(el)) { body.remove(); renderBody(el); }
      }, 320);
      return;
    }
    renderBody(el);
  }

  function renderBody(el) {
    ROOT = el;
    var right = document.getElementById("bareRight");
    if (right) right.textContent = window.PrimeOnboarding ? PrimeOnboarding.email() : Data.state.user.email;

    el.insertAdjacentHTML("beforeend",
      '<div class="bare-sheet ob-sheet ob-hub"><div data-hubsec="body">' + bodyHtml() + "</div></div>" +
      '<div class="ob-demo wide">' + demoHtml() + "</div>");

    var host = region();
    wireBody(host);
    settleIfApproved(host);

    // the pushes are delegated once: the strip's contents are rewritten on
    // every repaint so the "on" marker follows the state
    el.querySelector(".ob-demo").addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("[data-push]");
      if (b) Data.reviewerAction(b.getAttribute("data-push"));
    });
  }

  App.registerScreen("hub", {
    title: "Status hub",
    zone: "onboard",
    render: render,
    onData: function (scope) {
      if (!ROOT || !document.body.contains(ROOT) || !region()) return false;
      if (scope === "notifs") return true;
      if (scope === "journey" || scope === "prefs") { paintBody(); return true; }
      return false;
    }
  });
})();
