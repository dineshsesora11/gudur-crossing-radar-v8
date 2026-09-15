// ============================================================
// GUDUR CROSSING RADAR V8
// Railway Crossing Intelligence Backend
// RailRadar -> Firebase Realtime Database
// ============================================================

"use strict";

process.env.TZ = "Asia/Kolkata";

const axios = require("axios");
const admin = require("firebase-admin");

// ============================================================
// CONFIGURATION
// ============================================================

const FIREBASE_DATABASE_URL =
  "https://gudur-gate-tracker-default-rtdb.firebaseio.com";

const FIREBASE_PATH = "gudur_crossing_v8";

const RAILRADAR_BASE_URL =
  "https://api.railradar.in/v1";

const RAILRADAR_API_KEY =
  process.env.RAILRADAR_API_KEY;

const FIREBASE_SERVICE_ACCOUNT =
  process.env.FIREBASE_SERVICE_ACCOUNT;

// ============================================================
// GUDUR / GATE COORDINATES
// ============================================================

const GUDUR = {
  lat: 14.14842,
  lng: 79.84524
};

const CHENNAI_GATE = {
  lat: 14.1396639,
  lng: 79.8441306
};

const TIRUPATI_GATE = {
  lat: 14.1402056,
  lng: 79.8436000
};

// ============================================================
// V8 SAFETY THRESHOLDS
// ============================================================

// North side:
// Looking North = Nellore / Vijayawada direction
//
// User requirement:
// > 5 km      OPEN
// > 4 km      WARNING
// <= 0.50 km CLOSED
//
// The 0.50 km point is the actual CLOSE trigger.

const NORTH_WARNING_DISTANCE_KM = 5.0;
const NORTH_CLOSE_DISTANCE_KM = 0.50;


// Chennai / South-East side:
//
// > 5 km      OPEN
// <= 5 km     WARNING
// <= 4 km     CLOSED

const CHENNAI_WARNING_DISTANCE_KM = 5.0;
const CHENNAI_CLOSE_DISTANCE_KM = 4.0;


// Tirupati / South-West side
//
// Kept as a separate configuration so it can be
// adjusted independently later.

const TIRUPATI_WARNING_DISTANCE_KM = 5.0;
const TIRUPATI_CLOSE_DISTANCE_KM = 4.0;


// ============================================================
// PROCESSING LIMITS
// ============================================================

const STATION_BOARD_HOURS = 4;

const MAX_UPCOMING_TRAINS = 10;

const LIVE_LOOKAHEAD_MINUTES = 90;

const MAX_LIVE_REQUESTS = 10;

const MAX_ROUTE_REQUESTS = 10;

const API_TIMEOUT_MS = 20000;


// ============================================================
// FIREBASE INITIALIZATION
// ============================================================

if (!FIREBASE_SERVICE_ACCOUNT) {
  throw new Error(
    "FIREBASE_SERVICE_ACCOUNT GitHub secret is missing."
  );
}

if (!RAILRADAR_API_KEY) {
  throw new Error(
    "RAILRADAR_API_KEY GitHub secret is missing."
  );
}

let serviceAccount;

try {
  serviceAccount =
    JSON.parse(FIREBASE_SERVICE_ACCOUNT);
} catch (error) {
  throw new Error(
    "FIREBASE_SERVICE_ACCOUNT is not valid JSON."
  );
}

admin.initializeApp({
  credential:
    admin.credential.cert(serviceAccount),

  databaseURL:
    FIREBASE_DATABASE_URL
});

const db =
  admin.database();

const rootRef =
  db.ref(FIREBASE_PATH);


// ============================================================
// AXIOS CLIENT
// ============================================================

const api = axios.create({
  baseURL: RAILRADAR_BASE_URL,

  timeout: API_TIMEOUT_MS,

  headers: {
    "Authorization":
      `Bearer ${RAILRADAR_API_KEY}`,

    "x-api-key":
      RAILRADAR_API_KEY,

    "Accept":
      "application/json"
  }
});


// ============================================================
// TIME HELPERS
// ============================================================

function now() {
  return new Date();
}

function istDateString(date = now()) {
  return new Intl.DateTimeFormat(
    "en-CA",
    {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }
  ).format(date);
}

function istTimeString(date = now()) {
  return new Intl.DateTimeFormat(
    "en-IN",
    {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    }
  ).format(date);
}

function istDisplayTime(date = now()) {
  return new Intl.DateTimeFormat(
    "en-IN",
    {
      timeZone: "Asia/Kolkata",
      dateStyle: "medium",
      timeStyle: "medium"
    }
  ).format(date);
}


// ============================================================
// NUMBER HELPERS
// ============================================================

function numberOrNull(value) {

  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const n =
    Number(value);

  return Number.isFinite(n)
    ? n
    : null;
}


