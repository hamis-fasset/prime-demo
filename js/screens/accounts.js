/* ————————————————————————————————————————————————
   Fasset Prime — Accounts (was Whitelist; renamed and absorbed in
   IA v2, 2026-09-03: adding a deposit/withdrawal account or wallet is
   one process, so it gets one home and a plain name).

   Client labels are the locked vocabulary:
   · banks   Submitted → Pending review → Approved · Rejected   (no test
     transfer: the entity-name match at review is the control)
   · wallets Submitted → Pending review → Test transfer → Approved ·
     Rejected (the Satoshi test: the client sends any small amount FROM
     the wallet TO their USDT deposit address; the chain webhook detects
     it and approval is automatic)

   2026-09-03 rework (Hamis): rows are clean and fully tappable; the
   details drawer carries the lifecycle timeline, the rejection reason,
   the test-transfer instructions (with the deposit address) and Remove.
   Nothing actionable or explanatory lives in a row.

   Screening still happens at entry (a refused address is refused in
   the form, finally). Travel-rule fields are part of the add form —
   required, one submit, never a separate state. Adds and removals are
   step-up gated. Approval auto-links a bank account: withdrawals
   ready, inbound transfers matched to the vIBAN.
   ———————————————————————————————————————————————— */
(function () {
  "use strict";

  var loadedOnce = false;
  var TAB = "banks";          // banks | wallets
  var QUEUED_ADD = null;      // currency queued by Withdraw's "Add" CTA
  var armScreen = false;      // demo: next submitted address fails screening
  var screened = [];          // addresses already refused by screening
  var TESTED = null;          // wallet ids already approved (for the settle)
  var ROOT = null;

  var NET_NAME = { TRON: "TRON", ETH: "Ethereum", BTC: "Bitcoin" };
  var NET_RE = {
    TRON: /^T[1-9A-HJ-NP-Za-km-z]{33}$/,
    ETH: /^0x[0-9a-fA-F]{40}$/,
    BTC: /^bc1[0-9a-z]{20,60}$/
  };

  function ccy(v, opts) { return UI.ccy ? UI.ccy(v, opts) : UI.esc(v); }
  function phone() { return !!(App.isPhone && App.isPhone()); }
  function swap(node, html) { if (UI.repaint) UI.repaint(node, html); else node.innerHTML = html; }
  function settle(node) { if (node && UI.settleFlash) UI.settleFlash(node); }
  function isAdmin() { return Data.state.role === "admin"; }
  function entity() { return Data.state.user.entity; }
  function region(id) { return ROOT ? ROOT.querySelector('[data-accsec="' + id + '"]') : null; }

  // ————— the locked labels —————

  function walletStatus(state) {
    if (state === "submitted") return UI.statusDot("info", "Submitted");
    if (state === "pending") return UI.statusDot("warning", "Pending review");
    if (state === "verified") return UI.statusDot("warning", "Test transfer");
    if (state === "tested") return UI.statusDot("positive", "Approved");
    if (state === "rejected") return UI.statusDot("error", "Rejected");
    return UI.statusDot("neutral", state);
  }

  function bankStatus(state) {
    if (state === "submitted") return UI.statusDot("info", "Submitted");
    if (state === "pending") return UI.statusDot("warning", "Pending review");
    if (state === "verified") return UI.statusDot("positive", "Approved");
    if (state === "rejected") return UI.statusDot("error", "Rejected");
    return UI.statusDot("neutral", state);
  }

  // ————— screening at entry —————

  function screeningFails(addr) {
    if (screened.indexOf(addr) >= 0) return true;
    if (!armScreen) return false;
    armScreen = false;
    screened.push(addr);
    var btn = document.getElementById("accArm");
    if (btn) btn.classList.remove("armed");
    return true;
  }

  // ————— add wallet —————

  function openAddWallet() {
    var h = UI.drawer("Add a wallet",
      '<div class="steps" style="margin-bottom:16px"><span class="step active">Details</span><span class="sep">·</span>' +
        '<span class="step">Review</span><span class="sep">·</span>' +
        '<span class="step">Test transfer</span><span class="sep">·</span>' +
        '<span class="step">Approved</span></div>' +
      '<div class="note note-error hide" id="awScreen">This address failed screening and can’t be added. Contact support if that looks wrong.</div>' +
      '<div class="field mt-16"><label for="awLabel">Label</label>' +
        '<input id="awLabel" class="input" placeholder="Treasury cold wallet" autocomplete="off"></div>' +
      '<div class="field-row">' +
        '<div class="field mv-narrow"><label for="awNet">Network</label>' +
          '<select id="awNet" class="select"><option value="TRON">TRON</option><option value="ETH">Ethereum</option><option value="BTC">Bitcoin</option></select></div>' +
        '<div class="field"><label for="awAddr">Address</label>' +
          '<input id="awAddr" class="input mono" placeholder="Paste the address" autocomplete="off">' +
          '<div class="hint err hide" id="awAddrErr"></div></div>' +
      "</div>" +
      '<div class="field"><label>Custody</label><div class="seg">' +
        '<button class="seg-btn active" data-cust="hosted" type="button">Hosted · an exchange or VASP</button>' +
        '<button class="seg-btn" data-cust="self" type="button">Self-hosted</button>' +
      "</div></div>" +
      '<div id="awHosted">' +
        '<div class="field"><label for="awVasp">VASP or exchange name</label>' +
          '<input id="awVasp" class="input" placeholder="Binance" autocomplete="off"></div>' +
        '<div class="field"><label for="awBenName">Beneficiary legal name</label>' +
          '<input id="awBenName" class="input" autocomplete="off"></div>' +
        '<div class="field"><label for="awBenCountry">Beneficiary country</label>' +
          '<select id="awBenCountry" class="select"><option value="">Select a country</option>' +
          '<option>United Arab Emirates</option><option>United Kingdom</option><option>Singapore</option><option>Other</option></select></div>' +
      "</div>" +
      '<div id="awSelf" class="hide">' +
        '<label class="wl-ack"><input type="checkbox" id="awAck">' +
        '<span>This self-hosted wallet is owned and controlled by ' + UI.esc(entity()) + ".</span></label>" +
      "</div>" +
      '<div class="hint err hide" id="awMsg"></div>',
      {
        width: 560,
        foot: '<button class="btn btn-secondary" id="awCancel" type="button">Cancel</button>' +
              '<button class="btn btn-primary" id="awSubmit" type="button">Submit</button>'
      });

    var hosted = true;
    var q = function (sel) { return h.el.querySelector(sel); };
    q("#awLabel").focus();

    h.el.querySelectorAll("[data-cust]").forEach(function (b) {
      b.addEventListener("click", function () {
        hosted = b.getAttribute("data-cust") === "hosted";
        h.el.querySelectorAll("[data-cust]").forEach(function (x) { x.classList.toggle("active", x === b); });
        q("#awHosted").classList.toggle("hide", !hosted);
        q("#awSelf").classList.toggle("hide", hosted);
        q("#awMsg").classList.add("hide");
      });
    });
    q("#awAddr").addEventListener("input", function () {
      q("#awAddrErr").classList.add("hide");
      q("#awAddr").classList.remove("invalid");
      q("#awScreen").classList.add("hide");
    });
    q("#awCancel").addEventListener("click", h.close);

    q("#awSubmit").addEventListener("click", function () {
      var net = q("#awNet").value, a = q("#awAddr").value.trim();
      if (!a || !NET_RE[net].test(a)) {
        q("#awAddrErr").textContent = a ? "That doesn’t look like a " + NET_NAME[net] + " address." : "Paste the address.";
        q("#awAddrErr").classList.remove("hide");
        q("#awAddr").classList.add("invalid");
        return;
      }
      if (screeningFails(a)) {
        q("#awScreen").classList.remove("hide");
        q("#awAddr").classList.add("invalid");
        h.body.scrollTop = 0;
        return;
      }
      var missing = hosted
        ? [q("#awVasp").value.trim() ? null : "VASP name",
           q("#awBenName").value.trim() ? null : "beneficiary legal name",
           q("#awBenCountry").value ? null : "beneficiary country"].filter(Boolean)
        : (q("#awAck").checked ? [] : ["ownership declaration"]);
      if (missing.length) {
        q("#awMsg").textContent = "Missing: " + missing.join(", ") + ".";
        q("#awMsg").classList.remove("hide");
        return;
      }
      UI.stepUp("Adding a withdrawal destination changes where money can leave Fasset.", function () {
        Data.addWallet({ label: q("#awLabel").value.trim() || "Unnamed wallet", net: NET_NAME[net], addr: a });
        h.close();
      });
    });
  }

  // ————— add bank account —————

  function openAddBank(presetCur) {
    var h = UI.drawer("Add a bank account",
      '<div class="steps" style="margin-bottom:16px"><span class="step active">Details</span><span class="sep">·</span>' +
        '<span class="step">Review</span><span class="sep">·</span>' +
        '<span class="step">Approved</span></div>' +
      '<div class="note note-warning">The account must be in your entity’s legal name: ' + UI.esc(entity()) + ".</div>" +
      '<div class="field mt-16"><label for="abIban">IBAN</label>' +
        '<input id="abIban" class="input mono" placeholder="AE00 0000 0000 0000 0000 000" autocomplete="off">' +
        '<div class="hint err hide" id="abIbanErr"></div></div>' +
      '<div class="field-row">' +
        '<div class="field"><label for="abBank">Bank</label><input id="abBank" class="input" placeholder="Emirates NBD" autocomplete="off"></div>' +
        '<div class="field mv-narrow"><label for="abCur">Currency</label>' +
          '<select id="abCur" class="select"><option>AED</option><option>USD</option><option>EUR</option><option>BHD</option></select></div>' +
      "</div>" +
      '<div class="field"><label for="abTitle">Account title</label>' +
        '<input id="abTitle" class="input" value="' + UI.esc(entity()) + '" autocomplete="off"></div>' +
      '<div class="field"><label>IBAN letter or statement header</label>' +
        uploaderHtml("abUp", "No document attached yet.") +
        '<div class="hint err hide" id="abDocErr">Attach the document.</div></div>' +
      '<div class="hint err hide" id="abBankErr">Name the bank.</div>',
      {
        width: 520,
        foot: '<button class="btn btn-secondary" id="abCancel" type="button">Cancel</button>' +
              '<button class="btn btn-primary" id="abSubmit" type="button">Submit</button>'
      });

    var up = wireUploader(h.el.querySelector("#abUp"));
    var q = function (s) { return h.el.querySelector(s); };
    if (presetCur && presetCur !== "USDT") q("#abCur").value = presetCur;
    q("#abIban").focus();
    q("#abIban").addEventListener("input", function () {
      q("#abIbanErr").classList.add("hide");
      q("#abIban").classList.remove("invalid");
    });
    q("#abBank").addEventListener("input", function () { q("#abBankErr").classList.add("hide"); });
    q("#abCancel").addEventListener("click", h.close);

    q("#abSubmit").addEventListener("click", function () {
      var raw = q("#abIban").value.replace(/\s/g, "").toUpperCase();
      var bad = /^AE/.test(raw)
        ? (!/^AE\d{21}$/.test(raw) && "A UAE IBAN is AE followed by 21 digits.")
        : (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(raw) && "That doesn’t look like an IBAN.");
      if (bad) {
        q("#abIbanErr").textContent = bad;
        q("#abIbanErr").classList.remove("hide");
        q("#abIban").classList.add("invalid");
        return;
      }
      if (!q("#abBank").value.trim()) { q("#abBankErr").classList.remove("hide"); return; }
      if (!up.isDone()) { q("#abDocErr").classList.remove("hide"); return; }
      UI.stepUp("Adding a withdrawal destination changes where money can leave Fasset.", function () {
        Data.addBank({
          bank: q("#abBank").value.trim(),
          iban: q("#abIban").value.trim(),
          title: q("#abTitle").value.trim() || entity(),
          cur: q("#abCur").value
        });
        h.close();
      });
    });
  }

  // ————— simulated document upload —————

  function uploaderHtml(id, label) {
    return '<div class="wl-up" id="' + id + '">' +
      '<span class="wl-up-meta">' + UI.esc(label) + "</span>" +
      '<span class="wl-up-bar"><i></i></span>' +
      '<label class="link" for="' + id + '-f">Attach</label>' +
      '<input type="file" id="' + id + '-f" class="hide"></div>';
  }

  function wireUploader(box) {
    var st = { done: false };
    if (!box) return { isDone: function () { return false; } };
    box.querySelector("input[type=file]").addEventListener("change", function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      box.querySelector(".wl-up-meta").textContent = f.name + " · attaching";
      box.querySelector(".wl-up-bar").classList.add("run");
      setTimeout(function () {
        box.classList.add("done");
        box.querySelector(".wl-up-meta").textContent = f.name + " · attached";
        st.done = true;
      }, 760);
    });
    return { isDone: function () { return st.done; } };
  }

  // ————— registries — clean rows, every row opens the details drawer —————
  // Reasons, test instructions and Remove all live in the drawer. A row is
  // the fact (who · where · status · when) and a tap gets the rest.
  //
  // Phone roles (2026-09-04): line 1 is the account/wallet title, line 2 is
  // the status and the bank·currency or network. The added date drops out —
  // it is the drawer timeline's first entry ("Submitted", "Added by the
  // desk"), so the fact is one tap away and never duplicated in the row.
  // The address / IBAN sub-line carries .desc so the phone layer's
  // `.m-row [data-m="title"] .desc` rule folds the row to one line; both
  // strings are in the drawer's def-group in full.

  function walletsTable() {
    return '<div class="wl-table">' + UI.table({
      cols: [
        { label: "Wallet", w: "minmax(0, 1fr)", m: "title" },
        { label: "Network", w: "130px", m: "meta" },
        { label: "Status", w: "170px", m: "status" },
        { label: "Added", w: "105px", m: "hide" }
      ],
      rows: Data.state.wallets.map(function (w) {
        return {
          key: w.id,
          clickable: true,
          cls: "wlrow",
          cells: [
            '<span class="cell-main"><span class="mv-idcell">' +
              '<span class="name">' + UI.esc(w.label) + "</span>" +
              '<span class="wl-addr desc">' + UI.esc(w.addr) + "</span>" +
              "</span></span>",
            '<span class="wl-net">' + ccy(w.net) + "</span>",
            walletStatus(w.state),
            '<span class="date">' + UI.esc(UI.fmtDate(w.added)) + "</span>"
          ]
        };
      }),
      empty: "No wallets yet."
    }) + "</div>";
  }

  function banksTable() {
    return '<div class="wl-table">' + UI.table({
      cols: [
        { label: "Account", w: "minmax(0, 1fr)", m: "title" },
        { label: "Bank", w: "170px", m: "meta" },
        { label: "Status", w: "170px", m: "status" },
        { label: "Added", w: "105px", m: "hide" }
      ],
      rows: Data.state.banks.map(function (b) {
        return {
          key: b.id,
          clickable: true,
          cls: "wlrow",
          cells: [
            '<span class="cell-main"><span class="mv-idcell">' +
              '<span class="name">' + UI.esc(b.title) + "</span>" +
              '<span class="wl-addr desc">' + UI.esc(b.iban) + "</span>" +
              "</span></span>",
            '<span class="desc">' + UI.esc(b.bank + " · " + b.cur) + "</span>",
            bankStatus(b.state),
            '<span class="date">' + UI.esc(UI.fmtDate(b.added)) + "</span>"
          ]
        };
      }),
      empty: "No bank accounts yet."
    }) + "</div>";
  }

  // ————— the details drawer: lifecycle, reasons, the test, Remove —————

  function drow(label, valueHtml, strong) {
    return '<div class="def-row"><span class="def-label">' + UI.esc(label) +
      '</span><span class="def-value' + (strong ? " strong" : "") + '">' + valueHtml + "</span></div>";
  }

  function walletTimeline(w) {
    var t = [{ label: "Submitted", state: "done", time: UI.fmtTs(w.added) }];
    if (w.state === "rejected") {
      t.push({ label: "Rejected", sub: w.reason || "", state: "failed" });
      return t;
    }
    t.push({ label: "Pending review",
      state: w.state === "submitted" ? "todo" : w.state === "pending" ? "pending" : "done",
      time: w.reviewTs ? UI.fmtTs(w.reviewTs) : "" });
    t.push({ label: "Test transfer",
      state: w.state === "verified" ? "pending" : w.state === "tested" ? "done" : "todo",
      time: w.testTs ? UI.fmtTs(w.testTs) : "" });
    t.push({ label: "Approved", state: w.state === "tested" ? "done" : "todo" });
    return t;
  }

  function bankTimeline(b) {
    if (b.byDesk) {
      return [
        { label: "Added by the desk", state: "done", time: UI.fmtTs(b.added) },
        { label: "Approved", state: "done" }
      ];
    }
    var t = [{ label: "Submitted", state: "done", time: UI.fmtTs(b.added) }];
    if (b.state === "rejected") {
      t.push({ label: "Rejected", sub: b.reason || "", state: "failed" });
      return t;
    }
    t.push({ label: "Pending review",
      state: b.state === "submitted" ? "todo" : b.state === "pending" ? "pending" : "done",
      time: b.reviewTs ? UI.fmtTs(b.reviewTs) : "" });
    t.push({ label: "Approved", state: b.state === "verified" ? "done" : "todo" });
    return t;
  }

  // the Satoshi test, mocked end to end: instruction + the deposit address to
  // send to + a chain push. Visible only while the wallet waits on its test.
  function walletTestBlock(w) {
    var addr = w.net === "Ethereum" ? Data.USDT_ADDRS.ERC20 : Data.USDT_ADDRS.TRC20;
    var net = w.net === "Ethereum" ? "ERC20" : "TRC20";
    return '<div class="note note-warning mt-16">Send any small amount from this wallet to your USDT deposit address. Approval is automatic.</div>' +
      '<div class="def-group mt-8">' +
        drow("Send to", '<span style="font-family:var(--font-mono);font-size:var(--text-12)">' + UI.esc(addr) + "</span>") +
        drow("Network", UI.esc(net)) +
      "</div>" +
      '<div class="mt-8">' + UI.statusDot("info", "Watching the chain for your transfer") + "</div>" +
      '<div class="demo-strip mt-12"><span class="freshline">Demo · the chain.</span>' +
        '<button class="db-btn" data-awd-test="' + UI.esc(w.id) + '" type="button">Transfer detected on-chain</button></div>';
  }

  function walletDetailsHtml(w) {
    return '<div class="def-group">' +
        drow("Wallet", UI.esc(w.label), true) +
        drow("Status", walletStatus(w.state)) +
        drow("Network", ccy(w.net)) +
        drow("Address", '<span style="font-family:var(--font-mono);font-size:var(--text-12);word-break:break-all">' + UI.esc(w.addr) + "</span>") +
      "</div>" +
      (w.state === "verified" ? walletTestBlock(w) : "") +
      '<div class="mt-16">' + UI.timeline(walletTimeline(w)) + "</div>";
  }

  function bankDetailsHtml(b) {
    return '<div class="def-group">' +
        drow("Account", UI.esc(b.title), true) +
        drow("Status", bankStatus(b.state)) +
        drow("Bank", UI.esc(b.bank)) +
        drow("IBAN", '<span style="font-family:var(--font-mono);font-size:var(--text-12);word-break:break-all">' + UI.esc(b.iban) + "</span>") +
        drow("Currency", ccy(b.cur)) +
      "</div>" +
      '<div class="mt-16">' + UI.timeline(bankTimeline(b)) + "</div>";
  }

  function openDetails(kind, id) {
    var find = function () {
      var list = kind === "wallet" ? Data.state.wallets : Data.state.banks;
      return list.filter(function (x) { return x.id === id; })[0] || null;
    };
    var rec = find();
    if (!rec) return;
    var canRemove = isAdmin();
    var refresh;
    var h = UI.drawer(kind === "wallet" ? "Wallet details" : "Bank account details", "", {
      width: 460,
      onClose: function () { Data.off(refresh); },
      foot: (canRemove ? '<button class="btn btn-secondary" id="awdRemove" type="button">Remove</button>' : "") +
            '<button class="btn btn-secondary" id="awdClose" type="button">Close</button>'
    });
    function paintBody() {
      var r = find();
      if (!r) { h.close(); return; }
      h.body.innerHTML = kind === "wallet" ? walletDetailsHtml(r) : bankDetailsHtml(r);
      var t = h.body.querySelector("[data-awd-test]");
      if (t) t.addEventListener("click", function () {
        if (!Data.walletTestDetected(t.getAttribute("data-awd-test"))) UI.toast("No wallet awaiting its test transfer.", "blocked");
      });
    }
    refresh = function (scope) { if (scope === "whitelist") paintBody(); };
    Data.on(refresh);
    paintBody();
    h.el.querySelector("#awdClose").addEventListener("click", h.close);
    var rm = h.el.querySelector("#awdRemove");
    if (rm) rm.addEventListener("click", function () {
      UI.stepUp("Removing a withdrawal destination takes effect immediately.", function () {
        if (kind === "wallet") Data.removeWallet(id); else Data.removeBank(id);
        h.close();
      });
    });
  }

  function tabsHtml() {
    return '<div class="seg">' +
      '<button class="seg-btn' + (TAB === "banks" ? " active" : "") + '" data-acc="banks" type="button">Bank accounts</button>' +
      '<button class="seg-btn' + (TAB === "wallets" ? " active" : "") + '" data-acc="wallets" type="button">Wallets</button>' +
      "</div>";
  }

  function registryHtml() {
    return TAB === "wallets" ? walletsTable() : banksTable();
  }

  function demoHtml() {
    return '<span class="freshline">Demo · the desk and the chain.</span>' +
      '<div class="demo-strip">' +
        '<button class="db-btn' + (armScreen ? " armed" : "") + '" id="accArm" type="button">Arm: the next address fails screening</button>' +
        '<button class="db-btn" id="accVerify" type="button">Desk: approve the oldest pending</button>' +
        '<button class="db-btn" id="accReject" type="button">Desk: reject the oldest pending</button>' +
        '<button class="db-btn" id="accTest" type="button">Chain: test transfer detected</button>' +
        '<button class="db-btn" id="accDesk" type="button">Desk adds a bank account</button>' +
      "</div>";
  }

  function paint(id, fade) {
    var node = region(id);
    if (!node) return;
    var html = id === "tabs" ? tabsHtml() : id === "registry" ? registryHtml() : demoHtml();
    if (fade) swap(node, html); else node.innerHTML = html;
    if (id === "registry") markApproved(node);
  }

  function setTab(t) {
    if (TAB === t) return;
    TAB = t;
    paint("tabs", false);
    paint("registry", true);
    var add = ROOT && ROOT.querySelector("#accAdd");
    if (add) add.textContent = TAB === "wallets" ? "Add wallet" : "Add bank account";
  }

  // the completion moment: a wallet's test landing on-chain
  function approvedNow() {
    var m = {};
    Data.state.wallets.forEach(function (w) { if (w.state === "tested") m[w.id] = 1; });
    return m;
  }

  function markApproved(node) {
    var now = approvedNow();
    if (TESTED === null) { TESTED = now; return; }
    var fresh = Object.keys(now).filter(function (id) { return !TESTED[id]; });
    TESTED = now;
    if (!fresh.length) return;
    requestAnimationFrame(function () {
      fresh.forEach(function (id) {
        settle(node.querySelector('.row[data-key="' + id + '"] .mv-idcell'));
      });
    });
  }

  // ————— wiring —————

  function wireOnce(node, id) {
    if (!node || node.getAttribute("data-wired")) return;
    node.setAttribute("data-wired", "1");

    if (id === "tabs") {
      node.addEventListener("click", function (e) {
        var b = e.target.closest && e.target.closest("[data-acc]");
        if (b) setTab(b.getAttribute("data-acc"));
      });
      return;
    }

    if (id === "registry") {
      // the whole row is the tap target; everything else lives in the drawer
      node.addEventListener("click", function (e) {
        var r = e.target.closest && e.target.closest(".row.clickable");
        if (!r) return;
        openDetails(TAB === "wallets" ? "wallet" : "bank", r.getAttribute("data-key"));
      });
      return;
    }

    if (id === "demo") {
      node.addEventListener("click", function (e) {
        var b = e.target.closest && e.target.closest("button");
        if (!b) return;
        if (b.id === "accArm") {
          armScreen = !armScreen;
          b.classList.toggle("armed", armScreen);
          UI.toast(armScreen ? "Armed. The next address fails screening." : "Disarmed.", "note");
        } else if (b.id === "accVerify") {
          if (!Data.verifyOldestPending()) UI.toast("Nothing pending.", "blocked");
        } else if (b.id === "accReject") {
          if (!Data.rejectOldestPending()) UI.toast("Nothing pending.", "blocked");
        } else if (b.id === "accTest") {
          var w = Data.state.wallets.filter(function (x) { return x.state === "verified"; }).pop();
          if (!w || !Data.walletTestDetected(w.id)) UI.toast("No wallet awaiting its test transfer.", "blocked");
        } else if (b.id === "accDesk") {
          setTab("banks");
          Data.deskAddsBank();
        }
      });
    }
  }

  // ————— render —————

  function skeletonHtml() {
    return '<div class="section">' +
      '<div>' + UI.skel("220px", "28px") + "</div>" +
      '<div class="mt-24">' + UI.skel("100%", "56px") + "</div>" +
      '<div class="mt-8">' + UI.skel("100%", "56px") + "</div>" +
      '<div class="mt-8">' + UI.skel("100%", "56px") + "</div>" +
      "</div>";
  }

  function render(el) {
    var add = el.querySelector("#accAdd");
    if (add) add.addEventListener("click", function () {
      if (TAB === "wallets") openAddWallet(); else openAddBank();
    });

    // the skeleton is a desktop pass: on the phone the registry is short
    // enough that a shimmer is a delay, not a waiting vocabulary
    if (!loadedOnce && !phone()) {
      var body = document.createElement("div");
      body.innerHTML = skeletonHtml();
      el.appendChild(body);
      setTimeout(function () {
        loadedOnce = true;
        if (document.body.contains(el)) { body.remove(); renderBody(el); }
      }, 340);
      return;
    }
    renderBody(el);
  }

  function renderBody(el) {
    ROOT = el;
    el.insertAdjacentHTML("beforeend",
      '<div class="wl-tabs" data-accsec="tabs"></div>' +
      '<div class="section" data-accsec="registry"></div>' +
      '<div class="section mv-demo" data-accsec="demo"></div>');
    ["tabs", "registry", "demo"].forEach(function (id) { wireOnce(region(id), id); });
    paint("tabs", false);
    paint("registry", false);
    paint("demo", false);

    // Withdraw's "Add a … account" CTA lands here with the form already open
    if (QUEUED_ADD && isAdmin()) {
      var cur = QUEUED_ADD;
      QUEUED_ADD = null;
      setTimeout(function () {
        if (cur === "USDT") openAddWallet(); else openAddBank(cur);
      }, 80);
    }
  }

  App.registerScreen("accounts", {
    title: "Accounts",
    subtitle: "Where money can arrive from and leave to",
    actions: function () {
      if (Data.state.role !== "admin") return "";
      return '<button class="btn btn-primary" id="accAdd" type="button">' +
        (TAB === "wallets" ? "Add wallet" : "Add bank account") + "</button>";
    },
    zone: "app",
    openTab: function (t) { TAB = t === "wallets" ? "wallets" : "banks"; },
    openAdd: function (cur) {
      TAB = cur === "USDT" ? "wallets" : "banks";
      QUEUED_ADD = cur || "AED";
    },
    render: render,
    onData: function (scope) {
      if (!ROOT || !document.body.contains(ROOT) || !region("registry")) return false;
      if (scope === "notifs") return true;
      if (scope === "whitelist") { paint("registry", true); return true; }
      return false;
    }
  });
})();
