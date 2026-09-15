"use strict";

process.env.TZ = "Asia/Kolkata";

const axios = require("axios");
const admin = require("firebase-admin");

/* =========================================================
   GUDUR CROSSING RADAR — V8
   Backend Railway Intelligence
   ========================================================= */

/* -----------------------------
   CONFIG
----------------------------- */

const FIREBASE_DATABASE_URL =
  "https://gudur-gate-tracker-default-rtdb.firebaseio.com";

const FIREBASE_PATH = "gudur_crossing_v8";

const RAILRADAR_BASE_URL = "https://api.railradar.in/v1";

const RAILRADAR_API_KEY = process.env.RAILRADAR_API_KEY;

const FIREBASE_SERVICE_ACCOUNT =
  process.env.FIREBASE_SERVICE_ACCOUNT;

/* -----------------------------
   GUDUR / GATES
----------------------------- */

const GUDUR = {
  lat: 14.14842,
  lng: 79.84524,
};

const GATES = {
  north: {
    id: "north",
    name: "North Gate",
    lat: 14.14842,
    lng: 79.84524,

    warningKm: 5.0,
    closeKm: 0.50,
  },

  chennai: {
    id: "chennai",
    name: "Chennai Gate",
    lat: 14.1396639,
    lng: 79.8441306,

    warningKm: 5.0,
    closeKm: 4.0,
  },

  tirupati: {
    id: "tirupati",
    name: "Tirupati Gate",
    lat: 14.1402056,
    lng: 79.8436000,

    warningKm: 5.0,
    closeKm: 4.0,
  },
};

/* -----------------------------
   GENERAL SETTINGS
----------------------------- */

const BOARD_WINDOW_HOURS = 4;

const MAX_UPCOMING = 10;

const LIVE_LOOKAHEAD_MINUTES = 90;

const MAX_LIVE_REQUESTS = 10;

const MAX_ROUTE_REQUESTS = 10;

const API_TIMEOUT = 20000;


/* =========================================================
   VALIDATION
   ========================================================= */

if (!RAILRADAR_API_KEY) {
  console.error("❌ RAILRADAR_API_KEY is missing.");
  process.exit(1);
}

if (!FIREBASE_SERVICE_ACCOUNT) {
  console.error("❌ FIREBASE_SERVICE_ACCOUNT is missing.");
  process.exit(1);
}


/* =========================================================
   FIREBASE
   ========================================================= */

let serviceAccount;

try {
  serviceAccount = JSON.parse(FIREBASE_SERVICE_ACCOUNT);
} catch (error) {
  console.error("❌ FIREBASE_SERVICE_ACCOUNT is not valid JSON.");
  console.error(error.message);
  process.exit(1);
}

try {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: FIREBASE_DATABASE_URL,
  });

  console.log("✅ Firebase Admin initialized.");
} catch (error) {
  console.error("❌ Firebase initialization failed.");
  console.error(error);
  process.exit(1);
}

const db = admin.database();

const rootRef = db.ref(FIREBASE_PATH);


/* =========================================================
   RAILRADAR API
   ========================================================= */

const api = axios.create({
  baseURL: RAILRADAR_BASE_URL,
  timeout: API_TIMEOUT,

  headers: {
    Authorization: `Bearer ${RAILRADAR_API_KEY}`,
    "x-api-key": RAILRADAR_API_KEY,
    Accept: "application/json",
  },
});


/* =========================================================
   HELPERS
   ========================================================= */

function now() {
  return new Date();
}


function isoNow() {
  return now().toISOString();
}


function safeString(value) {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value).trim();
}


function getTrainNumber(train) {
  return safeString(
    train?.trainNumber ??
    train?.trainNo ??
    train?.number ??
    train?.train?.trainNumber ??
    train?.train?.number
  );
}


function getTrainName(train) {
  return safeString(
    train?.trainName ??
    train?.name ??
    train?.train?.trainName ??
    train?.train?.name
  );
}


function getPlatform(train) {
  return safeString(
    train?.platform ??
    train?.platformNumber ??
    train?.pf ??
    train?.train?.platform
  );
}


