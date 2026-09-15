/* =========================================================
   GUDUR CROSSING RADAR V8
   FRONTEND INTELLIGENCE ENGINE
   ========================================================= */

const FIREBASE_URL =
  "https://gudur-gate-tracker-default-rtdb.firebaseio.com";

const FIREBASE_PATH =
  "gudur_crossing_v8";

let radarData = null;
let soundEnabled = true;
let lastDecision = "";
let firebaseReady = false;


/* =========================================================
   FIREBASE LOADER
   ========================================================= */

async function loadFirebase() {

  try {

    const appModule = await import(
      "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js"
    );

    const databaseModule = await import(
      "https://www.gstatic.com/firebasejs/12.1.0/firebase-database.js"
    );

    const app = appModule.initializeApp({
      databaseURL: FIREBASE_URL
    });

    const database = databaseModule.getDatabase(app);

    const dataRef = databaseModule.ref(
      database,
      FIREBASE_PATH
    );

    databaseModule.onValue(
      dataRef,
      snapshot => {

        radarData = snapshot.val();

        firebaseReady = true;

        updateConnection(true);

        renderDashboard(radarData);

      },
      error => {

        console.error(
          "Firebase listener error:",
          error
        );

        updateConnection(false);

      }
    );

  } catch (error) {

    console.error(
      "Firebase initialization failed:",
      error
    );

    updateConnection(false);

  }

}


/* =========================================================
   CONNECTION STATUS
   ========================================================= */

function updateConnection(online) {

  const dot =
    document.getElementById("connectionDot");

  const text =
    document.getElementById("connectionText");

  if (!dot || !text) return;

  dot.classList.remove(
    "online",
    "warning",
    "offline"
  );

  if (online) {

    dot.classList.add("online");

    text.textContent =
      "RADAR ONLINE • FIREBASE CONNECTED";

  } else {

    dot.classList.add("offline");

    text.textContent =
      "RADAR OFFLINE • RECONNECTING...";

  }

}


/* =========================================================
   MAIN DASHBOARD RENDER
   ========================================================= */

function renderDashboard(data) {

  if (!data) return;

  updateLastUpdate(data);

  updateDecision(data);

  updateActiveTrain(data);

  updateGate(
    "chennai",
    data.live?.chennaiGate
  );

  updateGate(
    "tirupati",
    data.live?.tirupatiGate
  );

  updateUpcoming(
    data.upcoming
  );

  updateStatistics(
    data.statistics,
    data.system
  );

}


/* =========================================================
   LAST UPDATE
   ========================================================= */

function updateLastUpdate(data) {

  const element =
    document.getElementById("lastUpdate");

  if (!element) return;

  const timestamp =
    data.system?.lastUpdatedIST ||
    data.lastUpdatedIST ||
    data.lastUpdated ||
    data.system?.lastUpdated ||
    null;

  if (!timestamp) {

    element.textContent =
      "--:--:--";

    return;

  }

  const date =
    new Date(timestamp);

  if (Number.isNaN(date.getTime())) {

    element.textContent =
      String(timestamp);

    return;

  }

  element.textContent =
    date.toLocaleTimeString(
      "en-IN",
      {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true
      }
    );

}


/* =========================================================
   CROSSING DECISION
   ========================================================= */

function updateDecision(data) {

  const decision =
    getOverallDecision(data);

  const text =
    document.getElementById(
      "decisionText"
    );

  const subtext =
    document.getElementById(
      "decisionSubtext"
    );

  if (!text || !subtext) return;

  text.textContent =
    decision.label;

  subtext.textContent =
    decision.description;

  text.style.color =
    decision.color;

  updateSignalLamps(
    decision.status
  );

  if (
    lastDecision &&
    lastDecision !== decision.status
  ) {

    playDecisionAlert(
      decision.status
    );

  }

  lastDecision =
    decision.status;

}


/* =========================================================
   OVERALL DECISION LOGIC
   ========================================================= */

