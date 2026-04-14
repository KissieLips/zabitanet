const fs = require("fs");
const path = require("path");
const multer = require("multer");

const DISPLAY_TIME_ZONE = process.env.DISPLAY_TIME_ZONE || "Europe/Istanbul";
const ISSUE_RECORD_TYPES = ["Arıza", "Eksiklik", "Talep", "Kayıp", "Bakım İsteği", "Diğer"];
const ISSUE_PRIORITY_OPTIONS = ["Düşük", "Orta", "Yüksek", "Acil"];
const ISSUE_STATUS_OPTIONS = ["Açık", "Bildirildi", "İşleme Alındı", "Beklemede", "Tamamlandı", "Kapatıldı"];

function normalizeText(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function toNullableText(value) {
  const text = normalizeText(value);
  return text ? text : null;
}

function toInputDate(value) {
  if (!value) return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
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
    const [yyyy, mm, dd] = value.split("-");
    return dd + "." + mm + "." + yyyy;
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("tr-TR", { timeZone: DISPLAY_TIME_ZONE }).format(d);
}

function formatDateTime(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: DISPLAY_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(d);
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

function normalizeRecordType(value) {
  const text = normalizeText(value);
  return ISSUE_RECORD_TYPES.includes(text) ? text : "Arıza";
}

function normalizePriority(value) {
  const text = normalizeText(value);
  return ISSUE_PRIORITY_OPTIONS.includes(text) ? text : "Orta";
}

function normalizeStatus(value) {
  const text = normalizeText(value);
  return ISSUE_STATUS_OPTIONS.includes(text) ? text : "Açık";
}

function mapIssueFile(row) {
  return {
    id: row.id,
    recordId: row.record_id,
    fileType: row.file_type,
    category: row.category,
    description: row.description || "",
    originalName: row.original_name,
    storedName: row.stored_name,
    filePath: row.file_path,
    mimeType: row.mime_type || "",
    fileSize: Number(row.file_size || 0),
    createdAt: row.created_at,
    createdAtText: formatDateTime(row.created_at),
    isImage: String(row.file_type || "") === "image"
  };
}

function mapIssueRecord(row) {
  const dueDate = toInputDate(row.due_date);
  const completedDate = toInputDate(row.completed_date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dueObj = dueDate ? new Date(dueDate + "T00:00:00") : null;
  const isCompleted = ["Tamamlandı", "Kapatıldı"].includes(String(row.status || ""));
  const isOverdue = Boolean(dueObj && dueObj.getTime() < today.getTime() && !isCompleted);

  return {
    id: row.id,
    recordNo: row.record_no,
    recordDate: toInputDate(row.record_date),
    recordDateText: formatDate(row.record_date),
    recordType: row.record_type,
    title: row.title,
    locationName: row.location_name || "",
    unitName: row.unit_name || "",
    detail: row.detail || "",
    priority: row.priority || "Orta",
    status: row.status || "Açık",
    responsibleUnit: row.responsible_unit || "",
    assignedPerson: row.assigned_person || "",
    reportedBy: row.reported_by || "",
    dueDate,
    dueDateText: formatDate(row.due_date),
    completedDate,
    completedDateText: formatDate(row.completed_date),
    resultNote: row.result_note || "",
    createdAt: row.created_at,
    createdAtText: formatDateTime(row.created_at),
    updatedAt: row.updated_at,
    updatedAtText: formatDateTime(row.updated_at),
    fileCount: Number(row.file_count || 0),
    imageCount: Number(row.image_count || 0),
    latestImagePath: row.latest_image_path || "",
    isOverdue
  };
}

async function nextIssueRecordNo(pool) {
  const currentYear = new Date().getFullYear();
  const result = await pool.query(
    "SELECT record_no FROM issue_records WHERE record_no LIKE $1 ORDER BY id DESC LIMIT 1",
    ["AET-" + currentYear + "-%"]
  );

  let nextNumber = 1;
  if (result.rows.length) {
    const match = String(result.rows[0].record_no || "").match(/(\d+)$/);
    if (match) nextNumber = Number(match[1]) + 1;
  }

  return "AET-" + currentYear + "-" + String(nextNumber).padStart(4, "0");
}

async function initIssueModuleDb(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS issue_records (
      id SERIAL PRIMARY KEY,
      record_no VARCHAR(30) UNIQUE NOT NULL,
      record_date DATE NOT NULL,
      record_type VARCHAR(40) NOT NULL DEFAULT 'Arıza',
      title VARCHAR(255) NOT NULL,
      location_name VARCHAR(160) NOT NULL,
      unit_name VARCHAR(160),
      detail TEXT,
      priority VARCHAR(20) NOT NULL DEFAULT 'Orta',
      status VARCHAR(30) NOT NULL DEFAULT 'Açık',
      responsible_unit VARCHAR(160),
      assigned_person VARCHAR(160),
      reported_by VARCHAR(160),
      due_date DATE,
      completed_date DATE,
      result_note TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const alterations = [
    "ALTER TABLE issue_records ADD COLUMN IF NOT EXISTS record_type VARCHAR(40) NOT NULL DEFAULT 'Arıza'",
    "ALTER TABLE issue_records ADD COLUMN IF NOT EXISTS location_name VARCHAR(160)",
    "ALTER TABLE issue_records ADD COLUMN IF NOT EXISTS unit_name VARCHAR(160)",
    "ALTER TABLE issue_records ADD COLUMN IF NOT EXISTS detail TEXT",
    "ALTER TABLE issue_records ADD COLUMN IF NOT EXISTS priority VARCHAR(20) NOT NULL DEFAULT 'Orta'",
    "ALTER TABLE issue_records ADD COLUMN IF NOT EXISTS status VARCHAR(30) NOT NULL DEFAULT 'Açık'",
    "ALTER TABLE issue_records ADD COLUMN IF NOT EXISTS responsible_unit VARCHAR(160)",
    "ALTER TABLE issue_records ADD COLUMN IF NOT EXISTS assigned_person VARCHAR(160)",
    "ALTER TABLE issue_records ADD COLUMN IF NOT EXISTS reported_by VARCHAR(160)",
    "ALTER TABLE issue_records ADD COLUMN IF NOT EXISTS due_date DATE",
    "ALTER TABLE issue_records ADD COLUMN IF NOT EXISTS completed_date DATE",
    "ALTER TABLE issue_records ADD COLUMN IF NOT EXISTS result_note TEXT",
    "ALTER TABLE issue_records ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP"
  ];
  for (const sql of alterations) await pool.query(sql);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS issue_record_files (
      id SERIAL PRIMARY KEY,
      record_id INTEGER NOT NULL REFERENCES issue_records(id) ON DELETE CASCADE,
      file_type VARCHAR(20) NOT NULL,
      category VARCHAR(120) NOT NULL DEFAULT 'Ek',
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
    ALTER TABLE issue_record_files
    ADD COLUMN IF NOT EXISTS category VARCHAR(120) NOT NULL DEFAULT 'Ek'
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_issue_record_files_record_id
    ON issue_record_files(record_id)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_issue_records_status
    ON issue_records(status)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_issue_records_due_date
    ON issue_records(due_date)
  `);
}

function registerIssueModule({ app, pool, rootDir }) {
  const uploadsRoot = path.join(rootDir, "uploads");
  const issueUploadsRoot = path.join(uploadsRoot, "issues");
  fs.mkdirSync(issueUploadsRoot, { recursive: true });

  const issueStorage = multer.diskStorage({
    destination: function(req, file, cb) {
      const recordFolder = path.join(issueUploadsRoot, String(req.params.id));
      fs.mkdirSync(recordFolder, { recursive: true });
      cb(null, recordFolder);
    },
    filename: function(req, file, cb) {
      const decodedOriginalName = decodeUploadFilename(file.originalname || "dosya");
      const ext = path.extname(decodedOriginalName || "");
      const base = path.basename(decodedOriginalName || "dosya", ext).replace(/[^a-zA-Z0-9çğıöşüÇĞİÖŞÜ_-]/g, "-");
      cb(null, Date.now() + "-" + base + ext);
    }
  });

  const issueUpload = multer({ storage: issueStorage, limits: { fileSize: 25 * 1024 * 1024 } });

  app.get('/issues', (req, res) => {
    res.sendFile(path.join(rootDir, 'issue-tracking-page.html'));
  });

  app.get('/api/issue-records/next-no', async (req, res) => {
    try {
      const recordNo = await nextIssueRecordNo(pool);
      res.json({ recordNo });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Yeni kayıt numarası üretilemedi.' });
    }
  });

  app.get('/api/issue-records/summary', async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT
          COUNT(*) AS total_count,
          COUNT(*) FILTER (WHERE status IN ('Açık', 'Bildirildi')) AS open_count,
          COUNT(*) FILTER (WHERE status IN ('İşleme Alındı', 'Beklemede')) AS progress_count,
          COUNT(*) FILTER (WHERE status IN ('Tamamlandı', 'Kapatıldı')) AS completed_count,
          COUNT(*) FILTER (WHERE due_date IS NOT NULL AND due_date < CURRENT_DATE AND status NOT IN ('Tamamlandı', 'Kapatıldı')) AS overdue_count,
          COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM issue_record_files f WHERE f.record_id = issue_records.id)) AS attachment_count,
          COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM issue_record_files f WHERE f.record_id = issue_records.id AND f.file_type = 'image')) AS image_record_count
        FROM issue_records
      `);
      const row = result.rows[0] || {};
      res.json({
        totalCount: Number(row.total_count || 0),
        openCount: Number(row.open_count || 0),
        progressCount: Number(row.progress_count || 0),
        completedCount: Number(row.completed_count || 0),
        overdueCount: Number(row.overdue_count || 0),
        attachmentCount: Number(row.attachment_count || 0),
        imageRecordCount: Number(row.image_record_count || 0)
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Özet bilgiler alınamadı.' });
    }
  });

  app.get('/api/issue-records', async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT
          r.*,
          COUNT(f.id) AS file_count,
          COUNT(*) FILTER (WHERE f.file_type = 'image') AS image_count,
          MAX(CASE WHEN f.file_type = 'image' THEN f.file_path ELSE NULL END) AS latest_image_path
        FROM issue_records r
        LEFT JOIN issue_record_files f ON f.record_id = r.id
        GROUP BY r.id
        ORDER BY r.record_date DESC, r.id DESC
      `);
      res.json(result.rows.map(mapIssueRecord));
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Kayıt listesi alınamadı.' });
    }
  });

  app.get('/api/issue-records/:id', async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'Geçerli kayıt seçilmedi.' });

      const recordResult = await pool.query(`
        SELECT
          r.*,
          COUNT(f.id) AS file_count,
          COUNT(*) FILTER (WHERE f.file_type = 'image') AS image_count,
          MAX(CASE WHEN f.file_type = 'image' THEN f.file_path ELSE NULL END) AS latest_image_path
        FROM issue_records r
        LEFT JOIN issue_record_files f ON f.record_id = r.id
        WHERE r.id = $1
        GROUP BY r.id
        LIMIT 1
      `, [id]);
      if (!recordResult.rows.length) return res.status(404).json({ error: 'Kayıt bulunamadı.' });

      const filesResult = await pool.query(`
        SELECT *
        FROM issue_record_files
        WHERE record_id = $1
        ORDER BY created_at DESC, id DESC
      `, [id]);

      const payload = mapIssueRecord(recordResult.rows[0]);
      payload.files = filesResult.rows.map(mapIssueFile);
      res.json(payload);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Kayıt detayı alınamadı.' });
    }
  });

  app.post('/api/issue-records', async (req, res) => {
    try {
      const recordNo = await nextIssueRecordNo(pool);
      const recordDate = toInputDate(req.body.recordDate) || toInputDate(new Date());
      const recordType = normalizeRecordType(req.body.recordType);
      const title = normalizeText(req.body.title);
      const locationName = normalizeText(req.body.locationName);
      const unitName = toNullableText(req.body.unitName);
      const detail = toNullableText(req.body.detail);
      const priority = normalizePriority(req.body.priority);
      const status = normalizeStatus(req.body.status);
      const responsibleUnit = toNullableText(req.body.responsibleUnit);
      const assignedPerson = toNullableText(req.body.assignedPerson);
      const reportedBy = toNullableText(req.body.reportedBy);
      const dueDate = toInputDate(req.body.dueDate) || null;
      let completedDate = toInputDate(req.body.completedDate) || null;
      const resultNote = toNullableText(req.body.resultNote);

      if (!title) return res.status(400).json({ error: 'Başlık zorunludur.' });
      if (!locationName) return res.status(400).json({ error: 'Yer / tesis bilgisi zorunludur.' });
      if (['Tamamlandı', 'Kapatıldı'].includes(status) && !completedDate) completedDate = toInputDate(new Date());

      const result = await pool.query(`
        INSERT INTO issue_records (
          record_no, record_date, record_type, title, location_name, unit_name, detail,
          priority, status, responsible_unit, assigned_person, reported_by,
          due_date, completed_date, result_note
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        RETURNING *
      `, [
        recordNo, recordDate, recordType, title, locationName, unitName, detail,
        priority, status, responsibleUnit, assignedPerson, reportedBy,
        dueDate, completedDate, resultNote
      ]);

      res.status(201).json(mapIssueRecord(result.rows[0]));
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Kayıt oluşturulamadı.' });
    }
  });

  app.put('/api/issue-records/:id', async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'Geçerli kayıt seçilmedi.' });

      const recordDate = toInputDate(req.body.recordDate) || toInputDate(new Date());
      const recordType = normalizeRecordType(req.body.recordType);
      const title = normalizeText(req.body.title);
      const locationName = normalizeText(req.body.locationName);
      const unitName = toNullableText(req.body.unitName);
      const detail = toNullableText(req.body.detail);
      const priority = normalizePriority(req.body.priority);
      const status = normalizeStatus(req.body.status);
      const responsibleUnit = toNullableText(req.body.responsibleUnit);
      const assignedPerson = toNullableText(req.body.assignedPerson);
      const reportedBy = toNullableText(req.body.reportedBy);
      const dueDate = toInputDate(req.body.dueDate) || null;
      let completedDate = toInputDate(req.body.completedDate) || null;
      const resultNote = toNullableText(req.body.resultNote);

      if (!title) return res.status(400).json({ error: 'Başlık zorunludur.' });
      if (!locationName) return res.status(400).json({ error: 'Yer / tesis bilgisi zorunludur.' });
      if (['Tamamlandı', 'Kapatıldı'].includes(status) && !completedDate) completedDate = toInputDate(new Date());
      if (!['Tamamlandı', 'Kapatıldı'].includes(status)) completedDate = null;

      const result = await pool.query(`
        UPDATE issue_records
        SET
          record_date = $2,
          record_type = $3,
          title = $4,
          location_name = $5,
          unit_name = $6,
          detail = $7,
          priority = $8,
          status = $9,
          responsible_unit = $10,
          assigned_person = $11,
          reported_by = $12,
          due_date = $13,
          completed_date = $14,
          result_note = $15,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *
      `, [
        id, recordDate, recordType, title, locationName, unitName, detail,
        priority, status, responsibleUnit, assignedPerson, reportedBy,
        dueDate, completedDate, resultNote
      ]);

      if (!result.rows.length) return res.status(404).json({ error: 'Kayıt bulunamadı.' });
      res.json(mapIssueRecord(result.rows[0]));
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Kayıt güncellenemedi.' });
    }
  });

  app.delete('/api/issue-records/:id', async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'Geçerli kayıt seçilmedi.' });

      const filesResult = await pool.query('SELECT file_path FROM issue_record_files WHERE record_id = $1', [id]);
      for (const row of filesResult.rows) {
        if (!row.file_path) continue;
        const absolutePath = path.join(rootDir, row.file_path.replace(/^\/uploads\//, 'uploads/'));
        if (fs.existsSync(absolutePath)) {
          try { fs.unlinkSync(absolutePath); } catch (error) {}
        }
      }

      const result = await pool.query('DELETE FROM issue_records WHERE id = $1 RETURNING id', [id]);
      if (!result.rows.length) return res.status(404).json({ error: 'Kayıt bulunamadı.' });

      const recordFolder = path.join(issueUploadsRoot, String(id));
      if (fs.existsSync(recordFolder)) {
        try { fs.rmSync(recordFolder, { recursive: true, force: true }); } catch (error) {}
      }

      res.json({ success: true });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Kayıt silinemedi.' });
    }
  });

  app.get('/api/issue-records/:id/files', async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'Geçerli kayıt seçilmedi.' });
      const result = await pool.query(`
        SELECT *
        FROM issue_record_files
        WHERE record_id = $1
        ORDER BY created_at DESC, id DESC
      `, [id]);
      res.json(result.rows.map(mapIssueFile));
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Ek dosyalar alınamadı.' });
    }
  });

  app.post('/api/issue-records/:id/files', issueUpload.any(), async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'Geçerli kayıt seçilmedi.' });
      if (!req.files || !req.files.length) return res.status(400).json({ error: 'Yüklenecek dosya seçilmedi.' });

      const exists = await pool.query('SELECT id FROM issue_records WHERE id = $1 LIMIT 1', [id]);
      if (!exists.rows.length) return res.status(404).json({ error: 'Kayıt bulunamadı.' });

      const description = toNullableText(req.body.description);
      const category = toNullableText(req.body.category) || 'Ek';
      const inserted = [];

      for (const uploadedFile of req.files) {
        const mimeType = String(uploadedFile.mimetype || '').toLowerCase();
        const fileType = mimeType.startsWith('image/') ? 'image' : 'document';
        const originalName = decodeUploadFilename(uploadedFile.originalname || uploadedFile.filename || 'dosya');
        const relativePath = '/uploads/issues/' + id + '/' + uploadedFile.filename;
        const result = await pool.query(`
          INSERT INTO issue_record_files (
            record_id, file_type, category, description, original_name, stored_name, file_path, mime_type, file_size
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          RETURNING *
        `, [id, fileType, category, description, originalName, uploadedFile.filename, relativePath, uploadedFile.mimetype || '', uploadedFile.size || 0]);
        inserted.push(mapIssueFile(result.rows[0]));
      }

      res.status(201).json(inserted);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Dosyalar yüklenemedi.' });
    }
  });

  app.delete('/api/issue-record-files/:fileId', async (req, res) => {
    try {
      const fileId = Number(req.params.fileId);
      if (!Number.isFinite(fileId)) return res.status(400).json({ error: 'Geçerli dosya seçilmedi.' });

      const result = await pool.query('DELETE FROM issue_record_files WHERE id = $1 RETURNING *', [fileId]);
      if (!result.rows.length) return res.status(404).json({ error: 'Dosya kaydı bulunamadı.' });

      const row = result.rows[0];
      if (row.file_path) {
        const absolutePath = path.join(rootDir, row.file_path.replace(/^\/uploads\//, 'uploads/'));
        if (fs.existsSync(absolutePath)) {
          try { fs.unlinkSync(absolutePath); } catch (error) {}
        }
      }

      res.json({ success: true });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Dosya silinemedi.' });
    }
  });
}

module.exports = {
  initIssueModuleDb,
  registerIssueModule,
  ISSUE_RECORD_TYPES,
  ISSUE_PRIORITY_OPTIONS,
  ISSUE_STATUS_OPTIONS
};