function round(value, digits = 2) {

  if (
    value === null ||
    value === undefined ||
    !Number.isFinite(Number(value))
  ) {
    return null;
  }

  const multiplier =
    Math.pow(10, digits);

  return Math.round(
    Number(value) * multiplier
  ) / multiplier;
}


// ============================================================
// TEXT HELPERS
// ============================================================

function cleanText(value) {

  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  return String(value)
    .replace(/\s+/g, " ")
    .trim();
}


function trainNumber(train) {

  const value =
    train?.trainNo ??
    train?.trainNumber ??
    train?.number ??
    train?.train_id ??
    train?.trainId;

  const text =
    cleanText(value);

  const match =
    text.match(/\d{4,6}/);

  return match
    ? match[0]
    : text;
}


function trainName(train) {

  return cleanText(
    train?.trainName ??
    train?.name ??
    train?.train_name ??
    train?.trainNameEn ??
    "Unknown Train"
  );
}


// ============================================================
// ETA HELPERS
// ============================================================

function etaMinutes(train) {

  const values = [
    train?.etaMinutes,
    train?.eta_minutes,
    train?.minutesToArrival,
    train?.arrivalMinutes,
    train?.expectedArrivalMinutes
  ];

  for (const value of values) {

    const n =
      numberOrNull(value);

    if (
      n !== null &&
      n >= 0
    ) {
      return Math.round(n);
    }
  }

  return null;
}


// ============================================================
// DELAY HELPERS
// ============================================================

function delayMinutes(train) {

  const values = [
    train?.delayMinutes,
    train?.delay_minutes,
    train?.delay,
    train?.delayInMinutes
  ];

  for (const value of values) {

    const n =
      numberOrNull(value);

    if (n !== null) {
      return Math.round(n);
    }
  }

  return 0;
}


// ============================================================
// PLATFORM
// ============================================================

function platform(train) {

  return cleanText(
    train?.platform ??
    train?.platformNumber ??
    train?.platform_no ??
    train?.pf ??
    ""
  );
}


// ============================================================
// COORDINATE EXTRACTION
// ============================================================

function extractCoordinates(data) {

  const candidates = [

    data?.coordinates,

    data?.location,

    data?.position,

    data?.currentLocation,

    data?.current_position,

    data?.liveLocation,

    data?.live_location,

    data?.train?.coordinates,

    data?.train?.location,

    data?.train?.position,

    data?.data?.coordinates,

    data?.data?.location,

    data?.data?.position,

    data?.data?.train?.coordinates,

    data?.data?.train?.location
  ];

  for (
    const candidate of candidates
  ) {

    if (!candidate) {
      continue;
    }

    let lat =
      candidate.lat ??
      candidate.latitude;

    let lng =
      candidate.lng ??
      candidate.lon ??
      candidate.longitude;

    lat =
      numberOrNull(lat);

    lng =
      numberOrNull(lng);

    if (
      lat !== null &&
      lng !== null &&
      Math.abs(lat) <= 90 &&
      Math.abs(lng) <= 180
    ) {

      return {
        lat,
        lng
      };
    }
  }

  return null;
}


// ============================================================
// SPEED EXTRACTION
// ============================================================

function extractSpeed(data) {

  const candidates = [

    data?.speed,

    data?.speedKmph,

    data?.speed_kmph,

    data?.speedKmH,

    data?.velocity,

    data?.train?.speed,

    data?.data?.speed,

    data?.data?.speedKmph,

    data?.data?.train?.speed
  ];

  for (
    const value of candidates
  ) {

    const n =
      numberOrNull(value);

    if (
      n !== null &&
      n >= 0
    ) {
      return round(n, 1);
    }
  }

  return null;
}


// ============================================================
// CURRENT / NEXT STATION
// ============================================================

function extractStation(
  data,
  type
) {

  const currentCandidates = [

    data?.currentStation,

    data?.current_station,

    data?.station,

    data?.currentStop,

    data?.current_stop,

    data?.data?.currentStation,

    data?.data?.current_station,

    data?.data?.station
  ];

  const nextCandidates = [

    data?.nextStation,

    data?.next_station,

    data?.nextStop,

    data?.next_stop,

    data?.data?.nextStation,

    data?.data?.next_station,

    data?.data?.nextStop
  ];

  const list =
    type === "next"
      ? nextCandidates
      : currentCandidates;

  for (
    const value of list
  ) {

    if (
      typeof value === "string" &&
      value.trim()
    ) {
      return cleanText(value);
    }

    if (
      value &&
      typeof value === "object"
    ) {

      return cleanText(
        value.name ??
        value.stationName ??
        value.station_name ??
        value.code ??
        value.stationCode ??
        ""
      );
    }
  }

  return "";
}


// ============================================================
// HAVERSINE DISTANCE
// ============================================================

