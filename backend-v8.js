// ============================================================
// GUDUR CROSSING RADAR V8
// Railway Crossing Intelligence Backend
// ============================================================

"use strict";

process.env.TZ = "Asia/Kolkata";

const axios = require("axios");

// Firebase Admin - MODULAR API
const { initializeApp, cert } = require("firebase-admin/app");
const {
  getDatabase,
  ref,
  set,
} = require("firebase-admin/database");

// ============================================================
// CONFIGURATION
// ============================================================

const FIREBASE_DATABASE_URL =
  "https://gudur-gate-tracker-default-rtdb.firebaseio.com";

const FIREBASE_PATH = "gudur_crossing_v8";

const RAILRADAR_BASE =
  "https://api.railradar.in/v1";

const RAILRADAR_API_KEY =
  process.env.RAILRADAR_API_KEY;

const FIREBASE_SERVICE_ACCOUNT =
  process.env.FIREBASE_SERVICE_ACCOUNT;

// ============================================================
// GUDUR LOCATION
// ============================================================

const GUDUR = {
  lat: 14.14842,
  lng: 79.84524,
  code: "GDR",
  name: "Gudur Junction",
};

// ============================================================
// GATE LOCATIONS
// ============================================================

const GATES = {
  north: {
    id: "northGate",
    name: "North Gate",
    lat: 14.14842,
    lng: 79.84524,

    // North-side train:
    // CLOSE only when <= 0.50 km
    warningKm: 5.0,
    closeKm: 0.50,
  },

  chennai: {
    id: "chennaiGate",
    name: "Chennai Gate",
    lat: 14.1396639,
    lng: 79.8441306,

    // Chennai / South-East side
    warningKm: 5.0,
    closeKm: 4.0,
  },

  tirupati: {
    id: "tirupatiGate",
    name: "Tirupati Gate",
    lat: 14.1402056,
    lng: 79.8436000,

    // Tirupati / South-West side
    warningKm: 5.0,
    closeKm: 4.0,
  },
};

// ============================================================
// GENERAL SETTINGS
// ============================================================

const UPCOMING_HOURS = 4;

const MAX_UPCOMING = 10;

const MAX_LIVE_REQUESTS = 5;

const MAX_ROUTE_REQUESTS = 5;

const REQUEST_DELAY_MS = 1200;

// ============================================================
// STARTUP BANNER
// ============================================================

console.log("");
console.log("==============================================");
console.log(" GUDUR CROSSING RADAR V8");
console.log(" BACKEND STARTING");
console.log("==============================================");
console.log("Node version:", process.version);
console.log("Firebase path:", FIREBASE_PATH);
console.log("RailRadar API:", RAILRADAR_BASE);
console.log("");

// ============================================================
// ENVIRONMENT CHECK
// ============================================================

if (!RAILRADAR_API_KEY) {
  console.error("❌ RAILRADAR_API_KEY is missing.");
  process.exit(1);
}

if (!FIREBASE_SERVICE_ACCOUNT) {
  console.error("❌ FIREBASE_SERVICE_ACCOUNT is missing.");
  process.exit(1);
}

// ============================================================
// FIREBASE SERVICE ACCOUNT
// ============================================================

let serviceAccount;

try {
  serviceAccount = JSON.parse(FIREBASE_SERVICE_ACCOUNT);
} catch (error) {
  console.error("❌ FIREBASE_SERVICE_ACCOUNT is not valid JSON.");
  console.error(error.message);
  process.exit(1);
}

// ============================================================
// FIREBASE INITIALIZATION
// ============================================================

let firebaseApp;
let database;

try {
  firebaseApp = initializeApp({
    credential: cert(serviceAccount),
    databaseURL: FIREBASE_DATABASE_URL,
  });

  database = getDatabase(firebaseApp);

  console.log("✅ Firebase initialized successfully.");
} catch (error) {
  console.error("❌ Firebase initialization failed.");
  console.error(error);
  process.exit(1);
}

// ============================================================
// RAILRADAR AXIOS CLIENT
// ============================================================

const railRadar = axios.create({
  baseURL: RAILRADAR_BASE,

  timeout: 10000,

  headers: {
    Authorization: `Bearer ${RAILRADAR_API_KEY}`,
    "x-api-key": RAILRADAR_API_KEY,
    Accept: "application/json",
  },
});