function getSpeed(train) {
  const value =
    train?.speed ??
    train?.currentSpeed ??
    train?.live?.speed ??
    train?.train?.speed;

  const n = Number(value);

  return Number.isFinite(n) ? n : 0;
}


function getDelay(train) {
  const value =
    train?.delay ??
    train?.delayMinutes ??
    train?.lateBy ??
    train?.train?.delay;

  const n = Number(value);

  return Number.isFinite(n) ? n : 0;
}


function getLatitude(data) {
  const value =
    data?.latitude ??
    data?.lat ??
    data?.location?.latitude ??
    data?.location?.lat ??
    data?.coordinates?.latitude ??
    data?.train?.latitude ??
    data?.train?.lat;

  const n = Number(value);

  return Number.isFinite(n) ? n : null;
}


function getLongitude(data) {
  const value =
    data?.longitude ??
    data?.lng ??
    data?.lon ??
    data?.location?.longitude ??
    data?.location?.lng ??
    data?.coordinates?.longitude ??
    data?.train?.longitude ??
    data?.train?.lng;

  const n = Number(value);

  return Number.isFinite(n) ? n : null;
}


function getEta(train) {
  return (
    train?.eta ??
    train?.estimatedArrival ??
    train?.arrivalTime ??
    train?.scheduledArrival ??
    train?.train?.eta ??
    null
  );
}


function parseDate(value) {
  if (!value) return null;

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}


/* =========================================================
   DISTANCE
   ========================================================= */

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


/* =========================================================
   TRAIN EXTRACTION
   ========================================================= */

function extractTrainArray(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (!payload || typeof payload !== "object") {
    return [];
  }

  const possibleArrays = [
    payload.trains,
    payload.data,
    payload.results,
    payload.live,
    payload.items,
    payload.data?.trains,
    payload.data?.results,
  ];

  for (const item of possibleArrays) {
    if (Array.isArray(item)) {
      return item;
    }
  }

  return [];
}


/* =========================================================
   ROUTE STOP HELPERS
   ========================================================= */

function normalizeStationCode(stop) {
  if (!stop) return "";

  return safeString(
    stop.code ??
    stop.stationCode ??
    stop.station?.code ??
    stop.station?.stationCode
  ).toUpperCase();
}


function normalizeStationName(stop) {
  if (!stop) return "";

  return safeString(
    stop.name ??
    stop.stationName ??
    stop.station?.name
  ).toUpperCase();
}


function getRouteStops(payload) {
  if (!payload) return [];

  if (Array.isArray(payload)) {
    return payload;
  }

  const possible = [
    payload.stops,
    payload.route,
    payload.data?.stops,
    payload.data?.route,
    payload.train?.stops,
    payload.train?.route,
  ];

  for (const item of possible) {
    if (Array.isArray(item)) {
      return item;
    }
  }

  return [];
}


/* =========================================================
   GUDUR ROUTE ANALYSIS
   =========================================================

   Route geography:

   NORTH:
   Nellore / Vijayawada
          ↓
        Gudur
          ↓
       Chennai

   SOUTH-WEST BRANCH:
   Gudur
      ↓
   Tirupati / Renigunta

   We use route structure rather than train-name text.
========================================================= */

function findGudurIndex(stops) {
  return stops.findIndex((stop) => {
    const code = normalizeStationCode(stop);
    const name = normalizeStationName(stop);

    return (
      code === "GDR" ||
      name.includes("GUDUR")
    );
  });
}


