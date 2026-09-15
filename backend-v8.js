// ============================================================
// GUDUR CROSSING RADAR V8
// BACKEND - RAILWAY CROSSING INTELLIGENCE
// ============================================================

"use strict";

process.env.TZ = "Asia/Kolkata";

const axios = require("axios");

// ============================================================
// FIREBASE ADMIN - MODULAR INITIALIZATION
// ============================================================

const { initializeApp, cert } = require("firebase-admin/app");
const { getDatabase } = require("firebase-admin/database");

// ============================================================
// CONFIG
// ============================================================

const FIREBASE_DATABASE_URL =
  "https://gudur-gate-tracker-default-rtdb.firebaseio.com";

const FIREBASE_PATH =
  "gudur_crossing_v8";

const RAILRADAR_BASE =
  "https://api.railradar.in/v1";

const RAILRADAR_API_KEY =
  process.env.RAILRADAR_API_KEY;

const FIREBASE_SERVICE_ACCOUNT =
  process.env.FIREBASE_SERVICE_ACCOUNT;

// ============================================================
// GUDUR
// ============================================================

const GUDUR = {
  code: "GDR",
  name: "Gudur Junction",
  lat: 14.14842,
  lng: 79.84524,
};

// ============================================================
// GATES
// ============================================================

const GATES = {
  north: {
    id: "northGate",
    name: "North Gate",
    lat: 14.14842,
    lng: 79.84524,

    // North side
    warningKm: 5.0,
    closeKm: 0.50,
  },

  chennai: {
    id: "chennaiGate",
    name: "Chennai Gate",
    lat: 14.1396639,
    lng: 79.8441306,

    // South-East / Chennai side
    warningKm: 5.0,
    closeKm: 4.0,
  },

  tirupati: {
    id: "tirupatiGate",
    name: "Tirupati Gate",
    lat: 14.1402056,
    lng: 79.8436000,

    // South-West / Tirupati side
    warningKm: 5.0,
    closeKm: 4.0,
  },
};

// ============================================================
// SETTINGS
// ============================================================

const UPCOMING_HOURS = 4;

const MAX_UPCOMING = 10;

// Keep requests low to reduce RailRadar 429
const MAX_TRAINS_TO_PROCESS = 5;

const REQUEST_DELAY_MS = 1500;

// ============================================================
// STARTUP
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
// ENVIRONMENT VALIDATION
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
  serviceAccount =
    JSON.parse(FIREBASE_SERVICE_ACCOUNT);

  console.log(
    "✅ Firebase service account parsed."
  );
} catch (error) {
  console.error(
    "❌ FIREBASE_SERVICE_ACCOUNT JSON is invalid."
  );

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

  database =
    getDatabase(firebaseApp);

  console.log(
    "✅ Firebase initialized successfully."
  );
} catch (error) {
  console.error(
    "❌ Firebase initialization failed."
  );

  console.error(error);

  process.exit(1);
}

// ============================================================
// RAILRADAR CLIENT
// ============================================================

const railRadar = axios.create({
  baseURL: RAILRADAR_BASE,

  timeout: 10000,

  headers: {
    Authorization:
      `Bearer ${RAILRADAR_API_KEY}`,

    "x-api-key":
      RAILRADAR_API_KEY,

    Accept:
      "application/json",
  },
});

// ============================================================
// BASIC HELPERS
// ============================================================

function sleep(ms) {
  return new Promise(
    (resolve) =>
      setTimeout(resolve, ms)
  );
}

function numberOrNull(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : null;
}

// ============================================================
// TRAIN NUMBER
// ============================================================

function getTrainNumber(train) {
  const value =
    train?.trainNumber ??
    train?.trainNo ??
    train?.train_number ??
    train?.number ??
    train?.id;

  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const match =
    String(value).match(/\d{4,6}/);

  return match
    ? match[0]
    : null;
}

// ============================================================
// TRAIN NAME
// ============================================================

function getTrainName(train) {
  return (
    train?.trainName ??
    train?.train_name ??
    train?.name ??
    ""
  );
}

// ============================================================
// SPEED
// ============================================================

function getSpeed(train) {
  return (
    numberOrNull(
      train?.speed ??
      train?.currentSpeed ??
      train?.current_speed ??
      train?.velocity ??
      train?.liveSpeed
    ) ?? 0
  );
}

// ============================================================
// DELAY
// ============================================================

function getDelay(train) {
  return (
    numberOrNull(
      train?.delay ??
      train?.delayMinutes ??
      train?.delay_minutes
    ) ?? 0
  );
}

