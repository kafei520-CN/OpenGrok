"use strict";
(() => {
  // desktop/pet/identity.ts
  var PET_SHAPES = ["star", "mark", "orb", "anime", "adult", "pixel"];
  var PET_COLORS = ["ink", "paper", "moss", "ice", "ember"];
  var PET_FACES = ["idle", "happy", "curious"];
  var PET_COLOR_SWATCH = {
    ink: { label: "Ink", value: "#171717" },
    paper: { label: "Paper", value: "#f4f4f5" },
    moss: { label: "Moss", value: "#16a34a" },
    ice: { label: "Ice", value: "#2563eb" },
    ember: { label: "Ember", value: "#ea580c" }
  };
  function isPetShape(v) {
    return !!v && PET_SHAPES.includes(v);
  }
  function isPetColor(v) {
    return !!v && PET_COLORS.includes(v);
  }
  function isPetFace(v) {
    return !!v && PET_FACES.includes(v);
  }
  function resolvePetBodyInk(color) {
    return isPetColor(color) ? PET_COLOR_SWATCH[color].value : PET_COLOR_SWATCH.ink.value;
  }
  function resolvePetEyeInk(body2) {
    const hex = resolvePetBodyInk(body2);
    const raw = hex.replace("#", "");
    const r = parseInt(raw.slice(0, 2), 16) / 255;
    const g = parseInt(raw.slice(2, 4), 16) / 255;
    const b = parseInt(raw.slice(4, 6), 16) / 255;
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return luma < 0.45 ? { eye: "#f7f7f7", pupil: "#111111" } : { eye: "#ffffff", pupil: "#171717" };
  }

  // desktop/pet/overlay.ts
  var api = window.opengrokPet;
  var markHost = document.getElementById("mark");
  var bubbles = document.getElementById("bubbles");
  var STATUS_CLASS = {
    idle: "idle",
    thinking: "thinking",
    working: "working",
    done: "done",
    alert: "alert"
  };
  var DBLCLICK_MS = 280;
  var MARK_PATHS = [
    "M13.237 21.041 24.319 12.851c.543-.402 1.32-.245 1.578.379 1.363 3.289.754 7.242-1.957 9.956-2.71 2.714-6.482 3.309-9.93 1.953l-3.766 1.746c5.401 3.696 11.96 2.782 16.059-1.324 3.251-3.255 4.258-7.692 3.317-11.693L29.111 5.091 13.234 21.044Z",
    "M10.95 23.031C7.073 19.324 7.742 13.585 11.05 10.276c2.446-2.449 6.454-3.449 9.952-1.979l3.758-1.737C24.083 6.07 23.215 5.543 22.22 5.173c-4.5-1.854-9.887-.931-13.545 2.728C5.156 11.424 4.05 16.84 5.95 21.462c1.419 3.454-.907 5.898-3.251 8.364C1.868 30.7 1.035 31.575.364 32.5L10.947 23.034Z"
  ];
  function svgEl(name, attrs = {}) {
    const el = document.createElementNS("http://www.w3.org/2000/svg", name);
    for (const [key, value] of Object.entries(attrs)) {
      el.setAttribute(key, String(value));
    }
    return el;
  }
  var svg = svgEl("svg", { viewBox: "0 0 120 120", role: "img", "aria-label": "OpenGrok pet" });
  var critter = svgEl("g", { class: "critter" });
  var body = svgEl("g", { class: "body" });
  var face = svgEl("g", { class: "face" });
  var leftEye = svgEl("ellipse", { class: "eye", cx: 46, cy: 56, rx: 9, ry: 11 });
  var rightEye = svgEl("ellipse", { class: "eye", cx: 74, cy: 56, rx: 9, ry: 11 });
  var pupils = svgEl("g", { class: "pupils" });
  pupils.append(
    svgEl("circle", { class: "pupil", cx: 47, cy: 58, r: 4.4 }),
    svgEl("circle", { class: "pupil", cx: 75, cy: 58, r: 4.4 }),
    svgEl("circle", { class: "spark", cx: 45.2, cy: 55.2, r: 1.4 }),
    svgEl("circle", { class: "spark", cx: 73.2, cy: 55.2, r: 1.4 })
  );
  var smile = svgEl("path", { class: "smile", d: "M50 76c6 7 14 7 20 0", fill: "none" });
  face.append(leftEye, rightEye, pupils, smile);
  critter.append(body, face);
  svg.append(critter);
  var sprite = document.createElement("img");
  sprite.alt = "";
  sprite.draggable = false;
  sprite.hidden = true;
  markHost.append(svg, sprite);
  var SPRITES = {
    anime: {
      idle: "./pet-assets/anime-idle.png",
      blink: "./pet-assets/anime-blink.png",
      think: "./pet-assets/anime-think.png"
    },
    pixel: {
      idle: "./pet-assets/pixel-idle.png",
      think: "./pet-assets/pixel-think.png"
    },
    adult: {
      idle: "./pet-assets/adult-idle.png",
      blink: "./pet-assets/adult-blink.png",
      think: "./pet-assets/adult-think.png"
    }
  };
  var blinkTimer = 0;
  function paintBody(shape, fill) {
    body.replaceChildren();
    if (shape === "mark") {
      const g = svgEl("g", { transform: "translate(12 14) scale(2.7)" });
      for (const d of MARK_PATHS) {
        g.append(svgEl("path", { d, fill }));
      }
      body.append(g);
      leftEye.setAttribute("cx", "46");
      rightEye.setAttribute("cx", "74");
      leftEye.setAttribute("cy", "54");
      rightEye.setAttribute("cy", "54");
      return;
    }
    if (shape === "orb") {
      body.append(svgEl("ellipse", { cx: 60, cy: 64, rx: 42, ry: 40, fill }));
      leftEye.setAttribute("cx", "46");
      rightEye.setAttribute("cx", "74");
      leftEye.setAttribute("cy", "58");
      rightEye.setAttribute("cy", "58");
      return;
    }
    body.append(
      svgEl("path", {
        d: "M60 6C63 32 78 47 104 60 78 73 63 88 60 114 57 88 42 73 16 60 42 47 57 32 60 6Z",
        fill
      })
    );
    leftEye.setAttribute("cx", "46");
    rightEye.setAttribute("cx", "74");
    leftEye.setAttribute("cy", "56");
    rightEye.setAttribute("cy", "56");
  }
  var prefs = {
    shape: "star",
    color: "ink",
    face: "idle",
    size: 128,
    bubbles: true
  };
  var mood = "idle";
  var hideTimer = 0;
  var drag = null;
  var moved = false;
  var overPet = false;
  var pendingClick = null;
  var labels = { thinking: "\u601D\u8003\u4E2D\u2026", working: "\u5DE5\u4F5C\u4E2D\u2026", done: "\u5B8C\u6210", alert: "\u9700\u8981\u4F60" };
  function spriteSrc(shape, kind) {
    const pack = SPRITES[shape];
    if (!pack) {
      return "";
    }
    return pack[kind] ?? pack.idle ?? "";
  }
  function stopBlink() {
    window.clearInterval(blinkTimer);
    blinkTimer = 0;
  }
  function startBlink() {
    stopBlink();
    if (prefs.shape !== "anime" && prefs.shape !== "adult" || mood !== "idle") {
      return;
    }
    const kind = prefs.shape;
    blinkTimer = window.setInterval(() => {
      sprite.src = spriteSrc(kind, "blink");
      window.setTimeout(() => {
        if (prefs.shape === kind && mood === "idle") {
          sprite.src = spriteSrc(kind, "idle");
        }
      }, 140);
    }, 3200);
  }
  function applySpriteFrame() {
    const pack = SPRITES[prefs.shape];
    if (!pack) {
      return;
    }
    if (mood === "thinking" || mood === "working" || prefs.face === "curious") {
      sprite.src = spriteSrc(prefs.shape, "think");
      stopBlink();
      return;
    }
    sprite.src = spriteSrc(prefs.shape, "idle");
    startBlink();
  }
  function applyLook() {
    const fill = resolvePetBodyInk(prefs.color);
    const tone = resolvePetEyeInk(prefs.color);
    const display = prefs.shape === "adult" ? Math.round(prefs.size * 1.6) : prefs.size;
    document.documentElement.style.setProperty("--pet-size", `${display}px`);
    document.documentElement.style.setProperty("--pet-body", fill);
    document.documentElement.style.setProperty("--pet-eye", tone.eye);
    document.documentElement.style.setProperty("--pet-pupil", tone.pupil);
    const spriteShape = Boolean(SPRITES[prefs.shape]);
    markHost.classList.toggle("is-sprite", spriteShape);
    markHost.classList.toggle("is-anime", prefs.shape === "anime" || prefs.shape === "adult");
    markHost.classList.toggle("is-pixel", prefs.shape === "pixel");
    svg.hidden = spriteShape;
    sprite.hidden = !spriteShape;
    if (spriteShape) {
      applySpriteFrame();
      return;
    }
    stopBlink();
    paintBody(prefs.shape, fill);
    smile.style.opacity = prefs.face === "happy" || mood === "done" ? "1" : prefs.face === "idle" ? "0.85" : "0";
    face.style.transform = prefs.face === "curious" ? "translate(3px,-1px)" : "";
  }
  function setIgnore(ignore) {
    api?.setIgnore(ignore);
  }
  function overBlob(x, y) {
    const box = markHost.getBoundingClientRect();
    return Math.hypot(x - (box.left + box.width / 2), y - (box.top + box.height / 2)) < box.width * 0.48;
  }
  function showBubble(text, phase, ms) {
    if (!prefs.bubbles) {
      bubbles.hidden = true;
      api?.fit({ bubble: false, size: prefs.size });
      return;
    }
    bubbles.hidden = false;
    bubbles.innerHTML = `<button type="button" class="pet-bubble is-${phase}"><span class="pet-bubble__row"><span class="pet-bubble__glyph">${phase === "active" ? '<span class="pet-bubble__spin"></span>' : phase === "done" ? "\u2713" : "!"}</span><span class="pet-bubble__title"></span></span></button>`;
    const title = bubbles.querySelector(".pet-bubble__title");
    if (title) {
      title.textContent = text;
    }
    api?.fit({ bubble: true, size: prefs.size });
    requestAnimationFrame(() => api?.fit({ bubble: true, size: prefs.size }));
    clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => {
      bubbles.hidden = true;
      api?.fit({ bubble: false, size: prefs.size });
    }, ms);
  }
  function setMood(next, headline) {
    mood = next;
    critter.setAttribute("class", `critter ${STATUS_CLASS[next] ?? "idle"}`);
    if (SPRITES[prefs.shape]) {
      applySpriteFrame();
    }
    const text = (headline ?? "").trim();
    if (next === "thinking" || next === "working") {
      showBubble(text || labels.working, "active", 12e3);
    } else if (next === "done") {
      showBubble(text || labels.done, "done", 2400);
    } else if (next === "alert") {
      showBubble(text || labels.alert, "wait", 8e3);
    } else {
      bubbles.hidden = true;
      api?.fit({ bubble: false, size: prefs.size });
    }
  }
  function applyConfig(config) {
    if (config.labels) {
      labels = { ...labels, ...config.labels };
    }
    prefs = {
      shape: isPetShape(config.shape) ? config.shape : prefs.shape,
      color: isPetColor(config.color) ? config.color : prefs.color,
      face: isPetFace(config.expression) ? config.expression : prefs.face,
      size: Number(config.size) || prefs.size,
      bubbles: config.bubbles !== false
    };
    applyLook();
    api?.fit({ bubble: prefs.bubbles && !bubbles.hidden, size: prefs.size });
  }
  function applyStatus(status) {
    if (typeof status === "string") {
      setMood(status);
      return;
    }
    if (!status || typeof status !== "object") {
      setMood("idle");
      return;
    }
    const row = status;
    setMood(row.mood ?? "idle", row.headline);
  }
  window.addEventListener("mousemove", (event) => {
    const hit = overBlob(event.clientX, event.clientY);
    if (hit !== overPet) {
      overPet = hit;
      setIgnore(!hit);
    }
  });
  document.addEventListener("mouseleave", () => {
    overPet = false;
    if (!drag) {
      setIgnore(true);
    }
  });
  markHost.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    markHost.setPointerCapture(event.pointerId);
    drag = { x: event.screenX, y: event.screenY };
    moved = false;
    setIgnore(false);
  });
  markHost.addEventListener("pointermove", (event) => {
    if (!drag) {
      return;
    }
    const dx = event.screenX - drag.x;
    const dy = event.screenY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 8) {
      moved = true;
    }
    drag = { x: event.screenX, y: event.screenY };
    api?.move({ dx, dy });
  });
  markHost.addEventListener("pointerup", () => {
    if (!drag) {
      return;
    }
    drag = null;
    api?.endMove();
    if (!moved) {
      if (pendingClick != null) {
        window.clearTimeout(pendingClick);
        pendingClick = null;
        api?.dblclick();
      } else {
        pendingClick = window.setTimeout(() => {
          pendingClick = null;
          const faces = ["happy", "curious", "idle"];
          prefs.face = faces[Math.floor(Math.random() * faces.length)] ?? "happy";
          applyLook();
        }, DBLCLICK_MS);
      }
    }
    setIgnore(!overPet);
  });
  markHost.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    api?.menu();
  });
  api?.onConfig((config) => applyConfig(config));
  api?.onStatus(applyStatus);
  applyLook();
  api?.ready();
  setIgnore(true);
})();
//# sourceMappingURL=pet.js.map
