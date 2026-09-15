"use strict";

process.env.TZ = "Asia/Kolkata";

const axios = require("axios");

const { initializeApp, cert } = require("firebase-admin/app");
const {
  getDatabase,
  ref,
  set,
} = require("firebase-admin/database");


/* =========================================================
   GUDUR CROSSING RADAR V8
   BACKEND
   ========================================================= */


/* =========================================================
   CONFIGURATION
   ========================================================= */

const FIREBASE_DATABASE_URL =
  "https://gudur-gate-tracker-default-rtdb.firebaseio.com";

const FIREBASE_PATH =
  "gudur_crossing_v8";

const RAILRADAR_BASE_URL =
  "https://api.railradar.in/v1";

const RAILRADAR_API_KEY =
  process.env.RAILRADAR_API_KEY;

const FIREBASE_SERVICE_ACCOUNT =
  process.env.FIREBASE_SERVICE_ACCOUNT;


/* =========================================================
   GUDUR LOCATION
   ========================================================= */

const GUDUR = {
  lat: 14.14842,
  lng: 79.84524,
};


/* =========================================================
   GATE LOCATIONS
   ========================================================= */

const GATES = {

  north: {
    id: "north",
    name: "North Gate",

    lat: 14.14842,
    lng: 79.84524,

    warningKm: 5.00,
    closeKm: 0.50,
  },

  chennai: {
    id: "chennai",
    name: "Chennai Gate",

    lat: 14.1396639,
    lng: 79.8441306,

    warningKm: 5.00,
    closeKm: 4.00,
  },

  tirupati: {
    id: "tirupati",
    name: "Tirupati Gate",

    lat: 14.1402056,
    lng: 79.8436000,

    warningKm: 5.00,
    closeKm: 4.00,
  },

};


/* =========================================================
   SETTINGS
   ========================================================= */

const BOARD_WINDOW_HOURS = 4;

const MAX_UPCOMING = 10;

const MAX_LIVE_REQUESTS = 10;

const MAX_ROUTE_REQUESTS = 10;

const API_TIMEOUT = 20000;


/* =========================================================
   ENVIRONMENT CHECK
   ========================================================= */

console.log("");
console.log("==============================================");
console.log(" GUDUR CROSSING RADAR V8");
console.log(" BACKEND STARTING");
console.log("==============================================");

console.log(
  "Node version:",
  process.version
);

console.log(
  "Firebase path:",
  FIREBASE_PATH
);

console.log(
  "RailRadar API:",
  RAILRADAR_BASE_URL
);


if (!RAILRADAR_API_KEY) {

  console.error(
    "❌ RAILRADAR_API_KEY secret is missing."
  );

  process.exit(1);
}


if (!FIREBASE_SERVICE_ACCOUNT) {

  console.error(
    "❌ FIREBASE_SERVICE_ACCOUNT secret is missing."
  );

  process.exit(1);
}


/* =========================================================
   FIREBASE SERVICE ACCOUNT
   ========================================================= */

let serviceAccount;

try {

  serviceAccount =
    JSON.parse(
      FIREBASE_SERVICE_ACCOUNT
    );

} catch (error) {

  console.error(
    "❌ FIREBASE_SERVICE_ACCOUNT is not valid JSON."
  );

  console.error(
    error.message
  );

  process.exit(1);
}


/* =========================================================
   FIREBASE INITIALIZATION
   ========================================================= */

let firebaseApp;
let database;

try {

  firebaseApp =
    initializeApp({

      credential:
        cert(serviceAccount),

      databaseURL:
        FIREBASE_DATABASE_URL,

    });


  database =
    getDatabase(
      firebaseApp
    );


  console.log(
    "✅ Firebase initialized successfully."
  );

} catch (error) {

  console.error(
    "❌ Firebase initialization failed."
  );

  console.error(
    error.stack ||
    error.message
  );

  process.exit(1);
}


/* =========================================================
   RAILRADAR CLIENT
   ========================================================= */

const api =
  axios.create({

    baseURL:
      RAILRADAR_BASE_URL,

    timeout:
      API_TIMEOUT,

    headers: {

      Authorization:
        `Bearer ${RAILRADAR_API_KEY}`,

      "x-api-key":
        RAILRADAR_API_KEY,

      Accept:
        "application/json",

    },

  });


/* =========================================================
   STRING HELPER
   ========================================================= */

function safeString(value) {

  if (
    value === undefined ||
    value === null
  ) {

    return "";

  }

  return String(value).trim();

}