function getOverallDecision(data) {

  const gates = data.live || {};

  const statuses = [
    gates.chennaiGate?.status,
    gates.tirupatiGate?.status,
    gates.northGate?.status
  ]
    .filter(Boolean)
    .map(normalizeStatus);

  if (
    statuses.includes("CLOSED") ||
    statuses.includes("STOP")
  ) {

    return {
      status: "STOP",
      label: "STOP",
      description:
        "TRAIN APPROACH DETECTED • DO NOT CROSS",
      color: "#ff4655"
    };

  }

  if (
    statuses.includes("WARNING") ||
    statuses.includes("CAUTION")
  ) {

    return {
      status: "WARNING",
      label: "WARNING",
      description:
        "TRAIN APPROACHING • PREPARE TO STOP",
      color: "#ffc247"
    };

  }

  return {
    status: "OPEN",
    label: "GO",
    description:
      "NO CRITICAL TRAIN APPROACH DETECTED",
    color: "#35e87d"
  };

}


/* =========================================================
   NORMALIZE STATUS
   ========================================================= */

function normalizeStatus(status) {

  if (!status) return "OPEN";

  const value =
    String(status)
      .toUpperCase()
      .replace(/[^A-Z]/g, "");

  if (
    value.includes("CLOSED") ||
    value.includes("STOP")
  ) {

    return "CLOSED";

  }

  if (
    value.includes("WARNING") ||
    value.includes("CAUTION")
  ) {

    return "WARNING";

  }

  return "OPEN";

}


/* =========================================================
   SIGNAL LAMPS
   ========================================================= */

function updateSignalLamps(status) {

  const go =
    document.getElementById("lampGo");

  const warn =
    document.getElementById("lampWarn");

  const stop =
    document.getElementById("lampStop");

  if (!go || !warn || !stop) return;

  go.classList.remove("active");
  warn.classList.remove("active");
  stop.classList.remove("active");

  if (status === "OPEN") {

    go.classList.add("active");

  } else if (status === "WARNING") {

    warn.classList.add("active");

  } else {

    stop.classList.add("active");

  }

}


/* =========================================================
   ACTIVE TRAIN
   ========================================================= */

function updateActiveTrain(data) {

  const active =
    data.live?.activeTrain ||
    data.activeTrain ||
    null;

  const number =
    document.getElementById(
      "activeTrainNumber"
    );

  const name =
    document.getElementById(
      "activeTrainName"
    );

  const speed =
    document.getElementById(
      "activeSpeed"
    );

  const distance =
    document.getElementById(
      "activeDistance"
    );

  const eta =
    document.getElementById(
      "activeEta"
    );

  const direction =
    document.getElementById(
      "activeDirection"
    );

  const corridor =
    document.getElementById(
      "activeCorridor"
    );

  const badge =
    document.getElementById(
      "priorityBadge"
    );

  if (!active) {

    if (number)
      number.textContent = "TRAIN ----";

    if (name)
      name.textContent =
        "No train currently affecting crossing";

    if (speed)
      speed.textContent = "-- km/h";

    if (distance)
      distance.textContent = "-- km";

    if (eta)
      eta.textContent = "-- min";

    if (direction)
      direction.textContent = "--";

    if (corridor)
      corridor.textContent =
        "NO ACTIVE TRAIN";

    if (badge)
      badge.textContent =
        "STANDBY";

    return;

  }


  const trainNumber =
    active.trainNumber ||
    active.number ||
    active.trainNo ||
    getNumberFromText(
      active.activeTrain ||
      active.name ||
      ""
    );

  const trainName =
    active.trainName ||
    active.name ||
    active.activeTrain ||
    "Active train";


  const trainSpeed =
    active.speedKmh ??
    active.speed ??
    0;

  const trainDistance =
    active.distanceKm ??
    active.distanceToGateKm ??
    active.gateDistanceKm;

  const trainEta =
    active.etaMinutes ??
    active.eta ??
    null;

  const trainDirection =
    active.direction ||
    "--";

  const trainCorridor =
    active.corridor ||
    active.routeCorridor ||
    "--";


  if (number)
    number.textContent =
      trainNumber
        ? `TRAIN ${trainNumber}`
        : "TRAIN ----";

  if (name)
    name.textContent =
      cleanTrainName(trainName);

  if (speed)
    speed.textContent =
      formatNumber(trainSpeed) +
      " km/h";

  if (distance)
    distance.textContent =
      formatDistance(trainDistance);

  if (eta)
    eta.textContent =
      formatEta(trainEta);

  if (direction)
    direction.textContent =
      shortDirection(trainDirection);

  if (corridor)
    corridor.textContent =
      String(trainCorridor).toUpperCase();

  if (badge) {

    const priority =
      active.priority ||
      active.status ||
      "ACTIVE";

    badge.textContent =
      String(priority)
        .toUpperCase();

  }

}