function detectCorridor(stops) {
  if (!Array.isArray(stops) || stops.length === 0) {
    return "UNKNOWN";
  }

  const gudurIndex = findGudurIndex(stops);

  if (gudurIndex < 0) {
    return "UNKNOWN";
  }

  const before = stops
    .slice(0, gudurIndex)
    .map((stop) => ({
      code: normalizeStationCode(stop),
      name: normalizeStationName(stop),
    }));

  const after = stops
    .slice(gudurIndex + 1)
    .map((stop) => ({
      code: normalizeStationCode(stop),
      name: normalizeStationName(stop),
    }));

  const tirupatiCodes = [
    "RU",
    "TPTY",
    "TIRUPATI",
    "RNG",
    "RENIGUNTA",
  ];

  const chennaiCodes = [
    "MAS",
    "MS",
    "PER",
    "MSB",
  ];

  const hasTirupatiAfter =
    after.some(
      (s) =>
        tirupatiCodes.includes(s.code) ||
        s.name.includes("TIRUPATI") ||
        s.name.includes("RENIGUNTA")
    );

  const hasChennaiAfter =
    after.some(
      (s) =>
        chennaiCodes.includes(s.code) ||
        s.name.includes("CHENNAI")
    );

  const hasTirupatiBefore =
    before.some(
      (s) =>
        tirupatiCodes.includes(s.code) ||
        s.name.includes("TIRUPATI") ||
        s.name.includes("RENIGUNTA")
    );

  const hasChennaiBefore =
    before.some(
      (s) =>
        chennaiCodes.includes(s.code) ||
        s.name.includes("CHENNAI")
    );

  if (hasTirupatiAfter) {
    return "TIRUPATI";
  }

  if (hasTirupatiBefore) {
    return "TIRUPATI";
  }

  if (hasChennaiAfter) {
    return "MAS";
  }

  if (hasChennaiBefore) {
    return "MAS";
  }

  return "NORTH";
}


/* =========================================================
   NORTH TERMINATING AT GUDUR
========================================================= */

function isGudurTerminatingNorth(stops) {
  if (!Array.isArray(stops) || stops.length === 0) {
    return false;
  }

  const gudurIndex = findGudurIndex(stops);

  if (gudurIndex < 0) {
    return false;
  }

  return gudurIndex === stops.length - 1;
}


/* =========================================================
   GATE STATUS
========================================================= */

function getGateStatus(distanceKm, gate) {
  if (
    distanceKm === null ||
    distanceKm === undefined ||
    !Number.isFinite(distanceKm)
  ) {
    return "UNKNOWN";
  }

  if (gate.id === "north") {
    if (distanceKm <= gate.closeKm) {
      return "CLOSED";
    }

    if (distanceKm <= gate.warningKm) {
      return "WARNING";
    }

    return "OPEN";
  }

  if (distanceKm <= gate.closeKm) {
    return "CLOSED";
  }

  if (distanceKm <= gate.warningKm) {
    return "WARNING";
  }

  return "OPEN";
}


/* =========================================================
   PRIORITY
========================================================= */

function getPriority(status) {
  if (status === "CLOSED") return "CRITICAL";
  if (status === "WARNING") return "HIGH";
  if (status === "OPEN") return "NORMAL";

  return "UNKNOWN";
}


/* =========================================================
   API FETCH
========================================================= */

async function fetchStationLive() {
  console.log("📡 Fetching Gudur live trains...");

  const response = await api.get("/stations/GDR/live");

  return response.data;
}


async function fetchTrainLive(trainNumber) {
  try {
    const response = await api.get(
      `/trains/${encodeURIComponent(trainNumber)}/live`,
      {
        params: {
          authoritative: "true",
          includeCoordinates: "true",
        },
      }
    );

    return response.data;
  } catch (error) {
    console.error(
      `⚠️ Live API failed for ${trainNumber}:`,
      error.response?.status || error.message
    );

    return null;
  }
}


async function fetchTrainRoute(trainNumber) {
  try {
    const response = await api.get(
      `/trains/${encodeURIComponent(trainNumber)}/route`,
      {
        params: {
          format: "geojson",
          stops: "true",
        },
      }
    );

    return response.data;
  } catch (error) {
    console.error(
      `⚠️ Route API failed for ${trainNumber}:`,
      error.response?.status || error.message
    );

    return null;
  }
}


/* =========================================================
   UPCOMING TRAIN
========================================================= */

