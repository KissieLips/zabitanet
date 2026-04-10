const express = require("express");
const { Pool } = require("pg");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const https = require("https");
const XLSX = require("xlsx");
const { initMarketModuleDb, registerMarketModule } = require("./market-module");

const app = express();
const PORT = process.env.PORT || 3000;
const DISPLAY_TIME_ZONE = process.env.DISPLAY_TIME_ZONE || "Europe/Istanbul";

app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

registerMarketModule({ app, pool });

const uploadsRoot = path.join(__dirname, "uploads");
const complaintUploadsRoot = path.join(uploadsRoot, "complaints");
const businessUploadsRoot = path.join(uploadsRoot, "businesses");
const businessInspectionUploadsRoot = path.join(uploadsRoot, "business-inspections");

const DEFAULT_COMPLAINT_TOPICS = [
  "Kaldırım İşgali",
  "Görüntü Kirliliği",
  "Çevre Kirliliği",
  "Gürültü",
  "Seyyar Satıcı",
  "Ruhsatsız Faaliyet",
  "Dilencilik",
  "Atık / Moloz",
  "İşgal / Masa Sandalye",
  "Fiyat Etiketi / Tarife",
  "Hijyen",
  "Diğer"
];

const BUCAK_NEIGHBORHOODS = [
  "Alaattin",
  "Atilla",
  "Barbaros",
  "Camii",
  "Cumhuriyet",
  "Çamlıca",
  "Çavuşlar",
  "Çukur",
  "Fatih",
  "Karayvatlar",
  "Konak",
  "Mehmet Akif",
  "Mimar Sinan",
  "Oğuzhan",
  "Onaç",
  "Pazar",
  "Sanayi",
  "Yeni",
  "Yetmişevler",
  "Yunus Emre"
];

fs.mkdirSync(complaintUploadsRoot, { recursive: true });
fs.mkdirSync(businessUploadsRoot, { recursive: true });
fs.mkdirSync(businessInspectionUploadsRoot, { recursive: true });

function normalizeStoredText(value) {
  if (value === null || value === undefined) return "";

  const text = String(value);
  if (!/[ÃÄÅÐÞð]/.test(text)) return text;

  try {
    const fixed = Buffer.from(text, "latin1").toString("utf8");
    return fixed || text;
  } catch (error) {
    return text;
  }
}

function decodeUploadFilename(value) {
  if (!value) return "dosya";

  try {
    const fixed = Buffer.from(String(value), "latin1").toString("utf8");
    return fixed || String(value);
  } catch (error) {
    return String(value);
  }
}


function normalizeMatchText(value) {
  return String(value || '')
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function buildLicenseBusinessMatchAnalysis(businessRow, licenseRow) {
  if (!businessRow || !licenseRow) {
    return { eligible: false, score: 0, note: 'Eksik kayıt', matches: {} };
  }

  const businessTrade = normalizeMatchText(businessRow.trade_name || businessRow.tradeName || '');
  const businessOwner = normalizeMatchText(businessRow.owner_name || businessRow.ownerName || '');
  const businessNeighborhood = normalizeMatchText(getCanonicalBusinessNeighborhood(businessRow.neighborhood || businessRow.neighborhoodName || ''));
  const businessStreet = normalizeMatchText(businessRow.street || '');
  const businessDoorNo = normalizeMatchText(businessRow.door_no || businessRow.doorNo || '');
  const businessAda = normalizeMatchText(businessRow.ada || '');
  const businessParcel = normalizeMatchText(businessRow.parcel || '');
  const businessTax = normalizeMatchText(businessRow.tax_number || businessRow.taxNumber || '');
  const businessIdentity = normalizeMatchText(businessRow.identity_number || businessRow.identityNumber || '');

  const licenseTrade = normalizeMatchText(licenseRow.trade_name || licenseRow.tradeName || '');
  const licenseOwner = normalizeMatchText(licenseRow.owner_name || licenseRow.ownerName || '');
  const licenseNeighborhood = normalizeMatchText(getCanonicalBusinessNeighborhood(licenseRow.neighborhood || ''));
  const licenseStreet = normalizeMatchText(licenseRow.street || '');
  const licenseDoorNo = normalizeMatchText(licenseRow.door_no || licenseRow.doorNo || '');
  const licenseAda = normalizeMatchText(licenseRow.ada || '');
  const licenseParcel = normalizeMatchText(licenseRow.parcel || '');
  const licenseTax = normalizeMatchText(licenseRow.tax_number || licenseRow.taxNumber || '');
  const licenseIdentity = normalizeMatchText(licenseRow.identity_number || licenseRow.identityNumber || '');

  const matches = {
    trade: Boolean(businessTrade && licenseTrade && businessTrade === licenseTrade),
    owner: Boolean(businessOwner && licenseOwner && businessOwner === licenseOwner),
    neighborhood: Boolean(businessNeighborhood && licenseNeighborhood && businessNeighborhood === licenseNeighborhood),
    street: Boolean(businessStreet && licenseStreet && businessStreet === licenseStreet),
    door: Boolean(businessDoorNo && licenseDoorNo && businessDoorNo === licenseDoorNo),
    ada: Boolean(businessAda && licenseAda && businessAda === licenseAda),
    parcel: Boolean(businessParcel && licenseParcel && businessParcel === licenseParcel),
    tax: Boolean(businessTax && licenseTax && businessTax === licenseTax),
    identity: Boolean(businessIdentity && licenseIdentity && businessIdentity === licenseIdentity),
  };

  const addressCoreMatch = matches.neighborhood && matches.street;
  const addressStrongMatch = addressCoreMatch && (matches.door || matches.ada || matches.parcel);
  const identityMatch = matches.tax || matches.identity;
  const nameAnchorMatch = matches.trade || matches.owner;

  let eligible = false;
  let note = 'Adres teyidi yetersiz';

  if (identityMatch && nameAnchorMatch) {
    eligible = true;
    note = 'Kimlik / vergi ve isim bilgisi uyumlu';
  } else if (nameAnchorMatch && addressStrongMatch) {
    eligible = true;
    note = 'İsim ve açık adres bilgisi uyumlu';
  } else if (matches.trade && addressCoreMatch && matches.door) {
    eligible = true;
    note = 'Ünvan ve açık adres bilgisi uyumlu';
  }

  if (!eligible) {
    return { eligible: false, score: 0, note, matches };
  }

  let score = 0;
  if (matches.tax) score += 10;
  if (matches.identity) score += 10;
  if (matches.trade) score += 6;
  if (matches.owner) score += 4;
  if (matches.neighborhood) score += 3;
  if (matches.street) score += 4;
  if (matches.door) score += 5;
  if (matches.ada) score += 2;
  if (matches.parcel) score += 2;

  return { eligible: true, score, note, matches };
}

async function resolveBusinessIdForLicensePayload(payload, preferredBusinessId) {
  const forcedBusinessId = preferredBusinessId !== undefined && preferredBusinessId !== null && String(preferredBusinessId).trim() !== ''
    ? Number(preferredBusinessId)
    : null;

  if (!forcedBusinessId) return null;

  const exists = await pool.query('SELECT id FROM businesses WHERE id = $1 LIMIT 1', [forcedBusinessId]);
  return exists.rows.length ? forcedBusinessId : null;
}

async function findBestLicenseBusinessSuggestion(licenseRow) {
  if (!licenseRow) return null;

  const businessRows = await pool.query('SELECT * FROM businesses');
  let best = null;

  for (const businessRow of businessRows.rows) {
    const analysis = buildLicenseBusinessMatchAnalysis(businessRow, licenseRow);
    if (!analysis.eligible) continue;
    if (!best || analysis.score > best.score) {
      best = {
        businessId: businessRow.id,
        score: analysis.score,
        note: analysis.note,
      };
    }
  }

  return best && best.score >= 15 ? best : null;
}

async function updateLicenseMatchSuggestion(licenseId) {
  if (!licenseId) return null;

  const licenseResult = await pool.query('SELECT * FROM licenses WHERE id = $1 LIMIT 1', [licenseId]);
  if (!licenseResult.rows.length) return null;

  const licenseRow = licenseResult.rows[0];

  if (licenseRow.business_id) {
    await pool.query(`
      UPDATE licenses
      SET
        suggested_business_id = NULL,
        match_score = 0,
        match_note = '',
        match_status = 'Bağlandı',
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `, [licenseId]);
    return null;
  }

  const best = await findBestLicenseBusinessSuggestion(licenseRow);

  await pool.query(`
    UPDATE licenses
    SET
      suggested_business_id = $1,
      match_score = $2,
      match_note = $3,
      match_status = $4,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $5
  `, [
    best ? best.businessId : null,
    best ? best.score : 0,
    best ? best.note : '',
    best ? 'Onay Bekliyor' : 'Bağlantı Yok',
    licenseId
  ]);

  return best;
}

async function refreshAllLicenseSuggestions() {
  const result = await pool.query('SELECT id FROM licenses WHERE business_id IS NULL');
  for (const row of result.rows) {
    await updateLicenseMatchSuggestion(row.id);
  }
}

const storage = multer.diskStorage({
  destination: function(req, file, cb) {
    const complaintFolder = path.join(complaintUploadsRoot, String(req.params.id));
    fs.mkdirSync(complaintFolder, { recursive: true });
    cb(null, complaintFolder);
  },
  filename: function(req, file, cb) {
    const decodedOriginalName = decodeUploadFilename(file.originalname || "dosya");
    const ext = path.extname(decodedOriginalName || "");
    const base = path.basename(decodedOriginalName || "dosya", ext).replace(/[^a-zA-Z0-9çğıöşüÇĞİÖŞÜ_-]/g, "-");
    cb(null, Date.now() + "-" + base + ext);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 20 * 1024 * 1024 }
});

const businessStorage = multer.diskStorage({
  destination: function(req, file, cb) {
    const businessFolder = path.join(businessUploadsRoot, String(req.params.id));
    fs.mkdirSync(businessFolder, { recursive: true });
    cb(null, businessFolder);
  },
  filename: function(req, file, cb) {
    const decodedOriginalName = decodeUploadFilename(file.originalname || "dosya");
    const ext = path.extname(decodedOriginalName || "");
    const base = path.basename(decodedOriginalName || "dosya", ext).replace(/[^a-zA-Z0-9çğıöşüÇĞİÖŞÜ_-]/g, "-");
    cb(null, Date.now() + "-" + base + ext);
  }
});

const businessUpload = multer({
  storage: businessStorage,
  limits: { fileSize: 25 * 1024 * 1024 }
});

const inspectionFileStorage = multer.diskStorage({
  destination: function(req, file, cb) {
    const inspectionFolder = path.join(businessInspectionUploadsRoot, String(req.params.inspectionId));
    fs.mkdirSync(inspectionFolder, { recursive: true });
    cb(null, inspectionFolder);
  },
  filename: function(req, file, cb) {
    const decodedOriginalName = decodeUploadFilename(file.originalname || "dosya");
    const ext = path.extname(decodedOriginalName || "");
    const base = path.basename(decodedOriginalName || "dosya", ext).replace(/[^a-zA-Z0-9çğıöşüÇĞİÖŞÜ_-]/g, "-");
    cb(null, Date.now() + "-" + base + ext);
  }
});

const inspectionFileUpload = multer({
  storage: inspectionFileStorage,
  limits: { fileSize: 25 * 1024 * 1024 }
});

function httpsGetJson(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: {
        "User-Agent": "ZabitaYonetimSistemi/1.0 (reverse geocode)",
        "Accept": "application/json"
      }
    }, (response) => {
      let raw = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { raw += chunk; });
      response.on("end", () => {
        if (response.statusCode && response.statusCode >= 400) {
          return reject(new Error("Harici konum servisi hata döndürdü: " + response.statusCode));
        }
        try {
          resolve(raw ? JSON.parse(raw) : {});
        } catch (error) {
          reject(error);
        }
      });
    });

    request.on("error", reject);
    request.setTimeout(12000, () => {
      request.destroy(new Error("Harici konum servisi zaman aşımına uğradı."));
    });
  });
}

function buildReverseGeocodeText(payload) {
  if (!payload || !payload.address) return "";
  const address = payload.address;

  const parts = [
    address.road,
    address.neighbourhood || address.suburb || address.quarter || address.hamlet || address.village,
    address.city_district || address.town || address.city || address.county,
    address.state_district || address.state,
  ].filter(Boolean);

  return parts.join(", ");
}


app.use("/uploads", express.static(uploadsRoot));

function toInputDate(value) {
  if (!value) return "";

  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";

  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return yyyy + "-" + mm + "-" + dd;
}

function formatDate(value) {
  if (!value) return "";

  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parts = value.split("-");
    return parts[2] + "." + parts[1] + "." + parts[0];
  }

  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";

  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: DISPLAY_TIME_ZONE,
  }).format(d);
}

function formatDateTime(value) {
  if (!value) return "";

  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);

  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: DISPLAY_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(d);
}

function mapComplaintTopic(row) {
  return {
    id: Number(row.id),
    name: row.name,
    isActive: row.is_active !== false && row.is_active !== "f",
  };
}

function normalizeTopicIds(topicIds) {
  if (!Array.isArray(topicIds)) return [];

  const normalized = [];
  const seen = new Set();

  for (const value of topicIds) {
    const id = Number(value);
    if (!Number.isInteger(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    normalized.push(id);
  }

  return normalized;
}

async function getComplaintTopicRowsByIds(topicIds, db = pool) {
  const ids = normalizeTopicIds(topicIds);
  if (!ids.length) return [];

  const result = await db.query(
    `
      SELECT id, name, COALESCE(is_active, TRUE) AS is_active
      FROM complaint_topic_definitions
      WHERE id = ANY($1::int[])
      ORDER BY LOWER(name) ASC
    `,
    [ids]
  );

  return result.rows;
}

async function getComplaintTopicsMapForComplaintIds(complaintIds, db = pool) {
  const ids = Array.from(new Set((complaintIds || []).map(Number).filter(function(value) {
    return Number.isInteger(value) && value > 0;
  })));

  const topicMap = new Map();
  for (const id of ids) topicMap.set(id, []);
  if (!ids.length) return topicMap;

  const result = await db.query(
    `
      SELECT l.complaint_id, d.id, d.name, COALESCE(d.is_active, TRUE) AS is_active
      FROM complaint_topic_links l
      JOIN complaint_topic_definitions d ON d.id = l.topic_id
      WHERE l.complaint_id = ANY($1::int[])
      ORDER BY LOWER(d.name) ASC
    `,
    [ids]
  );

  for (const row of result.rows) {
    const complaintId = Number(row.complaint_id);
    if (!topicMap.has(complaintId)) topicMap.set(complaintId, []);
    topicMap.get(complaintId).push(mapComplaintTopic(row));
  }

  return topicMap;
}

async function replaceComplaintTopics(db, complaintId, topicIds) {
  const ids = normalizeTopicIds(topicIds);

  await db.query('DELETE FROM complaint_topic_links WHERE complaint_id = $1', [complaintId]);

  for (const topicId of ids) {
    await db.query(
      `
        INSERT INTO complaint_topic_links (complaint_id, topic_id)
        VALUES ($1, $2)
        ON CONFLICT (complaint_id, topic_id) DO NOTHING
      `,
      [complaintId, topicId]
    );
  }
}

async function seedComplaintTopics() {
  for (const topicName of DEFAULT_COMPLAINT_TOPICS) {
    await pool.query(
      'INSERT INTO complaint_topic_definitions (name) VALUES ($1) ON CONFLICT (name) DO NOTHING',
      [topicName]
    );
  }
}

function mapComplaint(row) {
  const topics = Array.isArray(row.topics)
    ? row.topics.map(mapComplaintTopic)
    : [];

  return {
    id: row.id,
    no: row.complaint_no,
    date: toInputDate(row.complaint_date),
    displayDate: formatDate(row.complaint_date),
    subject: row.subject,
    summary: row.subject,
    topics: topics,
    topicNames: topics.map(function(topic) { return topic.name; }).join(", "),
    source: row.source,
    neighborhood: row.neighborhood || "",
    address: row.address || "",
    detail: row.detail || "",
    action: row.action_taken,
    status: row.status,
    note: row.note || "",
    processDate: toInputDate(row.process_date),
    processDateText: formatDate(row.process_date),
    closedDate: toInputDate(row.closed_date),
    closedDateText: formatDate(row.closed_date),
    controlDate: toInputDate(row.control_date),
    controlDateText: formatDate(row.control_date),
    createdAt: formatDateTime(row.created_at),
  };
}

function mapComplaintFile(row) {
  return {
    id: row.id,
    complaintId: row.complaint_id,
    fileType: row.file_type,
    category: row.category,
    description: row.description || "",
    originalName: row.original_name,
    mimeType: row.mime_type || "",
    fileSize: Number(row.file_size || 0),
    url: row.file_path ? row.file_path.replace(/\\/g, "/") : "",
    createdAt: formatDateTime(row.created_at),
    isImage: (row.mime_type || "").indexOf("image/") === 0
  };
}

function mapBusinessCategory(row) {
  return {
    id: row.id,
    name: row.name,
    createdAt: formatDateTime(row.created_at),
  };
}

function buildBusinessAddress(row) {
  const parts = [];

  const neighborhood = getCanonicalBusinessNeighborhood(row.neighborhood);
  if (neighborhood) parts.push(neighborhood + ' Mah.');
  if (row.street) parts.push(row.street);
  if (row.door_no) parts.push('No: ' + row.door_no);

  return parts.join(', ');
}

function formatCoordinate(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '';
  return num.toFixed(6);
}

function buildMapsUrl(lat, lng) {
  if (lat === null || lat === undefined || lng === null || lng === undefined) return '';
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(String(lat) + ',' + String(lng));
}

function buildBusinessMapsSearchUrl(row) {
  const addressParts = [];
  if (row.trade_name) addressParts.push(row.trade_name);
  const neighborhood = getCanonicalBusinessNeighborhood(row.neighborhood);
  if (neighborhood) addressParts.push(neighborhood + ' Mahallesi');
  if (row.street) addressParts.push(row.street);
  if (row.door_no) addressParts.push('No: ' + row.door_no);
  if (row.ada || row.parcel) addressParts.push([row.ada ? 'Ada ' + row.ada : '', row.parcel ? 'Parsel ' + row.parcel : ''].filter(Boolean).join(' '));
  addressParts.push('Bucak', 'Burdur', 'Türkiye');
  const query = addressParts.filter(Boolean).join(', ');
  if (!query) return '';
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(query);
}


const BUSINESS_NEIGHBORHOOD_ALIASES = {
  'barboros': 'Barbaros',
  'barbaros': 'Barbaros',
  'camii': 'Cami',
  'cami': 'Cami',
  'alaattin': 'Alaattin',
  'alaaddin': 'Alaattin',
  '70 evler': 'Yetmiş Evler',
  'yetmis evler': 'Yetmiş Evler',
  'yetmiş evler': 'Yetmiş Evler'
};

function normalizeTurkishKey(value) {
  return String(value || '')
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function getCanonicalBusinessNeighborhood(value) {
  if (!value) return '';
  const normalized = normalizeTurkishKey(value);
  return BUSINESS_NEIGHBORHOOD_ALIASES[normalized] || String(value);
}


function extractCoordinatesFromGoogleMapsUrl(rawValue) {
  if (!rawValue) return null;
  let value = String(rawValue).trim();
  try {
    value = decodeURIComponent(value);
  } catch (error) {}

  const patterns = [
    /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
    /[?&](?:q|query|ll|center)=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
    /(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/
  ];

  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match) {
      const lat = Number(match[1]);
      const lng = Number(match[2]);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        return { lat, lng };
      }
    }
  }

  return null;
}

function isGoogleMapsHost(hostname) {
  return hostname === 'google.com'
    || hostname.endsWith('.google.com')
    || hostname === 'goo.gl'
    || hostname.endsWith('.goo.gl')
    || hostname === 'maps.app.goo.gl';
}

function resolveRedirectUrl(url, depth = 0) {
  return new Promise((resolve, reject) => {
    if (depth > 5) {
      reject(new Error('Çok fazla yönlendirme var.'));
      return;
    }

    let parsed;
    try {
      parsed = new URL(url);
    } catch (error) {
      reject(new Error('Geçersiz bağlantı.'));
      return;
    }

    const request = https.get(parsed, {
      headers: {
        "User-Agent": "ZabitaYonetimSistemi/1.0 (google-maps-resolve)",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      }
    }, (response) => {
      const statusCode = Number(response.statusCode || 0);
      const location = response.headers.location;
      response.resume();

      if (location && statusCode >= 300 && statusCode < 400) {
        const nextUrl = new URL(location, parsed).toString();
        resolve(resolveRedirectUrl(nextUrl, depth + 1));
        return;
      }

      resolve(parsed.toString());
    });

    request.on('error', reject);
    request.setTimeout(12000, () => {
      request.destroy(new Error('Bağlantı çözümlenemedi.'));
    });
  });
}

function mapBusiness(row) {
  const lat = row.location_lat !== null && row.location_lat !== undefined ? Number(row.location_lat) : null;
  const lng = row.location_lng !== null && row.location_lng !== undefined ? Number(row.location_lng) : null;

  return {
    id: row.id,
    categoryId: row.category_id,
    categoryName: row.category_name || '',
    tradeName: row.trade_name,
    ownerName: row.owner_name,
    phone: row.phone || '',
    neighborhood: getCanonicalBusinessNeighborhood(row.neighborhood || ''),
    street: row.street || '',
    doorNo: row.door_no || '',
    ada: row.ada || '',
    parcel: row.parcel || '',
    addressText: buildBusinessAddress(row),
    locationLat: lat,
    locationLng: lng,
    locationText: lat !== null && lng !== null ? (formatCoordinate(lat) + ', ' + formatCoordinate(lng)) : '',
    mapsUrl: buildMapsUrl(lat, lng),
    addressMapsUrl: buildBusinessMapsSearchUrl(row),
    activitySubject: row.activity_subject || '',
    licenseStatus: row.license_status || 'Yok',
    licenseNo: row.license_no || '',
    licenseDate: toInputDate(row.license_date),
    licenseDateText: formatDate(row.license_date),
    businessClass: row.business_class || '',
    licenseNote: row.license_note || '',
    businessNote: row.business_note || '',
    createdAt: formatDateTime(row.created_at),
  };
}

function mapBusinessInspection(row) {
  return {
    id: row.id,
    businessId: row.business_id,
    inspectionDate: toInputDate(row.inspection_date),
    inspectionDateText: formatDate(row.inspection_date),
    inspectionType: row.inspection_type || '',
    resultStatus: row.result_status || '',
    actionTaken: row.action_taken || '',
    currentStatus: row.current_status || '',
    controlDate: toInputDate(row.control_date),
    controlDateText: formatDate(row.control_date),
    note: row.note || '',
    createdAt: formatDateTime(row.created_at),
  };
}

function mapBusinessFile(row) {
  const url = row.file_path ? row.file_path.replace(/\\/g, "/") : "";
  return {
    id: row.id,
    businessId: row.business_id,
    fileType: row.file_type || "",
    category: row.category || "",
    description: row.description || "",
    originalName: row.original_name || "",
    mimeType: row.mime_type || "",
    fileSize: Number(row.file_size || 0),
    url: url,
    createdAt: formatDateTime(row.created_at),
    isImage: (row.mime_type || "").indexOf("image/") === 0
  };
}

function mapBusinessInspectionFile(row) {
  const url = row.file_path ? row.file_path.replace(/\\/g, "/") : "";
  return {
    id: row.id,
    inspectionId: row.inspection_id,
    fileType: row.file_type || "",
    originalName: row.original_name || "",
    mimeType: row.mime_type || "",
    fileSize: Number(row.file_size || 0),
    url: url,
    createdAt: formatDateTime(row.created_at),
    isImage: (row.mime_type || "").indexOf("image/") === 0
  };
}

function mapInspectionFeed(row) {
  const base = mapBusinessInspection(row);
  return {
    ...base,
    tradeName: row.trade_name || '',
    ownerName: row.owner_name || '',
    phone: row.phone || '',
    categoryId: row.category_id || null,
    categoryName: row.category_name || '',
    neighborhood: getCanonicalBusinessNeighborhood(row.neighborhood || ''),
    street: row.street || '',
    doorNo: row.door_no || '',
    addressText: buildBusinessAddress(row),
    licenseStatus: row.license_status || 'Yok',
    mapsUrl: buildMapsUrl(row.location_lat, row.location_lng),
  };
}

function buildLicenseAddress(row) {
  const parts = [];
  const neighborhood = getCanonicalBusinessNeighborhood(row.neighborhood || '');
  if (neighborhood) parts.push(neighborhood + ' Mah.');
  if (row.street) parts.push(row.street);
  if (row.door_no) parts.push('No: ' + row.door_no);
  return parts.join(', ');
}

function buildLicenseBusinessCreationSuggestion(row) {
  const recordStatus = String(row && row.record_status || '');
  const processStatus = String(row && row.process_status || '');
  const businessId = row && row.business_id;
  const suggestedBusinessId = row && row.suggested_business_id;

  if (businessId) {
    return { eligible: false, note: 'Bu ruhsat zaten bir firmaya bağlı.' };
  }

  if (suggestedBusinessId) {
    return { eligible: false, note: 'Önce önerilen mevcut firma eşleşmesini değerlendir.' };
  }

  if (recordStatus !== 'Aktif') {
    return { eligible: false, note: 'Sadece aktif kayıtlar için firma önerisi hazırlanır.' };
  }

  if (processStatus !== 'Ruhsat Verildi') {
    return { eligible: false, note: 'Sadece ruhsat verildi durumundaki kayıtlar firmaya dönüştürülebilir.' };
  }

  const tradeName = normalizeMatchText(row && (row.trade_name || row.tradeName) || '');
  const ownerName = normalizeMatchText(row && (row.owner_name || row.ownerName) || '');
  const neighborhood = normalizeMatchText(getCanonicalBusinessNeighborhood(row && row.neighborhood || ''));
  const street = normalizeMatchText(row && row.street || '');

  if (!tradeName || !ownerName) {
    return { eligible: false, note: 'Ünvan ve sahip bilgisi eksik olduğu için firma önerisi oluşturulmadı.' };
  }

  if (!neighborhood || !street) {
    return { eligible: false, note: 'Mahalle ve cadde/sokak bilgisi olmadan firma önerisi çıkarılmaz.' };
  }

  return { eligible: true, note: 'Bu aktif ruhsattan yeni firma kaydı önerilebilir.' };
}

function mapLicense(row) {
  const creationSuggestion = buildLicenseBusinessCreationSuggestion(row);
  return {
    id: row.id,
    businessId: row.business_id,
    businessName: row.business_trade_name || '',
    categoryName: row.category_name || '',
    suggestedBusinessId: row.suggested_business_id || null,
    suggestedBusinessName: row.suggested_business_trade_name || '',
    suggestedCategoryName: row.suggested_category_name || '',
    matchStatus: row.match_status || (row.business_id ? 'Bağlandı' : 'Bağlantı Yok'),
    matchScore: Number(row.match_score || 0),
    matchNote: row.match_note || '',
    issueDate: toInputDate(row.issue_date),
    issueDateText: formatDate(row.issue_date),
    licenseSerialNo: row.license_serial_no || '',
    ownerName: row.owner_name || '',
    tradeName: row.trade_name || '',
    activitySubject: row.activity_subject || '',
    neighborhood: getCanonicalBusinessNeighborhood(row.neighborhood || ''),
    street: row.street || '',
    doorNo: row.door_no || '',
    ada: row.ada || '',
    parcel: row.parcel || '',
    usageArea: row.usage_area || '',
    otherUsageArea: row.other_usage_area || '',
    totalMotorPower: row.total_motor_power || '',
    workplaceClass: row.workplace_class || '',
    winterOpeningTime: row.winter_opening_time || '',
    winterClosingTime: row.winter_closing_time || '',
    summerOpeningTime: row.summer_opening_time || '',
    summerClosingTime: row.summer_closing_time || '',
    otherActivityAreas: row.other_activity_areas || '',
    identityNumber: row.identity_number || '',
    taxNumber: row.tax_number || '',
    policeChiefName: row.police_chief_name || '',
    mayorName: row.mayor_name || '',
    recordStatus: row.record_status || 'Aktif',
    processStatus: row.process_status || 'Ruhsat Verildi',
    applicationDate: toInputDate(row.application_date),
    applicationDateText: formatDate(row.application_date),
    applicationNo: row.application_no || '',
    applicationStage: row.application_stage || '',
    followupDate: toInputDate(row.followup_date),
    followupDateText: formatDate(row.followup_date),
    cancelDate: toInputDate(row.cancel_date),
    cancelDateText: formatDate(row.cancel_date),
    cancelReason: row.cancel_reason || '',
    notes: row.notes || '',
    addressText: buildLicenseAddress(row),
    createdAt: formatDateTime(row.created_at),
    updatedAt: formatDateTime(row.updated_at),
    canCreateBusinessSuggestion: creationSuggestion.eligible,
    createBusinessSuggestionNote: creationSuggestion.note,
  };
}

function buildLicenseBusinessSnapshot(licenseRow) {
  if (!licenseRow) {
    return {
      licenseStatus: 'Yok',
      licenseNo: '',
      licenseDate: null,
      businessClass: '',
      activitySubject: '',
      licenseNote: ''
    };
  }

  const processStatus = String(licenseRow.process_status || '');
  const recordStatus = String(licenseRow.record_status || '');

  let licenseStatus = 'Yok';
  if (processStatus !== 'Ruhsat Verildi') licenseStatus = 'Başvuru Aşamasında';
  else if (recordStatus === 'Aktif') licenseStatus = 'Var';

  return {
    licenseStatus: licenseStatus,
    licenseNo: licenseRow.license_serial_no || '',
    licenseDate: licenseRow.issue_date || null,
    businessClass: licenseRow.workplace_class || '',
    activitySubject: licenseRow.activity_subject || '',
    licenseNote: licenseRow.notes || ''
  };
}

async function updateBusinessLicenseSnapshot(businessId) {
  const latestResult = await pool.query(
    `
      SELECT *
      FROM licenses
      WHERE business_id = $1
      ORDER BY
        CASE
          WHEN process_status = 'Ruhsat Verildi' AND record_status = 'Aktif' THEN 1
          WHEN process_status <> 'Ruhsat Verildi' AND record_status <> 'İptal' THEN 2
          WHEN process_status = 'Ruhsat Verildi' AND record_status = 'Pasif' THEN 3
          WHEN record_status = 'İptal' THEN 4
          ELSE 5
        END,
        COALESCE(issue_date, application_date, updated_at, created_at) DESC,
        id DESC
      LIMIT 1
    `,
    [businessId]
  );

  const snapshot = buildLicenseBusinessSnapshot(latestResult.rows[0]);

  await pool.query(
    `
      UPDATE businesses
      SET
        license_status = $1,
        license_no = $2,
        license_date = $3,
        business_class = $4,
        activity_subject = CASE WHEN COALESCE(TRIM($5), '') <> '' THEN $5 ELSE activity_subject END,
        license_note = $6
      WHERE id = $7
    `,
    [
      snapshot.licenseStatus,
      snapshot.licenseNo,
      snapshot.licenseDate,
      snapshot.businessClass,
      snapshot.activitySubject,
      snapshot.licenseNote,
      businessId
    ]
  );
}

function safeUnlink(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    console.error("Dosya silinemedi:", error);
  }
}

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS complaints (
      id SERIAL PRIMARY KEY,
      complaint_no VARCHAR(30) UNIQUE NOT NULL,
      complaint_date DATE NOT NULL,
      subject VARCHAR(255) NOT NULL,
      source VARCHAR(100) NOT NULL,
      neighborhood VARCHAR(120),
      address TEXT,
      detail TEXT,
      action_taken VARCHAR(150) NOT NULL DEFAULT 'Henüz İşlem Yapılmadı',
      status VARCHAR(50) NOT NULL DEFAULT 'Açık',
      note TEXT,
      process_date DATE,
      closed_date DATE,
      control_date DATE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    ALTER TABLE complaints
    ADD COLUMN IF NOT EXISTS neighborhood VARCHAR(120)
  `);

  await pool.query(`
    ALTER TABLE complaints
    ADD COLUMN IF NOT EXISTS process_date DATE
  `);

  await pool.query(`
    ALTER TABLE complaints
    ADD COLUMN IF NOT EXISTS closed_date DATE
  `);

  await pool.query(`
    ALTER TABLE complaints
    ADD COLUMN IF NOT EXISTS control_date DATE
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS complaint_files (
      id SERIAL PRIMARY KEY,
      complaint_id INTEGER NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
      file_type VARCHAR(20) NOT NULL,
      category VARCHAR(100) NOT NULL,
      description TEXT,
      original_name VARCHAR(255) NOT NULL,
      stored_name VARCHAR(255) NOT NULL,
      file_path TEXT NOT NULL,
      mime_type VARCHAR(120),
      file_size BIGINT NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_complaint_files_complaint_id
    ON complaint_files(complaint_id)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS complaint_topic_definitions (
      id SERIAL PRIMARY KEY,
      name VARCHAR(120) UNIQUE NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    ALTER TABLE complaint_topic_definitions
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS complaint_topic_links (
      complaint_id INTEGER NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
      topic_id INTEGER NOT NULL REFERENCES complaint_topic_definitions(id) ON DELETE CASCADE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (complaint_id, topic_id)
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_complaint_topic_links_topic_id
    ON complaint_topic_links(topic_id)
  `);

  await seedComplaintTopics();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS business_categories (
      id SERIAL PRIMARY KEY,
      name VARCHAR(120) UNIQUE NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS businesses (
      id SERIAL PRIMARY KEY,
      category_id INTEGER REFERENCES business_categories(id) ON DELETE SET NULL,
      trade_name VARCHAR(255) NOT NULL,
      owner_name VARCHAR(255) NOT NULL,
      phone VARCHAR(30),
      neighborhood VARCHAR(120),
      street VARCHAR(150),
      door_no VARCHAR(50),
      ada VARCHAR(50),
      parcel VARCHAR(50),
      location_lat NUMERIC(10, 7),
      location_lng NUMERIC(10, 7),
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    ALTER TABLE businesses
    ADD COLUMN IF NOT EXISTS category_id INTEGER
  `);

  await pool.query(`
    ALTER TABLE businesses
    ADD COLUMN IF NOT EXISTS trade_name VARCHAR(255)
  `);

  await pool.query(`
    ALTER TABLE businesses
    ADD COLUMN IF NOT EXISTS owner_name VARCHAR(255)
  `);

  await pool.query(`
    ALTER TABLE businesses
    ADD COLUMN IF NOT EXISTS phone VARCHAR(30)
  `);

  await pool.query(`
    ALTER TABLE businesses
    ADD COLUMN IF NOT EXISTS neighborhood VARCHAR(120)
  `);

  await pool.query(`
    ALTER TABLE businesses
    ADD COLUMN IF NOT EXISTS street VARCHAR(150)
  `);

  await pool.query(`
    ALTER TABLE businesses
    ADD COLUMN IF NOT EXISTS door_no VARCHAR(50)
  `);

  await pool.query(`
    ALTER TABLE businesses
    ADD COLUMN IF NOT EXISTS ada VARCHAR(50)
  `);

  await pool.query(`
    ALTER TABLE businesses
    ADD COLUMN IF NOT EXISTS parcel VARCHAR(50)
  `);

  await pool.query(`
    ALTER TABLE businesses
    ADD COLUMN IF NOT EXISTS location_lat NUMERIC(10, 7)
  `);

  await pool.query(`
    ALTER TABLE businesses
    ADD COLUMN IF NOT EXISTS location_lng NUMERIC(10, 7)
  `);

  await pool.query(`
    ALTER TABLE businesses
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  `);

  await pool.query(`
    ALTER TABLE businesses
    ADD COLUMN IF NOT EXISTS activity_subject VARCHAR(255)
  `);

  await pool.query(`
    ALTER TABLE businesses
    ADD COLUMN IF NOT EXISTS license_status VARCHAR(20) DEFAULT 'Yok'
  `);

  await pool.query(`
    ALTER TABLE businesses
    ADD COLUMN IF NOT EXISTS license_no VARCHAR(120)
  `);

  await pool.query(`
    ALTER TABLE businesses
    ADD COLUMN IF NOT EXISTS license_date DATE
  `);

  await pool.query(`
    ALTER TABLE businesses
    ADD COLUMN IF NOT EXISTS business_class VARCHAR(120)
  `);

  await pool.query(`
    ALTER TABLE businesses
    ADD COLUMN IF NOT EXISTS license_note TEXT
  `);

  await pool.query(`
    ALTER TABLE businesses
    ADD COLUMN IF NOT EXISTS business_note TEXT
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_businesses_category_id
    ON businesses(category_id)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS business_inspections (
      id SERIAL PRIMARY KEY,
      business_id INTEGER REFERENCES businesses(id) ON DELETE CASCADE,
      inspection_date DATE NOT NULL,
      inspection_type VARCHAR(120),
      result_status VARCHAR(120),
      action_taken VARCHAR(255),
      current_status VARCHAR(60),
      control_date DATE,
      note TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_business_inspections_business_id
    ON business_inspections(business_id)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS business_files (
      id SERIAL PRIMARY KEY,
      business_id INTEGER REFERENCES businesses(id) ON DELETE CASCADE,
      file_type VARCHAR(20) NOT NULL,
      category VARCHAR(120) NOT NULL,
      description TEXT,
      original_name VARCHAR(255) NOT NULL,
      stored_name VARCHAR(255) NOT NULL,
      file_path TEXT NOT NULL,
      mime_type VARCHAR(120),
      file_size BIGINT NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_business_files_business_id
    ON business_files(business_id)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS business_inspection_files (
      id SERIAL PRIMARY KEY,
      inspection_id INTEGER NOT NULL REFERENCES business_inspections(id) ON DELETE CASCADE,
      file_type VARCHAR(20) NOT NULL,
      original_name VARCHAR(255) NOT NULL,
      stored_name VARCHAR(255) NOT NULL,
      file_path TEXT NOT NULL,
      mime_type VARCHAR(120),
      file_size BIGINT NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS licenses (
      id SERIAL PRIMARY KEY,
      business_id INTEGER REFERENCES businesses(id) ON DELETE CASCADE,
      issue_date DATE,
      license_serial_no VARCHAR(120),
      owner_name VARCHAR(255),
      trade_name VARCHAR(255),
      activity_subject VARCHAR(255),
      neighborhood VARCHAR(120),
      street VARCHAR(150),
      door_no VARCHAR(50),
      ada VARCHAR(50),
      parcel VARCHAR(50),
      usage_area VARCHAR(120),
      other_usage_area VARCHAR(255),
      total_motor_power VARCHAR(120),
      workplace_class VARCHAR(160),
      winter_opening_time VARCHAR(10),
      winter_closing_time VARCHAR(10),
      summer_opening_time VARCHAR(10),
      summer_closing_time VARCHAR(10),
      other_activity_areas TEXT,
      identity_number VARCHAR(20),
      tax_number VARCHAR(20),
      police_chief_name VARCHAR(255),
      mayor_name VARCHAR(255),
      record_status VARCHAR(30) NOT NULL DEFAULT 'Aktif',
      process_status VARCHAR(40) NOT NULL DEFAULT 'Ruhsat Verildi',
      application_date DATE,
      application_no VARCHAR(120),
      application_stage VARCHAR(255),
      followup_date DATE,
      cancel_date DATE,
      cancel_reason TEXT,
      notes TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    ALTER TABLE licenses
    ALTER COLUMN business_id DROP NOT NULL
  `);

  await pool.query(`
    ALTER TABLE licenses
    ADD COLUMN IF NOT EXISTS suggested_business_id INTEGER REFERENCES businesses(id) ON DELETE SET NULL
  `);

  await pool.query(`
    ALTER TABLE licenses
    ADD COLUMN IF NOT EXISTS match_status VARCHAR(30) NOT NULL DEFAULT 'Bağlantı Yok'
  `);

  await pool.query(`
    ALTER TABLE licenses
    ADD COLUMN IF NOT EXISTS match_score INTEGER NOT NULL DEFAULT 0
  `);

  await pool.query(`
    ALTER TABLE licenses
    ADD COLUMN IF NOT EXISTS match_note TEXT
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_licenses_business_id
    ON licenses(business_id)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_licenses_suggested_business_id
    ON licenses(suggested_business_id)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_licenses_record_status
    ON licenses(record_status)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_licenses_process_status
    ON licenses(process_status)
  `);

  await initMarketModuleDb(pool);

  const legacyLicenses = await pool.query(`
    SELECT *
    FROM businesses b
    WHERE (COALESCE(TRIM(b.license_no), '') <> '' OR b.license_date IS NOT NULL OR COALESCE(TRIM(b.business_class), '') <> '' OR COALESCE(TRIM(b.activity_subject), '') <> '' OR COALESCE(TRIM(b.license_note), '') <> '' OR COALESCE(TRIM(b.license_status), '') IN ('Var', 'Başvuru Aşamasında'))
      AND NOT EXISTS (SELECT 1 FROM licenses l WHERE l.business_id = b.id)
  `);

  for (const row of legacyLicenses.rows) {
    const isApplication = String(row.license_status || '') === 'Başvuru Aşamasında';
    await pool.query(
      `
        INSERT INTO licenses (
          business_id,
          issue_date,
          license_serial_no,
          owner_name,
          trade_name,
          activity_subject,
          neighborhood,
          street,
          door_no,
          ada,
          parcel,
          workplace_class,
          record_status,
          process_status,
          application_date,
          application_stage,
          notes
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      `,
      [
        row.id,
        row.license_date || null,
        row.license_no || '',
        row.owner_name || '',
        row.trade_name || '',
        row.activity_subject || '',
        row.neighborhood || '',
        row.street || '',
        row.door_no || '',
        row.ada || '',
        row.parcel || '',
        row.business_class || '',
        isApplication ? 'Pasif' : 'Aktif',
        isApplication ? 'Başvuru Alındı' : 'Ruhsat Verildi',
        isApplication ? (row.license_date || null) : null,
        isApplication ? 'Eski sistemden aktarıldı' : '',
        row.license_note || ''
      ]
    );
  }

  const businessIdsForSnapshot = await pool.query('SELECT id FROM businesses');
  for (const row of businessIdsForSnapshot.rows) {
    await updateBusinessLicenseSnapshot(row.id);
  }

  await refreshAllLicenseSuggestions();

  const defaultCategories = [
    'Market / Bakkal',
    'Pastahane / Tatlıcı',
    'Fırın',
    'Kasap',
    'Manav',
    'Kafe / Kahvehane',
    'Restoran / Lokanta',
    'Tekel Bayii',
    'Berber / Kuaför',
    'Kuruyemişçi'
  ];

  for (const categoryName of defaultCategories) {
    await pool.query(
      'INSERT INTO business_categories (name) VALUES ($1) ON CONFLICT (name) DO NOTHING',
      [categoryName]
    );
  }
}

async function nextComplaintNo() {
  const currentYear = new Date().getFullYear();
  const result = await pool.query(
    "SELECT complaint_no FROM complaints WHERE complaint_no LIKE $1 ORDER BY id DESC LIMIT 1",
    ["ŞKY-" + currentYear + "-%"]
  );

  let nextNumber = 1;

  if (result.rows.length > 0) {
    const lastNo = result.rows[0].complaint_no || "";
    const match = lastNo.match(/(\d+)$/);
    if (match) {
      nextNumber = Number(match[1]) + 1;
    }
  }

  return "ŞKY-" + currentYear + "-" + String(nextNumber).padStart(4, "0");
}

app.get("/api/complaints/next-no", async (req, res) => {
  try {
    const complaintNo = await nextComplaintNo();
    res.json({ complaintNo });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Yeni şikayet numarası üretilemedi." });
  }
});

app.get("/api/complaint-topics", async (req, res) => {
  try {
    const includeAll = req.query.all === "1" || req.query.all === "true";
    const result = await pool.query(
      includeAll
        ? "SELECT id, name, COALESCE(is_active, TRUE) AS is_active, created_at FROM complaint_topic_definitions ORDER BY LOWER(name) ASC"
        : "SELECT id, name, COALESCE(is_active, TRUE) AS is_active, created_at FROM complaint_topic_definitions WHERE COALESCE(is_active, TRUE) = TRUE ORDER BY LOWER(name) ASC"
    );
    res.json(result.rows.map(mapComplaintTopic));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Şikayet konuları alınamadı." });
  }
});

app.post("/api/complaint-topics", async (req, res) => {
  try {
    const name = String((req.body && req.body.name) || "").trim();
    if (!name) {
      return res.status(400).json({ error: "Konu adı zorunludur." });
    }

    const result = await pool.query(
      `
        INSERT INTO complaint_topic_definitions (name, is_active)
        VALUES ($1, TRUE)
        ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
        RETURNING id, name, COALESCE(is_active, TRUE) AS is_active, created_at
      `,
      [name]
    );

    res.status(201).json(mapComplaintTopic(result.rows[0]));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Konu başlığı eklenemedi." });
  }
});

app.put("/api/complaint-topics/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: "Geçersiz konu id." });
    }

    const updates = [];
    const values = [];

    if (typeof req.body.name !== "undefined") {
      const name = String(req.body.name || "").trim();
      if (!name) {
        return res.status(400).json({ error: "Konu adı boş olamaz." });
      }
      values.push(name);
      updates.push(`name = $${values.length}`);
    }

    if (typeof req.body.isActive !== "undefined") {
      values.push(!!req.body.isActive);
      updates.push(`is_active = $${values.length}`);
    }

    if (!updates.length) {
      return res.status(400).json({ error: "Güncellenecek alan bulunamadı." });
    }

    values.push(id);
    const result = await pool.query(
      `
        UPDATE complaint_topic_definitions
        SET ${updates.join(", ")}
        WHERE id = $${values.length}
        RETURNING id, name, COALESCE(is_active, TRUE) AS is_active, created_at
      `,
      values
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: "Konu başlığı bulunamadı." });
    }

    res.json(mapComplaintTopic(result.rows[0]));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Konu başlığı güncellenemedi." });
  }
});

app.get("/api/complaints", async (req, res) => {

  try {
    const result = await pool.query("SELECT * FROM complaints ORDER BY id DESC");
    const complaintIds = result.rows.map(function(row) { return Number(row.id); });
    const topicMap = await getComplaintTopicsMapForComplaintIds(complaintIds);
    res.json(result.rows.map(function(row) {
      return mapComplaint({
        ...row,
        topics: topicMap.get(Number(row.id)) || []
      });
    }));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Kayıtlar alınamadı." });
  }
});

app.post("/api/complaints", async (req, res) => {
  const client = await pool.connect();

  try {
    const {
      date,
      subject,
      source,
      neighborhood,
      address,
      detail,
      action,
      status,
      note,
      controlDate,
      topicIds,
    } = req.body;

    const normalizedTopicIds = normalizeTopicIds(topicIds);
    const topicRows = await getComplaintTopicRowsByIds(normalizedTopicIds, client);
    const finalSubject = String(subject || "").trim() || topicRows.map(function(row) { return row.name; }).join(", ");

    if (!date || !source || !finalSubject) {
      return res.status(400).json({ error: "Zorunlu alanları doldurun." });
    }

    const complaintNo = await nextComplaintNo();

    const finalAction = action || "Henüz İşlem Yapılmadı";
    const finalStatus = status || "Açık";

    const processDate = finalAction !== "Henüz İşlem Yapılmadı" ? date : null;
    const closedDate = finalStatus === "Kapatıldı" ? date : null;
    const finalControlDate = finalStatus === "Süre Verildi" ? (controlDate || null) : null;

    await client.query('BEGIN');

    const result = await client.query(
      `
        INSERT INTO complaints
          (
            complaint_no,
            complaint_date,
            subject,
            source,
            neighborhood,
            address,
            detail,
            action_taken,
            status,
            note,
            process_date,
            closed_date,
            control_date
          )
        VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        RETURNING *
      `,
      [
        complaintNo,
        date,
        finalSubject,
        source,
        (neighborhood || "").trim(),
        address || "",
        detail || "",
        finalAction,
        finalStatus,
        note || "",
        processDate,
        closedDate,
        finalControlDate,
      ]
    );

    await replaceComplaintTopics(client, result.rows[0].id, topicRows.map(function(row) { return row.id; }));
    await client.query('COMMIT');

    res.json(mapComplaint({
      ...result.rows[0],
      topics: topicRows
    }));
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (rollbackError) {}
    console.error(error);
    res.status(500).json({ error: "Kayıt eklenemedi." });
  } finally {
    client.release();
  }
});

app.put("/api/complaints/:id", async (req, res) => {
  const client = await pool.connect();

  try {
    const { id } = req.params;
    const {
      date,
      subject,
      source,
      neighborhood,
      address,
      detail,
      action,
      status,
      note,
      controlDate,
      topicIds,
    } = req.body;

    const normalizedTopicIds = normalizeTopicIds(topicIds);
    const topicRows = await getComplaintTopicRowsByIds(normalizedTopicIds, client);
    const finalSubject = String(subject || "").trim() || topicRows.map(function(row) { return row.name; }).join(", ");

    if (!date || !source || !finalSubject) {
      return res.status(400).json({ error: "Zorunlu alanları doldurun." });
    }

    const existingResult = await client.query(
      "SELECT * FROM complaints WHERE id = $1",
      [id]
    );

    if (existingResult.rows.length === 0) {
      return res.status(404).json({ error: "Kayıt bulunamadı." });
    }

    const existing = existingResult.rows[0];

    const finalAction = action || "Henüz İşlem Yapılmadı";
    const finalStatus = status || "Açık";

    const processDate =
      finalAction !== "Henüz İşlem Yapılmadı"
        ? (toInputDate(existing.process_date) || date)
        : null;

    const closedDate =
      finalStatus === "Kapatıldı"
        ? (toInputDate(existing.closed_date) || date)
        : null;

    const finalControlDate =
      finalStatus === "Süre Verildi"
        ? (controlDate || toInputDate(existing.control_date) || null)
        : null;

    await client.query('BEGIN');

    const result = await client.query(
      `
        UPDATE complaints
        SET
          complaint_date = $1,
          subject = $2,
          source = $3,
          neighborhood = $4,
          address = $5,
          detail = $6,
          action_taken = $7,
          status = $8,
          note = $9,
          process_date = $10,
          closed_date = $11,
          control_date = $12
        WHERE id = $13
        RETURNING *
      `,
      [
        date,
        finalSubject,
        source,
        (neighborhood || "").trim(),
        address || "",
        detail || "",
        finalAction,
        finalStatus,
        note || "",
        processDate,
        closedDate,
        finalControlDate,
        id,
      ]
    );

    await replaceComplaintTopics(client, id, topicRows.map(function(row) { return row.id; }));
    await client.query('COMMIT');

    res.json(mapComplaint({
      ...result.rows[0],
      topics: topicRows
    }));
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (rollbackError) {}
    console.error(error);
    res.status(500).json({ error: "Kayıt güncellenemedi." });
  } finally {
    client.release();
  }
});

app.delete("/api/complaints/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const filesResult = await pool.query("SELECT file_path FROM complaint_files WHERE complaint_id = $1", [id]);
    await pool.query("DELETE FROM complaints WHERE id = $1", [id]);

    for (const row of filesResult.rows) {
      const absolutePath = path.join(__dirname, row.file_path.replace(/^\/uploads\//, "uploads/"));
      safeUnlink(absolutePath);
    }

    const folderPath = path.join(complaintUploadsRoot, String(id));
    try {
      fs.rmSync(folderPath, { recursive: true, force: true });
    } catch (error) {
      console.error("Klasör silinemedi:", error);
    }

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Kayıt silinemedi." });
  }
});

app.get("/api/complaints/:id/files", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT * FROM complaint_files WHERE complaint_id = $1 ORDER BY id DESC`,
      [id]
    );

    res.json(result.rows.map(mapComplaintFile));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Ekler alınamadı." });
  }
});

app.post("/api/complaints/:id/files", upload.any(), async (req, res) => {
  try {
    const { id } = req.params;
    const { fileType, category, description } = req.body;
    const uploadedFiles = Array.isArray(req.files) ? req.files : (req.file ? [req.file] : []);

    if (!uploadedFiles.length) {
      return res.status(400).json({ error: "Dosya seçiniz." });
    }

    if (!fileType || !category) {
      uploadedFiles.forEach(function(file) { if (file && file.path) safeUnlink(file.path); });
      return res.status(400).json({ error: "Dosya türü ve kategori seçiniz." });
    }

    if (fileType === "document" && uploadedFiles.length > 1) {
      uploadedFiles.forEach(function(file) { if (file && file.path) safeUnlink(file.path); });
      return res.status(400).json({ error: "Evrak yüklemede aynı anda sadece 1 dosya seçebilirsiniz." });
    }

    const complaintResult = await pool.query("SELECT id FROM complaints WHERE id = $1", [id]);
    if (complaintResult.rows.length === 0) {
      uploadedFiles.forEach(function(file) { if (file && file.path) safeUnlink(file.path); });
      return res.status(404).json({ error: "Şikayet kaydı bulunamadı." });
    }

    const insertedRows = [];

    for (const uploadedFile of uploadedFiles) {
      const relativePath = "/uploads/complaints/" + id + "/" + uploadedFile.filename;

      const result = await pool.query(
        `
          INSERT INTO complaint_files
            (complaint_id, file_type, category, description, original_name, stored_name, file_path, mime_type, file_size)
          VALUES
            ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          RETURNING *
        `,
        [
          id,
          fileType,
          category,
          normalizeStoredText(description || ""),
          decodeUploadFilename(uploadedFile.originalname),
          uploadedFile.filename,
          relativePath,
          uploadedFile.mimetype || "",
          uploadedFile.size || 0,
        ]
      );

      insertedRows.push(mapComplaintFile(result.rows[0]));
    }

    res.json({
      success: true,
      uploadedCount: insertedRows.length,
      files: insertedRows
    });
  } catch (error) {
    console.error(error);
    const uploadedFiles = Array.isArray(req.files) ? req.files : (req.file ? [req.file] : []);
    uploadedFiles.forEach(function(file) { if (file && file.path) safeUnlink(file.path); });
    res.status(500).json({ error: "Dosya yüklenemedi." });
  }
});

app.delete("/api/complaint-files/:fileId", async (req, res) => {
  try {
    const { fileId } = req.params;
    const fileResult = await pool.query("SELECT * FROM complaint_files WHERE id = $1", [fileId]);

    if (fileResult.rows.length === 0) {
      return res.status(404).json({ error: "Dosya bulunamadı." });
    }

    const fileRow = fileResult.rows[0];
    const absolutePath = path.join(__dirname, fileRow.file_path.replace(/^\/uploads\//, "uploads/"));

    await pool.query("DELETE FROM complaint_files WHERE id = $1", [fileId]);
    safeUnlink(absolutePath);

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Dosya silinemedi." });
  }
});


app.get("/api/business-categories", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM business_categories ORDER BY name ASC");
    res.json(result.rows.map(mapBusinessCategory));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Kategoriler alınamadı." });
  }
});

app.post("/api/business-categories", async (req, res) => {
  try {
    const name = (req.body && req.body.name ? String(req.body.name) : "").trim();

    if (!name) {
      return res.status(400).json({ error: "Kategori adı giriniz." });
    }

    const result = await pool.query(
      `
        INSERT INTO business_categories (name)
        VALUES ($1)
        ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
        RETURNING *
      `,
      [name]
    );

    res.json(mapBusinessCategory(result.rows[0]));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Kategori kaydedilemedi." });
  }
});

app.get("/api/businesses", async (req, res) => {
  try {
    const result = await pool.query(
      `
        SELECT
          b.*, bc.name AS category_name
        FROM businesses b
        LEFT JOIN business_categories bc ON bc.id = b.category_id
        ORDER BY b.id DESC
      `
    );

    res.json(result.rows.map(mapBusiness));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "İşyerleri alınamadı." });
  }
});

app.get('/api/businesses/export.xlsx', async (req, res) => {
  try {
    const filters = await enrichBusinessExportFilters(normalizeBusinessExportFilters(req.query));
    const allRows = await queryBusinessList();
    const rows = filterBusinessRows(allRows, filters);
    const workbook = createBusinessWorkbook(rows, filters);
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    const fileName = buildBusinessExportFileName(filters);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="' + fileName + '"');
    res.send(buffer);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Firma Excel çıktısı oluşturulamadı.' });
  }
});

app.get("/api/businesses/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `
        SELECT
          b.*, bc.name AS category_name
        FROM businesses b
        LEFT JOIN business_categories bc ON bc.id = b.category_id
        WHERE b.id = $1
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "İşyeri bulunamadı." });
    }

    res.json(mapBusiness(result.rows[0]));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "İşyeri detayı alınamadı." });
  }
});

app.post("/api/businesses", async (req, res) => {
  try {
    const {
      categoryId,
      tradeName,
      ownerName,
      phone,
      neighborhood,
      street,
      doorNo,
      ada,
      parcel,
      locationLat,
      locationLng,
    } = req.body || {};

    if (!categoryId || !tradeName || !ownerName) {
      return res.status(400).json({ error: "Kategori, işyeri ünvanı ve işyeri sahibi zorunludur." });
    }

    const result = await pool.query(
      `
        INSERT INTO businesses
          (
            category_id,
            trade_name,
            owner_name,
            phone,
            neighborhood,
            street,
            door_no,
            ada,
            parcel,
            location_lat,
            location_lng
          )
        VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING *
      `,
      [
        Number(categoryId),
        String(tradeName).trim(),
        String(ownerName).trim(),
        phone ? String(phone).trim() : "",
        neighborhood ? String(neighborhood).trim() : "",
        street ? String(street).trim() : "",
        doorNo ? String(doorNo).trim() : "",
        ada ? String(ada).trim() : "",
        parcel ? String(parcel).trim() : "",
        locationLat !== "" && locationLat !== null && locationLat !== undefined ? Number(locationLat) : null,
        locationLng !== "" && locationLng !== null && locationLng !== undefined ? Number(locationLng) : null,
      ]
    );

    await refreshAllLicenseSuggestions();

    const fullResult = await pool.query(
      `
        SELECT
          b.*, bc.name AS category_name
        FROM businesses b
        LEFT JOIN business_categories bc ON bc.id = b.category_id
        WHERE b.id = $1
      `,
      [result.rows[0].id]
    );

    res.json(mapBusiness(fullResult.rows[0]));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "İşyeri kaydedilemedi." });
  }
});

app.put("/api/businesses/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      categoryId,
      tradeName,
      ownerName,
      phone,
      neighborhood,
      street,
      doorNo,
      ada,
      parcel,
      locationLat,
      locationLng,
    } = req.body || {};

    if (!categoryId || !tradeName || !ownerName) {
      return res.status(400).json({ error: "Kategori, işyeri ünvanı ve işyeri sahibi zorunludur." });
    }

    const exists = await pool.query("SELECT id FROM businesses WHERE id = $1", [id]);
    if (exists.rows.length === 0) {
      return res.status(404).json({ error: "İşyeri bulunamadı." });
    }

    await pool.query(
      `
        UPDATE businesses
        SET
          category_id = $1,
          trade_name = $2,
          owner_name = $3,
          phone = $4,
          neighborhood = $5,
          street = $6,
          door_no = $7,
          ada = $8,
          parcel = $9,
          location_lat = $10,
          location_lng = $11
        WHERE id = $12
      `,
      [
        Number(categoryId),
        String(tradeName).trim(),
        String(ownerName).trim(),
        phone ? String(phone).trim() : "",
        neighborhood ? String(neighborhood).trim() : "",
        street ? String(street).trim() : "",
        doorNo ? String(doorNo).trim() : "",
        ada ? String(ada).trim() : "",
        parcel ? String(parcel).trim() : "",
        locationLat !== "" && locationLat !== null && locationLat !== undefined ? Number(locationLat) : null,
        locationLng !== "" && locationLng !== null && locationLng !== undefined ? Number(locationLng) : null,
        id,
      ]
    );

    await refreshAllLicenseSuggestions();

    const fullResult = await pool.query(
      `
        SELECT
          b.*, bc.name AS category_name
        FROM businesses b
        LEFT JOIN business_categories bc ON bc.id = b.category_id
        WHERE b.id = $1
      `,
      [id]
    );

    res.json(mapBusiness(fullResult.rows[0]));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "İşyeri güncellenemedi." });
  }
});

app.delete("/api/businesses/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const filesResult = await pool.query("SELECT file_path FROM business_files WHERE business_id = $1", [id]);
    const inspectionFilesResult = await pool.query(
      `
        SELECT bif.file_path, bif.inspection_id
        FROM business_inspection_files bif
        INNER JOIN business_inspections bi ON bi.id = bif.inspection_id
        WHERE bi.business_id = $1
      `,
      [id]
    );
    await pool.query("DELETE FROM businesses WHERE id = $1", [id]);

    for (const row of filesResult.rows) {
      const absolutePath = path.join(__dirname, row.file_path.replace(/^\/uploads\//, "uploads/"));
      safeUnlink(absolutePath);
    }

    for (const row of inspectionFilesResult.rows) {
      const absolutePath = path.join(__dirname, row.file_path.replace(/^\/uploads\//, "uploads/"));
      safeUnlink(absolutePath);
    }

    const folderPath = path.join(businessUploadsRoot, String(id));
    try {
      fs.rmSync(folderPath, { recursive: true, force: true });
    } catch (folderError) {
      console.error("Firma klasörü silinemedi:", folderError);
    }

    const inspectionIds = [...new Set(inspectionFilesResult.rows.map(function(row) { return String(row.inspection_id); }))];
    inspectionIds.forEach(function(inspectionId) {
      try {
        fs.rmSync(path.join(businessInspectionUploadsRoot, inspectionId), { recursive: true, force: true });
      } catch (folderError) {
        console.error("Denetim dosya klasörü silinemedi:", folderError);
      }
    });

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "İşyeri silinemedi." });
  }
});


app.put("/api/businesses/:id/license", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      activitySubject,
      licenseStatus,
      licenseNo,
      licenseDate,
      businessClass,
      licenseNote,
    } = req.body || {};

    const exists = await pool.query("SELECT id FROM businesses WHERE id = $1", [id]);
    if (exists.rows.length === 0) {
      return res.status(404).json({ error: "İşyeri bulunamadı." });
    }

    await pool.query(
      `
        UPDATE businesses
        SET
          activity_subject = $1,
          license_status = $2,
          license_no = $3,
          license_date = $4,
          business_class = $5,
          license_note = $6
        WHERE id = $7
      `,
      [
        activitySubject ? String(activitySubject).trim() : '',
        licenseStatus ? String(licenseStatus).trim() : 'Yok',
        licenseNo ? String(licenseNo).trim() : '',
        licenseDate ? licenseDate : null,
        businessClass ? String(businessClass).trim() : '',
        licenseNote ? String(licenseNote).trim() : '',
        id,
      ]
    );

    const fullResult = await pool.query(
      `
        SELECT
          b.*, bc.name AS category_name
        FROM businesses b
        LEFT JOIN business_categories bc ON bc.id = b.category_id
        WHERE b.id = $1
      `,
      [id]
    );

    res.json(mapBusiness(fullResult.rows[0]));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Ruhsat bilgisi kaydedilemedi." });
  }
});

app.get("/api/businesses/:id/inspections", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `
        SELECT *
        FROM business_inspections
        WHERE business_id = $1
        ORDER BY inspection_date DESC, id DESC
      `,
      [id]
    );

    res.json(result.rows.map(mapBusinessInspection));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Denetim geçmişi alınamadı." });
  }
});

app.post("/api/businesses/:id/inspections", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      inspectionDate,
      inspectionType,
      resultStatus,
      actionTaken,
      currentStatus,
      controlDate,
      note,
    } = req.body || {};

    if (!inspectionDate) {
      return res.status(400).json({ error: "Denetim tarihi zorunludur." });
    }

    const exists = await pool.query("SELECT id FROM businesses WHERE id = $1", [id]);
    if (exists.rows.length === 0) {
      return res.status(404).json({ error: "İşyeri bulunamadı." });
    }

    const result = await pool.query(
      `
        INSERT INTO business_inspections
          (
            business_id,
            inspection_date,
            inspection_type,
            result_status,
            action_taken,
            current_status,
            control_date,
            note
          )
        VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
      `,
      [
        id,
        inspectionDate,
        inspectionType ? String(inspectionType).trim() : '',
        resultStatus ? String(resultStatus).trim() : '',
        actionTaken ? String(actionTaken).trim() : '',
        currentStatus ? String(currentStatus).trim() : '',
        currentStatus === 'Süre Verildi' && controlDate ? controlDate : null,
        note ? String(note).trim() : '',
      ]
    );

    res.json(mapBusinessInspection(result.rows[0]));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Denetim kaydı eklenemedi." });
  }
});

app.put("/api/businesses/:id/inspections/:inspectionId", async (req, res) => {
  try {
    const { id, inspectionId } = req.params;
    const {
      inspectionDate,
      inspectionType,
      resultStatus,
      actionTaken,
      currentStatus,
      controlDate,
      note,
    } = req.body || {};

    if (!inspectionDate) {
      return res.status(400).json({ error: "Denetim tarihi zorunludur." });
    }

    const exists = await pool.query(
      "SELECT id FROM business_inspections WHERE id = $1 AND business_id = $2",
      [inspectionId, id]
    );
    if (exists.rows.length === 0) {
      return res.status(404).json({ error: "Denetim kaydı bulunamadı." });
    }

    const result = await pool.query(
      `
        UPDATE business_inspections
        SET
          inspection_date = $1,
          inspection_type = $2,
          result_status = $3,
          action_taken = $4,
          current_status = $5,
          control_date = $6,
          note = $7
        WHERE id = $8 AND business_id = $9
        RETURNING *
      `,
      [
        inspectionDate,
        inspectionType ? String(inspectionType).trim() : '',
        resultStatus ? String(resultStatus).trim() : '',
        actionTaken ? String(actionTaken).trim() : '',
        currentStatus ? String(currentStatus).trim() : '',
        currentStatus === 'Süre Verildi' && controlDate ? controlDate : null,
        note ? String(note).trim() : '',
        inspectionId,
        id,
      ]
    );

    res.json(mapBusinessInspection(result.rows[0]));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Denetim kaydı güncellenemedi." });
  }
});

app.delete("/api/businesses/:id/inspections/:inspectionId", async (req, res) => {
  try {
    const { id, inspectionId } = req.params;
    const fileResult = await pool.query(
      `
        SELECT bif.file_path
        FROM business_inspection_files bif
        INNER JOIN business_inspections bi ON bi.id = bif.inspection_id
        WHERE bif.inspection_id = $1 AND bi.business_id = $2
      `,
      [inspectionId, id]
    );

    await pool.query(
      "DELETE FROM business_inspections WHERE id = $1 AND business_id = $2",
      [inspectionId, id]
    );

    fileResult.rows.forEach(function(row) {
      const absolutePath = path.join(__dirname, row.file_path.replace(/^\/uploads\//, "uploads/"));
      safeUnlink(absolutePath);
    });

    try {
      fs.rmSync(path.join(businessInspectionUploadsRoot, String(inspectionId)), { recursive: true, force: true });
    } catch (folderError) {
      console.error("Denetim klasörü silinemedi:", folderError);
    }

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Denetim kaydı silinemedi." });
  }
});

app.get("/api/businesses/:id/files", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT * FROM business_files WHERE business_id = $1 ORDER BY id DESC`,
      [id]
    );
    res.json(result.rows.map(mapBusinessFile));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Firma dosyaları alınamadı." });
  }
});

app.post("/api/businesses/:id/files", businessUpload.any(), async (req, res) => {
  try {
    const { id } = req.params;
    const { fileType, category, description } = req.body || {};
    const uploadedFiles = Array.isArray(req.files) ? req.files : (req.file ? [req.file] : []);

    if (!uploadedFiles.length) {
      return res.status(400).json({ error: "Dosya seçiniz." });
    }

    if (!fileType || !category) {
      uploadedFiles.forEach(function(file) { if (file && file.path) safeUnlink(file.path); });
      return res.status(400).json({ error: "Dosya türü ve kategori seçiniz." });
    }

    if (fileType === "document" && uploadedFiles.length > 1) {
      uploadedFiles.forEach(function(file) { if (file && file.path) safeUnlink(file.path); });
      return res.status(400).json({ error: "Evrak yüklemede aynı anda sadece 1 dosya seçebilirsiniz." });
    }

    const businessResult = await pool.query("SELECT id FROM businesses WHERE id = $1", [id]);
    if (businessResult.rows.length === 0) {
      uploadedFiles.forEach(function(file) { if (file && file.path) safeUnlink(file.path); });
      return res.status(404).json({ error: "Firma bulunamadı." });
    }

    if (fileType === "photo") {
      const invalidPhoto = uploadedFiles.find(function(file) {
        return !file.mimetype || file.mimetype.indexOf("image/") !== 0;
      });
      if (invalidPhoto) {
        uploadedFiles.forEach(function(file) { if (file && file.path) safeUnlink(file.path); });
        return res.status(400).json({ error: "Fotoğraf yüklemede sadece görsel dosyaları kabul edilir." });
      }
    }

    const insertedRows = [];
    for (const uploadedFile of uploadedFiles) {
      const relativePath = "/uploads/businesses/" + id + "/" + uploadedFile.filename;
      const result = await pool.query(
        `
          INSERT INTO business_files
            (business_id, file_type, category, description, original_name, stored_name, file_path, mime_type, file_size)
          VALUES
            ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          RETURNING *
        `,
        [
          id,
          fileType,
          category,
          normalizeStoredText(description || ""),
          decodeUploadFilename(uploadedFile.originalname),
          uploadedFile.filename,
          relativePath,
          uploadedFile.mimetype || "",
          uploadedFile.size || 0,
        ]
      );
      insertedRows.push(mapBusinessFile(result.rows[0]));
    }

    res.json({ success: true, uploadedCount: insertedRows.length, files: insertedRows });
  } catch (error) {
    console.error(error);
    const uploadedFiles = Array.isArray(req.files) ? req.files : (req.file ? [req.file] : []);
    uploadedFiles.forEach(function(file) { if (file && file.path) safeUnlink(file.path); });
    res.status(500).json({ error: "Firma dosyası yüklenemedi." });
  }
});

app.delete("/api/business-files/:fileId", async (req, res) => {
  try {
    const { fileId } = req.params;
    const fileResult = await pool.query("SELECT * FROM business_files WHERE id = $1", [fileId]);

    if (fileResult.rows.length === 0) {
      return res.status(404).json({ error: "Dosya bulunamadı." });
    }

    const fileRow = fileResult.rows[0];
    const absolutePath = path.join(__dirname, fileRow.file_path.replace(/^\/uploads\//, "uploads/"));

    await pool.query("DELETE FROM business_files WHERE id = $1", [fileId]);
    safeUnlink(absolutePath);

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Dosya silinemedi." });
  }
});

app.get("/api/businesses/:id/inspection-files", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `
        SELECT bif.*
        FROM business_inspection_files bif
        INNER JOIN business_inspections bi ON bi.id = bif.inspection_id
        WHERE bi.business_id = $1
        ORDER BY bif.created_at DESC, bif.id DESC
      `,
      [id]
    );
    res.json(result.rows.map(mapBusinessInspectionFile));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Denetim dosyaları alınamadı." });
  }
});

app.post("/api/business-inspections/:inspectionId/files", inspectionFileUpload.any(), async (req, res) => {
  try {
    const { inspectionId } = req.params;
    const { fileType } = req.body || {};
    const uploadedFiles = Array.isArray(req.files) ? req.files : (req.file ? [req.file] : []);

    if (!uploadedFiles.length) {
      return res.status(400).json({ error: "Dosya seçiniz." });
    }

    if (!fileType) {
      uploadedFiles.forEach(function(file) { if (file && file.path) safeUnlink(file.path); });
      return res.status(400).json({ error: "Dosya türü seçiniz." });
    }

    if (fileType === "document" && uploadedFiles.length > 1) {
      uploadedFiles.forEach(function(file) { if (file && file.path) safeUnlink(file.path); });
      return res.status(400).json({ error: "Evrak yüklemede aynı anda sadece 1 dosya seçebilirsiniz." });
    }

    const inspectionResult = await pool.query("SELECT id FROM business_inspections WHERE id = $1", [inspectionId]);
    if (inspectionResult.rows.length === 0) {
      uploadedFiles.forEach(function(file) { if (file && file.path) safeUnlink(file.path); });
      return res.status(404).json({ error: "Denetim kaydı bulunamadı." });
    }

    if (fileType === "photo") {
      const invalidPhoto = uploadedFiles.find(function(file) {
        return !file.mimetype || file.mimetype.indexOf("image/") !== 0;
      });
      if (invalidPhoto) {
        uploadedFiles.forEach(function(file) { if (file && file.path) safeUnlink(file.path); });
        return res.status(400).json({ error: "Fotoğraf yüklemede sadece görsel dosyaları kabul edilir." });
      }
    }

    const insertedRows = [];
    for (const uploadedFile of uploadedFiles) {
      const relativePath = "/uploads/business-inspections/" + inspectionId + "/" + uploadedFile.filename;
      const result = await pool.query(
        `
          INSERT INTO business_inspection_files
            (inspection_id, file_type, original_name, stored_name, file_path, mime_type, file_size)
          VALUES
            ($1, $2, $3, $4, $5, $6, $7)
          RETURNING *
        `,
        [
          inspectionId,
          fileType,
          decodeUploadFilename(uploadedFile.originalname),
          uploadedFile.filename,
          relativePath,
          uploadedFile.mimetype || "",
          uploadedFile.size || 0,
        ]
      );
      insertedRows.push(mapBusinessInspectionFile(result.rows[0]));
    }

    res.json({ success: true, uploadedCount: insertedRows.length, files: insertedRows });
  } catch (error) {
    console.error(error);
    const uploadedFiles = Array.isArray(req.files) ? req.files : (req.file ? [req.file] : []);
    uploadedFiles.forEach(function(file) { if (file && file.path) safeUnlink(file.path); });
    res.status(500).json({ error: "Denetim dosyası yüklenemedi." });
  }
});

app.delete("/api/business-inspection-files/:fileId", async (req, res) => {
  try {
    const { fileId } = req.params;
    const fileResult = await pool.query("SELECT * FROM business_inspection_files WHERE id = $1", [fileId]);

    if (fileResult.rows.length === 0) {
      return res.status(404).json({ error: "Dosya bulunamadı." });
    }

    const fileRow = fileResult.rows[0];
    const absolutePath = path.join(__dirname, fileRow.file_path.replace(/^\/uploads\//, "uploads/"));

    await pool.query("DELETE FROM business_inspection_files WHERE id = $1", [fileId]);
    safeUnlink(absolutePath);

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Dosya silinemedi." });
  }
});

function buildInspectionFeedFilters(rawQuery = {}) {
  return {
    month: rawQuery.month ? String(rawQuery.month).trim() : '',
    categoryId: rawQuery.categoryId && String(rawQuery.categoryId).trim() !== 'all' ? Number(rawQuery.categoryId) : null,
    resultStatus: rawQuery.resultStatus && String(rawQuery.resultStatus).trim() !== 'all' ? String(rawQuery.resultStatus).trim() : '',
    currentStatus: rawQuery.currentStatus && String(rawQuery.currentStatus).trim() !== 'all' ? String(rawQuery.currentStatus).trim() : '',
    licenseStatus: rawQuery.licenseStatus && String(rawQuery.licenseStatus).trim() !== 'all' ? String(rawQuery.licenseStatus).trim() : '',
    search: rawQuery.search ? String(rawQuery.search).trim() : '',
    categoryName: rawQuery.categoryName ? String(rawQuery.categoryName).trim() : '',
  };
}

function buildInspectionFeedQuery(filters = {}) {
  const { month, categoryId, resultStatus, currentStatus, licenseStatus, search } = buildInspectionFeedFilters(filters);
  const conditions = [];
  const values = [];

  if (month) {
    values.push(String(month) + '-01');
    conditions.push("DATE_TRUNC('month', bi.inspection_date) = DATE_TRUNC('month', $" + values.length + "::date)");
  }

  if (Number.isFinite(categoryId) && categoryId > 0) {
    values.push(categoryId);
    conditions.push("b.category_id = $" + values.length);
  }

  if (resultStatus) {
    values.push(resultStatus);
    conditions.push("COALESCE(bi.result_status, '') = $" + values.length);
  }

  if (currentStatus) {
    values.push(currentStatus);
    conditions.push("COALESCE(bi.current_status, '') = $" + values.length);
  }

  if (licenseStatus) {
    values.push(licenseStatus);
    conditions.push("COALESCE(b.license_status, 'Yok') = $" + values.length);
  }

  if (search) {
    values.push('%' + search + '%');
    const idx = values.length;
    conditions.push("(COALESCE(b.trade_name, '') ILIKE $" + idx + " OR COALESCE(b.owner_name, '') ILIKE $" + idx + " OR COALESCE(b.phone, '') ILIKE $" + idx + " OR COALESCE(bc.name, '') ILIKE $" + idx + " OR COALESCE(b.neighborhood, '') ILIKE $" + idx + " OR COALESCE(b.street, '') ILIKE $" + idx + ")");
  }

  const whereSql = conditions.length ? ('WHERE ' + conditions.join(' AND ')) : '';

  return {
    whereSql,
    values,
    filters: { month, categoryId, resultStatus, currentStatus, licenseStatus, search }
  };
}

async function queryInspectionFeed(rawQuery = {}) {
  const { whereSql, values, filters } = buildInspectionFeedQuery(rawQuery);
  const result = await pool.query(
    `
      SELECT
        bi.*,
        b.trade_name,
        b.owner_name,
        b.phone,
        b.category_id,
        bc.name AS category_name,
        b.neighborhood,
        b.street,
        b.door_no,
        b.license_status,
        b.location_lat,
        b.location_lng
      FROM business_inspections bi
      INNER JOIN businesses b ON b.id = bi.business_id
      LEFT JOIN business_categories bc ON bc.id = b.category_id
      ${whereSql}
      ORDER BY bi.inspection_date DESC, bi.id DESC
    `,
    values
  );

  return {
    rows: result.rows.map(mapInspectionFeed),
    filters
  };
}

function buildInspectionExportFileName(filters = {}) {
  const monthText = filters.month ? filters.month.replace(/[^0-9-]/g, '') : 'tum-kayitlar';
  return 'toplu-denetimler-' + monthText + '.xlsx';
}

async function queryBusinessList() {
  const result = await pool.query(
    `
      SELECT
        b.*, bc.name AS category_name
      FROM businesses b
      LEFT JOIN business_categories bc ON bc.id = b.category_id
      ORDER BY b.id DESC
    `
  );

  return result.rows.map(mapBusiness);
}

function normalizeBusinessExportFilters(rawQuery = {}) {
  const categoryId = rawQuery.categoryId ? String(rawQuery.categoryId) : '';
  const licenseStatus = rawQuery.licenseStatus ? String(rawQuery.licenseStatus) : 'all';
  const locationFilter = rawQuery.locationFilter ? String(rawQuery.locationFilter) : 'all';
  const search = rawQuery.search ? String(rawQuery.search).trim() : '';

  return {
    categoryId,
    licenseStatus,
    locationFilter,
    search,
  };
}

function filterBusinessRows(rows, filters = {}) {
  const search = String(filters.search || '').toLocaleLowerCase('tr-TR');
  const categoryId = String(filters.categoryId || '');
  const licenseFilter = String(filters.licenseStatus || 'all');
  const locationFilter = String(filters.locationFilter || 'all');

  return rows.filter((item) => {
    const matchesCategory = !categoryId || String(item.categoryId) === categoryId;
    const normalizedLicense = String(item.licenseStatus || 'Yok');
    const matchesLicense = licenseFilter === 'all' || normalizedLicense === licenseFilter || (licenseFilter === 'İptal / Pasif' && normalizedLicense === 'Yok');
    const hasLocation = item.locationLat !== null && item.locationLng !== null;
    const matchesLocation = locationFilter === 'all' || (locationFilter === 'with' ? hasLocation : !hasLocation);
    const text = [
      item.categoryName,
      item.tradeName,
      item.ownerName,
      item.phone,
      item.neighborhood,
      item.street,
      item.doorNo,
      item.ada,
      item.parcel,
      item.licenseStatus
    ].join(' ').toLocaleLowerCase('tr-TR');
    const matchesSearch = !search || text.indexOf(search) !== -1;
    return matchesCategory && matchesLicense && matchesLocation && matchesSearch;
  });
}

async function enrichBusinessExportFilters(filters = {}) {
  const enriched = { ...filters, categoryName: 'Tüm kategoriler' };
  if (!filters.categoryId) return enriched;

  const categoryResult = await pool.query(
    'SELECT name FROM business_categories WHERE id = $1 LIMIT 1',
    [Number(filters.categoryId)]
  );

  if (categoryResult.rows.length) {
    enriched.categoryName = categoryResult.rows[0].name;
  } else {
    enriched.categoryName = 'Kategori #' + String(filters.categoryId);
  }

  return enriched;
}

function buildBusinessExportFileName(filters = {}) {
  const categoryText = filters.categoryName && filters.categoryName !== 'Tüm kategoriler'
    ? String(filters.categoryName).toLocaleLowerCase('tr-TR').replace(/[^a-z0-9çğıöşü]+/gi, '-').replace(/^-+|-+$/g, '')
    : 'tum-firmalar';
  return 'firma-listesi-' + (categoryText || 'tum-firmalar') + '.xlsx';
}

function buildBusinessSummaryRows(rows, filters = {}) {
  let withLocation = 0;
  let withoutLocation = 0;
  let licenseYes = 0;
  let licenseNo = 0;
  let licensePending = 0;

  rows.forEach((item) => {
    const hasLocation = item.locationLat !== null && item.locationLng !== null;
    if (hasLocation) withLocation += 1;
    else withoutLocation += 1;

    if (item.licenseStatus === 'Var') licenseYes += 1;
    else if (item.licenseStatus === 'Başvuru Aşamasında') licensePending += 1;
    else licenseNo += 1;
  });

  return [
    { 'Alan': 'Kategori', 'Değer': filters.categoryName || 'Tüm kategoriler' },
    { 'Alan': 'Ruhsat Durumu', 'Değer': filters.licenseStatus === 'all' ? 'Tüm ruhsat durumları' : (filters.licenseStatus || 'Tüm ruhsat durumları') },
    { 'Alan': 'Konum Filtresi', 'Değer': filters.locationFilter === 'with' ? 'Konumu olanlar' : (filters.locationFilter === 'without' ? 'Konumu olmayanlar' : 'Tüm konumlar') },
    { 'Alan': 'Arama', 'Değer': filters.search || '-' },
    { 'Alan': 'Toplam Firma', 'Değer': rows.length },
    { 'Alan': 'Konumu Olan', 'Değer': withLocation },
    { 'Alan': 'Konumu Olmayan', 'Değer': withoutLocation },
    { 'Alan': 'Ruhsatlı', 'Değer': licenseYes },
    { 'Alan': 'Ruhsatsız', 'Değer': licenseNo },
    { 'Alan': 'Başvuru Aşamasında', 'Değer': licensePending },
    { 'Alan': 'Oluşturulma Tarihi', 'Değer': formatDateTime(new Date()) },
  ];
}

function createBusinessWorkbook(rows, filters = {}) {
  const workbook = XLSX.utils.book_new();

  const summaryRows = buildBusinessSummaryRows(rows, filters);
  const summarySheet = XLSX.utils.json_to_sheet(summaryRows, { header: ['Alan', 'Değer'] });
  summarySheet['!cols'] = [{ wch: 24 }, { wch: 42 }];
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Filtre Özeti');

  const dataRows = rows.map((item, index) => ({
    'Sıra': index + 1,
    'Kategori': item.categoryName || '',
    'İşyeri Ünvanı': item.tradeName || '',
    'İşyeri Sahibi': item.ownerName || '',
    'Telefon': item.phone || '',
    'Mahalle': item.neighborhood ? item.neighborhood + ' Mah.' : '',
    'Cadde / Sokak': item.street || '',
    'Kapı No': item.doorNo || '',
    'Tam Adres': item.addressText || '',
    'Ada': item.ada || '',
    'Parsel': item.parcel || '',
    'Ruhsat Durumu': item.licenseStatus || 'Yok',
    'Ruhsat No': item.licenseNo || '',
    'Ruhsat Tarihi': item.licenseDateText || '',
    'Faaliyet Konusu': item.activitySubject || '',
    'İşyeri Sınıfı / Türü': item.businessClass || '',
    'Konum': item.locationText || '',
    'Harita Linki': item.mapsUrl || item.addressMapsUrl || '',
    'Kayıt Zamanı': item.createdAt || '',
  }));

  const dataSheet = XLSX.utils.json_to_sheet(dataRows);
  dataSheet['!autofilter'] = { ref: dataSheet['!ref'] || 'A1' };
  dataSheet['!cols'] = [
    { wch: 8 },
    { wch: 22 },
    { wch: 32 },
    { wch: 24 },
    { wch: 16 },
    { wch: 18 },
    { wch: 26 },
    { wch: 12 },
    { wch: 40 },
    { wch: 10 },
    { wch: 10 },
    { wch: 18 },
    { wch: 18 },
    { wch: 14 },
    { wch: 24 },
    { wch: 24 },
    { wch: 22 },
    { wch: 30 },
    { wch: 22 },
  ];
  XLSX.utils.book_append_sheet(workbook, dataSheet, 'Firmalar');

  return workbook;
}


function normalizeLicenseExportFilters(rawQuery = {}) {
  return {
    businessId: rawQuery.businessId ? String(rawQuery.businessId) : 'all',
    businessName: rawQuery.businessName ? String(rawQuery.businessName) : '',
    recordStatus: rawQuery.recordStatus ? String(rawQuery.recordStatus) : 'all',
    processStatus: rawQuery.processStatus ? String(rawQuery.processStatus) : 'all',
    search: rawQuery.search ? String(rawQuery.search).trim() : '',
  };
}

function filterLicenseRows(rows, filters = {}) {
  const search = String(filters.search || '').toLocaleLowerCase('tr-TR');
  const businessId = String(filters.businessId || 'all');
  const recordStatus = String(filters.recordStatus || 'all');
  const processStatus = String(filters.processStatus || 'all');

  return rows.filter((item) => {
    const matchesBusiness = businessId === 'all'
      ? true
      : (businessId === 'unlinked' ? !item.businessId : String(item.businessId || '') === businessId);
    const matchesRecord = recordStatus === 'all' || String(item.recordStatus || '') === recordStatus;
    const matchesProcess = processStatus === 'all' || String(item.processStatus || '') === processStatus;
    const text = [
      item.businessName,
      item.tradeName,
      item.ownerName,
      item.licenseSerialNo,
      item.applicationNo,
      item.applicationStage,
      item.activitySubject,
      item.neighborhood,
      item.street,
      item.doorNo,
      item.notes,
    ].join(' ').toLocaleLowerCase('tr-TR');
    const matchesSearch = !search || text.indexOf(search) !== -1;
    return matchesBusiness && matchesRecord && matchesProcess && matchesSearch;
  });
}

async function enrichLicenseExportFilters(filters = {}) {
  const enriched = { ...filters };
  if (filters.businessId === 'unlinked') {
    enriched.businessName = filters.businessName || 'Bağlı Firması Olmayanlar';
    return enriched;
  }
  if (!filters.businessId || filters.businessId === 'all') {
    enriched.businessName = 'Tüm Firmalar';
    return enriched;
  }
  if (filters.businessName) return enriched;

  const businessResult = await pool.query(
    'SELECT trade_name FROM businesses WHERE id = $1 LIMIT 1',
    [Number(filters.businessId)]
  );
  enriched.businessName = businessResult.rows.length
    ? (businessResult.rows[0].trade_name || ('Firma #' + String(filters.businessId)))
    : ('Firma #' + String(filters.businessId));
  return enriched;
}

function buildLicenseExportFileName(filters = {}) {
  const businessText = filters.businessName && filters.businessName !== 'Tüm Firmalar'
    ? String(filters.businessName).toLocaleLowerCase('tr-TR').replace(/[^a-z0-9çğıöşü]+/gi, '-').replace(/^-+|-+$/g, '')
    : 'tum-kayitlar';
  return 'ruhsat-listesi-' + (businessText || 'tum-kayitlar') + '.xlsx';
}

function buildLicenseSummaryRows(rows, filters = {}) {
  let active = 0;
  let passive = 0;
  let cancelled = 0;
  let application = 0;
  let unlinked = 0;

  rows.forEach((item) => {
    if (!item.businessId) unlinked += 1;
    if (item.recordStatus === 'Aktif' && item.processStatus === 'Ruhsat Verildi') active += 1;
    else if (item.recordStatus === 'İptal') cancelled += 1;
    else if (item.processStatus !== 'Ruhsat Verildi') application += 1;
    else passive += 1;
  });

  return [
    { 'Alan': 'Firma', 'Değer': filters.businessName || 'Tüm Firmalar' },
    { 'Alan': 'Kayıt Durumu', 'Değer': filters.recordStatus === 'all' ? 'Tüm kayıt durumları' : (filters.recordStatus || 'Tüm kayıt durumları') },
    { 'Alan': 'Süreç Durumu', 'Değer': filters.processStatus === 'all' ? 'Tüm süreç durumları' : (filters.processStatus || 'Tüm süreç durumları') },
    { 'Alan': 'Arama', 'Değer': filters.search || '-' },
    { 'Alan': 'Toplam Kayıt', 'Değer': rows.length },
    { 'Alan': 'Aktif Ruhsat', 'Değer': active },
    { 'Alan': 'Başvuru Sürecindeki', 'Değer': application },
    { 'Alan': 'Pasif Kayıt', 'Değer': passive },
    { 'Alan': 'İptal Edilen', 'Değer': cancelled },
    { 'Alan': 'Bağlı Firması Olmayan', 'Değer': unlinked },
    { 'Alan': 'Oluşturulma Tarihi', 'Değer': formatDateTime(new Date()) },
  ];
}

function createLicenseWorkbook(rows, filters = {}) {
  const workbook = XLSX.utils.book_new();

  const summaryRows = buildLicenseSummaryRows(rows, filters);
  const summarySheet = XLSX.utils.json_to_sheet(summaryRows, { header: ['Alan', 'Değer'] });
  summarySheet['!cols'] = [{ wch: 24 }, { wch: 42 }];
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Filtre Özeti');

  const dataRows = rows.map((item, index) => ({
    'Sıra': index + 1,
    'Bağlı Firma': item.businessName || '',
    'Ruhsat Sıra No': item.licenseSerialNo || '',
    'Veriliş Tarihi': item.issueDateText || '',
    'Kayıt Durumu': item.recordStatus || '',
    'Süreç Durumu': item.processStatus || '',
    'Başvuru Tarihi': item.applicationDateText || '',
    'Başvuru No': item.applicationNo || '',
    'Başvuru Aşaması': item.applicationStage || '',
    'Takip Tarihi': item.followupDateText || '',
    'İşyeri Ünvanı': item.tradeName || '',
    'İşyeri Sahibi': item.ownerName || '',
    'Faaliyet Konusu': item.activitySubject || '',
    'İşyeri Sınıfı': item.workplaceClass || '',
    'Mahalle': item.neighborhood || '',
    'Cadde / Sokak': item.street || '',
    'Kapı No': item.doorNo || '',
    'Ada': item.ada || '',
    'Parsel': item.parcel || '',
    'Kullanım Alanı': item.usageArea || '',
    'Diğer Kullanım Alanı': item.otherUsageArea || '',
    'Toplam Motor Gücü': item.totalMotorPower || '',
    'Kış Açılış': item.winterOpeningTime || '',
    'Kış Kapanış': item.winterClosingTime || '',
    'Yaz Açılış': item.summerOpeningTime || '',
    'Yaz Kapanış': item.summerClosingTime || '',
    'Diğer Faaliyet Alanları': item.otherActivityAreas || '',
    'T.C. Numarası': item.identityNumber || '',
    'Vergi Numarası': item.taxNumber || '',
    'Zabıta Müdürü': item.policeChiefName || '',
    'Belediye Başkanı': item.mayorName || '',
    'İptal Tarihi': item.cancelDateText || '',
    'İptal Nedeni': item.cancelReason || '',
    'Adres': item.addressText || '',
    'Not': item.notes || '',
    'Kayıt Zamanı': item.createdAt || '',
    'Güncelleme Zamanı': item.updatedAt || '',
  }));

  const dataSheet = XLSX.utils.json_to_sheet(dataRows);
  dataSheet['!autofilter'] = { ref: dataSheet['!ref'] || 'A1' };
  dataSheet['!cols'] = [
    { wch: 8 }, { wch: 26 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 18 },
    { wch: 14 }, { wch: 16 }, { wch: 22 }, { wch: 14 }, { wch: 32 }, { wch: 24 },
    { wch: 28 }, { wch: 22 }, { wch: 18 }, { wch: 24 }, { wch: 12 }, { wch: 10 },
    { wch: 10 }, { wch: 16 }, { wch: 18 }, { wch: 18 }, { wch: 12 }, { wch: 12 },
    { wch: 12 }, { wch: 12 }, { wch: 22 }, { wch: 16 }, { wch: 16 }, { wch: 20 },
    { wch: 20 }, { wch: 14 }, { wch: 24 }, { wch: 40 }, { wch: 28 }, { wch: 22 },
    { wch: 22 },
  ];
  XLSX.utils.book_append_sheet(workbook, dataSheet, 'Ruhsatlar');

  return workbook;
}

function buildInspectionSummaryRows(rows, filters = {}) {
  const uniqueBusinesses = new Set();
  let deadlineCount = 0;
  let overdueCount = 0;
  const today = new Date().toISOString().slice(0, 10);

  rows.forEach((item) => {
    if (item.businessId) uniqueBusinesses.add(item.businessId);
    if (item.currentStatus === 'Süre Verildi') {
      deadlineCount += 1;
      if (item.controlDate && item.controlDate < today) overdueCount += 1;
    }
  });

  return [
    { 'Alan': 'Ay', 'Değer': filters.month || 'Tüm aylar' },
    { 'Alan': 'Kategori', 'Değer': filters.categoryName || (filters.categoryId ? 'Kategori #' + String(filters.categoryId) : 'Tüm kategoriler') },
    { 'Alan': 'Ruhsat Durumu', 'Değer': filters.licenseStatus || 'Tüm ruhsat durumları' },
    { 'Alan': 'Sonuç', 'Değer': filters.resultStatus || 'Tüm sonuçlar' },
    { 'Alan': 'Durum', 'Değer': filters.currentStatus || 'Tüm durumlar' },
    { 'Alan': 'Arama', 'Değer': filters.search || '-' },
    { 'Alan': 'Toplam Denetim', 'Değer': rows.length },
    { 'Alan': 'Firma Sayısı', 'Değer': uniqueBusinesses.size },
    { 'Alan': 'Süre Verilen', 'Değer': deadlineCount },
    { 'Alan': 'Geciken Kontrol', 'Değer': overdueCount },
    { 'Alan': 'Oluşturulma Tarihi', 'Değer': formatDateTime(new Date()) },
  ];
}

function createInspectionWorkbook(rows, filters = {}) {
  const workbook = XLSX.utils.book_new();

  const summaryRows = buildInspectionSummaryRows(rows, filters);
  const summarySheet = XLSX.utils.json_to_sheet(summaryRows, { header: ['Alan', 'Değer'] });
  summarySheet['!cols'] = [{ wch: 24 }, { wch: 42 }];
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Filtre Özeti');

  const dataRows = rows.map((item, index) => ({
    'Sıra': index + 1,
    'Denetim Tarihi': item.inspectionDateText || '',
    'Firma Ünvanı': item.tradeName || '',
    'Kategori': item.categoryName || '',
    'Firma Sahibi': item.ownerName || '',
    'Telefon': item.phone || '',
    'Adres': item.addressText || '',
    'Sonuç': item.resultStatus || '',
    'Durum': item.currentStatus || '',
    'Yapılan İşlem': item.actionTaken || '',
    'Kontrol Tarihi': item.controlDateText || '',
    'Ruhsat Durumu': item.licenseStatus || 'Yok',
    'Not': item.note || '',
    'Kayıt Zamanı': item.createdAt || '',
    'Harita Linki': item.mapsUrl || '',
  }));

  const dataSheet = XLSX.utils.json_to_sheet(dataRows);
  dataSheet['!autofilter'] = { ref: dataSheet['!ref'] || 'A1' };
  dataSheet['!cols'] = [
    { wch: 8 },
    { wch: 14 },
    { wch: 32 },
    { wch: 24 },
    { wch: 24 },
    { wch: 16 },
    { wch: 40 },
    { wch: 16 },
    { wch: 16 },
    { wch: 34 },
    { wch: 16 },
    { wch: 18 },
    { wch: 28 },
    { wch: 22 },
    { wch: 28 },
  ];
  XLSX.utils.book_append_sheet(workbook, dataSheet, 'Denetimler');

  return workbook;
}

app.get("/api/inspections", async (req, res) => {
  try {
    const { rows } = await queryInspectionFeed(req.query);
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Toplu denetim kayıtları alınamadı." });
  }
});

app.get("/api/inspections/export.xlsx", async (req, res) => {
  try {
    const { rows, filters } = await queryInspectionFeed(req.query);
    const workbook = createInspectionWorkbook(rows, filters);
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    const fileName = buildInspectionExportFileName(filters);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="' + fileName + '"');
    res.send(buffer);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Excel çıktısı oluşturulamadı.' });
  }
});



app.get("/api/geocode/reverse", async (req, res) => {
  try {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: "Geçerli enlem ve boylam giriniz." });
    }

    const url = "https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&lat=" + encodeURIComponent(String(lat)) + "&lon=" + encodeURIComponent(String(lng));
    const payload = await httpsGetJson(url);

    res.json({
      displayName: payload.display_name || "",
      shortText: buildReverseGeocodeText(payload),
      address: payload.address || {},
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Konum çözümleme yapılamadı." });
  }
});

app.get("/api/maps/resolve-link", async (req, res) => {
  try {
    const rawUrl = String(req.query.url || '').trim();
    if (!rawUrl) {
      return res.status(400).json({ error: 'Bağlantı gerekli.' });
    }

    let parsed;
    try {
      parsed = new URL(rawUrl);
    } catch (error) {
      return res.status(400).json({ error: 'Geçersiz bağlantı formatı.' });
    }

    if (!isGoogleMapsHost(parsed.hostname)) {
      return res.status(400).json({ error: 'Lütfen Google Maps bağlantısı yapıştırın.' });
    }

    let coords = extractCoordinatesFromGoogleMapsUrl(rawUrl);
    let finalUrl = rawUrl;

    if (!coords) {
      finalUrl = await resolveRedirectUrl(rawUrl);
      coords = extractCoordinatesFromGoogleMapsUrl(finalUrl);
    }

    if (!coords) {
      return res.status(422).json({ error: 'Bağlantıdan koordinat çıkarılamadı. Google Maps uygulamasından konuma uzun basıp o bağlantıyı tekrar kopyalayın.' });
    }

    res.json({
      ok: true,
      lat: Number(coords.lat).toFixed(6),
      lng: Number(coords.lng).toFixed(6),
      mapsUrl: buildMapsUrl(coords.lat, coords.lng),
      finalUrl,
    });
  } catch (error) {
    res.status(500).json({ error: 'Google Maps bağlantısı çözümlenemedi.' });
  }
});

app.get("/businesses", (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Zabıta Yönetim Sistemi - Firma Listesi</title>
  <style>
    :root {
      --bg: #f4f7fb;
      --panel: #ffffff;
      --panel-soft: #f8fafc;
      --line: #dbe3ee;
      --text: #17202f;
      --muted: #667085;
      --navy: #163a63;
      --navy-2: #1f4c81;
      --accent: #f5b301;
      --primary: #2563eb;
      --danger: #dc2626;
      --success: #16a34a;
      --shadow: 0 8px 24px rgba(15, 23, 42, 0.06);
    }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Inter, "Segoe UI", Arial, Helvetica, sans-serif; background: #f3f6fa; color: var(--text); }
    .app { min-height: 100vh; display: block; }
    .sidebar { background: linear-gradient(180deg, #17324f 0%, #12283f 100%); color: #fff; padding: 16px 12px; display: flex; flex-direction: column; gap: 14px; position: fixed; left: 0; top: 0; bottom: 0; width: min(84vw, 320px); height: 100vh; border-right: 1px solid rgba(255,255,255,0.06); z-index: 60; transform: translateX(-100%); transition: transform 0.22s ease; box-shadow: 0 20px 48px rgba(15, 23, 42, 0.18); overflow-y: auto; }
    body.sidebar-open { overflow: hidden; }
    body.sidebar-open .sidebar { transform: translateX(0); }
    .sidebar-top { display: flex; align-items: center; gap: 9px; padding-bottom: 12px; border-bottom: 1px solid rgba(255,255,255,0.1); }
    .brand-mark { width: 38px; height: 38px; border-radius: 11px; background: linear-gradient(135deg, rgba(245,179,1,1) 0%, rgba(255,217,102,1) 100%); color: #0f172a; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 14px; flex-shrink: 0; box-shadow: 0 8px 18px rgba(245, 179, 1, 0.16); }
    .brand { font-size: 14px; font-weight: 700; line-height: 1.3; }
    .brand-sub { font-size: 10.5px; color: rgba(255,255,255,0.62); line-height: 1.45; }
    .nav-section-title { font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(255,255,255,0.42); margin-top: 6px; padding: 0 2px; font-weight: 700; }
    .menu { display: flex; flex-direction: column; gap: 4px; }
    .menu-item { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 9px 10px; border-radius: 10px; font-size: 12.5px; text-decoration: none; color: rgba(255,255,255,0.84); transition: 0.18s ease; border: 1px solid transparent; font-weight: 500; }
    .menu-item:hover { background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.08); }
    .menu-item.active { background: rgba(255,255,255,0.08); color: #ffffff; border-color: rgba(255,255,255,0.1); font-weight: 600; }
    .menu-left { display: inline-flex; align-items: center; gap: 8px; }
    .sidebar-toggle { display: inline-flex; align-items: center; gap: 8px; margin-bottom: 14px; border: 1px solid var(--line); background: #ffffff; color: var(--text); border-radius: 12px; padding: 12px 14px; font-size: 14px; font-weight: 700; box-shadow: var(--shadow); cursor: pointer; }
    .sidebar-backdrop { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.45); opacity: 0; pointer-events: none; transition: opacity 0.18s ease; z-index: 50; }
    body.sidebar-open .sidebar-backdrop { opacity: 1; pointer-events: auto; }
    .main { padding: 18px 20px; min-width: 0; }
    .hero { background: #ffffff; border: 1px solid var(--line); border-radius: 14px; box-shadow: var(--shadow); padding: 14px 16px; display: flex; justify-content: space-between; align-items: center; gap: 14px; margin-bottom: 12px; flex-wrap: wrap; }
    .hero-title { margin: 0; font-size: 26px; line-height: 1.15; letter-spacing: -0.02em; font-weight: 700; }
    .hero-text { margin: 0; color: var(--muted); font-size: 12.5px; line-height: 1.55; max-width: 780px; }
    .date-card { background: #f8fafc; color: var(--text); border-radius: 10px; padding: 10px 12px; display: grid; gap: 2px; border: 1px solid var(--line); min-width: 210px; }
    .date-card span { font-size: 10px; font-weight: 700; color: var(--muted); letter-spacing: 0.05em; text-transform: uppercase; }
    .date-card strong { font-size: 13px; line-height: 1.35; font-weight: 700; }
    .stats-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-bottom: 12px; }
    .card { background: #ffffff; border: 1px solid var(--line); border-radius: 12px; padding: 12px; box-shadow: var(--shadow); min-height: 92px; display: grid; gap: 7px; align-content: start; }
    .card-number { font-size: 21px; font-weight: 700; line-height: 1; margin: 0; }
    .card-label { font-size: 11.5px; color: var(--muted); line-height: 1.45; }
    .card-icon { width: 32px; height: 32px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 15px; }
    .icon-blue { background: #e0efff; }
    .icon-yellow { background: #fff4cf; }
    .icon-green { background: #dcfce7; }
    .icon-gray { background: #edf2f7; }
    .panel { background: #ffffff; border: 1px solid var(--line); border-radius: 14px; padding: 14px; box-shadow: var(--shadow); margin-bottom: 12px; }
    .panel-header { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 12px; flex-wrap: wrap; }
    .panel-title { font-size: 16px; font-weight: 700; line-height: 1.25; }
    .panel-subtitle { font-size: 12px; color: var(--muted); }
    .toolbar-actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .btn { border: none; border-radius: 10px; padding: 10px 14px; font-size: 13px; font-weight: 600; cursor: pointer; transition: transform 0.15s ease, opacity 0.15s ease; text-decoration: none; display: inline-flex; align-items: center; justify-content: center; }
    .btn:hover { transform: translateY(-1px); opacity: 0.96; }
    .btn-primary { background: var(--primary); color: #ffffff; }
    .btn-warning { background: var(--accent); color: #1f2937; }
    .btn-secondary { background: #64748b; color: #ffffff; }
    .btn-danger { background: var(--danger); color: #ffffff; }
    .btn-ghost { background: #eef2ff; color: #1d4ed8; border: 1px solid #dbe7ff; }
    .btn-success { background: var(--success); color: #ffffff; }
    input, select, textarea { width: 100%; border: 1px solid #cfd8e4; border-radius: 10px; padding: 10px 12px; font-size: 13px; outline: none; background: #ffffff; color: var(--text); transition: border-color 0.15s ease, box-shadow 0.15s ease; }
    input:focus, select:focus, textarea:focus { border-color: var(--primary); box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12); }
    .filters { display: grid; grid-template-columns: 220px 170px 170px minmax(220px, 1fr); gap: 10px; align-items: center; margin-bottom: 12px; }
    .table-wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: 14px; }
    .table-wrap table td:first-child { min-width: 230px; }
    table { width: 100%; border-collapse: collapse; min-width: 1020px; background: #ffffff; }
    th { text-align: left; padding: 13px 12px; font-size: 12px; color: #475569; border-bottom: 1px solid var(--line); font-weight: 700; letter-spacing: 0.02em; background: #f8fafc; }
    td { padding: 13px 12px; border-bottom: 1px solid #edf2f7; font-size: 13px; vertical-align: top; }
    tbody tr:hover { background: #f8fbff; }
    .badge { display: inline-flex; align-items: center; padding: 6px 10px; border-radius: 999px; font-size: 11px; font-weight: 700; background: #eff6ff; color: #1d4ed8; }
    .muted { color: var(--muted); font-size: 12px; line-height: 1.5; }
    .cell-title { font-weight: 700; color: #0f172a; line-height: 1.45; }
    .cell-title.compact { line-height: 1.35; }
    .cell-sub { color: var(--muted); font-size: 12px; line-height: 1.45; margin-top: 4px; }
    .stack { display: grid; gap: 4px; }
    .address-stack { display: grid; gap: 4px; min-width: 220px; }
    .location-note { margin-top: 8px; font-size: 12px; color: var(--muted); line-height: 1.5; }
    .map-preview { margin-top: 10px; min-height: 18px; }
    .map-box { height: 420px; border-radius: 14px; overflow: hidden; border: 1px solid var(--line); background: #f8fafc; }
    .map-help { margin-top: 10px; color: var(--muted); font-size: 12px; line-height: 1.55; }
    .map-help.tight { margin-top: 6px; }
    .action-row { display: flex; flex-wrap: wrap; gap: 8px; }
    .mini-btn { border: 1px solid var(--line); background: #ffffff; color: #1f2937; padding: 7px 9px; border-radius: 9px; font-size: 12px; font-weight: 700; cursor: pointer; text-decoration: none; }
    .mini-btn:hover { background: #f8fafc; }
    .mini-btn.primary { color: #1d4ed8; border-color: #bfdbfe; background: #eff6ff; }
    .mini-btn.danger { color: #dc2626; border-color: #fecaca; background: #fff1f2; }
    .modal-overlay { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.5); display: none; align-items: center; justify-content: center; padding: 20px; z-index: 80; }
    .modal-overlay.show { display: flex; }
    .modal { width: min(920px, 100%); max-height: calc(100vh - 40px); overflow: auto; background: #ffffff; border-radius: 16px; box-shadow: 0 20px 48px rgba(15, 23, 42, 0.18); border: 1px solid rgba(219, 227, 238, 0.9); }
    .modal-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px 18px; border-bottom: 1px solid var(--line); font-size: 16px; font-weight: 700; }
    .close-btn { border: none; background: #f8fafc; color: #475569; width: 32px; height: 32px; border-radius: 10px; cursor: pointer; font-size: 20px; }
    .modal-body { padding: 18px; }
    .modal-footer { display: flex; justify-content: flex-end; gap: 8px; padding: 16px 18px; border-top: 1px solid var(--line); }
    .form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .form-group { display: grid; gap: 6px; }
    .form-group.full { grid-column: 1 / -1; }
    .form-group label { font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: 0.04em; }
    .topic-picker { position: relative; display: grid; gap: 8px; }
    .topic-trigger { width: 100%; min-height: 50px; border: 1px solid #cfd8e4; border-radius: 12px; background: #ffffff; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 14px; font-size: 14px; color: var(--text); cursor: pointer; }
    .topic-trigger:hover { border-color: #b9c7d8; }
    .topic-trigger-text { flex: 1; min-width: 0; text-align: left; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .topic-trigger-text.placeholder { color: var(--muted); }
    .topic-caret { color: var(--muted); font-size: 12px; }
    .topic-dropdown { display: none; border: 1px solid #dbe3ef; border-radius: 14px; background: #ffffff; box-shadow: 0 14px 32px rgba(15, 23, 42, 0.10); padding: 10px; }
    .topic-dropdown.open { display: block; }
    .topic-search { margin-bottom: 8px; }
    .topic-search input { width: 100%; }
    .topic-picker-grid { max-height: 220px; overflow: auto; display: grid; grid-template-columns: 1fr; gap: 6px; padding-right: 4px; }
    .topic-check { display: flex; align-items: flex-start; gap: 8px; font-size: 13px; color: var(--text); line-height: 1.45; border-radius: 10px; padding: 8px 10px; }
    .topic-check:hover { background: #f8fafc; }
    .topic-check input { width: 16px; min-width: 16px; height: 16px; padding: 0; margin-top: 2px; box-shadow: none; }
    .topic-tags { display: flex; flex-wrap: wrap; gap: 8px; }
    .topic-tag { display: inline-flex; align-items: center; border-radius: 999px; background: #edf2ff; color: #1f3b7a; padding: 6px 10px; font-size: 12px; font-weight: 700; }
    .topic-help { font-size: 11.5px; color: var(--muted); line-height: 1.5; }
    .topic-manager-toolbar { display: grid; grid-template-columns: 1fr auto; gap: 12px; align-items: end; margin-bottom: 18px; }
    .topic-manager-list { display: grid; gap: 10px; }
    .topic-manager-item { border: 1px solid var(--line); border-radius: 14px; padding: 12px; background: #ffffff; display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 10px; align-items: center; }
    .topic-manager-item input[type="text"] { margin: 0; }
    .topic-status-badge { display: inline-flex; align-items: center; justify-content: center; min-width: 78px; padding: 8px 10px; border-radius: 999px; font-size: 12px; font-weight: 700; }
    .topic-status-badge.active { background: #dcfce7; color: #166534; }
    .topic-status-badge.passive { background: #e5e7eb; color: #4b5563; }
    @media (max-width: 640px) { .topic-manager-toolbar, .topic-manager-item { grid-template-columns: 1fr; } }
    .section-block { grid-column: 1 / -1; border: 1px solid #e2e8f0; border-radius: 14px; background: linear-gradient(180deg, #fbfdff 0%, #f8fbff 100%); padding: 14px; display: grid; gap: 12px; }
    .section-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
    .section-title-sm { font-size: 13px; font-weight: 700; color: #0f172a; line-height: 1.3; }
    .section-note { font-size: 11.5px; color: #64748b; line-height: 1.5; max-width: 680px; }
    .section-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .address-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .address-inline { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
    .is-readonly { background: #f8fafc; color: #334155; border-color: #dbe3ee; }
    .parcel-row { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; grid-column: 1 / -1; }
    .location-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto auto; gap: 8px; align-items: end; }
    .google-link-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: end; margin-top: 8px; }
    .empty-state { border: 1px dashed var(--line); border-radius: 14px; padding: 18px; text-align: center; color: var(--muted); background: #fafcff; }
    @media (max-width: 1100px) {
      .stats-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (max-width: 840px) {
      .filters, .form-grid, .section-grid, .address-grid, .address-inline, .location-row, .parcel-row, .google-link-row { grid-template-columns: 1fr; }
    }
    @media (max-width: 720px) {
      .stats-grid { grid-template-columns: 1fr; }
      .main { padding: 14px; }
    }
  </style>
</head>
<body>
  <div class="sidebar-backdrop" id="sidebarBackdrop" onclick="toggleSidebar(false)"></div>
  <div class="app">
    <aside class="sidebar" id="sidebar">
      <div class="sidebar-top">
        <div class="brand-mark">ZB</div>
        <div>
          <div class="brand">Zabıta Yönetim Sistemi</div>
          <div class="brand-sub">Kurumsal takip ve saha yönetimi</div>
        </div>
      </div>
      <div class="nav-section-title">Modüller</div>
      <nav class="menu">
        <a href="/" class="menu-item"><span class="menu-left"><span>📌</span><span>Şikayet Takip</span></span></a>
        <a href="/businesses" class="menu-item active"><span class="menu-left"><span>🏪</span><span>Firma Listesi</span></span></a>
        <a href="/inspections" class="menu-item"><span class="menu-left"><span>🧾</span><span>Tüm Denetimler</span></span></a>
        <a href="/licenses" class="menu-item"><span class="menu-left"><span>📜</span><span>Ruhsat Yönetimi</span></span></a>
        <a href="/markets" class="menu-item"><span class="menu-left"><span>🧺</span><span>Pazar Yönetimi</span></span></a>
      </nav>
    </aside>

    <main class="main">
      <button class="sidebar-toggle" type="button" onclick="toggleSidebar()">☰ Modüller</button>
      <section class="hero">
        <div>
          <h1 class="hero-title">İşyeri Denetim Modülü · Firma Listesi</h1>
          <p class="hero-text">Bu ekranda önce firma kayıtları oluşturulur. Kategori tanımları açılır pencere üzerinden eklenir. İşyerine ait iletişim, adres, ada/parsel ve konum bilgileri burada düzenlenir.</p>
        </div>
        <div class="date-card">
          <span>Bugün</span>
          <strong id="todayText"></strong>
        </div>
      </section>

      <section class="stats-grid">
        <div class="card">
          <div class="card-icon icon-blue">🏪</div>
          <div class="card-number" id="statBusinessCount">0</div>
          <div class="card-label">Toplam işyeri kaydı</div>
        </div>
        <div class="card">
          <div class="card-icon icon-yellow">🗂️</div>
          <div class="card-number" id="statCategoryCount">0</div>
          <div class="card-label">Tanımlı kategori</div>
        </div>
        <div class="card">
          <div class="card-icon icon-green">📍</div>
          <div class="card-number" id="statLocatedCount">0</div>
          <div class="card-label">Konumu eklenmiş işyeri</div>
        </div>
        <div class="card">
          <div class="card-icon icon-gray">🧭</div>
          <div class="card-number" id="statMissingLocationCount">0</div>
          <div class="card-label">Konum bekleyen işyeri</div>
        </div>
      </section>

      <section class="panel">
        <div class="panel-header">
          <div>
            <div class="panel-title">Firma Listesi</div>
            <div class="panel-subtitle">Firmaları kategoriye bağlı şekilde yönetin. Adres alanları daha düzenli ve kurumsal bir form yapısıyla sunulur.</div>
          </div>
          <div class="toolbar-actions">
            <a class="btn btn-secondary" href="/inspections">Tüm Denetimler</a>
            <button class="btn btn-secondary" type="button" onclick="exportBusinessesExcel()">Excel'e Aktar</button>
            <button class="btn btn-ghost" onclick="openCategoryModal()">Kategori Ekle</button>
            <button class="btn btn-primary" onclick="openNewBusinessModal()">+ Yeni Firma Ekle</button>
          </div>
        </div>
        <div class="filters">
          <select id="filterCategory" onchange="renderBusinessTable()"></select>
          <select id="licenseFilter" onchange="renderBusinessTable()">
            <option value="all">Tüm Ruhsat Durumları</option>
            <option value="Var">Ruhsatlı Firmalar</option>
            <option value="Yok">Ruhsatsız Firmalar</option>
            <option value="Başvuru Aşamasında">Başvuru Aşamasında</option>
            <option value="İptal / Pasif">İptal / Pasif Özeti</option>
          </select>
          <select id="locationFilter" onchange="renderBusinessTable()">
            <option value="all">Tüm Konumlar</option>
            <option value="with">Konumu Olanlar</option>
            <option value="without">Konumu Olmayanlar</option>
          </select>
          <input type="text" id="searchInput" placeholder="Ünvan, sahip, telefon, mahalle / cadde ara" oninput="renderBusinessTable()" />
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Kategori / Ünvan</th>
                <th>İşyeri Sahibi</th>
                <th>Telefon</th>
                <th>Adres</th>
                <th>Ada / Parsel</th>
                <th>Konum</th>
                <th>İşlemler</th>
              </tr>
            </thead>
            <tbody id="businessTableBody"></tbody>
          </table>
        </div>
      </section>
    </main>
  </div>

  <div class="modal-overlay" id="businessModal">
    <div class="modal">
      <div class="modal-header">
        <span id="businessModalTitle">Yeni Firma Ekle</span>
        <button class="close-btn" onclick="closeModal('businessModal')">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-grid">
          <div class="form-group">
            <label>Kategori *</label>
            <select id="businessCategory"></select>
          </div>
          <div class="form-group">
            <label>İşyeri Ünvanı *</label>
            <input type="text" id="businessTradeName" placeholder="İşyeri ünvanı" />
          </div>
          <div class="form-group">
            <label>İşyeri Sahibinin Adı Soyadı *</label>
            <input type="text" id="businessOwnerName" placeholder="Ad Soyad" />
          </div>
          <div class="form-group">
            <label>Telefon Numarası</label>
            <input type="text" id="businessPhone" placeholder="05xx xxx xx xx" />
          </div>

          <div class="section-block">
            <div class="section-head">
              <div>
                <div class="section-title-sm">Adres Bilgisi</div>
                <div class="section-note">Adres alanları seçim düzeniyle yapılandırıldı. İl ve ilçe sabittir; mahalle, cadde / sokak ve kapı no alanları seçime göre ilerler.</div>
              </div>
            </div>
            <div class="section-grid">
              <div class="form-group">
                <label>İl</label>
                <select id="businessProvince" class="is-readonly" disabled>
                  <option value="Burdur">Burdur</option>
                </select>
              </div>
              <div class="form-group">
                <label>İlçe</label>
                <select id="businessDistrict" class="is-readonly" disabled>
                  <option value="Bucak">Bucak</option>
                </select>
              </div>
            </div>
            <div class="address-grid">
              <div class="form-group">
                <label>Mahalle</label>
                <select id="businessNeighborhood" onchange="handleNeighborhoodChange()">
                  <option value="">Mahalle seçiniz</option>
                </select>
              </div>
              <div class="form-group">
                <label>Cadde / Sokak</label>
                <input type="text" id="businessStreet" list="businessStreetList" placeholder="Önce mahalle seçiniz" oninput="handleStreetInput()" />
                <datalist id="businessStreetList"></datalist>
              </div>
            </div>
            <div class="address-inline">
              <div class="form-group">
                <label>Kapı No</label>
                <input type="text" id="businessDoorNo" list="businessDoorNoList" placeholder="Önce cadde / sokak seçiniz" oninput="updateLocationPreview()" />
                <datalist id="businessDoorNoList"></datalist>
              </div>
              <div class="form-group">
                <label>Ada</label>
                <input type="text" id="businessAda" placeholder="Ada" />
              </div>
              <div class="form-group">
                <label>Parsel</label>
                <input type="text" id="businessParcel" placeholder="Parsel" />
              </div>
            </div>
          </div>

          <div class="section-block">
            <div class="section-head">
              <div>
                <div class="section-title-sm">Konum Bilgisi</div>
                <div class="section-note">Konum alanında koordinat girişi, cihazdan konum alma ve Google Maps bağlantısından koordinat çözme seçenekleri birlikte sunulur.</div>
              </div>
            </div>
            <div class="form-group full">
              <label>Koordinat Bilgisi</label>
              <div class="location-row">
                <input type="text" id="businessLocationLat" placeholder="Enlem (Latitude)" />
                <input type="text" id="businessLocationLng" placeholder="Boylam (Longitude)" />
                <button class="btn btn-success" id="getLocationBtn" type="button" onclick="fillCurrentLocation()">Konum Al</button>
                <button class="btn btn-ghost" type="button" onclick="openCurrentLocationInGoogleMaps()">Google Maps Aç</button>
              </div>
              <div class="google-link-row">
                <input type="text" id="businessGoogleMapsLink" placeholder="Google Maps bağlantısını buraya yapıştırın" />
                <button class="btn btn-ghost" type="button" onclick="fillLocationFromGoogleMapsLink()">Linkten Al</button>
              </div>
              <div class="location-note" id="locationInfoText">Konumu telefondan alabilirsiniz. Telefon yanlış konum verirse Google Maps uygulamasında işyerine uzun basıp bağlantıyı kopyalayın ve buraya yapıştırın.</div>
              <div class="map-preview" id="locationPreviewRow"></div>
              <div class="location-note" id="locationResolvedText"></div>
            </div>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="closeModal('businessModal')">İptal</button>
        <button class="btn btn-primary" onclick="saveBusiness()">Kaydet</button>
      </div>
    </div>
  </div>

  <div class="modal-overlay" id="categoryModal">
    <div class="modal" style="width:min(560px,100%);">
      <div class="modal-header">
        <span>Yeni Kategori Ekle</span>
        <button class="close-btn" onclick="closeModal('categoryModal')">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-grid" style="grid-template-columns:1fr;">
          <div class="form-group">
            <label>Kategori Adı *</label>
            <input type="text" id="categoryNameInput" placeholder="Örnek: Market / Bakkal" />
          </div>
          <div class="muted">Kategori adı kaydedildiğinde firma formundaki kategori seçim alanına otomatik olarak eklenecektir.</div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="closeModal('categoryModal')">İptal</button>
        <button class="btn btn-primary" onclick="saveCategory()">Kaydet</button>
      </div>
    </div>
  </div>

  <div class="modal-overlay" id="mapPickerModal">
    <div class="modal" style="width:min(860px,100%);">
      <div class="modal-header">
        <span>Haritadan Konum Seç</span>
        <button class="close-btn" onclick="closeModal('mapPickerModal')">&times;</button>
      </div>
      <div class="modal-body">
        <div class="map-box" id="mapPickerCanvas"></div>
        <div class="map-help">Haritada işyerinin bulunduğu noktaya tıklayın. Seçilen konum enlem ve boylam alanlarına otomatik yazılır.</div>
        <div class="map-preview" id="mapPickerSelectionText"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="closeModal('mapPickerModal')">İptal</button>
        <button class="btn btn-ghost" type="button" onclick="centerMapOnCurrentLocation()">Mevcut Konumumla Ortala</button>
        <button class="btn btn-primary" onclick="applyMapSelection()">Seçimi Kullan</button>
      </div>
    </div>
  </div>

  <div class="modal-overlay" id="topicModal">
    <div class="modal">
      <div class="modal-header white">
        <span>Konu Başlıkları</span>
        <button class="close-btn" onclick="closeModal('topicModal')">&times;</button>
      </div>
      <div class="modal-body">
        <div class="topic-manager-toolbar">
          <div class="form-group" style="margin:0;">
            <label>Yeni Konu Başlığı</label>
            <input type="text" id="topicManagerName" placeholder="Örn: İşporta / Seyyar Satış" />
          </div>
          <div style="display:flex; gap:10px; justify-content:flex-end; flex-wrap:wrap;">
            <button class="btn btn-primary" type="button" onclick="createComplaintTopic()">＋ Konu Ekle</button>
          </div>
        </div>
        <div id="topicManagerList" class="topic-manager-list">
          <div class="muted">Konu listesi yükleniyor...</div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="closeModal('topicModal')">Kapat</button>
      </div>
    </div>
  </div>

  <script>
    var categories = [];
    var businesses = [];
    var editingBusinessId = null;
    var mapPicker = null;
    var mapMarker = null;
    var selectedMapCoords = null;
    var ADDRESS_REGION = { province: 'Burdur', district: 'Bucak' };
    var ADDRESS_CATALOG = {
      "Alaattin": {
            "aliases": [
                  "Alaaddin"
            ],
            "streets": {
                  "6. Sokak": []
            }
      },
      "Atilla": {
            "aliases": [],
            "streets": {}
      },
      "Barbaros": {
            "aliases": [
                  "Barboros"
            ],
            "streets": {
                  "2029 Sokak": [],
                  "2139 Sokak": [],
                  "2154 Sokak": [],
                  "2240 Sokak": [],
                  "İncirhan Caddesi": []
            }
      },
      "Cami": {
            "aliases": [
                  "Camii"
            ],
            "streets": {
                  "319 Sokak": [],
                  "327 Sokak": [],
                  "338 Sokak": [],
                  "Kabak Caddesi": [],
                  "Ramazan Selen Bulvarı": [
                        "90"
                  ]
            }
      },
      "Çamlıca": {
            "aliases": [],
            "streets": {
                  "1727 Sokak": [],
                  "1728 Sokak": [],
                  "1730 Sokak": [],
                  "Gazi Caddesi": [],
                  "Kazım Karabekir Caddesi": []
            }
      },
      "Çavuşlar": {
            "aliases": [],
            "streets": {
                  "2727 Sokak": [],
                  "3014 Sokak": [],
                  "3015 Sokak": [],
                  "3016 Sokak": [],
                  "3035 Sokak": [],
                  "3049 Sokak": [],
                  "Gündoğdu Caddesi": [],
                  "Tepecik Caddesi": []
            }
      },
      "Çukur": {
            "aliases": [],
            "streets": {
                  "Kabak Caddesi": []
            }
      },
      "Fatih": {
            "aliases": [],
            "streets": {
                  "1526 Sokak": [],
                  "1529 Sokak": [],
                  "1641 Sokak": [
                        "13"
                  ],
                  "1664 Sokak": [],
                  "1731 Sokak": [],
                  "9 Eylül Caddesi": [],
                  "Cemal Aktaş Caddesi": [],
                  "Fatih Caddesi": [],
                  "Gazi Caddesi": []
            }
      },
      "Karayvatlar": {
            "aliases": [],
            "streets": {
                  "932 Sokak": [],
                  "947 Sokak": [],
                  "Cumhuriyet Caddesi": [],
                  "Gazi Caddesi": [
                        "24"
                  ],
                  "Sümer Ezgü Caddesi": []
            }
      },
      "Konak": {
            "aliases": [],
            "streets": {
                  "Genç Osman Caddesi": [],
                  "Hökez Caddesi": [],
                  "2712 Sokak": [],
                  "2716 Sokak": []
            }
      },
      "Mehmet Akif": {
            "aliases": [],
            "streets": {
                  "2406 Sokak": [],
                  "2447 Sokak": [],
                  "2522 Sokak": []
            }
      },
      "Mimar Sinan": {
            "aliases": [],
            "streets": {
                  "1586 Sokak": [],
                  "1834 Sokak": [],
                  "1835 Sokak": [],
                  "1839 Sokak": [],
                  "1842 Sokak": [],
                  "1856 Sokak": [],
                  "1861 Sokak": []
            }
      },
      "Oğuzhan": {
            "aliases": [],
            "streets": {
                  "Atatürk Caddesi": [
                        "1"
                  ]
            }
      },
      "Onaç": {
            "aliases": [],
            "streets": {
                  "2308 Sokak": [],
                  "2364 Sokak": [],
                  "Kemal Kaplan Sokağı": []
            }
      },
      "Pazar": {
            "aliases": [],
            "streets": {
                  "Barutlu Caddesi": [],
                  "İnönü Caddesi": []
            }
      },
      "Sanayi": {
            "aliases": [],
            "streets": {
                  "2461 Sokak": [],
                  "2462 Sokak": [],
                  "2467 Sokak": [],
                  "2477 Sokak": [
                        "9"
                  ],
                  "2484 Sokak": [
                        "4"
                  ],
                  "2775 Sokak": [],
                  "2888 Sokak": [],
                  "2889 Sokak": [],
                  "2902 Sokak": [],
                  "2904 Sokak": [],
                  "2905 Sokak": [],
                  "2907 Sokak": [],
                  "2910 Sokak": [],
                  "2928 Sokak": [],
                  "Gündoğdu Caddesi": []
            }
      },
      "Yeni": {
            "aliases": [],
            "streets": {
                  "1257 Sokak": [],
                  "1641 Sokak": [],
                  "Gazi Caddesi": [],
                  "Milli Egemenlik Caddesi": [],
                  "Süleyman Demirel Bulvarı": [],
                  "Yahya Kemal Caddesi": []
            }
      },
      "Yetmiş Evler": {
            "aliases": [
                  "70 Evler",
                  "Yetmis Evler"
            ],
            "streets": {}
      },
      "Yörükler": {
            "aliases": [],
            "streets": {
                  "3002 Sokak": [],
                  "3003 Sokak": [],
                  "Tepecik Caddesi": []
            }
      },
      "Yunus Emre": {
            "aliases": [],
            "streets": {
                  "808 Sokak": [],
                  "817 Sokak": [],
                  "828 Sokak": [],
                  "830 Sokak": [],
                  "836 Sokak": [],
                  "855 Sokak": [],
                  "909 Sokak": [],
                  "Sultan Hamit Caddesi": [],
                  "Yıldırım Caddesi": []
            }
      }
};
    var ADDRESS_NEIGHBORHOOD_ORDER = ['Alaattin', 'Atilla', 'Barbaros', 'Cami', 'Çamlıca', 'Çavuşlar', 'Çukur', 'Fatih', 'Karayvatlar', 'Konak', 'Mehmet Akif', 'Mimar Sinan', 'Oğuzhan', 'Onaç', 'Pazar', 'Sanayi', 'Yeni', 'Yetmiş Evler', 'Yörükler', 'Yunus Emre'];

    function escapeHtml(value) {
      if (value === null || value === undefined) return "";
      return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    function setTodayText() {
      var now = new Date();
      document.getElementById("todayText").textContent = now.toLocaleDateString("tr-TR", {
        weekday: "long",
        day: "2-digit",
        month: "long",
        year: "numeric"
      });
    }

    function closeModal(id) {
      document.getElementById(id).classList.remove("show");
    }

    function openModal(id) {
      document.getElementById(id).classList.add("show");
    }

    function renderCategoryOptions() {
      var options = '<option value="">Tüm Kategoriler</option>';
      var formOptions = '<option value="">Seçiniz</option>';

      for (var i = 0; i < categories.length; i++) {
        options += '<option value="' + categories[i].id + '">' + escapeHtml(categories[i].name) + '</option>';
        formOptions += '<option value="' + categories[i].id + '">' + escapeHtml(categories[i].name) + '</option>';
      }

      document.getElementById("filterCategory").innerHTML = options;
      document.getElementById("businessCategory").innerHTML = formOptions;
    }

    function normalizeTextKey(value) {
      return String(value || '')
        .toLocaleLowerCase('tr-TR')
        .replace(/ı/g, 'i')
        .replace(/ğ/g, 'g')
        .replace(/ü/g, 'u')
        .replace(/ş/g, 's')
        .replace(/ö/g, 'o')
        .replace(/ç/g, 'c')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
    }

    function getCanonicalNeighborhoodName(value) {
      if (!value) return '';
      var normalized = normalizeTextKey(value);
      for (var i = 0; i < ADDRESS_NEIGHBORHOOD_ORDER.length; i++) {
        var officialName = ADDRESS_NEIGHBORHOOD_ORDER[i];
        var entry = ADDRESS_CATALOG[officialName] || {};
        if (normalizeTextKey(officialName) === normalized) return officialName;
        var aliases = entry.aliases || [];
        for (var j = 0; j < aliases.length; j++) {
          if (normalizeTextKey(aliases[j]) === normalized) return officialName;
        }
      }
      return String(value || '');
    }

    function sortTurkish(values, numeric) {
      return values.slice().sort(function(a, b) {
        return String(a).localeCompare(String(b), 'tr', { numeric: !!numeric, sensitivity: 'base' });
      });
    }

    function uniqueSorted(values, numeric) {
      var map = {};
      for (var i = 0; i < values.length; i++) {
        var val = String(values[i] || '').trim();
        if (!val) continue;
        map[val] = true;
      }
      return sortTurkish(Object.keys(map), numeric);
    }

    function setSelectOptions(selectId, placeholder, values, selectedValue) {
      var select = document.getElementById(selectId);
      if (!select) return;

      var html = '<option value="">' + escapeHtml(placeholder) + '</option>';
      for (var i = 0; i < values.length; i++) {
        var value = String(values[i]);
        html += '<option value="' + escapeHtml(value) + '">' + escapeHtml(value) + '</option>';
      }

      if (selectedValue && values.indexOf(selectedValue) === -1) {
        html += '<option value="' + escapeHtml(selectedValue) + '">' + escapeHtml(selectedValue) + ' (Kayıtlı)</option>';
      }

      select.innerHTML = html;
      select.value = selectedValue || '';
    }

    function getNeighborhoodNames() {
      return ADDRESS_NEIGHBORHOOD_ORDER.slice();
    }

    function collectKnownStreets(neighborhood) {
      var canonicalNeighborhood = getCanonicalNeighborhoodName(neighborhood);
      var collected = [];
      if (canonicalNeighborhood && ADDRESS_CATALOG[canonicalNeighborhood] && ADDRESS_CATALOG[canonicalNeighborhood].streets) {
        collected = collected.concat(Object.keys(ADDRESS_CATALOG[canonicalNeighborhood].streets));
      }
      for (var i = 0; i < businesses.length; i++) {
        if (getCanonicalNeighborhoodName(businesses[i].neighborhood) === canonicalNeighborhood && businesses[i].street) {
          collected.push(businesses[i].street);
        }
      }
      return uniqueSorted(collected, true);
    }

    function collectKnownDoorNumbers(neighborhood, street) {
      var canonicalNeighborhood = getCanonicalNeighborhoodName(neighborhood);
      var streetKey = String(street || '').trim();
      if (!streetKey) return [];
      var collected = [];
      if (canonicalNeighborhood && ADDRESS_CATALOG[canonicalNeighborhood] && ADDRESS_CATALOG[canonicalNeighborhood].streets && ADDRESS_CATALOG[canonicalNeighborhood].streets[streetKey]) {
        collected = collected.concat(ADDRESS_CATALOG[canonicalNeighborhood].streets[streetKey]);
      }
      for (var i = 0; i < businesses.length; i++) {
        if (
          getCanonicalNeighborhoodName(businesses[i].neighborhood) === canonicalNeighborhood &&
          String(businesses[i].street || '').trim() === streetKey &&
          businesses[i].doorNo
        ) {
          collected.push(businesses[i].doorNo);
        }
      }
      return uniqueSorted(collected, true);
    }

    function setDatalistOptions(listId, values) {
      var list = document.getElementById(listId);
      if (!list) return;
      list.innerHTML = values.map(function(value) {
        return '<option value="' + escapeHtml(value) + '"></option>';
      }).join('');
    }

    function initAddressSelectors() {
      var provinceSelect = document.getElementById('businessProvince');
      var districtSelect = document.getElementById('businessDistrict');
      if (provinceSelect) provinceSelect.value = ADDRESS_REGION.province;
      if (districtSelect) districtSelect.value = ADDRESS_REGION.district;
      setSelectOptions('businessNeighborhood', 'Mahalle seçiniz', getNeighborhoodNames(), '');
      document.getElementById('businessStreet').value = '';
      document.getElementById('businessStreet').placeholder = 'Önce mahalle seçiniz';
      setDatalistOptions('businessStreetList', []);
      document.getElementById('businessDoorNo').value = '';
      document.getElementById('businessDoorNo').placeholder = 'Önce cadde / sokak seçiniz';
      setDatalistOptions('businessDoorNoList', []);
    }

    function handleNeighborhoodChange(selectedStreet, selectedDoorNo) {
      var neighborhood = getCanonicalNeighborhoodName(document.getElementById('businessNeighborhood').value);
      if (neighborhood && neighborhood !== document.getElementById('businessNeighborhood').value) {
        document.getElementById('businessNeighborhood').value = neighborhood;
      }
      var streets = collectKnownStreets(neighborhood);
      var streetInput = document.getElementById('businessStreet');
      setDatalistOptions('businessStreetList', streets);
      streetInput.placeholder = neighborhood ? 'Cadde / sokak seçiniz veya yazınız' : 'Önce mahalle seçiniz';
      streetInput.value = selectedStreet || '';
      handleStreetChange(selectedDoorNo);
      updateLocationPreview();
    }

    function handleStreetInput(selectedDoorNo) {
      handleStreetChange(selectedDoorNo);
    }

    function handleStreetChange(selectedDoorNo) {
      var neighborhood = getCanonicalNeighborhoodName(document.getElementById('businessNeighborhood').value);
      var street = document.getElementById('businessStreet').value.trim();
      var doorNumbers = collectKnownDoorNumbers(neighborhood, street);
      var doorInput = document.getElementById('businessDoorNo');
      setDatalistOptions('businessDoorNoList', doorNumbers);
      doorInput.placeholder = street ? 'Kapı no seçiniz veya yazınız' : 'Önce cadde / sokak seçiniz';
      if (selectedDoorNo !== undefined) {
        doorInput.value = selectedDoorNo || '';
      }
      updateLocationPreview();
    }

    function setAddressSelection(neighborhood, street, doorNo) {
      initAddressSelectors();
      var canonicalNeighborhood = getCanonicalNeighborhoodName(neighborhood || '');
      setSelectOptions('businessNeighborhood', 'Mahalle seçiniz', getNeighborhoodNames(), canonicalNeighborhood || neighborhood || '');
      handleNeighborhoodChange(street || '', doorNo || '');
      if (doorNo) {
        document.getElementById('businessDoorNo').value = doorNo;
      }
    }

    function renderStats() {
      var locatedCount = 0;
      for (var i = 0; i < businesses.length; i++) {
        if (businesses[i].locationLat !== null && businesses[i].locationLng !== null) {
          locatedCount += 1;
        }
      }

      document.getElementById("statBusinessCount").textContent = businesses.length;
      document.getElementById("statCategoryCount").textContent = categories.length;
      document.getElementById("statLocatedCount").textContent = locatedCount;
      document.getElementById("statMissingLocationCount").textContent = businesses.length - locatedCount;
    }

    function getFilteredBusinesses() {
      var search = document.getElementById("searchInput").value.trim().toLocaleLowerCase("tr-TR");
      var categoryId = document.getElementById("filterCategory").value;
      var licenseFilter = document.getElementById("licenseFilter").value;
      var locationFilter = document.getElementById("locationFilter").value;

      return businesses.filter(function(item) {
        var matchesCategory = !categoryId || String(item.categoryId) === String(categoryId);
        var normalizedLicense = String(item.licenseStatus || 'Yok');
        var matchesLicense = licenseFilter === 'all' || normalizedLicense === licenseFilter || (licenseFilter === 'İptal / Pasif' && normalizedLicense === 'Yok');
        var hasLocation = item.locationLat !== null && item.locationLng !== null;
        var matchesLocation = locationFilter === "all" || (locationFilter === "with" ? hasLocation : !hasLocation);
        var text = [item.categoryName, item.tradeName, item.ownerName, item.phone, item.neighborhood, item.street, item.doorNo, item.ada, item.parcel, item.licenseStatus].join(" ").toLocaleLowerCase("tr-TR");
        var matchesSearch = !search || text.indexOf(search) !== -1;
        return matchesCategory && matchesLicense && matchesLocation && matchesSearch;
      });
    }

    function renderBusinessTable() {
      var rows = getFilteredBusinesses();
      var body = document.getElementById("businessTableBody");

      if (!rows.length) {
        body.innerHTML = '<tr><td colspan="7"><div class="empty-state">Bu filtreye uygun işyeri kaydı bulunmuyor.</div></td></tr>';
        return;
      }

      var html = "";
      for (var i = 0; i < rows.length; i++) {
        var item = rows[i];
        var neighborhoodText = item.neighborhood ? escapeHtml(item.neighborhood + ' Mah.') : '';
        var streetText = [];
        if (item.street) streetText.push(escapeHtml(item.street));
        if (item.doorNo) streetText.push('No: ' + escapeHtml(item.doorNo));
        var addressHtml = '<span class="muted">Adres girilmedi</span>';
        if (neighborhoodText || streetText.length) {
          addressHtml = '<div class="address-stack">' +
            (neighborhoodText ? '<div class="cell-title compact">' + neighborhoodText + '</div>' : '') +
            (streetText.length ? '<div class="cell-sub">' + streetText.join(', ') + '</div>' : '') +
            '<div class="cell-sub">Kayıt Tarihi: ' + escapeHtml(item.createdAt || '') + '</div>' +
          '</div>';
        }

        html += '<tr>' +
          '<td>' +
            '<div class="stack">' +
              '<div><span class="badge">' + escapeHtml(item.categoryName || "Kategori Yok") + '</span></div>' +
              '<div class="cell-title">' + escapeHtml(item.tradeName) + '</div>' +
            '</div>' +
          '</td>' +
          '<td><div class="stack"><div class="cell-title">' + escapeHtml(item.ownerName) + '</div><div class="cell-sub">Yetkili / İşletme sahibi</div></div></td>' +
          '<td>' + (item.phone ? '<div class="cell-title">' + escapeHtml(item.phone) + '</div>' : '<span class="muted">Belirtilmedi</span>') + '</td>' +
          '<td>' + addressHtml + '</td>' +
          '<td><div class="cell-title compact">Ada: ' + escapeHtml(item.ada || '-') + ' · Parsel: ' + escapeHtml(item.parcel || '-') + '</div></td>' +
          '<td>' +
            (item.locationText
              ? '<div class="stack"><div class="cell-title compact">' + escapeHtml(item.locationText) + '</div><div class="cell-sub"><a href="' + escapeHtml(item.mapsUrl) + '" target="_blank" rel="noopener noreferrer">Google Maps Aç</a></div></div>'
              : (item.addressMapsUrl ? '<div class="stack"><div class="muted">Koordinat yok</div><div class="cell-sub"><a href="' + escapeHtml(item.addressMapsUrl) + '" target="_blank" rel="noopener noreferrer">Adrese göre Google Maps Aç</a></div></div>' : '<span class="muted">Konum eklenmedi</span>')) +
          '</td>' +
          '<td>' +
            '<div class="action-row">' +
              '<a class="mini-btn primary" href="/businesses/' + item.id + '">Detay</a>' +
              '<a class="mini-btn" href="/licenses?businessId=' + item.id + '">Ruhsat</a>' +
              '<button class="mini-btn" onclick="editBusiness(' + item.id + ')">Düzenle</button>' +
              ((item.mapsUrl || item.addressMapsUrl) ? '<a class="mini-btn" href="' + escapeHtml(item.mapsUrl || item.addressMapsUrl) + '" target="_blank" rel="noopener noreferrer">Google Maps Aç</a>' : '') +
              '<button class="mini-btn danger" onclick="deleteBusiness(' + item.id + ')">Sil</button>' +
            '</div>' +
          '</td>' +
        '</tr>';
      }

      body.innerHTML = html;
    }

    async function loadCategories() {
      var response = await fetch('/api/business-categories');
      if (!response.ok) throw new Error();
      categories = await response.json();
      renderCategoryOptions();
      renderStats();
    }

    async function loadBusinesses() {
      var response = await fetch('/api/businesses');
      if (!response.ok) throw new Error();
      businesses = await response.json();
      renderStats();
      renderBusinessTable();
    }

    function exportBusinessesExcel() {
      var rows = getFilteredBusinesses();
      if (!rows.length) {
        alert('Bu filtreye uygun Excel çıktısı oluşturulacak firma kaydı bulunmuyor.');
        return;
      }

      var query = new URLSearchParams();
      var categoryId = document.getElementById('filterCategory').value;
      var licenseStatus = document.getElementById('licenseFilter').value;
      var locationFilter = document.getElementById('locationFilter').value;
      var search = document.getElementById('searchInput').value.trim();

      if (categoryId) query.set('categoryId', categoryId);
      if (licenseStatus && licenseStatus !== 'all') query.set('licenseStatus', licenseStatus);
      if (locationFilter && locationFilter !== 'all') query.set('locationFilter', locationFilter);
      if (search) query.set('search', search);

      window.location.href = '/api/businesses/export.xlsx' + (query.toString() ? ('?' + query.toString()) : '');
    }

    function resetBusinessForm() {
      editingBusinessId = null;
      document.getElementById('businessModalTitle').textContent = 'Yeni Firma Ekle';
      document.getElementById('businessCategory').value = '';
      document.getElementById('businessTradeName').value = '';
      document.getElementById('businessOwnerName').value = '';
      document.getElementById('businessPhone').value = '';
      setAddressSelection('', '', '');
      document.getElementById('businessAda').value = '';
      document.getElementById('businessParcel').value = '';
      document.getElementById('businessLocationLat').value = '';
      document.getElementById('businessLocationLng').value = '';
      document.getElementById('businessGoogleMapsLink').value = '';
      document.getElementById('locationInfoText').textContent = 'Konumu telefondan alabilirsiniz. Telefon yanlış konum verirse Google Maps uygulamasında işyerine uzun basıp bağlantıyı kopyalayın ve buraya yapıştırın.';
      document.getElementById('locationResolvedText').textContent = '';
      document.getElementById('locationPreviewRow').innerHTML = '';
      selectedMapCoords = null;
    }

    function openNewBusinessModal() {
      resetBusinessForm();
      openModal('businessModal');
    }

    function openCategoryModal() {
      document.getElementById('categoryNameInput').value = '';
      openModal('categoryModal');
      setTimeout(function() {
        var input = document.getElementById('categoryNameInput');
        if (input) input.focus();
      }, 40);
    }

    function editBusiness(id) {
      var item = null;
      for (var i = 0; i < businesses.length; i++) {
        if (String(businesses[i].id) === String(id)) {
          item = businesses[i];
          break;
        }
      }

      if (!item) return;

      editingBusinessId = id;
      document.getElementById('businessModalTitle').textContent = 'Firma Düzenle';
      document.getElementById('businessCategory').value = item.categoryId || '';
      document.getElementById('businessTradeName').value = item.tradeName || '';
      document.getElementById('businessOwnerName').value = item.ownerName || '';
      document.getElementById('businessPhone').value = item.phone || '';
      setAddressSelection(item.neighborhood || '', item.street || '', item.doorNo || '');
      document.getElementById('businessAda').value = item.ada || '';
      document.getElementById('businessParcel').value = item.parcel || '';
      document.getElementById('businessLocationLat').value = item.locationLat !== null ? item.locationLat : '';
      document.getElementById('businessLocationLng').value = item.locationLng !== null ? item.locationLng : '';
      document.getElementById('businessGoogleMapsLink').value = item.mapsUrl || item.addressMapsUrl || '';
      updateLocationPreview();
      openModal('businessModal');
    }

    function setResolvedLocationText(textValue, isWarning) {
      var el = document.getElementById('locationResolvedText');
      if (!el) return;
      if (!textValue) {
        el.innerHTML = '';
        return;
      }
      el.innerHTML = '<span' + (isWarning ? ' style="color:#b45309;font-weight:600;"' : '') + '>Algılanan yer:</span> ' + escapeHtml(textValue);
    }

    async function resolveLocationText(lat, lng) {
      try {
        var response = await fetch('/api/geocode/reverse?lat=' + encodeURIComponent(lat) + '&lng=' + encodeURIComponent(lng));
        if (!response.ok) return '';
        var data = await response.json();
        return data.shortText || data.displayName || '';
      } catch (error) {
        return '';
      }
    }

    function getCurrentBusinessAddressQuery() {
      var parts = [];
      var tradeName = document.getElementById('businessTradeName').value.trim();
      var neighborhood = getCanonicalNeighborhoodName(document.getElementById('businessNeighborhood').value.trim());
      var street = document.getElementById('businessStreet').value.trim();
      var doorNo = document.getElementById('businessDoorNo').value.trim();
      var ada = document.getElementById('businessAda').value.trim();
      var parcel = document.getElementById('businessParcel').value.trim();

      if (tradeName) parts.push(tradeName);
      if (neighborhood) parts.push(neighborhood + ' Mahallesi');
      if (street) parts.push(street);
      if (doorNo) parts.push('No: ' + doorNo);
      if (ada || parcel) parts.push((ada ? 'Ada ' + ada : '') + (ada && parcel ? ' ' : '') + (parcel ? 'Parsel ' + parcel : ''));
      parts.push('Bucak', 'Burdur', 'Türkiye');
      return parts.filter(Boolean).join(', ');
    }

    function buildCurrentMapsUrl() {
      var lat = document.getElementById('businessLocationLat').value.trim();
      var lng = document.getElementById('businessLocationLng').value.trim();
      if (lat && lng) {
        return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(lat + ',' + lng);
      }
      var addressQuery = getCurrentBusinessAddressQuery();
      if (!addressQuery) return '';
      return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(addressQuery);
    }

    function openCurrentLocationInGoogleMaps() {
      var url = buildCurrentMapsUrl();
      if (!url) {
        alert('Önce adres veya konum bilgisi girin.');
        return;
      }
      window.open(url, '_blank', 'noopener');
    }

    async function fillLocationFromGoogleMapsLink() {
      var input = document.getElementById('businessGoogleMapsLink');
      var rawUrl = input.value.trim();
      if (!rawUrl) {
        alert('Lütfen Google Maps bağlantısını yapıştırın.');
        return;
      }

      try {
        document.getElementById('locationInfoText').textContent = 'Google Maps bağlantısı çözümleniyor...';
        var response = await fetch('/api/maps/resolve-link?url=' + encodeURIComponent(rawUrl));
        var data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || 'Bağlantı çözümlenemedi.');
        }

        document.getElementById('businessLocationLat').value = data.lat;
        document.getElementById('businessLocationLng').value = data.lng;
        input.value = data.finalUrl || rawUrl;
        updateLocationPreview();
        var resolvedText = await resolveLocationText(data.lat, data.lng);
        setResolvedLocationText(resolvedText, false);
        document.getElementById('locationInfoText').textContent = 'Konum Google Maps bağlantısından alındı ve koordinatlar dolduruldu.';
      } catch (error) {
        document.getElementById('locationInfoText').textContent = 'Google Maps bağlantısı çözümlenemedi.';
        alert(error.message || 'Google Maps bağlantısı çözümlenemedi.');
      }
    }

    function openMapPickerAt(lat, lng, noteText) {
      if (!ensureMapPickerReady()) return;
      openModal('mapPickerModal');
      setTimeout(function() {
        mapPicker.invalidateSize();
        setMapSelection(lat, lng);
        if (noteText) {
          document.getElementById('mapPickerSelectionText').innerHTML += '<div class="map-help tight">' + escapeHtml(noteText) + '</div>';
        }
      }, 80);
    }

    function updateLocationPreview() {
      var preview = document.getElementById('locationPreviewRow');
      var url = buildCurrentMapsUrl();
      var lat = document.getElementById('businessLocationLat').value.trim();
      var lng = document.getElementById('businessLocationLng').value.trim();

      if (!url) {
        preview.innerHTML = '';
        return;
      }

      var text = (lat && lng) ? "Seçilen Konumu Google Maps'te Kontrol Et" : "Adrese Göre Google Maps'te Aç";
      preview.innerHTML = '<a class="mini-btn" href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer">' + text + '</a>';
    }

    function getBestCurrentPosition() {
      return new Promise(function(resolve, reject) {
        if (!navigator.geolocation) {
          reject(new Error('Geolocation desteklenmiyor.'));
          return;
        }

        var bestPosition = null;
        var finished = false;
        var options = { enableHighAccuracy: true, timeout: 30000, maximumAge: 0 };
        var fallbackTimer = null;
        var watchId = null;

        function cleanup() {
          if (fallbackTimer) clearTimeout(fallbackTimer);
          if (watchId !== null) {
            try { navigator.geolocation.clearWatch(watchId); } catch (error) {}
          }
        }

        function finishWithSuccess() {
          if (finished) return;
          finished = true;
          cleanup();
          if (bestPosition) {
            resolve(bestPosition);
          } else {
            reject(new Error('Konum alınamadı.'));
          }
        }

        function consider(position) {
          if (!position || !position.coords) return;
          if (!bestPosition || Number(position.coords.accuracy || 999999) < Number(bestPosition.coords.accuracy || 999999)) {
            bestPosition = position;
          }
          if (bestPosition && Number(bestPosition.coords.accuracy || 999999) <= 25) {
            finishWithSuccess();
          }
        }

        function fail(error) {
          if (!bestPosition && !finished && error && error.code !== 3) {
            finished = true;
            cleanup();
            reject(error);
          }
        }

        fallbackTimer = setTimeout(finishWithSuccess, 20000);
        watchId = navigator.geolocation.watchPosition(consider, fail, options);
        navigator.geolocation.getCurrentPosition(consider, fail, options);
      });
    }

    async function fillCurrentLocation() {
      var button = document.getElementById('getLocationBtn');
      var info = document.getElementById('locationInfoText');

      if (!navigator.geolocation) {
        alert('Bu cihaz konum hizmetini desteklemiyor.');
        return;
      }

      try {
        button.disabled = true;
        button.textContent = 'Alınıyor...';
        info.textContent = 'Cihazın daha doğru GPS verisi bekleniyor. Lütfen 15-20 saniye sabit kalın.';
        setResolvedLocationText('', false);

        var position = await getBestCurrentPosition();
        var lat = Number(position.coords.latitude).toFixed(6);
        var lng = Number(position.coords.longitude).toFixed(6);
        var accuracy = position.coords.accuracy ? Math.round(position.coords.accuracy) : null;
        var resolvedText = await resolveLocationText(lat, lng);

        if (accuracy !== null && accuracy > 80) {
          document.getElementById('businessLocationLat').value = '';
          document.getElementById('businessLocationLng').value = '';
          selectedMapCoords = null;
          updateLocationPreview();
          info.textContent = "Cihaz yaklaşık konum verdi (±" + accuracy + " m). Yanlış kayıt olmaması için bu koordinat yazılmadı. Google Maps'te doğru noktayı açıp bağlantıyı yapıştırın.";
          setResolvedLocationText(resolvedText || 'Yaklaşık konum bulundu.', true);
          return;
        }

        document.getElementById('businessLocationLat').value = lat;
        document.getElementById('businessLocationLng').value = lng;
        selectedMapCoords = { lat: Number(lat), lng: Number(lng) };
        updateLocationPreview();
        setResolvedLocationText(resolvedText, false);

        if (accuracy !== null) {
          info.textContent = 'Konum başarıyla alındı. Yaklaşık doğruluk: ±' + accuracy + ' m.';
        } else {
          info.textContent = 'Konum başarıyla alındı.';
        }
      } catch (error) {
        info.textContent = 'Konum alınamadı. Tarayıcı konum izni ve telefondaki “kesin konum” ayarını kontrol edin.';
        setResolvedLocationText('', false);
        alert('Konum alınamadı. Telefonda tarayıcı izinlerinde konum ve mümkünse “kesin konum” açık olmalı. İstersen Google Maps bağlantısını yapıştırarak da konum alabilirsin.');
      } finally {
        button.disabled = false;
        button.textContent = 'Konum Al';
      }
    }

    function ensureMapPickerReady() {
      if (!window.L) {
        alert('Harita bileşeni yüklenemedi. İnternet bağlantısını kontrol edin.');
        return false;
      }

      if (!mapPicker) {
        mapPicker = L.map('mapPickerCanvas');
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap katkıları'
        }).addTo(mapPicker);

        mapPicker.on('click', function(event) {
          setMapSelection(event.latlng.lat, event.latlng.lng);
        });
      }

      return true;
    }

    async function setMapSelection(lat, lng) {
      if (!mapPicker) return;
      selectedMapCoords = { lat: Number(lat), lng: Number(lng) };

      if (!mapMarker) {
        mapMarker = L.marker([lat, lng], { draggable: true }).addTo(mapPicker);
        mapMarker.on('dragend', function(event) {
          var point = event.target.getLatLng();
          setMapSelection(point.lat, point.lng);
        });
      } else {
        mapMarker.setLatLng([lat, lng]);
      }

      mapPicker.setView([lat, lng], Math.max(mapPicker.getZoom(), 18));
      var resolvedText = await resolveLocationText(Number(lat).toFixed(6), Number(lng).toFixed(6));
      document.getElementById('mapPickerSelectionText').innerHTML = '<div class="cell-title compact">Seçilen konum: ' + escapeHtml(Number(lat).toFixed(6) + ', ' + Number(lng).toFixed(6)) + '</div>' + (resolvedText ? '<div class="cell-sub">' + escapeHtml(resolvedText) + '</div>' : '');
    }

    function openMapPicker() {
      if (!ensureMapPickerReady()) return;

      openModal('mapPickerModal');
      var lat = parseFloat(document.getElementById('businessLocationLat').value);
      var lng = parseFloat(document.getElementById('businessLocationLng').value);

      setTimeout(function() {
        mapPicker.invalidateSize();

        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          setMapSelection(lat, lng);
        } else {
          selectedMapCoords = null;
          document.getElementById('mapPickerSelectionText').innerHTML = '<div class="muted">Henüz konum seçilmedi.</div>';
          mapPicker.setView([37.7144, 30.2908], 12);
          if (mapMarker) {
            mapPicker.removeLayer(mapMarker);
            mapMarker = null;
          }
        }
      }, 80);
    }

    async function centerMapOnCurrentLocation() {
      if (!ensureMapPickerReady()) return;
      try {
        document.getElementById('mapPickerSelectionText').innerHTML = '<div class="muted">Mevcut konum getiriliyor...</div>';
        var position = await getBestCurrentPosition();
        await setMapSelection(position.coords.latitude, position.coords.longitude);
        var accuracy = position.coords.accuracy ? Math.round(position.coords.accuracy) : null;
        if (accuracy !== null && accuracy > 80) {
          document.getElementById('mapPickerSelectionText').innerHTML += '<div class="map-help tight" style="color:#b45309;">Cihaz yaklaşık konum verdi (±' + accuracy + ' m). Lütfen işyerinin tam yerine dokunarak veya işaretçiyi sürükleyerek düzeltin.</div>';
        }
      } catch (error) {
        alert('Mevcut konum ile harita ortalanamadı. Tarayıcı izinlerini kontrol edin.');
      }
    }

    async function applyMapSelection() {
      if (!selectedMapCoords) {
        alert('Lütfen haritada bir nokta seçin.');
        return;
      }

      var latValue = Number(selectedMapCoords.lat).toFixed(6);
      var lngValue = Number(selectedMapCoords.lng).toFixed(6);
      document.getElementById('businessLocationLat').value = latValue;
      document.getElementById('businessLocationLng').value = lngValue;
      document.getElementById('locationInfoText').textContent = 'Konum haritadan seçildi. Kaydetmeden önce isterseniz harita bağlantısından doğrulayabilirsiniz.';
      var resolvedText = await resolveLocationText(latValue, lngValue);
      setResolvedLocationText(resolvedText, false);
      updateLocationPreview();
      closeModal('mapPickerModal');
    }

    async function saveCategory() {
      var input = document.getElementById('categoryNameInput');
      var name = input.value.trim();

      if (!name) {
        alert('Kategori adı giriniz.');
        return;
      }

      try {
        var response = await fetch('/api/business-categories', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name })
        });

        if (!response.ok) throw new Error();

        closeModal('categoryModal');
        await loadCategories();
      } catch (error) {
        alert('Kategori kaydedilemedi.');
      }
    }

    async function saveBusiness() {
      var payload = {
        categoryId: document.getElementById('businessCategory').value,
        tradeName: document.getElementById('businessTradeName').value.trim(),
        ownerName: document.getElementById('businessOwnerName').value.trim(),
        phone: document.getElementById('businessPhone').value.trim(),
        neighborhood: document.getElementById('businessNeighborhood').value.trim(),
        street: document.getElementById('businessStreet').value.trim(),
        doorNo: document.getElementById('businessDoorNo').value.trim(),
        ada: document.getElementById('businessAda').value.trim(),
        parcel: document.getElementById('businessParcel').value.trim(),
        locationLat: document.getElementById('businessLocationLat').value.trim(),
        locationLng: document.getElementById('businessLocationLng').value.trim()
      };

      if (!payload.categoryId || !payload.tradeName || !payload.ownerName) {
        alert('Kategori, işyeri ünvanı ve işyeri sahibi zorunludur.');
        return;
      }

      try {
        var url = editingBusinessId ? ('/api/businesses/' + editingBusinessId) : '/api/businesses';
        var method = editingBusinessId ? 'PUT' : 'POST';

        var response = await fetch(url, {
          method: method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (!response.ok) throw new Error();

        closeModal('businessModal');
        await loadBusinesses();
      } catch (error) {
        alert('İşyeri kaydı kaydedilemedi.');
      }
    }

    async function deleteBusiness(id) {
      var item = null;
      for (var i = 0; i < businesses.length; i++) {
        if (String(businesses[i].id) === String(id)) {
          item = businesses[i];
          break;
        }
      }

      if (!item) return;
      var ok = confirm(item.tradeName + ' kaydını silmek istiyor musunuz?');
      if (!ok) return;

      try {
        var response = await fetch('/api/businesses/' + id, { method: 'DELETE' });
        if (!response.ok) throw new Error();
        await loadBusinesses();
      } catch (error) {
        alert('İşyeri silinemedi.');
      }
    }
    function toggleSidebar(forceOpen) {
      var shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : !document.body.classList.contains('sidebar-open');
      document.body.classList.toggle('sidebar-open', shouldOpen);
    }

    document.addEventListener('DOMContentLoaded', async function() {
      setTodayText();
      try {
        await loadCategories();
        await loadBusinesses();
      } catch (error) {
        alert('Veriler yüklenemedi.');
      }

      var overlays = document.querySelectorAll('.modal-overlay');
      for (var i = 0; i < overlays.length; i++) {
        overlays[i].addEventListener('click', function(event) {
          if (event.target === this) closeModal(this.id);
        });
      }

      initAddressSelectors();
      document.getElementById('businessLocationLat').addEventListener('input', updateLocationPreview);
      document.getElementById('businessLocationLng').addEventListener('input', updateLocationPreview);

      document.addEventListener('keydown', function(event) {
        if (event.key === 'Escape') {
          var open = document.querySelector('.modal-overlay.show');
          if (open) { closeModal(open.id); return; }
          if (document.body.classList.contains('sidebar-open')) { toggleSidebar(false); return; }
          return;
        }

        if (event.key === 'Enter') {
          var categoryModal = document.getElementById('categoryModal');
          if (categoryModal && categoryModal.classList.contains('show') && event.target && event.target.id === 'categoryNameInput') {
            event.preventDefault();
            saveCategory();
          }
        }
      });
    });
  </script>
</body>
</html>`);
});

app.get("/businesses/:id", (req, res) => {
  const businessId = Number(req.params.id);
  if (!Number.isFinite(businessId)) {
    return res.redirect('/businesses');
  }

  res.send(`<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Zabıta Yönetim Sistemi - Firma Detayı</title>
  <style>
    :root {
      --bg: #f4f7fb;
      --panel: #ffffff;
      --panel-soft: #f8fafc;
      --line: #dbe3ee;
      --text: #17202f;
      --muted: #667085;
      --navy: #163a63;
      --primary: #2563eb;
      --success: #16a34a;
      --danger: #dc2626;
      --warning: #f59e0b;
      --shadow: 0 8px 24px rgba(15, 23, 42, 0.06);
      --shadow-strong: 0 20px 48px rgba(15, 23, 42, 0.16);
    }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Inter, "Segoe UI", Arial, sans-serif; background: #f3f6fa; color: var(--text); }
    body.drawer-open { overflow: hidden; }
    .app { min-height: 100vh; display: block; }
    .sidebar { background: linear-gradient(180deg, #17324f 0%, #12283f 100%); color: #fff; padding: 16px 12px; display: flex; flex-direction: column; gap: 14px; position: fixed; left: 0; top: 0; bottom: 0; width: min(84vw, 320px); height: 100vh; border-right: 1px solid rgba(255,255,255,0.06); z-index: 60; transform: translateX(-100%); transition: transform 0.22s ease; box-shadow: 0 20px 48px rgba(15, 23, 42, 0.18); overflow-y: auto; }
    body.sidebar-open { overflow: hidden; }
    body.sidebar-open .sidebar { transform: translateX(0); }
    .sidebar-top { display: flex; align-items: center; gap: 9px; padding-bottom: 12px; border-bottom: 1px solid rgba(255,255,255,0.1); }
    .brand-mark { width: 38px; height: 38px; border-radius: 11px; background: linear-gradient(135deg, rgba(245,179,1,1) 0%, rgba(255,217,102,1) 100%); color: #0f172a; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 14px; box-shadow: 0 8px 18px rgba(245, 179, 1, 0.16); }
    .brand { font-size: 14px; font-weight: 700; line-height: 1.3; }
    .brand-sub { font-size: 10.5px; color: rgba(255,255,255,0.62); line-height: 1.45; }
    .nav-section-title { font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(255,255,255,0.42); margin-top: 6px; padding: 0 2px; font-weight: 700; }
    .menu { display: flex; flex-direction: column; gap: 4px; }
    .menu-item { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 9px 10px; border-radius: 10px; font-size: 12.5px; text-decoration: none; color: rgba(255,255,255,0.84); transition: 0.18s ease; border: 1px solid transparent; font-weight: 500; }
    .menu-item:hover { background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.08); }
    .menu-item.active { background: rgba(255,255,255,0.08); color: #ffffff; border-color: rgba(255,255,255,0.1); font-weight: 600; }
    .menu-left { display: inline-flex; align-items: center; gap: 8px; }
    .sidebar-toggle { display: inline-flex; align-items: center; gap: 8px; margin-bottom: 14px; border: 1px solid var(--line); background: #ffffff; color: var(--text); border-radius: 12px; padding: 12px 14px; font-size: 14px; font-weight: 700; box-shadow: var(--shadow); cursor: pointer; }
    .sidebar-backdrop { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.45); opacity: 0; pointer-events: none; transition: opacity 0.18s ease; z-index: 50; }
    body.sidebar-open .sidebar-backdrop { opacity: 1; pointer-events: auto; }
    .main { padding: 18px 20px; min-width: 0; }
    .hero, .panel, .stat-card { background: #ffffff; border: 1px solid var(--line); border-radius: 14px; box-shadow: var(--shadow); }
    .hero { padding: 16px 18px; display: flex; justify-content: space-between; gap: 14px; align-items: flex-start; flex-wrap: wrap; margin-bottom: 12px; }
    .crumb { font-size: 12px; color: var(--muted); margin-bottom: 8px; }
    .crumb a { color: #1d4ed8; text-decoration: none; }
    .hero-title { margin: 0; font-size: 26px; line-height: 1.15; letter-spacing: -0.02em; font-weight: 700; }
    .hero-text { margin: 6px 0 0; color: var(--muted); font-size: 12.5px; line-height: 1.6; max-width: 820px; }
    .toolbar { display: flex; gap: 8px; flex-wrap: wrap; }
    .btn { border: none; border-radius: 10px; padding: 10px 14px; font-size: 13px; font-weight: 600; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; justify-content: center; transition: 0.15s ease; }
    .btn:hover { transform: translateY(-1px); opacity: 0.96; }
    .btn-primary { background: var(--primary); color: #ffffff; }
    .btn-secondary { background: #64748b; color: #ffffff; }
    .btn-ghost { background: #eef2ff; color: #1d4ed8; border: 1px solid #dbe7ff; }
    .btn-danger { background: var(--danger); color: #ffffff; }
    .btn[disabled] { opacity: 0.65; cursor: wait; transform: none; }
    .stats-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-bottom: 12px; }
    .stat-card { padding: 14px; display: grid; gap: 7px; }
    .stat-label { font-size: 11px; font-weight: 700; color: var(--muted); letter-spacing: 0.05em; text-transform: uppercase; }
    .stat-value { font-size: 22px; font-weight: 700; line-height: 1.05; }
    .stat-sub { font-size: 12px; color: var(--muted); }
    .panel { padding: 16px; margin-bottom: 12px; }
    .panel-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; flex-wrap: wrap; }
    .panel-title { font-size: 15px; font-weight: 700; }
    .panel-subtitle { font-size: 12.5px; color: var(--muted); margin-top: 3px; }
    .action-row { display: flex; gap: 8px; flex-wrap: wrap; }
    .summary-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
    .info-item { border: 1px solid var(--line); background: var(--panel-soft); border-radius: 12px; padding: 12px; min-height: 88px; }
    .info-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 700; color: var(--muted); margin-bottom: 7px; }
    .info-value { font-size: 13px; line-height: 1.55; white-space: pre-line; }
    .license-layout { display: grid; grid-template-columns: 1.3fr 1fr; gap: 12px; }
    .license-note-box { border: 1px solid var(--line); background: var(--panel-soft); border-radius: 12px; padding: 12px; height: 100%; }
    .note-title { font-size: 12px; font-weight: 700; color: var(--muted); margin-bottom: 6px; }
    .note-body { font-size: 13px; line-height: 1.6; white-space: pre-line; }
    .suggestion-list { display: grid; gap: 10px; }
    .suggestion-card { border: 1px solid var(--line); border-radius: 14px; background: #ffffff; overflow: hidden; box-shadow: 0 2px 10px rgba(15, 23, 42, 0.04); }
    .suggestion-head { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; padding: 14px 16px; background: linear-gradient(180deg, #fbfcfe 0%, #f7faff 100%); border-bottom: 1px solid #e7eef8; }
    .suggestion-title { font-size: 15px; font-weight: 700; line-height: 1.35; margin: 0; }
    .suggestion-sub { color: var(--muted); font-size: 12px; line-height: 1.55; margin-top: 4px; }
    .suggestion-body { padding: 14px 16px 16px; display: grid; gap: 12px; }
    .suggestion-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
    .suggestion-note { border: 1px solid var(--line); background: var(--panel-soft); border-radius: 12px; padding: 12px; }
    .suggestion-actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .mini-btn { border: 1px solid var(--line); background: #ffffff; border-radius: 9px; padding: 7px 10px; font-size: 12px; font-weight: 600; cursor: pointer; text-decoration: none; color: #111827; display: inline-flex; align-items: center; gap: 6px; }
    .mini-btn.primary { border-color: #cfe0ff; color: #1d4ed8; background: #eef4ff; }
    .mini-btn.danger { border-color: #fecaca; color: #b91c1c; background: #fff1f2; }
    .badge { display: inline-flex; align-items: center; gap: 6px; padding: 6px 9px; border-radius: 999px; font-size: 11px; font-weight: 700; }
    .badge.success { background: #dcfce7; color: #166534; }
    .badge.warn { background: #fef3c7; color: #92400e; }
    .badge.gray { background: #e5e7eb; color: #374151; }
    .table-wrap { overflow: auto; border: 1px solid var(--line); border-radius: 12px; }
    table { width: 100%; border-collapse: collapse; min-width: 860px; }
    th, td { padding: 12px; border-bottom: 1px solid #edf2f7; font-size: 13px; text-align: left; vertical-align: top; }
    th { background: #f8fafc; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); }
    tr:last-child td { border-bottom: none; }
    .stack { display: grid; gap: 4px; }
    .muted { color: var(--muted); font-size: 12px; }
    .empty-state, .loading { border: 1px dashed var(--line); border-radius: 12px; background: #fbfdff; padding: 22px; text-align: center; color: var(--muted); font-size: 13px; }
    .inspection-shell { display: grid; gap: 12px; }
    .inspection-summary-bar { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
    .inspection-mini-stat { border: 1px solid var(--line); background: linear-gradient(180deg, #fbfdff 0%, #f7faff 100%); border-radius: 12px; padding: 12px; min-height: 86px; }
    .inspection-mini-label { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 700; color: var(--muted); margin-bottom: 6px; }
    .inspection-mini-value { font-size: 24px; font-weight: 700; line-height: 1; margin-bottom: 6px; }
    .inspection-mini-sub { font-size: 12px; color: var(--muted); line-height: 1.5; }
    .inspection-list { display: grid; gap: 10px; }
    .inspection-card { border: 1px solid var(--line); border-radius: 14px; background: #ffffff; overflow: hidden; box-shadow: 0 2px 10px rgba(15, 23, 42, 0.04); }
    .inspection-card-head { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; padding: 14px 16px; background: linear-gradient(180deg, #fbfcfe 0%, #f7faff 100%); border-bottom: 1px solid #e7eef8; }
    .inspection-card-date { display: grid; gap: 4px; }
    .inspection-card-kicker { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 700; color: var(--muted); }
    .inspection-card-title { font-size: 16px; font-weight: 700; line-height: 1.25; }
    .inspection-badges { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
    .inspection-card-body { padding: 14px 16px 16px; display: grid; gap: 12px; }
    .inspection-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
    .inspection-field { border: 1px solid #e9eef5; background: #fbfdff; border-radius: 12px; padding: 11px 12px; min-height: 78px; }
    .inspection-field-label { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 700; color: var(--muted); margin-bottom: 6px; }
    .inspection-field-value { font-size: 13px; line-height: 1.55; color: var(--text); white-space: pre-line; }
    .inspection-note-box { border: 1px solid #e7edf5; background: #fafcff; border-radius: 12px; padding: 12px 13px; }
    .inspection-note-title { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 700; color: var(--muted); margin-bottom: 6px; }
    .inspection-note-body { font-size: 13px; line-height: 1.65; color: var(--text); white-space: pre-line; }
    .inspection-card-footer { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
    .inspection-footer-meta { font-size: 12px; color: var(--muted); }
    .inspection-attachments { border-top: 1px solid #edf2f7; padding-top: 12px; display: grid; gap: 12px; }
    .inspection-attachments-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; }
    .inspection-upload-row { display: grid; grid-template-columns: 150px minmax(0, 1fr) auto; gap: 10px; align-items: center; }
    .inspection-file-columns { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .inspection-file-column { display: grid; gap: 8px; }
    .inspection-file-group-title { font-size: 12px; font-weight: 700; color: #334155; }
    .badge.info { background: #dbeafe; color: #1d4ed8; }
    .badge.danger { background: #fee2e2; color: #b91c1c; }

    .drawer-overlay { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.42); opacity: 0; pointer-events: none; transition: opacity 0.18s ease; z-index: 120; }
    .drawer-overlay.show { opacity: 1; pointer-events: auto; }
    .drawer { position: absolute; right: 0; top: 0; bottom: 0; width: min(560px, 100vw); background: #ffffff; box-shadow: var(--shadow-strong); transform: translateX(100%); transition: transform 0.22s ease; display: flex; flex-direction: column; }
    .drawer-overlay.show .drawer { transform: translateX(0); }
    .drawer-header { padding: 18px 18px 14px; border-bottom: 1px solid var(--line); display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
    .drawer-title { font-size: 17px; font-weight: 700; margin: 0; }
    .drawer-subtitle { font-size: 12.5px; color: var(--muted); margin-top: 4px; line-height: 1.6; }
    .close-btn { width: 36px; height: 36px; border-radius: 10px; border: 1px solid var(--line); background: #ffffff; cursor: pointer; font-size: 18px; }
    .drawer-body { padding: 18px; overflow: auto; flex: 1; }
    .drawer-section { display: none; }
    .drawer-section.active { display: block; }
    .form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .form-group { display: grid; gap: 6px; }
    .form-group.full { grid-column: 1 / -1; }
    label { font-size: 12px; font-weight: 700; color: #334155; }
    input, select, textarea { width: 100%; border: 1px solid #d6dfeb; border-radius: 10px; padding: 11px 12px; font: inherit; background: #ffffff; }
    textarea { min-height: 110px; resize: vertical; }
    input:focus, select:focus, textarea:focus { outline: none; border-color: #2563eb; box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.12); }
    .hint-card { background: #f8fafc; border: 1px solid var(--line); border-radius: 12px; padding: 12px; font-size: 12.5px; color: var(--muted); line-height: 1.6; margin-bottom: 14px; }
    .drawer-footer { padding: 14px 18px; border-top: 1px solid var(--line); display: flex; justify-content: flex-end; gap: 8px; background: #ffffff; }
    .form-message { min-height: 18px; font-size: 12px; color: var(--muted); margin-top: 8px; }
    .form-message.error { color: #b91c1c; }
    .form-message.success { color: #166534; }
    .toast { position: fixed; right: 18px; bottom: 18px; background: #0f172a; color: #ffffff; padding: 12px 14px; border-radius: 12px; font-size: 13px; box-shadow: var(--shadow-strong); opacity: 0; transform: translateY(8px); pointer-events: none; transition: all 0.18s ease; z-index: 140; }
    .toast.show { opacity: 1; transform: translateY(0); }
    .upload-shell { display: grid; grid-template-columns: minmax(280px, 360px) minmax(0, 1fr); gap: 12px; align-items: start; }
    .upload-card { border: 1px solid var(--line); background: #fbfdff; border-radius: 14px; padding: 14px; }
    .upload-card-title { font-size: 13px; font-weight: 700; margin-bottom: 4px; }
    .upload-card-subtitle { font-size: 12px; color: var(--muted); line-height: 1.55; margin-bottom: 12px; }
    .upload-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
    .file-group { display: grid; gap: 12px; }
    .file-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 10px; }
    .file-card { border: 1px solid var(--line); background: #ffffff; border-radius: 14px; overflow: hidden; display: grid; min-height: 100%; }
    .file-thumb { aspect-ratio: 16 / 10; background: linear-gradient(180deg, #eef4ff 0%, #f8fbff 100%); display: flex; align-items: center; justify-content: center; overflow: hidden; }
    .file-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .file-thumb-icon { font-size: 40px; opacity: 0.8; }
    .file-body { padding: 12px; display: grid; gap: 7px; }
    .file-name { font-size: 13px; font-weight: 700; line-height: 1.45; word-break: break-word; }
    .file-meta { font-size: 12px; color: var(--muted); line-height: 1.5; }
    .file-tags { display: flex; gap: 6px; flex-wrap: wrap; }
    .file-tag { display: inline-flex; align-items: center; padding: 5px 8px; border-radius: 999px; font-size: 11px; font-weight: 700; background: #eef4ff; color: #1d4ed8; border: 1px solid #dbe7ff; }
    .file-tag.gray { background: #f3f4f6; color: #374151; border-color: #e5e7eb; }
    .file-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 2px; }
    .group-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .group-title { font-size: 13px; font-weight: 700; }
    .group-subtitle { font-size: 12px; color: var(--muted); }
    .empty-file-box { border: 1px dashed var(--line); background: #fbfdff; border-radius: 12px; padding: 16px; color: var(--muted); font-size: 12.5px; text-align: center; }
    .compact-textarea { min-height: 86px; }
    .upload-help { font-size: 12px; color: var(--muted); line-height: 1.55; margin-top: 8px; }

    @media (max-width: 980px) {
      .main { padding: 14px; }
      .stats-grid, .summary-grid, .license-layout, .suggestion-grid, .form-grid, .inspection-summary-bar, .inspection-grid, .upload-shell, .inspection-file-columns, .inspection-upload-row { grid-template-columns: 1fr; }
      .hero-title { font-size: 22px; }
      .drawer { width: 100vw; }
      .inspection-card-head, .inspection-card-footer { flex-direction: column; align-items: stretch; }
      .inspection-badges { justify-content: flex-start; }
    }
  </style>
</head>
<body>
  <div class="sidebar-backdrop" id="sidebarBackdrop" onclick="toggleSidebar(false)"></div>
  <div class="app">
    <aside class="sidebar" id="sidebar">
      <div class="sidebar-top">
        <div class="brand-mark">ZB</div>
        <div>
          <div class="brand">Zabıta Yönetim Sistemi</div>
          <div class="brand-sub">Kurumsal takip ve saha yönetimi</div>
        </div>
      </div>
      <div class="nav-section-title">Modüller</div>
      <nav class="menu">
        <a href="/" class="menu-item"><span class="menu-left"><span>📌</span><span>Şikayet Takip</span></span></a>
        <a href="/businesses" class="menu-item active"><span class="menu-left"><span>🏪</span><span>Firma Listesi</span></span></a>
        <a href="/inspections" class="menu-item"><span class="menu-left"><span>🧾</span><span>Tüm Denetimler</span></span></a>
        <a href="/licenses" class="menu-item"><span class="menu-left"><span>📜</span><span>Ruhsat Yönetimi</span></span></a>
        <a href="/markets" class="menu-item"><span class="menu-left"><span>🧺</span><span>Pazar Yönetimi</span></span></a>
      </nav>
    </aside>

    <main class="main">
      <button class="sidebar-toggle" type="button" onclick="toggleSidebar()">☰ Modüller</button>
      <section class="hero">
        <div>
          <div class="crumb"><a href="/businesses">Firma Listesi</a> / <span>Firma Detayı</span></div>
          <h1 class="hero-title" id="pageTitle">Firma Detayı</h1>
          <p class="hero-text">Bu ekranda firmaya ait temel bilgiler, ruhsat özeti ve denetim geçmişi tek sayfada izlenir. Ruhsat kaydı yalnızca Ruhsat Modülü üzerinden yönetilir.</p>
        </div>
        <div class="toolbar">
          <a class="btn btn-ghost" href="/businesses">← Listeye Dön</a>
          <a class="btn btn-ghost" href="/inspections">Tüm Denetimler</a>
          <a class="btn btn-secondary" id="openLicenseBtnTop" href="/licenses?businessId=${businessId}">Ruhsat Modülüne Git</a>
          <button class="btn btn-primary" type="button" id="openInspectionBtnTop">+ Yeni Denetim Ekle</button>
        </div>
      </section>

      <section class="stats-grid">
        <div class="stat-card">
          <div class="stat-label">Toplam Denetim</div>
          <div class="stat-value" id="statInspectionCount">0</div>
          <div class="stat-sub">Firmaya ait kayıtlı denetim adedi</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Ruhsat Durumu</div>
          <div class="stat-value" id="statLicenseStatus">-</div>
          <div class="stat-sub">Ruhsat modülünden gelen son durum özeti</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Son Denetim</div>
          <div class="stat-value" id="statLastInspection">-</div>
          <div class="stat-sub">En son girilen denetim tarihi</div>
        </div>
      </section>

      <section class="panel">
        <div class="panel-header">
          <div>
            <div class="panel-title">Firma Özeti</div>
            <div class="panel-subtitle">Firma temel kartı, adres ve saha bilgileri burada özetlenir.</div>
          </div>
          <div class="action-row" id="summaryActions"></div>
        </div>
        <div id="summaryContainer" class="loading">Firma bilgileri yükleniyor...</div>
      </section>

      <section class="panel">
        <div class="panel-header">
          <div>
            <div class="panel-title">Ruhsat Özeti</div>
            <div class="panel-subtitle">Bu bölüm sadece Ruhsat Modülünden gelen son durumu özetler. Düzenleme bu ekrandan yapılmaz.</div>
          </div>
          <a class="btn btn-ghost" id="openLicenseBtnSection" href="/licenses?businessId=${businessId}">Ruhsat Modülünü Aç</a>
        </div>
        <div id="licenseContainer" class="loading">Ruhsat bilgileri yükleniyor...</div>
      </section>

      <section class="panel">
        <div class="panel-header">
          <div>
            <div class="panel-title">Olası Ruhsat Eşleşmeleri</div>
            <div class="panel-subtitle">Bu firmaya önerilen ama henüz bağlanmamış ruhsat kayıtlarını buradan inceleyip onaylayabilirsin.</div>
          </div>
          <a class="btn btn-ghost" id="openLicenseBtnSuggestion" href="/licenses?businessId=${businessId}">Ruhsat Listesini Aç</a>
        </div>
        <div id="licenseSuggestionContainer" class="loading">Ruhsat eşleşme adayları yükleniyor...</div>
      </section>

      <section class="panel">
        <div class="panel-header">
          <div>
            <div class="panel-title">Denetim Geçmişi</div>
            <div class="panel-subtitle">Bu firmaya ait denetim kayıtları tarih sırasıyla burada tutulur.</div>
          </div>
          <button class="btn btn-primary" type="button" id="openInspectionBtnSection">+ Yeni Denetim Ekle</button>
        </div>
        <div id="inspectionContainer" class="loading">Denetim geçmişi yükleniyor...</div>
      </section>
    </main>
  </div>

  <div class="drawer-overlay" id="editorOverlay" aria-hidden="true">
    <aside class="drawer" role="dialog" aria-modal="true" aria-labelledby="drawerTitle">
      <div class="drawer-header">
        <div>
          <h2 class="drawer-title" id="drawerTitle">Düzenleme Paneli</h2>
          <div class="drawer-subtitle" id="drawerSubtitle">Seçilen işlem burada açılır.</div>
        </div>
        <button class="close-btn" type="button" id="closeDrawerBtn">×</button>
      </div>
      <div class="drawer-body">
        <section class="drawer-section" id="inspectionSection">
          <div class="hint-card">Yeni denetim ekleyebilir ya da mevcut kaydı düzenleyebilirsin. Süre verildi ise kontrol tarihini de gir.</div>
          <form id="inspectionForm">
            <input type="hidden" id="editingInspectionId" />
            <div class="form-grid">
              <div class="form-group">
                <label for="inspectionDate">Denetim Tarihi *</label>
                <input type="date" id="inspectionDate" required />
              </div>
              <div class="form-group">
                <label for="inspectionType">Denetim Türü</label>
                <input type="text" id="inspectionType" placeholder="Örnek: Genel denetim" />
              </div>
              <div class="form-group">
                <label for="inspectionResultStatus">Sonuç</label>
                <select id="inspectionResultStatus">
                  <option value="">Seçiniz</option>
                  <option value="Uygun">Uygun</option>
                  <option value="Eksik Var">Eksik Var</option>
                  <option value="Uyarı Yapıldı">Uyarı Yapıldı</option>
                  <option value="İşlem Yapıldı">İşlem Yapıldı</option>
                </select>
              </div>
              <div class="form-group">
                <label for="inspectionCurrentStatus">Durum</label>
                <select id="inspectionCurrentStatus">
                  <option value="">Seçiniz</option>
                  <option value="Açık">Açık</option>
                  <option value="Kapatıldı">Kapatıldı</option>
                  <option value="Süre Verildi">Süre Verildi</option>
                </select>
              </div>
              <div class="form-group full">
                <label for="inspectionActionTaken">Yapılan İşlem</label>
                <input type="text" id="inspectionActionTaken" placeholder="Örnek: İhtar verildi" />
              </div>
              <div class="form-group" id="inspectionControlDateGroup" style="display:none;">
                <label for="inspectionControlDate">Kontrol Tarihi</label>
                <input type="date" id="inspectionControlDate" />
              </div>
              <div class="form-group full">
                <label for="inspectionNote">Not</label>
                <textarea id="inspectionNote" placeholder="Denetim tespitleri veya kısa açıklama"></textarea>
              </div>
            </div>
            <div id="inspectionMessage" class="form-message"></div>
          </form>
        </section>
      </div>
      <div class="drawer-footer">
        <button class="btn btn-secondary" type="button" id="cancelDrawerBtn">Kapat</button>
        <button class="btn btn-primary" type="submit" form="inspectionForm" id="inspectionSubmitBtn">Kaydet</button>
      </div>
    </aside>
  </div>

  <div class="toast" id="toast"></div>

  <script>
    var businessId = ${businessId};
    var currentBusiness = null;
    var inspections = [];
    var inspectionFiles = [];
    var licenseSuggestions = [];
    var activeEditor = null;

    function escapeHtml(value) {
      if (value === null || value === undefined) return '';
      return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function badgeForLicense(status) {
      if (status === 'Var') return '<span class="badge success">Ruhsat Var</span>';
      if (status === 'Başvuru Aşamasında') return '<span class="badge warn">Başvuru Aşamasında</span>';
      return '<span class="badge gray">Ruhsat Yok</span>';
    }

    function badgeForRecordStatus(status) {
      if (status === 'Aktif') return '<span class="badge success">Aktif</span>';
      if (status === 'Pasif') return '<span class="badge gray">Pasif</span>';
      if (status === 'İptal') return '<span class="badge danger">İptal</span>';
      return '<span class="badge gray">' + escapeHtml(status || 'Belirsiz') + '</span>';
    }

    function badgeForInspectionStatus(status) {
      if (status === 'Kapatıldı') return '<span class="badge success">Kapatıldı</span>';
      if (status === 'Süre Verildi') return '<span class="badge warn">Süre Verildi</span>';
      if (status === 'Açık') return '<span class="badge danger">Açık</span>';
      if (status) return '<span class="badge gray">' + escapeHtml(status) + '</span>';
      return '<span class="badge gray">Belirtilmedi</span>';
    }

    function badgeForInspectionResult(status) {
      if (status === 'Uygun') return '<span class="badge success">Uygun</span>';
      if (status === 'Eksik Var') return '<span class="badge warn">Eksik Var</span>';
      if (status === 'Uyarı Yapıldı') return '<span class="badge danger">Uyarı Yapıldı</span>';
      if (status === 'İşlem Yapıldı') return '<span class="badge info">İşlem Yapıldı</span>';
      if (status) return '<span class="badge gray">' + escapeHtml(status) + '</span>';
      return '<span class="badge gray">Sonuç Girilmedi</span>';
    }

    function getInspectionSummary() {
      var today = new Date().toISOString().slice(0, 10);
      var summary = { total: inspections.length, acik: 0, sureVerildi: 0, geciken: 0 };
      for (var i = 0; i < inspections.length; i++) {
        var item = inspections[i];
        if (item.currentStatus === 'Açık') summary.acik += 1;
        if (item.currentStatus === 'Süre Verildi') {
          summary.sureVerildi += 1;
          if (item.controlDate && item.controlDate < today) {
            summary.geciken += 1;
          }
        }
      }
      return summary;
    }

    function inspectionField(label, value) {
      return '<div class="inspection-field"><div class="inspection-field-label">' + label + '</div><div class="inspection-field-value">' + value + '</div></div>';
    }

    function formatFileSize(bytes) {
      var size = Number(bytes || 0);
      if (!size) return '0 KB';
      if (size < 1024) return size + ' B';
      if (size < 1024 * 1024) return (size / 1024).toFixed(1).replace(/\.0$/, '') + ' KB';
      return (size / (1024 * 1024)).toFixed(1).replace(/\.0$/, '') + ' MB';
    }

    function getInspectionFiles(inspectionId, fileType) {
      return inspectionFiles.filter(function(item) {
        return String(item.inspectionId) === String(inspectionId) && (!fileType || item.fileType === fileType);
      });
    }

    function buildInspectionFileCard(file) {
      var thumb = file.isImage
        ? '<div class="file-thumb"><img src="' + escapeHtml(file.url) + '" alt="' + escapeHtml(file.originalName) + '"></div>'
        : '<div class="file-thumb"><div class="file-thumb-icon">📄</div></div>';

      var html = '<article class="file-card">' + thumb + '<div class="file-body">';
      html += '<div class="file-name">' + escapeHtml(file.originalName || 'Dosya') + '</div>';
      html += '<div class="file-tags"><span class="file-tag">' + escapeHtml(file.fileType === 'photo' ? 'Fotoğraf' : 'Evrak') + '</span></div>';
      html += '<div class="file-meta">Boyut: ' + escapeHtml(formatFileSize(file.fileSize)) + ' • Yüklenme: ' + escapeHtml(file.createdAt || '-') + '</div>';
      html += '<div class="file-actions"><a class="mini-btn primary" target="_blank" rel="noopener noreferrer" href="' + escapeHtml(file.url) + '">Aç</a><button class="mini-btn danger" type="button" onclick="deleteInspectionFile(' + file.id + ')">Sil</button></div>';
      html += '</div></article>';
      return html;
    }

    function renderInspectionFileGroup(inspectionId, fileType, emptyText) {
      var files = getInspectionFiles(inspectionId, fileType);
      return files.length
        ? '<div class="file-grid">' + files.map(buildInspectionFileCard).join('') + '</div>'
        : '<div class="empty-file-box">' + emptyText + '</div>';
    }

    function updateInspectionFileInputState(inspectionId) {
      var select = document.getElementById('inspectionFileType_' + inspectionId);
      var input = document.getElementById('inspectionFileInput_' + inspectionId);
      var help = document.getElementById('inspectionFileHelp_' + inspectionId);
      if (!select || !input || !help) return;
      var type = select.value;
      input.multiple = type === 'photo';
      help.textContent = type === 'photo'
        ? 'Fotoğrafta birden fazla seçim yapılabilir.'
        : 'Evrakta aynı anda tek dosya seçebilirsin.';
    }

    function setMessage(id, message, kind) {
      var el = document.getElementById(id);
      if (!el) return;
      el.textContent = message || '';
      el.className = 'form-message' + (kind ? ' ' + kind : '');
    }

    var toastTimer = null;
    function showToast(message) {
      var toast = document.getElementById('toast');
      if (!toast) return;
      toast.textContent = message;
      toast.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function() {
        toast.classList.remove('show');
      }, 2200);
    }

    function renderSummary() {
      if (!currentBusiness) return;
      document.getElementById('pageTitle').textContent = currentBusiness.tradeName || 'Firma Detayı';

      var summaryHtml = '' +
        '<div class="summary-grid">' +
          '<div class="info-item"><div class="info-label">Kategori</div><div class="info-value">' + escapeHtml(currentBusiness.categoryName || '-') + '</div></div>' +
          '<div class="info-item"><div class="info-label">İşyeri Ünvanı</div><div class="info-value">' + escapeHtml(currentBusiness.tradeName || '-') + '</div></div>' +
          '<div class="info-item"><div class="info-label">İşyeri Sahibi</div><div class="info-value">' + escapeHtml(currentBusiness.ownerName || '-') + '</div></div>' +
          '<div class="info-item"><div class="info-label">Telefon</div><div class="info-value">' + escapeHtml(currentBusiness.phone || 'Belirtilmedi') + '</div></div>' +
          '<div class="info-item"><div class="info-label">Adres</div><div class="info-value">' + escapeHtml(currentBusiness.addressText || 'Adres girilmedi') + '</div></div>' +
          '<div class="info-item"><div class="info-label">Ada / Parsel</div><div class="info-value">Ada: ' + escapeHtml(currentBusiness.ada || '-') + '<br>Parsel: ' + escapeHtml(currentBusiness.parcel || '-') + '</div></div>' +
          '<div class="info-item"><div class="info-label">Faaliyet Konusu</div><div class="info-value">' + escapeHtml(currentBusiness.activitySubject || 'Henüz girilmedi') + '</div></div>' +
          '<div class="info-item"><div class="info-label">Kayıt Tarihi</div><div class="info-value">' + escapeHtml(currentBusiness.createdAt || '-') + '</div></div>' +
          '<div class="info-item"><div class="info-label">Konum</div><div class="info-value">' + escapeHtml(currentBusiness.locationText || 'Konum eklenmedi') + '</div></div>' +
        '</div>';

      document.getElementById('summaryContainer').innerHTML = summaryHtml;

      var actions = '';
      if (currentBusiness.mapsUrl || currentBusiness.addressMapsUrl) {
        actions += '<a class="mini-btn primary" target="_blank" rel="noopener noreferrer" href="' + escapeHtml(currentBusiness.mapsUrl || currentBusiness.addressMapsUrl) + '">Haritada Aç</a>';
      }
      actions += '<a class="mini-btn primary" href="/licenses?businessId=' + currentBusiness.id + '">Ruhsat Modülünü Aç</a>';
      actions += '<a class="mini-btn" href="/businesses">Firma Listesine Dön</a>';
      document.getElementById('summaryActions').innerHTML = actions;
    }

    function renderLicense() {
      if (!currentBusiness) return;

      var left = '' +
        '<div class="summary-grid">' +
          '<div class="info-item"><div class="info-label">Ruhsat Durumu</div><div class="info-value">' + badgeForLicense(currentBusiness.licenseStatus) + '</div></div>' +
          '<div class="info-item"><div class="info-label">Ruhsat No</div><div class="info-value">' + escapeHtml(currentBusiness.licenseNo || 'Henüz girilmedi') + '</div></div>' +
          '<div class="info-item"><div class="info-label">Veriliş Tarihi</div><div class="info-value">' + escapeHtml(currentBusiness.licenseDateText || 'Henüz girilmedi') + '</div></div>' +
          '<div class="info-item"><div class="info-label">İşyeri Sınıfı / Türü</div><div class="info-value">' + escapeHtml(currentBusiness.businessClass || 'Henüz girilmedi') + '</div></div>' +
          '<div class="info-item"><div class="info-label">Faaliyet Konusu</div><div class="info-value">' + escapeHtml(currentBusiness.activitySubject || 'Henüz girilmedi') + '</div></div>' +
          '<div class="info-item"><div class="info-label">Firma Yetkilisi</div><div class="info-value">' + escapeHtml(currentBusiness.ownerName || '-') + '</div></div>' +
        '</div>';

      var right = '' +
        '<div class="license-note-box">' +
          '<div class="note-title">Ruhsat Açıklaması</div>' +
          '<div class="note-body">' + escapeHtml(currentBusiness.licenseNote || 'Henüz ruhsat açıklaması girilmedi.') + '</div>' +
          '<div class="note-title" style="margin-top:14px;">Adres Bilgisi</div>' +
          '<div class="note-body">' + escapeHtml(currentBusiness.addressText || 'Adres girilmedi.') + '</div>' +
        '</div>';

      document.getElementById('licenseContainer').innerHTML = '<div class="license-layout"><div>' + left + '</div><div>' + right + '</div></div>';
      document.getElementById('statLicenseStatus').textContent = currentBusiness.licenseStatus || 'Yok';
    }

    function renderLicenseSuggestions() {
      var container = document.getElementById('licenseSuggestionContainer');
      if (!container) return;
      if (!licenseSuggestions.length) {
        container.innerHTML = '<div class="empty-state">Bu firma için bekleyen ruhsat eşleşme adayı bulunmuyor.</div>';
        return;
      }

      var cards = '';
      for (var i = 0; i < licenseSuggestions.length; i++) {
        var item = licenseSuggestions[i];
        var titleParts = [];
        if (item.tradeName) titleParts.push(escapeHtml(item.tradeName));
        if (item.licenseSerialNo) titleParts.push('Ruhsat No: ' + escapeHtml(item.licenseSerialNo));
        var noteText = item.matchNote || 'Bu aday sistem tarafından önerildi. Bağlamadan önce adres ve ünvan bilgisini kontrol et.';
        cards += '' +
          '<article class="suggestion-card">' +
            '<div class="suggestion-head">' +
              '<div>' +
                '<h3 class="suggestion-title">' + (titleParts.length ? titleParts.join(' · ') : ('Aday Ruhsat #' + escapeHtml(item.id))) + '</h3>' +
                '<div class="suggestion-sub">Önerilen eşleşme puanı: <strong>' + escapeHtml(item.matchScore || 0) + '</strong></div>' +
              '</div>' +
              '<div class="inspection-badges">' + badgeForRecordStatus(item.recordStatus) + badgeForLicense(item.processStatus === 'Ruhsat Verildi' && item.recordStatus === 'Aktif' ? 'Var' : (item.processStatus !== 'Ruhsat Verildi' ? 'Başvuru Aşamasında' : 'Yok')) + '</div>' +
            '</div>' +
            '<div class="suggestion-body">' +
              '<div class="suggestion-grid">' +
                '<div class="info-item"><div class="info-label">İşyeri Ünvanı</div><div class="info-value">' + escapeHtml(item.tradeName || '-') + '</div></div>' +
                '<div class="info-item"><div class="info-label">İşyeri Sahibi</div><div class="info-value">' + escapeHtml(item.ownerName || '-') + '</div></div>' +
                '<div class="info-item"><div class="info-label">Veriliş Tarihi</div><div class="info-value">' + escapeHtml(item.issueDateText || 'Belirtilmedi') + '</div></div>' +
                '<div class="info-item"><div class="info-label">Adres</div><div class="info-value">' + escapeHtml(item.addressText || 'Adres girilmedi') + '</div></div>' +
                '<div class="info-item"><div class="info-label">Süreç Durumu</div><div class="info-value">' + escapeHtml(item.processStatus || '-') + '</div></div>' +
                '<div class="info-item"><div class="info-label">Başvuru / Not</div><div class="info-value">' + escapeHtml(item.applicationStage || item.applicationNo || 'Süreç bilgisi yok') + '</div></div>' +
              '</div>' +
              '<div class="suggestion-note"><div class="note-title">Eşleşme Notu</div><div class="note-body">' + escapeHtml(noteText) + '</div></div>' +
              '<div class="suggestion-actions">' +
                '<button class="mini-btn primary" type="button" onclick="approveLicenseSuggestion(' + item.id + ')">Ruhsatı Bağla</button>' +
                '<button class="mini-btn" type="button" onclick="clearLicenseSuggestion(' + item.id + ')">Uygun Değil</button>' +
                '<a class="mini-btn" href="/licenses?businessId=' + businessId + '">Ruhsat Modülünü Aç</a>' +
              '</div>' +
            '</div>' +
          '</article>';
      }

      container.innerHTML = '<div class="suggestion-list">' + cards + '</div>';
    }

    function renderStats() {
      document.getElementById('statInspectionCount').textContent = inspections.length;
      document.getElementById('statLastInspection').textContent = inspections.length ? (inspections[0].inspectionDateText || '-') : '-';
    }

    function renderInspections() {
      renderStats();
      var container = document.getElementById('inspectionContainer');
      if (!inspections.length) {
        container.innerHTML = '<div class="empty-state">Bu firmaya ait henüz denetim kaydı bulunmuyor.</div>';
        return;
      }

      var summary = getInspectionSummary();
      var summaryHtml = '' +
        '<div class="inspection-summary-bar">' +
          '<div class="inspection-mini-stat"><div class="inspection-mini-label">Toplam Kayıt</div><div class="inspection-mini-value">' + summary.total + '</div><div class="inspection-mini-sub">Firmaya ait toplam denetim adedi</div></div>' +
          '<div class="inspection-mini-stat"><div class="inspection-mini-label">Açık Denetim</div><div class="inspection-mini-value">' + summary.acik + '</div><div class="inspection-mini-sub">Takibi devam eden açık kayıtlar</div></div>' +
          '<div class="inspection-mini-stat"><div class="inspection-mini-label">Süre Verilen</div><div class="inspection-mini-value">' + summary.sureVerildi + '</div><div class="inspection-mini-sub">Kontrol tarihi beklenen kayıtlar</div></div>' +
          '<div class="inspection-mini-stat"><div class="inspection-mini-label">Geciken Kontrol</div><div class="inspection-mini-value">' + summary.geciken + '</div><div class="inspection-mini-sub">Kontrol tarihi geçen denetimler</div></div>' +
        '</div>';

      var cards = '';
      for (var i = 0; i < inspections.length; i++) {
        var item = inspections[i];
        var photoCount = getInspectionFiles(item.id, 'photo').length;
        var documentCount = getInspectionFiles(item.id, 'document').length;
        cards += '' +
          '<article class="inspection-card">' +
            '<div class="inspection-card-head">' +
              '<div class="inspection-card-date">' +
                '<div class="inspection-card-kicker">Denetim Kaydı</div>' +
                '<div class="inspection-card-title">' + escapeHtml(item.inspectionDateText || '-') + '</div>' +
                '<div class="muted">' + escapeHtml(item.inspectionType || 'Denetim türü belirtilmedi') + '</div>' +
              '</div>' +
              '<div class="inspection-badges">' + badgeForInspectionResult(item.resultStatus) + badgeForInspectionStatus(item.currentStatus) + '</div>' +
            '</div>' +
            '<div class="inspection-card-body">' +
              '<div class="inspection-grid">' +
                inspectionField('Yapılan İşlem', escapeHtml(item.actionTaken || 'Henüz işlem girilmedi')) +
                inspectionField('Kontrol Tarihi', escapeHtml(item.controlDateText || 'Planlanmadı')) +
                inspectionField('Kayıt Zamanı', escapeHtml(item.createdAt || '-')) +
                inspectionField('Sonuç Özeti', escapeHtml(item.resultStatus || 'Sonuç girilmedi')) +
              '</div>' +
              (item.note ? '<div class="inspection-note-box"><div class="inspection-note-title">Denetim Notu</div><div class="inspection-note-body">' + escapeHtml(item.note) + '</div></div>' : '') +
              '<div class="inspection-attachments">' +
                '<div class="inspection-attachments-head">' +
                  '<div class="inspection-note-title" style="margin-bottom:0;">Fotoğraf / Evrak</div>' +
                  '<div class="inspection-footer-meta">' + photoCount + ' fotoğraf • ' + documentCount + ' evrak</div>' +
                '</div>' +
                '<div class="inspection-upload-row">' +
                  '<select id="inspectionFileType_' + item.id + '" onchange="updateInspectionFileInputState(' + item.id + ')"><option value="photo">Fotoğraf</option><option value="document">Evrak</option></select>' +
                  '<div><input type="file" id="inspectionFileInput_' + item.id + '" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.webp" multiple /><div class="upload-help" id="inspectionFileHelp_' + item.id + '">Fotoğrafta birden fazla seçim yapılabilir.</div></div>' +
                  '<button class="mini-btn primary" type="button" onclick="uploadInspectionFiles(' + item.id + ')">Yükle</button>' +
                '</div>' +
                '<div id="inspectionFileMessage_' + item.id + '" class="form-message"></div>' +
                '<div class="inspection-file-columns">' +
                  '<div class="inspection-file-column"><div class="inspection-file-group-title">Fotoğraflar</div>' + renderInspectionFileGroup(item.id, 'photo', 'Bu denetime ait fotoğraf yüklenmedi.') + '</div>' +
                  '<div class="inspection-file-column"><div class="inspection-file-group-title">Evraklar</div>' + renderInspectionFileGroup(item.id, 'document', 'Bu denetime ait evrak yüklenmedi.') + '</div>' +
                '</div>' +
              '</div>' +
              '<div class="inspection-card-footer">' +
                '<div class="inspection-footer-meta">Kayıt No: #' + escapeHtml(String(item.id)) + '</div>' +
                '<div class="action-row"><button class="mini-btn primary" type="button" onclick="openInspectionEditor(' + item.id + ')">Düzenle</button><button class="mini-btn danger" type="button" onclick="deleteInspectionRecord(' + item.id + ')">Sil</button></div>' +
              '</div>' +
            '</div>' +
          '</article>';
      }

      container.innerHTML = '<div class="inspection-shell">' + summaryHtml + '<div class="inspection-list">' + cards + '</div></div>';
      for (var j = 0; j < inspections.length; j++) {
        updateInspectionFileInputState(inspections[j].id);
      }
    }


    function resetInspectionForm() {
      document.getElementById('editingInspectionId').value = '';
      document.getElementById('inspectionDate').value = new Date().toISOString().slice(0, 10);
      document.getElementById('inspectionType').value = '';
      document.getElementById('inspectionResultStatus').value = '';
      document.getElementById('inspectionCurrentStatus').value = '';
      document.getElementById('inspectionActionTaken').value = '';
      document.getElementById('inspectionControlDate').value = '';
      document.getElementById('inspectionNote').value = '';
      toggleInspectionControlDate();
      setMessage('inspectionMessage', '', '');
    }

    function toggleInspectionControlDate() {
      var group = document.getElementById('inspectionControlDateGroup');
      var status = document.getElementById('inspectionCurrentStatus').value;
      group.style.display = status === 'Süre Verildi' ? 'grid' : 'none';
      if (status !== 'Süre Verildi') {
        document.getElementById('inspectionControlDate').value = '';
      }
    }

    function setActiveSection(sectionName) {
      activeEditor = sectionName;
      document.getElementById('inspectionSection').classList.toggle('active', sectionName === 'inspection');
      document.getElementById('inspectionSubmitBtn').style.display = sectionName === 'inspection' ? 'inline-flex' : 'none';
      var editing = !!document.getElementById('editingInspectionId').value;
      document.getElementById('drawerTitle').textContent = editing ? 'Denetim Kaydı Düzenle' : 'Yeni Denetim Ekle';
      document.getElementById('drawerSubtitle').textContent = editing ? 'Seçilen denetim kaydını düzenliyorsun.' : 'Firmaya yeni denetim kaydı ekliyorsun.';
    }

    function openDrawer(sectionName) {
      setActiveSection(sectionName);
      document.getElementById('editorOverlay').classList.add('show');
      document.body.classList.add('drawer-open');
    }

    function closeDrawer() {
      document.getElementById('editorOverlay').classList.remove('show');
      document.body.classList.remove('drawer-open');
      setMessage('inspectionMessage', '', '');
    }


    function openInspectionEditor(id) {
      resetInspectionForm();
      if (id) {
        for (var i = 0; i < inspections.length; i++) {
          if (String(inspections[i].id) === String(id)) {
            document.getElementById('editingInspectionId').value = id;
            document.getElementById('inspectionDate').value = inspections[i].inspectionDate || '';
            document.getElementById('inspectionType').value = inspections[i].inspectionType || '';
            document.getElementById('inspectionResultStatus').value = inspections[i].resultStatus || '';
            document.getElementById('inspectionCurrentStatus').value = inspections[i].currentStatus || '';
            document.getElementById('inspectionActionTaken').value = inspections[i].actionTaken || '';
            document.getElementById('inspectionControlDate').value = inspections[i].controlDate || '';
            document.getElementById('inspectionNote').value = inspections[i].note || '';
            break;
          }
        }
      }
      toggleInspectionControlDate();
      openDrawer('inspection');
    }

    function setSaving(buttonId, saving) {
      var button = document.getElementById(buttonId);
      if (!button) return;
      button.disabled = !!saving;
      button.textContent = saving ? 'Kaydediliyor...' : 'Kaydet';
    }


    async function handleInspectionSubmit(event) {
      event.preventDefault();
      setMessage('inspectionMessage', '', '');
      if (!document.getElementById('inspectionDate').value) {
        setMessage('inspectionMessage', 'Denetim tarihi zorunludur.', 'error');
        return;
      }
      setSaving('inspectionSubmitBtn', true);
      try {
        var editingInspectionId = document.getElementById('editingInspectionId').value;
        var payload = {
          inspectionDate: document.getElementById('inspectionDate').value,
          inspectionType: document.getElementById('inspectionType').value.trim(),
          resultStatus: document.getElementById('inspectionResultStatus').value,
          actionTaken: document.getElementById('inspectionActionTaken').value.trim(),
          currentStatus: document.getElementById('inspectionCurrentStatus').value,
          controlDate: document.getElementById('inspectionControlDate').value,
          note: document.getElementById('inspectionNote').value.trim()
        };
        var url = '/api/businesses/' + businessId + '/inspections' + (editingInspectionId ? '/' + editingInspectionId : '');
        var method = editingInspectionId ? 'PUT' : 'POST';
        var response = await fetch(url, {
          method: method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        var data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Denetim kaydı kaydedilemedi.');
        await loadInspections();
        closeDrawer();
        showToast(editingInspectionId ? 'Denetim kaydı güncellendi.' : 'Yeni denetim kaydı eklendi.');
      } catch (error) {
        setMessage('inspectionMessage', error.message || 'Denetim kaydı kaydedilemedi.', 'error');
      } finally {
        setSaving('inspectionSubmitBtn', false);
      }
    }

    async function deleteInspectionRecord(id) {
      if (!confirm('Bu denetim kaydı ve buna bağlı fotoğraf/evraklar silinsin mi?')) return;
      try {
        var response = await fetch('/api/businesses/' + businessId + '/inspections/' + id, { method: 'DELETE' });
        var data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Denetim kaydı silinemedi.');
        await loadInspections();
        showToast('Denetim kaydı silindi.');
      } catch (error) {
        alert(error.message || 'Denetim kaydı silinemedi.');
      }
    }

    async function loadBusiness() {
      var response = await fetch('/api/businesses/' + businessId);
      var data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Firma bilgileri yüklenemedi.');
      }
      currentBusiness = data;
      renderSummary();
      renderLicense();
    }

    async function loadLicenseSuggestions() {
      var response = await fetch('/api/businesses/' + businessId + '/license-suggestions');
      var data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Ruhsat eşleşme adayları yüklenemedi.');
      }
      licenseSuggestions = Array.isArray(data) ? data : [];
      renderLicenseSuggestions();
    }

    async function approveLicenseSuggestion(id) {
      if (!confirm('Bu ruhsat bu firmaya bağlansın mı?')) return;
      try {
        var response = await fetch('/api/licenses/' + id + '/approve-match', { method: 'POST' });
        var data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Eşleşme onaylanamadı.');
        await loadBusiness();
        await loadLicenseSuggestions();
        showToast('Ruhsat firmaya bağlandı.');
      } catch (error) {
        alert(error.message || 'Eşleşme onaylanamadı.');
      }
    }

    async function clearLicenseSuggestion(id) {
      if (!confirm('Bu eşleşme adayı temizlensin mi?')) return;
      try {
        var response = await fetch('/api/licenses/' + id + '/clear-match', { method: 'POST' });
        var data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Eşleşme adayı temizlenemedi.');
        await loadLicenseSuggestions();
        showToast('Eşleşme adayı temizlendi.');
      } catch (error) {
        alert(error.message || 'Eşleşme adayı temizlenemedi.');
      }
    }

    async function loadInspections() {
      var response = await fetch('/api/businesses/' + businessId + '/inspections');
      var data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Denetim geçmişi yüklenemedi.');
      }
      inspections = data;
      renderInspections();
    }

    async function loadInspectionFiles() {
      var response = await fetch('/api/businesses/' + businessId + '/inspection-files');
      var data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Denetim dosyaları yüklenemedi.');
      }
      inspectionFiles = data;
      renderInspections();
    }

    async function uploadInspectionFiles(inspectionId) {
      setMessage('inspectionFileMessage_' + inspectionId, '', '');
      var fileInput = document.getElementById('inspectionFileInput_' + inspectionId);
      var typeSelect = document.getElementById('inspectionFileType_' + inspectionId);
      if (!fileInput || !fileInput.files || !fileInput.files.length) {
        setMessage('inspectionFileMessage_' + inspectionId, 'Lütfen en az bir dosya seçin.', 'error');
        return;
      }

      var uploadButton = null;
      if (typeof event !== 'undefined' && event && event.currentTarget) {
        uploadButton = event.currentTarget;
        uploadButton.disabled = true;
        uploadButton.textContent = 'Yükleniyor...';
      }

      try {
        var formData = new FormData();
        formData.append('fileType', typeSelect.value);
        for (var i = 0; i < fileInput.files.length; i++) {
          formData.append('files', fileInput.files[i]);
        }

        var response = await fetch('/api/business-inspections/' + inspectionId + '/files', {
          method: 'POST',
          body: formData
        });
        var data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Denetim dosyası yüklenemedi.');

        fileInput.value = '';
        await loadInspectionFiles();
        setMessage('inspectionFileMessage_' + inspectionId, 'Dosya yükleme tamamlandı.', 'success');
        showToast('Dosya yüklendi.');
      } catch (error) {
        setMessage('inspectionFileMessage_' + inspectionId, error.message || 'Dosya yüklenemedi.', 'error');
      } finally {
        if (uploadButton) {
          uploadButton.disabled = false;
          uploadButton.textContent = 'Yükle';
        }
      }
    }

    async function deleteInspectionFile(fileId) {
      if (!confirm('Bu dosya silinsin mi?')) return;
      try {
        var response = await fetch('/api/business-inspection-files/' + fileId, { method: 'DELETE' });
        var data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Dosya silinemedi.');
        await loadInspectionFiles();
        showToast('Dosya silindi.');
      } catch (error) {
        alert(error.message || 'Dosya silinemedi.');
      }
    }

    function toggleSidebar(forceOpen) {
      var shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : !document.body.classList.contains('sidebar-open');
      document.body.classList.toggle('sidebar-open', shouldOpen);
    }

    function bindDetailPageActions() {
      document.getElementById('openInspectionBtnTop').addEventListener('click', function() { openInspectionEditor(); });
      document.getElementById('openInspectionBtnSection').addEventListener('click', function() { openInspectionEditor(); });
      document.getElementById('closeDrawerBtn').addEventListener('click', closeDrawer);
      document.getElementById('cancelDrawerBtn').addEventListener('click', closeDrawer);
      document.getElementById('editorOverlay').addEventListener('click', function(event) {
        if (event.target === document.getElementById('editorOverlay')) {
          closeDrawer();
        }
      });
      document.getElementById('inspectionCurrentStatus').addEventListener('change', toggleInspectionControlDate);
      document.getElementById('inspectionForm').addEventListener('submit', handleInspectionSubmit);
      document.addEventListener('keydown', function(event) {
        if (event.key !== 'Escape') return;
        var overlay = document.getElementById('editorOverlay');
        if (overlay && overlay.classList.contains('show')) { closeDrawer(); return; }
        if (document.body.classList.contains('sidebar-open')) toggleSidebar(false);
      });
      window.openInspectionEditor = openInspectionEditor;
      window.deleteInspectionRecord = deleteInspectionRecord;
      window.uploadInspectionFiles = uploadInspectionFiles;
      window.deleteInspectionFile = deleteInspectionFile;
      window.updateInspectionFileInputState = updateInspectionFileInputState;
      window.approveLicenseSuggestion = approveLicenseSuggestion;
      window.clearLicenseSuggestion = clearLicenseSuggestion;
    }

    async function initPage() {
      try {
        await loadBusiness();
      } catch (error) {
        document.getElementById('summaryContainer').innerHTML = '<div class="empty-state">' + escapeHtml(error.message || 'Firma bilgileri yüklenemedi.') + '</div>';
        document.getElementById('licenseContainer').innerHTML = '<div class="empty-state">Firma detayı alınamadı.</div>';
        document.getElementById('licenseSuggestionContainer').innerHTML = '<div class="empty-state">Ruhsat eşleşme adayları alınamadı.</div>';
        document.getElementById('inspectionContainer').innerHTML = '<div class="empty-state">Denetim geçmişi alınamadı.</div>';
        return;
      }

      try {
        await loadLicenseSuggestions();
      } catch (error) {
        document.getElementById('licenseSuggestionContainer').innerHTML = '<div class="empty-state">' + escapeHtml(error.message || 'Ruhsat eşleşme adayları alınamadı.') + '</div>';
      }

      try {
        await loadInspections();
      } catch (error) {
        document.getElementById('inspectionContainer').innerHTML = '<div class="empty-state">' + escapeHtml(error.message || 'Denetim geçmişi alınamadı.') + '</div>';
        return;
      }

      try {
        await loadInspectionFiles();
      } catch (error) {
        inspectionFiles = [];
        renderInspections();
        showToast('Denetim dosyaları yüklenemedi. Şimdilik sadece denetim kayıtları gösteriliyor.');
      }
    }

    bindDetailPageActions();
    initPage();
  </script>
</body>
</html>`);
});


app.get('/api/licenses/export.xlsx', async (req, res) => {
  try {
    const normalizedFilters = normalizeLicenseExportFilters(req.query);
    const result = await pool.query(`
      SELECT
        l.*,
        b.trade_name AS business_trade_name,
        bc.name AS category_name,
        sb.trade_name AS suggested_business_trade_name,
        sbc.name AS suggested_category_name
      FROM licenses l
      LEFT JOIN businesses b ON b.id = l.business_id
      LEFT JOIN business_categories bc ON bc.id = b.category_id
      LEFT JOIN businesses sb ON sb.id = l.suggested_business_id
      LEFT JOIN business_categories sbc ON sbc.id = sb.category_id
      ORDER BY COALESCE(l.issue_date, l.application_date, l.updated_at, l.created_at) DESC, l.id DESC
    `);

    const rows = filterLicenseRows(result.rows.map(mapLicense), normalizedFilters);
    const filters = await enrichLicenseExportFilters(normalizedFilters);
    const workbook = createLicenseWorkbook(rows, filters);
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    const fileName = buildLicenseExportFileName(filters);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="' + fileName + '"');
    res.send(buffer);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ruhsat Excel çıktısı oluşturulamadı.' });
  }
});

app.get('/api/licenses', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        l.*,
        b.trade_name AS business_trade_name,
        bc.name AS category_name,
        sb.trade_name AS suggested_business_trade_name,
        sbc.name AS suggested_category_name
      FROM licenses l
      LEFT JOIN businesses b ON b.id = l.business_id
      LEFT JOIN business_categories bc ON bc.id = b.category_id
      LEFT JOIN businesses sb ON sb.id = l.suggested_business_id
      LEFT JOIN business_categories sbc ON sbc.id = sb.category_id
      ORDER BY COALESCE(l.issue_date, l.application_date, l.updated_at, l.created_at) DESC, l.id DESC
    `);
    res.json(result.rows.map(mapLicense));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ruhsat kayıtları alınamadı.' });
  }
});

app.get('/api/businesses/:id/licenses', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`
      SELECT
        l.*,
        b.trade_name AS business_trade_name,
        bc.name AS category_name,
        sb.trade_name AS suggested_business_trade_name,
        sbc.name AS suggested_category_name
      FROM licenses l
      LEFT JOIN businesses b ON b.id = l.business_id
      LEFT JOIN business_categories bc ON bc.id = b.category_id
      LEFT JOIN businesses sb ON sb.id = l.suggested_business_id
      LEFT JOIN business_categories sbc ON sbc.id = sb.category_id
      WHERE l.business_id = $1
      ORDER BY COALESCE(l.issue_date, l.application_date, l.updated_at, l.created_at) DESC, l.id DESC
    `, [id]);
    res.json(result.rows.map(mapLicense));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Firma ruhsat kayıtları alınamadı.' });
  }
});

app.get('/api/businesses/:id/license-suggestions', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`
      SELECT
        l.*,
        b.trade_name AS business_trade_name,
        bc.name AS category_name,
        sb.trade_name AS suggested_business_trade_name,
        sbc.name AS suggested_category_name
      FROM licenses l
      LEFT JOIN businesses b ON b.id = l.business_id
      LEFT JOIN business_categories bc ON bc.id = b.category_id
      LEFT JOIN businesses sb ON sb.id = l.suggested_business_id
      LEFT JOIN business_categories sbc ON sbc.id = sb.category_id
      WHERE l.business_id IS NULL
        AND l.suggested_business_id = $1
      ORDER BY COALESCE(l.issue_date, l.application_date, l.updated_at, l.created_at) DESC, l.id DESC
    `, [id]);
    res.json(result.rows.map(mapLicense));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Firma ruhsat eşleşme adayları alınamadı.' });
  }
});

app.get('/api/licenses/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`
      SELECT
        l.*,
        b.trade_name AS business_trade_name,
        bc.name AS category_name,
        sb.trade_name AS suggested_business_trade_name,
        sbc.name AS suggested_category_name
      FROM licenses l
      LEFT JOIN businesses b ON b.id = l.business_id
      LEFT JOIN business_categories bc ON bc.id = b.category_id
      LEFT JOIN businesses sb ON sb.id = l.suggested_business_id
      LEFT JOIN business_categories sbc ON sbc.id = sb.category_id
      WHERE l.id = $1
      LIMIT 1
    `, [id]);

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Ruhsat kaydı bulunamadı.' });
    }

    res.json(mapLicense(result.rows[0]));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ruhsat kaydı alınamadı.' });
  }
});

app.post('/api/licenses', async (req, res) => {
  try {
    const {
      businessId, issueDate, licenseSerialNo, ownerName, tradeName, activitySubject, neighborhood, street, doorNo, ada, parcel, usageArea, otherUsageArea, totalMotorPower, workplaceClass, winterOpeningTime, winterClosingTime, summerOpeningTime, summerClosingTime, otherActivityAreas, identityNumber, taxNumber, policeChiefName, mayorName, recordStatus, processStatus, applicationDate, applicationNo, applicationStage, followupDate, cancelDate, cancelReason, notes
    } = req.body;

    const resolvedBusinessId = await resolveBusinessIdForLicensePayload(req.body || {}, businessId);

    const insertResult = await pool.query(`
      INSERT INTO licenses (
        business_id, issue_date, license_serial_no, owner_name, trade_name, activity_subject, neighborhood, street, door_no, ada, parcel, usage_area, other_usage_area, total_motor_power, workplace_class, winter_opening_time, winter_closing_time, summer_opening_time, summer_closing_time, other_activity_areas, identity_number, tax_number, police_chief_name, mayor_name, record_status, process_status, application_date, application_no, application_stage, followup_date, cancel_date, cancel_reason, notes, match_status, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, CURRENT_TIMESTAMP
      ) RETURNING *
    `, [
      resolvedBusinessId,
      issueDate || null,
      licenseSerialNo ? String(licenseSerialNo).trim() : '',
      ownerName ? String(ownerName).trim() : '',
      tradeName ? String(tradeName).trim() : '',
      activitySubject ? String(activitySubject).trim() : '',
      neighborhood ? String(neighborhood).trim() : '',
      street ? String(street).trim() : '',
      doorNo ? String(doorNo).trim() : '',
      ada ? String(ada).trim() : '',
      parcel ? String(parcel).trim() : '',
      usageArea ? String(usageArea).trim() : '',
      otherUsageArea ? String(otherUsageArea).trim() : '',
      totalMotorPower ? String(totalMotorPower).trim() : '',
      workplaceClass ? String(workplaceClass).trim() : '',
      winterOpeningTime ? String(winterOpeningTime).trim() : '',
      winterClosingTime ? String(winterClosingTime).trim() : '',
      summerOpeningTime ? String(summerOpeningTime).trim() : '',
      summerClosingTime ? String(summerClosingTime).trim() : '',
      otherActivityAreas ? String(otherActivityAreas).trim() : '',
      identityNumber ? String(identityNumber).trim() : '',
      taxNumber ? String(taxNumber).trim() : '',
      policeChiefName ? String(policeChiefName).trim() : '',
      mayorName ? String(mayorName).trim() : '',
      recordStatus ? String(recordStatus).trim() : 'Aktif',
      processStatus ? String(processStatus).trim() : 'Ruhsat Verildi',
      applicationDate || null,
      applicationNo ? String(applicationNo).trim() : '',
      applicationStage ? String(applicationStage).trim() : '',
      followupDate || null,
      cancelDate || null,
      cancelReason ? String(cancelReason).trim() : '',
      notes ? String(notes).trim() : '',
      resolvedBusinessId ? 'Bağlandı' : 'Bağlantı Yok'
    ]);

    if (resolvedBusinessId) {
      await updateBusinessLicenseSnapshot(resolvedBusinessId);
    } else {
      await updateLicenseMatchSuggestion(insertResult.rows[0].id);
    }

    const rowResult = await pool.query(`
      SELECT
        l.*, b.trade_name AS business_trade_name, bc.name AS category_name,
        sb.trade_name AS suggested_business_trade_name, sbc.name AS suggested_category_name
      FROM licenses l
      LEFT JOIN businesses b ON b.id = l.business_id
      LEFT JOIN business_categories bc ON bc.id = b.category_id
      LEFT JOIN businesses sb ON sb.id = l.suggested_business_id
      LEFT JOIN business_categories sbc ON sbc.id = sb.category_id
      WHERE l.id = $1
    `, [insertResult.rows[0].id]);

    res.json(mapLicense(rowResult.rows[0]));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ruhsat kaydı eklenemedi.' });
  }
});

app.put('/api/licenses/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      businessId, issueDate, licenseSerialNo, ownerName, tradeName, activitySubject, neighborhood, street, doorNo, ada, parcel, usageArea, otherUsageArea, totalMotorPower, workplaceClass, winterOpeningTime, winterClosingTime, summerOpeningTime, summerClosingTime, otherActivityAreas, identityNumber, taxNumber, policeChiefName, mayorName, recordStatus, processStatus, applicationDate, applicationNo, applicationStage, followupDate, cancelDate, cancelReason, notes
    } = req.body;

    const existing = await pool.query('SELECT id, business_id FROM licenses WHERE id = $1', [id]);
    if (!existing.rows.length) {
      return res.status(404).json({ error: 'Ruhsat kaydı bulunamadı.' });
    }

    const oldBusinessId = existing.rows[0].business_id;
    const explicitBusinessId = Object.prototype.hasOwnProperty.call(req.body || {}, 'businessId') ? businessId : oldBusinessId;
    const resolvedBusinessId = await resolveBusinessIdForLicensePayload(req.body || {}, explicitBusinessId);

    await pool.query(`
      UPDATE licenses
      SET
        business_id = $1,
        issue_date = $2,
        license_serial_no = $3,
        owner_name = $4,
        trade_name = $5,
        activity_subject = $6,
        neighborhood = $7,
        street = $8,
        door_no = $9,
        ada = $10,
        parcel = $11,
        usage_area = $12,
        other_usage_area = $13,
        total_motor_power = $14,
        workplace_class = $15,
        winter_opening_time = $16,
        winter_closing_time = $17,
        summer_opening_time = $18,
        summer_closing_time = $19,
        other_activity_areas = $20,
        identity_number = $21,
        tax_number = $22,
        police_chief_name = $23,
        mayor_name = $24,
        record_status = $25,
        process_status = $26,
        application_date = $27,
        application_no = $28,
        application_stage = $29,
        followup_date = $30,
        cancel_date = $31,
        cancel_reason = $32,
        notes = $33,
        match_status = $34,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $35
    `, [
      resolvedBusinessId,
      issueDate || null,
      licenseSerialNo ? String(licenseSerialNo).trim() : '',
      ownerName ? String(ownerName).trim() : '',
      tradeName ? String(tradeName).trim() : '',
      activitySubject ? String(activitySubject).trim() : '',
      neighborhood ? String(neighborhood).trim() : '',
      street ? String(street).trim() : '',
      doorNo ? String(doorNo).trim() : '',
      ada ? String(ada).trim() : '',
      parcel ? String(parcel).trim() : '',
      usageArea ? String(usageArea).trim() : '',
      otherUsageArea ? String(otherUsageArea).trim() : '',
      totalMotorPower ? String(totalMotorPower).trim() : '',
      workplaceClass ? String(workplaceClass).trim() : '',
      winterOpeningTime ? String(winterOpeningTime).trim() : '',
      winterClosingTime ? String(winterClosingTime).trim() : '',
      summerOpeningTime ? String(summerOpeningTime).trim() : '',
      summerClosingTime ? String(summerClosingTime).trim() : '',
      otherActivityAreas ? String(otherActivityAreas).trim() : '',
      identityNumber ? String(identityNumber).trim() : '',
      taxNumber ? String(taxNumber).trim() : '',
      policeChiefName ? String(policeChiefName).trim() : '',
      mayorName ? String(mayorName).trim() : '',
      recordStatus ? String(recordStatus).trim() : 'Aktif',
      processStatus ? String(processStatus).trim() : 'Ruhsat Verildi',
      applicationDate || null,
      applicationNo ? String(applicationNo).trim() : '',
      applicationStage ? String(applicationStage).trim() : '',
      followupDate || null,
      cancelDate || null,
      cancelReason ? String(cancelReason).trim() : '',
      notes ? String(notes).trim() : '',
      resolvedBusinessId ? 'Bağlandı' : 'Bağlantı Yok',
      id
    ]);

    if (oldBusinessId && String(oldBusinessId) !== String(resolvedBusinessId || '')) {
      await updateBusinessLicenseSnapshot(oldBusinessId);
    }
    if (resolvedBusinessId) {
      await updateBusinessLicenseSnapshot(resolvedBusinessId);
    } else {
      await updateLicenseMatchSuggestion(id);
    }

    const rowResult = await pool.query(`
      SELECT
        l.*, b.trade_name AS business_trade_name, bc.name AS category_name,
        sb.trade_name AS suggested_business_trade_name, sbc.name AS suggested_category_name
      FROM licenses l
      LEFT JOIN businesses b ON b.id = l.business_id
      LEFT JOIN business_categories bc ON bc.id = b.category_id
      LEFT JOIN businesses sb ON sb.id = l.suggested_business_id
      LEFT JOIN business_categories sbc ON sbc.id = sb.category_id
      WHERE l.id = $1
    `, [id]);

    res.json(mapLicense(rowResult.rows[0]));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ruhsat kaydı güncellenemedi.' });
  }
});


app.post('/api/licenses/:id/create-business', async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    await client.query('BEGIN');

    const licenseResult = await client.query('SELECT * FROM licenses WHERE id = $1 LIMIT 1 FOR UPDATE', [id]);
    if (!licenseResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Ruhsat kaydı bulunamadı.' });
    }

    const licenseRow = licenseResult.rows[0];
    const creationSuggestion = buildLicenseBusinessCreationSuggestion(licenseRow);

    if (licenseRow.business_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Bu ruhsat zaten bir firmaya bağlı.' });
    }

    if (licenseRow.suggested_business_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Bu ruhsat için mevcut firma eşleşme adayı var. Önce onu değerlendir.' });
    }

    if (!creationSuggestion.eligible) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: creationSuggestion.note || 'Bu ruhsattan firma önerisi oluşturulamıyor.' });
    }

    const businessInsert = await client.query(`
      INSERT INTO businesses (
        category_id,
        trade_name,
        owner_name,
        phone,
        neighborhood,
        street,
        door_no,
        ada,
        parcel,
        location_lat,
        location_lng
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `, [
      null,
      licenseRow.trade_name ? String(licenseRow.trade_name).trim() : '',
      licenseRow.owner_name ? String(licenseRow.owner_name).trim() : '',
      '',
      licenseRow.neighborhood ? String(licenseRow.neighborhood).trim() : '',
      licenseRow.street ? String(licenseRow.street).trim() : '',
      licenseRow.door_no ? String(licenseRow.door_no).trim() : '',
      licenseRow.ada ? String(licenseRow.ada).trim() : '',
      licenseRow.parcel ? String(licenseRow.parcel).trim() : '',
      null,
      null
    ]);

    const newBusinessId = businessInsert.rows[0].id;

    await client.query(`
      UPDATE licenses
      SET
        business_id = $1,
        suggested_business_id = NULL,
        match_score = 0,
        match_note = 'Ruhsattan manuel onayla firma kaydı oluşturuldu.',
        match_status = 'Bağlandı',
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
    `, [newBusinessId, id]);

    await client.query('COMMIT');

    await updateBusinessLicenseSnapshot(newBusinessId);
    await refreshAllLicenseSuggestions();

    const businessResult = await pool.query(`
      SELECT
        b.*, bc.name AS category_name
      FROM businesses b
      LEFT JOIN business_categories bc ON bc.id = b.category_id
      WHERE b.id = $1
      LIMIT 1
    `, [newBusinessId]);

    res.json({
      business: mapBusiness(businessResult.rows[0]),
      licenseId: Number(id)
    });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (rollbackError) {}
    console.error(error);
    res.status(500).json({ error: 'Ruhsattan firma kaydı oluşturulamadı.' });
  } finally {
    client.release();
  }
});

app.post('/api/licenses/:id/approve-match', async (req, res) => {
  try {
    const { id } = req.params;
    const licenseResult = await pool.query('SELECT id, business_id, suggested_business_id FROM licenses WHERE id = $1 LIMIT 1', [id]);
    if (!licenseResult.rows.length) {
      return res.status(404).json({ error: 'Ruhsat kaydı bulunamadı.' });
    }

    const row = licenseResult.rows[0];
    if (!row.suggested_business_id) {
      return res.status(400).json({ error: 'Onaylanacak bir eşleşme adayı bulunamadı.' });
    }

    if (row.business_id && String(row.business_id) !== String(row.suggested_business_id)) {
      await updateBusinessLicenseSnapshot(row.business_id);
    }

    await pool.query(`
      UPDATE licenses
      SET
        business_id = suggested_business_id,
        suggested_business_id = NULL,
        match_score = 0,
        match_note = '',
        match_status = 'Bağlandı',
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `, [id]);

    await updateBusinessLicenseSnapshot(row.suggested_business_id);

    const result = await pool.query(`
      SELECT
        l.*, b.trade_name AS business_trade_name, bc.name AS category_name,
        sb.trade_name AS suggested_business_trade_name, sbc.name AS suggested_category_name
      FROM licenses l
      LEFT JOIN businesses b ON b.id = l.business_id
      LEFT JOIN business_categories bc ON bc.id = b.category_id
      LEFT JOIN businesses sb ON sb.id = l.suggested_business_id
      LEFT JOIN business_categories sbc ON sbc.id = sb.category_id
      WHERE l.id = $1
      LIMIT 1
    `, [id]);

    res.json(mapLicense(result.rows[0]));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Eşleşme onaylanamadı.' });
  }
});

app.post('/api/licenses/:id/clear-match', async (req, res) => {
  try {
    const { id } = req.params;
    const licenseResult = await pool.query('SELECT id, business_id FROM licenses WHERE id = $1 LIMIT 1', [id]);
    if (!licenseResult.rows.length) {
      return res.status(404).json({ error: 'Ruhsat kaydı bulunamadı.' });
    }

    await pool.query(`
      UPDATE licenses
      SET
        suggested_business_id = NULL,
        match_score = 0,
        match_note = '',
        match_status = CASE WHEN business_id IS NULL THEN 'Bağlantı Yok' ELSE 'Bağlandı' END,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `, [id]);

    const result = await pool.query(`
      SELECT
        l.*, b.trade_name AS business_trade_name, bc.name AS category_name,
        sb.trade_name AS suggested_business_trade_name, sbc.name AS suggested_category_name
      FROM licenses l
      LEFT JOIN businesses b ON b.id = l.business_id
      LEFT JOIN business_categories bc ON bc.id = b.category_id
      LEFT JOIN businesses sb ON sb.id = l.suggested_business_id
      LEFT JOIN business_categories sbc ON sbc.id = sb.category_id
      WHERE l.id = $1
      LIMIT 1
    `, [id]);

    res.json(mapLicense(result.rows[0]));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Eşleşme temizlenemedi.' });
  }
});

app.delete('/api/licenses/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await pool.query('SELECT id, business_id FROM licenses WHERE id = $1', [id]);
    if (!existing.rows.length) {
      return res.status(404).json({ error: 'Ruhsat kaydı bulunamadı.' });
    }

    const businessId = existing.rows[0].business_id;
    await pool.query('DELETE FROM licenses WHERE id = $1', [id]);
    if (businessId) {
      await updateBusinessLicenseSnapshot(businessId);
    }
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ruhsat kaydı silinemedi.' });
  }
});

app.get('/licenses', (req, res) => {
  res.sendFile(path.join(__dirname, 'licenses-page.html'));
});

app.get("/inspections", (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Zabıta Yönetim Sistemi - Tüm Denetimler</title>
  <style>
    :root { --bg: #f4f7fb; --panel: #ffffff; --panel-soft: #f8fafc; --line: #dbe3ee; --text: #17202f; --muted: #667085; --primary: #2563eb; --danger: #dc2626; --warning: #f59e0b; --success: #16a34a; --shadow: 0 8px 24px rgba(15, 23, 42, 0.06); }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Inter, "Segoe UI", Arial, sans-serif; background: #f3f6fa; color: var(--text); }
    .app { min-height: 100vh; display: block; }
    .sidebar { background: linear-gradient(180deg, #17324f 0%, #12283f 100%); color: #fff; padding: 16px 12px; display: flex; flex-direction: column; gap: 14px; position: fixed; left: 0; top: 0; bottom: 0; width: min(84vw, 320px); height: 100vh; border-right: 1px solid rgba(255,255,255,0.06); z-index: 60; transform: translateX(-100%); transition: transform 0.22s ease; box-shadow: 0 20px 48px rgba(15, 23, 42, 0.18); overflow-y: auto; }
    body.sidebar-open { overflow: hidden; }
    body.sidebar-open .sidebar { transform: translateX(0); }
    .sidebar-top { display: flex; align-items: center; gap: 9px; padding-bottom: 12px; border-bottom: 1px solid rgba(255,255,255,0.1); }
    .brand-mark { width: 38px; height: 38px; border-radius: 11px; background: linear-gradient(135deg, rgba(245,179,1,1) 0%, rgba(255,217,102,1) 100%); color: #0f172a; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 14px; box-shadow: 0 8px 18px rgba(245, 179, 1, 0.16); }
    .brand { font-size: 14px; font-weight: 700; line-height: 1.3; }
    .brand-sub { font-size: 10.5px; color: rgba(255,255,255,0.62); line-height: 1.45; }
    .nav-section-title { font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(255,255,255,0.42); margin-top: 6px; padding: 0 2px; font-weight: 700; }
    .menu { display: flex; flex-direction: column; gap: 4px; }
    .menu-item { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 9px 10px; border-radius: 10px; font-size: 12.5px; text-decoration: none; color: rgba(255,255,255,0.84); transition: 0.18s ease; border: 1px solid transparent; font-weight: 500; }
    .menu-item:hover { background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.08); }
    .menu-item.active { background: rgba(255,255,255,0.08); color: #ffffff; border-color: rgba(255,255,255,0.1); font-weight: 600; }
    .menu-left { display: inline-flex; align-items: center; gap: 8px; }
    .sidebar-toggle { display: inline-flex; align-items: center; gap: 8px; margin-bottom: 14px; border: 1px solid var(--line); background: #ffffff; color: var(--text); border-radius: 12px; padding: 12px 14px; font-size: 14px; font-weight: 700; box-shadow: var(--shadow); cursor: pointer; }
    .sidebar-backdrop { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.45); opacity: 0; pointer-events: none; transition: opacity 0.18s ease; z-index: 50; }
    body.sidebar-open .sidebar-backdrop { opacity: 1; pointer-events: auto; }
    .main { padding: 18px 20px; min-width: 0; }
    .hero, .panel, .stat-card { background: #ffffff; border: 1px solid var(--line); border-radius: 14px; box-shadow: var(--shadow); }
    .hero { padding: 16px 18px; display: flex; justify-content: space-between; gap: 14px; align-items: flex-start; flex-wrap: wrap; margin-bottom: 12px; }
    .hero-title { margin: 0; font-size: 26px; line-height: 1.15; letter-spacing: -0.02em; font-weight: 700; }
    .hero-text { margin: 6px 0 0; color: var(--muted); font-size: 12.5px; line-height: 1.6; max-width: 860px; }
    .toolbar { display: flex; gap: 8px; flex-wrap: wrap; }
    .btn { border: none; border-radius: 10px; padding: 10px 14px; font-size: 13px; font-weight: 600; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; justify-content: center; transition: 0.15s ease; }
    .btn:hover { transform: translateY(-1px); opacity: 0.96; }
    .btn-primary { background: var(--primary); color: #fff; }
    .btn-secondary { background: #64748b; color: #fff; }
    .btn-ghost { background: #eef2ff; color: #1d4ed8; border: 1px solid #dbe7ff; }
    .stats-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-bottom: 12px; }
    .stat-card { padding: 14px; display: grid; gap: 7px; }
    .stat-label { font-size: 11px; font-weight: 700; color: var(--muted); letter-spacing: 0.05em; text-transform: uppercase; }
    .stat-value { font-size: 22px; font-weight: 700; line-height: 1.05; }
    .stat-sub { font-size: 12px; color: var(--muted); }
    .panel { padding: 16px; margin-bottom: 12px; }
    .panel-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; flex-wrap: wrap; }
    .panel-title { font-size: 15px; font-weight: 700; }
    .panel-subtitle { font-size: 12.5px; color: var(--muted); margin-top: 3px; }
    .filters { display: grid; grid-template-columns: 160px 180px 170px 170px 170px minmax(220px, 1fr) auto auto; gap: 10px; align-items: center; }
    input, select { width: 100%; border: 1px solid #cfd8e4; border-radius: 10px; padding: 10px 12px; font-size: 13px; outline: none; background: #fff; color: var(--text); }
    input:focus, select:focus { border-color: var(--primary); box-shadow: 0 0 0 3px rgba(37,99,235,0.12); }
    .table-wrap { overflow: auto; border: 1px solid var(--line); border-radius: 12px; }
    table { width: 100%; border-collapse: collapse; min-width: 1260px; }
    th, td { padding: 12px; border-bottom: 1px solid #edf2f7; font-size: 13px; text-align: left; vertical-align: top; }
    th { background: #f8fafc; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); position: sticky; top: 0; z-index: 1; }
    tbody tr:hover { background: #f8fbff; }
    .cell-title { font-weight: 700; line-height: 1.45; }
    .cell-sub { color: var(--muted); font-size: 12px; line-height: 1.5; margin-top: 4px; }
    .stack { display: grid; gap: 4px; }
    .badge { display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 999px; font-size: 11px; font-weight: 700; white-space: nowrap; }
    .badge.success { background: #dcfce7; color: #166534; }
    .badge.warn { background: #fef3c7; color: #92400e; }
    .badge.danger { background: #fee2e2; color: #b91c1c; }
    .badge.info { background: #dbeafe; color: #1d4ed8; }
    .badge.gray { background: #e5e7eb; color: #374151; }
    .mini-btn { border: 1px solid var(--line); background: #fff; border-radius: 9px; padding: 7px 10px; font-size: 12px; font-weight: 600; cursor: pointer; text-decoration: none; color: #111827; display: inline-flex; align-items: center; gap: 6px; }
    .mini-btn.primary { border-color: #cfe0ff; color: #1d4ed8; background: #eef4ff; }
    .empty-state { border: 1px dashed var(--line); border-radius: 12px; background: #fbfdff; padding: 22px; text-align: center; color: var(--muted); font-size: 13px; }
    .print-meta { display: none; margin-bottom: 12px; padding: 12px 14px; border: 1px solid var(--line); border-radius: 12px; background: #fff; font-size: 12.5px; color: var(--muted); }
    @media (max-width: 1220px) { .filters { grid-template-columns: repeat(2, minmax(0, 1fr)); } .stats-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (max-width: 800px) { .main { padding: 14px; } .stats-grid, .filters { grid-template-columns: 1fr; } .hero-title { font-size: 22px; } }
    @media print { body { background: #fff; } .sidebar, .sidebar-toggle, .hero .toolbar, .filters-panel { display: none !important; } .app { display: block; } .main { padding: 0; } .hero, .panel, .stat-card { box-shadow: none; border-color: #d1d5db; } .hero { margin-bottom: 10px; } .print-meta { display: block; } .table-wrap { overflow: visible; } table { min-width: 0; } th, td { font-size: 11px; padding: 8px; } a { color: inherit; text-decoration: none; } }
  </style>
</head>
<body>
  <div class="sidebar-backdrop" id="sidebarBackdrop" onclick="toggleSidebar(false)"></div>
  <div class="app">
    <aside class="sidebar" id="sidebar">
      <div class="sidebar-top"><div class="brand-mark">ZB</div><div><div class="brand">Zabıta Yönetim Sistemi</div><div class="brand-sub">Kurumsal takip ve saha yönetimi</div></div></div>
      <div class="nav-section-title">Modüller</div>
      <nav class="menu">
        <a href="/" class="menu-item"><span class="menu-left"><span>📌</span><span>Şikayet Takip</span></span></a>
        <a href="/businesses" class="menu-item"><span class="menu-left"><span>🏪</span><span>Firma Listesi</span></span></a>
        <a href="/inspections" class="menu-item active"><span class="menu-left"><span>🧾</span><span>Tüm Denetimler</span></span></a>
        <a href="/licenses" class="menu-item"><span class="menu-left"><span>📜</span><span>Ruhsat Yönetimi</span></span></a>
        <a href="/markets" class="menu-item"><span class="menu-left"><span>🧺</span><span>Pazar Yönetimi</span></span></a>
      </nav>
    </aside>
    <main class="main">
      <button class="sidebar-toggle" type="button" onclick="toggleSidebar()">☰ Modüller</button>
      <section class="hero">
        <div>
          <h1 class="hero-title">Toplu Denetim Geçmişi</h1>
          <p class="hero-text">Tüm firmalara ait denetim kayıtları bu ekranda tek havuzda toplanır. Ay, kategori, sonuç, durum ve ruhsat yapısına göre filtreleyip yazdırabilir ya da tarayıcı yazdır ekranından PDF olarak kaydedebilirsin.</p>
        </div>
        <div class="toolbar">
          <a class="btn btn-ghost" href="/businesses">Firma Listesi</a>
          <button class="btn btn-secondary" type="button" onclick="clearFilters()">Filtreyi Temizle</button>
          <button class="btn btn-secondary" type="button" onclick="exportExcel()">Excel'e Aktar</button>
          <button class="btn btn-primary" type="button" onclick="printFilteredView()">Yazdır / PDF</button>
        </div>
      </section>
      <section class="stats-grid">
        <div class="stat-card"><div class="stat-label">Filtreli Denetim</div><div class="stat-value" id="statTotal">0</div><div class="stat-sub">Seçili filtreye uyan toplam denetim kaydı</div></div>
        <div class="stat-card"><div class="stat-label">Firma Sayısı</div><div class="stat-value" id="statBusiness">0</div><div class="stat-sub">Denetim görünen benzersiz firma adedi</div></div>
        <div class="stat-card"><div class="stat-label">Süre Verilen</div><div class="stat-value" id="statDeadline">0</div><div class="stat-sub">Kontrol tarihi planlanan denetimler</div></div>
        <div class="stat-card"><div class="stat-label">Geciken Kontrol</div><div class="stat-value" id="statOverdue">0</div><div class="stat-sub">Kontrol tarihi geçen kayıtlar</div></div>
      </section>
      <section class="panel filters-panel">
        <div class="panel-header"><div><div class="panel-title">Filtreleme</div><div class="panel-subtitle">Örnek kullanım: Mart ayı tüm denetimler veya sadece belli kategorideki ruhsatsız firmaların denetimleri.</div></div></div>
        <div class="filters">
          <input type="month" id="filterMonth" onchange="renderInspectionTable()" />
          <select id="filterCategory" onchange="renderInspectionTable()"></select>
          <select id="filterLicense" onchange="renderInspectionTable()"><option value="all">Tüm Ruhsat Durumları</option><option value="Var">Ruhsatlı</option><option value="Yok">Ruhsatsız</option><option value="Başvuru Aşamasında">Başvuru Aşamasında</option>
            <option value="İptal / Pasif">İptal / Pasif Özeti</option></select>
          <select id="filterResult" onchange="renderInspectionTable()"><option value="all">Tüm Sonuçlar</option><option value="Uygun">Uygun</option><option value="Eksik Var">Eksik Var</option><option value="Uyarı Yapıldı">Uyarı Yapıldı</option><option value="İşlem Yapıldı">İşlem Yapıldı</option></select>
          <select id="filterStatus" onchange="renderInspectionTable()"><option value="all">Tüm Durumlar</option><option value="Açık">Açık</option><option value="Süre Verildi">Süre Verildi</option><option value="Kapatıldı">Kapatıldı</option></select>
          <input type="text" id="searchInput" placeholder="Firma, sahip, telefon, mahalle / cadde ara" oninput="renderInspectionTable()" />
          <button class="btn btn-ghost" type="button" onclick="setCurrentMonth()">Bu Ay</button>
          <button class="btn btn-secondary" type="button" onclick="clearFilters()">Temizle</button>
        </div>
      </section>
      <div class="print-meta" id="printMeta"></div>
      <section class="panel">
        <div class="panel-header"><div><div class="panel-title">Denetim Listesi</div><div class="panel-subtitle">Filtreler uygulandıkça liste, yazdır/PDF çıktısı ve Excel aktarımı aynı filtrelerle çalışır.</div></div></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Denetim Tarihi</th><th>Firma / Kategori</th><th>Adres</th><th>Sonuç</th><th>Durum</th><th>Yapılan İşlem</th><th>Kontrol Tarihi</th><th>Ruhsat</th><th>İşlemler</th></tr></thead>
            <tbody id="inspectionTableBody"></tbody>
          </table>
        </div>
      </section>
    </main>
  </div>
  <script>
    var categories = [];
    var inspections = [];
    function escapeHtml(value) { return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
    function badgeForResult(status) { if (status === 'Uygun') return '<span class="badge success">Uygun</span>'; if (status === 'Eksik Var') return '<span class="badge warn">Eksik Var</span>'; if (status === 'Uyarı Yapıldı') return '<span class="badge danger">Uyarı Yapıldı</span>'; if (status === 'İşlem Yapıldı') return '<span class="badge info">İşlem Yapıldı</span>'; if (status) return '<span class="badge gray">' + escapeHtml(status) + '</span>'; return '<span class="badge gray">Girilmeyen Sonuç</span>'; }
    function badgeForStatus(status) { if (status === 'Kapatıldı') return '<span class="badge success">Kapatıldı</span>'; if (status === 'Süre Verildi') return '<span class="badge warn">Süre Verildi</span>'; if (status === 'Açık') return '<span class="badge info">Açık</span>'; if (status) return '<span class="badge gray">' + escapeHtml(status) + '</span>'; return '<span class="badge gray">Durum Yok</span>'; }
    function badgeForLicense(status) { if (status === 'Var') return '<span class="badge success">Ruhsatlı</span>'; if (status === 'Başvuru Aşamasında') return '<span class="badge warn">Başvuru Aşamasında</span>'; return '<span class="badge danger">Ruhsatsız</span>'; }
    function setCurrentMonth() { document.getElementById('filterMonth').value = new Date().toISOString().slice(0, 7); renderInspectionTable(); }
    function renderCategoryOptions() { var html = '<option value="all">Tüm Kategoriler</option>'; for (var i = 0; i < categories.length; i++) { html += '<option value="' + categories[i].id + '">' + escapeHtml(categories[i].name) + '</option>'; } document.getElementById('filterCategory').innerHTML = html; }
    function getFilteredInspections() {
      var month = document.getElementById('filterMonth').value;
      var categoryId = document.getElementById('filterCategory').value;
      var licenseStatus = document.getElementById('filterLicense').value;
      var resultStatus = document.getElementById('filterResult').value;
      var currentStatus = document.getElementById('filterStatus').value;
      var search = document.getElementById('searchInput').value.trim().toLocaleLowerCase('tr-TR');
      return inspections.filter(function(item) {
        var itemMonth = item.inspectionDate ? item.inspectionDate.slice(0, 7) : '';
        var text = [item.tradeName, item.ownerName, item.phone, item.categoryName, item.neighborhood, item.street, item.doorNo, item.addressText, item.actionTaken, item.note].join(' ').toLocaleLowerCase('tr-TR');
        var matchesMonth = !month || itemMonth === month;
        var matchesCategory = categoryId === 'all' || String(item.categoryId) === String(categoryId);
        var matchesLicense = licenseStatus === 'all' || String(item.licenseStatus || 'Yok') === licenseStatus;
        var matchesResult = resultStatus === 'all' || String(item.resultStatus || '') === resultStatus;
        var matchesStatus = currentStatus === 'all' || String(item.currentStatus || '') === currentStatus;
        var matchesSearch = !search || text.indexOf(search) !== -1;
        return matchesMonth && matchesCategory && matchesLicense && matchesResult && matchesStatus && matchesSearch;
      });
    }
    function renderStats(rows) {
      var uniqueBusinesses = {};
      var sureVerildi = 0;
      var overdue = 0;
      var today = new Date().toISOString().slice(0, 10);
      for (var i = 0; i < rows.length; i++) { uniqueBusinesses[rows[i].businessId] = true; if (rows[i].currentStatus === 'Süre Verildi') { sureVerildi += 1; if (rows[i].controlDate && rows[i].controlDate < today) overdue += 1; } }
      document.getElementById('statTotal').textContent = rows.length;
      document.getElementById('statBusiness').textContent = Object.keys(uniqueBusinesses).length;
      document.getElementById('statDeadline').textContent = sureVerildi;
      document.getElementById('statOverdue').textContent = overdue;
    }
    function updatePrintMeta(rows) {
      var month = document.getElementById('filterMonth').value;
      var categoryText = document.getElementById('filterCategory').selectedOptions[0] ? document.getElementById('filterCategory').selectedOptions[0].textContent : 'Tüm Kategoriler';
      var licenseText = document.getElementById('filterLicense').selectedOptions[0].textContent;
      var resultText = document.getElementById('filterResult').selectedOptions[0].textContent;
      var statusText = document.getElementById('filterStatus').selectedOptions[0].textContent;
      var search = document.getElementById('searchInput').value.trim();
      var parts = [];
      if (month) parts.push('Ay: ' + month);
      parts.push('Kategori: ' + categoryText);
      parts.push('Ruhsat: ' + licenseText);
      parts.push('Sonuç: ' + resultText);
      parts.push('Durum: ' + statusText);
      if (search) parts.push('Arama: ' + search);
      parts.push('Toplam kayıt: ' + rows.length);
      document.getElementById('printMeta').innerHTML = '<strong>Toplu Denetim Çıktısı</strong><br>' + escapeHtml(parts.join(' • '));
    }
    function renderInspectionTable() {
      var rows = getFilteredInspections();
      renderStats(rows);
      updatePrintMeta(rows);
      var body = document.getElementById('inspectionTableBody');
      if (!rows.length) { body.innerHTML = '<tr><td colspan="9"><div class="empty-state">Bu filtreye uygun denetim kaydı bulunmuyor.</div></td></tr>'; return; }
      var html = '';
      for (var i = 0; i < rows.length; i++) {
        var item = rows[i];
        html += '<tr>' +
          '<td><div class="cell-title">' + escapeHtml(item.inspectionDateText || '-') + '</div><div class="cell-sub">' + escapeHtml(item.createdAt || '-') + '</div></td>' +
          '<td><div class="cell-title">' + escapeHtml(item.tradeName || '-') + '</div><div class="cell-sub">' + escapeHtml(item.categoryName || 'Kategori Yok') + '</div><div class="cell-sub">Yetkili: ' + escapeHtml(item.ownerName || '-') + '</div></td>' +
          '<td><div class="stack"><div>' + escapeHtml(item.addressText || 'Adres girilmedi') + '</div>' + (item.phone ? '<div class="cell-sub">Tel: ' + escapeHtml(item.phone) + '</div>' : '') + '</div></td>' +
          '<td>' + badgeForResult(item.resultStatus) + '</td>' +
          '<td>' + badgeForStatus(item.currentStatus) + '</td>' +
          '<td><div class="stack"><div>' + escapeHtml(item.actionTaken || 'İşlem girilmedi') + '</div>' + (item.note ? '<div class="cell-sub">Not: ' + escapeHtml(item.note) + '</div>' : '') + '</div></td>' +
          '<td>' + escapeHtml(item.controlDateText || 'Planlanmadı') + '</td>' +
          '<td>' + badgeForLicense(item.licenseStatus) + '</td>' +
          '<td><a class="mini-btn primary" href="/businesses/' + item.businessId + '">Firma Detayı</a></td>' +
        '</tr>';
      }
      body.innerHTML = html;
    }
    function buildFilterQueryString() {
      var params = new URLSearchParams();
      var month = document.getElementById('filterMonth').value;
      var category = document.getElementById('filterCategory').value;
      var categoryText = document.getElementById('filterCategory').selectedOptions[0] ? document.getElementById('filterCategory').selectedOptions[0].textContent : '';
      var license = document.getElementById('filterLicense').value;
      var result = document.getElementById('filterResult').value;
      var status = document.getElementById('filterStatus').value;
      var search = document.getElementById('searchInput').value.trim();
      if (month) params.set('month', month);
      if (category && category !== 'all') { params.set('categoryId', category); params.set('categoryName', categoryText); }
      if (license && license !== 'all') params.set('licenseStatus', license);
      if (result && result !== 'all') params.set('resultStatus', result);
      if (status && status !== 'all') params.set('currentStatus', status);
      if (search) params.set('search', search);
      return params.toString();
    }
    function toggleSidebar(forceOpen) {
      var shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : !document.body.classList.contains('sidebar-open');
      document.body.classList.toggle('sidebar-open', shouldOpen);
    }
    function exportExcel() {
      var rows = getFilteredInspections();
      if (!rows.length) { alert('Bu filtreye uygun Excel çıktısı oluşturulacak kayıt bulunmuyor.'); return; }
      var query = buildFilterQueryString();
      window.location.href = '/api/inspections/export.xlsx' + (query ? ('?' + query) : '');
    }
    function clearFilters() { document.getElementById('filterMonth').value = ''; document.getElementById('filterCategory').value = 'all'; document.getElementById('filterLicense').value = 'all'; document.getElementById('filterResult').value = 'all'; document.getElementById('filterStatus').value = 'all'; document.getElementById('searchInput').value = ''; renderInspectionTable(); }
    function printFilteredView() { updatePrintMeta(getFilteredInspections()); window.print(); }
    async function loadCategories() { var response = await fetch('/api/business-categories'); if (!response.ok) throw new Error('Kategoriler yüklenemedi.'); categories = await response.json(); renderCategoryOptions(); }
    async function loadInspections() { var response = await fetch('/api/inspections'); if (!response.ok) throw new Error('Denetim listesi yüklenemedi.'); inspections = await response.json(); renderInspectionTable(); }
    document.addEventListener('DOMContentLoaded', async function() {
      document.addEventListener('keydown', function(event) {
        if (event.key === 'Escape' && document.body.classList.contains('sidebar-open')) toggleSidebar(false);
      });
      try { await loadCategories(); await loadInspections(); } catch (error) { document.getElementById('inspectionTableBody').innerHTML = '<tr><td colspan="9"><div class="empty-state">' + escapeHtml(error.message || 'Denetim listesi yüklenemedi.') + '</div></td></tr>'; }
    });
  </script>
</body>
</html>`);
});

app.get("/business-categories", (req, res) => {
  res.redirect("/businesses");
});

app.get("/", (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Zabıta Yönetim Sistemi - Şikayet Takip Sistemi</title>
  <style>

    :root {
      --bg: #f4f7fb;
      --panel: #ffffff;
      --panel-soft: #f8fafc;
      --line: #dbe3ee;
      --line-strong: #c7d2df;
      --text: #17202f;
      --muted: #667085;
      --navy: #163a63;
      --navy-2: #1f4c81;
      --accent: #f5b301;
      --primary: #2563eb;
      --danger: #dc2626;
      --shadow: 0 8px 24px rgba(15, 23, 42, 0.06);
    }
    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body { margin: 0; font-family: Inter, "Segoe UI", Arial, Helvetica, sans-serif; background: #f3f6fa; color: var(--text); -webkit-font-smoothing: antialiased; }
    .app { min-height: 100vh; display: block; }
    .sidebar { background: linear-gradient(180deg, #17324f 0%, #12283f 100%); color: #ffffff; padding: 16px 12px; display: flex; flex-direction: column; gap: 14px; position: fixed; left: 0; top: 0; bottom: 0; width: min(84vw, 320px); height: 100vh; border-right: 1px solid rgba(255,255,255,0.06); z-index: 60; transform: translateX(-100%); transition: transform 0.22s ease; box-shadow: 0 20px 48px rgba(15, 23, 42, 0.18); overflow-y: auto; }
    body.sidebar-open { overflow: hidden; }
    body.sidebar-open .sidebar { transform: translateX(0); }
    .sidebar-top { display: flex; align-items: center; gap: 9px; padding-bottom: 12px; border-bottom: 1px solid rgba(255,255,255,0.1); }
    .brand-mark { width: 38px; height: 38px; border-radius: 11px; background: linear-gradient(135deg, rgba(245,179,1,1) 0%, rgba(255,217,102,1) 100%); color: #0f172a; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 14px; flex-shrink: 0; box-shadow: 0 8px 18px rgba(245, 179, 1, 0.16); }
    .brand { font-size: 14px; font-weight: 700; line-height: 1.3; margin-bottom: 2px; letter-spacing: -0.01em; }
    .brand-sub { font-size: 10.5px; color: rgba(255,255,255,0.62); line-height: 1.45; }
    .menu { display: flex; flex-direction: column; gap: 4px; }
    .nav-section-title { font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(255,255,255,0.42); margin-top: 6px; margin-bottom: 2px; padding: 0 2px; font-weight: 700; }
    .menu-item { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 9px 10px; border-radius: 10px; font-size: 12.5px; text-decoration: none; color: rgba(255,255,255,0.84); transition: 0.18s ease; border: 1px solid transparent; font-weight: 500; }
    .menu-item:hover { background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.08); }
    .menu-item.active { background: rgba(255, 255, 255, 0.08); color: #ffffff; border-color: rgba(255,255,255,0.1); box-shadow: none; font-weight: 600; }
    .menu-left { display: inline-flex; align-items: center; gap: 8px; min-width: 0; }
    .menu-badge { display: none; }
    .sidebar-toggle { display: inline-flex; align-items: center; gap: 8px; margin-bottom: 14px; border: 1px solid var(--line); background: #ffffff; color: var(--text); border-radius: 12px; padding: 12px 14px; font-size: 14px; font-weight: 700; box-shadow: var(--shadow); cursor: pointer; }
    .sidebar-backdrop { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.45); opacity: 0; pointer-events: none; transition: opacity 0.18s ease; z-index: 50; }
    body.sidebar-open .sidebar-backdrop { opacity: 1; pointer-events: auto; }
    .sidebar-footer { display: none; }
    .sidebar-footer-title { display: none; }
    .sidebar-footer-text { display: none; }
    .sidebar-toggle { display: inline-flex; align-items: center; gap: 8px; margin-bottom: 14px; border: 1px solid var(--line); background: #ffffff; color: var(--text); border-radius: 12px; padding: 12px 14px; font-size: 14px; font-weight: 700; box-shadow: var(--shadow); cursor: pointer; }
    .sidebar-backdrop { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.45); opacity: 0; pointer-events: none; transition: opacity 0.18s ease; z-index: 50; }
    body.sidebar-open .sidebar-backdrop { opacity: 1; pointer-events: auto; }
    .main { padding: 18px 20px; min-width: 0; }
    .hero { background: #ffffff; border: 1px solid var(--line); border-radius: 14px; box-shadow: var(--shadow); padding: 14px 16px; display: flex; justify-content: space-between; align-items: center; gap: 14px; margin-bottom: 12px; flex-wrap: wrap; }
    .hero-copy { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    .hero-eyebrow { display: none; }
    .hero-title { margin: 0; font-size: 26px; line-height: 1.15; letter-spacing: -0.02em; font-weight: 700; }
    .hero-text { margin: 0; color: var(--muted); font-size: 12.5px; line-height: 1.55; max-width: 760px; }
    .hero-side { display: flex; align-items: center; gap: 10px; justify-content: flex-end; min-width: 260px; flex: 1; }
    .date-card { background: #f8fafc; color: var(--text); border-radius: 10px; padding: 10px 12px; display: grid; gap: 2px; box-shadow: none; border: 1px solid var(--line); min-width: 210px; }
    .date-card span { font-size: 10px; font-weight: 700; color: var(--muted); letter-spacing: 0.05em; text-transform: uppercase; opacity: 1; }
    .date-card strong { font-size: 13px; line-height: 1.35; font-weight: 700; }
    .section-actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
    .btn { border: none; border-radius: 10px; padding: 10px 14px; font-size: 13px; font-weight: 600; cursor: pointer; transition: transform 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease; box-shadow: 0 6px 14px rgba(15, 23, 42, 0.06); }
    .btn:hover { transform: translateY(-1px); opacity: 0.96; }
    .btn-primary { background: var(--primary); color: #ffffff; }
    .btn-info { background: #0f172a; color: #ffffff; }
    .btn-warning { background: var(--accent); color: #1f2937; }
    .btn-secondary { background: #64748b; color: #ffffff; }
    .btn-danger { background: var(--danger); color: #ffffff; }
    .critical-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-bottom: 10px; }
    .critical-card { border: 1px solid var(--line); border-radius: 13px; padding: 12px 13px; background: #ffffff; box-shadow: var(--shadow); cursor: pointer; text-align: left; display: grid; gap: 5px; transition: 0.18s ease; width: 100%; }
    .critical-card.today { background: linear-gradient(135deg, #fffdf6 0%, #ffffff 100%); }
    .critical-card.overdue { background: linear-gradient(135deg, #fffafa 0%, #ffffff 100%); }
    .critical-card.active-card { border-color: #f59e0b; box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.14); }
    .critical-card.active-card-warning { border-color: #dc2626; box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.14); }
    .critical-topline { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
    .critical-title { font-size: 12px; font-weight: 700; }
    .critical-icon { width: 30px; height: 30px; border-radius: 9px; display: flex; align-items: center; justify-content: center; font-size: 14px; background: rgba(255,255,255,0.78); border: 1px solid rgba(148, 163, 184, 0.16); }
    .critical-card .card-number { font-size: 22px; font-weight: 700; margin: 0; }
    .critical-card .card-label { font-size: 11.5px; color: var(--muted); line-height: 1.4; margin: 0; }
    .stats-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-bottom: 12px; }
    .card { background: #ffffff; border: 1px solid var(--line); border-radius: 12px; padding: 12px; box-shadow: var(--shadow); min-height: 92px; display: grid; gap: 7px; align-content: start; }
    .card-icon { width: 32px; height: 32px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 15px; }
    .icon-yellow { background: #fff4cf; }
    .icon-blue { background: #e0efff; }
    .icon-green { background: #dcfce7; }
    .icon-gray { background: #edf2f7; }
    .card-number { font-size: 21px; font-weight: 700; line-height: 1; margin: 0; }
    .card-label { font-size: 11.5px; color: var(--muted); line-height: 1.45; }
    .panel { background: #ffffff; border: 1px solid var(--line); border-radius: 14px; padding: 14px; box-shadow: var(--shadow); margin-bottom: 12px; }
    .panel-header { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 12px; flex-wrap: wrap; }
    .panel-kicker { display: none; }
    .panel-title { font-size: 16px; font-weight: 700; line-height: 1.25; }
    .panel-note { display: none; }
    .filters { display: grid; grid-template-columns: 150px 150px 150px minmax(220px, 1fr) 130px; gap: 10px; align-items: center; }
    input, select, textarea { width: 100%; border: 1px solid #cfd8e4; border-radius: 10px; padding: 10px 12px; font-size: 13px; outline: none; background: #ffffff; color: var(--text); transition: border-color 0.15s ease, box-shadow 0.15s ease; }
    input:focus, select:focus, textarea:focus { border-color: var(--primary); box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12); }
    textarea { resize: vertical; min-height: 88px; }
    .table-panel { padding-bottom: 12px; }
    .table-wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: 14px; }
    .table-wrap table td:first-child { min-width: 230px; }
    table { width: 100%; border-collapse: collapse; min-width: 860px; background: #ffffff; }
    thead th { position: sticky; top: 0; background: #f8fafc; z-index: 2; }
    th { text-align: left; padding: 13px 12px; font-size: 12px; color: #475569; border-bottom: 1px solid var(--line); font-weight: 700; letter-spacing: 0.02em; }
    td { padding: 13px 12px; border-bottom: 1px solid #edf2f7; font-size: 13px; vertical-align: middle; }
    tbody tr:hover { background: #f8fbff; }
    .complaint-no { font-weight: 700; color: #0f172a; }
    .badge { display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 999px; font-size: 11px; font-weight: 700; white-space: nowrap; }
    .badge-source { background: #e2e8f0; color: #334155; }
    .badge-open { background: #fff4c6; color: #8a5a00; }
    .badge-review { background: #dbeafe; color: #1d4ed8; }
    .badge-deadline { background: #fde68a; color: #92400e; }
    .badge-closed { background: #dcfce7; color: #166534; }
    .badge-due-today { background: #fef3c7; color: #92400e; }
    .badge-overdue { background: #fee2e2; color: #b91c1c; }
    .actions { display: flex; gap: 6px; flex-wrap: wrap; }
    .icon-btn { border: none; width: 34px; height: 34px; border-radius: 9px; font-size: 14px; font-weight: 700; cursor: pointer; color: #ffffff; box-shadow: 0 6px 14px rgba(15, 23, 42, 0.06); }
    .view-btn { background: #0891b2; }
    .edit-btn { background: var(--accent); color: #1f2937; }
    .delete-btn { background: var(--danger); }
    .empty-note { padding: 14px 4px 4px 4px; color: var(--muted); font-size: 13px; }
    .modal-overlay { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.5); display: none; align-items: center; justify-content: center; padding: 20px; z-index: 100; backdrop-filter: blur(3px); }
    .modal-overlay.show { display: flex; }
    .modal { width: 100%; max-width: 940px; background: #ffffff; border-radius: 18px; overflow: hidden; box-shadow: 0 24px 60px rgba(15, 23, 42, 0.14); border: 1px solid rgba(255,255,255,0.6); }
    .modal-header { background: linear-gradient(135deg, #fff8dc 0%, #f5b301 100%); padding: 16px 18px; display: flex; align-items: center; justify-content: space-between; font-size: 16px; font-weight: 700; color: #1f2937; }
    .modal-header.white { background: #ffffff; border-bottom: 1px solid var(--line); }
    .close-btn { border: none; background: transparent; font-size: 34px; line-height: 1; cursor: pointer; color: #475569; }
    .modal-body { padding: 18px; max-height: 76vh; overflow: auto; background: #ffffff; }
    .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 16px; }
    .full { grid-column: 1 / -1; }
    .form-group label { display: block; margin-bottom: 7px; font-weight: 700; font-size: 13px; color: #334155; }
    .hidden { display: none !important; }
    .modal-footer { padding: 14px 18px; display: flex; justify-content: flex-end; gap: 8px; border-top: 1px solid var(--line); background: #ffffff; }
    .modal-complaint-entry { max-width: 1020px; }
    .modal-header-stack { display: grid; gap: 2px; }
    .modal-header-stack small { font-size: 12px; font-weight: 600; color: rgba(31, 41, 55, 0.72); }
    .complaint-entry-body { padding: 20px; }
    .entry-shell { display: grid; gap: 14px; }
    .entry-section { background: linear-gradient(180deg, #fbfdff 0%, #f8fafc 100%); border: 1px solid #e6edf5; border-radius: 16px; padding: 16px; }
    .entry-section-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; margin-bottom: 12px; }
    .entry-section-title { font-size: 14px; font-weight: 800; color: #0f172a; }
    .entry-section-note { font-size: 12px; color: #64748b; margin-top: 2px; line-height: 1.45; }
    .entry-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px 16px; }
    .complaint-entry-body .form-group { margin: 0; }
    .complaint-entry-body .form-group label { margin-bottom: 8px; }
    .complaint-entry-body input[disabled] { background: #f8fafc; color: #0f172a; font-weight: 700; }
    .complaint-entry-body textarea { min-height: 108px; resize: vertical; }
    .complaint-entry-body #newDetail { min-height: 120px; }
    .complaint-entry-body #newNote { min-height: 96px; }
    .topic-help { margin-top: 8px; padding: 10px 12px; border-radius: 12px; background: #fff8dc; border: 1px solid #f3dd8b; color: #7c5a00; font-size: 12px; line-height: 1.45; }
    .detail-title { text-align: center; font-size: 21px; font-weight: 700; margin-bottom: 18px; letter-spacing: 0.02em; }
    .detail-table td, .detail-table th { border: 1px solid var(--line); padding: 14px 12px; }
    .detail-table th { width: 220px; background: #f8fafc; font-weight: 800; }
    .attachments-section { margin-top: 20px; border: 1px solid var(--line); border-radius: 14px; padding: 16px; background: var(--panel-soft); }
    .section-title { font-size: 16px; font-weight: 700; margin-bottom: 12px; }
    .attachments-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; }
    .attachment-groups { display: grid; gap: 14px; }
    .attachment-group { background: #ffffff; border: 1px solid var(--line); border-radius: 14px; padding: 14px; }
    .attachment-group-header { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 14px; padding-bottom: 10px; border-bottom: 1px solid #eef2f7; }
    .attachment-group-title { font-size: 15px; font-weight: 700; color: #111827; }
    .attachment-group-count { background: #eff6ff; color: #1d4ed8; border-radius: 999px; padding: 6px 10px; font-size: 12px; font-weight: 800; }
    .attachment-group-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 10px; }
    .attachment-card { background: #ffffff; border: 1px solid var(--line); border-radius: 12px; padding: 10px; display: grid; grid-template-columns: 96px 1fr; gap: 10px; align-items: start; }
    .attachment-thumb, .attachment-thumb-doc { width: 96px; height: 78px; border-radius: 10px; border: 1px solid #dbe4f0; overflow: hidden; background: #f8fafc; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .attachment-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .attachment-thumb-doc { font-size: 30px; color: var(--primary); font-weight: 700; }
    .attachment-content { min-width: 0; }
    .attachment-topline { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; margin-bottom: 8px; }
    .attachment-name { font-weight: 700; color: #111827; word-break: break-word; line-height: 1.35; }
    .attachment-date { color: var(--muted); font-size: 11px; white-space: nowrap; }
    .attachment-tags { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
    .attachment-tag { background: #f3f4f6; color: #374151; border-radius: 999px; padding: 4px 8px; font-size: 11px; font-weight: 700; }
    .attachment-description { color: #4b5563; font-size: 12px; line-height: 1.45; margin-bottom: 8px; min-height: 34px; }
    .attachment-bottom { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; }
    .attachment-size { color: var(--muted); font-size: 11px; font-weight: 700; }
    .attachment-actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .attachment-actions .btn { padding: 8px 10px; font-size: 12px; }
    .file-link { display: inline-flex; align-items: center; gap: 8px; text-decoration: none; color: var(--primary); font-weight: 700; }
    .muted { color: var(--muted); }
    .alert-empty { color: var(--muted); font-size: 13px; padding: 4px 0; }
    .alert-group-title { font-size: 15px; font-weight: 700; margin-bottom: 10px; }
    .alert-group-title.today { color: #92400e; }
    .alert-group-title.overdue { color: #b91c1c; }
    .alert-list { display: grid; gap: 10px; }
    .alert-item { border-radius: 10px; padding: 10px 12px; display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; flex-wrap: wrap; border: 1px solid var(--line); background: #ffffff; }
    .alert-item.today { border-left: 3px solid #d6a840; border-color: #ebdfb6; background: #ffffff; }
    .alert-item.overdue { border-left: 3px solid #d64f4f; border-color: #f0d2d2; background: #ffffff; }
    .alert-item-title { font-weight: 700; line-height: 1.45; margin-bottom: 3px; font-size: 12.5px; }
    .alert-item-meta { font-size: 11.5px; color: var(--muted); line-height: 1.45; }
    .alert-item.overdue .alert-item-meta { color: #8a4a4a; }
    .alert-item.today .alert-item-meta { color: #7c6030; }
    @media (max-width: 1280px) { .stats-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .filters { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    .alert-item .btn { padding: 8px 10px; font-size: 12px; box-shadow: none; }
    @media (max-width: 980px) { .main { padding: 16px; } .hero { padding: 14px; border-radius: 16px; } .hero-title { font-size: 24px; } .hero-side { min-width: 0; max-width: none; width: 100%; justify-content: space-between; flex-wrap: wrap; } .critical-grid, .stats-grid, .attachments-grid, .form-grid, .filters, .entry-grid { grid-template-columns: 1fr; } .panel, .modal-body, .modal-footer { padding-left: 16px; padding-right: 16px; } .modal { border-radius: 20px; } .entry-section { padding: 14px; } .detail-table th { width: 150px; } }
    @media (max-width: 640px) { .main { padding: 14px; } .hero-title { font-size: 22px; } .panel-title { font-size: 17px; } .card, .critical-card { padding: 14px; } .section-actions { width: 100%; } .section-actions .btn { flex: 1; } .attachment-card { grid-template-columns: 1fr; } .attachment-thumb, .attachment-thumb-doc { width: 100%; height: 180px; } table { min-width: 760px; } .date-card { min-width: 0; width: 100%; } }
  </style>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin="" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""></script>
</head>
<body>
  <div class="sidebar-backdrop" id="sidebarBackdrop" onclick="toggleSidebar(false)"></div>
  <div class="app">
    <aside class="sidebar" id="sidebar">
      <div class="sidebar-top">
        <div class="brand-mark">ZY</div>
        <div>
          <div class="brand">Zabıta Yönetim Sistemi</div>
        </div>
      </div>
      <nav class="menu">
        <div class="nav-section-title">Genel</div>
        <a href="#" class="menu-item"><span class="menu-left"><span>🏠</span><span>Ana Sayfa</span></span></a>
        <div class="nav-section-title">Modüller</div>
        <a href="#" class="menu-item active"><span class="menu-left"><span>💬</span><span>Şikayet Yönetimi</span></span></a>
        <a href="/businesses" class="menu-item"><span class="menu-left"><span>🏪</span><span>Firma Listesi</span></span></a>
        <a href="/inspections" class="menu-item"><span class="menu-left"><span>🧾</span><span>Tüm Denetimler</span></span></a>
        <a href="/licenses" class="menu-item"><span class="menu-left"><span>📜</span><span>Ruhsat Yönetimi</span></span></a>
        <a href="/markets" class="menu-item"><span class="menu-left"><span>🧺</span><span>Pazar Yönetimi</span></span></a>
      </nav>
    </aside>
    <main class="main">
      <button class="sidebar-toggle" type="button" onclick="toggleSidebar()">☰ Menü</button>
      <section class="hero">
        <div class="hero-copy">
          <h1 class="hero-title">Zabıta Yönetim Sistemi</h1>
          <p class="hero-text">Şikayet yönetimi ekranı</p>
        </div>
        <div class="hero-side">
          <div class="date-card"><span>Tarih</span><strong id="todayText"></strong></div>
          <div class="section-actions">
            <button class="btn btn-info" type="button">📊 İstatistikler</button>
            <button class="btn btn-secondary" type="button" onclick="openTopicManager()">🏷 Konu Başlıkları</button>
            <button class="btn btn-primary" type="button" onclick="openNewModal()">＋ Yeni Şikayet</button>
          </div>
        </div>
      </section>
      <section class="critical-grid">
        <button class="critical-card today" id="dueTodayCard" type="button" onclick="toggleAlertPanel('today')">
          <div class="critical-topline"><div class="critical-title">Bugün Kontrol</div><div class="critical-icon">📆</div></div>
          <div class="card-number" id="dueTodayCount">0</div>
          <div class="card-label">Bugün bakılması gereken kayıtlar</div>
        </button>
        <button class="critical-card overdue" id="overdueCard" type="button" onclick="toggleAlertPanel('overdue')">
          <div class="critical-topline"><div class="critical-title">Geciken Kontroller</div><div class="critical-icon">⚠</div></div>
          <div class="card-number" id="overdueCount">0</div>
          <div class="card-label">Geciken ve öne alınması gereken kayıtlar</div>
        </button>
      </section>
      <section class="stats-grid">
        <div class="card"><div class="card-icon icon-yellow">📁</div><div class="card-number" id="openCount">0</div><div class="card-label">Açık şikayet sayısı</div></div>
        <div class="card"><div class="card-icon icon-blue">🕒</div><div class="card-number" id="reviewCount">0</div><div class="card-label">İnceleniyor veya süre verilmiş kayıtlar</div></div>
        <div class="card"><div class="card-icon icon-green">✔</div><div class="card-number" id="closedCount">0</div><div class="card-label">Kapanan kayıt sayısı</div></div>
        <div class="card"><div class="card-icon icon-gray">📋</div><div class="card-number" id="totalCount">0</div><div class="card-label">Toplam şikayet kaydı</div></div>
      </section>
      <section class="panel" id="controlAlertsPanel" style="display:none;">
        <div class="panel-header"><div class="panel-title">Kritik kontrol listesi</div></div>
        <div id="controlAlertsList"></div>
      </section>
      <section class="panel">
        <div class="panel-header"><div class="panel-title">Kayıt filtreleri</div></div>
        <div class="filters">
          <input type="date" id="filterDate" />
          <select id="filterSource"><option value="">Tüm Kaynaklar</option><option value="CİMER">CİMER</option><option value="Şeffaf Masa">Şeffaf Masa</option><option value="Büro Telefonu">Büro Telefonu</option><option value="Vatandaş Talebi">Vatandaş Talebi</option></select>
          <select id="filterStatus"><option value="">Tüm Durumlar</option><option value="Açık">Açık</option><option value="İnceleniyor">İnceleniyor</option><option value="Süre Verildi">Süre Verildi</option><option value="Kapatıldı">Kapatıldı</option></select>
          <input type="text" id="searchInput" placeholder="Şikayet No, konu veya mahalle ara..." />
          <button class="btn btn-secondary" type="button" onclick="renderTable()">🔎 Filtrele</button>
        </div>
      </section>
      <section class="panel table-panel">
        <div class="panel-header"><div class="panel-title">Şikayet kayıtları</div></div>
        <div class="table-wrap"><table><thead><tr><th>Şikayet No</th><th>Tarih</th><th>Konu</th><th>Kaynak</th><th>Durum</th><th>Yapılan İşlem</th><th>İşlemler</th></tr></thead><tbody id="complaintTableBody"></tbody></table></div>
        <div id="emptyNote" class="empty-note" style="display:none;">Kayıt bulunamadı.</div>
      </section>
    </main>
  </div>

<div class="modal-overlay" id="newModal">
    <div class="modal modal-complaint-entry">
      <div class="modal-header">
        <div class="modal-header-stack">
          <span>Yeni Şikayet Ekle</span>
          <small>Kayıt bilgilerini düzenli şekilde girin, konu ve mahalleyi seçin.</small>
        </div>
        <button class="close-btn" onclick="closeModal('newModal')">&times;</button>
      </div>
      <div class="modal-body complaint-entry-body">
        <input type="hidden" id="newSubject" value="" />
        <div class="entry-shell">
          <section class="entry-section">
            <div class="entry-section-header">
              <div>
                <div class="entry-section-title">Kayıt Bilgileri</div>
                <div class="entry-section-note">Temel kayıt alanları ve sınıflandırma bilgileri.</div>
              </div>
            </div>
            <div class="entry-grid">
              <div class="form-group">
                <label>Şikayet No</label>
                <input type="text" id="newNo" placeholder="Otomatik oluşturulacak" disabled />
              </div>
              <div class="form-group">
                <label>Tarih *</label>
                <input type="date" id="newDate" />
              </div>
              <div class="form-group">
                <label>Şikayet Kaynağı *</label>
                <select id="newSource">
                  <option value="">Seçiniz</option>
                  <option value="CİMER">CİMER</option>
                  <option value="Şeffaf Masa">Şeffaf Masa</option>
                  <option value="Büro Telefonu">Büro Telefonu</option>
                  <option value="Vatandaş Talebi">Vatandaş Talebi</option>
                </select>
              </div>
              <div class="form-group">
                <label>Şikayete Konu Mahalle</label>
                <select id="newNeighborhood">
                  <option value="">Mahalle seçiniz</option>
                </select>
              </div>
            </div>
          </section>

          <section class="entry-section">
            <div class="entry-section-header">
              <div>
                <div class="entry-section-title">Konu ve Konum</div>
                <div class="entry-section-note">Şikayetin konusu ile adres bilgilerini girin.</div>
              </div>
            </div>
            <div class="entry-grid">
              <div class="form-group full">
                <label>Şikayet Konuları *</label>
                <div class="topic-picker" id="newTopics"></div>
                <div class="topic-help">Bir şikayet içinde birden fazla konu seçebilirsiniz. İstatistikler bu seçimlere göre hesaplanacaktır.</div>
              </div>
              <div class="form-group full">
                <label>Şikayet Adresi</label>
                <textarea id="newAddress" placeholder="Şikayetin yapıldığı adres"></textarea>
              </div>
            </div>
          </section>

          <section class="entry-section">
            <div class="entry-section-header">
              <div>
                <div class="entry-section-title">Açıklama ve İşlem</div>
                <div class="entry-section-note">Detay, işlem, durum ve not alanlarını düzenleyin.</div>
              </div>
            </div>
            <div class="entry-grid">
              <div class="form-group full">
                <label>Şikayet Detayı</label>
                <textarea id="newDetail" placeholder="Şikayet detayını buraya yazın..."></textarea>
              </div>
              <div class="form-group">
                <label>Yapılan İşlem</label>
                <select id="newAction">
                  <option value="Henüz İşlem Yapılmadı">Henüz İşlem Yapılmadı</option>
                  <option value="Uyarıldı">Uyarıldı</option>
                  <option value="İhtar Verildi">İhtar Verildi</option>
                  <option value="Tutanak Tutuldu">Tutanak Tutuldu</option>
                  <option value="Cezai İşlem Yapıldı">Cezai İşlem Yapıldı</option>
                  <option value="Süre Verildi">Süre Verildi</option>
                </select>
              </div>
              <div class="form-group">
                <label>Durum *</label>
                <select id="newStatus">
                  <option value="Açık">Açık</option>
                  <option value="İnceleniyor">İnceleniyor</option>
                  <option value="Süre Verildi">Süre Verildi</option>
                  <option value="Kapatıldı">Kapatıldı</option>
                </select>
              </div>
              <div class="form-group hidden" id="newControlWrap">
                <label>Kontrol Tarihi</label>
                <input type="date" id="newControlDate" />
              </div>
              <div class="form-group full">
                <label>İşlem Açıklaması / Notlar</label>
                <textarea id="newNote" placeholder="Yapılan işlemle ilgili ek notlar..."></textarea>
              </div>
            </div>
          </section>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="closeModal('newModal')">İptal</button>
        <button class="btn btn-warning" onclick="saveNewComplaint()">Kaydet</button>
      </div>
    </div>
  </div>

  <div class="modal-overlay" id="detailModal">
    <div class="modal">
      <div class="modal-header white">
        <span>Şikayet Detayı</span>
        <button class="close-btn" onclick="closeModal('detailModal')">&times;</button>
      </div>
      <div class="modal-body">
        <div class="detail-title">ŞİKAYET DETAYI</div>
        <table class="detail-table">
          <tbody id="detailTableBody"></tbody>
        </table>

        <div class="attachments-section">
          <div class="section-title">Ekler / Belgeler</div>
          <div class="attachments-grid">
            <div class="form-group">
              <label>Dosya Türü</label>
              <select id="detailFileType">
                <option value="photo">Fotoğraf</option>
                <option value="document">Evrak</option>
              </select>
            </div>
            <div class="form-group">
              <label>Kategori</label>
              <select id="detailCategory"></select>
            </div>
            <div class="form-group full">
              <label>Açıklama</label>
              <input type="text" id="detailFileDescription" placeholder="Örn: İlk tespit fotoğrafı / Tutanak örneği" />
            </div>
            <div class="form-group full">
              <label>Dosya Seç</label>
              <input type="file" id="detailFileInput" />
              <div class="muted" id="detailFileHelp" style="margin-top:8px;">Fotoğraf seçildiğinde aynı anda birden fazla dosya yükleyebilirsiniz.</div>
            </div>
          </div>
          <div style="display:flex; justify-content:flex-end; margin-bottom:16px;">
            <button class="btn btn-primary" onclick="uploadDetailFile()">Dosya Yükle</button>
          </div>
          <div id="detailFilesList" class="muted">Henüz ek bulunmuyor.</div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="closeModal('detailModal')">Kapat</button>
        <button class="btn btn-primary" onclick="printComplaintDetailReport()">🖨 Yazdır / PDF</button>
      </div>
    </div>
  </div>

  <div class="modal-overlay" id="editModal">
    <div class="modal">
      <div class="modal-header">
        <span>Şikayet Düzenle</span>
        <button class="close-btn" onclick="closeModal('editModal')">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-grid">
          <div class="form-group">
            <label>Şikayet No</label>
            <input type="text" id="editNo" disabled />
          </div>
          <div class="form-group">
            <label>Tarih *</label>
            <input type="date" id="editDate" />
          </div>
          <input type="hidden" id="editSubject" value="" />
          <div class="form-group">
            <label>Şikayet Kaynağı *</label>
            <select id="editSource">
              <option value="CİMER">CİMER</option>
              <option value="Şeffaf Masa">Şeffaf Masa</option>
              <option value="Büro Telefonu">Büro Telefonu</option>
              <option value="Vatandaş Talebi">Vatandaş Talebi</option>
            </select>
          </div>
          <div class="form-group full">
            <label>Şikayet Konuları *</label>
            <div class="topic-picker" id="editTopics"></div>
            <div class="topic-help">İstatistik ve faaliyet raporları için en az bir konu seçin.</div>
          </div>
          <div class="form-group">
            <label>Şikayete Konu Mahalle</label>
            <select id="editNeighborhood">
              <option value="">Mahalle seçiniz</option>
            </select>
          </div>
          <div class="form-group full">
            <label>Şikayet Adresi</label>
            <textarea id="editAddress"></textarea>
          </div>
          <div class="form-group full">
            <label>Şikayet Detayı</label>
            <textarea id="editDetail"></textarea>
          </div>
          <div class="form-group">
            <label>Yapılan İşlem</label>
            <select id="editAction">
              <option value="Henüz İşlem Yapılmadı">Henüz İşlem Yapılmadı</option>
              <option value="Uyarıldı">Uyarıldı</option>
              <option value="İhtar Verildi">İhtar Verildi</option>
              <option value="Tutanak Tutuldu">Tutanak Tutuldu</option>
              <option value="Cezai İşlem Yapıldı">Cezai İşlem Yapıldı</option>
              <option value="Süre Verildi">Süre Verildi</option>
            </select>
          </div>
          <div class="form-group">
            <label>Durum *</label>
            <select id="editStatus">
              <option value="Açık">Açık</option>
              <option value="İnceleniyor">İnceleniyor</option>
              <option value="Süre Verildi">Süre Verildi</option>
              <option value="Kapatıldı">Kapatıldı</option>
            </select>
          </div>
          <div class="form-group hidden" id="editControlWrap">
            <label>Kontrol Tarihi</label>
            <input type="date" id="editControlDate" />
          </div>
          <div class="form-group full">
            <label>İşlem Açıklaması / Notlar</label>
            <textarea id="editNote"></textarea>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="closeModal('editModal')">İptal</button>
        <button class="btn btn-warning" onclick="saveEditComplaint()">Kaydet</button>
      </div>
    </div>
  </div>

  <div class="modal-overlay" id="topicModal">
    <div class="modal">
      <div class="modal-header white">
        <span>Konu Başlıkları</span>
        <button class="close-btn" onclick="closeModal('topicModal')">&times;</button>
      </div>
      <div class="modal-body">
        <div class="topic-manager-toolbar">
          <div class="form-group" style="margin:0;">
            <label>Yeni Konu Başlığı</label>
            <input type="text" id="topicManagerName" placeholder="Örn: İşporta / Seyyar Satış" />
          </div>
          <div style="display:flex; gap:10px; justify-content:flex-end; flex-wrap:wrap;">
            <button class="btn btn-primary" type="button" onclick="createComplaintTopic()">＋ Konu Ekle</button>
          </div>
        </div>
        <div id="topicManagerList" class="topic-manager-list">
          <div class="muted">Konu listesi yükleniyor...</div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="closeModal('topicModal')">Kapat</button>
      </div>
    </div>
  </div>

  <script>
        var complaints = [];
    var BUCakNeighborhoods = ["Alaattin", "Atilla", "Barbaros", "Camii", "Cumhuriyet", "Çamlıca", "Çavuşlar", "Çukur", "Fatih", "Karayvatlar", "Konak", "Mehmet Akif", "Mimar Sinan", "Oğuzhan", "Onaç", "Pazar", "Sanayi", "Yeni", "Yetmişevler", "Yunus Emre"];
    var complaintTopicDefinitions = [];
    var allComplaintTopicDefinitions = [];
    var editingId = null;
    var activeAlertType = "";
    var detailComplaintId = null;
    var complaintFiles = [];

    var fileCategories = {
      photo: ["Öncesi", "Sonrası", "Genel Saha Fotoğrafı"],
      document: ["Tutanak", "Ceza", "Tebligat", "Savunma", "Diğer Belge"]
    };

    function toggleSidebar(forceOpen) {
      var shouldOpen = typeof forceOpen === "boolean" ? forceOpen : !document.body.classList.contains("sidebar-open");
      document.body.classList.toggle("sidebar-open", shouldOpen);
    }

    function escapeHtml(value) {
      if (value === null || value === undefined) return "";
      return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    function formatFileSize(bytes) {
      var size = Number(bytes || 0);
      if (size < 1024) return size + " B";
      if (size < 1024 * 1024) return (size / 1024).toFixed(1) + " KB";
      return (size / (1024 * 1024)).toFixed(1) + " MB";
    }

    function refreshCategoryOptions() {
      var type = document.getElementById("detailFileType").value;
      var categories = fileCategories[type] || [];
      var html = "";
      var input = document.getElementById("detailFileInput");
      var help = document.getElementById("detailFileHelp");

      for (var i = 0; i < categories.length; i++) {
        html += '<option value="' + escapeHtml(categories[i]) + '">' + escapeHtml(categories[i]) + '</option>';
      }

      document.getElementById("detailCategory").innerHTML = html;

      if (input) {
        input.value = "";
        if (type === "photo") {
          input.multiple = true;
          input.setAttribute("accept", "image/*");
        } else {
          input.multiple = false;
          input.setAttribute("accept", ".pdf,image/*");
        }
      }

      if (help) {
        help.textContent = type === "photo"
          ? "Fotoğraf seçildiğinde aynı anda birden fazla dosya yükleyebilirsiniz."
          : "Evrak yüklemede aynı anda 1 dosya seçebilirsiniz. PDF veya görsel yükleyebilirsiniz.";
      }
    }

    async function loadComplaintFiles(complaintId) {
      try {
        var response = await fetch("/api/complaints/" + complaintId + "/files");
        if (!response.ok) throw new Error();
        complaintFiles = await response.json();
        renderComplaintFiles();
      } catch (error) {
        document.getElementById("detailFilesList").innerHTML = '<div class="muted">Ekler yüklenemedi.</div>';
      }
    }

    function buildAttachmentCard(file) {
      var html = '';
      html += '<div class="attachment-card">';

      if (file.isImage) {
        html += '<a class="attachment-thumb" href="' + encodeURI(file.url) + '" target="_blank" rel="noopener noreferrer">';
        html += '<img src="' + encodeURI(file.url) + '" alt="Ek görseli" />';
        html += '</a>';
      } else {
        html += '<a class="attachment-thumb-doc" href="' + encodeURI(file.url) + '" target="_blank" rel="noopener noreferrer" title="Belgeyi Aç">📄</a>';
      }

      html += '<div class="attachment-content">';
      html += '<div class="attachment-topline">';
      html += '<div class="attachment-name">' + escapeHtml(file.originalName) + '</div>';
      html += '<div class="attachment-date">' + escapeHtml(file.createdAt || '-') + '</div>';
      html += '</div>';
      html += '<div class="attachment-tags">';
      html += '<span class="attachment-tag">' + escapeHtml(file.category || '-') + '</span>';
      html += '<span class="attachment-tag">' + escapeHtml(file.fileType === "photo" ? "Fotoğraf" : "Evrak") + '</span>';
      html += '</div>';
      html += '<div class="attachment-description"><strong>Açıklama:</strong> ' + escapeHtml(file.description || '-') + '</div>';
      html += '<div class="attachment-bottom">';
      html += '<div class="attachment-size">Boyut: ' + escapeHtml(formatFileSize(file.fileSize)) + '</div>';
      html += '<div class="attachment-actions">';
      html += '<a class="btn btn-info" href="' + encodeURI(file.url) + '" target="_blank" rel="noopener noreferrer" style="text-decoration:none; display:inline-flex; align-items:center;">Aç</a>';
      html += '<button class="btn btn-danger" onclick="deleteComplaintFile(' + file.id + ')">Sil</button>';
      html += '</div>';
      html += '</div>';
      html += '</div>';
      html += '</div>';

      return html;
    }

    function renderAttachmentGroup(title, files, emptyText) {
      var html = '';
      html += '<div class="attachment-group">';
      html += '<div class="attachment-group-header">';
      html += '<div class="attachment-group-title">' + escapeHtml(title) + '</div>';
      html += '<div class="attachment-group-count">' + files.length + ' adet</div>';
      html += '</div>';

      if (!files.length) {
        html += '<div class="muted">' + escapeHtml(emptyText) + '</div>';
      } else {
        html += '<div class="attachment-group-grid">';
        for (var i = 0; i < files.length; i++) {
          html += buildAttachmentCard(files[i]);
        }
        html += '</div>';
      }

      html += '</div>';
      return html;
    }

    function renderComplaintFiles() {
      var target = document.getElementById("detailFilesList");
      if (!target) return;

      if (!complaintFiles.length) {
        target.innerHTML = '<div class="muted">Henüz ek bulunmuyor.</div>';
        return;
      }

      var photoFiles = complaintFiles.filter(function(file) { return file.fileType === "photo"; });
      var documentFiles = complaintFiles.filter(function(file) { return file.fileType === "document"; });

      var html = '<div class="attachment-groups">';
      html += renderAttachmentGroup('Fotoğraflar', photoFiles, 'Henüz fotoğraf eklenmemiş.');
      html += renderAttachmentGroup('Evraklar', documentFiles, 'Henüz evrak eklenmemiş.');
      html += '</div>';

      target.innerHTML = html;
    }

    function getComplaintStatusTone(status) {
      if (status === "Kapatıldı") return "ok";
      if (status === "Süre Verildi") return "warn";
      if (status === "İnceleniyor") return "info";
      return "neutral";
    }

    function buildComplaintAttachmentRows(files) {
      if (!files.length) {
        return '<tr><td colspan="5">Bu kayda ait ek bulunmuyor.</td></tr>';
      }

      return files.map(function(file, index) {
        return '<tr>' +
          '<td>' + (index + 1) + '</td>' +
          '<td><strong>' + escapeHtml(file.originalName || '-') + '</strong></td>' +
          '<td>' + escapeHtml(file.fileType === "photo" ? "Fotoğraf" : "Evrak") + '</td>' +
          '<td>' + escapeHtml(file.category || '-') + '<div class="sub">' + escapeHtml(file.createdAt || '-') + '</div></td>' +
          '<td>' + escapeHtml(file.description || '-') + '</td>' +
        '</tr>';
      }).join('');
    }

    function printComplaintDetailReport() {
      if (!detailComplaintId) {
        alert('Önce bir şikayet detayı açılmalıdır.');
        return;
      }

      var item = getComplaintById(detailComplaintId);
      if (!item) {
        alert('Şikayet kaydı bulunamadı.');
        return;
      }

      var photoFiles = complaintFiles.filter(function(file) { return file.fileType === "photo"; });
      var documentFiles = complaintFiles.filter(function(file) { return file.fileType === "document"; });
      var statusTone = getComplaintStatusTone(item.status);
      var nowText = new Date().toLocaleString('tr-TR');
      var topicNames = getTopicNames(item) || '-';
      var attachmentRows = buildComplaintAttachmentRows(complaintFiles);
      var timelineRows = [
        { label: 'Kayıt Tarihi', value: item.displayDate || '-' },
        { label: 'İşlem Tarihi', value: item.processDateText || '-' },
        { label: 'Kontrol Tarihi', value: item.controlDateText || '-' },
        { label: 'Kapatma Tarihi', value: item.closedDateText || '-' },
        { label: 'Sisteme Kayıt Zamanı', value: item.createdAt || '-' }
      ].map(function(entry) {
        return '<div class="meta-card"><div class="meta-label">' + escapeHtml(entry.label) + '</div><div class="meta-value">' + escapeHtml(entry.value) + '</div></div>';
      }).join('');

      var reportHtml = '<!DOCTYPE html><html lang="tr"><head><meta charset="UTF-8"><title>Şikayet Detay Raporu</title><style>' +
        'body{font-family:Inter,Segoe UI,Arial,sans-serif;margin:0;padding:28px;color:#17202f;background:#fff;} ' +
        '.report{max-width:1100px;margin:0 auto;} .top{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;border-bottom:2px solid #e5e7eb;padding-bottom:14px;margin-bottom:18px;} ' +
        '.title{font-size:28px;font-weight:800;letter-spacing:-0.03em;margin:0;} .subtitle{margin-top:6px;color:#667085;font-size:13px;line-height:1.6;} .meta{display:grid;gap:6px;font-size:13px;color:#334155;text-align:right;} ' +
        '.summary-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:18px 0 22px;} ' +
        '.summary-card{border:1px solid #dbe3ee;border-radius:14px;padding:14px;background:#f8fafc;} .summary-card.ok{background:#effcf3;border-color:#bbf7d0;color:#166534;} .summary-card.warn{background:#fffbeb;border-color:#fde68a;color:#92400e;} .summary-card.info{background:#eff6ff;border-color:#bfdbfe;color:#1d4ed8;} .summary-card.neutral{background:#f8fafc;border-color:#dbe3ee;color:#334155;} ' +
        '.summary-label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;opacity:.8;} .summary-value{font-size:24px;font-weight:800;margin-top:8px;line-height:1.25;} ' +
        '.meta-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 12px;margin:0 0 20px;} .meta-card{border:1px solid #dbe3ee;border-radius:14px;padding:12px;background:#f8fafc;} .meta-label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#667085;margin-bottom:6px;} .meta-value{font-size:14px;font-weight:600;color:#111827;line-height:1.5;word-break:break-word;} ' +
        '.section{margin-top:18px;} .section-title{font-size:17px;font-weight:800;margin:0 0 10px;} .content-card{border:1px solid #dbe3ee;border-radius:14px;padding:14px;background:#fff;margin-bottom:10px;} .content-label{font-size:12px;font-weight:800;color:#475569;margin-bottom:6px;} .content-value{font-size:13px;line-height:1.7;color:#17202f;white-space:pre-wrap;word-break:break-word;} ' +
        'table{width:100%;border-collapse:collapse;table-layout:fixed;} th,td{border:1px solid #dbe3ee;padding:10px 12px;font-size:12px;vertical-align:top;word-break:break-word;} th{background:#f8fafc;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#667085;} .sub{font-size:11px;color:#64748b;margin-top:4px;} ' +
        '@page{size:A4 portrait;margin:12mm;} @media print{body{padding:0;} .report{max-width:none;}}' +
        '</style></head><body><div class="report">' +
        '<div class="top"><div><h1 class="title">Şikayet Detay Raporu</h1><div class="subtitle">Seçili şikayet kaydının özet bilgileri, işlem durumu ve ekleri bu raporda düzenli şekilde gösterilir.</div></div><div class="meta"><div><strong>Şikayet No:</strong> ' + escapeHtml(item.no || '-') + '</div><div><strong>Rapor Tarihi:</strong> ' + escapeHtml(nowText) + '</div><div><strong>Kayıt Tarihi:</strong> ' + escapeHtml(item.displayDate || '-') + '</div></div></div>' +
        '<div class="summary-grid">' +
          '<div class="summary-card ' + statusTone + '"><div class="summary-label">Durum</div><div class="summary-value">' + escapeHtml(item.status || '-') + '</div></div>' +
          '<div class="summary-card neutral"><div class="summary-label">Yapılan İşlem</div><div class="summary-value">' + escapeHtml(item.action || '-') + '</div></div>' +
          '<div class="summary-card info"><div class="summary-label">Konu Başlığı</div><div class="summary-value">' + escapeHtml(String((item.topics || []).length || 0)) + '</div></div>' +
          '<div class="summary-card warn"><div class="summary-label">Toplam Ek</div><div class="summary-value">' + escapeHtml(String(complaintFiles.length || 0)) + '</div></div>' +
        '</div>' +
        '<div class="meta-grid">' +
          '<div class="meta-card"><div class="meta-label">Konu Başlıkları</div><div class="meta-value">' + escapeHtml(topicNames) + '</div></div>' +
          '<div class="meta-card"><div class="meta-label">Şikayet Kaynağı</div><div class="meta-value">' + escapeHtml(item.source || '-') + '</div></div>' +
          '<div class="meta-card"><div class="meta-label">Mahalle</div><div class="meta-value">' + escapeHtml(item.neighborhood || '-') + '</div></div>' +
          '<div class="meta-card"><div class="meta-label">Fotoğraf Sayısı</div><div class="meta-value">' + escapeHtml(String(photoFiles.length || 0)) + '</div></div>' +
          '<div class="meta-card"><div class="meta-label">Evrak Sayısı</div><div class="meta-value">' + escapeHtml(String(documentFiles.length || 0)) + '</div></div>' +
        '</div>' +
        '<div class="section"><h2 class="section-title">Şikayet İçeriği</h2>' +
          (item.subject && item.subject !== topicNames ? '<div class="content-card"><div class="content-label">Kısa Başlık / Özet</div><div class="content-value">' + escapeHtml(item.subject || '-') + '</div></div>' : '') +
          '<div class="content-card"><div class="content-label">Şikayet Adresi</div><div class="content-value">' + escapeHtml(item.address || '-') + '</div></div>' +
          '<div class="content-card"><div class="content-label">Şikayet Detayı</div><div class="content-value">' + escapeHtml(item.detail || '-') + '</div></div>' +
          '<div class="content-card"><div class="content-label">İşlem Açıklaması / Notlar</div><div class="content-value">' + escapeHtml(item.note || '-') + '</div></div>' +
        '</div>' +
        '<div class="section"><h2 class="section-title">Tarihçe</h2><div class="meta-grid">' + timelineRows + '</div></div>' +
        '<div class="section"><h2 class="section-title">Ekler Özeti</h2><table><thead><tr><th style="width:6%">#</th><th style="width:29%">Dosya</th><th style="width:14%">Tür</th><th style="width:20%">Kategori / Tarih</th><th style="width:31%">Açıklama</th></tr></thead><tbody>' + attachmentRows + '</tbody></table></div>' +
        '</div></body></html>';

      var printWindow = window.open('', '_blank', 'width=1200,height=900');
      if (!printWindow) {
        alert('Yazdırma penceresi açılamadı. Tarayıcı açılır pencere engelini kontrol edin.');
        return;
      }
      printWindow.document.open();
      printWindow.document.write(reportHtml);
      printWindow.document.close();
      printWindow.focus();
      printWindow.onload = function() {
        printWindow.print();
      };
    }

    async function uploadDetailFile() {
      if (!detailComplaintId) return;

      var fileInput = document.getElementById("detailFileInput");
      var fileType = document.getElementById("detailFileType").value;
      var selectedFiles = fileInput.files ? Array.from(fileInput.files) : [];

      if (!selectedFiles.length) {
        alert("Lütfen dosya seçin.");
        return;
      }

      if (fileType === "document" && selectedFiles.length > 1) {
        alert("Evrak yüklemede aynı anda sadece 1 dosya seçebilirsiniz.");
        return;
      }

      var formData = new FormData();
      for (var i = 0; i < selectedFiles.length; i++) {
        formData.append("files", selectedFiles[i]);
      }
      formData.append("fileType", fileType);
      formData.append("category", document.getElementById("detailCategory").value);
      formData.append("description", document.getElementById("detailFileDescription").value.trim());

      try {
        var response = await fetch("/api/complaints/" + detailComplaintId + "/files", {
          method: "POST",
          body: formData
        });

        var result = await response.json();
        if (!response.ok) {
          throw new Error(result.error || "Dosya yüklenemedi.");
        }

        document.getElementById("detailFileInput").value = "";
        document.getElementById("detailFileDescription").value = "";
        await loadComplaintFiles(detailComplaintId);
      } catch (error) {
        alert(error.message || "Dosya yüklenemedi.");
      }
    }

    async function deleteComplaintFile(fileId) {
      var ok = confirm("Bu eki silmek istiyor musunuz?");
      if (!ok) return;

      try {
        var response = await fetch("/api/complaint-files/" + fileId, {
          method: "DELETE"
        });

        if (!response.ok) throw new Error();
        await loadComplaintFiles(detailComplaintId);
      } catch (error) {
        alert("Ek silinemedi.");
      }
    }

    function todayInputDate() {
      var now = new Date();
      var yyyy = now.getFullYear();
      var mm = String(now.getMonth() + 1).padStart(2, "0");
      var dd = String(now.getDate()).padStart(2, "0");
      return yyyy + "-" + mm + "-" + dd;
    }

    function setTodayText() {
      var now = new Date();
      var text = new Intl.DateTimeFormat("tr-TR", {
        day: "numeric",
        month: "long",
        year: "numeric",
        weekday: "long"
      }).format(now);
      document.getElementById("todayText").textContent = text;
    }

    function getComplaintNeighborhoodOptionsHtml(selectedValue) {
      var current = String(selectedValue || "").trim();
      var html = '<option value="">Mahalle seçiniz</option>';;
      for (var i = 0; i < BUCakNeighborhoods.length; i++) {
        var name = BUCakNeighborhoods[i];
        var selected = current === name ? ' selected' : '';
        html += '<option value="' + escapeHtml(name) + '"' + selected + '>' + escapeHtml(name) + '</option>';;
      }
      return html;
    }

    function populateComplaintNeighborhoodSelects(newValue, editValue) {
      var newSelect = document.getElementById("newNeighborhood");
      var editSelect = document.getElementById("editNeighborhood");
      if (newSelect) newSelect.innerHTML = getComplaintNeighborhoodOptionsHtml(newValue || "");
      if (editSelect) editSelect.innerHTML = getComplaintNeighborhoodOptionsHtml(editValue || "");
    }

    async function fillNextComplaintNoPreview() {
      var input = document.getElementById("newNo");
      if (!input) return;
      input.value = "Şikayet numarası hazırlanıyor...";
      try {
        var response = await fetch("/api/complaints/next-no");
        if (!response.ok) throw new Error();
        var result = await response.json();
        input.value = result && result.complaintNo ? result.complaintNo : "Otomatik oluşturulacak";
      } catch (error) {
        input.value = "Otomatik oluşturulacak";
      }
    }

    function getStatusBadge(item) {
      var status = item.status;
      var today = todayInputDate();

      if (status === "Süre Verildi" && item.controlDate) {
        if (item.controlDate < today) {
          return '<span class="badge badge-overdue">🔴 Kontrol Gecikti</span>';
        }
        if (item.controlDate === today) {
          return '<span class="badge badge-due-today">🟠 Bugün Kontrol</span>';
        }
      }

      if (status === "Açık") {
        return '<span class="badge badge-open">🟡 Açık</span>';
      }
      if (status === "İnceleniyor") {
        return '<span class="badge badge-review">🔵 İnceleniyor</span>';
      }
      if (status === "Süre Verildi") {
        return '<span class="badge badge-deadline">🟠 Süre Verildi</span>';
      }
      return '<span class="badge badge-closed">🟢 Kapatıldı</span>';
    }

    function sourceBadge(source) {
      return '<span class="badge badge-source">' + escapeHtml(source) + '</span>';
    }

    function updateCards(data) {
      var openCount = 0;
      var reviewCount = 0;
      var closedCount = 0;
      var dueTodayCount = 0;
      var overdueCount = 0;
      var today = todayInputDate();

      for (var i = 0; i < data.length; i++) {
        if (data[i].status === "Açık") {
          openCount++;
        } else if (data[i].status === "İnceleniyor" || data[i].status === "Süre Verildi") {
          reviewCount++;
        } else if (data[i].status === "Kapatıldı") {
          closedCount++;
        }

        if (data[i].status === "Süre Verildi" && data[i].controlDate) {
          if (data[i].controlDate === today) {
            dueTodayCount++;
          } else if (data[i].controlDate < today) {
            overdueCount++;
          }
        }
      }

      document.getElementById("openCount").textContent = openCount;
      document.getElementById("reviewCount").textContent = reviewCount;
      document.getElementById("closedCount").textContent = closedCount;
      document.getElementById("totalCount").textContent = data.length;
      document.getElementById("dueTodayCount").textContent = dueTodayCount;
      document.getElementById("overdueCount").textContent = overdueCount;
    }

    function getComplaintById(id) {
      for (var i = 0; i < complaints.length; i++) {
        if (complaints[i].id === id) {
          return complaints[i];
        }
      }
      return null;
    }

    function toggleNewControlDate() {
      var status = document.getElementById("newStatus").value;
      var wrap = document.getElementById("newControlWrap");

      if (status === "Süre Verildi") {
        wrap.classList.remove("hidden");
      } else {
        wrap.classList.add("hidden");
        document.getElementById("newControlDate").value = "";
      }
    }

    function toggleEditControlDate() {
      var status = document.getElementById("editStatus").value;
      var wrap = document.getElementById("editControlWrap");

      if (status === "Süre Verildi") {
        wrap.classList.remove("hidden");
      } else {
        wrap.classList.add("hidden");
        document.getElementById("editControlDate").value = "";
      }
    }

    async function loadComplaintTopics() {
      try {
        var response = await fetch("/api/complaint-topics");
        if (!response.ok) throw new Error();
        complaintTopicDefinitions = await response.json();
      } catch (error) {
        complaintTopicDefinitions = [];
      }

      try {
        var allResponse = await fetch("/api/complaint-topics?all=1");
        if (!allResponse.ok) throw new Error();
        allComplaintTopicDefinitions = await allResponse.json();
      } catch (error) {
        allComplaintTopicDefinitions = complaintTopicDefinitions.slice();
      }

      renderTopicPicker("newTopics", getSelectedTopicIds("newTopics"));
      renderTopicPicker("editTopics", getSelectedTopicIds("editTopics"));
      renderTopicManagerList();
    }

    function getComplaintTopicDefinitionById(topicId) {
      var numericId = Number(topicId);
      for (var i = 0; i < allComplaintTopicDefinitions.length; i++) {
        if (Number(allComplaintTopicDefinitions[i].id) === numericId) return allComplaintTopicDefinitions[i];
      }
      for (var j = 0; j < complaintTopicDefinitions.length; j++) {
        if (Number(complaintTopicDefinitions[j].id) === numericId) return complaintTopicDefinitions[j];
      }
      return null;
    }

    function renderTopicPicker(containerId, selectedIds) {
      var container = document.getElementById(containerId);
      if (!container) return;

      var normalized = Array.isArray(selectedIds) ? selectedIds : [];
      var orderedIds = [];
      var seenMap = {};
      for (var i = 0; i < normalized.length; i++) {
        var numericId = Number(normalized[i]);
        if (!Number.isInteger(numericId) || numericId <= 0) continue;
        if (seenMap[String(numericId)]) continue;
        seenMap[String(numericId)] = true;
        orderedIds.push(numericId);
      }

      var optionHtml = '<option value="">Konu seçiniz...</option>';
      for (var j = 0; j < complaintTopicDefinitions.length; j++) {
        var topic = complaintTopicDefinitions[j];
        optionHtml += '<option value="' + String(topic.id) + '">' + escapeHtml(topic.name) + '</option>';
      }

      var html = '';
      html += '<div class="topic-select-row" style="display:grid;grid-template-columns:minmax(0,1fr);gap:10px;">';
      html += '<select data-role="topic-select" style="width:100%;min-height:48px;border:1px solid #cfd8e4;border-radius:12px;background:#ffffff;padding:12px 14px;font-size:14px;color:#17202f;">';
      html += optionHtml;
      html += '</select>';
      html += '</div>';
      html += '<input type="hidden" data-role="topic-selected" value="' + orderedIds.join(',') + '" />';
      html += '<div class="topic-tags" data-role="topic-tags" style="display:flex;flex-wrap:wrap;gap:8px;"></div>';
      container.innerHTML = html;

      var select = container.querySelector('[data-role="topic-select"]');
      if (select) {
        select.addEventListener('change', function() {
          var value = Number(this.value);
          if (!Number.isInteger(value) || value <= 0) return;
          var ids = getSelectedTopicIds(containerId);
          var exists = false;
          for (var k = 0; k < ids.length; k++) {
            if (Number(ids[k]) === value) {
              exists = true;
              break;
            }
          }
          if (!exists) ids.push(value);
          setSelectedTopicIds(containerId, ids);
          this.value = '';
        });
      }

      updateTopicPickerState(containerId);
    }

    function setSelectedTopicIds(containerId, ids) {
      var container = document.getElementById(containerId);
      if (!container) return;
      var hiddenInput = container.querySelector('[data-role="topic-selected"]');
      if (!hiddenInput) return;

      var orderedIds = [];
      var seenMap = {};
      var values = Array.isArray(ids) ? ids : [];
      for (var i = 0; i < values.length; i++) {
        var numericId = Number(values[i]);
        if (!Number.isInteger(numericId) || numericId <= 0) continue;
        if (seenMap[String(numericId)]) continue;
        seenMap[String(numericId)] = true;
        orderedIds.push(numericId);
      }

      hiddenInput.value = orderedIds.join(',');
      updateTopicPickerState(containerId);
    }

    function toggleTopicDropdown(containerId) {
      return;
    }

    function closeAllTopicDropdowns(exceptId) {
      return;
    }

    function filterTopicOptions(containerId, query) {
      return;
    }

    function updateTopicPickerState(containerId) {
      var container = document.getElementById(containerId);
      if (!container) return;

      var ids = getSelectedTopicIds(containerId);
      var tags = container.querySelector('[data-role="topic-tags"]');
      var select = container.querySelector('[data-role="topic-select"]');
      if (!tags) return;

      if (select && select.options) {
        for (var i = 0; i < select.options.length; i++) {
          var optionValue = Number(select.options[i].value);
          if (!Number.isInteger(optionValue) || optionValue <= 0) {
            select.options[i].disabled = false;
            continue;
          }
          var selected = false;
          for (var j = 0; j < ids.length; j++) {
            if (Number(ids[j]) === optionValue) {
              selected = true;
              break;
            }
          }
          select.options[i].disabled = selected;
        }
      }

      if (!ids.length) {
        tags.innerHTML = '<span class="muted" style="font-size:12px;">Henüz konu seçilmedi.</span>';
        return;
      }

      var html = '';
      for (var k = 0; k < ids.length; k++) {
        var topic = getComplaintTopicDefinitionById(ids[k]);
        if (!topic) continue;
        var label = topic.name + (topic.isActive ? '' : ' (pasif)');
        html += '<span class="topic-tag" style="display:inline-flex;align-items:center;gap:8px;border-radius:999px;background:#edf2ff;color:#1f3b7a;padding:6px 10px;font-size:12px;font-weight:700;">';
        html += '<span>' + escapeHtml(label) + '</span>';
        html += '<button type="button" data-remove-topic="' + String(topic.id) + '" style="border:none;background:transparent;color:#1f3b7a;font-size:14px;line-height:1;cursor:pointer;padding:0;">×</button>';
        html += '</span>';
      }
      tags.innerHTML = html;

      var removeButtons = tags.querySelectorAll('[data-remove-topic]');
      for (var m = 0; m < removeButtons.length; m++) {
        removeButtons[m].addEventListener('click', function(event) {
          event.preventDefault();
          event.stopPropagation();
          var removeId = Number(this.getAttribute('data-remove-topic'));
          var currentIds = getSelectedTopicIds(containerId);
          var nextIds = [];
          for (var n = 0; n < currentIds.length; n++) {
            if (Number(currentIds[n]) !== removeId) nextIds.push(Number(currentIds[n]));
          }
          setSelectedTopicIds(containerId, nextIds);
        });
      }
    }

    function getSelectedTopicIds(containerId) {
      var container = document.getElementById(containerId);
      if (!container) return [];

      var hiddenInput = container.querySelector('[data-role="topic-selected"]');
      if (!hiddenInput || !hiddenInput.value) return [];

      var parts = String(hiddenInput.value).split(',');
      var ids = [];
      var seenMap = {};
      for (var i = 0; i < parts.length; i++) {
        var numericId = Number(parts[i]);
        if (!Number.isInteger(numericId) || numericId <= 0) continue;
        if (seenMap[String(numericId)]) continue;
        seenMap[String(numericId)] = true;
        ids.push(numericId);
      }
      return ids;
    }

    function renderTopicManagerList() {
      var list = document.getElementById('topicManagerList');
      if (!list) return;

      if (!allComplaintTopicDefinitions.length) {
        list.innerHTML = '<div class="muted">Henüz konu başlığı bulunmuyor.</div>';
        return;
      }

      var html = '';
      for (var i = 0; i < allComplaintTopicDefinitions.length; i++) {
        var topic = allComplaintTopicDefinitions[i];
        html += '<div class="topic-manager-item">';
        html += '<input type="text" id="topicEditName_' + String(topic.id) + '" value="' + escapeHtml(topic.name) + '" />';
        html += '<span class="topic-status-badge ' + (topic.isActive ? 'active' : 'passive') + '">' + (topic.isActive ? 'Aktif' : 'Pasif') + '</span>';
        html += '<div style="display:flex; gap:8px; justify-content:flex-end; flex-wrap:wrap;">';
        html += '<button class="btn btn-secondary" type="button" onclick="toggleComplaintTopicStatus(' + String(topic.id) + ', ' + String(topic.isActive ? 'false' : 'true') + ')">' + (topic.isActive ? 'Pasif Yap' : 'Aktif Yap') + '</button>';
        html += '<button class="btn btn-primary" type="button" onclick="renameComplaintTopic(' + String(topic.id) + ')">Kaydet</button>';
        html += '</div>';
        html += '</div>';
      }
      list.innerHTML = html;
    }

    function openTopicManager() {
      document.getElementById('topicModal').classList.add('show');
      var input = document.getElementById('topicManagerName');
      if (input) input.value = '';
      loadComplaintTopics();
    }

    async function createComplaintTopic() {
      var input = document.getElementById('topicManagerName');
      var name = input ? input.value.trim() : '';
      if (!name) {
        alert('Yeni konu adı girmeniz gerekiyor.');
        return;
      }

      try {
        var response = await fetch('/api/complaint-topics', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name })
        });
        var payload = null;
        try { payload = await response.json(); } catch (error) {}
        if (!response.ok) throw new Error(payload && payload.error ? payload.error : 'Konu eklenemedi.');
        input.value = '';
        await loadComplaintTopics();
      } catch (error) {
        alert(error.message || 'Konu eklenemedi.');
      }
    }

    async function renameComplaintTopic(id) {
      var input = document.getElementById('topicEditName_' + String(id));
      var name = input ? input.value.trim() : '';
      if (!name) {
        alert('Konu adı boş olamaz.');
        return;
      }

      try {
        var response = await fetch('/api/complaint-topics/' + id, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name })
        });
        var payload = null;
        try { payload = await response.json(); } catch (error) {}
        if (!response.ok) throw new Error(payload && payload.error ? payload.error : 'Konu güncellenemedi.');
        await loadComplaintTopics();
      } catch (error) {
        alert(error.message || 'Konu güncellenemedi.');
      }
    }

    async function toggleComplaintTopicStatus(id, nextState) {
      try {
        var response = await fetch('/api/complaint-topics/' + id, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isActive: !!nextState })
        });
        var payload = null;
        try { payload = await response.json(); } catch (error) {}
        if (!response.ok) throw new Error(payload && payload.error ? payload.error : 'Konu durumu güncellenemedi.');
        await loadComplaintTopics();
      } catch (error) {
        alert(error.message || 'Konu durumu güncellenemedi.');
      }
    }

function getTopicNames(item) {
      if (!item) return '';
      if (Array.isArray(item.topics) && item.topics.length) {
        var names = [];
        for (var i = 0; i < item.topics.length; i++) {
          if (item.topics[i] && item.topics[i].name) names.push(item.topics[i].name);
        }
        return names.join(', ');
      }
      return item.topicNames || '';
    }

    async function loadComplaints() {
      try {
        var response = await fetch("/api/complaints");
        if (!response.ok) throw new Error();
        complaints = await response.json();
        renderTable();
      } catch (error) {
        alert("Kayıtlar yüklenemedi.");
      }
    }

    function renderControlAlerts() {
      var panel = document.getElementById("controlAlertsPanel");
      var list = document.getElementById("controlAlertsList");
      var today = todayInputDate();
      var dueToday = [];
      var overdue = [];

      for (var i = 0; i < complaints.length; i++) {
        var item = complaints[i];
        if (item.status === "Süre Verildi" && item.controlDate) {
          if (item.controlDate === today) {
            dueToday.push(item);
          } else if (item.controlDate < today) {
            overdue.push(item);
          }
        }
      }

      if (!activeAlertType) {
        panel.style.display = "none";
        list.innerHTML = "";
        return;
      }

      var rows = activeAlertType === "overdue" ? overdue : dueToday;
      var html = "";

      if (rows.length === 0) {
        html = '<div class="alert-empty">' + (activeAlertType === "overdue" ? 'Geciken kontrol kaydı bulunmuyor.' : 'Bugün kontrol edilecek kayıt bulunmuyor.') + '</div>';
      } else {
        html += '<div class="alert-group-title ' + (activeAlertType === "overdue" ? 'overdue' : 'today') + '">';
        html += activeAlertType === "overdue" ? 'Geciken kontroller' : 'Bugün kontrol edilecekler';
        html += '</div><div class="alert-list">';
        for (var j = 0; j < rows.length; j++) {
          html += '<div class="alert-item ' + (activeAlertType === "overdue" ? 'overdue' : 'today') + '">';
          html += '<div><div class="alert-item-title">' + escapeHtml(rows[j].no) + ' - ' + escapeHtml(rows[j].subject) + '</div>';
          html += '<div class="alert-item-meta">Kontrol Tarihi: ' + escapeHtml(rows[j].controlDateText || '-') + '</div></div>';
          html += '<button class="btn ' + (activeAlertType === "overdue" ? 'btn-danger' : 'btn-warning') + '" type="button" onclick="openDetail(' + rows[j].id + ')">İlgili Kayda Git</button>';
          html += '</div>';
        }
        html += '</div>';
      }

      panel.style.display = "block";
      list.innerHTML = html;
    }

    function toggleAlertPanel(type) {
  var dueTodayCard = document.getElementById("dueTodayCard");
  var overdueCard = document.getElementById("overdueCard");

  if (activeAlertType === type) {
    activeAlertType = "";
  } else {
    activeAlertType = type;
  }

  dueTodayCard.classList.remove("active-card");
  overdueCard.classList.remove("active-card-warning");

  if (activeAlertType === "today") {
    dueTodayCard.classList.add("active-card");
  }

  if (activeAlertType === "overdue") {
    overdueCard.classList.add("active-card-warning");
  }

  renderControlAlerts();
}

    function renderTable() {
      var tbody = document.getElementById("complaintTableBody");
      var emptyNote = document.getElementById("emptyNote");
      var filterDate = document.getElementById("filterDate").value;
      var filterSource = document.getElementById("filterSource").value;
      var filterStatus = document.getElementById("filterStatus").value;
      var searchText = document.getElementById("searchInput").value.toLowerCase().trim();

      var filtered = complaints.filter(function(item) {
        var dateMatch = !filterDate || item.date === filterDate;
        var sourceMatch = !filterSource || item.source === filterSource;
        var statusMatch = !filterStatus || item.status === filterStatus;
        var topicNames = getTopicNames(item).toLowerCase();
        var neighborhoodText = String(item.neighborhood || "").toLowerCase();
        var subjectText = String(item.subject || "").toLowerCase();
        var searchMatch =
          !searchText ||
          item.no.toLowerCase().indexOf(searchText) > -1 ||
          subjectText.indexOf(searchText) > -1 ||
          topicNames.indexOf(searchText) > -1 ||
          neighborhoodText.indexOf(searchText) > -1;

        return dateMatch && sourceMatch && statusMatch && searchMatch;
      });

      updateCards(complaints);
      renderControlAlerts();

      if (filtered.length === 0) {
        tbody.innerHTML = "";
        emptyNote.style.display = "block";
        return;
      }

      emptyNote.style.display = "none";

      var rows = "";
      for (var i = 0; i < filtered.length; i++) {
        var item = filtered[i];
        rows += "<tr>";
        rows += '<td class="complaint-no">' + escapeHtml(item.no) + "</td>";
        rows += "<td>" + escapeHtml(item.displayDate) + "</td>";
        var topicLabel = getTopicNames(item) || item.subject || "-";
        rows += "<td><div class='stack'><div class='cell-title compact'>" + escapeHtml(topicLabel) + "</div>";
        if (item.subject && getTopicNames(item) && item.subject !== getTopicNames(item)) {
          rows += "<div class='cell-sub'>Özet: " + escapeHtml(item.subject) + "</div>";
        }
        rows += "</div></td>";
        rows += "<td>" + sourceBadge(item.source) + "</td>";
        rows += "<td>" + getStatusBadge(item) + "</td>";
        rows += "<td>" + escapeHtml(item.action) + "</td>";
        rows += '<td><div class="actions">';
        rows += '<button class="icon-btn view-btn" onclick="openDetail(' + item.id + ')">👁</button>';
        rows += '<button class="icon-btn edit-btn" onclick="openEdit(' + item.id + ')">✎</button>';
        rows += '<button class="icon-btn delete-btn" onclick="deleteComplaint(' + item.id + ')">🗑</button>';
        rows += "</div></td>";
        rows += "</tr>";
      }

      tbody.innerHTML = rows;
    }

    async function openNewModal() {
      document.getElementById("newNo").value = "Şikayet numarası hazırlanıyor...";
      document.getElementById("newDate").value = todayInputDate();
      document.getElementById("newSubject").value = "";
      document.getElementById("newSource").value = "";
      renderTopicPicker("newTopics", []);
      populateComplaintNeighborhoodSelects("", document.getElementById("editNeighborhood") ? document.getElementById("editNeighborhood").value : "");
      document.getElementById("newAddress").value = "";
      document.getElementById("newDetail").value = "";
      document.getElementById("newAction").value = "Henüz İşlem Yapılmadı";
      document.getElementById("newStatus").value = "Açık";
      document.getElementById("newControlDate").value = "";
      document.getElementById("newNote").value = "";
      toggleNewControlDate();
      document.getElementById("newModal").classList.add("show");
      await fillNextComplaintNoPreview();
    }

    function closeModal(id) {
      document.getElementById(id).classList.remove("show");
      if (id === "detailModal") {
        detailComplaintId = null;
        complaintFiles = [];
      }
    }

    async function saveNewComplaint() {
      var date = document.getElementById("newDate").value;
      var subject = document.getElementById("newSubject").value.trim();
      var source = document.getElementById("newSource").value;
      var topicIds = getSelectedTopicIds("newTopics");
      var neighborhood = document.getElementById("newNeighborhood").value;
      var address = document.getElementById("newAddress").value.trim();
      var detail = document.getElementById("newDetail").value.trim();
      var action = document.getElementById("newAction").value;
      var status = document.getElementById("newStatus").value;
      var controlDate = document.getElementById("newControlDate").value;
      var note = document.getElementById("newNote").value.trim();

      if (!date || !source || topicIds.length === 0) {
        alert("Tarih, kaynak ve en az bir şikayet konusu seçmeniz gerekiyor.");
        return;
      }

      if (status === "Süre Verildi" && !controlDate) {
        alert("Süre Verildi durumunda Kontrol Tarihi girmeniz gerekiyor.");
        return;
      }

      try {
        var response = await fetch("/api/complaints", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            date: date,
            subject: subject,
            source: source,
            topicIds: topicIds,
            neighborhood: neighborhood,
            address: address,
            detail: detail,
            action: action,
            status: status,
            controlDate: controlDate,
            note: note
          })
        });

        if (!response.ok) throw new Error();

        closeModal("newModal");
        await loadComplaints();
      } catch (error) {
        alert("Kayıt eklenemedi.");
      }
    }

    async function openDetail(id) {
      var item = getComplaintById(id);
      if (!item) return;

      detailComplaintId = id;
      refreshCategoryOptions();
      document.getElementById("detailFileDescription").value = "";
      document.getElementById("detailFileInput").value = "";
      document.getElementById("detailFilesList").innerHTML = '<div class="muted">Ekler yükleniyor...</div>';

      var html = "";
      html += "<tr><th>Şikayet No</th><td>" + escapeHtml(item.no) + "</td></tr>";
      html += "<tr><th>Konu Başlıkları</th><td><strong>" + escapeHtml(getTopicNames(item) || "-") + "</strong></td></tr>";
      if (item.subject && item.subject !== getTopicNames(item)) {
        html += "<tr><th>Kısa Özet</th><td>" + escapeHtml(item.subject || "-") + "</td></tr>";
      }
      html += "<tr><th>Kaynak</th><td>" + escapeHtml(item.source) + "</td></tr>";
      html += "<tr><th>Mahalle</th><td>" + escapeHtml(item.neighborhood || "-") + "</td></tr>";
      html += "<tr><th>Adres</th><td>" + escapeHtml(item.address) + "</td></tr>";
      html += "<tr><th>Durum</th><td>" + getStatusBadge(item) + "</td></tr>";
      html += "<tr><th>Yapılan İşlem</th><td>" + escapeHtml(item.action) + "</td></tr>";
      html += "<tr><th>Detay</th><td>" + escapeHtml(item.detail) + "</td></tr>";
      html += "<tr><th>İşlem Açıklaması</th><td>" + escapeHtml(item.note || "-") + "</td></tr>";
      html += "<tr><th>Kayıt Tarihi</th><td><strong>" + escapeHtml(item.displayDate || "-") + "</strong></td></tr>";
      html += "<tr><th>İşlem Tarihi</th><td><strong>" + escapeHtml(item.processDateText || "-") + "</strong></td></tr>";
      html += "<tr><th>Kontrol Tarihi</th><td><strong>" + escapeHtml(item.controlDateText || "-") + "</strong></td></tr>";
      html += "<tr><th>Kapatma Tarihi</th><td><strong>" + escapeHtml(item.closedDateText || "-") + "</strong></td></tr>";
      html += "<tr><th>Sisteme Kayıt Zamanı</th><td>" + escapeHtml(item.createdAt) + "</td></tr>";

      document.getElementById("detailTableBody").innerHTML = html;
      document.getElementById("detailModal").classList.add("show");
      await loadComplaintFiles(id);
    }

    function openEdit(id) {
      editingId = id;
      var item = getComplaintById(id);
      if (!item) return;

      document.getElementById("editNo").value = item.no;
      document.getElementById("editDate").value = item.date;
      document.getElementById("editSubject").value = item.subject;
      document.getElementById("editSource").value = item.source;
      renderTopicPicker("editTopics", (item.topics || []).map(function(topic) { return topic.id; }));
      populateComplaintNeighborhoodSelects(document.getElementById("newNeighborhood") ? document.getElementById("newNeighborhood").value : "", item.neighborhood || "");
      document.getElementById("editAddress").value = item.address;
      document.getElementById("editDetail").value = item.detail;
      document.getElementById("editAction").value = item.action;
      document.getElementById("editStatus").value = item.status;
      document.getElementById("editControlDate").value = item.controlDate || "";
      document.getElementById("editNote").value = item.note;
      toggleEditControlDate();
      document.getElementById("editModal").classList.add("show");
    }

    async function saveEditComplaint() {
      if (!editingId) return;

      var status = document.getElementById("editStatus").value;
      var controlDate = document.getElementById("editControlDate").value;
      var topicIds = getSelectedTopicIds("editTopics");
      var neighborhood = document.getElementById("editNeighborhood").value;

      if (topicIds.length === 0) {
        alert("En az bir şikayet konusu seçmeniz gerekiyor.");
        return;
      }

      if (status === "Süre Verildi" && !controlDate) {
        alert("Süre Verildi durumunda Kontrol Tarihi girmeniz gerekiyor.");
        return;
      }

      try {
        var response = await fetch("/api/complaints/" + editingId, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            date: document.getElementById("editDate").value,
            subject: document.getElementById("editSubject").value.trim(),
            source: document.getElementById("editSource").value,
            topicIds: topicIds,
            neighborhood: neighborhood,
            address: document.getElementById("editAddress").value.trim(),
            detail: document.getElementById("editDetail").value.trim(),
            action: document.getElementById("editAction").value,
            status: status,
            controlDate: controlDate,
            note: document.getElementById("editNote").value.trim()
          })
        });

        if (!response.ok) throw new Error();

        closeModal("editModal");
        await loadComplaints();
      } catch (error) {
        alert("Kayıt güncellenemedi.");
      }
    }

    async function deleteComplaint(id) {
      var item = getComplaintById(id);
      if (!item) return;

      var ok = confirm(item.no + " numaralı kaydı silmek istiyor musunuz?");
      if (!ok) return;

      try {
        var response = await fetch("/api/complaints/" + id, {
          method: "DELETE"
        });

        if (!response.ok) throw new Error();

        await loadComplaints();
      } catch (error) {
        alert("Kayıt silinemedi.");
      }
    }

    document.addEventListener("DOMContentLoaded", async function() {
      setTodayText();
      populateComplaintNeighborhoodSelects("", "");
      await loadComplaintTopics();
      await loadComplaints();
      document.getElementById("newStatus").addEventListener("change", toggleNewControlDate);
      document.getElementById("editStatus").addEventListener("change", toggleEditControlDate);
      document.getElementById("detailFileType").addEventListener("change", refreshCategoryOptions);
      document.getElementById("filterDate").addEventListener("change", renderTable);
      document.getElementById("filterSource").addEventListener("change", renderTable);
      document.getElementById("filterStatus").addEventListener("change", renderTable);
      document.getElementById("searchInput").addEventListener("input", renderTable);
      var overlays = document.querySelectorAll(".modal-overlay");
      for (var i = 0; i < overlays.length; i++) {
        overlays[i].addEventListener("click", function(event) {
          if (event.target === this) closeModal(this.id);
        });
      }
      document.addEventListener('click', function(event) {
        if (!event.target.closest('.topic-picker')) {
          closeAllTopicDropdowns();
        }
      });
      document.addEventListener("click", function(event) {
        if (!event.target.closest('.topic-picker')) {
          closeAllTopicDropdowns();
        }
      });
      document.addEventListener("keydown", function(event) {
        if (event.key === "Escape") {
          if (document.body.classList.contains("sidebar-open")) {
            toggleSidebar(false);
            return;
          }
          var openModal = document.querySelector(".modal-overlay.show");
          if (openModal) closeModal(openModal.id);
        }
      });
      window.addEventListener("resize", function() {
        if (window.innerWidth > 980) toggleSidebar(false);
      });
      refreshCategoryOptions();
    });
  </script>
</body>
</html>`);
});

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log("Sunucu çalışıyor: " + PORT);
    });
  })
  .catch((error) => {
    console.error("Veritabanı başlatılamadı:", error);
    process.exit(1);
  });