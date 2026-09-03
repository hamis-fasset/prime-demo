/* ————————————————————————————————————————————————
   Fasset Prime — inline icon set.
   Drawn to the design-system spec: 16px grid, 1.5px stroke,
   round caps, geometric. Never Lucide/Heroicons.
   Plain script (file:// safe) — exposes window.icon(name, size, cls).
   Extend by adding paths here, in the same style, nowhere else.
   ———————————————————————————————————————————————— */
(function () {
  "use strict";

  var paths = {
    overview: '<rect x="1.75" y="1.75" width="5.1" height="5.1" rx="1.2"/><rect x="9.15" y="1.75" width="5.1" height="5.1" rx="1.2"/><rect x="1.75" y="9.15" width="5.1" height="5.1" rx="1.2"/><rect x="9.15" y="9.15" width="5.1" height="5.1" rx="1.2"/>',
    trade: '<path d="M10.5 1.75 13.25 4.5 10.5 7.25"/><path d="M13.25 4.5H4.75"/><path d="M5.5 14.25 2.75 11.5 5.5 8.75"/><path d="M2.75 11.5h8.5"/>',
    move: '<rect x="1.75" y="3.5" width="12.5" height="9" rx="1.5"/><path d="M1.75 6.5h12.5"/><circle cx="11" cy="9.75" r="1.15"/>',
    shield: '<path d="M8 1.75 2.75 3.9v4.2c0 3.2 2.24 5.35 5.25 6.15 3.01-.8 5.25-2.95 5.25-6.15V3.9L8 1.75Z"/>',
    shieldCheck: '<path d="M8 1.75 2.75 3.9v4.2c0 3.2 2.24 5.35 5.25 6.15 3.01-.8 5.25-2.95 5.25-6.15V3.9L8 1.75Z"/><path d="m5.75 7.9 1.6 1.6 3-3.4"/>',
    clock: '<circle cx="8" cy="8" r="6.25"/><path d="M8 4.75V8l2.25 1.75"/>',
    users: '<circle cx="6" cy="5.25" r="2.5"/><path d="M1.75 13.25a4.25 4.25 0 0 1 8.5 0"/><path d="M10.75 3.1a2.5 2.5 0 0 1 0 4.8"/><path d="M11.5 9.35a4.25 4.25 0 0 1 2.75 3.9"/>',
    settings: '<circle cx="8" cy="8" r="2.25"/><path d="M8 1.5l1.1 1.9 2.2-.35.5 2.15 1.9 1.1-1 1.95 1 1.95-1.9 1.1-.5 2.15-2.2-.35L8 14.5l-1.1-1.9-2.2.35-.5-2.15-1.9-1.1 1-1.95-1-1.95 1.9-1.1.5-2.15 2.2.35L8 1.5Z" stroke-linejoin="round"/>',
    bell: '<path d="M8 1.75a4 4 0 0 0-4 4c0 4-1.5 5.25-1.5 5.25h11S12 9.75 12 5.75a4 4 0 0 0-4-4Z"/><path d="M6.5 13.5a1.6 1.6 0 0 0 3 0"/>',
    search: '<circle cx="7" cy="7" r="4.75"/><path d="m13.75 13.75-3.4-3.4"/>',
    plus: '<path d="M8 2.75v10.5"/><path d="M2.75 8h10.5"/>',
    close: '<path d="m3.5 3.5 9 9"/><path d="m12.5 3.5-9 9"/>',
    check: '<path d="m2.75 8.5 3.5 3.5 7-8"/>',
    chevronRight: '<path d="m5.75 2.75 5 5.25-5 5.25"/>',
    chevronDown: '<path d="m2.75 5.75 5.25 5 5.25-5"/>',
    chevronLeft: '<path d="m10.25 2.75-5 5.25 5 5.25"/>',
    arrowUpRight: '<path d="M4 12 12 4"/><path d="M5.75 4H12v6.25"/>',
    arrowDownLeft: '<path d="M12 4 4 12"/><path d="M10.25 12H4V5.75"/>',
    arrowRight: '<path d="M2.75 8h10.5"/><path d="m9 3.75 4.25 4.25L9 12.25"/>',
    download: '<path d="M8 2.25v8"/><path d="M4.75 7.25 8 10.5l3.25-3.25"/><path d="M2.25 13.25h11.5"/>',
    copy: '<rect x="5.75" y="5.75" width="8.5" height="8.5" rx="1.5"/><path d="M3.25 10.25c-.83 0-1.5-.67-1.5-1.5v-5.5c0-.83.67-1.5 1.5-1.5h5.5c.83 0 1.5.67 1.5 1.5"/>',
    send: '<path d="M14 2 7.4 8.6"/><path d="M14 2 9.8 14l-2.4-5.4L2 6.2 14 2Z"/>',
    sun: '<circle cx="8" cy="8" r="3.25"/><path d="M8 1.5v1.4"/><path d="M8 13.1v1.4"/><path d="M1.5 8h1.4"/><path d="M13.1 8h1.4"/><path d="m3.4 3.4 1 1"/><path d="m11.6 11.6 1 1"/><path d="m3.4 12.6 1-1"/><path d="m11.6 4.4 1-1"/>',
    moon: '<path d="M13.9 9.6A6 6 0 0 1 6.4 2.1a6 6 0 1 0 7.5 7.5Z"/>',
    dots: '<circle cx="3.25" cy="8" r="0.4"/><circle cx="8" cy="8" r="0.4"/><circle cx="12.75" cy="8" r="0.4"/>',
    building: '<path d="M2.75 14.25V3.25c0-.83.67-1.5 1.5-1.5h4.5c.83 0 1.5.67 1.5 1.5v11"/><path d="M10.25 6.25h2c.83 0 1.5.67 1.5 1.5v6.5"/><path d="M1.5 14.25h13"/><path d="M5 4.75h2.5"/><path d="M5 7.5h2.5"/><path d="M5 10.25h2.5"/>',
    globe: '<circle cx="8" cy="8" r="6.25"/><path d="M1.75 8h12.5"/><path d="M8 1.75c1.8 1.7 2.75 3.9 2.75 6.25S9.8 12.55 8 14.25C6.2 12.55 5.25 10.35 5.25 8S6.2 3.45 8 1.75Z"/>',
    lock: '<rect x="3.25" y="7.25" width="9.5" height="7" rx="1.5"/><path d="M5.25 7.25v-2.5a2.75 2.75 0 0 1 5.5 0v2.5"/>',
    refresh: '<path d="M13.65 6.35a5.75 5.75 0 0 0-11-.85"/><path d="M2.35 9.65a5.75 5.75 0 0 0 11 .85"/><path d="M13.9 2.5v3.25h-3.25"/><path d="M2.1 13.5v-3.25h3.25"/>',
    receipt: '<path d="M3.25 1.75h9.5v12.5l-1.9-1.25-1.9 1.25L8 12.99l-1.9 1.26-1.9-1.25-.95.62V1.75Z" stroke-linejoin="round"/><path d="M5.75 5.25h4.5"/><path d="M5.75 8h4.5"/>',
    document: '<path d="M9.5 1.75H4.25c-.83 0-1.5.67-1.5 1.5v9.5c0 .83.67 1.5 1.5 1.5h7.5c.83 0 1.5-.67 1.5-1.5V5.5L9.5 1.75Z"/><path d="M9.5 1.75V5.5h3.75"/><path d="M5.5 9h5"/><path d="M5.5 11.5h3"/>',
    activity: '<path d="M1.75 8h2.75l1.75-4.5 3 9 1.75-4.5h3.25"/>',
    map: '<path d="M5.75 2.5 2.25 4v9.5l3.5-1.5 4.5 1.5 3.5-1.5V2.5l-3.5 1.5-4.5-1.5Z" stroke-linejoin="round"/><path d="M5.75 2.5v9.5"/><path d="M10.25 4v9.5"/>',
    alert: '<path d="M8 2 1.9 12.9a.9.9 0 0 0 .78 1.35h10.64a.9.9 0 0 0 .78-1.35L8 2Z" stroke-linejoin="round"/><path d="M8 6.4v3"/><circle cx="8" cy="11.6" r="0.35"/>',
    upload: '<path d="M8 10.25v-8"/><path d="M4.75 5.25 8 2l3.25 3.25"/><path d="M2.25 13.25h11.5"/>',
    logout: '<path d="M6.25 1.75H3.75c-.83 0-1.5.67-1.5 1.5v9.5c0 .83.67 1.5 1.5 1.5h2.5"/><path d="M10.5 4.75 13.75 8l-3.25 3.25"/><path d="M13.75 8h-8"/>',
    swap: '<path d="M5.5 2.75v10.5"/><path d="M2.75 10.5 5.5 13.25l2.75-2.75"/><path d="M10.5 13.25V2.75"/><path d="M7.75 5.5 10.5 2.75l2.75 2.75"/>'
  };

  window.iconNames = Object.keys(paths);

  window.icon = function (name, size, cls) {
    size = size || 16;
    cls = cls || "";
    var p = paths[name];
    if (!p) return "";
    return '<svg class="icon ' + cls + '" width="' + size + '" height="' + size + '" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">' + p + "</svg>";
  };
})();