function buildUpcoming(rawTrains) {
  const cutoff =
    new Date().getTime() +
    BOARD_WINDOW_HOURS * 60 * 60 * 1000;

  const result = [];

  const seen = new Set();

  for (const train of rawTrains) {
    const number = getTrainNumber(train);

    if (!number) {
      continue;
    }

    if (seen.has(number)) {
      continue;
    }

    const etaValue = getEta(train);

    const etaDate = parseDate(etaValue);

    if (etaDate) {
      if (etaDate.getTime() < Date.now()) {
        continue;
      }

      if (etaDate.getTime() > cutoff) {
        continue;
      }
    }

    seen.add(number);

    result.push({
      trainNumber: number,
      trainName: getTrainName(train),

      eta: etaValue,

      delayMinutes: getDelay(train),

      platform: getPlatform(train),

      source: "RailRadar",
    });

    if (result.length >= MAX_UPCOMING) {
      break;
    }
  }

  return result;
}


/* =========================================================
   TRAIN PROCESSING
========================================================= */

async function processTrain(train, routeRequests, liveRequests) {
  const trainNumber = getTrainNumber(train);

  if (!trainNumber) {
    return null;
  }

  if (routeRequests.count >= MAX_ROUTE_REQUESTS) {
    return null;
  }

  routeRequests.count++;

  const routePayload =
    await fetchTrainRoute(trainNumber);

  const stops =
    getRouteStops(routePayload);

  if (!stops.length) {
    return null;
  }

  const terminatingNorth =
    isGudurTerminatingNorth(stops);

  const corridor =
    detectCorridor(stops);

  /*
    North-side train terminating at Gudur
    should NOT be treated as an approaching
    crossing train.
  */

  if (
    terminatingNorth &&
    corridor === "NORTH"
  ) {
    return null;
  }

  if (liveRequests.count >= MAX_LIVE_REQUESTS) {
    return null;
  }

  liveRequests.count++;

  const livePayload =
    await fetchTrainLive(trainNumber);

  if (!livePayload) {
    return null;
  }

  const liveObject =
    livePayload?.data ??
    livePayload?.train ??
    livePayload;

  const lat =
    getLatitude(liveObject);

  const lng =
    getLongitude(liveObject);

  if (
    lat === null ||
    lng === null
  ) {
    return null;
  }

  const distanceToGudur =
    haversineKm(
      lat,
      lng,
      GUDUR.lat,
      GUDUR.lng
    );

  let gate;

  /*
    NORTH
    → North gate

    MAS / Chennai
    → Chennai gate

    TIRUPATI
    → Tirupati gate
  */

  if (corridor === "NORTH") {
    gate = GATES.north;
  } else if (corridor === "TIRUPATI") {
    gate = GATES.tirupati;
  } else {
    gate = GATES.chennai;
  }

  const distanceToGate =
    haversineKm(
      lat,
      lng,
      gate.lat,
      gate.lng
    );

  const status =
    getGateStatus(
      distanceToGate,
      gate
    );

  const priority =
    getPriority(status);

  return {
    trainNumber,

    trainName: getTrainName(train),

    corridor,

    gateId: gate.id,

    gateName: gate.name,

    latitude: lat,

    longitude: lng,

    speedKmph: getSpeed(liveObject),

    distanceToGudurKm:
      Number(distanceToGudur.toFixed(3)),

    distanceToGateKm:
      Number(distanceToGate.toFixed(3)),

    distanceToGateMeters:
      Math.round(distanceToGate * 1000),

    status,

    priority,

    eta: getEta(liveObject) ?? getEta(train),

    delayMinutes:
      getDelay(liveObject) ||
      getDelay(train),

    platform:
      getPlatform(liveObject) ||
      getPlatform(train),

    lastStation:
      safeString(
        liveObject?.lastStation ??
        liveObject?.currentStation ??
        liveObject?.station
      ),

    source: "RailRadar",

    updatedAt: isoNow(),
  };
}


/* =========================================================
   FIND ACTIVE TRAIN
========================================================= */

