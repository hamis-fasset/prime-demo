/* ————————————————————————————————————————————————
   Fasset Prime — seed state + mutation API.
   Plain script (file:// safe) — exposes window.Data.

   THE RULE: screens never mutate state directly. They call the
   named functions here; every mutation emits a change event and
   the app re-renders. Simulated desk/webhook actions live here
   too — they mirror the real mechanism (webhook-confirmed, never
   operator-asserted) and nothing here does what the backend can't.

   Ported from prime-v2.standalone.html (the functional contract).
   ———————————————————————————————————————————————— */
(function () {
  "use strict";

  function nowIso() { return new Date().toISOString(); }
  function agoIso(mins) { return new Date(Date.now() - mins * 60000).toISOString(); }

  // ————— constants (illustrative figures, from the contract) —————

  // The supported set (Hamis, 2026-09-03): AED, USD, EUR and BHD against
  // USDT, both directions. GBP is out.
  var REF = { "USDT/AED": 3.6728, "USDT/USD": 1.0002, "USDT/EUR": 0.8590, "USDT/BHD": 0.3761 };
  var FX_AED = { AED: 1, USD: 3.6725, EUR: 4.2740, BHD: 9.7670, USDT: 3.6728 }; // reference, for AED-equivalent figures
  var SPREAD = 0.0025;        // Tier 2 = reference + 25 bps
  var LIMIT_AED = 7500000;    // per-trade self-serve limit
  var LOCK_SECS = 60;         // client quote lock (one minute; margin covers it — Hamis 2026-09-03)

  // display vocabulary: proper names title screens, proper symbols sit in the
  // money where one exists in latin script (the rest read their code)
  var CUR_NAMES = { AED: "UAE dirham", USD: "US dollar", EUR: "Euro", BHD: "Bahraini dinar", USDT: "Tether USD" };
  var CUR_SYMBOLS = { USD: "$", EUR: "€" };
  var TEST_AMT = 9.37;        // demo test-transfer amount (random per test in production)

  var VIBANS = {
    AED: { iban: "AE82 0860 0000 3450 1002 87", copy: "AE8208600000345010028700" },
    USD: { iban: "AE19 0860 0000 3450 1003 12", copy: "AE1908600000345010031200" },
    EUR: { iban: "AE31 0860 0000 3450 1004 55", copy: "AE3108600000345010045500" },
    BHD: { iban: "AE64 0860 0000 3450 1005 89", copy: "AE6408600000345010058900" }
  };
  // Must render verbatim — the sending bank's confirmation-of-payee check
  // fails on any styled or edited version of this string.
  var ACCOUNT_NAME = "Fasset Prime client money re Delos Financial Limited";
  var USDT_ADDRS = { TRC20: "TQm4XkNzR2vY8sLcJd91FhBpWaE6uK3o9f", ERC20: "0x84f1C55A9d2E7b3B41a06cE2fB9dD10c47D1e9aA" };

  // Reviewer comments for the needs_info push, per entity journey. The step
  // indexes are journey-specific: the institution wizard has 5 steps, the
  // individual wizard 4, so a shared set would point at a step that does not
  // exist. Wording is the desk-reviewed copy from the old prototype.
  var REV_COMMENTS = {
    institution: [
      { stepIdx: 2, stepName: "Entity documents", target: "Trade licence", text: "The trade licence uploaded expired on 30 Jun 2026. Upload the current licence issued by DET." },
      { stepIdx: 4, stepName: "Leadership details", target: "Ownership declaration", text: "Declared ownership totals 115%. Confirm Lena Farouk's shareholding: the registry extract says 15%, the form says 30%." }
    ],
    individual: [
      { stepIdx: 2, stepName: "Source of income", target: "Bank statement", text: "The statement covers 3 months; we need the last 6." },
      { stepIdx: 3, stepName: "Documents", target: "Passport", text: "The passport scan is missing the signature page." }
    ]
  };

  // Reviewer comments for the IB journey's needs_info push. The IB wizard is
  // the 4-step individual-introducer journey (identity · proof of address ·
  // agreement · payout account — cut to ID + PoA per the 2026-09-02 call),
  // so indexes point there.
  var IB_REV_COMMENTS = [
    { stepIdx: 1, stepName: "Proof of address", target: "Document", text: "The utility bill is older than three months. Send a current one." },
    { stepIdx: 3, stepName: "Payout account", target: "IBAN", text: "The account is in a company name. Payouts go to an account in your own name; send an IBAN letter for a personal account." }
  ];

  // ————— introducing broker: placeholder economics —————
  // Decision 2026-09-02: the IB is always an individual and (for now) never a
  // client. Clients are linked to an IB by the desk in Optimus; the IB sees
  // their trading activity only — trade-level with exact notional — never
  // balances, funding activity or wallet addresses. Payouts go only to the
  // IB's own verified account.
  // PLACEHOLDER MATH: accrual = IB_RATE_BPS of settled notional (AED at
  // reference), per trade, paid monthly. The real schedule is an open item.
  var IB_RATE_BPS = 10; // 0.10% of settled notional — placeholder

  var nextIds = { dep: 2215, wd: 1089, trade: 9932, wallet: 6, bank: 5, notif: 100, desk: 1042 };

  // ————— seed state —————

  var S = {
    // identity
    user: { name: "Reem Al Suwaidi", email: "reem.alsuwaidi@delos.ae", entity: "Delos Financial Limited" },
    role: "admin",                    // admin | trader | viewer (demo preview)
    persona: "client",                // client | ib — which portal the demo shows
    pairOrder: ["USDT/AED", "USDT/USD", "USDT/EUR", "USDT/BHD"],  // client-pinned order (drag to reorder)
    totalCur: "AED",                  // total-balance denomination: AED | USDT (client display pref)
    windowCopy: "30min",              // "30min" | "hours" (OQ9 copy toggle)
    stale: false,                     // balance feed interrupted
    firstRun: false,                  // zero-balance first-run state
    theme: "auto",                    // auto | light | dark

    rails: [                          // all live by default; demo bar can flip to "today"
      { cur: "AED", state: "live" },
      { cur: "USD", state: "live" },
      { cur: "EUR", state: "live" },
      { cur: "BHD", state: "live" }
    ],

    bal: { AED: 12485320.50, USD: 1204880.00, EUR: 460000.00, BHD: 85000.000, USDT: 3145220.10 },

    journey: { review: "not_started", entity: "institution", submittedIso: null, comments: [], rejectedReason: null, railsIssuing: false },

    deposits: [
      { id: "D-2214", cur: "AED", amount: 2450000.00, state: "processing", via: "bank", ts: agoIso(74), crTs: null, sender: "Emirates NBD · your whitelisted account" },
      { id: "D-2213", cur: "AED", amount: 5000000.00, state: "credited", via: "bank", ts: agoIso(60 * 22), crTs: agoIso(60 * 21), sender: "Emirates NBD · your whitelisted account" },
      { id: "D-2209", cur: "USDT", amount: 1000000.00, state: "credited", via: "chain", ts: agoIso(60 * 96), crTs: agoIso(60 * 95), sender: "TRON · TAbCk…9fK2" }
    ],
    // deposit states: detected/processing → credited · failed (client labels: Processing → Completed · Failed)

    withdrawals: [
      { id: "W-1088", cur: "AED", amount: 1837800.00, dest: "Emirates NBD · AE45 0260 ···· 4471", state: "servicing", ts: agoIso(95),
        stamps: { submitted: agoIso(95), servicing: agoIso(80), sent: null, confirmed: null } },
      { id: "W-1082", cur: "AED", amount: 2000000.00, dest: "Emirates NBD · AE45 0260 ···· 4471", state: "confirmed", ts: agoIso(60 * 26),
        stamps: { submitted: agoIso(60 * 26), servicing: agoIso(60 * 25.6), sent: agoIso(60 * 25.4), confirmed: agoIso(60 * 25.1) } },
      { id: "W-1079", cur: "USDT", amount: 500000.00, dest: "Treasury cold · TRON · TAbCk…9fK2", state: "confirmed", ts: agoIso(60 * 120),
        stamps: { submitted: agoIso(60 * 120), servicing: agoIso(60 * 119.8), sent: agoIso(60 * 119.5), confirmed: agoIso(60 * 119.2) } }
    ],
    // withdrawal states: submitted/servicing/sent → confirmed · failed (client labels: Processing → Completed · Failed)

    trades: [
      { id: "T-9931", pair: "USDT/AED", side: "buy", assetAmt: 1500000, fiatAmt: 5521800.00, rate: 3.6812, ts: agoIso(147), byDesk: false,
        state: "settled", needed: 0, stamps: { placed: agoIso(147), funded: agoIso(147), settled: agoIso(118) } },
      { id: "T-9924", pair: "USDT/AED", side: "sell", assetAmt: 600000, fiatAmt: 2198460.00, rate: 3.6641, ts: agoIso(60 * 21), byDesk: false,
        state: "settled", needed: 0, stamps: { placed: agoIso(60 * 21), funded: agoIso(60 * 21), settled: agoIso(60 * 20.5) } },
      { id: "T-9902", pair: "USDT/AED", side: "buy", assetAmt: 2000000, fiatAmt: 7359000.00, rate: 3.6795, ts: agoIso(60 * 75), byDesk: true,
        state: "settled", needed: 0, stamps: { placed: agoIso(60 * 75), funded: agoIso(60 * 75), settled: agoIso(60 * 74.5) } },
      { id: "T-9871", pair: "USDT/USD", side: "buy", assetAmt: 300000, fiatAmt: 300120.00, rate: 1.0004, ts: agoIso(60 * 122), byDesk: false,
        state: "settled", needed: 0, stamps: { placed: agoIso(60 * 122), funded: agoIso(60 * 122), settled: agoIso(60 * 121.5) } }
    ],
    // trade/order states: awaiting → settling → settled · failed (client labels: Awaiting funding → Processing → Completed · Failed)

    wallets: [
      { id: "WL-1", label: "Treasury cold", net: "TRON", addr: "TAbCk9F7uQ2mXw4rN8vJ5sLdYe1pHq9fK2", state: "tested", added: agoIso(60 * 24 * 47), testTs: agoIso(60 * 24 * 46), missing: [], reason: null },
      { id: "WL-2", label: "Ops hot", net: "Ethereum", addr: "0x3D91b7e4A2c85F60D14aB9cE7f2a4408Bb21C4dE", state: "verified", added: agoIso(60 * 24 * 9), testTs: null, missing: [], reason: null },
      { id: "WL-3", label: "Custody", net: "Bitcoin", addr: "bc1qxw4l9k72m3trv8n0p5yj6c2s8u7d34a9e7slw", state: "pending", added: agoIso(60 * 24 * 2), testTs: null, reason: null },
      { id: "WL-4", label: "Market ops", net: "TRON", addr: "TXpQr7Vw2aZs5cLm8dKe4uYh1nB6fJ3g0t", state: "verified", added: agoIso(60 * 24 * 6), testTs: null, reason: null },
      { id: "WL-5", label: "Broker", net: "Ethereum", addr: "0x99Af10c2E44b7D06a913fF25C08bb1a2843DdE07", state: "rejected", added: agoIso(60 * 24 * 12), testTs: null, missing: [], reason: "This address failed screening and can't be whitelisted. Contact support if that looks wrong." }
    ],
    // wallet states: submitted → pending → verified (client sends the Satoshi test) → tested · rejected
    // client labels: Submitted → Pending review → Test transfer → Approved · Rejected

    banks: [
      { id: "B-1", bank: "Emirates NBD", iban: "AE45 0260 0010 1523 4404 471", title: "Delos Financial Limited", cur: "AED", state: "verified", added: agoIso(60 * 24 * 80), reason: null, byDesk: false },
      { id: "B-4", bank: "HSBC", iban: "AE77 0200 0000 8765 4321 001", title: "Delos Financial Limited", cur: "EUR", state: "verified", added: agoIso(60 * 24 * 31), reason: null, byDesk: false },
      { id: "B-2", bank: "First Abu Dhabi Bank", iban: "AE07 0331 2345 6789 0129 902", title: "Delos Financial Limited", cur: "AED", state: "pending", added: agoIso(60 * 3), reason: null, byDesk: false },
      { id: "B-3", bank: "Mashreq", iban: "AE21 0330 0000 1098 7654 321", title: "Delos Holdings FZE", cur: "AED", state: "rejected", added: agoIso(60 * 24 * 20), reason: "Account name doesn't match your entity. Send a bank letter or IBAN certificate in the entity's legal name.", byDesk: false }
    ],
    // bank states: submitted → pending → verified · rejected
    // client labels: Submitted → Pending review → Approved · Rejected

    team: [
      { name: "Reem Al Suwaidi", email: "reem.alsuwaidi@delos.ae", role: "admin", mfa: true, last: "now", state: "active", you: true },
      { name: "Omar Haddad", email: "omar.haddad@delos.ae", role: "trader", mfa: true, last: "2 h ago", state: "active" },
      { name: "Lena Farouk", email: "lena.farouk@delos.ae", role: "viewer", mfa: true, last: "yesterday", state: "active" },
      { name: "—", email: "finance@delos.ae", role: "viewer", mfa: false, last: "—", state: "invited", invitedIso: agoIso(60 * 24 * 3) },
      { name: "Jason Tan", email: "j.tan@delos.ae", role: "trader", mfa: false, last: "—", state: "blocked" }
    ],
    // member states: active · invited · expired · blocked (MFA not enrolled)

    notifs: [
      { id: 1, title: "Deposit processing · AED 2,450,000", body: "It joins your available balance once completed.", ts: agoIso(74), read: false, target: "dashboard" },
      { id: 2, title: "Withdrawal processing · AED 1,837,800", body: "On its way to Emirates NBD ····4471.", ts: agoIso(80), read: false, target: "dashboard" },
      { id: 3, title: "Trade booked · T-9931", body: "Bought 1,500,000 USDT at 3.6812 · AED 5,521,800.", ts: agoIso(147), read: true, target: "dashboard" },
      { id: 4, title: "Bank account pending review · FAB ····9902", body: "", ts: agoIso(180), read: true, target: "accounts" }
    ],

    statements: [
      { period: "August 2026 (to date)", scope: "AED" }, { period: "August 2026 (to date)", scope: "USD" },
      { period: "July 2026", scope: "AED" }, { period: "July 2026", scope: "USD" }, { period: "June 2026", scope: "AED" }
    ],

    // ————— introducing broker (the IB portal's whole world) —————
    // An individual linked to several Prime clients. The linkage itself is a
    // desk action in Optimus (referral code at signup, confirmed at review);
    // nothing on either portal can create or claim a link.
    ib: {
      user: { name: "Karim Mansour", email: "karim@mansouradvisory.com", entity: "Introducing broker" },
      refCode: "KM-2231",
      rateBps: IB_RATE_BPS,
      // the IB's own journey: not_started → in_progress → in_review →
      // needs_info | approved | rejected (always an individual)
      journey: { review: "not_started", submittedIso: null, comments: [], rejectedReason: null, stepsDone: 0 },
      // payouts land in ONE of these and nowhere else — both are the IB's
      // own, desk-verified. The USDT container is a Fireblocks vault the
      // desk creates, named referral-<name> (2026-09-02 call).
      payoutMethod: "bank",   // bank | usdt
      payoutBank: { bank: "Emirates NBD", iban: "AE12 0260 0009 8877 2210 034", title: "Karim Mansour", cur: "AED", state: "verified" },
      payoutWallet: { label: "referral-karim-mansour", custody: "Fireblocks container", net: "TRON", state: "ready" },
      // share: this IB's cut on the client. 1 unless the introduction was
      // shared between IBs; the split is configured desk-side in Optimus.
      clients: [
        { id: "C-1", name: "Delos Financial Limited", type: "Institution", status: "active", introduced: "2026-03-12T09:00:00.000Z", share: 1 },
        { id: "C-2", name: "Al Noor Capital LLC", type: "Institution", status: "active", introduced: "2026-05-02T09:00:00.000Z", share: 0.5 },
        { id: "C-3", name: "Hassan Al Farsi", type: "Individual", status: "onboarding", introduced: "2026-08-27T09:00:00.000Z", share: 1 },
        { id: "C-4", name: "Meridian Trading FZE", type: "Institution", status: "dormant", introduced: "2026-04-18T09:00:00.000Z", share: 1 }
      ],
      // client statuses: active · onboarding · dormant
      // Trades by non-Delos clients. Delos (C-1) rows come live from S.trades
      // via Data.ibTrades(), so a trade booked in the client demo shows up in
      // the IB portal immediately and the two portals can never disagree.
      trades: [
        { clientId: "C-2", id: "T-9928", pair: "USDT/AED", side: "sell", assetAmt: 650000, fiatAmt: 2381730.00, rate: 3.6642, ts: agoIso(60 * 4), state: "settled" },
        { clientId: "C-2", id: "T-9926", pair: "USDT/AED", side: "buy", assetAmt: 2200000, fiatAmt: 8099300.00, rate: 3.6815, ts: agoIso(60 * 26), state: "settled" },
        { clientId: "C-2", id: "T-9899", pair: "USDT/AED", side: "buy", assetAmt: 1400000, fiatAmt: 5152140.00, rate: 3.6801, ts: agoIso(60 * 24 * 4), state: "settled" },
        { clientId: "C-4", id: "T-9614", pair: "USDT/AED", side: "buy", assetAmt: 500000, fiatAmt: 1839400.00, rate: 3.6788, ts: "2026-07-05T09:40:00.000Z", state: "settled" }
      ],
      // closed periods are constants; the current period is computed live
      // from settled trades. Figures are placeholder-math (IB_RATE_BPS).
      payouts: [
        { period: "August 2026", volumeAED: 84600000, amountAED: 84600, state: "scheduled", paidTs: null },
        { period: "July 2026", volumeAED: 61800000, amountAED: 61800, state: "paid", paidTs: "2026-08-03T10:12:00.000Z" },
        { period: "June 2026", volumeAED: 92400000, amountAED: 92400, state: "paid", paidTs: "2026-07-03T09:58:00.000Z" }
      ]
      // payout states: accruing (the live row) → scheduled → paid
    }
  };

  // ————— change events —————

  var listeners = [];
  function emit(scope) {
    listeners.forEach(function (fn) { try { fn(scope || "all"); } catch (e) { console.error(e); } });
  }

  var Data = {
    state: S,
    REF: REF, SPREAD: SPREAD, LIMIT_AED: LIMIT_AED, LOCK_SECS: LOCK_SECS, TEST_AMT: TEST_AMT,
    VIBANS: VIBANS, ACCOUNT_NAME: ACCOUNT_NAME, USDT_ADDRS: USDT_ADDRS,
    CUR_NAMES: CUR_NAMES,
    curName: function (cur) { return CUR_NAMES[cur] || cur; },
    curSymbol: function (cur) { return CUR_SYMBOLS[cur] || cur; },
    on: function (fn) { listeners.push(fn); },
    off: function (fn) { var i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); },

    // ————— derived reads (pure, no mutation) —————

    railLive: function (cur) {
      if (cur === "USDT") return true;
      var r = S.rails.filter(function (x) { return x.cur === cur; })[0];
      return !!r && r.state === "live";
    },
    inflightIn: function (cur) {
      return S.deposits.filter(function (d) { return d.cur === cur && (d.state === "detected" || d.state === "processing"); })
        .reduce(function (a, d) { return a + d.amount; }, 0);
    },
    settlingIn: function (cur) {
      return S.trades.filter(function (t) { return t.state === "settling"; }).reduce(function (a, t) {
        if (t.side === "buy") return a + (cur === "USDT" ? t.assetAmt : 0);
        return a + (cur === Data.fiatOf(t.pair) ? t.fiatAmt : 0);
      }, 0);
    },
    inflightOut: function (cur) {
      return S.withdrawals.filter(function (w) { return w.cur === cur && ["submitted", "servicing", "sent"].indexOf(w.state) >= 0; })
        .reduce(function (a, w) { return a + w.amount; }, 0);
    },
    totalAedApprox: function () {
      return ["AED", "USD", "EUR", "BHD", "USDT"].reduce(function (a, c) { return a + (S.bal[c] || 0) * FX_AED[c]; }, 0);
    },
    unreadCount: function () { return S.notifs.filter(function (n) { return !n.read; }).length; },
    windowCopy: function () {
      return S.windowCopy === "30min" ? "typically completes within 30 minutes" : "completes within business hours";
    },
    eligibleDests: function (cur) {
      if (cur === "USDT") return S.wallets.filter(function (w) { return w.state === "tested"; })
        .map(function (w) { return { id: w.id, label: w.label + " · " + w.net + " · " + w.addr.slice(0, 6) + "…" + w.addr.slice(-4) }; });
      return S.banks.filter(function (b) { return b.state === "verified" && b.cur === cur; })
        .map(function (b) { return { id: b.id, label: b.bank + " · " + b.iban.slice(0, 8) + " ···· " + b.iban.slice(-3) }; });
    },

    // one normalized activity feed — plain fields, no HTML. Screens format.
    // entry: { kind: trade|dep|wd, id, ts, cur, title, sub, dir: +1|-1|0,
    //          amount, status: {kind, label}, obj }
    // Client-facing labels are the locked 8-word vocabulary (2026-09-03):
    // Processing · Completed · Awaiting funding · Failed · Pending review ·
    // Test transfer · Approved · Rejected. Internal states stay as plumbing.
    activity: function () {
      var rows = [];
      S.trades.forEach(function (t) {
        var st = t.state === "settled" ? { kind: "positive", label: "Completed" }
          : t.state === "failed" ? { kind: "error", label: "Failed" }
          : t.state === "settling" ? { kind: "info", label: "Processing" }
          : { kind: "warning", label: "Awaiting funding" };
        rows.push({ kind: "trade", id: t.id, ts: t.ts, cur: Data.fiatOf(t.pair),
          title: (t.side === "buy" ? "Buy " : "Sell ") + Number(t.assetAmt).toLocaleString("en-US") + " USDT at " + t.rate.toFixed(4),
          sub: t.pair + (t.byDesk ? " · booked by the desk" : ""),
          dir: t.side === "buy" ? -1 : 1, amount: t.fiatAmt, status: st, obj: t });
      });
      S.deposits.forEach(function (d) {
        var st = d.state === "credited" ? { kind: "positive", label: "Completed" }
          : d.state === "failed" ? { kind: "error", label: "Failed" }
          : { kind: "info", label: "Processing" };
        rows.push({ kind: "dep", id: d.id, ts: d.ts, cur: d.cur,
          title: "Deposit " + d.id, sub: d.sender || (d.via === "bank" ? "bank transfer" : "on-chain"),
          dir: 1, amount: d.amount, status: st, obj: d });
      });
      S.withdrawals.forEach(function (w) {
        var st = w.state === "confirmed" ? { kind: "positive", label: "Completed" }
          : w.state === "failed" ? { kind: "error", label: "Failed" }
          : { kind: "info", label: "Processing" };
        rows.push({ kind: "wd", id: w.id, ts: w.ts, cur: w.cur,
          title: "Withdrawal " + w.id, sub: w.dest,
          dir: -1, amount: w.amount, status: st, obj: w });
      });
      rows.sort(function (a, b) { return new Date(b.ts) - new Date(a.ts); });
      return rows;
    },

    // ————— introducing broker: reads (pure) —————
    // The IB's visibility boundary is enforced here by construction: these
    // reads expose trades only. There is no read that hands an IB screen a
    // client balance, a deposit, a withdrawal or a wallet.

    ibClient: function (cid) {
      return S.ib.clients.filter(function (c) { return c.id === cid; })[0] || null;
    },
    // AED-equivalent of a trade's fiat leg, at reference — for volume and
    // accrual figures only, never shown as the trade's own amount
    ibNotionalAED: function (t) {
      return t.fiatAmt * Data.fxAED(Data.fiatOf(t.pair));
    },
    // every linked client's trades, normalized, newest first. Delos (C-1)
    // maps live from S.trades; the rest come from the IB seed. Fresh objects
    // every call, so a screen can never mutate either seed.
    ibTrades: function (clientId) {
      var rows = S.trades.map(function (t) {
        return { clientId: "C-1", id: t.id, pair: t.pair, side: t.side, assetAmt: t.assetAmt,
          fiatAmt: t.fiatAmt, rate: t.rate, ts: t.ts, state: t.state, byDesk: !!t.byDesk };
      }).concat(S.ib.trades.map(function (t) {
        return { clientId: t.clientId, id: t.id, pair: t.pair, side: t.side, assetAmt: t.assetAmt,
          fiatAmt: t.fiatAmt, rate: t.rate, ts: t.ts, state: t.state, byDesk: false };
      }));
      if (clientId) rows = rows.filter(function (t) { return t.clientId === clientId; });
      rows.sort(function (a, b) { return new Date(b.ts) - new Date(a.ts); });
      return rows;
    },
    ibPeriodLabel: function () {
      var d = new Date();
      return ["January", "February", "March", "April", "May", "June", "July", "August",
        "September", "October", "November", "December"][d.getMonth()] + " " + d.getFullYear();
    },
    // settled notional this calendar month, AED at reference
    ibMonthVolume: function (clientId) {
      var now = new Date();
      return Data.ibTrades(clientId).reduce(function (a, t) {
        var d = new Date(t.ts);
        if (t.state !== "settled" || d.getMonth() !== now.getMonth() || d.getFullYear() !== now.getFullYear()) return a;
        return a + Data.ibNotionalAED(t);
      }, 0);
    },
    ibMonthTrades: function (clientId) {
      var now = new Date();
      return Data.ibTrades(clientId).filter(function (t) {
        var d = new Date(t.ts);
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      }).length;
    },
    // PLACEHOLDER MATH: flat bps of settled notional, weighted by this IB's
    // share on each client (a shared introduction pays each IB their split;
    // the split itself is configured desk-side). The real schedule is open.
    ibShare: function (clientId) {
      var c = Data.ibClient(clientId);
      return c && c.share != null ? c.share : 1;
    },
    ibAccrual: function (clientId) {
      var ids = clientId ? [clientId] : S.ib.clients.map(function (c) { return c.id; });
      return ids.reduce(function (a, cid) {
        return a + Data.ibMonthVolume(cid) * S.ib.rateBps / 10000 * Data.ibShare(cid);
      }, 0);
    },

    // ————— trade math (quotes are screen-local; ledger changes live here) —————

    fiatOf: function (pair) { return pair.split("/")[1]; },
    refRate: function (pair) { return REF[pair]; },
    notionalAED: function (pair, amt) { return amt * REF["USDT/AED"]; }, // amt is USDT; AED value is pair-independent
    fxAED: function (cur) { return FX_AED[cur] || 1; },
    // returns a quote object the screen holds while the lock runs
    makeQuote: function (pair, side, amtNum) {
      var ref = REF[pair] + (Math.random() - 0.5) * 0.0012;
      return { pair: pair, side: side, amtNum: amtNum, ref: ref,
        rate: ref * (side === "buy" ? 1 + SPREAD : 1 - SPREAD),
        notional: Data.notionalAED(pair, amtNum),
        expiresAt: Date.now() + LOCK_SECS * 1000 };
    },
    // place at the locked rate. Covered orders fund + book instantly
    // (settling); uncovered ones wait for funding at the held rate.
    placeOrder: function (q, rate) {
      var fiat = Data.fiatOf(q.pair);
      var payCur = q.side === "buy" ? fiat : "USDT";
      var payAmt = q.side === "buy" ? q.amtNum * rate : q.amtNum;
      var t = { id: "T-" + (nextIds.trade++), pair: q.pair, side: q.side, assetAmt: q.amtNum, fiatAmt: q.amtNum * rate,
        rate: rate, ts: nowIso(), byDesk: false, payCur: payCur, payAmt: payAmt, needed: 0,
        state: "awaiting", stamps: { placed: nowIso(), funded: null, settled: null } };
      if (S.bal[payCur] >= payAmt) {
        S.bal[payCur] -= payAmt;
        t.state = "settling"; t.stamps.funded = nowIso();
        Data.notify("Order funded and booked · " + t.id,
          (t.side === "buy" ? "Buy " : "Sell ") + Number(t.assetAmt).toLocaleString("en-US") + " USDT at your locked rate " + rate.toFixed(4) + ". Funds release within 30 minutes.", "dashboard");
      } else {
        t.needed = payAmt - S.bal[payCur];
        Data.notify("Order awaiting funding · " + t.id,
          "Placed at your locked rate " + rate.toFixed(4) + ". " + payCur + " " + Number(t.needed.toFixed(2)).toLocaleString("en-US") + " still needed within 24 hours.", "dashboard");
      }
      S.trades.unshift(t);
      emit("trades");
      return t;
    },
    // (Over-limit trades are an offline conversation with the relationship
    //  manager — Hamis 2026-09-03. The in-app desk-request flow is gone.)

    // ————— client actions (portal-side) —————

    submitWithdrawal: function (cur, amount, destLabel) {
      var w = { id: "W-" + (nextIds.wd++), cur: cur, amount: amount, dest: destLabel, state: "submitted", ts: nowIso(),
        stamps: { submitted: nowIso(), servicing: null, sent: null, confirmed: null } };
      S.withdrawals.unshift(w);
      S.bal[cur] -= amount;
      var wc = Data.windowCopy();
      Data.notify("Withdrawal processing · " + cur + " " + Number(amount.toFixed(2)).toLocaleString("en-US"),
        "To " + destLabel + ". " + wc.charAt(0).toUpperCase() + wc.slice(1) + ".", "dashboard");
      emit("withdrawals");
      return w;
    },

    addWallet: function (w) { // { label, net, addr }
      // lands as Submitted, then the desk queue picks it up: Pending review.
      // The flip is a push (mirroring the deposit detected → processing beat).
      var rec = { id: "WL-" + (nextIds.wallet++), label: w.label || "Unnamed wallet", net: w.net, addr: w.addr,
        state: "submitted", added: nowIso(), reviewTs: null, testTs: null, reason: null };
      S.wallets.unshift(rec);
      Data.notify("Wallet submitted", "It goes to the desk for review.", "accounts");
      emit("whitelist");
      setTimeout(function () {
        if (rec.state === "submitted") { rec.state = "pending"; rec.reviewTs = nowIso(); emit("whitelist"); }
      }, 2400);
      return rec;
    },
    // chain webhook: the client's Satoshi test — a small amount sent FROM
    // this wallet TO their USDT deposit address — was detected on-chain.
    // Proves control of the source wallet; approval is automatic.
    walletTestDetected: function (walletId) {
      var w = S.wallets.filter(function (x) { return x.id === walletId && x.state === "verified"; })[0];
      if (!w) return null;
      w.state = "tested"; w.testTs = nowIso();
      Data.notify("Wallet approved · " + w.label, "Test transfer received. Ready as a withdrawal destination.", "accounts");
      emit("whitelist");
      return w;
    },
    removeWallet: function (walletId) {
      for (var i = 0; i < S.wallets.length; i++) if (S.wallets[i].id === walletId) {
        var w = S.wallets.splice(i, 1)[0];
        Data.notify("Wallet removed · " + w.label, "Gone from your accounts and the withdrawal picker.", "accounts");
        emit("whitelist");
        return w;
      }
      return null;
    },
    addBank: function (b) { // { bank, iban, title, cur }
      var rec = { id: "B-" + (nextIds.bank++), bank: b.bank, iban: b.iban, title: b.title, cur: b.cur,
        state: "submitted", added: nowIso(), reviewTs: null, reason: null, byDesk: false };
      S.banks.unshift(rec);
      Data.notify("Bank account submitted", "It goes to the desk for review.", "accounts");
      emit("whitelist");
      setTimeout(function () {
        if (rec.state === "submitted") { rec.state = "pending"; rec.reviewTs = nowIso(); emit("whitelist"); }
      }, 2400);
      return rec;
    },
    removeBank: function (bankId) {
      for (var i = 0; i < S.banks.length; i++) if (S.banks[i].id === bankId) {
        var b = S.banks.splice(i, 1)[0];
        Data.notify("Bank account removed · " + b.bank + " " + b.iban.slice(-4), "Gone from your accounts and the withdrawal picker.", "accounts");
        emit("whitelist");
        return b;
      }
      return null;
    },

    invite: function (email, role) {
      S.team.push({ name: "—", email: email, role: role, mfa: false, last: "—", state: "invited", invitedIso: nowIso() });
      Data.notify("Invite sent · " + email + " as " + role, "They'll get an email to set up their own login.", "team");
      emit("team");
    },
    changeRole: function (email, role) {
      var m = S.team.filter(function (x) { return x.email === email; })[0];
      if (!m) return;
      m.role = role;
      Data.notify("Role changed · " + m.name + " is now " + role, "Effective immediately.", "team");
      emit("team");
    },
    removeMember: function (email) {
      for (var i = 0; i < S.team.length; i++) if (S.team[i].email === email) {
        var m = S.team.splice(i, 1)[0];
        Data.notify("Member removed · " + (m.name === "—" ? m.email : m.name), "Their sessions ended immediately.", "team");
        emit("team");
        return m;
      }
      return null;
    },
    resendInvite: function (email) {
      var m = S.team.filter(function (x) { return x.email === email; })[0];
      if (!m) return;
      m.state = "invited"; m.invitedIso = nowIso();
      emit("team");
    },

    // journey (onboarding hub + KYC wizard)
    setJourney: function (patch) {
      Object.keys(patch).forEach(function (k) { S.journey[k] = patch[k]; });
      emit("journey");
    },

    // notifications. kind is the toast's glyph: "done" for a confirmation
    // (the default, since a notification normally reports something that
    // happened), "info" for a state change nobody asked for, "blocked" for a
    // stop. It never changes what lands in the drawer, only how it announces.
    notify: function (title, body, target, kind) {
      S.notifs.unshift({ id: nextIds.notif++, title: title, body: body, ts: nowIso(), read: false, target: target || "dashboard" });
      emit("notifs");
      if (window.UI) UI.toast(title, kind || "done");
    },
    markRead: function (id) {
      var n = S.notifs.filter(function (x) { return x.id === id; })[0];
      if (n) { n.read = true; emit("notifs"); }
    },
    markAllRead: function () {
      S.notifs.forEach(function (n) { n.read = true; });
      emit("notifs");
    },

    // ————— introducing broker: mutations —————

    ibSetJourney: function (patch) {
      Object.keys(patch).forEach(function (k) { S.ib.journey[k] = patch[k]; });
      emit("ib");
    },
    // reviewer pushes for the IB journey — the decision happens in Optimus
    // (a compliance queue of individuals), this only reflects it.
    // state ∈ in_review | needs_info | approved | rejected | in_progress
    ibReviewerAction: function (st) {
      var J = S.ib.journey;
      J.review = st;
      if (st === "in_review") { J.submittedIso = nowIso(); J.comments = []; }
      if (st === "needs_info") {
        J.comments = IB_REV_COMMENTS.map(function (c) {
          return { stepIdx: c.stepIdx, stepName: c.stepName, target: c.target, text: c.text };
        });
        Data.notify("The reviewer requested more information", "The affected steps have reopened.", "ib-onboard");
      }
      if (st === "approved") {
        J.comments = [];
        Data.notify("You're approved as an introducing broker", "Your referral link is live and ready to share.", "ib-onboard");
      }
      if (st === "rejected") J.rejectedReason = "Identity could not be verified";
      emit("ib");
    },
    // the IB picks where payouts land: their verified bank account or their
    // Fireblocks referral container. Both are desk-verified before use.
    ibSetPayoutMethod: function (m) {
      if (m !== "bank" && m !== "usdt") return;
      S.ib.payoutMethod = m;
      Data.notify("Payout method updated",
        m === "bank"
          ? "Payouts go to your " + S.ib.payoutBank.bank + " account in AED."
          : "Payouts go to your " + S.ib.payoutWallet.label + " container in USDT.", "ib-payouts");
      emit("ib");
    },
    // webhook mirror: a linked client's trade settles in Optimus and lands
    // here. The IB side never books, funds or asserts anything.
    ibSimClientTrade: function () {
      var amt = 400000 + Math.round(Math.random() * 8) * 50000;
      var rate = REF["USDT/AED"] * (1 + SPREAD) + (Math.random() - 0.5) * 0.001;
      var t = { clientId: "C-2", id: "T-" + (nextIds.trade++), pair: "USDT/AED", side: "buy",
        assetAmt: amt, fiatAmt: amt * rate, rate: rate, ts: nowIso(), state: "settled" };
      S.ib.trades.unshift(t);
      Data.notify("Client trade settled · Al Noor Capital LLC",
        (t.side === "buy" ? "Buy " : "Sell ") + Number(amt).toLocaleString("en-US") + " USDT at " + rate.toFixed(4) + ". Your accrual updated.", "ib-overview");
      emit("ib");
      return t;
    },
    // desk runs the scheduled period payout in Optimus; the money goes to
    // the IB's verified account and the record flips to paid here.
    ibRunPayout: function () {
      var p = S.ib.payouts.filter(function (x) { return x.state === "scheduled"; })[0];
      if (!p) return null;
      p.state = "paid"; p.paidTs = nowIso();
      Data.notify("Payout sent · AED " + Number(p.amountAED).toLocaleString("en-US"),
        "For " + p.period + ", " + (S.ib.payoutMethod === "usdt"
          ? "in USDT to your " + S.ib.payoutWallet.label + " container."
          : "to your " + S.ib.payoutBank.bank + " account ····" + S.ib.payoutBank.iban.replace(/\s/g, "").slice(-3) + "."), "ib-payouts");
      emit("ib");
      return p;
    },

    // ————— demo preferences (the demo bar calls these) —————

    setRole: function (r) { S.role = r; emit("prefs"); },
    setPersona: function (p) { S.persona = p; emit("prefs"); },
    // client preference, not demo furniture: drag-to-reorder pairs. Emits its
    // own scope so the two screens showing pairs can repaint in place instead
    // of replaying a page entrance on every drop.
    setPairOrder: function (order) {
      var valid = order.filter(function (id) { return REF[id] !== undefined; });
      if (valid.length) { S.pairOrder = valid; emit("pins"); }
    },
    // total-balance denomination toggle — a display pref, same bucket as pins
    setTotalCur: function (cur) {
      if (cur !== "AED" && cur !== "USDT") return;
      S.totalCur = cur;
      emit("pins");
    },
    setRails: function (allLive) {
      for (var i = 1; i < S.rails.length; i++) S.rails[i].state = allLive ? "live" : "coming";
      emit("prefs");
    },
    setWindowCopy: function (v) { S.windowCopy = v; emit("prefs"); },
    setStale: function (v) { S.stale = v; emit("prefs"); },
    setFirstRun: function (v) { S.firstRun = v; emit("prefs"); },

    // ————— simulated desk / webhook actions —————
    // These stand in for the bank, the chain, and the Optimus desk.
    // The client side never asserts an outcome; these push it.

    simulateDeposit: function (amount) { // webhook: AED credit detected on the vIBAN
      var a = amount || 3200000;
      var d = { id: "D-" + (nextIds.dep++), cur: "AED", amount: a, state: "detected", via: "bank", ts: nowIso(), crTs: null, sender: "Emirates NBD · your whitelisted account" };
      S.deposits.unshift(d);
      Data.notify("Deposit detected · AED " + Number(a.toFixed(2)).toLocaleString("en-US"), "It joins your available balance once completed.", "dashboard");
      emit("deposits");
      setTimeout(function () {
        if (d.state === "detected") { d.state = "processing"; emit("deposits"); }
      }, 2600);
      return d;
    },
    creditOldest: function () { // webhook: oldest processing deposit credited
      var d = S.deposits.filter(function (x) { return x.state === "detected" || x.state === "processing"; }).pop();
      if (!d) return null;
      d.state = "credited"; d.crTs = nowIso();
      S.bal[d.cur] += d.amount;
      Data.notify("Deposit completed · " + d.cur + " " + Number(d.amount.toFixed(2)).toLocaleString("en-US"), "Available balance updated.", "dashboard");
      emit("deposits");
      return d;
    },
    // (Unknown-sender credits are a desk-side Optimus queue — match or
    //  return — never a client-facing state. Decision 2026-09-03.)
    failWithdrawal: function () { // webhook: the bank bounced the oldest in-flight payout
      var w = S.withdrawals.filter(function (x) { return x.state !== "confirmed" && x.state !== "failed"; }).pop();
      if (!w) return null;
      w.state = "failed";
      S.bal[w.cur] += w.amount;   // the failed amount returns to available
      Data.notify("Withdrawal failed · " + w.id, w.cur + " " + Number(w.amount.toFixed(2)).toLocaleString("en-US") + " is back in your available balance.", "dashboard", "blocked");
      emit("withdrawals");
      return w;
    },
    lapseOrder: function () { // clock: the funding window ran out on the oldest awaiting order
      var t = S.trades.filter(function (x) { return x.state === "awaiting"; }).pop();
      if (!t) return null;
      t.state = "failed";
      Data.notify("Order failed · " + t.id, "The funding window ran out. Nothing was taken.", "dashboard", "blocked");
      emit("trades");
      return t;
    },
    advanceWithdrawal: function () { // desk: advances the oldest in-flight withdrawal one state
      var w = S.withdrawals.filter(function (x) { return x.state !== "confirmed" && x.state !== "failed"; }).pop();
      if (!w) return null;
      var order = ["submitted", "servicing", "sent", "confirmed"];
      var nxt = order[order.indexOf(w.state) + 1];
      w.state = nxt; w.stamps[nxt] = nowIso();
      if (nxt === "confirmed") Data.notify("Withdrawal completed · " + w.id, w.cur + " " + Number(w.amount.toFixed(2)).toLocaleString("en-US") + " arrived at " + w.dest + ".", "dashboard");
      emit("withdrawals");
      return w;
    },
    fundOrder: function () { // webhook: funding arrives for the oldest awaiting order
      var t = S.trades.filter(function (x) { return x.state === "awaiting"; }).pop();
      if (!t) return null;
      S.bal[t.payCur] = Math.max(0, S.bal[t.payCur] + t.needed - t.payAmt);
      t.needed = 0; t.state = "settling"; t.stamps.funded = nowIso();
      Data.notify("Order funded and booked · " + t.id, "Booked at your locked rate " + t.rate.toFixed(4) + ". Funds release within 30 minutes.", "dashboard");
      emit("trades");
      return t;
    },
    settleOrder: function () { // desk/clock: settlement window elapses on the oldest settling order
      var t = S.trades.filter(function (x) { return x.state === "settling"; }).pop();
      if (!t) return null;
      t.state = "settled"; t.stamps.settled = nowIso();
      if (t.side === "buy") S.bal.USDT += t.assetAmt; else S.bal[Data.fiatOf(t.pair)] += t.fiatAmt;
      Data.notify("Trade completed · " + t.id, "Proceeds are in your available balance.", "dashboard");
      emit("trades");
      return t;
    },
    verifyOldestPending: function () { // desk: verifies the oldest pending whitelist entry
      var w = S.wallets.filter(function (x) { return x.state === "pending" || x.state === "submitted"; }).pop();
      var b = S.banks.filter(function (x) { return x.state === "pending" || x.state === "submitted"; }).pop();
      var target = w && b ? (new Date(w.added) < new Date(b.added) ? w : b) : (w || b);
      if (!target) return null;
      target.state = "verified";
      Data.notify((target.net ? "Wallet" : "Bank account") + " approved · " + (target.label || target.bank),
        target.net ? "Next: request a test transfer and confirm the amount." : "Ready as a withdrawal destination.", "whitelist");
      emit("whitelist");
      return target;
    },
    rejectOldestPending: function () { // desk: rejects the oldest pending whitelist entry, with reason
      var w = S.wallets.filter(function (x) { return x.state === "pending" || x.state === "submitted"; }).pop();
      var b = S.banks.filter(function (x) { return x.state === "pending" || x.state === "submitted"; }).pop();
      var target = w || b;
      if (!target) return null;
      target.state = "rejected";
      target.reason = target.net
        ? "Beneficiary name doesn't match the VASP's records. Check the travel-rule details."
        : "Account name doesn't match your entity. Send a bank letter or IBAN certificate in the entity's legal name.";
      Data.notify((target.net ? "Wallet" : "Bank account") + " rejected", target.reason, "accounts");
      emit("whitelist");
      return target;
    },
    deskAddsBank: function () { // desk whitelists a bank directly — appears here verified
      S.banks.unshift({ id: "B-" + (nextIds.bank++), bank: "ADCB", iban: "AE33 0030 0012 3456 7890 123",
        title: "Delos Financial Limited", cur: "AED", state: "verified", added: nowIso(), reason: null, byDesk: true });
      Data.notify("New verified destination · ADCB ····123", "Added by the desk, ready to use as a withdrawal destination.", "whitelist");
      emit("whitelist");
    },
    expireInvite: function () { // time passes: the oldest pending invite expires
      var m = S.team.filter(function (x) { return x.state === "invited"; })[0];
      if (!m) return null;
      m.state = "expired";
      emit("team");
      return m;
    },
    // reviewer pushes for the onboarding hub — state ∈ in_review | needs_info |
    // approved_issuing | approved | rejected | parked | in_progress
    reviewerAction: function (st) {
      if (st === "approved_issuing") {
        S.journey.review = "approved"; S.journey.railsIssuing = true;
        Data.notify("Application approved", "Your deposit details are being issued now.", "hub");
      } else {
        if (st === "approved") S.journey.railsIssuing = false;
        S.journey.review = st;
        if (st === "in_review") S.journey.submittedIso = nowIso();
        if (st === "needs_info") {
          // the set matching the journey's entity type, copied so a screen
          // reading state can never mutate the seed
          var set = REV_COMMENTS[S.journey.entity] || REV_COMMENTS.institution;
          S.journey.comments = set.map(function (c) {
            return { stepIdx: c.stepIdx, stepName: c.stepName, target: c.target, text: c.text };
          });
          Data.notify("The reviewer requested more information", "The affected steps have reopened.", "hub");
        }
        if (st === "approved") Data.notify("Application approved", "Your account is open and ready to fund.", "hub");
        if (st === "rejected") S.journey.rejectedReason = "Source of funds could not be verified";
      }
      emit("journey");
    }
  };

  // ————— 30 days of end-of-day total, AED at reference —————
  // Illustrative, and seeded so the shape is identical on every load.
  //
  // Stored as OFFSETS from the closing total rather than absolutes, so the last
  // point is always exactly Data.totalAedApprox() even after a demo credit or a
  // withdrawal has moved the balance. A chart that disagreed with the hero above
  // it would be a prototype that lies.
  //
  // The line reads as this account's actual story, not noise:
  //   · steady accumulation across the first three weeks (trades and deposits)
  //   · a step down 5 days ago as W-1079 confirmed, 500,000 USDT out
  //     (1,836,400 at the reference rate)
  //   · a step up yesterday: the AED 5,000,000 D-2213 credit net of the
  //     AED 2,000,000 W-1082 withdrawal that confirmed the same day
  //   · today is the live total. D-2214 is still processing, so it is correctly
  //     not in it, exactly as it is correctly not in available balance.
  var BAL_SHAPE = Object.freeze([
    -3020000, -2960000, -3080000, -2910000, -2840000, -2950000, -2720000, -2800000,
    -2610000, -2550000, -2660000, -2440000, -2510000, -2300000, -2380000, -2170000,
    -2090000, -2200000, -1980000, -1860000, -1940000, -1720000, -1650000, -1420000,
    -3256400, -3200000, -3280000, -3120000, -120000, 0
  ]);

  function dayTs(i) {
    var d = new Date();
    if (i >= BAL_SHAPE.length - 1) return d.toISOString();   // today: as of now
    d.setDate(d.getDate() - (BAL_SHAPE.length - 1 - i));
    d.setHours(23, 59, 0, 0);                                // end of that day
    return d.toISOString();
  }

  // THE SHAPE IS FIXED: [{ ts, v }] oldest first. `ts` is an ISO string, the
  // same field name every other record here uses, so UI.dayLabel(p.ts) and
  // UI.fmtDate(p.ts) work with no adapter. `v` is a number in AED. 30 points,
  // the last one exactly Data.totalAedApprox(). No other keys, ever: a caller
  // sniffing for alternatives is a caller working around a contract that does
  // not need working around.
  // Fresh objects on every call, so a screen can never mutate the seed.
  Data.balSeries = function () {
    var total = S.firstRun ? 0 : Data.totalAedApprox();
    if (!total || total <= 0) {
      // first run, or a zeroed account: a flat zero line, because an account
      // with no history has no history. Callers should show the welcome state
      // instead of drawing this.
      return BAL_SHAPE.map(function (off, i) { return { ts: dayTs(i), v: 0 }; });
    }
    // a small account keeps the shape but not the amplitude, so the line can
    // never dip below zero
    var k = total < 12000000 ? total / 12000000 : 1;
    return BAL_SHAPE.map(function (off, i) {
      return { ts: dayTs(i), v: Math.max(0, total + off * k) };
    });
  };

  window.Data = Data;
})();