/* =========================================================
   GATE RENDERER
   ========================================================= */

function updateGate(type, gate) {

  if (!gate) {

    setGateEmpty(type);

    return;

  }

  const status =
    normalizeStatus(gate.status);

  const statusElement =
    document.getElementById(
      `${type}Status`
    );

  const trainElement =
    document.getElementById(
      `${type}Train`
    );

  const distanceElement =
    document.getElementById(
      `${type}Distance`
    );

  const blip =
    document.getElementById(
      `${type}Blip`
    );


  if (statusElement) {

    statusElement.textContent =
      status;

    statusElement.style.color =
      status === "CLOSED"
        ? "#ff4655"
        : status === "WARNING"
          ? "#ffc247"
          : "#35e87d";

  }


  const train =
    gate.trainNumber ||
    gate.trainNo ||
    gate.number ||
    getNumberFromText(
      gate.activeTrain ||
      gate.trainName ||
      ""
    );

  if (trainElement) {

    trainElement.textContent =
      train || "---";

  }


  const distance =
    gate.distanceKm ??
    gate.distanceToGateKm ??
    gate.gateDistanceKm;

  if (distanceElement) {

    distanceElement.textContent =
      formatDistance(distance);

  }


  updateRadarBlip(
    blip,
    distance,
    status
  );

}


/* =========================================================
   EMPTY GATE
   ========================================================= */

function setGateEmpty(type) {

  const status =
    document.getElementById(
      `${type}Status`
    );

  const train =
    document.getElementById(
      `${type}Train`
    );

  const distance =
    document.getElementById(
      `${type}Distance`
    );

  const blip =
    document.getElementById(
      `${type}Blip`
    );

  if (status)
    status.textContent = "OPEN";

  if (status)
    status.style.color =
      "#35e87d";

  if (train)
    train.textContent = "---";

  if (distance)
    distance.textContent = "--";

  if (blip)
    blip.style.display = "none";

}


/* =========================================================
   RADAR TRAIN POSITION
   ========================================================= */

function updateRadarBlip(
  blip,
  distance,
  status
) {

  if (!blip) return;

  if (
    distance === null ||
    distance === undefined ||
    Number.isNaN(Number(distance))
  ) {

    blip.style.display =
      "none";

    return;

  }

  const km =
    Math.max(
      0,
      Number(distance)
    );

  /*
    Radar:
    5 km = far edge
    0 km = gate
  */

  const maxKm = 5;

  let percentage =
    Math.min(
      100,
      Math.max(
        0,
        ((maxKm - km) / maxKm) * 100
      )
    );

  /*
    Convert to vertical position.
    0% = top
    100% = bottom
  */

  let top =
    8 +
    percentage * 0.84;

  blip.style.display =
    "block";

  blip.style.top =
    `${top}%`;

  if (status === "CLOSED") {

    blip.style.background =
      "#ff4655";

    blip.style.boxShadow =
      "0 0 24px rgba(255,70,85,.95)";

  } else if (
    status === "WARNING"
  ) {

    blip.style.background =
      "#ffc247";

    blip.style.boxShadow =
      "0 0 24px rgba(255,194,71,.95)";

  } else {

    blip.style.background =
      "#35e87d";

    blip.style.boxShadow =
      "0 0 24px rgba(53,232,125,.8)";

  }

}


/* =========================================================
   UPCOMING TRAINS
   ========================================================= */

function updateUpcoming(upcoming) {

  const container =
    document.getElementById(
      "upcomingList"
    );

  const count =
    document.getElementById(
      "upcomingCount"
    );

  if (!container) return;


  let trains = [];

  if (Array.isArray(upcoming)) {

    trains = upcoming;

  } else if (
    upcoming &&
    typeof upcoming === "object"
  ) {

    trains =
      Object.entries(upcoming)
        .map(
          ([key, value]) => {

            if (
              value &&
              typeof value === "object"
            ) {

              return {
                id: key,
                ...value
              };

            }

            return {
              id: key,
              name: String(value)
            };

          }
        );

  }


  trains =
    trains.filter(Boolean);


  if (count) {

    count.textContent =
      `${trains.length} TRAIN${trains.length === 1 ? "" : "S"}`;

  }


  if (!trains.length) {

    container.innerHTML = `
      <div class="upcoming-empty">
        No upcoming trains available
      </div>
    `;

    return;

  }


  trains.sort(
    (a, b) =>
      Number(
        a.etaMinutes ??
        a.eta ??
        9999
      ) -
      Number(
        b.etaMinutes ??
        b.eta ??
        9999
      )
  );


  container.innerHTML =
    trains
      .slice(0, 10)
      .map(
        (train, index) =>
          createTrainRow(
            train,
            index
          )
      )
      .join("");

}