function chooseActiveTrain(trains) {
  const active = trains.filter(
    (train) =>
      train.status === "CLOSED" ||
      train.status === "WARNING"
  );

  if (!active.length) {
    return null;
  }

  active.sort(
    (a, b) =>
      a.distanceToGateKm -
      b.distanceToGateKm
  );

  return active[0];
}


/* =========================================================
   GATE OBJECT
========================================================= */

function emptyGate(gate) {
  return {
    id: gate.id,

    name: gate.name,

    status: "OPEN",

    trainNumber: null,

    trainName: null,

    corridor: null,

    distanceKm: null,

    distanceMeters: null,

    speedKmph: null,

    eta: null,

    priority: "NORMAL",

    updatedAt: isoNow(),
  };
}


function buildGateData(processedTrains) {
  const result = {
    north: emptyGate(GATES.north),
    chennai: emptyGate(GATES.chennai),
    tirupati: emptyGate(GATES.tirupati),
  };

  for (const train of processedTrains) {
    const gateId = train.gateId;

    if (!result[gateId]) {
      continue;
    }

    const current =
      result[gateId];

    /*
      Only replace if this train is
      closer to the gate.
    */

    if (
      current.distanceKm === null ||
      train.distanceToGateKm <
        current.distanceKm
    ) {
      result[gateId] = {
        id: gateId,

        name: train.gateName,

        status: train.status,

        trainNumber:
          train.trainNumber,

        trainName:
          train.trainName,

        corridor:
          train.corridor,

        distanceKm:
          train.distanceToGateKm,

        distanceMeters:
          train.distanceToGateMeters,

        speedKmph:
          train.speedKmph,

        eta:
          train.eta,

        priority:
          train.priority,

        updatedAt:
          train.updatedAt,
      };
    }
  }

  return result;
}


/* =========================================================
   DECISION
========================================================= */

function getOverallDecision(gates) {
  const statuses = Object.values(gates)
    .map((gate) => gate.status);

  if (statuses.includes("CLOSED")) {
    return "STOP";
  }

  if (statuses.includes("WARNING")) {
    return "WARNING";
  }

  return "GO";
}


/* =========================================================
   MAIN UPDATE
========================================================= */