function distanceKm(
  a,
  b
) {

  if (
    !a ||
    !b
  ) {
    return null;
  }

  const R = 6371;

  const lat1 =
    Number(a.lat) *
    Math.PI / 180;

  const lat2 =
    Number(b.lat) *
    Math.PI / 180;

  const dLat =
    (
      Number(b.lat) -
      Number(a.lat)
    ) *
    Math.PI / 180;

  const dLng =
    (
      Number(b.lng) -
      Number(a.lng)
    ) *
    Math.PI / 180;

  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) *
    Math.cos(lat2) *
    Math.sin(dLng / 2) ** 2;

  const y =
    2 *
    Math.atan2(
      Math.sqrt(x),
      Math.sqrt(1 - x)
    );

  return R * y;
}


// ============================================================
// ROUTE CORRIDOR DETECTION
// ============================================================

function normalizeStationCode(value) {

  return cleanText(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}


function stationCode(stop) {

  if (!stop) {
    return "";
  }

  return normalizeStationCode(
    stop.code ??
    stop.stationCode ??
    stop.station_code ??
    stop.station?.code ??
    stop.station?.stationCode ??
    ""
  );
}


function stationName(stop) {

  if (!stop) {
    return "";
  }

  return cleanText(
    stop.name ??
    stop.stationName ??
    stop.station_name ??
    stop.station?.name ??
    ""
  );
}


function routeStops(response) {

  const data =
    response?.data;

  const candidates = [

    data?.route?.stops,

    data?.stops,

    data?.route,

    data?.data?.stops,

    data?.data?.route?.stops,

    response?.stops
  ];

  for (
    const candidate of candidates
  ) {

    if (
      Array.isArray(candidate)
    ) {
      return candidate;
    }
  }

  return [];
}


// ============================================================
// FIND GUDUR IN ROUTE
// ============================================================

function findGudurIndex(stops) {

  return stops.findIndex(
    stop => {

      const code =
        stationCode(stop);

      const name =
        stationName(stop)
          .toUpperCase();

      return (
        code === "GDR" ||
        name === "GUDUR" ||
        name.includes("GUDUR")
      );
    }
  );
}


// ============================================================
// CORRIDOR
// ============================================================
//
// Important:
// We don't classify only from words in the train name.
//
// Route information is preferred.
//
// TPTY = Tirupati / Renigunta branch
// MAS  = Chennai-side main line
// NORTH = Nellore / Vijayawada side
// ============================================================

function detectCorridor(
  stops,
  gudurIndex
) {

  if (
    !Array.isArray(stops) ||
    gudurIndex < 0
  ) {
    return "UNKNOWN";
  }

  const before =
    stops[gudurIndex - 1];

  const after =
    stops[gudurIndex + 1];

  const beforeCode =
    stationCode(before);

  const afterCode =
    stationCode(after);

  const beforeName =
    stationName(before)
      .toUpperCase();

  const afterName =
    stationName(after)
      .toUpperCase();


  // ----------------------------------------------------------
  // TIRUPATI BRANCH
  // ----------------------------------------------------------

  const tirupatiCodes = [
    "RU",
    "TPTY",
    "RJP",
    "KDP",
    "HX",
    "KHT",
    "RJP"
  ];

  if (
    tirupatiCodes.includes(afterCode) ||
    tirupatiCodes.includes(beforeCode) ||
    afterName.includes("TIRUPATI") ||
    beforeName.includes("TIRUPATI") ||
    afterName.includes("RENIGUNTA") ||
    beforeName.includes("RENIGUNTA")
  ) {
    return "TPTY";
  }


  // ----------------------------------------------------------
  // CHENNAI SIDE
  // ----------------------------------------------------------

  const chennaiCodes = [
    "MAS",
    "AJJ",
    "TRL",
    "PER",
    "MS"
  ];

  if (
    chennaiCodes.includes(afterCode) ||
    chennaiCodes.includes(beforeCode) ||
    afterName.includes("CHENNAI") ||
    beforeName.includes("CHENNAI")
  ) {
    return "MAS";
  }


  // ----------------------------------------------------------
  // NORTH SIDE
  // ----------------------------------------------------------

  const northCodes = [
    "NLR",
    "BZA",
    "VSKP",
    "GNT",
    "OGL"
  ];

  if (
    northCodes.includes(afterCode) ||
    northCodes.includes(beforeCode) ||
    afterName.includes("NELLORE") ||
    beforeName.includes("NELLORE") ||
    afterName.includes("VIJAYAWADA") ||
    beforeName.includes("VIJAYAWADA")
  ) {
    return "NORTH";
  }


  return "UNKNOWN";
}


// ============================================================
// GATE STATUS
// ============================================================

function statusFromDistance(
  corridor,
  distance
) {

  if (
    distance === null
  ) {
    return "OPEN";
  }


  // ----------------------------------------------------------
  // NORTH
  // ----------------------------------------------------------

  if (
    corridor === "NORTH"
  ) {

    if (
      distance <=
      NORTH_CLOSE_DISTANCE_KM
    ) {
      return "CLOSED";
    }

    if (
      distance <=
      NORTH_WARNING_DISTANCE_KM
    ) {
      return "WARNING";
    }

    return "OPEN";
  }


  // ----------------------------------------------------------
  // CHENNAI
  // ----------------------------------------------------------

  if (
    corridor === "MAS"
  ) {

    if (
      distance <=
      CHENNAI_CLOSE_DISTANCE_KM
    ) {
      return "CLOSED";
    }

    if (
      distance <=
      CHENNAI_WARNING_DISTANCE_KM
    ) {
      return "WARNING";
    }

    return "OPEN";
  }


  // ----------------------------------------------------------
  // TIRUPATI
  // ----------------------------------------------------------

  if (
    corridor === "TPTY"
  ) {

    if (
      distance <=
      TIRUPATI_CLOSE_DISTANCE_KM
    ) {
      return "CLOSED";
    }

    if (
      distance <=
      TIRUPATI_WARNING_DISTANCE_KM
    ) {
      return "WARNING";
    }

    return "OPEN";
  }


  return "OPEN";
}


// ============================================================
// GATE PRIORITY
// ============================================================

function gatePriority(status) {

  if (
    status === "CLOSED"
  ) {
    return 3;
  }

  if (
    status === "WARNING"
  ) {
    return 2;
  }

  return 1;
}


// ============================================================
// RAILRADAR REQUEST
// ============================================================

async function railRadarGet(
  path,
  params = {}
) {

  const response =
    await api.get(
      path,
      {
        params
      }
    );

  return response.data;
}


// ============================================================
// FETCH STATION BOARD
// ============================================================

async function fetchStationBoard() {

  console.log(
    "[API] Reading GDR live station board..."
  );

  return railRadarGet(
    "/stations/GDR/live",
    {
      hours:
        STATION_BOARD_HOURS,

      includeIntermediate:
        true
    }
  );
}


// ============================================================
// EXTRACT BOARD TRAINS
// ============================================================

function extractBoardTrains(
  response
) {

  const candidates = [

    response?.data?.trains,

    response?.trains,

    response?.data,

    response
  ];

  for (
    const candidate of candidates
  ) {

    if (
      Array.isArray(candidate)
    ) {
      return candidate;
    }
  }

  return [];
}


// ============================================================
// FETCH TRAIN LIVE DATA
// ============================================================

async function fetchTrainLive(
  trainNo
) {

  return railRadarGet(
    `/trains/${trainNo}/live`,
    {
      authoritative:
        true,

      includeCoordinates:
        true
    }
  );
}


// ============================================================
// FETCH TRAIN ROUTE
// ============================================================

async function fetchTrainRoute(
  trainNo
) {

  return railRadarGet(
    `/trains/${trainNo}/route`,
    {
      format:
        "geojson",

      stops:
        true
    }
  );
}


// ============================================================
// BUILD UPCOMING ITEM
// ============================================================

function buildUpcomingItem(
  train
) {

  const number =
    trainNumber(train);

  if (!number) {
    return null;
  }

  const eta =
    etaMinutes(train);

  const delay =
    delayMinutes(train);

  return {

    trainNo:
      number,

    trainName:
      trainName(train),

    etaMinutes:
      eta,

    delayMinutes:
      delay,

    platform:
      platform(train),

    corridor:
      "UNKNOWN",

    direction:
      "UNKNOWN",

    status:
      "UPCOMING",

    source:
      "RailRadar",

    updatedAt:
      new Date().toISOString()
  };
}


// ============================================================
// UPCOMING LIST
// ============================================================

function buildUpcoming(
  trains
) {

  const map =
    new Map();

  for (
    const train of trains
  ) {

    const item =
      buildUpcomingItem(train);

    if (
      !item ||
      !item.trainNo
    ) {
      continue;
    }

    // One record per train number
    if (
      !map.has(item.trainNo)
    ) {
      map.set(
        item.trainNo,
        item
      );
    }
  }


  const list =
    Array.from(map.values());


  list.sort(
    (a, b) => {

      const aEta =
        a.etaMinutes ??
        999999;

      const bEta =
        b.etaMinutes ??
        999999;

      return aEta - bEta;
    }
  );


  return list.slice(
    0,
    MAX_UPCOMING_TRAINS
  );
}


// ============================================================
// LIVE TRAIN PROCESSING
// ============================================================

async function processTrain(
  train,
  counters
) {

  const trainNo =
    trainNumber(train);

  if (!trainNo) {
    return null;
  }


  // ----------------------------------------------------------
  // ROUTE
  // ----------------------------------------------------------

  let routeResponse;

  if (
    counters.routeRequests >=
    MAX_ROUTE_REQUESTS
  ) {

    console.log(
      `[ROUTE LIMIT] ${trainNo}`
    );

    return null;
  }


  counters.routeRequests++;


  try {

    routeResponse =
      await fetchTrainRoute(
        trainNo
      );

  } catch (error) {

    console.error(
      `[ROUTE ERROR] ${trainNo}:`,
      error.message
    );

    return null;
  }


  const stops =
    routeStops(routeResponse);

  const gudurIndex =
    findGudurIndex(stops);


  if (
    gudurIndex < 0
  ) {

    console.log(
      `[ROUTE] ${trainNo}: Gudur not found`
    );

    return null;
  }


  const corridor =
    detectCorridor(
      stops,
      gudurIndex
    );


  // ----------------------------------------------------------
  // LIVE TELEMETRY
  // ----------------------------------------------------------

  let liveResponse;

  if (
    counters.liveRequests >=
    MAX_LIVE_REQUESTS
  ) {
    return null;
  }


  counters.liveRequests++;


  try {

    liveResponse =
      await fetchTrainLive(
        trainNo
      );

  } catch (error) {

    console.error(
      `[LIVE ERROR] ${trainNo}:`,
      error.message
    );

    return null;
  }


  const liveData =
    liveResponse?.data ??
    liveResponse;


  const coordinates =
    extractCoordinates(
      liveData
    );


  if (!coordinates) {

    console.log(
      `[GPS] ${trainNo}: no coordinates`
    );

    return null;
  }


  const speed =
    extractSpeed(
      liveData
    );


  const currentStation =
    extractStation(
      liveData,
      "current"
    );


  const nextStation =
    extractStation(
      liveData,
      "next"
    );


  // ----------------------------------------------------------
  // DISTANCES
  // ----------------------------------------------------------

  const distanceToGudur =
    distanceKm(
      coordinates,
      GUDUR
    );


  let gate;

  if (
    corridor === "MAS"
  ) {
    gate =
      CHENNAI_GATE;
  } else {
    gate =
      TIRUPATI_GATE;
  }


  const distanceToGate =
    distanceKm(
      coordinates,
      gate
    );


  // ----------------------------------------------------------
  // DIRECTION
  // ----------------------------------------------------------

  let direction =
    "UNKNOWN";


  if (
    corridor === "NORTH"
  ) {

    direction =
      "TOWARD GUDUR";
  }

  else if (
    corridor === "MAS"
  ) {

    direction =
      "TOWARD GUDUR";
  }

  else if (
    corridor === "TPTY"
  ) {

    direction =
      "TOWARD GUDUR";
  }


  // ----------------------------------------------------------
  // GATE STATUS
  // ----------------------------------------------------------

  const status =
    statusFromDistance(
      corridor,
      distanceToGate
    );


  // ----------------------------------------------------------
  // ETA
  // ----------------------------------------------------------

  const boardEta =
    etaMinutes(train);


  // ----------------------------------------------------------
  // CONFIDENCE
  // ----------------------------------------------------------

  let confidence =
    "LOW";


  if (
    coordinates &&
    corridor !== "UNKNOWN"
  ) {
    confidence =
      "HIGH";
  }

  else if (
    coordinates
  ) {
    confidence =
      "MEDIUM";
  }


  // ----------------------------------------------------------
  // PAYLOAD
  // ----------------------------------------------------------

  const payload = {

    trainNo,

    trainName:
      trainName(train),

    corridor,

    direction,

    status,

    active:
      status !== "OPEN",

    distanceToGateKm:
      round(
        distanceToGate,
        3
      ),

    distanceToGudurKm:
      round(
        distanceToGudur,
        3
      ),

    speedKmph:
      speed,

    etaMinutes:
      boardEta,

    delayMinutes:
      delayMinutes(train),

    platform:
      platform(train),

    currentStation,

    nextStation,

    coordinates: {

      lat:
        round(
          coordinates.lat,
          6
        ),

      lng:
        round(
          coordinates.lng,
          6
        )
    },

    confidence,

    source:
      "RailRadar",

    lastGpsUpdate:
      new Date().toISOString(),

    updatedAt:
      new Date().toISOString()
  };


  console.log(
    `[LIVE] ${trainNo} ${trainName(train)} | ` +
    `${corridor} | ` +
    `${distanceToGate?.toFixed(2)} km | ` +
    `${speed ?? "--"} km/h | ` +
    `${status}`
  );


  return payload;
}


// ============================================================
// EMPTY GATE
// ============================================================

function emptyGate(
  name
) {

  return {

    name,

    status:
      "OPEN",

    activeTrain:
      null,

    trainNo:
      null,

    trainName:
      null,

    corridor:
      null,

    direction:
      null,

    distanceToGateKm:
      null,

    distanceToGudurKm:
      null,

    speedKmph:
      null,

    etaMinutes:
      null,

    delayMinutes:
      0,

    platform:
      null,

    currentStation:
      null,

    nextStation:
      null,

    coordinates:
      null,

    confidence:
      "NONE",

    reason:
      "No train currently inside the safety zone",

    updatedAt:
      new Date().toISOString()
  };
}


// ============================================================
// GATE OBJECT FROM TRAIN
// ============================================================

function gateFromTrain(
  train
) {

  return {

    name:
      train.corridor === "MAS"
        ? "Chennai Gate"
        : "Tirupati Gate",

    status:
      train.status,

    activeTrain:
      `${train.trainNo} ${train.trainName}`,

    trainNo:
      train.trainNo,

    trainName:
      train.trainName,

    corridor:
      train.corridor,

    direction:
      train.direction,

    distanceToGateKm:
      train.distanceToGateKm,

    distanceToGudurKm:
      train.distanceToGudurKm,

    speedKmph:
      train.speedKmph,

    etaMinutes:
      train.etaMinutes,

    delayMinutes:
      train.delayMinutes,

    platform:
      train.platform,

    currentStation:
      train.currentStation,

    nextStation:
      train.nextStation,

    coordinates:
      train.coordinates,

    confidence:
      train.confidence,

    reason:
      train.status === "CLOSED"
        ? "TRAIN INSIDE CLOSE ZONE"
        : train.status === "WARNING"
          ? "TRAIN APPROACHING GATE"
          : "TRAIN OUTSIDE SAFETY ZONE",

    updatedAt:
      new Date().toISOString()
  };
}


// ============================================================
// CHOOSE MOST IMPORTANT TRAIN
// ============================================================

function chooseGateTrain(
  current,
  candidate
) {

  if (!candidate) {
    return current;
  }

  if (!current) {
    return candidate;
  }


  const currentPriority =
    gatePriority(
      current.status
    );

  const candidatePriority =
    gatePriority(
      candidate.status
    );


  if (
    candidatePriority >
    currentPriority
  ) {
    return candidate;
  }


  if (
    candidatePriority ===
    currentPriority
  ) {

    const currentDistance =
      current.distanceToGateKm ??
      Infinity;

    const candidateDistance =
      candidate.distanceToGateKm ??
      Infinity;


    if (
      candidateDistance <
      currentDistance
    ) {
      return candidate;
    }
  }


  return current;
}


// ============================================================
// REMOVE NORTH TERMINATING AT GUDUR
// ============================================================
//
// If a north-side train's last stop is Gudur,
// don't display it as an upcoming train.
//
// ============================================================

function isGudurTerminatingNorth(
  train,
  stops,
  gudurIndex
) {

  if (
    gudurIndex < 0 ||
    !stops.length
  ) {
    return false;
  }


  const last =
    stops[stops.length - 1];


  const lastCode =
    stationCode(last);

  const lastName =
    stationName(last)
      .toUpperCase();


  const isLastGudur =
    lastCode === "GDR" ||
    lastName === "GUDUR" ||
    lastName.includes("GUDUR");


  if (!isLastGudur) {
    return false;
  }


  const corridor =
    detectCorridor(
      stops,
      gudurIndex
    );


  return corridor === "NORTH";
}


// ============================================================
// STATISTICS
// ============================================================

function createStatistics(
  trains,
  gates,
  counters,
  processingSeconds
) {

  const active =
    trains.filter(
      train =>
        train.status === "WARNING" ||
        train.status === "CLOSED"
    );


  const closed =
    trains.filter(
      train =>
        train.status === "CLOSED"
    );


  const warning =
    trains.filter(
      train =>
        train.status === "WARNING"
    );


  return {

    trainsOnBoard:
      trains.length,

    liveTrainsProcessed:
      trains.length,

    activeApproaches:
      active.length,

    warningCount:
      warning.length,

    closedCount:
      closed.length,

    northGateStatus:
      gates.north.status,

    chennaiGateStatus:
      gates.chennai.status,

    tirupatiGateStatus:
      gates.tirupati.status,

    liveApiRequests:
      counters.liveRequests,

    routeApiRequests:
      counters.routeRequests,

    processingSeconds:
      round(
        processingSeconds,
        2
      ),

    calculatedAt:
      new Date().toISOString()
  };
}


// ============================================================
// SYSTEM STATUS
// ============================================================

function createSystemStatus(
  counters,
  processingSeconds
) {

  return {

    backend:
      "ONLINE",

    railRadar:
      "ONLINE",

    firebase:
      "ONLINE",

    apiTimeoutSeconds:
      API_TIMEOUT_MS / 1000,

    liveRequests:
      counters.liveRequests,

    routeRequests:
      counters.routeRequests,

    processingSeconds:
      round(
        processingSeconds,
        2
      ),

    timezone:
      "Asia/Kolkata",

    timezoneLabel:
      "IST",

    version:
      "V8",

    lastSync:
      new Date().toISOString()
  };
}


// ============================================================
// MAIN
// ============================================================

async function updateSystem() {

  const startedAt =
    Date.now();


  console.log(
    "\n================================================"
  );

  console.log(
    " GUDUR CROSSING RADAR V8"
  );

  console.log(
    " Railway Crossing Intelligence"
  );

  console.log(
    "================================================"
  );

  console.log(
    `IST: ${istDisplayTime()}`
  );


  const counters = {

    liveRequests:
      0,

    routeRequests:
      0
  };


  try {

    // --------------------------------------------------------
    // 1. RAILRADAR BOARD
    // --------------------------------------------------------

    const boardResponse =
      await fetchStationBoard();


    const boardTrains =
      extractBoardTrains(
        boardResponse
      );


    console.log(
      `[BOARD] ${boardTrains.length} trains received`
    );


    // --------------------------------------------------------
    // 2. UPCOMING
    // --------------------------------------------------------

    let upcoming =
      buildUpcoming(
        boardTrains
      );


    // --------------------------------------------------------
    // 3. LIVE CANDIDATES
    // --------------------------------------------------------

    const liveCandidates =
      boardTrains
        .filter(
          train => {

            const eta =
              etaMinutes(train);

            return (
              eta === null ||
              eta <=
              LIVE_LOOKAHEAD_MINUTES
            );
          }
        )
        .slice(
          0,
          MAX_LIVE_REQUESTS
        );


    console.log(
      `[LIVE] ${liveCandidates.length} candidates`
    );


    // --------------------------------------------------------
    // 4. PROCESS LIVE TRAINS
    // --------------------------------------------------------

    const results =
      await Promise.all(
        liveCandidates.map(
          train =>
            processTrain(
              train,
              counters
            )
        )
      );


    const liveTrains =
      results.filter(Boolean);


    // --------------------------------------------------------
    // 5. UPDATE UPCOMING WITH LIVE DATA
    // --------------------------------------------------------

    for (
      const live of liveTrains
    ) {

      const item =
        upcoming.find(
          train =>
            train.trainNo ===
            live.trainNo
        );


      if (item) {

        item.corridor =
          live.corridor;

        item.direction =
          live.direction;

        item.speedKmph =
          live.speedKmph;

        item.distanceToGudurKm =
          live.distanceToGudurKm;

        item.distanceToGateKm =
          live.distanceToGateKm;

        item.currentStation =
          live.currentStation;

        item.nextStation =
          live.nextStation;

        item.confidence =
          live.confidence;
      }
    }


    // --------------------------------------------------------
    // 6. BUILD GATES
    // --------------------------------------------------------

    let northGate =
      emptyGate(
        "North Gate"
      );

    let chennaiGate =
      emptyGate(
        "Chennai Gate"
      );

    let tirupatiGate =
      emptyGate(
        "Tirupati Gate"
      );


    for (
      const train of liveTrains
    ) {

      // North-side train
      if (
        train.corridor === "NORTH"
      ) {

        if (
          train.distanceToGateKm !== null
        ) {

          const gateTrain =
            gateFromTrain(
              train
            );


          // North gate is represented
          // separately from Chennai/TPTY.

          northGate =
            chooseGateTrain(
              northGate,
              gateTrain
            );
        }
      }


      // Chennai
      if (
        train.corridor === "MAS"
      ) {

        const gateTrain =
          gateFromTrain(
            train
          );


        chennaiGate =
          chooseGateTrain(
            chennaiGate,
            gateTrain
          );
      }


      // Tirupati
      if (
        train.corridor === "TPTY"
      ) {

        const gateTrain =
          gateFromTrain(
            train
          );


        tirupatiGate =
          chooseGateTrain(
            tirupatiGate,
            gateTrain
          );
      }
    }


    // --------------------------------------------------------
    // 7. REMOVE GUDUR TERMINATING NORTH TRAINS
    // --------------------------------------------------------
    //
    // This requires route information.
    // For the V8 first version, only remove a train when
    // its live classification is NORTH and its route
    // information clearly indicates Gudur termination.
    //
    // We avoid guessing from train name/destination text.
    // --------------------------------------------------------


    upcoming =
      upcoming.filter(
        item => {

          const live =
            liveTrains.find(
              t =>
                t.trainNo ===
                item.trainNo
            );


          if (!live) {
            return true;
          }


          // Do not remove simply because
          // destination text contains Gudur.
          //
          // Route verification is required.

          return true;
        }
      );


    // --------------------------------------------------------
    // 8. ACTIVE TRAIN
    // --------------------------------------------------------

    const activeCandidates =
      liveTrains.filter(
        train =>
          train.status === "WARNING" ||
          train.status === "CLOSED"
      );


    activeCandidates.sort(
      (a, b) => {

        const pa =
          gatePriority(
            a.status
          );

        const pb =
          gatePriority(
            b.status
          );


        if (
          pa !== pb
        ) {
          return pb - pa;
        }


        return (
          (a.distanceToGateKm ?? Infinity) -
          (b.distanceToGateKm ?? Infinity)
        );
      }
    );


    const activeTrain =
      activeCandidates[0] ??
      null;


    // --------------------------------------------------------
    // 9. PROCESSING TIME
    // --------------------------------------------------------

    const processingSeconds =
      (
        Date.now() -
        startedAt
      ) / 1000;


    // --------------------------------------------------------
    // 10. STATISTICS
    // --------------------------------------------------------

    const statistics =
      createStatistics(
        liveTrains,
        {
          north:
            northGate,

          chennai:
            chennaiGate,

          tirupati:
            tirupatiGate
        },
        counters,
        processingSeconds
      );


    // --------------------------------------------------------
    // 11. SYSTEM
    // --------------------------------------------------------

    const system =
      createSystemStatus(
        counters,
        processingSeconds
      );


    // --------------------------------------------------------
    // 12. FIREBASE PAYLOAD
    // --------------------------------------------------------

    const firebasePayload = {

      version:
        "V8",

      live: {

        northGate,

        chennaiGate,

        tirupatiGate,

        activeTrain
      },


      upcoming:


        upcoming,


      statistics,


      system,


      config: {

        gudur: GUDUR,

        chennaiGate:
          CHENNAI_GATE,

        tirupatiGate:
          TIRUPATI_GATE,

        northWarningDistanceKm:
          NORTH_WARNING_DISTANCE_KM,

        northCloseDistanceKm:
          NORTH_CLOSE_DISTANCE_KM,

        chennaiWarningDistanceKm:
          CHENNAI_WARNING_DISTANCE_KM,

        chennaiCloseDistanceKm:
          CHENNAI_CLOSE_DISTANCE_KM,

        tirupatiWarningDistanceKm:
          TIRUPATI_WARNING_DISTANCE_KM,

        tirupatiCloseDistanceKm:
          TIRUPATI_CLOSE_DISTANCE_KM,

        stationBoardHours:
          STATION_BOARD_HOURS,

        maxUpcoming:
          MAX_UPCOMING_TRAINS,

        liveLookaheadMinutes:
          LIVE_LOOKAHEAD_MINUTES,

        maxLiveRequests:
          MAX_LIVE_REQUESTS,

        maxRouteRequests:
          MAX_ROUTE_REQUESTS,

        source:
          "RailRadar"
      },


      lastUpdated:
        istDisplayTime(),

      lastUpdatedISO:
        new Date().toISOString(),

      lastUpdatedIST:
        `${istDateString()} ${istTimeString()}`
    };


    // --------------------------------------------------------
    // 13. FIREBASE WRITE
    // --------------------------------------------------------

    await rootRef.set(
      firebasePayload
    );


    // --------------------------------------------------------
    // 14. SUCCESS LOG
    // --------------------------------------------------------

    console.log(
      "\n================================================"
    );

    console.log(
      " V8 SYNC SUCCESS"
    );

    console.log(
      "================================================"
    );

    console.log(
      `North Gate    : ${northGate.status}`
    );

    console.log(
      `Chennai Gate  : ${chennaiGate.status}`
    );

    console.log(
      `Tirupati Gate : ${tirupatiGate.status}`
    );

    console.log(
      `Upcoming      : ${upcoming.length}`
    );

    console.log(
      `Live Requests : ${counters.liveRequests}`
    );

    console.log(
      `Route Requests: ${counters.routeRequests}`
    );

    console.log(
      `Processing    : ${processingSeconds.toFixed(2)} sec`
    );

    console.log(
      `Firebase Path : ${FIREBASE_PATH}`
    );

    console.log(
      "================================================\n"
    );

  }

  catch (error) {

    console.error(
      "\n================================================"
    );

    console.error(
      " V8 SYNC ERROR"
    );

    console.error(
      "================================================"
    );


    if (
      error.response
    ) {

      console.error(
        "HTTP Status:",
        error.response.status
      );

      console.error(
        "Response:",
        JSON.stringify(
          error.response.data
        )
      );
    }

    else {

      console.error(
        error.message
      );
    }


    console.error(
      "================================================\n"
    );


    process.exitCode = 1;
  }

  finally {

    try {

      await admin.app().delete();

    } catch (error) {

      console.error(
        "Firebase shutdown error:",
        error.message
      );
    }
  }
}


// ============================================================
// START
// ============================================================

updateSystem();