// ============================================================
// HELPERS
// ============================================================

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeNumber(value, fallback = null) {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
}

function normalizeTrainNumber(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const match = String(value).match(/\d{4,6}/);

  return match ? match[0] : null;
}

function getTrainNumber(train) {
  return normalizeTrainNumber(
    train?.trainNumber ??
    train?.trainNo ??
    train?.number ??
    train?.train_number ??
    train?.id
  );
}

function getTrainName(train) {
  return (
    train?.trainName ??
    train?.name ??
    train?.train_name ??
    ""
  );
}

function getSpeed(train) {
  return safeNumber(
    train?.speed ??
    train?.currentSpeed ??
    train?.velocity ??
    train?.liveSpeed,
    0
  );
}

function getDelay(train) {
  return safeNumber(
    train?.delay ??
    train?.delayMinutes ??
    train?.delay_minutes,
    0
  );
}

function getPlatform(train) {
  return (
    train?.platform ??
    train?.platformNumber ??
    train?.platform_no ??
    null
  );
}

// ============================================================
// DATE HELPERS
// ============================================================

function parseDate(value) {
  if (!value) return null;

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

function getEta(train) {
  const possibleValues = [
    train?.eta,
    train?.estimatedArrival,
    train?.estimated_arrival,
    train?.arrivalTime,
    train?.arrival,
    train?.scheduledArrival,
  ];

  for (const value of possibleValues) {
    const parsed = parseDate(value);

    if (parsed) {
      return parsed;
    }
  }

  return null;
}

// ============================================================
// COORDINATE EXTRACTION
// ============================================================

function getCoordinates(data) {
  if (!data) {
    return null;
  }

  const candidates = [
    data,
    data?.data,
    data?.train,
    data?.live,
    data?.location,
    data?.position,
    data?.coordinates,
  ];

  for (const item of candidates) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const lat = safeNumber(
      item.lat ??
      item.latitude ??
      item.location?.lat ??
      item.location?.latitude ??
      item.position?.lat ??
      item.position?.latitude
    );

    const lng = safeNumber(
      item.lng ??
      item.lon ??
      item.longitude ??
      item.location?.lng ??
      item.location?.lon ??
      item.location?.longitude ??
      item.position?.lng ??
      item.position?.lon ??
      item.position?.longitude
    );

    if (
      lat !== null &&
      lng !== null &&
      lat >= -90 &&
      lat <= 90 &&
      lng >= -180 &&
      lng <= 180
    ) {
      return {
        lat,
        lng,
      };
    }
  }

  return null;
}

// ============================================================
// HAVERSINE DISTANCE
// ============================================================

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;

  const dLat =
    ((lat2 - lat1) * Math.PI) / 180;

  const dLon =
    ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;

  const c =
    2 * Math.atan2(
      Math.sqrt(a),
      Math.sqrt(1 - a)
    );

  return R * c;
}

// ============================================================
// DISTANCE TO GATE
// ============================================================

function distanceToGate(coords, gate) {
  if (!coords) {
    return null;
  }

  return haversineKm(
    coords.lat,
    coords.lng,
    gate.lat,
    gate.lng
  );
}

// ============================================================
// GATE STATUS
// ============================================================

function getGateStatus(distanceKm, gate) {
  if (distanceKm === null) {
    return {
      status: "UNKNOWN",
      label: "NO LIVE POSITION",
      color: "gray",
    };
  }

  if (distanceKm <= gate.closeKm) {
    return {
      status: "CLOSED",
      label: "CLOSE",
      color: "red",
    };
  }

  if (distanceKm <= gate.warningKm) {
    return {
      status: "WARNING",
      label: "WARNING",
      color: "yellow",
    };
  }

  return {
    status: "OPEN",
    label: "OPEN",
    color: "green",
  };
}

// ============================================================
// STATION EXTRACTION
// ============================================================

function extractStops(routeData) {
  if (!routeData) {
    return [];
  }

  const possibleArrays = [
    routeData?.stops,
    routeData?.stations,
    routeData?.route,
    routeData?.data?.stops,
    routeData?.data?.stations,
    routeData?.data?.route,
    routeData?.train?.route,
    routeData?.train?.stops,
  ];

  for (const arr of possibleArrays) {
    if (Array.isArray(arr)) {
      return arr;
    }
  }

  return [];
}