/* =========================================================
   TRAIN ROW
   ========================================================= */

function createTrainRow(
  train,
  index
) {

  const number =
    train.trainNumber ||
    train.trainNo ||
    train.number ||
    train.id ||
    "---";

  const name =
    cleanTrainName(
      train.trainName ||
      train.name ||
      train.activeTrain ||
      "RailRadar Train"
    );


  const eta =
    train.etaMinutes ??
    train.eta ??
    null;


  const time =
    train.scheduledTime ||
    train.arrivalTime ||
    train.departureTime ||
    train.time ||
    "--:--";


  const platform =
    train.platform ||
    "--";


  const delay =
    train.delayMinutes ??
    train.delay ??
    0;


  const delayText =
    Number(delay) > 0
      ? `+${delay} min`
      : "ON TIME";


  return `
    <div class="train-row">

      <div class="train-time">
        ${escapeHtml(
          formatTime(time)
        )}
      </div>

      <div class="train-details">

        <strong>
          ${escapeHtml(
            String(number)
          )}
          •
          ${escapeHtml(name)}
        </strong>

        <small>
          PLATFORM ${escapeHtml(
            String(platform)
          )}
          •
          ${escapeHtml(delayText)}
        </small>

      </div>

      <div class="eta">
        ${escapeHtml(
          formatEta(eta)
        )}
      </div>

    </div>
  `;

}


/* =========================================================
   STATISTICS
   ========================================================= */

function updateStatistics(
  statistics,
  system
) {

  statistics =
    statistics || {};

  system =
    system || {};


  const board =
    statistics.boardTrainCount ??
    statistics.boardCount ??
    system.boardTrainCount ??
    radarData?.boardTrainCount ??
    "--";


  const live =
    statistics.liveRequestCount ??
    system.liveRequestCount ??
    radarData?.liveRequestCount ??
    "--";


  const route =
    statistics.routeRequestCount ??
    system.routeRequestCount ??
    radarData?.routeRequestCount ??
    "--";


  const processing =
    statistics.processingSeconds ??
    system.processingSeconds ??
    radarData?.processingSeconds ??
    null;


  setText(
    "statBoard",
    board
  );

  setText(
    "statLive",
    live
  );

  setText(
    "statRoute",
    route
  );

  setText(
    "statProcessing",
    processing === null
      ? "--s"
      : `${formatNumber(processing)}s`
  );

}


/* =========================================================
   UTILITIES
   ========================================================= */

function setText(
  id,
  value
) {

  const element =
    document.getElementById(id);

  if (element)
    element.textContent =
      String(value);

}


function formatNumber(value) {

  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {

    return "--";

  }

  const number =
    Number(value);

  if (Number.isNaN(number))
    return String(value);

  return number % 1 === 0
    ? String(number)
    : number.toFixed(1);

}


function formatDistance(value) {

  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {

    return "-- km";

  }

  const number =
    Number(value);

  if (Number.isNaN(number))
    return "-- km";

  if (number < 1) {

    return `${Math.round(
      number * 1000
    )} m`;

  }

  return `${number.toFixed(2)} km`;

}


function formatEta(value) {

  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {

    return "-- min";

  }

  const number =
    Number(value);

  if (Number.isNaN(number))
    return "-- min";

  if (number <= 0)
    return "NOW";

  return `${Math.round(number)} min`;

}


function formatTime(value) {

  if (!value)
    return "--:--";

  if (
    typeof value === "string" &&
    /^\d{1,2}:\d{2}/.test(value)
  ) {

    return value;

  }

  const date =
    new Date(value);

  if (Number.isNaN(date.getTime()))
    return String(value);

  return date.toLocaleTimeString(
    "en-IN",
    {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true
    }
  );

}


function cleanTrainName(name) {

  return String(name || "")
    .replace(/\s+/g, " ")
    .trim();

}


function getNumberFromText(text) {

  const match =
    String(text || "")
      .match(/\b\d{4,6}\b/);

  return match
    ? match[0]
    : "";

}