/* =========================================================
   TRAIN NUMBER
   ========================================================= */

function getTrainNumber(train) {

  return safeString(

    train?.trainNumber ??
    train?.trainNo ??
    train?.number ??
    train?.train?.trainNumber ??
    train?.train?.trainNo ??
    train?.train?.number

  );

}


/* =========================================================
   TRAIN NAME
   ========================================================= */

function getTrainName(train) {

  return safeString(

    train?.trainName ??
    train?.name ??
    train?.train?.trainName ??
    train?.train?.name

  );

}


/* =========================================================
   PLATFORM
   ========================================================= */

function getPlatform(train) {

  return safeString(

    train?.platform ??
    train?.platformNumber ??
    train?.pf ??
    train?.train?.platform

  );

}


/* =========================================================
   SPEED
   ========================================================= */

function getSpeed(train) {

  const value =

    train?.speed ??
    train?.currentSpeed ??
    train?.live?.speed ??
    train?.train?.speed;

  const number =
    Number(value);

  if (
    Number.isFinite(number)
  ) {

    return number;

  }

  return 0;

}


/* =========================================================
   DELAY
   ========================================================= */

function getDelay(train) {

  const value =

    train?.delay ??
    train?.delayMinutes ??
    train?.lateBy ??
    train?.train?.delay;

  const number =
    Number(value);

  if (
    Number.isFinite(number)
  ) {

    return number;

  }

  return 0;

}


/* =========================================================
   ETA
   ========================================================= */

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


/* =========================================================
   LATITUDE
   ========================================================= */

function getLatitude(data) {

  const value =

    data?.latitude ??
    data?.lat ??
    data?.location?.latitude ??
    data?.location?.lat ??
    data?.coordinates?.latitude ??
    data?.coordinates?.[1] ??
    data?.train?.latitude ??
    data?.train?.lat;

  const number =
    Number(value);

  if (
    Number.isFinite(number)
  ) {

    return number;

  }

  return null;

}


/* =========================================================
   LONGITUDE
   ========================================================= */

function getLongitude(data) {

  const value =

    data?.longitude ??
    data?.lng ??
    data?.lon ??
    data?.location?.longitude ??
    data?.location?.lng ??
    data?.coordinates?.longitude ??
    data?.coordinates?.[0] ??
    data?.train?.longitude ??
    data?.train?.lng;

  const number =
    Number(value);

  if (
    Number.isFinite(number)
  ) {

    return number;

  }

  return null;

}


/* =========================================================
   DATE
   ========================================================= */

function parseDate(value) {

  if (!value) {

    return null;

  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {

    return null;

  }

  return date;

}


/* =========================================================
   TIME
   ========================================================= */

function isoNow() {

  return new Date().toISOString();

}


/* =========================================================
   HAVERSINE DISTANCE
   ========================================================= */

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

    Math.sin(
      dLat / 2
    ) ** 2 +

    Math.cos(
      lat1 *
      Math.PI /
      180
    ) *

    Math.cos(
      lat2 *
      Math.PI /
      180
    ) *

    Math.sin(
      dLon / 2
    ) ** 2;

  const c =
    2 *
    Math.atan2(
      Math.sqrt(a),
      Math.sqrt(1 - a)
    );

  return R * c;

}


/* =========================================================
   EXTRACT TRAIN ARRAY
   ========================================================= */

function extractTrainArray(payload) {

  if (
    Array.isArray(payload)
  ) {

    return payload;

  }


  if (
    !payload ||
    typeof payload !== "object"
  ) {

    return [];

  }


  const candidates = [

    payload.trains,

    payload.data,

    payload.results,

    payload.live,

    payload.items,

    payload.data?.trains,

    payload.data?.results,

  ];


  for (
    const candidate
    of candidates
  ) {

    if (
      Array.isArray(candidate)
    ) {

      return candidate;

    }

  }


  return [];

}


/* =========================================================
   ROUTE STOP CODE
   ========================================================= */

function getStationCode(stop) {

  if (!stop) {

    return "";

  }

  return safeString(

    stop.code ??
    stop.stationCode ??
    stop.station?.code ??
    stop.station?.stationCode

  ).toUpperCase();

}


/* =========================================================
   ROUTE STOP NAME
   ========================================================= */

function getStationName(stop) {

  if (!stop) {

    return "";

  }

  return safeString(

    stop.name ??
    stop.stationName ??
    stop.station?.name

  ).toUpperCase();

}