function stationCode(stop) {
  if (!stop) return "";

  return String(
    stop.code ??
    stop.stationCode ??
    stop.station_code ??
    stop.station?.code ??
    ""
  )
    .trim()
    .toUpperCase();
}

function stationName(stop) {
  if (!stop) return "";

  return String(
    stop.name ??
    stop.stationName ??
    stop.station_name ??
    stop.station?.name ??
    ""
  )
    .trim()
    .toUpperCase();
}

// ============================================================
// ROUTE CORRIDOR DETECTION
// ============================================================

function detectCorridor(routeData) {
  const stops = extractStops(routeData);

  if (!stops.length) {
    return "UNKNOWN";
  }

  const codes = stops.map(stationCode);
  const names = stops.map(stationName);

  const containsCode = (code) =>
    codes.includes(code);

  const containsName = (text) =>
    names.some((name) => name.includes(text));

  const hasGDR =
    containsCode("GDR") ||
    containsName("GUDUR");

  const hasMAS =
    containsCode("MAS") ||
    containsName("CHENNAI");

  const hasTPTY =
    containsCode("TPTY") ||
    containsName("TIRUPATI");

  if (!hasGDR) {
    return "UNKNOWN";
  }

  // Tirupati branch
  if (hasTPTY) {
    return "TIRUPATI";
  }

  // Chennai / main south-east route
  if (hasMAS) {
    return "CHENNAI";
  }

  // Main northern corridor
  return "NORTH";
}

// ============================================================
// CHECK WHETHER GUDUR IS FINAL STOP
// ============================================================

function isGudurTerminating(routeData) {
  const stops = extractStops(routeData);

  if (!stops.length) {
    return false;
  }

  const lastStop = stops[stops.length - 1];

  const code = stationCode(lastStop);

  const name = stationName(lastStop);

  return (
    code === "GDR" ||
    name.includes("GUDUR")
  );
}

// ============================================================
// RAILRADAR STATION LIVE
// ============================================================

async function getStationLive() {
  console.log("📡 Requesting /stations/GDR/live ...");

  try {
    const response =
      await railRadar.get(
        "/stations/GDR/live"
      );

    console.log(
      "✅ Station live response received."
    );

    return response.data;
  } catch (error) {
    console.error(
      "❌ Station live request failed:",
      error.response?.status ||
        error.message
    );

    throw error;
  }
}

// ============================================================
// EXTRACT TRAINS FROM STATION RESPONSE
// ============================================================

function extractTrains(data) {
  if (!data) {
    return [];
  }

  const possibleArrays = [
    data?.trains,
    data?.data,
    data?.results,
    data?.station?.trains,
    data?.live,
  ];

  for (const arr of possibleArrays) {
    if (Array.isArray(arr)) {
      return arr;
    }
  }

  return [];
}

// ============================================================
// GET TRAIN LIVE
// ============================================================

async function getTrainLive(trainNumber) {
  try {
    const response =
      await railRadar.get(
        `/trains/${trainNumber}/live`,
        {
          params: {
            authoritative: "true",
            includeCoordinates: "true",
          },
        }
      );

    return response.data;
  } catch (error) {
    console.warn(
      `⚠️ Live failed ${trainNumber}:`,
      error.response?.status ||
        error.message
    );

    return null;
  }
}

// ============================================================
// GET TRAIN ROUTE
// ============================================================

async function getTrainRoute(trainNumber) {
  try {
    const response =
      await railRadar.get(
        `/trains/${trainNumber}/route`,
        {
          params: {
            format: "geojson",
            stops: "true",
          },
        }
      );

    return response.data;
  } catch (error) {
    console.warn(
      `⚠️ Route failed ${trainNumber}:`,
      error.response?.status ||
        error.message
    );

    return null;
  }
}

// ============================================================
// BUILD UPCOMING TRAIN
// ============================================================

function buildUpcomingTrain(train) {
  const trainNumber =
    getTrainNumber(train);

  if (!trainNumber) {
    return null;
  }

  const eta = getEta(train);

  return {
    trainNumber,

    trainName:
      getTrainName(train),

    eta:
      eta
        ? eta.toISOString()
        : null,

    delayMinutes:
      getDelay(train),

    platform:
      getPlatform(train),

    source: "RailRadar",
  };
}

