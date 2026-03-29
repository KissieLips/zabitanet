const express = require("express");
const { Pool } = require("pg");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const https = require("https");
const XLSX = require("xlsx");

const app = express();
const PORT = process.env.PORT || 3000;
const DISPLAY_TIME_ZONE = process.env.DISPLAY_TIME_ZONE || "Europe/Istanbul";

app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const uploadsRoot = path.join(__dirname, "uploads");
const complaintUploadsRoot = path.join(uploadsRoot, "complaints");

fs.mkdirSync(complaintUploadsRoot, { recursive: true });

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

function mapComplaint(row) {
  return {
    id: row.id,
    no: row.complaint_no,
    date: toInputDate(row.complaint_date),
    displayDate: formatDate(row.complaint_date),
    subject: row.subject,
    source: row.source,
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
      business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
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

app.get("/api/complaints", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM complaints ORDER BY id DESC");
    res.json(result.rows.map(mapComplaint));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Kayıtlar alınamadı." });
  }
});

app.post("/api/complaints", async (req, res) => {
  try {
    const {
      date,
      subject,
      source,
      address,
      detail,
      action,
      status,
      note,
      controlDate,
    } = req.body;

    if (!date || !subject || !source) {
      return res.status(400).json({ error: "Zorunlu alanları doldurun." });
    }

    const complaintNo = await nextComplaintNo();

    const finalAction = action || "Henüz İşlem Yapılmadı";
    const finalStatus = status || "Açık";

    const processDate =
      finalAction !== "Henüz İşlem Yapılmadı" ? date : null;

    const closedDate =
      finalStatus === "Kapatıldı" ? date : null;

    const finalControlDate =
      finalStatus === "Süre Verildi" ? (controlDate || null) : null;

    const result = await pool.query(
      `
        INSERT INTO complaints
          (
            complaint_no,
            complaint_date,
            subject,
            source,
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
          ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING *
      `,
      [
        complaintNo,
        date,
        subject,
        source,
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

    res.json(mapComplaint(result.rows[0]));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Kayıt eklenemedi." });
  }
});

app.put("/api/complaints/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      date,
      subject,
      source,
      address,
      detail,
      action,
      status,
      note,
      controlDate,
    } = req.body;

    if (!date || !subject || !source) {
      return res.status(400).json({ error: "Zorunlu alanları doldurun." });
    }

    const existingResult = await pool.query(
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

    const result = await pool.query(
      `
        UPDATE complaints
        SET
          complaint_date = $1,
          subject = $2,
          source = $3,
          address = $4,
          detail = $5,
          action_taken = $6,
          status = $7,
          note = $8,
          process_date = $9,
          closed_date = $10,
          control_date = $11
        WHERE id = $12
        RETURNING *
      `,
      [
        date,
        subject,
        source,
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

    res.json(mapComplaint(result.rows[0]));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Kayıt güncellenemedi." });
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
    await pool.query("DELETE FROM businesses WHERE id = $1", [id]);
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
    await pool.query(
      "DELETE FROM business_inspections WHERE id = $1 AND business_id = $2",
      [inspectionId, id]
    );
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Denetim kaydı silinemedi." });
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
    const matchesLicense = licenseFilter === 'all' || normalizedLicense === licenseFilter;
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
    .app { min-height: 100vh; display: grid; grid-template-columns: 208px minmax(0, 1fr); }
    .sidebar { background: linear-gradient(180deg, #17324f 0%, #12283f 100%); color: #fff; padding: 16px 12px; display: flex; flex-direction: column; gap: 14px; position: sticky; top: 0; height: 100vh; border-right: 1px solid rgba(255,255,255,0.06); z-index: 20; }
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
      .app { grid-template-columns: 1fr; }
      .sidebar { position: relative; height: auto; }
      .stats-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="app">
    <aside class="sidebar">
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
      </nav>
    </aside>

    <main class="main">
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
        var matchesLicense = licenseFilter === 'all' || normalizedLicense === licenseFilter;
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
          if (open) closeModal(open.id);
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
    .app { min-height: 100vh; display: grid; grid-template-columns: 208px minmax(0, 1fr); }
    .sidebar { background: linear-gradient(180deg, #17324f 0%, #12283f 100%); color: #fff; padding: 16px 12px; display: flex; flex-direction: column; gap: 14px; position: sticky; top: 0; height: 100vh; border-right: 1px solid rgba(255,255,255,0.06); }
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

    @media (max-width: 980px) {
      .app { grid-template-columns: minmax(0, 1fr); }
      .sidebar { display: none; }
      .main { padding: 14px; }
      .stats-grid, .summary-grid, .license-layout, .form-grid, .inspection-summary-bar, .inspection-grid { grid-template-columns: 1fr; }
      .hero-title { font-size: 22px; }
      .drawer { width: 100vw; }
      .inspection-card-head, .inspection-card-footer { flex-direction: column; align-items: stretch; }
      .inspection-badges { justify-content: flex-start; }
    }
  </style>
</head>
<body>
  <div class="app">
    <aside class="sidebar">
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
      </nav>
    </aside>

    <main class="main">
      <section class="hero">
        <div>
          <div class="crumb"><a href="/businesses">Firma Listesi</a> / <span>Firma Detayı</span></div>
          <h1 class="hero-title" id="pageTitle">Firma Detayı</h1>
          <p class="hero-text">Bu ekranda firmaya ait temel bilgiler, ruhsat yapısı ve denetim geçmişi tek sayfada izlenir. Ruhsat ve denetim işlemleri sağ panelden düzenlenir.</p>
        </div>
        <div class="toolbar">
          <a class="btn btn-ghost" href="/businesses">← Listeye Dön</a>
          <a class="btn btn-ghost" href="/inspections">Tüm Denetimler</a>
          <button class="btn btn-secondary" type="button" id="openLicenseBtnTop">Ruhsat Bilgisi Düzenle</button>
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
          <div class="stat-sub">Ruhsat kartındaki son kayıt durumu</div>
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
            <div class="panel-title">Ruhsat Bilgisi</div>
            <div class="panel-subtitle">Ruhsat durumu, numarası, veriliş tarihi ve adres bilgisi tek kartta tutulur.</div>
          </div>
          <button class="btn btn-ghost" type="button" id="openLicenseBtnSection">Düzenle</button>
        </div>
        <div id="licenseContainer" class="loading">Ruhsat bilgileri yükleniyor...</div>
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
        <section class="drawer-section" id="licenseSection">
          <div class="hint-card">Ruhsat bilgilerini bu panelden düzenleyebilirsin. Adres bilgisi firma kaydından otomatik çekilir.</div>
          <form id="licenseForm">
            <div class="form-grid">
              <div class="form-group">
                <label for="licenseActivitySubject">Faaliyet Konusu</label>
                <input type="text" id="licenseActivitySubject" placeholder="Örnek: Gıda satışı" />
              </div>
              <div class="form-group">
                <label for="licenseStatus">Ruhsat Durumu</label>
                <select id="licenseStatus">
                  <option value="Yok">Yok</option>
                  <option value="Var">Var</option>
                  <option value="Başvuru Aşamasında">Başvuru Aşamasında</option>
                </select>
              </div>
              <div class="form-group">
                <label for="licenseNo">Ruhsat No</label>
                <input type="text" id="licenseNo" placeholder="Ruhsat numarası" />
              </div>
              <div class="form-group">
                <label for="licenseDate">Veriliş Tarihi</label>
                <input type="date" id="licenseDate" />
              </div>
              <div class="form-group full">
                <label for="businessClass">İşyeri Sınıfı / Türü</label>
                <input type="text" id="businessClass" placeholder="Örnek: 2. Sınıf Gayrisıhhi Müessese" />
              </div>
              <div class="form-group full">
                <label for="licenseNote">Ruhsat Açıklaması</label>
                <textarea id="licenseNote" placeholder="Ruhsatla ilgili açıklama veya takip notu"></textarea>
              </div>
              <div class="form-group full">
                <label for="licenseAddressPreview">Adres Bilgisi</label>
                <textarea id="licenseAddressPreview" readonly placeholder="Firma adresi otomatik gelir"></textarea>
              </div>
            </div>
            <div id="licenseMessage" class="form-message"></div>
          </form>
        </section>

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
        <button class="btn btn-primary" type="submit" form="licenseForm" id="licenseSubmitBtn">Kaydet</button>
        <button class="btn btn-primary" type="submit" form="inspectionForm" id="inspectionSubmitBtn">Kaydet</button>
      </div>
    </aside>
  </div>

  <div class="toast" id="toast"></div>

  <script>
    var businessId = ${businessId};
    var currentBusiness = null;
    var inspections = [];
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
              '<div class="inspection-card-footer">' +
                '<div class="inspection-footer-meta">Kayıt No: #' + escapeHtml(String(item.id)) + '</div>' +
                '<div class="action-row"><button class="mini-btn primary" type="button" onclick="openInspectionEditor(' + item.id + ')">Düzenle</button><button class="mini-btn danger" type="button" onclick="deleteInspectionRecord(' + item.id + ')">Sil</button></div>' +
              '</div>' +
            '</div>' +
          '</article>';
      }

      container.innerHTML = '<div class="inspection-shell">' + summaryHtml + '<div class="inspection-list">' + cards + '</div></div>';
    }

    function fillLicenseForm() {
      document.getElementById('licenseActivitySubject').value = currentBusiness ? (currentBusiness.activitySubject || '') : '';
      document.getElementById('licenseStatus').value = currentBusiness ? (currentBusiness.licenseStatus || 'Yok') : 'Yok';
      document.getElementById('licenseNo').value = currentBusiness ? (currentBusiness.licenseNo || '') : '';
      document.getElementById('licenseDate').value = currentBusiness ? (currentBusiness.licenseDate || '') : '';
      document.getElementById('businessClass').value = currentBusiness ? (currentBusiness.businessClass || '') : '';
      document.getElementById('licenseNote').value = currentBusiness ? (currentBusiness.licenseNote || '') : '';
      document.getElementById('licenseAddressPreview').value = currentBusiness ? (currentBusiness.addressText || '') : '';
      setMessage('licenseMessage', '', '');
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
      document.getElementById('licenseSection').classList.toggle('active', sectionName === 'license');
      document.getElementById('inspectionSection').classList.toggle('active', sectionName === 'inspection');
      document.getElementById('licenseSubmitBtn').style.display = sectionName === 'license' ? 'inline-flex' : 'none';
      document.getElementById('inspectionSubmitBtn').style.display = sectionName === 'inspection' ? 'inline-flex' : 'none';
      if (sectionName === 'license') {
        document.getElementById('drawerTitle').textContent = 'Ruhsat Bilgisi Düzenle';
        document.getElementById('drawerSubtitle').textContent = 'Ruhsat bilgileri bu panelden kaydedilir. Adres firma kaydından otomatik gelir.';
      } else {
        var editing = !!document.getElementById('editingInspectionId').value;
        document.getElementById('drawerTitle').textContent = editing ? 'Denetim Kaydı Düzenle' : 'Yeni Denetim Ekle';
        document.getElementById('drawerSubtitle').textContent = editing ? 'Seçilen denetim kaydını düzenliyorsun.' : 'Firmaya yeni denetim kaydı ekliyorsun.';
      }
    }

    function openDrawer(sectionName) {
      setActiveSection(sectionName);
      document.getElementById('editorOverlay').classList.add('show');
      document.body.classList.add('drawer-open');
    }

    function closeDrawer() {
      document.getElementById('editorOverlay').classList.remove('show');
      document.body.classList.remove('drawer-open');
      setMessage('licenseMessage', '', '');
      setMessage('inspectionMessage', '', '');
    }

    function openLicenseEditor() {
      fillLicenseForm();
      openDrawer('license');
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

    async function handleLicenseSubmit(event) {
      event.preventDefault();
      setMessage('licenseMessage', '', '');
      setSaving('licenseSubmitBtn', true);
      try {
        var response = await fetch('/api/businesses/' + businessId + '/license', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            activitySubject: document.getElementById('licenseActivitySubject').value.trim(),
            licenseStatus: document.getElementById('licenseStatus').value,
            licenseNo: document.getElementById('licenseNo').value.trim(),
            licenseDate: document.getElementById('licenseDate').value,
            businessClass: document.getElementById('businessClass').value.trim(),
            licenseNote: document.getElementById('licenseNote').value.trim()
          })
        });
        var data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Ruhsat bilgisi kaydedilemedi.');
        currentBusiness = data;
        renderSummary();
        renderLicense();
        closeDrawer();
        showToast('Ruhsat bilgisi kaydedildi.');
      } catch (error) {
        setMessage('licenseMessage', error.message || 'Ruhsat bilgisi kaydedilemedi.', 'error');
      } finally {
        setSaving('licenseSubmitBtn', false);
      }
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
      if (!confirm('Bu denetim kaydı silinsin mi?')) return;
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

    async function loadInspections() {
      var response = await fetch('/api/businesses/' + businessId + '/inspections');
      var data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Denetim geçmişi yüklenemedi.');
      }
      inspections = data;
      renderInspections();
    }

    function bindDetailPageActions() {
      document.getElementById('openLicenseBtnTop').addEventListener('click', openLicenseEditor);
      document.getElementById('openLicenseBtnSection').addEventListener('click', openLicenseEditor);
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
      document.getElementById('licenseForm').addEventListener('submit', handleLicenseSubmit);
      document.getElementById('inspectionForm').addEventListener('submit', handleInspectionSubmit);
      document.addEventListener('keydown', function(event) {
        if (event.key === 'Escape') closeDrawer();
      });
      window.openInspectionEditor = openInspectionEditor;
      window.deleteInspectionRecord = deleteInspectionRecord;
    }

    async function initPage() {
      try {
        await loadBusiness();
        await loadInspections();
      } catch (error) {
        document.getElementById('summaryContainer').innerHTML = '<div class="empty-state">' + escapeHtml(error.message || 'Firma bilgileri yüklenemedi.') + '</div>';
        document.getElementById('licenseContainer').innerHTML = '<div class="empty-state">Firma detayı alınamadı.</div>';
        document.getElementById('inspectionContainer').innerHTML = '<div class="empty-state">Denetim geçmişi alınamadı.</div>';
      }
    }

    bindDetailPageActions();
    initPage();
  </script>
</body>
</html>`);
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
    .app { min-height: 100vh; display: grid; grid-template-columns: 208px minmax(0, 1fr); }
    .sidebar { background: linear-gradient(180deg, #17324f 0%, #12283f 100%); color: #fff; padding: 16px 12px; display: flex; flex-direction: column; gap: 14px; position: sticky; top: 0; height: 100vh; border-right: 1px solid rgba(255,255,255,0.06); }
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
    @media (max-width: 800px) { .app { grid-template-columns: 1fr; } .sidebar { display: none; } .main { padding: 14px; } .stats-grid, .filters { grid-template-columns: 1fr; } .hero-title { font-size: 22px; } }
    @media print { body { background: #fff; } .sidebar, .hero .toolbar, .filters-panel { display: none !important; } .app { display: block; } .main { padding: 0; } .hero, .panel, .stat-card { box-shadow: none; border-color: #d1d5db; } .hero { margin-bottom: 10px; } .print-meta { display: block; } .table-wrap { overflow: visible; } table { min-width: 0; } th, td { font-size: 11px; padding: 8px; } a { color: inherit; text-decoration: none; } }
  </style>
</head>
<body>
  <div class="app">
    <aside class="sidebar">
      <div class="sidebar-top"><div class="brand-mark">ZB</div><div><div class="brand">Zabıta Yönetim Sistemi</div><div class="brand-sub">Kurumsal takip ve saha yönetimi</div></div></div>
      <div class="nav-section-title">Modüller</div>
      <nav class="menu">
        <a href="/" class="menu-item"><span class="menu-left"><span>📌</span><span>Şikayet Takip</span></span></a>
        <a href="/businesses" class="menu-item"><span class="menu-left"><span>🏪</span><span>Firma Listesi</span></span></a>
        <a href="/inspections" class="menu-item active"><span class="menu-left"><span>🧾</span><span>Tüm Denetimler</span></span></a>
      </nav>
    </aside>
    <main class="main">
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
          <select id="filterLicense" onchange="renderInspectionTable()"><option value="all">Tüm Ruhsat Durumları</option><option value="Var">Ruhsatlı</option><option value="Yok">Ruhsatsız</option><option value="Başvuru Aşamasında">Başvuru Aşamasında</option></select>
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
    document.addEventListener('DOMContentLoaded', async function() { try { await loadCategories(); await loadInspections(); } catch (error) { document.getElementById('inspectionTableBody').innerHTML = '<tr><td colspan="9"><div class="empty-state">' + escapeHtml(error.message || 'Denetim listesi yüklenemedi.') + '</div></td></tr>'; } });
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
    .app { min-height: 100vh; display: grid; grid-template-columns: 208px minmax(0, 1fr); }
    .sidebar { background: linear-gradient(180deg, #17324f 0%, #12283f 100%); color: #ffffff; padding: 16px 12px; display: flex; flex-direction: column; gap: 14px; position: sticky; top: 0; height: 100vh; border-right: 1px solid rgba(255,255,255,0.06); z-index: 40; }
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
    .sidebar-footer { display: none; }
    .sidebar-footer-title { display: none; }
    .sidebar-footer-text { display: none; }
    .sidebar-toggle { display: none; margin-bottom: 14px; border: 1px solid var(--line); background: #ffffff; color: var(--text); border-radius: 12px; padding: 12px 14px; font-size: 14px; font-weight: 700; box-shadow: var(--shadow); cursor: pointer; }
    .sidebar-backdrop { display: none; position: fixed; inset: 0; background: rgba(15, 23, 42, 0.45); z-index: 30; }
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
    @media (max-width: 980px) { .app { grid-template-columns: minmax(0, 1fr); } .sidebar { position: fixed; left: 0; top: 0; bottom: 0; width: min(84vw, 320px); height: 100vh; transform: translateX(-100%); transition: transform 0.2s ease; } body.sidebar-open .sidebar { transform: translateX(0); } body.sidebar-open .sidebar-backdrop { display: block; } .sidebar-toggle { display: inline-flex; align-items: center; gap: 8px; } .main { padding: 16px; } .hero { padding: 14px; border-radius: 16px; } .hero-title { font-size: 24px; } .hero-side { min-width: 0; max-width: none; width: 100%; justify-content: space-between; flex-wrap: wrap; } .critical-grid, .stats-grid, .attachments-grid, .form-grid, .filters { grid-template-columns: 1fr; } .panel, .modal-body, .modal-footer { padding-left: 16px; padding-right: 16px; } .modal { border-radius: 20px; } .detail-table th { width: 150px; } }
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
          <input type="text" id="searchInput" placeholder="Şikayet No veya konu ara..." />
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
    <div class="modal">
      <div class="modal-header">
        <span>Yeni Şikayet Ekle</span>
        <button class="close-btn" onclick="closeModal('newModal')">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-grid">
          <div class="form-group">
            <label>Şikayet No</label>
            <input type="text" id="newNo" placeholder="Otomatik oluşturulacak" disabled />
          </div>
          <div class="form-group">
            <label>Tarih *</label>
            <input type="date" id="newDate" />
          </div>
          <div class="form-group">
            <label>Şikayet Konusu *</label>
            <input type="text" id="newSubject" placeholder="Örn: Gürültü, Çöp, vb." />
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
          <div class="form-group full">
            <label>Şikayet Adresi</label>
            <textarea id="newAddress" placeholder="Şikayetin yapıldığı adres"></textarea>
          </div>
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
        <button class="btn btn-primary" onclick="window.print()">🖨 Yazdır / PDF</button>
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
          <div class="form-group">
            <label>Şikayet Konusu *</label>
            <input type="text" id="editSubject" />
          </div>
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

  <script>
        var complaints = [];
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
        var searchMatch =
          !searchText ||
          item.no.toLowerCase().indexOf(searchText) > -1 ||
          item.subject.toLowerCase().indexOf(searchText) > -1;

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
        rows += "<td>" + escapeHtml(item.subject) + "</td>";
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

    function openNewModal() {
      document.getElementById("newNo").value = "Otomatik oluşturulacak";
      document.getElementById("newDate").value = todayInputDate();
      document.getElementById("newSubject").value = "";
      document.getElementById("newSource").value = "";
      document.getElementById("newAddress").value = "";
      document.getElementById("newDetail").value = "";
      document.getElementById("newAction").value = "Henüz İşlem Yapılmadı";
      document.getElementById("newStatus").value = "Açık";
      document.getElementById("newControlDate").value = "";
      document.getElementById("newNote").value = "";
      toggleNewControlDate();
      document.getElementById("newModal").classList.add("show");
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
      var address = document.getElementById("newAddress").value.trim();
      var detail = document.getElementById("newDetail").value.trim();
      var action = document.getElementById("newAction").value;
      var status = document.getElementById("newStatus").value;
      var controlDate = document.getElementById("newControlDate").value;
      var note = document.getElementById("newNote").value.trim();

      if (!date || !subject || !source) {
        alert("Lütfen zorunlu alanları doldurun.");
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
      html += "<tr><th>Konu</th><td><strong>" + escapeHtml(item.subject) + "</strong></td></tr>";
      html += "<tr><th>Kaynak</th><td>" + escapeHtml(item.source) + "</td></tr>";
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

    document.addEventListener("DOMContentLoaded", function() {
      setTodayText();
      loadComplaints();
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