/* =========================================================
   ROUTE STOP ARRAY
   ========================================================= */

function getRouteStops(payload) {

  if (!payload) {

    return [];

  }


  if (
    Array.isArray(payload)
  ) {

    return payload;

  }


  const candidates = [

    payload.stops,

    payload.route,

    payload.data?.stops,

    payload.data?.route,

    payload.train?.stops,

    payload.train?.route,

  ];


  for (
    const candidate
    of candidates
  ) {

    if (
      Array.isArray(candidate)
    ) {

      return candidate;

    }

  }


  return [];

}


/* =========================================================
   FIND GUDUR
   ========================================================= */

function findGudurIndex(stops) {

  return stops.findIndex(
    (stop) => {

      const code =
        getStationCode(
          stop
        );

      const name =
        getStationName(
          stop
        );


      return (

        code === "GDR" ||

        name.includes(
          "GUDUR"
        )

      );

    }
  );

}


/* =========================================================
   CORRIDOR DETECTION
   ========================================================= */

function detectCorridor(stops) {

  if (
    !Array.isArray(stops) ||
    !stops.length
  ) {

    return "UNKNOWN";

  }


  const gudurIndex =
    findGudurIndex(
      stops
    );


  if (
    gudurIndex < 0
  ) {

    return "UNKNOWN";

  }


  const before =
    stops.slice(
      0,
      gudurIndex
    );


  const after =
    stops.slice(
      gudurIndex + 1
    );


  const tirupatiCodes = [

    "RU",
    "TPTY",
    "RNG",

  ];


  const chennaiCodes = [

    "MAS",
    "MS",
    "MSB",
    "PER",

  ];


  const hasTirupatiBefore =
    before.some(
      (stop) => {

        const code =
          getStationCode(
            stop
          );

        const name =
          getStationName(
            stop
          );

        return (

          tirupatiCodes.includes(
            code
          ) ||

          name.includes(
            "TIRUPATI"
          ) ||

          name.includes(
            "RENIGUNTA"
          )

        );

      }
    );


  const hasTirupatiAfter =
    after.some(
      (stop) => {

        const code =
          getStationCode(
            stop
          );

        const name =
          getStationName(
            stop
          );

        return (

          tirupatiCodes.includes(
            code
          ) ||

          name.includes(
            "TIRUPATI"
          ) ||

          name.includes(
            "RENIGUNTA"
          )

        );

      }
    );


  const hasChennaiBefore =
    before.some(
      (stop) => {

        const code =
          getStationCode(
            stop
          );

        const name =
          getStationName(
            stop
          );

        return (

          chennaiCodes.includes(
            code
          ) ||

          name.includes(
            "CHENNAI"
          )

        );

      }
    );


  const hasChennaiAfter =
    after.some(
      (stop) => {

        const code =
          getStationCode(
            stop
          );

        const name =
          getStationName(
            stop
          );

        return (

          chennaiCodes.includes(
            code
          ) ||

          name.includes(
            "CHENNAI"
          )

        );

      }
    );


  if (
    hasTirupatiBefore ||
    hasTirupatiAfter
  ) {

    return "TIRUPATI";

  }


  if (
    hasChennaiBefore ||
    hasChennaiAfter
  ) {

    return "MAS";

  }


  return "NORTH";

}


/* =========================================================
   GUDUR TERMINATING TRAIN
   ========================================================= */

function isGudurTerminating(
  stops
) {

  if (
    !Array.isArray(stops) ||
    !stops.length
  ) {

    return false;

  }


  const gudurIndex =
    findGudurIndex(
      stops
    );


  if (
    gudurIndex < 0
  ) {

    return false;

  }


  return (
    gudurIndex ===
    stops.length - 1
  );

}


/* =========================================================
   GATE STATUS
   ========================================================= */

function getGateStatus(
  distanceKm,
  gate
) {

  if (
    distanceKm === null ||
    !Number.isFinite(distanceKm)
  ) {

    return "UNKNOWN";

  }


  /*
    NORTH GATE

    > 5 km       OPEN
    0.50 - 5 km  WARNING
    <= 0.50 km   CLOSED
  */

  if (
    gate.id === "north"
  ) {

    if (
      distanceKm <=
      gate.closeKm
    ) {

      return "CLOSED";

    }


    if (
      distanceKm <=
      gate.warningKm
    ) {

      return "WARNING";

    }


    return "OPEN";

  }


  /*
    CHENNAI / TIRUPATI

    > 5 km       OPEN
    4 - 5 km     WARNING
    <= 4 km      CLOSED
  */

  if (
    distanceKm <=
    gate.closeKm
  ) {

    return "CLOSED";

  }


  if (
    distanceKm <=
    gate.warningKm
  ) {

    return "WARNING";

  }


  return "OPEN";

}