// ============================================================
// GET UPCOMING BOARD
// ============================================================

function getUpcomingBoard(trains) {
  const now = Date.now();

  const maxTime =
    now +
    UPCOMING_HOURS *
      60 *
      60 *
      1000;

  const seen = new Set();

  const result = [];

  for (const train of trains) {
    const trainNumber =
      getTrainNumber(train);

    if (!trainNumber) {
      continue;
    }

    if (seen.has(trainNumber)) {
      continue;
    }

    const eta = getEta(train);

    if (!eta) {
      continue;
    }

    const timestamp =
      eta.getTime();

    if (
      timestamp < now ||
      timestamp > maxTime
    ) {
      continue;
    }

    seen.add(trainNumber);

    const upcoming =
      buildUpcomingTrain(train);

    if (upcoming) {
      result.push(upcoming);
    }
  }

  result.sort((a, b) => {
    if (!a.eta) return 1;
    if (!b.eta) return -1;

    return (
      new Date(a.eta).getTime() -
      new Date(b.eta).getTime()
    );
  });

  return result.slice(
    0,
    MAX_UPCOMING
  );
}

// ============================================================
// PROCESS ONE TRAIN
// ============================================================

async function processTrain(
  train,
  index
) {
  const trainNumber =
    getTrainNumber(train);

  if (!trainNumber) {
    return null;
  }

  console.log(
    `🧭 Route: ${trainNumber}`
  );

  // ----------------------------------------------------------
  // ROUTE
  // ----------------------------------------------------------

  const routeData =
    await getTrainRoute(
      trainNumber
    );

  if (!routeData) {
    return null;
  }

  const corridor =
    detectCorridor(routeData);

  // ----------------------------------------------------------
  // GUDUR TERMINATING TRAIN
  // ----------------------------------------------------------

  if (
    corridor === "NORTH" &&
    isGudurTerminating(routeData)
  ) {
    console.log(
      `ℹ️ ${trainNumber} terminates at Gudur — skipped.`
    );

    return null;
  }

  // ----------------------------------------------------------
  // LIVE DATA
  // ----------------------------------------------------------

  console.log(
    `📍 Live: ${trainNumber}`
  );

  const liveData =
    await getTrainLive(
      trainNumber
    );

  if (!liveData) {
    return null;
  }

  const coordinates =
    getCoordinates(liveData);

  if (!coordinates) {
    console.warn(
      `⚠️ No coordinates for ${trainNumber}`
    );

    return {
      trainNumber,
      trainName:
        getTrainName(train),
      corridor,
      coordinates: null,
      status: "NO_POSITION",
      source: "RailRadar",
    };
  }

  // ----------------------------------------------------------
  // DISTANCES
  // ----------------------------------------------------------

  const northDistance =
    distanceToGate(
      coordinates,
      GATES.north
    );

  const chennaiDistance =
    distanceToGate(
      coordinates,
      GATES.chennai
    );

  const tirupatiDistance =
    distanceToGate(
      coordinates,
      GATES.tirupati
    );

  // ----------------------------------------------------------
  // SELECT RELEVANT GATE
  // ----------------------------------------------------------

  let selectedGate;

  if (corridor === "NORTH") {
    selectedGate = GATES.north;
  } else if (
    corridor === "CHENNAI"
  ) {
    selectedGate = GATES.chennai;
  } else if (
    corridor === "TIRUPATI"
  ) {
    selectedGate = GATES.tirupati;
  } else {
    selectedGate = null;
  }

  if (!selectedGate) {
    return {
      trainNumber,
      trainName:
        getTrainName(train),
      corridor,
      coordinates,
      northDistanceKm: northDistance,
      chennaiDistanceKm:
        chennaiDistance,
      tirupatiDistanceKm:
        tirupatiDistance,
      status: "UNKNOWN",
      source: "RailRadar",
    };
  }

  const selectedDistance =
    distanceToGate(
      coordinates,
      selectedGate
    );

  const gateStatus =
    getGateStatus(
      selectedDistance,
      selectedGate
    );

  console.log(
    `📏 ${trainNumber} → ${selectedGate.name}: ${selectedDistance?.toFixed(3) ?? "?"} km → ${gateStatus.status}`
  );

  return {
    trainNumber,

    trainName:
      getTrainName(train),

    corridor,

    speed:
      getSpeed(liveData),

    delayMinutes:
      getDelay(train),

    platform:
      getPlatform(train),

    coordinates,

    distanceKm:
      selectedDistance,

    northDistanceKm:
      northDistance,

    chennaiDistanceKm:
      chennaiDistance,

    tirupatiDistanceKm:
      tirupatiDistance,

    gateId:
      selectedGate.id,

    gateName:
      selectedGate.name,

    status:
      gateStatus.status,

    statusLabel:
      gateStatus.label,

    source: "RailRadar",

    updatedAt:
      new Date().toISOString(),
  };
}