async function main() {
  const startedAt =
    Date.now();

  console.log("");
  console.log(
    "================================================"
  );
  console.log(
    " GUDUR CROSSING RADAR — V8"
  );
  console.log(
    " Railway Crossing Intelligence"
  );
  console.log(
    "================================================"
  );

  console.log(
    `🕐 Time: ${new Date().toString()}`
  );

  console.log(
    `📍 Gudur: ${GUDUR.lat}, ${GUDUR.lng}`
  );

  console.log(
    `🔥 Firebase path: ${FIREBASE_PATH}`
  );

  /* -----------------------------
     1. Station live data
  ----------------------------- */

  const stationPayload =
    await fetchStationLive();

  const rawTrains =
    extractTrainArray(
      stationPayload
    );

  console.log(
    `🚆 RailRadar trains received: ${rawTrains.length}`
  );


  /* -----------------------------
     2. Upcoming board
  ----------------------------- */

  const upcoming =
    buildUpcoming(rawTrains);

  console.log(
    `📋 Upcoming trains: ${upcoming.length}`
  );


  /* -----------------------------
     3. Process live candidates
  ----------------------------- */

  const processedTrains = [];

  const routeRequests = {
    count: 0,
  };

  const liveRequests = {
    count: 0,
  };

  /*
    Only process a limited number of
    trains to avoid excessive API usage.
  */

  const candidates =
    rawTrains.slice(
      0,
      MAX_LIVE_REQUESTS
    );

  for (const train of candidates) {
    try {
      const processed =
        await processTrain(
          train,
          routeRequests,
          liveRequests
        );

      if (processed) {
        processedTrains.push(
          processed
        );
      }
    } catch (error) {
      console.error(
        `⚠️ Train processing failed for ${getTrainNumber(train)}`
      );

      console.error(
        error.message
      );
    }
  }


  /* -----------------------------
     4. Gate intelligence
  ----------------------------- */

  const gates =
    buildGateData(
      processedTrains
    );


  /* -----------------------------
     5. Overall decision
  ----------------------------- */

  const decision =
    getOverallDecision(gates);

  const activeTrain =
    chooseActiveTrain(
      processedTrains
    );


  /* -----------------------------
     6. Statistics
  ----------------------------- */

  const closedCount =
    processedTrains.filter(
      (t) => t.status === "CLOSED"
    ).length;

  const warningCount =
    processedTrains.filter(
      (t) => t.status === "WARNING"
    ).length;


  /* -----------------------------
     7. Firebase payload
  ----------------------------- */

  const payload = {
    version: "V8",

    project:
      "GUDUR CROSSING RADAR",

    generatedAt:
      isoNow(),

    timezone:
      "Asia/Kolkata",

    source:
      "RailRadar",

    decision,

    decisionText:
      decision === "STOP"
        ? "STOP — TRAIN APPROACHING"
        : decision === "WARNING"
        ? "WARNING — TRAIN NEAR CROSSING"
        : "GO — CROSSING CLEAR",

    activeTrain,

    gates,

    upcoming,

    processedTrains,

    stats: {
      boardTrains:
        upcoming.length,

      liveTrains:
        processedTrains.length,

      closed:
        closedCount,

      warning:
        warningCount,

      routeRequests:
        routeRequests.count,

      liveRequests:
        liveRequests.count,

      processingMs:
        Date.now() -
        startedAt,
    },

    system: {
      status: "ONLINE",

      firebase:
        "CONNECTED",

      railRadar:
        "CONNECTED",

      lastUpdate:
        isoNow(),
    },

    safety: {
      northGateCloseKm:
        GATES.north.closeKm,

      chennaiGateWarningKm:
        GATES.chennai.warningKm,

      chennaiGateCloseKm:
        GATES.chennai.closeKm,

      tirupatiGateWarningKm:
        GATES.tirupati.warningKm,

      tirupatiGateCloseKm:
        GATES.tirupati.closeKm,
    },
  };


  /* -----------------------------
     8. Write Firebase
  ----------------------------- */

  await rootRef.set(
    payload
  );


  /* -----------------------------
     9. Console summary
  ----------------------------- */

  console.log("");
  console.log(
    "---------------- V8 RESULT ----------------"
  );

  console.log(
    `Decision: ${decision}`
  );

  console.log(
    `Upcoming: ${upcoming.length}`
  );

  console.log(
    `Processed live: ${processedTrains.length}`
  );

  console.log(
    `WARNING: ${warningCount}`
  );

  console.log(
    `CLOSED: ${closedCount}`
  );

  if (activeTrain) {
    console.log(
      `🚨 Active: ${activeTrain.trainNumber}`
    );

    console.log(
      `📍 Distance: ${activeTrain.distanceToGateKm} km`
    );

    console.log(
      `🚦 Gate: ${activeTrain.gateName}`
    );

    console.log(
      `🧭 Corridor: ${activeTrain.corridor}`
    );
  } else {
    console.log(
      "✅ No active approaching train."
    );
  }

  console.log(
    "--------------------------------------------"
  );

  console.log(
    `🔥 Firebase updated: ${FIREBASE_PATH}`
  );

  console.log(
    `⏱ Processing time: ${Date.now() - startedAt} ms`
  );

  console.log(
    "================================================"
  );
}


/* =========================================================
   RUN
========================================================= */

main()
  .then(() => {
    console.log(
      "✅ GUDUR CROSSING RADAR V8 UPDATE COMPLETE"
    );

    process.exit(0);
  })
  .catch((error) => {
    console.error("");
    console.error(
      "❌ GUDUR CROSSING RADAR V8 UPDATE FAILED"
    );

    if (error.response) {
      console.error(
        "HTTP Status:",
        error.response.status
      );

      console.error(
        "API Response:",
        JSON.stringify(
          error.response.data,
          null,
          2
        )
      );
    } else {
      console.error(
        error.stack || error.message
      );
    }

    process.exit(1);
  });