/* =========================================================
   PRIORITY
   ========================================================= */

function getPriority(status) {

  if (
    status === "CLOSED"
  ) {

    return "CRITICAL";

  }


  if (
    status === "WARNING"
  ) {

    return "HIGH";

  }


  if (
    status === "OPEN"
  ) {

    return "NORMAL";

  }


  return "UNKNOWN";

}


/* =========================================================
   RAILRADAR — STATION LIVE
   ========================================================= */

async function fetchStationLive() {

  console.log(
    "📡 Requesting /stations/GDR/live ..."
  );


  const response =
    await api.get(
      "/stations/GDR/live"
    );


  console.log(
    "✅ Station live response received."
  );


  return response.data;

}


/* =========================================================
   RAILRADAR — TRAIN LIVE
   ========================================================= */

async function fetchTrainLive(
  trainNumber
) {

  try {

    const response =
      await api.get(

        `/trains/${encodeURIComponent(
          trainNumber
        )}/live`,

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

    console.error(

      `⚠️ Live failed ${trainNumber}:`,

      error.response?.status ||
      error.message

    );

    return null;

  }

}


/* =========================================================
   RAILRADAR — TRAIN ROUTE
   ========================================================= */

async function fetchTrainRoute(
  trainNumber
) {

  try {

    const response =
      await api.get(

        `/trains/${encodeURIComponent(
          trainNumber
        )}/route`,

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

    console.error(

      `⚠️ Route failed ${trainNumber}:`,

      error.response?.status ||
      error.message

    );

    return null;

  }

}


/* =========================================================
   UPCOMING BOARD
   ========================================================= */

function buildUpcoming(
  rawTrains
) {

  const result = [];

  const seen =
    new Set();


  const cutoff =
    Date.now() +
    BOARD_WINDOW_HOURS *
    60 *
    60 *
    1000;


  for (
    const train
    of rawTrains
  ) {

    const trainNumber =
      getTrainNumber(
        train
      );


    if (!trainNumber) {

      continue;

    }


    if (
      seen.has(
        trainNumber
      )
    ) {

      continue;

    }


    const eta =
      getEta(
        train
      );


    const etaDate =
      parseDate(
        eta
      );


    if (etaDate) {

      if (
        etaDate.getTime() <
        Date.now()
      ) {

        continue;

      }


      if (
        etaDate.getTime() >
        cutoff
      ) {

        continue;

      }

    }


    seen.add(
      trainNumber
    );


    result.push({

      trainNumber,

      trainName:
        getTrainName(
          train
        ),

      eta,

      delayMinutes:
        getDelay(
          train
        ),

      platform:
        getPlatform(
          train
        ),

      source:
        "RailRadar",

    });


    if (
      result.length >=
      MAX_UPCOMING
    ) {

      break;

    }

  }


  return result;

}


/* =========================================================
   PROCESS ONE TRAIN
   ========================================================= */

async function processTrain(
  train,
  counters
) {

  const trainNumber =
    getTrainNumber(
      train
    );


  if (!trainNumber) {

    return null;

  }


  if (
    counters.route >=
    MAX_ROUTE_REQUESTS
  ) {

    return null;

  }


  counters.route++;


  console.log(
    `🧭 Route: ${trainNumber}`
  );


  const routePayload =
    await fetchTrainRoute(
      trainNumber
    );


  const stops =
    getRouteStops(
      routePayload
    );


  if (!stops.length) {

    return null;

  }


  const corridor =
    detectCorridor(
      stops
    );


  /*
    Do not show a train that ends
    at Gudur as an approaching
    north-side train.
  */

  if (
    corridor === "NORTH" &&
    isGudurTerminating(
      stops
    )
  ) {

    console.log(
      `ℹ️ ${trainNumber} terminates at Gudur — skipped.`
    );

    return null;

  }


  if (
    counters.live >=
    MAX_LIVE_REQUESTS
  ) {

    return null;

  }


  counters.live++;


  console.log(
    `📍 Live: ${trainNumber}`
  );


  const livePayload =
    await fetchTrainLive(
      trainNumber
    );


  if (!livePayload) {

    return null;

  }


  const liveObject =

    livePayload?.data ??
    livePayload?.train ??
    livePayload;


  const latitude =
    getLatitude(
      liveObject
    );


  const longitude =
    getLongitude(
      liveObject
    );


  if (
    latitude === null ||
    longitude === null
  ) {

    console.log(
      `⚠️ No coordinates for ${trainNumber}`
    );

    return null;

  }


  let gate;


  if (
    corridor === "NORTH"
  ) {

    gate =
      GATES.north;

  } else if (
    corridor === "TIRUPATI"
  ) {

    gate =
      GATES.tirupati;

  } else {

    gate =
      GATES.chennai;

  }


  const distanceToGudur =
    haversineKm(

      latitude,
      longitude,

      GUDUR.lat,
      GUDUR.lng

    );


  const distanceToGate =
    haversineKm(

      latitude,
      longitude,

      gate.lat,
      gate.lng

    );


  const status =
    getGateStatus(

      distanceToGate,
      gate

    );


  const processed = {

    trainNumber,

    trainName:
      getTrainName(
        train
      ),

    corridor,

    gateId:
      gate.id,

    gateName:
      gate.name,

    latitude,

    longitude,

    speedKmph:
      getSpeed(
        liveObject
      ),

    distanceToGudurKm:
      Number(
        distanceToGudur.toFixed(
          3
        )
      ),

    distanceToGateKm:
      Number(
        distanceToGate.toFixed(
          3
        )
      ),

    distanceToGateMeters:
      Math.round(
        distanceToGate *
        1000
      ),

    status,

    priority:
      getPriority(
        status
      ),

    eta:
      getEta(
        liveObject
      ) ??
      getEta(
        train
      ),

    delayMinutes:
      getDelay(
        liveObject
      ) ||
      getDelay(
        train
      ),

    platform:
      getPlatform(
        liveObject
      ) ||
      getPlatform(
        train
      ),

    lastStation:
      safeString(

        liveObject?.lastStation ??
        liveObject?.currentStation ??
        liveObject?.station

      ),

    source:
      "RailRadar",

    updatedAt:
      isoNow(),

  };


  console.log(

    `🚦 ${trainNumber} | ${corridor} | ${gate.name} | ${status} | ${distanceToGate.toFixed(2)} km`

  );


  return processed;

}


/* =========================================================
   ACTIVE TRAIN
   ========================================================= */

function chooseActiveTrain(
  trains
) {

  const active =
    trains.filter(
      (train) =>

        train.status ===
          "CLOSED" ||

        train.status ===
          "WARNING"

    );


  if (
    !active.length
  ) {

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
   EMPTY GATE
   ========================================================= */

function emptyGate(
  gate
) {

  return {

    id:
      gate.id,

    name:
      gate.name,

    status:
      "OPEN",

    trainNumber:
      null,

    trainName:
      null,

    corridor:
      null,

    distanceKm:
      null,

    distanceMeters:
      null,

    speedKmph:
      null,

    eta:
      null,

    priority:
      "NORMAL",

    updatedAt:
      isoNow(),

  };

}


/* =========================================================
   BUILD GATE DATA
   ========================================================= */

function buildGateData(
  trains
) {

  const gates = {

    north:
      emptyGate(
        GATES.north
      ),

    chennai:
      emptyGate(
        GATES.chennai
      ),

    tirupati:
      emptyGate(
        GATES.tirupati
      ),

  };


  for (
    const train
    of trains
  ) {

    const gateId =
      train.gateId;


    if (
      !gates[gateId]
    ) {

      continue;

    }


    const existing =
      gates[gateId];


    if (

      existing.distanceKm ===
        null ||

      train.distanceToGateKm <
        existing.distanceKm

    ) {

      gates[gateId] = {

        id:
          gateId,

        name:
          train.gateName,

        status:
          train.status,

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


  return gates;

}


/* =========================================================
   OVERALL DECISION
   ========================================================= */

function getOverallDecision(
  gates
) {

  const statuses =
    Object.values(
      gates
    ).map(
      (gate) =>
        gate.status
    );


  if (
    statuses.includes(
      "CLOSED"
    )
  ) {

    return "STOP";

  }


  if (
    statuses.includes(
      "WARNING"
    )
  ) {

    return "WARNING";

  }


  return "GO";

}


/* =========================================================
   MAIN
   ========================================================= */

async function main() {

  const startedAt =
    Date.now();


  console.log("");
  console.log(
    "🚀 Starting V8 intelligence cycle..."
  );


  /* -----------------------------------------
     STATION LIVE
  ----------------------------------------- */

  const stationPayload =
    await fetchStationLive();


  const rawTrains =
    extractTrainArray(
      stationPayload
    );


  console.log(
    `🚆 RailRadar returned ${rawTrains.length} trains.`
  );


  /* -----------------------------------------
     UPCOMING
  ----------------------------------------- */

  const upcoming =
    buildUpcoming(
      rawTrains
    );


  console.log(
    `📋 Upcoming board: ${upcoming.length}`
  );


  /* -----------------------------------------
     LIVE PROCESSING
  ----------------------------------------- */

  const processedTrains = [];


  const counters = {

    route: 0,

    live: 0,

  };


  const candidates =
    rawTrains.slice(
      0,
      MAX_LIVE_REQUESTS
    );


  for (
    const train
    of candidates
  ) {

    try {

      const result =
        await processTrain(
          train,
          counters
        );


      if (result) {

        processedTrains.push(
          result
        );

      }

    } catch (error) {

      console.error(
        `⚠️ Train processing error: ${getTrainNumber(train)}`
      );

      console.error(
        error.message
      );

    }

  }


  /* -----------------------------------------
     GATES
  ----------------------------------------- */

  const gates =
    buildGateData(
      processedTrains
    );


  /* -----------------------------------------
     DECISION
  ----------------------------------------- */

  const decision =
    getOverallDecision(
      gates
    );


  const activeTrain =
    chooseActiveTrain(
      processedTrains
    );


  /* -----------------------------------------
     COUNTS
  ----------------------------------------- */

  const closedCount =
    processedTrains.filter(
      (train) =>
        train.status ===
        "CLOSED"
    ).length;


  const warningCount =
    processedTrains.filter(
      (train) =>
        train.status ===
        "WARNING"
    ).length;


  /* -----------------------------------------
     FIREBASE PAYLOAD
  ----------------------------------------- */

  const payload = {

    version:
      "V8",

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
        counters.route,

      liveRequests:
        counters.live,

      processingMs:
        Date.now() -
        startedAt,

    },


    system: {

      status:
        "ONLINE",

      firebase:
        "CONNECTED",

      railRadar:
        "CONNECTED",

      lastUpdate:
        isoNow(),

    },


    safety: {

      northGateWarningKm:
        GATES.north.warningKm,

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


  /* -----------------------------------------
     FIREBASE WRITE
  ----------------------------------------- */

  console.log(
    "🔥 Writing V8 data to Firebase..."
  );


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
    "✅ Firebase write successful."
  );


  /* -----------------------------------------
     FINAL RESULT
  ----------------------------------------- */

  console.log("");
  console.log(
    "=============================================="
  );

  console.log(
    " GUDUR CROSSING RADAR V8 RESULT"
  );

  console.log(
    "=============================================="
  );

  console.log(
    `Decision       : ${decision}`
  );

  console.log(
    `Upcoming       : ${upcoming.length}`
  );

  console.log(
    `Live processed : ${processedTrains.length}`
  );

  console.log(
    `Warning        : ${warningCount}`
  );

  console.log(
    `Closed         : ${closedCount}`
  );


  if (activeTrain) {

    console.log(
      `Active train   : ${activeTrain.trainNumber}`
    );

    console.log(
      `Gate           : ${activeTrain.gateName}`
    );

    console.log(
      `Distance       : ${activeTrain.distanceToGateKm} km`
    );

    console.log(
      `Corridor       : ${activeTrain.corridor}`
    );

    console.log(
      `Status         : ${activeTrain.status}`
    );

  } else {

    console.log(
      "Active train   : NONE"
    );

  }


  console.log(
    `Firebase path  : ${FIREBASE_PATH}`
  );

  console.log(
    `Processing     : ${Date.now() - startedAt} ms`
  );

  console.log(
    "=============================================="
  );

}


/* =========================================================
   EXECUTE
   ========================================================= */

main()

  .then(() => {

    console.log("");
    console.log(
      "✅ V8 UPDATE SUCCESSFUL"
    );

    process.exit(0);

  })


  .catch((error) => {

    console.error("");
    console.error(
      "❌ V8 UPDATE FAILED"
    );


    if (
      error.response
    ) {

      console.error(
        "HTTP STATUS:",
        error.response.status
      );


      console.error(
        "API RESPONSE:"
      );


      console.error(
        JSON.stringify(
          error.response.data,
          null,
          2
        )
      );

    } else {

      console.error(
        error.stack ||
        error.message
      );

    }


    process.exit(1);

  });