// ============================================================
// PLATFORM
// ============================================================

function getPlatform(train) {
  return (
    train?.platform ??
    train?.platformNumber ??
    train?.platform_no ??
    null
  );
}

// ============================================================
// DATE
// ============================================================

function parseDate(value) {
  if (!value) {
    return null;
  }

  const d =
    new Date(value);

  if (
    Number.isNaN(
      d.getTime()
    )
  ) {
    return null;
  }

  return d;
}

// ============================================================
// ETA
// ============================================================

function getETA(train) {
  const values = [
    train?.eta,
    train?.ETA,
    train?.estimatedArrival,
    train?.estimated_arrival,
    train?.arrivalTime,
    train?.arrival_time,
    train?.arrival,
    train?.scheduledArrival,
  ];

  for (
    const value of values
  ) {
    const date =
      parseDate(value);

    if (date) {
      return date;
    }
  }

  return null;
}

// ============================================================
// COORDINATES
// ============================================================

function getCoordinates(data) {
  if (!data) {
    return null;
  }

  const objects = [
    data,
    data?.data,
    data?.train,
    data?.live,
    data?.location,
    data?.position,
    data?.coordinates,
  ];

  for (
    const object of objects
  ) {
    if (
      !object ||
      typeof object !== "object"
    ) {
      continue;
    }

    const lat =
      numberOrNull(
        object.lat ??
        object.latitude ??
        object.location?.lat ??
        object.location?.latitude ??
        object.position?.lat ??
        object.position?.latitude
      );

    const lng =
      numberOrNull(
        object.lng ??
        object.lon ??
        object.longitude ??
        object.location?.lng ??
        object.location?.lon ??
        object.location?.longitude ??
        object.position?.lng ??
        object.position?.lon ??
        object.position?.longitude
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
// HAVERSINE
// ============================================================

function haversineKm(
  lat1,
  lon1,
  lat2,
  lon2
) {
  const R = 6371;

  const dLat =
    ((lat2 - lat1) *
      Math.PI) /
    180;

  const dLon =
    ((lon2 - lon1) *
      Math.PI) /
    180;

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(
      (lat1 * Math.PI) / 180
    ) *
      Math.cos(
        (lat2 * Math.PI) / 180
      ) *
      Math.sin(dLon / 2) ** 2;

  const c =
    2 *
    Math.atan2(
      Math.sqrt(a),
      Math.sqrt(1 - a)
    );

  return R * c;
}

// ============================================================
// DISTANCE
// ============================================================

function getDistance(
  coordinates,
  gate
) {
  if (!coordinates) {
    return null;
  }

  return haversineKm(
    coordinates.lat,
    coordinates.lng,
    gate.lat,
    gate.lng
  );
}

// ============================================================
// STATUS
// ============================================================

function calculateStatus(
  distanceKm,
  gate
) {
  if (distanceKm === null) {
    return {
      status: "UNKNOWN",
      label: "NO LIVE POSITION",
    };
  }

  if (
    distanceKm <= gate.closeKm
  ) {
    return {
      status: "CLOSED",
      label: "CLOSE",
    };
  }

  if (
    distanceKm <= gate.warningKm
  ) {
    return {
      status: "WARNING",
      label: "WARNING",
    };
  }

  return {
    status: "OPEN",
    label: "OPEN",
  };
}

// ============================================================
// EXTRACT ARRAY
// ============================================================

function extractArray(data) {
  if (!data) {
    return [];
  }

  const arrays = [
    data?.trains,
    data?.data,
    data?.results,
    data?.live,
    data?.station?.trains,
  ];

  for (
    const array of arrays
  ) {
    if (
      Array.isArray(array)
    ) {
      return array;
    }
  }

  return [];
}

// ============================================================
// ROUTE STOPS
// ============================================================

function getRouteStops(data) {
  if (!data) {
    return [];
  }

  const arrays = [
    data?.stops,
    data?.stations,
    data?.route,
    data?.data?.stops,
    data?.data?.stations,
    data?.data?.route,
    data?.train?.stops,
    data?.train?.route,
  ];

  for (
    const array of arrays
  ) {
    if (
      Array.isArray(array)
    ) {
      return array;
    }
  }

  return [];
}

// ============================================================
// STATION CODE
// ============================================================

function getStationCode(stop) {
  if (!stop) {
    return "";
  }

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

// ============================================================
// STATION NAME
// ============================================================

function getStationName(stop) {
  if (!stop) {
    return "";
  }

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
// CORRIDOR DETECTION
// ============================================================

function detectCorridor(
  routeData
) {
  const stops =
    getRouteStops(
      routeData
    );

  if (!stops.length) {
    return "UNKNOWN";
  }

  const codes =
    stops.map(
      getStationCode
    );

  const names =
    stops.map(
      getStationName
    );

  const hasGDR =
    codes.includes("GDR") ||
    names.some(
      (x) =>
        x.includes("GUDUR")
    );

  if (!hasGDR) {
    return "UNKNOWN";
  }

  const hasTPTY =
    codes.includes("TPTY") ||
    names.some(
      (x) =>
        x.includes("TIRUPATI")
    );

  const hasMAS =
    codes.includes("MAS") ||
    names.some(
      (x) =>
        x.includes("CHENNAI")
    );

  if (hasTPTY) {
    return "TIRUPATI";
  }

  if (hasMAS) {
    return "CHENNAI";
  }

  return "NORTH";
}

// ============================================================
// GUDUR TERMINATING
// ============================================================

function terminatesAtGudur(
  routeData
) {
  const stops =
    getRouteStops(
      routeData
    );

  if (!stops.length) {
    return false;
  }

  const last =
    stops[stops.length - 1];

  const code =
    getStationCode(last);

  const name =
    getStationName(last);

  return (
    code === "GDR" ||
    name.includes("GUDUR")
  );
}

// ============================================================
// STATION LIVE
// ============================================================

async function getStationLive() {
  console.log(
    "📡 Requesting /stations/GDR/live ..."
  );

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
      error.response?.status ??
        error.message
    );

    throw error;
  }
}

// ============================================================
// TRAIN LIVE
// ============================================================

async function getTrainLive(
  trainNumber
) {
  try {
    const response =
      await railRadar.get(
        `/trains/${trainNumber}/live`,
        {
          params: {
            authoritative:
              "true",

            includeCoordinates:
              "true",
          },
        }
      );

    return response.data;
  } catch (error) {
    console.warn(
      `⚠️ Live failed ${trainNumber}:`,
      error.response?.status ??
        error.message
    );

    return null;
  }
}

// ============================================================
// TRAIN ROUTE
// ============================================================

async function getTrainRoute(
  trainNumber
) {
  try {
    const response =
      await railRadar.get(
        `/trains/${trainNumber}/route`,
        {
          params: {
            format:
              "geojson",

            stops:
              "true",
          },
        }
      );

    return response.data;
  } catch (error) {
    const status =
      error.response?.status;

    if (status === 429) {
      console.warn(
        `⏳ RailRadar rate limit for ${trainNumber} (429).`
      );
    } else {
      console.warn(
        `⚠️ Route failed ${trainNumber}:`,
        status ??
          error.message
      );
    }

    return null;
  }
}

// ============================================================
// UPCOMING TRAIN OBJECT
// ============================================================

function makeUpcoming(
  train
) {
  const trainNumber =
    getTrainNumber(train);

  if (!trainNumber) {
    return null;
  }

  const eta =
    getETA(train);

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

    source:
      "RailRadar",
  };
}

// ============================================================
// UPCOMING BOARD
// ============================================================

function makeUpcomingBoard(
  trains
) {
  const now =
    Date.now();

  const limit =
    now +
    UPCOMING_HOURS *
      60 *
      60 *
      1000;

  const seen =
    new Set();

  const result =
    [];

  for (
    const train of trains
  ) {
    const number =
      getTrainNumber(train);

    if (!number) {
      continue;
    }

    if (
      seen.has(number)
    ) {
      continue;
    }

    const eta =
      getETA(train);

    if (!eta) {
      continue;
    }

    const time =
      eta.getTime();

    if (
      time < now ||
      time > limit
    ) {
      continue;
    }

    const item =
      makeUpcoming(train);

    if (item) {
      result.push(item);

      seen.add(number);
    }
  }

  result.sort(
    (a, b) =>
      new Date(a.eta) -
      new Date(b.eta)
  );

  return result.slice(
    0,
    MAX_UPCOMING
  );
}

// ============================================================
// PROCESS TRAIN
// ============================================================

async function processTrain(
  train
) {
  const trainNumber =
    getTrainNumber(train);

  if (!trainNumber) {
    return null;
  }

  console.log(
    `🧭 Route: ${trainNumber}`
  );

  const route =
    await getTrainRoute(
      trainNumber
    );

  if (!route) {
    return null;
  }

  const corridor =
    detectCorridor(route);

  // ----------------------------------------------------------
  // NORTH TRAIN TERMINATING AT GUDUR
  // ----------------------------------------------------------

  if (
    corridor === "NORTH" &&
    terminatesAtGudur(route)
  ) {
    console.log(
      `ℹ️ ${trainNumber} terminates at Gudur — skipped.`
    );

    return null;
  }

  console.log(
    `📍 Live: ${trainNumber}`
  );

  const live =
    await getTrainLive(
      trainNumber
    );

  if (!live) {
    return null;
  }

  const coordinates =
    getCoordinates(live);

  if (!coordinates) {
    console.warn(
      `⚠️ No coordinates for ${trainNumber}`
    );

    return {
      trainNumber,

      trainName:
        getTrainName(train),

      corridor,

      coordinates:
        null,

      status:
        "NO_POSITION",

      source:
        "RailRadar",
    };
  }

  // ----------------------------------------------------------
  // DISTANCES
  // ----------------------------------------------------------

  const northDistance =
    getDistance(
      coordinates,
      GATES.north
    );

  const chennaiDistance =
    getDistance(
      coordinates,
      GATES.chennai
    );

  const tirupatiDistance =
    getDistance(
      coordinates,
      GATES.tirupati
    );

  // ----------------------------------------------------------
  // SELECT GATE
  // ----------------------------------------------------------

  let gate = null;

  if (
    corridor === "NORTH"
  ) {
    gate =
      GATES.north;
  }

  if (
    corridor === "CHENNAI"
  ) {
    gate =
      GATES.chennai;
  }

  if (
    corridor === "TIRUPATI"
  ) {
    gate =
      GATES.tirupati;
  }

  if (!gate) {
    return {
      trainNumber,

      trainName:
        getTrainName(train),

      corridor,

      coordinates,

      northDistanceKm:
        northDistance,

      chennaiDistanceKm:
        chennaiDistance,

      tirupatiDistanceKm:
        tirupatiDistance,

      status:
        "UNKNOWN",

      source:
        "RailRadar",
    };
  }

  const distance =
    getDistance(
      coordinates,
      gate
    );

  const status =
    calculateStatus(
      distance,
      gate
    );

  console.log(
    `📏 ${trainNumber} → ${gate.name}: ${distance.toFixed(3)} km → ${status.status}`
  );

  return {
    trainNumber,

    trainName:
      getTrainName(train),

    corridor,

    speed:
      getSpeed(live),

    delayMinutes:
      getDelay(train),

    platform:
      getPlatform(train),

    coordinates,

    distanceKm:
      distance,

    northDistanceKm:
      northDistance,

    chennaiDistanceKm:
      chennaiDistance,

    tirupatiDistanceKm:
      tirupatiDistance,

    gateId:
      gate.id,

    gateName:
      gate.name,

    status:
      status.status,

    statusLabel:
      status.label,

    source:
      "RailRadar",

    updatedAt:
      new Date().toISOString(),
  };
}

// ============================================================
// OVERALL DECISION
// ============================================================

function getOverallDecision(
  trains
) {
  if (
    !trains.length
  ) {
    return {
      status:
        "OPEN",

      label:
        "GO",

      reason:
        "No approaching train detected.",

      trainNumber:
        null,

      trainName:
        null,

      corridor:
        null,

      distanceKm:
        null,
    };
  }

  const danger =
    trains.filter(
      (train) =>
        train.status ===
          "CLOSED" ||
        train.status ===
          "WARNING"
    );

  if (
    !danger.length
  ) {
    return {
      status:
        "OPEN",

      label:
        "GO",

      reason:
        "No train inside warning zone.",

      trainNumber:
        null,

      trainName:
        null,

      corridor:
        null,

      distanceKm:
        null,
    };
  }

  const closed =
    danger.filter(
      (train) =>
        train.status ===
        "CLOSED"
    );

  const candidates =
    closed.length
      ? closed
      : danger;

  candidates.sort(
    (a, b) =>
      (a.distanceKm ??
        Infinity) -
      (b.distanceKm ??
        Infinity)
  );

  const train =
    candidates[0];

  if (
    train.status ===
    "CLOSED"
  ) {
    return {
      status:
        "CLOSED",

      label:
        "STOP",

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
    status:
      "WARNING",

    label:
      "WARNING",

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
// GATE SUMMARY
// ============================================================

function createGateSummary(
  trains
) {
  const summary = {
    northGate: {
      status:
        "OPEN",

      trainNumber:
        null,

      distanceKm:
        null,
    },

    chennaiGate: {
      status:
        "OPEN",

      trainNumber:
        null,

      distanceKm:
        null,
    },

    tirupatiGate: {
      status:
        "OPEN",

      trainNumber:
        null,

      distanceKm:
        null,
    },
  };

  for (
    const train of trains
  ) {
    const gateId =
      train?.gateId;

    if (!gateId) {
      continue;
    }

    if (
      !summary[gateId]
    ) {
      continue;
    }

    const existing =
      summary[gateId];

    const distance =
      train.distanceKm;

    if (
      existing.distanceKm ===
        null ||
      (
        distance !== null &&
        distance <
          existing.distanceKm
      )
    ) {
      existing.status =
        train.status;

      existing.trainNumber =
        train.trainNumber;

      existing.distanceKm =
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

  // ==========================================================
  // GET STATION DATA
  // ==========================================================

  const stationData =
    await getStationLive();

  const trains =
    extractArray(
      stationData
    );

  console.log(
    `🚆 RailRadar returned ${trains.length} trains.`
  );

  // ==========================================================
  // UPCOMING
  // ==========================================================

  const upcoming =
    makeUpcomingBoard(
      trains
    );

  console.log(
    `📋 Upcoming board: ${upcoming.length}`
  );

  // ==========================================================
  // ACTIVE PROCESSING
  // ==========================================================

  const activeTrains =
    [];

  const processed =
    new Set();

  const trainsToProcess =
    trains.slice(
      0,
      MAX_TRAINS_TO_PROCESS
    );

  for (
    let i = 0;
    i < trainsToProcess.length;
    i++
  ) {
    const train =
      trainsToProcess[i];

    const trainNumber =
      getTrainNumber(train);

    if (!trainNumber) {
      continue;
    }

    if (
      processed.has(
        trainNumber
      )
    ) {
      continue;
    }

    processed.add(
      trainNumber
    );

    const result =
      await processTrain(
        train
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

    if (
      i <
      trainsToProcess.length - 1
    ) {
      await sleep(
        REQUEST_DELAY_MS
      );
    }
  }

  // ==========================================================
  // DECISION
  // ==========================================================

  const decision =
    getOverallDecision(
      activeTrains
    );

  // ==========================================================
  // GATES
  // ==========================================================

  const gates =
    createGateSummary(
      activeTrains
    );

  // ==========================================================
  // TIMESTAMP
  // ==========================================================

  const generatedAt =
    new Date().toISOString();

  // ==========================================================
  // PAYLOAD
  // ==========================================================

  const payload = {
    version:
      "V8",

    project:
      "GUDUR CROSSING RADAR",

    location: {
      code:
        GUDUR.code,

      name:
        GUDUR.name,

      lat:
        GUDUR.lat,

      lng:
        GUDUR.lng,
    },

    decision,

    activeTrain:
      activeTrains.length
        ? activeTrains[0]
        : null,

    activeTrains,

    gates,

    upcoming,

    stats: {
      stationTrains:
        trains.length,

      upcoming:
        upcoming.length,

      active:
        activeTrains.length,

      processed:
        processed.size,

      generatedAt,
    },

    system: {
      status:
        "ONLINE",

      source:
        "RailRadar",

      api:
        RAILRADAR_BASE,

      firebasePath:
        FIREBASE_PATH,

      updateInterval:
        "5 minutes",

      generatedAt,
    },
  };

  // ==========================================================
  // FIREBASE WRITE
  // ==========================================================

  console.log(
    "🔥 Writing V8 data to Firebase..."
  );

  // IMPORTANT:
  // We intentionally use the Firebase Database object's
  // .ref() method here.
  //
  // No imported ref()
  // No imported set()
  //
  // This avoids the previous:
  // TypeError: ref is not a function

  await database
    .ref(FIREBASE_PATH)
    .set(payload);

  console.log(
    "✅ V8 data written successfully."
  );

  // ==========================================================
  // SUCCESS
  // ==========================================================

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
    "Station trains:",
    trains.length
  );

  console.log(
    "Upcoming:",
    upcoming.length
  );

  console.log(
    "Active:",
    activeTrains.length
  );

  console.log(
    "Firebase path:",
    FIREBASE_PATH
  );

  console.log(
    "Updated:",
    generatedAt
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

    console.error(
      error
    );

    if (
      error?.response
    ) {
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