// ============================================================
// DETERMINE OVERALL DECISION
// ============================================================

function determineDecision(
  activeTrains
) {
  if (
    !Array.isArray(activeTrains) ||
    activeTrains.length === 0
  ) {
    return {
      status: "OPEN",
      label: "GO",
      reason:
        "No approaching train detected.",
      trainNumber: null,
      corridor: null,
      distanceKm: null,
    };
  }

  const validTrains =
    activeTrains.filter(
      (train) =>
        train &&
        (
          train.status === "CLOSED" ||
          train.status === "WARNING"
        )
    );

  if (!validTrains.length) {
    return {
      status: "OPEN",
      label: "GO",
      reason:
        "No train inside warning zone.",
      trainNumber: null,
      corridor: null,
      distanceKm: null,
    };
  }

  // CLOSED has priority
  const closed =
    validTrains.filter(
      (train) =>
        train.status === "CLOSED"
    );

  const candidates =
    closed.length
      ? closed
      : validTrains;

  candidates.sort(
    (a, b) =>
      (a.distanceKm ?? Infinity) -
      (b.distanceKm ?? Infinity)
  );

  const train =
    candidates[0];

  if (
    train.status === "CLOSED"
  ) {
    return {
      status: "CLOSED",
      label: "STOP",
      reason:
        `${train.trainNumber} is inside the closing distance.`,
      trainNumber:
        train.trainNumber,
      trainName:
        train.trainName,
      corridor:
        train.corridor,
      distanceKm:
        train.distanceKm,
    };
  }

  return {
    status: "WARNING",
    label: "WARNING",
    reason:
      `${train.trainNumber} is approaching the crossing.`,
    trainNumber:
      train.trainNumber,
    trainName:
      train.trainName,
    corridor:
      train.corridor,
    distanceKm:
      train.distanceKm,
  };
}

// ============================================================
// BUILD GATE SUMMARY
// ============================================================

