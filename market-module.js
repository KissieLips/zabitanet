const path = require('path');

const DISPLAY_TIME_ZONE = process.env.DISPLAY_TIME_ZONE || 'Europe/Istanbul';

const MARKET_DAY_LABELS = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
const MARKET_SECTION_ORDER = ['Esnaf', 'Üretici', 'Tuhafiye'];
const MARKET_DOCUMENT_LABELS = {
  hasPhoto: 'Fotoğraf',
  hasIdentityCopy: 'Kimlik Fotokopisi',
  hasChamberRecord: 'Oda Kayıt Belgesi',
  hasPopulationRecord: 'Nüfus Kayıt Belgesi',
  hasTaxRecord: 'Vergi Kayıt Belgesi',
  hasCksDocument: 'ÇKS Belgesi',
};

function toInputDate(value) {
  if (!value) return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function formatDate(value) {
  if (!value) return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parts = value.split('-');
    return `${parts[2]}.${parts[1]}.${parts[0]}`;
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('tr-TR', { timeZone: DISPLAY_TIME_ZONE }).format(d);
}

function formatDateTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone: DISPLAY_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

function normalizeSectionText(value) {
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

function toBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  const text = String(value || '').trim().toLocaleLowerCase('tr-TR');
  return ['1', 'true', 'evet', 'var', 'yes', 'on'].includes(text);
}

function getRequiredDocumentKeys(sectionType) {
  const normalized = normalizeSectionText(sectionType);
  if (normalized === 'uretici') {
    return ['hasPhoto', 'hasIdentityCopy', 'hasPopulationRecord', 'hasCksDocument'];
  }
  return ['hasPhoto', 'hasIdentityCopy', 'hasChamberRecord', 'hasPopulationRecord', 'hasTaxRecord'];
}

function buildDocumentSummary(row) {
  const requiredKeys = getRequiredDocumentKeys(row.sectionType || row.section_type || '');
  const missingDocs = [];
  const availableDocs = [];

  requiredKeys.forEach((key) => {
    const rawValue = row[key] !== undefined ? row[key] : row[key.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase())];
    if (toBoolean(rawValue)) availableDocs.push(MARKET_DOCUMENT_LABELS[key]);
    else missingDocs.push(MARKET_DOCUMENT_LABELS[key]);
  });

  return {
    totalRequired: requiredKeys.length,
    completedCount: availableDocs.length,
    isComplete: missingDocs.length === 0,
    missingDocs,
    availableDocs,
    requiredDocs: requiredKeys.map((key) => MARKET_DOCUMENT_LABELS[key]),
  };
}

function buildStallLabel(row) {
  const color = String(row.stallColor || row.stall_color || '').trim();
  const number = String(row.stallNo || row.stall_no || '').trim();
  if (!color && !number) return '';
  if (!color) return number;
  if (!number) return color;
  return `${color} ${number}`;
}

function mapVendor(row) {
  const documents = buildDocumentSummary(row);
  return {
    id: row.id,
    marketId: row.market_id,
    marketName: row.market_name,
    scheduledDay: row.scheduled_day,
    scheduledDayLabel: MARKET_DAY_LABELS[row.scheduled_day] || '',
    fullName: row.full_name || '',
    identityNumber: row.identity_number || '',
    phone: row.phone || '',
    address: row.address || '',
    sectionType: row.section_type || '',
    stallNo: row.stall_no || '',
    stallColor: row.stall_color || '',
    stallLabel: buildStallLabel(row),
    documentFolderUrl: row.document_folder_url || '',
    hasPhoto: toBoolean(row.has_photo),
    hasIdentityCopy: toBoolean(row.has_identity_copy),
    hasChamberRecord: toBoolean(row.has_chamber_record),
    hasPopulationRecord: toBoolean(row.has_population_record),
    hasTaxRecord: toBoolean(row.has_tax_record),
    hasCksDocument: toBoolean(row.has_cks_document),
    note: row.note || '',
    isActive: toBoolean(row.is_active),
    createdAt: formatDateTime(row.created_at),
    updatedAt: formatDateTime(row.updated_at),
    documents,
  };
}

function mapLeave(row) {
  return {
    id: row.id,
    vendorId: row.vendor_id,
    marketId: row.market_id,
    marketName: row.market_name,
    vendorName: row.vendor_name,
    leaveType: row.leave_type,
    startDate: toInputDate(row.start_date),
    endDate: toInputDate(row.end_date),
    startDateText: formatDate(row.start_date),
    endDateText: formatDate(row.end_date),
    note: row.note || '',
    createdAt: formatDateTime(row.created_at),
  };
}

