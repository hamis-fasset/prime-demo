/* ————————————————————————————————————————————————
   Fasset Prime — app core: screen registry, router,
   shell, demo bar, theme, first-load reveal.
   Plain script (file:// safe) — exposes window.App.
   Loads BEFORE js/screens/*.js; boot runs on DOMContentLoaded,
   by which time every screen has registered.
   Contract: ../ARCHITECTURE.md
   ———————————————————————————————————————————————— */
(function () {
  "use strict";

  var App = {};
  var screens = {};          // id → definition
  var current = null;        // current screen id
  var curZone = null;        // "app" | "onboard" | "auth" | "bare"
  var curPersona = null;     // persona the app shell was last rendered for
  var booted = false;

  // ————— screen registry —————
  // App.registerScreen(id, def)
  //   def: {
  //     title: string | fn → string        (page-head h1; zone "app" only)
  //     subtitle: string | fn → string     (one gray line under the title)
  //     actions: fn → html                 (optional; primary action, top-right)
  //     zone: "app" | "onboard" | "auth" | "bare"   (default "app")
  //     render: fn(rootEl)                 (rootEl is .screen; render everything into it)
  //     onData: fn(scope) → bool           (optional; return true to suppress the
  //                                         default full re-render on data changes)
  //   }
  App.registerScreen = function (id, def) {
    def.zone = def.zone || "app";
    screens[id] = def;
  };
  App.screen = function (id) { return screens[id]; };

  // ————— navigation model (zone "app") —————
  // Sentence-case 11px group labels; role-gated items simply don't render.
  var NAV = [
    { label: "Overview", items: [
      { id: "dashboard", label: "Dashboard", icon: "overview", roles: ["admin", "trader", "viewer"] },
      { id: "history", label: "History", icon: "clock", roles: ["admin", "trader", "viewer"] }
    ]},
    { label: "Money", items: [
      { id: "trade", label: "Trade", icon: "trade", roles: ["admin", "trader"] },
      { id: "move", label: "Move money", icon: "move", roles: ["admin", "trader", "viewer"] }
    ]},
    { label: "Manage", items: [
      { id: "whitelist", label: "Whitelist", icon: "shieldCheck", roles: ["admin", "trader"] },
      { id: "team", label: "Team", icon: "users", roles: ["admin"] },
      { id: "settings", label: "Settings", icon: "settings", roles: ["admin", "trader", "viewer"] }
    ]}
  ];

  // The IB persona is one individual — no team, no roles. Items carry no
  // roles field and every linked screen is theirs.
  var IB_NAV = [
    { label: "Overview", items: [
      { id: "ib-overview", label: "Overview", icon: "overview" }
    ]},
    { label: "Your book", items: [
      { id: "ib-clients", label: "Clients", icon: "users" },
      { id: "ib-payouts", label: "Payouts", icon: "receipt" }
    ]}
  ];

  function navSet() { return Data.state.persona === "ib" ? IB_NAV : NAV; }
  function homeId() { return Data.state.persona === "ib" ? "ib-overview" : "dashboard"; }

  function allowed(id) {
    var role = Data.state.role;
    var ok = false;
    navSet().forEach(function (g) {
      g.items.forEach(function (it) {
        if (it.id === id) ok = !it.roles || it.roles.indexOf(role) >= 0;
      });
    });
    return ok;
  }

  // ————— theme —————
  App.setTheme = function (v) {
    Data.state.theme = v;
    if (v === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", v);
    var sel = document.getElementById("dbTheme");
    if (sel) sel.value = v;
  };

  // ————— shell rendering —————

  var root = null; // #app

  function val(v) { return typeof v === "function" ? v() : (v || ""); }

  function lockup() {
    // brand lockup as <img> would lose currentColor; inline-fetch is not
    // possible on file://, so we mirror assets/brand/fasset-lockup.svg inline.
    return '<svg class="wm-lock" viewBox="0 0 160 28" fill="currentColor" aria-label="Fasset">' +
      '<use href="#brand-lockup"/></svg>';
  }

  function navHtml() {
    var role = Data.state.role;
    return navSet().map(function (g) {
      var items = g.items.filter(function (it) { return !it.roles || it.roles.indexOf(role) >= 0; });
      if (!items.length) return "";
      return '<div class="nav-group"><div class="nav-group-label">' + UI.esc(g.label) + "</div>" +
        items.map(function (it) {
          return '<button class="nav-item' + (current === it.id ? " active" : "") + '" data-nav="' + it.id + '" type="button">' +
            icon(it.icon, 16) + "<span>" + UI.esc(it.label) + "</span></button>";
        }).join("") + "</div>";
    }).join("");
  }

  // the phone tab bar: the same persona-aware items as the sidebar, flat.
  // CSS shows it only ≤600px (see app.css phone layer).
  function mobileNavHtml() {
    var role = Data.state.role;
    var items = [];
    navSet().forEach(function (g) {
      g.items.forEach(function (it) {
        if (!it.roles || it.roles.indexOf(role) >= 0) items.push(it);
      });
    });
    return items.map(function (it) {
      return '<button class="mnav-item' + (current === it.id ? " active" : "") + '" data-nav="' + it.id + '" type="button">' +
        icon(it.icon, 18) + "<span>" + UI.esc(it.label) + "</span></button>";
    }).join("");
  }

  function renderAppShell() {
    // the shell serves two personas: the client workspace and the IB's own
    // portal. Same chrome, different nav and identity.
    var isIb = Data.state.persona === "ib";
    var wsUser = isIb ? Data.state.ib.user : Data.state.user;
    root.innerHTML =
      '<div class="shell' + (booted ? "" : " boot") + '">' +
        '<aside class="sidebar">' +
          '<div class="sidebar-head">' + lockup() + '<span class="wm-prime">Prime</span></div>' +
          '<nav class="nav" id="appNav">' + navHtml() + "</nav>" +
          '<div class="sidebar-spacer"></div>' +
          '<div class="workspace-row"><button class="workspace" type="button" data-nav="' + (isIb ? "ib-payouts" : "settings") + '">' +
            // identity art from the real user, not hardcoded initials: the old
            // "RA" span ignored Data.state.user entirely, so switching the
            // seeded user left the sidebar showing someone else's monogram.
            UI.identityArt(wsUser.email || wsUser.name, 26) +
            '<span class="ws-meta"><span class="ws-name">' + UI.esc(wsUser.name) + "</span>" +
            '<span class="ws-plan">' + UI.esc(wsUser.entity) + "</span></span>" +
          "</button></div>" +
        "</aside>" +
        '<div class="main">' +
          '<div class="role-note hide" id="roleNote"></div>' +
          '<header class="topbar">' +
            '<button class="search-affordance" id="searchBtn" type="button">' + icon("search", 14) + "<span>Search</span><kbd>⌘K</kbd></button>" +
            '<div class="topbar-actions">' +
              '<button class="icon-btn notif-btn" id="bellBtn" type="button" aria-label="Notifications">' + icon("bell", 16) + "</button>" +
              '<button class="icon-btn" id="themeBtn" type="button" aria-label="Theme">' + icon("moon", 16) + "</button>" +
            "</div>" +
          "</header>" +
          '<div class="content"><div class="content-inner" id="screenHost"></div></div>' +
        "</div>" +
      "</div>" +
      '<nav class="mobile-nav" id="mobileNav">' + mobileNavHtml() + "</nav>";

    root.querySelectorAll("[data-nav]").forEach(function (b) {
      b.addEventListener("click", function () { App.go(b.getAttribute("data-nav")); });
    });
    document.getElementById("bellBtn").addEventListener("click", openNotifications);
    document.getElementById("themeBtn").addEventListener("click", function () {
      var cur = document.documentElement.getAttribute("data-theme");
      var dark = cur ? cur === "dark"
        : window.matchMedia("(prefers-color-scheme: dark)").matches;
      App.setTheme(dark ? "light" : "dark");
    });
    document.getElementById("searchBtn").addEventListener("click", openCommand);
    refreshBell();
    refreshRoleNote();
  }

  function renderBareShell(kind) {
    // kind "auth"/"onboard": minimal header on the wallpaper.
    // kind "bare": no header at all (the screen owns everything).
    root.innerHTML =
      '<div class="zone-bare">' +
        (kind === "bare" ? "" :
          '<header class="bare-header">' + lockup() + '<span class="wm-prime">Prime</span>' +
          '<span class="bh-right" id="bareRight"></span></header>') +
        '<div class="bare-body" id="screenHost"></div>' +
      "</div>";
  }

  function refreshBell() {
    var bell = document.getElementById("bellBtn");
    if (bell) bell.classList.toggle("has-unread", Data.unreadCount() > 0);
  }

  function refreshRoleNote() {
    var el = document.getElementById("roleNote");
    if (!el) return;
    var r = Data.state.role;
    // roles are a client-workspace concept; the IB portal has one person
    var hide = r === "admin" || Data.state.persona === "ib";
    el.classList.toggle("hide", hide);
    if (!hide) el.textContent = "Previewing as " + r + ". Controls this role can't use aren't shown. Switch back to admin in the demo bar.";
  }

  function refreshNav() {
    var nav = document.getElementById("appNav");
    if (nav) {
      nav.innerHTML = navHtml();
      nav.querySelectorAll("[data-nav]").forEach(function (b) {
        b.addEventListener("click", function () { App.go(b.getAttribute("data-nav")); });
      });
    }
    var mnav = document.getElementById("mobileNav");
    if (mnav) {
      mnav.innerHTML = mobileNavHtml();
      mnav.querySelectorAll("[data-nav]").forEach(function (b) {
        b.addEventListener("click", function () { App.go(b.getAttribute("data-nav")); });
      });
    }
  }

  // ————— router —————

  App.go = function (id) {
    var def = screens[id];
    if (!def) return;
    if (def.zone === "app" && !allowed(id)) { id = homeId(); def = screens[id]; }
    var zoneChanged = def.zone !== curZone;
    // a persona switch swaps the whole sidebar identity, not just the items,
    // so it rebuilds the shell the same way a zone change does
    var personaChanged = curPersona !== Data.state.persona;
    current = id;
    curZone = def.zone;
    curPersona = Data.state.persona;
    if (zoneChanged || (def.zone === "app" && personaChanged)) {
      if (def.zone === "app") renderAppShell();
      else renderBareShell(def.zone);
    } else if (def.zone === "app") {
      refreshNav();
    }
    renderScreen();
    var content = root.querySelector(".content");
    if (content) content.scrollTop = 0;
  };
  App.current = function () { return current; };

  function renderScreen() {
    var def = screens[current];
    var host = document.getElementById("screenHost");
    if (!host) return;
    host.innerHTML = "";
    var el = document.createElement("section");
    el.className = "screen";
    if (def.zone === "app") {
      var head = document.createElement("div");
      head.className = "page-head";
      head.innerHTML = "<div><h1>" + UI.esc(val(def.title)) + "</h1>" +
        (val(def.subtitle) ? '<p class="page-sub">' + UI.esc(val(def.subtitle)) + "</p>" : "") + "</div>" +
        (def.actions ? '<div class="page-actions">' + def.actions() + "</div>" : "");
      el.appendChild(head);
    }
    host.appendChild(el);
    def.render(el);
  }
  App.rerender = renderScreen;

  // ————— data → view: default is a full re-render of the live screen —————

  Data.on(function (scope) {
    refreshBell();
    if (scope === "prefs") { refreshNav(); refreshRoleNote(); }
    var def = screens[current];
    if (!def) return;
    if (def.onData && def.onData(scope)) return; // screen handled it itself
    // don't yank the DOM out from under an open drawer's originating screen
    renderScreen();
  });

  // ————— notifications drawer —————

  function openNotifications() {
    var h = UI.drawer("Notifications", "", {
      width: 420,
      foot: '<button class="btn btn-secondary" id="ntAll" type="button">Mark all read</button>'
    });
    function list() {
      var ns = Data.state.notifs;
      h.body.innerHTML = ns.length ? ns.map(function (n) {
        return '<button class="option-row" data-nt="' + n.id + '" type="button">' +
          '<span class="status status-' + (n.read ? "neutral" : "positive") + '" style="flex:none;margin-top:2px"><span class="dot"></span></span>' +
          '<span style="min-width:0;flex:1"><span class="opt-name" style="display:block;' + (n.read ? "" : "font-weight:var(--w-medium);color:var(--text-strong)") + '">' + UI.esc(n.title) + "</span>" +
          '<span class="opt-detail" style="display:block;margin-top:2px">' + UI.esc(n.body) + "</span>" +
          '<span class="opt-detail" style="display:block;margin-top:3px;color:var(--text-faint)">' + UI.esc(UI.fmtTs(n.ts)) + "</span></span></button>";
      }).join("") : '<div class="empty">Nothing yet.</div>';
      h.body.querySelectorAll("[data-nt]").forEach(function (b) {
        b.addEventListener("click", function () {
          var n = Data.state.notifs.filter(function (x) { return x.id === +b.getAttribute("data-nt"); })[0];
          Data.markRead(n.id);
          h.close();
          if (n.target === "hub") App.go("hub");
          else if (screens[n.target]) App.go(n.target);
          else App.go("history");
        });
      });
    }
    list();
    h.el.querySelector("#ntAll").addEventListener("click", function () { Data.markAllRead(); list(); });
  }
  App.openNotifications = openNotifications;

  // ————— command menu (⌘K) — reaches every destination —————

  var cmdOpen = false;
  function openCommand() {
    if (cmdOpen) return;
    cmdOpen = true;
    var dests = [];
    navSet().forEach(function (g) { g.items.forEach(function (it) {
      if (!it.roles || it.roles.indexOf(Data.state.role) >= 0) dests.push(it);
    }); });
    var h = UI.drawer("Go to", '<div class="field"><input class="input" id="cmdInput" placeholder="Type a destination" autocomplete="off"></div><div id="cmdList"></div>', {
      width: 420,
      onClose: function () { cmdOpen = false; }
    });
    var input = h.el.querySelector("#cmdInput");
    var listEl = h.el.querySelector("#cmdList");
    function list() {
      var q = (input.value || "").toLowerCase();
      var hits = dests.filter(function (d) { return d.label.toLowerCase().indexOf(q) >= 0; });
      listEl.innerHTML = hits.length ? hits.map(function (d) {
        return '<button class="option-row" data-go="' + d.id + '" type="button">' + icon(d.icon, 14) +
          '<span class="opt-name">' + UI.esc(d.label) + "</span>" + icon("chevronRight", 12, "chev") + "</button>";
      }).join("") : '<div class="empty" style="padding:32px 0">No matches.</div>';
      listEl.querySelectorAll("[data-go]").forEach(function (b) {
        b.addEventListener("click", function () { h.close(); App.go(b.getAttribute("data-go")); });
      });
    }
    input.addEventListener("input", list);
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        var first = listEl.querySelector("[data-go]");
        if (first) { h.close(); App.go(first.getAttribute("data-go")); }
      }
    });
    list();
    input.focus();
  }
  document.addEventListener("keydown", function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      if (curZone === "app") openCommand();
    }
  });

  // ————— demo bar (prototype furniture, not the product) —————

  function renderDemoBar() {
    var bar = document.createElement("div");
    bar.className = "demobar";
    bar.innerHTML =
      '<span class="db-label">Demo</span>' +
      '<div class="db-group">' +
        '<button class="db-btn" data-jump="onboarding" type="button">Landing</button>' +
        '<button class="db-btn" data-jump="hub" type="button">Status hub</button>' +
        '<button class="db-btn" data-jump="dashboard" type="button">App</button>' +
        '<button class="db-btn" data-jump="ib-onboard" type="button">IB onboarding</button>' +
        '<button class="db-btn" data-jump="ib-overview" type="button">IB portal</button>' +
        '<button class="db-btn" data-jump="map" type="button">Connection map</button>' +
      "</div>" +
      '<span class="db-sep"></span>' +
      '<div class="db-group"><span class="db-label">Role</span>' +
        '<select id="dbRole"><option value="admin">Admin</option><option value="trader">Trader</option><option value="viewer">Viewer</option></select></div>' +
      '<div class="db-group"><span class="db-label">Rails</span>' +
        '<select id="dbRails"><option value="live" selected>End state (all live)</option><option value="today">Today (AED only)</option></select></div>' +
      '<div class="db-group"><span class="db-label">Withdrawal copy</span>' +
        '<select id="dbWindow"><option value="30min">within 30 minutes</option><option value="hours">same business hours</option></select></div>' +
      '<div class="db-group"><span class="db-label">Theme</span>' +
        '<select id="dbTheme"><option value="auto">Auto</option><option value="light">Light</option><option value="dark">Dark</option></select></div>' +
      '<span class="db-sep"></span>' +
      '<div class="db-group"><span class="db-label">Dashboard</span>' +
        '<button class="db-btn" id="dbStale" type="button">Stale feed</button>' +
        '<button class="db-btn" id="dbFirstRun" type="button">First run</button>' +
      "</div>";
    document.body.appendChild(bar);

    bar.querySelectorAll("[data-jump]").forEach(function (b) {
      b.addEventListener("click", function () {
        var j = b.getAttribute("data-jump");
        if (j === "hub" && Data.state.journey.review === "not_started") {
          Data.setJourney({ review: "in_review", submittedIso: new Date(Date.now() - 26 * 3600000).toISOString() });
        }
        // ib-* destinations are the IB persona's world; everything else is
        // the client's. The jump switches persona so the shell follows.
        var want = j.indexOf("ib-") === 0 ? "ib" : "client";
        if (Data.state.persona !== want) Data.setPersona(want);
        // jumping into the portal of an IB who hasn't onboarded yet would
        // show a fully-approved book; seed the approved state on entry
        if (j === "ib-overview" && Data.state.ib.journey.review !== "approved") {
          Data.ibSetJourney({ review: "approved", submittedIso: new Date(Date.now() - 26 * 3600000).toISOString(), stepsDone: 4 });
        }
        App.go(j);
      });
    });
    bar.querySelector("#dbRole").addEventListener("change", function (e) {
      Data.setRole(e.target.value);
      if (curZone === "app" && !allowed(current)) App.go("dashboard");
    });
    bar.querySelector("#dbRails").addEventListener("change", function (e) {
      var live = e.target.value === "live";
      Data.setRails(live);
      UI.toast(live ? "Rails: end state. USD and GBP vIBANs are live." : "Rails: today. AED only; USD and GBP show the not-yet-live treatment.");
    });
    bar.querySelector("#dbWindow").addEventListener("change", function (e) {
      Data.setWindowCopy(e.target.value);
      UI.toast("Withdrawal window copy switched. A review with the desk's number is a toggle, not a rebuild.");
    });
    bar.querySelector("#dbTheme").addEventListener("change", function (e) { App.setTheme(e.target.value); });
    bar.querySelector("#dbStale").addEventListener("click", function () {
      Data.setStale(!Data.state.stale);
      bar.querySelector("#dbStale").classList.toggle("on", Data.state.stale);
    });
    bar.querySelector("#dbFirstRun").addEventListener("click", function () {
      Data.setFirstRun(!Data.state.firstRun);
      bar.querySelector("#dbFirstRun").classList.toggle("on", Data.state.firstRun);
    });
  }

  // ————— boot —————
  // (the brand lockup <defs> live inline in index.html as #brand-lockup,
  //  mirroring assets/brand/fasset-lockup.svg — file:// safe, currentColor-themed)

  document.addEventListener("DOMContentLoaded", function () {
    root = document.getElementById("app");
    renderDemoBar();

    // one first-load reveal: veil fade + sidebar content-in.
    // The veil runs 260ms at a 60ms delay (app.css) and is removed at 400ms, so
    // the dashboard's one skeleton pass (0 → 380ms) is actually visible. The
    // sidebar stagger is the real curtain-raise and it reads better uncovered.
    var veil = document.createElement("div");
    veil.className = "veil";
    document.body.appendChild(veil);
    setTimeout(function () { veil.remove(); }, 400);

    App.go("dashboard"); // seeded as an established, approved account
    setTimeout(function () {
      booted = true;
      var shell = root.querySelector(".shell");
      if (shell) shell.classList.remove("boot");
    }, 900);
  });

  window.App = App;
})();