function buildGateSummary(
  activeTrains
) {
  const summary = {
    northGate: {
      status: "OPEN",
      trainNumber: null,
      distanceKm: null,
    },

    chennaiGate: {
      status: "OPEN",
      trainNumber: null,
      distanceKm: null,
    },

    tirupatiGate: {
      status: "OPEN",
      trainNumber: null,
      distanceKm: null,
    },
  };

  for (const train of activeTrains) {
    if (!train?.gateId) {
      continue;
    }

    const current =
      summary[train.gateId];

    if (!current) {
      continue;
    }

    const distance =
      train.distanceKm;

    if (
      current.distanceKm === null ||
      (
        distance !== null &&
        distance < current.distanceKm
      )
    ) {
      current.status =
        train.status === "CLOSED"
          ? "CLOSED"
          : train.status === "WARNING"
          ? "WARNING"
          : "OPEN";

      current.trainNumber =
        train.trainNumber;

      current.distanceKm =
        distance;
    }
  }

  return summary;
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  console.log(
    "🚀 Starting V8 intelligence cycle..."
  );

  // ----------------------------------------------------------
  // STATION LIVE
  // ----------------------------------------------------------

  const stationData =
    await getStationLive();

  const stationTrains =
    extractTrains(stationData);

  console.log(
    `🚆 RailRadar returned ${stationTrains.length} trains.`
  );

  // ----------------------------------------------------------
  // UPCOMING BOARD
  // ----------------------------------------------------------

  const upcoming =
    getUpcomingBoard(
      stationTrains
    );

  console.log(
    `📋 Upcoming board: ${upcoming.length}`
  );

  // ----------------------------------------------------------
  // ACTIVE TRAIN PROCESSING
  // ----------------------------------------------------------

  const activeTrains = [];

  const processedNumbers =
    new Set();

  let liveRequests = 0;

  let routeRequests = 0;

  for (
    let i = 0;
    i < stationTrains.length;
    i++
  ) {
    if (
      activeTrains.length >=
      MAX_LIVE_REQUESTS
    ) {
      break;
    }

    if (
      routeRequests >=
      MAX_ROUTE_REQUESTS
    ) {
      console.log(
        "ℹ️ Route request limit reached."
      );
      break;
    }

    const train =
      stationTrains[i];

    const trainNumber =
      getTrainNumber(train);

    if (!trainNumber) {
      continue;
    }

    if (
      processedNumbers.has(
        trainNumber
      )
    ) {
      continue;
    }

    processedNumbers.add(
      trainNumber
    );

    routeRequests++;

    const result =
      await processTrain(
        train,
        i
      );

    if (
      result &&
      result.status !==
        "NO_POSITION"
    ) {
      activeTrains.push(
        result
      );
    }

    // Small delay to reduce 429
    if (
      i <
      stationTrains.length - 1
    ) {
      await sleep(
        REQUEST_DELAY_MS
      );
    }

    liveRequests++;

    if (
      liveRequests >=
      MAX_LIVE_REQUESTS
    ) {
      break;
    }
  }

  // ----------------------------------------------------------
  // OVERALL DECISION
  // ----------------------------------------------------------

  const decision =
    determineDecision(
      activeTrains
    );

  // ----------------------------------------------------------
  // GATE SUMMARY
  // ----------------------------------------------------------

  const gates =
    buildGateSummary(
      activeTrains
    );

  // ----------------------------------------------------------
  // STATISTICS
  // ----------------------------------------------------------

  const stats = {
    stationTrains:
      stationTrains.length,

    upcoming:
      upcoming.length,

    active:
      activeTrains.length,

    liveRequests,

    routeRequests,

    generatedAt:
      new Date().toISOString(),
  };

  // ----------------------------------------------------------
  // FIREBASE PAYLOAD
  // ----------------------------------------------------------

  const payload = {
    version: "V8",

    project:
      "GUDUR CROSSING RADAR",

    location: {
      code: GUDUR.code,
      name: GUDUR.name,
      lat: GUDUR.lat,
      lng: GUDUR.lng,
    },

    decision,

    activeTrain:
      activeTrains.length
        ? activeTrains[0]
        : null,

    activeTrains,

    gates,

    upcoming,

    stats,

    system: {
      source: "RailRadar",

      api:
        RAILRADAR_BASE,

      firebasePath:
        FIREBASE_PATH,

      workflow:
        "GitHub Actions",

      updateInterval:
        "5 minutes",

      generatedAt:
        new Date().toISOString(),

      status: "ONLINE",
    },
  };

  // ----------------------------------------------------------
  // FIREBASE WRITE
  // ----------------------------------------------------------

  console.log(
    "🔥 Writing V8 data to Firebase..."
  );

  // IMPORTANT:
  // Modular Firebase Admin API
  const databaseReference =
    ref(
      database,
      FIREBASE_PATH
    );

  await set(
    databaseReference,
    payload
  );

  console.log(
    "✅ V8 data written successfully."
  );

  // ----------------------------------------------------------
  // FINAL LOG
  // ----------------------------------------------------------

  console.log("");
  console.log(
    "=============================================="
  );

  console.log(
    " GUDUR CROSSING RADAR V8"
  );

  console.log(
    " UPDATE SUCCESSFUL"
  );

  console.log(
    "=============================================="
  );

  console.log(
    "Decision:",
    decision.status
  );

  console.log(
    "Label:",
    decision.label
  );

  console.log(
    "Active trains:",
    activeTrains.length
  );

  console.log(
    "Upcoming:",
    upcoming.length
  );

  console.log(
    "Firebase:",
    FIREBASE_PATH
  );

  console.log(
    "=============================================="
  );
}

// ============================================================
// ERROR HANDLER
// ============================================================

main()
  .catch((error) => {
    console.error("");
    console.error(
      "❌ V8 UPDATE FAILED"
    );

    console.error(error);

    if (error?.response) {
      console.error(
        "HTTP status:",
        error.response.status
      );

      console.error(
        "Response:",
        error.response.data
      );
    }

    process.exit(1);
  });