function mapAttendanceRow(row, fallbackDate) {
  const recommendedStatus = row.attendance_status || row.leave_type || '';
  const isLocked = Boolean(row.leave_type);
  return {
    vendorId: row.vendor_id,
    marketId: row.market_id,
    marketName: row.market_name,
    vendorName: row.vendor_name,
    sectionType: row.section_type,
    stallNo: row.stall_no || '',
    stallColor: row.stall_color || '',
    stallLabel: buildStallLabel(row),
    attendanceDate: toInputDate(row.attendance_date) || fallbackDate,
    attendanceStatus: row.attendance_status || '',
    note: row.attendance_note || '',
    attendanceRecordId: row.attendance_id || null,
    recommendedStatus,
    leaveType: row.leave_type || '',
    leaveNote: row.leave_note || '',
    leavePeriodText: row.leave_type ? `${formatDate(row.leave_start_date)} - ${formatDate(row.leave_end_date)}` : '',
    isLocked,
    lockedStatus: isLocked ? row.leave_type : '',
  };
}

async function initMarketModuleDb(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS market_places (
      id SERIAL PRIMARY KEY,
      name VARCHAR(150) UNIQUE NOT NULL,
      scheduled_day INTEGER NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      display_order INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS market_sections (
      id SERIAL PRIMARY KEY,
      market_id INTEGER NOT NULL REFERENCES market_places(id) ON DELETE CASCADE,
      section_name VARCHAR(120) NOT NULL,
      capacity INTEGER NOT NULL DEFAULT 0,
      number_color VARCHAR(80),
      display_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (market_id, section_name)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS market_vendors (
      id SERIAL PRIMARY KEY,
      market_id INTEGER NOT NULL REFERENCES market_places(id) ON DELETE CASCADE,
      full_name VARCHAR(255) NOT NULL,
      identity_number VARCHAR(20),
      phone VARCHAR(30),
      address TEXT,
      section_type VARCHAR(120) NOT NULL,
      stall_no VARCHAR(40),
      stall_color VARCHAR(40),
      document_folder_url TEXT,
      has_photo BOOLEAN NOT NULL DEFAULT FALSE,
      has_identity_copy BOOLEAN NOT NULL DEFAULT FALSE,
      has_chamber_record BOOLEAN NOT NULL DEFAULT FALSE,
      has_population_record BOOLEAN NOT NULL DEFAULT FALSE,
      has_tax_record BOOLEAN NOT NULL DEFAULT FALSE,
      has_cks_document BOOLEAN NOT NULL DEFAULT FALSE,
      note TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS market_leave_records (
      id SERIAL PRIMARY KEY,
      vendor_id INTEGER NOT NULL REFERENCES market_vendors(id) ON DELETE CASCADE,
      leave_type VARCHAR(30) NOT NULL,
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      note TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS market_attendance (
      id SERIAL PRIMARY KEY,
      vendor_id INTEGER NOT NULL REFERENCES market_vendors(id) ON DELETE CASCADE,
      attendance_date DATE NOT NULL,
      status VARCHAR(30) NOT NULL,
      note TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (vendor_id, attendance_date)
    )
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_market_sections_market_id ON market_sections(market_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_market_vendors_market_id ON market_vendors(market_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_market_vendors_section_type ON market_vendors(section_type)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_market_leave_records_vendor_id ON market_leave_records(vendor_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_market_leave_records_dates ON market_leave_records(start_date, end_date)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_market_attendance_date ON market_attendance(attendance_date)`);

  const defaultMarkets = [
    { name: 'Perşembe Pazarı', scheduledDay: 4, isActive: true, displayOrder: 1, notes: 'Aktif pazar yeri' },
    { name: 'Pazar Pazarı', scheduledDay: 0, isActive: true, displayOrder: 2, notes: 'Aktif pazar yeri' },
    { name: 'Cumartesi Pazarı', scheduledDay: 6, isActive: false, displayOrder: 3, notes: 'Şimdilik pasif' },
  ];

  for (const item of defaultMarkets) {
    await pool.query(
      `
        INSERT INTO market_places (name, scheduled_day, is_active, display_order, notes)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (name)
        DO UPDATE SET
          scheduled_day = EXCLUDED.scheduled_day,
          display_order = EXCLUDED.display_order,
          updated_at = CURRENT_TIMESTAMP
      `,
      [item.name, item.scheduledDay, item.isActive, item.displayOrder, item.notes]
    );
  }

  const marketRows = await pool.query(`SELECT id, name FROM market_places`);
  const sectionSeeds = [
    { sectionName: 'Esnaf', capacity: 0, numberColor: 'Mavi', displayOrder: 1 },
    { sectionName: 'Üretici', capacity: 0, numberColor: 'Yeşil / Kırmızı', displayOrder: 2 },
    { sectionName: 'Tuhafiye', capacity: 0, numberColor: 'Renksiz', displayOrder: 3 },
  ];

  for (const market of marketRows.rows) {
    for (const section of sectionSeeds) {
      await pool.query(
        `
          INSERT INTO market_sections (market_id, section_name, capacity, number_color, display_order)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (market_id, section_name)
          DO NOTHING
        `,
        [market.id, section.sectionName, section.capacity, section.numberColor, section.displayOrder]
      );
    }
  }
}

function registerMarketModule({ app, pool }) {
  app.get('/markets', (req, res) => {
    res.sendFile(path.join(__dirname, 'markets-page.html'));
  });

  app.get('/api/markets', async (req, res) => {
    try {
      const marketResult = await pool.query(`
        SELECT
          m.*,
          COUNT(v.id)::int AS vendor_count,
          COUNT(v.id) FILTER (WHERE v.is_active = TRUE)::int AS active_vendor_count
        FROM market_places m
        LEFT JOIN market_vendors v ON v.market_id = m.id
        GROUP BY m.id
        ORDER BY m.display_order ASC, m.name ASC
      `);

      const sectionResult = await pool.query(`
        SELECT
          s.id,
          s.market_id,
          s.section_name,
          s.capacity,
          s.number_color,
          s.display_order,
          COUNT(v.id)::int AS vendor_count,
          COUNT(v.id) FILTER (WHERE v.is_active = TRUE)::int AS active_vendor_count
        FROM market_sections s
        LEFT JOIN market_vendors v
          ON v.market_id = s.market_id
         AND v.section_type = s.section_name
        GROUP BY s.id
        ORDER BY s.market_id ASC, s.display_order ASC, s.section_name ASC
      `);

      const sectionMap = new Map();
      for (const row of sectionResult.rows) {
        const list = sectionMap.get(row.market_id) || [];
        list.push({
          id: row.id,
          marketId: row.market_id,
          sectionName: row.section_name,
          capacity: Number(row.capacity || 0),
          numberColor: row.number_color || '',
          vendorCount: Number(row.vendor_count || 0),
          activeVendorCount: Number(row.active_vendor_count || 0),
        });
        sectionMap.set(row.market_id, list);
      }

      const data = marketResult.rows.map((row) => ({
        id: row.id,
        name: row.name,
        scheduledDay: row.scheduled_day,
        scheduledDayLabel: MARKET_DAY_LABELS[row.scheduled_day] || '',
        isActive: toBoolean(row.is_active),
        displayOrder: row.display_order,
        notes: row.notes || '',
        vendorCount: Number(row.vendor_count || 0),
        activeVendorCount: Number(row.active_vendor_count || 0),
        sections: sectionMap.get(row.id) || [],
      }));

      res.json(data);
    } catch (error) {
      console.error('Pazar listesi alınamadı:', error);
      res.status(500).json({ error: 'Pazar listesi alınamadı.' });
    }
  });

  app.put('/api/markets/:id', async (req, res) => {
    const marketId = Number(req.params.id);
    const { scheduledDay, isActive, notes, sections } = req.body || {};

    if (!marketId) return res.status(400).json({ error: 'Geçerli pazar seçilmedi.' });
    if (scheduledDay === undefined || scheduledDay === null || Number.isNaN(Number(scheduledDay))) {
      return res.status(400).json({ error: 'Pazar günü zorunludur.' });
    }

    try {
      const exists = await pool.query('SELECT id FROM market_places WHERE id = $1 LIMIT 1', [marketId]);
      if (!exists.rows.length) return res.status(404).json({ error: 'Pazar kaydı bulunamadı.' });

      await pool.query(
        `
          UPDATE market_places
          SET scheduled_day = $1,
              is_active = $2,
              notes = $3,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = $4
        `,
        [Number(scheduledDay), toBoolean(isActive), String(notes || '').trim(), marketId]
      );

      if (Array.isArray(sections)) {
        for (const item of sections) {
          const sectionName = String(item.sectionName || '').trim();
          if (!sectionName) continue;
          const capacity = Number(item.capacity || 0);
          await pool.query(
            `
              UPDATE market_sections
              SET capacity = $1,
                  updated_at = CURRENT_TIMESTAMP
              WHERE market_id = $2 AND section_name = $3
            `,
            [Number.isNaN(capacity) ? 0 : Math.max(0, capacity), marketId, sectionName]
          );
        }
      }

      res.json({ success: true });
    } catch (error) {
      console.error('Pazar ayarı güncellenemedi:', error);
      res.status(500).json({ error: 'Pazar ayarı güncellenemedi.' });
    }
  });

  app.get('/api/markets/vendors', async (req, res) => {
    const marketId = String(req.query.marketId || 'all');
    const section = String(req.query.section || 'all');
    const status = String(req.query.status || 'all');
    const docStatus = String(req.query.docStatus || 'all');
    const search = String(req.query.search || '').trim();

    try {
      const conditions = [];
      const values = [];

      if (marketId !== 'all') {
        values.push(Number(marketId));
        conditions.push(`v.market_id = $${values.length}`);
      }
      if (section !== 'all') {
        values.push(section);
        conditions.push(`v.section_type = $${values.length}`);
      }
      if (status === 'active') conditions.push('v.is_active = TRUE');
      if (status === 'passive') conditions.push('v.is_active = FALSE');
      if (search) {
        values.push(`%${search}%`);
        conditions.push(`(
          v.full_name ILIKE $${values.length}
          OR COALESCE(v.identity_number, '') ILIKE $${values.length}
          OR COALESCE(v.phone, '') ILIKE $${values.length}
          OR COALESCE(v.address, '') ILIKE $${values.length}
          OR COALESCE(v.stall_no, '') ILIKE $${values.length}
        )`);
      }

      const sql = `
        SELECT
          v.*,
          m.name AS market_name,
          m.scheduled_day
        FROM market_vendors v
        INNER JOIN market_places m ON m.id = v.market_id
        ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
        ORDER BY m.display_order ASC, v.section_type ASC, NULLIF(v.stall_no, '') ASC, v.full_name ASC
      `;

      const result = await pool.query(sql, values);
      let rows = result.rows.map(mapVendor);

      if (docStatus === 'complete') rows = rows.filter((item) => item.documents.isComplete);
      if (docStatus === 'missing') rows = rows.filter((item) => !item.documents.isComplete);

      res.json(rows);
    } catch (error) {
      console.error('Pazar satıcıları alınamadı:', error);
      res.status(500).json({ error: 'Pazar satıcıları alınamadı.' });
    }
  });

  app.post('/api/markets/vendors', async (req, res) => {
    const payload = req.body || {};
    const marketId = Number(payload.marketId);
    const fullName = String(payload.fullName || '').trim();
    const identityNumber = String(payload.identityNumber || '').trim();

    if (!marketId) return res.status(400).json({ error: 'Pazar yeri seçilmelidir.' });
    if (!fullName) return res.status(400).json({ error: 'Satıcı adı zorunludur.' });
    if (identityNumber && !/^\d{11}$/.test(identityNumber)) {
      return res.status(400).json({ error: 'TC kimlik numarası 11 haneli olmalıdır.' });
    }

    try {
      const exists = await pool.query('SELECT id FROM market_places WHERE id = $1 LIMIT 1', [marketId]);
      if (!exists.rows.length) return res.status(404).json({ error: 'Pazar kaydı bulunamadı.' });

      const result = await pool.query(
        `
          INSERT INTO market_vendors (
            market_id, full_name, identity_number, phone, address, section_type, stall_no, stall_color,
            document_folder_url, has_photo, has_identity_copy, has_chamber_record,
            has_population_record, has_tax_record, has_cks_document, note, is_active
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8,
            $9, $10, $11, $12,
            $13, $14, $15, $16, $17
          )
          RETURNING id
        `,
        [
          marketId,
          fullName,
          identityNumber || null,
          String(payload.phone || '').trim() || null,
          String(payload.address || '').trim() || null,
          String(payload.sectionType || '').trim() || 'Esnaf',
          String(payload.stallNo || '').trim() || null,
          String(payload.stallColor || '').trim() || null,
          String(payload.documentFolderUrl || '').trim() || null,
          toBoolean(payload.hasPhoto),
          toBoolean(payload.hasIdentityCopy),
          toBoolean(payload.hasChamberRecord),
          toBoolean(payload.hasPopulationRecord),
          toBoolean(payload.hasTaxRecord),
          toBoolean(payload.hasCksDocument),
          String(payload.note || '').trim() || null,
          payload.isActive === undefined ? true : toBoolean(payload.isActive),
        ]
      );

      res.status(201).json({ success: true, id: result.rows[0].id });
    } catch (error) {
      console.error('Satıcı kaydı eklenemedi:', error);
      res.status(500).json({ error: 'Satıcı kaydı eklenemedi.' });
    }
  });

  app.put('/api/markets/vendors/:id', async (req, res) => {
    const vendorId = Number(req.params.id);
    const payload = req.body || {};
    const marketId = Number(payload.marketId);
    const fullName = String(payload.fullName || '').trim();
    const identityNumber = String(payload.identityNumber || '').trim();

    if (!vendorId) return res.status(400).json({ error: 'Geçerli satıcı seçilmedi.' });
    if (!marketId) return res.status(400).json({ error: 'Pazar yeri seçilmelidir.' });
    if (!fullName) return res.status(400).json({ error: 'Satıcı adı zorunludur.' });
    if (identityNumber && !/^\d{11}$/.test(identityNumber)) {
      return res.status(400).json({ error: 'TC kimlik numarası 11 haneli olmalıdır.' });
    }

    try {
      const exists = await pool.query('SELECT id FROM market_vendors WHERE id = $1 LIMIT 1', [vendorId]);
      if (!exists.rows.length) return res.status(404).json({ error: 'Satıcı kaydı bulunamadı.' });

      await pool.query(
        `
          UPDATE market_vendors
          SET market_id = $1,
              full_name = $2,
              identity_number = $3,
              phone = $4,
              address = $5,
              section_type = $6,
              stall_no = $7,
              stall_color = $8,
              document_folder_url = $9,
              has_photo = $10,
              has_identity_copy = $11,
              has_chamber_record = $12,
              has_population_record = $13,
              has_tax_record = $14,
              has_cks_document = $15,
              note = $16,
              is_active = $17,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = $18
        `,
        [
          marketId,
          fullName,
          identityNumber || null,
          String(payload.phone || '').trim() || null,
          String(payload.address || '').trim() || null,
          String(payload.sectionType || '').trim() || 'Esnaf',
          String(payload.stallNo || '').trim() || null,
          String(payload.stallColor || '').trim() || null,
          String(payload.documentFolderUrl || '').trim() || null,
          toBoolean(payload.hasPhoto),
          toBoolean(payload.hasIdentityCopy),
          toBoolean(payload.hasChamberRecord),
          toBoolean(payload.hasPopulationRecord),
          toBoolean(payload.hasTaxRecord),
          toBoolean(payload.hasCksDocument),
          String(payload.note || '').trim() || null,
          toBoolean(payload.isActive),
          vendorId,
        ]
      );

      res.json({ success: true });
    } catch (error) {
      console.error('Satıcı kaydı güncellenemedi:', error);
      res.status(500).json({ error: 'Satıcı kaydı güncellenemedi.' });
    }
  });

  app.delete('/api/markets/vendors/:id', async (req, res) => {
    const vendorId = Number(req.params.id);
    if (!vendorId) return res.status(400).json({ error: 'Geçerli satıcı seçilmedi.' });

    try {
      const result = await pool.query('DELETE FROM market_vendors WHERE id = $1 RETURNING id', [vendorId]);
      if (!result.rows.length) return res.status(404).json({ error: 'Satıcı kaydı bulunamadı.' });
      res.json({ success: true });
    } catch (error) {
      console.error('Satıcı kaydı silinemedi:', error);
      res.status(500).json({ error: 'Satıcı kaydı silinemedi.' });
    }
  });

  app.get('/api/markets/leave-records', async (req, res) => {
    const marketId = String(req.query.marketId || 'all');
    const leaveType = String(req.query.leaveType || 'all');
    const activeOnly = String(req.query.activeOnly || 'false') === 'true';

    try {
      const conditions = [];
      const values = [];
      if (marketId !== 'all') {
        values.push(Number(marketId));
        conditions.push(`m.id = $${values.length}`);
      }
      if (leaveType !== 'all') {
        values.push(leaveType);
        conditions.push(`lr.leave_type = $${values.length}`);
      }
      if (activeOnly) {
        values.push(new Date().toISOString().slice(0, 10));
        conditions.push(`$${values.length} BETWEEN lr.start_date AND lr.end_date`);
      }

      const sql = `
        SELECT
          lr.*,
          v.full_name AS vendor_name,
          v.market_id,
          m.name AS market_name
        FROM market_leave_records lr
        INNER JOIN market_vendors v ON v.id = lr.vendor_id
        INNER JOIN market_places m ON m.id = v.market_id
        ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
        ORDER BY lr.start_date DESC, lr.id DESC
      `;

      const result = await pool.query(sql, values);
      res.json(result.rows.map(mapLeave));
    } catch (error) {
      console.error('İzin / rapor kayıtları alınamadı:', error);
      res.status(500).json({ error: 'İzin / rapor kayıtları alınamadı.' });
    }
  });

  app.post('/api/markets/leave-records', async (req, res) => {
    const payload = req.body || {};
    const vendorId = Number(payload.vendorId);
    const leaveType = String(payload.leaveType || '').trim();
    const startDate = toInputDate(payload.startDate);
    const endDate = toInputDate(payload.endDate);

    if (!vendorId) return res.status(400).json({ error: 'Satıcı seçilmelidir.' });
    if (!leaveType) return res.status(400).json({ error: 'İzin / rapor türü seçilmelidir.' });
    if (!startDate || !endDate) return res.status(400).json({ error: 'Başlangıç ve bitiş tarihi zorunludur.' });
    if (endDate < startDate) return res.status(400).json({ error: 'Bitiş tarihi başlangıç tarihinden önce olamaz.' });

    try {
      const exists = await pool.query('SELECT id FROM market_vendors WHERE id = $1 LIMIT 1', [vendorId]);
      if (!exists.rows.length) return res.status(404).json({ error: 'Satıcı kaydı bulunamadı.' });

      const result = await pool.query(
        `
          INSERT INTO market_leave_records (vendor_id, leave_type, start_date, end_date, note)
          VALUES ($1, $2, $3, $4, $5)
          RETURNING id
        `,
        [vendorId, leaveType, startDate, endDate, String(payload.note || '').trim() || null]
      );

      res.status(201).json({ success: true, id: result.rows[0].id });
    } catch (error) {
      console.error('İzin / rapor kaydı eklenemedi:', error);
      res.status(500).json({ error: 'İzin / rapor kaydı eklenemedi.' });
    }
  });

  app.put('/api/markets/leave-records/:id', async (req, res) => {
    const recordId = Number(req.params.id);
    const payload = req.body || {};
    const vendorId = Number(payload.vendorId);
    const leaveType = String(payload.leaveType || '').trim();
    const startDate = toInputDate(payload.startDate);
    const endDate = toInputDate(payload.endDate);

    if (!recordId) return res.status(400).json({ error: 'Geçerli izin / rapor kaydı seçilmedi.' });
    if (!vendorId) return res.status(400).json({ error: 'Satıcı seçilmelidir.' });
    if (!leaveType) return res.status(400).json({ error: 'İzin / rapor türü seçilmelidir.' });
    if (!startDate || !endDate) return res.status(400).json({ error: 'Başlangıç ve bitiş tarihi zorunludur.' });
    if (endDate < startDate) return res.status(400).json({ error: 'Bitiş tarihi başlangıç tarihinden önce olamaz.' });

    try {
      const result = await pool.query(
        `
          UPDATE market_leave_records
          SET vendor_id = $1,
              leave_type = $2,
              start_date = $3,
              end_date = $4,
              note = $5,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = $6
          RETURNING id
        `,
        [vendorId, leaveType, startDate, endDate, String(payload.note || '').trim() || null, recordId]
      );

      if (!result.rows.length) return res.status(404).json({ error: 'İzin / rapor kaydı bulunamadı.' });
      res.json({ success: true });
    } catch (error) {
      console.error('İzin / rapor kaydı güncellenemedi:', error);
      res.status(500).json({ error: 'İzin / rapor kaydı güncellenemedi.' });
    }
  });

  app.delete('/api/markets/leave-records/:id', async (req, res) => {
    const recordId = Number(req.params.id);
    if (!recordId) return res.status(400).json({ error: 'Geçerli izin / rapor kaydı seçilmedi.' });

    try {
      const result = await pool.query('DELETE FROM market_leave_records WHERE id = $1 RETURNING id', [recordId]);
      if (!result.rows.length) return res.status(404).json({ error: 'İzin / rapor kaydı bulunamadı.' });
      res.json({ success: true });
    } catch (error) {
      console.error('İzin / rapor kaydı silinemedi:', error);
      res.status(500).json({ error: 'İzin / rapor kaydı silinemedi.' });
    }
  });

  app.get('/api/markets/attendance-sheet', async (req, res) => {
    const marketId = Number(req.query.marketId);
    const attendanceDate = toInputDate(req.query.date);

    if (!marketId) return res.status(400).json({ error: 'Pazar seçilmelidir.' });
    if (!attendanceDate) return res.status(400).json({ error: 'Yoklama tarihi zorunludur.' });

    try {
      const result = await pool.query(
        `
          SELECT
            v.id AS vendor_id,
            v.market_id,
            m.name AS market_name,
            v.full_name AS vendor_name,
            v.section_type,
            v.stall_no,
            v.stall_color,
            a.id AS attendance_id,
            a.attendance_date,
            a.status AS attendance_status,
            a.note AS attendance_note,
            lr.leave_type,
            lr.note AS leave_note,
            lr.start_date AS leave_start_date,
            lr.end_date AS leave_end_date
          FROM market_vendors v
          INNER JOIN market_places m ON m.id = v.market_id
          LEFT JOIN market_attendance a
            ON a.vendor_id = v.id
           AND a.attendance_date = $2
          LEFT JOIN LATERAL (
            SELECT *
            FROM market_leave_records lr2
            WHERE lr2.vendor_id = v.id
              AND $2 BETWEEN lr2.start_date AND lr2.end_date
            ORDER BY lr2.end_date DESC, lr2.id DESC
            LIMIT 1
          ) lr ON TRUE
          WHERE v.market_id = $1
            AND (v.is_active = TRUE OR a.id IS NOT NULL)
          ORDER BY v.section_type ASC, NULLIF(v.stall_no, '') ASC, v.full_name ASC
        `,
        [marketId, attendanceDate]
      );

      res.json(result.rows.map((row) => mapAttendanceRow(row, attendanceDate)));
    } catch (error) {
      console.error('Yoklama sayfası alınamadı:', error);
      res.status(500).json({ error: 'Yoklama sayfası alınamadı.' });
    }
  });

  app.post('/api/markets/attendance/bulk', async (req, res) => {
    const payload = req.body || {};
    const attendanceDate = toInputDate(payload.date);
    const entries = Array.isArray(payload.entries) ? payload.entries : [];

    if (!attendanceDate) return res.status(400).json({ error: 'Yoklama tarihi zorunludur.' });
    if (!entries.length) return res.status(400).json({ error: 'Kaydedilecek yoklama satırı bulunamadı.' });

    const allowedStatuses = new Set(['Var', 'Yok', 'İzinli', 'Raporlu']);
    const vendorIds = Array.from(new Set(entries.map((item) => Number(item.vendorId)).filter(Boolean)));

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const lockedStatusMap = new Map();
      if (vendorIds.length) {
        const leaveResult = await client.query(
          `
            SELECT vendor_id, leave_type
            FROM market_leave_records
            WHERE vendor_id = ANY($1::int[])
              AND $2 BETWEEN start_date AND end_date
            ORDER BY end_date DESC, id DESC
          `,
          [vendorIds, attendanceDate]
        );

        for (const row of leaveResult.rows) {
          if (!lockedStatusMap.has(row.vendor_id)) lockedStatusMap.set(row.vendor_id, row.leave_type);
        }
      }

      for (const item of entries) {
        const vendorId = Number(item.vendorId);
        const requestedStatus = String(item.status || '').trim();
        const note = String(item.note || '').trim();
        if (!vendorId) continue;

        const finalStatus = lockedStatusMap.get(vendorId) || requestedStatus;
        if (!allowedStatuses.has(finalStatus)) continue;

        await client.query(
          `
            INSERT INTO market_attendance (vendor_id, attendance_date, status, note)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (vendor_id, attendance_date)
            DO UPDATE SET
              status = EXCLUDED.status,
              note = EXCLUDED.note,
              updated_at = CURRENT_TIMESTAMP
          `,
          [vendorId, attendanceDate, finalStatus, note || null]
        );
      }

      await client.query('COMMIT');
      res.json({ success: true });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Yoklama kaydedilemedi:', error);
      res.status(500).json({ error: 'Yoklama kaydedilemedi.' });
    } finally {
      client.release();
    }
  });

  app.delete('/api/markets/attendance-session', async (req, res) => {
    const marketId = Number(req.query.marketId);
    const attendanceDate = toInputDate(req.query.date);

    if (!marketId) return res.status(400).json({ error: 'Pazar seçilmelidir.' });
    if (!attendanceDate) return res.status(400).json({ error: 'Yoklama tarihi zorunludur.' });

    try {
      const result = await pool.query(
        `
          DELETE FROM market_attendance a
          USING market_vendors v
          WHERE a.vendor_id = v.id
            AND v.market_id = $1
            AND a.attendance_date = $2
          RETURNING a.id
        `,
        [marketId, attendanceDate]
      );

      if (!result.rows.length) return res.status(404).json({ error: 'Silinecek yoklama kaydı bulunamadı.' });
      res.json({ success: true, deletedCount: result.rows.length });
    } catch (error) {
      console.error('Yoklama oturumu silinemedi:', error);
      res.status(500).json({ error: 'Yoklama oturumu silinemedi.' });
    }
  });

  app.get('/api/markets/attendance-session-detail', async (req, res) => {
    const marketId = Number(req.query.marketId);
    const attendanceDate = toInputDate(req.query.date);

    if (!marketId) return res.status(400).json({ error: 'Pazar seçilmelidir.' });
    if (!attendanceDate) return res.status(400).json({ error: 'Yoklama tarihi zorunludur.' });

    try {
      const result = await pool.query(
        `
          SELECT
            a.id,
            a.attendance_date,
            a.status,
            a.note,
            a.updated_at,
            v.id AS vendor_id,
            v.full_name AS vendor_name,
            v.market_id,
            m.name AS market_name,
            v.section_type,
            v.stall_no,
            v.stall_color
          FROM market_attendance a
          INNER JOIN market_vendors v ON v.id = a.vendor_id
          INNER JOIN market_places m ON m.id = v.market_id
          WHERE v.market_id = $1
            AND a.attendance_date = $2
          ORDER BY v.section_type ASC, NULLIF(v.stall_no, '') ASC, v.full_name ASC
        `,
        [marketId, attendanceDate]
      );

      const rows = result.rows.map((row) => ({
        id: row.id,
        attendanceDate: toInputDate(row.attendance_date),
        attendanceDateText: formatDate(row.attendance_date),
        status: row.status,
        note: row.note || '',
        updatedAt: formatDateTime(row.updated_at),
        vendorId: row.vendor_id,
        vendorName: row.vendor_name,
        marketId: row.market_id,
        marketName: row.market_name,
        sectionType: row.section_type,
        stallLabel: buildStallLabel(row),
      }));

      const marketName = rows.length ? rows[0].marketName : '';
      const updatedAt = rows.length ? rows[0].updatedAt : '';
      let presentCount = 0;
      let absentCount = 0;
      let leaveCount = 0;
      let reportCount = 0;
      for (const row of rows) {
        if (row.status === 'Var') presentCount += 1;
        else if (row.status === 'Yok') absentCount += 1;
        else if (row.status === 'İzinli') leaveCount += 1;
        else if (row.status === 'Raporlu') reportCount += 1;
      }

      res.json({
        marketId,
        marketName,
        attendanceDate,
        attendanceDateText: formatDate(attendanceDate),
        updatedAt,
        recordCount: rows.length,
        presentCount,
        absentCount,
        leaveCount,
        reportCount,
        rows,
      });
    } catch (error) {
      console.error('Yoklama oturum detayı alınamadı:', error);
      res.status(500).json({ error: 'Yoklama oturum detayı alınamadı.' });
    }
  });

  app.get('/api/markets/attendance-history-summary', async (req, res) => {
    const marketId = String(req.query.marketId || 'all');
    const limit = Math.min(120, Math.max(10, Number(req.query.limit || 40)));

    try {
      const values = [];
      const conditions = [];
      if (marketId !== 'all') {
        values.push(Number(marketId));
        conditions.push(`v.market_id = $${values.length}`);
      }
      values.push(limit);
      const sql = `
        SELECT
          a.attendance_date,
          v.market_id,
          m.name AS market_name,
          COUNT(a.id)::int AS record_count,
          COUNT(a.id) FILTER (WHERE a.status = 'Var')::int AS present_count,
          COUNT(a.id) FILTER (WHERE a.status = 'Yok')::int AS absent_count,
          COUNT(a.id) FILTER (WHERE a.status = 'İzinli')::int AS leave_count,
          COUNT(a.id) FILTER (WHERE a.status = 'Raporlu')::int AS report_count,
          MAX(a.updated_at) AS updated_at
        FROM market_attendance a
        INNER JOIN market_vendors v ON v.id = a.vendor_id
        INNER JOIN market_places m ON m.id = v.market_id
        ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
        GROUP BY a.attendance_date, v.market_id, m.name, m.display_order
        ORDER BY a.attendance_date DESC, m.display_order ASC, m.name ASC
        LIMIT $${values.length}
      `;

      const result = await pool.query(sql, values);
      res.json(result.rows.map((row) => ({
        attendanceDate: toInputDate(row.attendance_date),
        attendanceDateText: formatDate(row.attendance_date),
        marketId: row.market_id,
        marketName: row.market_name,
        recordCount: Number(row.record_count || 0),
        presentCount: Number(row.present_count || 0),
        absentCount: Number(row.absent_count || 0),
        leaveCount: Number(row.leave_count || 0),
        reportCount: Number(row.report_count || 0),
        updatedAt: formatDateTime(row.updated_at),
      })));
    } catch (error) {
      console.error('Yoklama tarih özeti alınamadı:', error);
      res.status(500).json({ error: 'Yoklama tarih özeti alınamadı.' });
    }
  });

  app.get('/api/markets/attendance-history', async (req, res) => {
    const marketId = String(req.query.marketId || 'all');
    const limit = Math.min(120, Math.max(10, Number(req.query.limit || 40)));

    try {
      const values = [];
      const conditions = [];
      if (marketId !== 'all') {
        values.push(Number(marketId));
        conditions.push(`v.market_id = $${values.length}`);
      }
      values.push(limit);
      const sql = `
        SELECT
          a.id,
          a.attendance_date,
          a.status,
          a.note,
          a.updated_at,
          v.id AS vendor_id,
          v.full_name AS vendor_name,
          v.market_id,
          m.name AS market_name,
          v.section_type,
          v.stall_no,
          v.stall_color
        FROM market_attendance a
        INNER JOIN market_vendors v ON v.id = a.vendor_id
        INNER JOIN market_places m ON m.id = v.market_id
        ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
        ORDER BY a.attendance_date DESC, m.display_order ASC, v.section_type ASC, NULLIF(v.stall_no, '') ASC, v.full_name ASC
        LIMIT $${values.length}
      `;

      const result = await pool.query(sql, values);
      res.json(result.rows.map((row) => ({
        id: row.id,
        attendanceDate: toInputDate(row.attendance_date),
        attendanceDateText: formatDate(row.attendance_date),
        status: row.status,
        note: row.note || '',
        updatedAt: formatDateTime(row.updated_at),
        vendorId: row.vendor_id,
        vendorName: row.vendor_name,
        marketId: row.market_id,
        marketName: row.market_name,
        sectionType: row.section_type,
        stallLabel: buildStallLabel(row),
      })));
    } catch (error) {
      console.error('Yoklama geçmişi alınamadı:', error);
      res.status(500).json({ error: 'Yoklama geçmişi alınamadı.' });
    }
  });
}

module.exports = {
  initMarketModuleDb,
  registerMarketModule,
};