function shortDirection(direction) {

  if (!direction)
    return "--";

  const value =
    String(direction)
      .toUpperCase();

  if (
    value.includes("TOWARD") &&
    value.includes("GUDUR")
  ) {

    return "→ GUDUR";

  }

  if (
    value.includes("GUDUR")
  ) {

    return "→ GUDUR";

  }

  if (
    value.includes("CHENNAI") ||
    value.includes("MAS")
  ) {

    return "→ CHENNAI";

  }

  if (
    value.includes("TIRUPATI") ||
    value.includes("TPTY")
  ) {

    return "→ TIRUPATI";

  }

  if (
    value.includes("NORTH")
  ) {

    return "→ NORTH";

  }

  return value;

}


/* =========================================================
   SOUND
   ========================================================= */

function playDecisionAlert(
  status
) {

  if (!soundEnabled)
    return;

  if (
    status !== "WARNING" &&
    status !== "STOP"
  )
    return;


  try {

    const AudioContext =
      window.AudioContext ||
      window.webkitAudioContext;

    if (!AudioContext)
      return;

    const audio =
      new AudioContext();

    const oscillator =
      audio.createOscillator();

    const gain =
      audio.createGain();


    oscillator.connect(
      gain
    );

    gain.connect(
      audio.destination
    );


    oscillator.frequency.value =
      status === "STOP"
        ? 880
        : 620;


    oscillator.type =
      "sine";


    gain.gain.setValueAtTime(
      0.001,
      audio.currentTime
    );

    gain.gain.exponentialRampToValueAtTime(
      0.12,
      audio.currentTime + 0.02
    );

    gain.gain.exponentialRampToValueAtTime(
      0.001,
      audio.currentTime + 0.35
    );


    oscillator.start();

    oscillator.stop(
      audio.currentTime + 0.4
    );

  } catch (error) {

    console.warn(
      "Sound unavailable:",
      error
    );

  }

}


/* =========================================================
   SOUND BUTTON
   ========================================================= */

function setupSoundButton() {

  const button =
    document.getElementById(
      "soundBtn"
    );

  if (!button) return;

  button.addEventListener(
    "click",
    () => {

      soundEnabled =
        !soundEnabled;

      button.textContent =
        soundEnabled
          ? "🔊"
          : "🔇";

      if (soundEnabled) {

        playDecisionAlert(
          "WARNING"
        );

      }

    }
  );

}


/* =========================================================
   THEME
   ========================================================= */

function setupThemeButton() {

  const button =
    document.getElementById(
      "themeBtn"
    );

  if (!button) return;


  button.addEventListener(
    "click",
    () => {

      document.body.classList.toggle(
        "light-mode"
      );

      button.textContent =
        document.body.classList.contains(
          "light-mode"
        )
          ? "☀"
          : "☾";

    }
  );

}


/* =========================================================
   FULLSCREEN
   ========================================================= */

function setupFullscreen() {

  const button =
    document.getElementById(
      "fullscreenBtn"
    );

  if (!button) return;


  button.addEventListener(
    "click",
    async () => {

      try {

        if (!document.fullscreenElement) {

          await document.documentElement
            .requestFullscreen();

        } else {

          await document.exitFullscreen();

        }

      } catch (error) {

        console.warn(
          "Fullscreen unavailable:",
          error
        );

      }

    }
  );

}


/* =========================================================
   ESCAPE HTML
   ========================================================= */

function escapeHtml(value) {

  return String(value)
    .replace(
      /&/g,
      "&amp;"
    )
    .replace(
      /</g,
      "&lt;"
    )
    .replace(
      />/g,
      "&gt;"
    )
    .replace(
      /"/g,
      "&quot;"
    )
    .replace(
      /'/g,
      "&#039;"
    );

}


/* =========================================================
   ONLINE / OFFLINE EVENTS
   ========================================================= */

window.addEventListener(
  "online",
  () => {

    if (firebaseReady)
      updateConnection(true);

  }
);


window.addEventListener(
  "offline",
  () => {

    updateConnection(false);

  }
);


/* =========================================================
   INITIALIZE
   ========================================================= */

document.addEventListener(
  "DOMContentLoaded",
  () => {

    setupSoundButton();

    setupThemeButton();

    setupFullscreen();

    updateConnection(false);

    loadFirebase();

  }
);
