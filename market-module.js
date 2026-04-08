const path = require('path');
const multer = require('multer');
const XLSX = require('xlsx');

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

const vendorImportUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

function normalizeTextForMatch(value) {
  return String(value || '')
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeCellValue(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function normalizeMarketNameForMatch(value) {
  const normalized = normalizeTextForMatch(value);
  return normalized
    .replace(/pazari/g, '')
    .replace(/pazar/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeHeaderText(value) {
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

function pickRowValue(row, aliases) {
  for (const alias of aliases) {
    if (Object.prototype.hasOwnProperty.call(row, alias)) {
      const value = sanitizeCellValue(row[alias]);
      if (value) return value;
    }
  }
  return '';
}

function buildRowAccessor(rowMap) {
  return function getValue(aliases) {
    for (const alias of aliases) {
      const normalizedAlias = normalizeHeaderText(alias);
      if (normalizedAlias && Object.prototype.hasOwnProperty.call(rowMap, normalizedAlias)) {
        const value = sanitizeCellValue(rowMap[normalizedAlias]);
        if (value) return value;
      }
    }
    return '';
  };
}

function extractVendorImportSheetData(workbook) {
  const fieldAliases = {
    marketName: ['Pazar Adı', 'Pazar', 'Pazar Yeri', 'Market'],
    sectionType: ['Bölüm', 'Bolum', 'Section'],
    stallColor: ['Yer Rengi', 'Numara Rengi', 'Renk', 'Stall Color'],
    stallNo: ['Yer No', 'Yer / Tezgâh No', 'Yer / Tezgah No', 'Tezgah No', 'Tezgâh No', 'Stall No'],
    fullName: ['Ad Soyad', 'Satıcı', 'Satıcı Adı Soyadı', 'Adı Soyadı', 'Full Name'],
    identityNumber: ['T.C. Kimlik No', 'TC Kimlik No', 'T.C.', 'TC'],
    phone: ['Telefon', 'Cep Telefonu', 'Phone'],
    address: ['Adres', 'Address'],
    note: ['Not', 'Açıklama', 'Aciklama'],
    documentFolderUrl: ['Drive Klasörü', 'Belge Klasörü', 'Klasör Linki', 'Drive'],
    documentSummary: ['Belge Özeti', 'Belge Durumu', 'Belge', 'Dokuman', 'Doküman'],
    statusText: ['Kayıt Durumu', 'Durum', 'Aktiflik'],
  };

  const normalizedAliasMap = {};
  Object.keys(fieldAliases).forEach((key) => {
    normalizedAliasMap[key] = fieldAliases[key].map((alias) => normalizeHeaderText(alias)).filter(Boolean);
  });

  let bestMatch = null;

  workbook.SheetNames.forEach((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return;
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
    rows.forEach((row, rowIndex) => {
      const normalizedCells = row.map((cell) => normalizeHeaderText(cell));
      const headerIndexMap = {};
      Object.keys(normalizedAliasMap).forEach((key) => {
        const aliases = normalizedAliasMap[key];
        const foundIndex = normalizedCells.findIndex((cell) => aliases.includes(cell));
        if (foundIndex !== -1) headerIndexMap[key] = foundIndex;
      });

      const score = Object.keys(headerIndexMap).length;
      const hasRequiredHeaders = ['marketName', 'sectionType', 'stallNo', 'fullName'].every((key) => headerIndexMap[key] !== undefined);
      if (!hasRequiredHeaders) return;

      if (!bestMatch || score > bestMatch.score || (score === bestMatch.score && rowIndex < bestMatch.headerRowIndex)) {
        bestMatch = {
          sheetName,
          headerRowIndex: rowIndex,
          headerIndexMap,
          score,
          rows,
        };
      }
    });
  });

  if (!bestMatch) {
    throw new Error('Excel şablonunda gerekli sütun başlıkları bulunamadı. Pazar Adı, Bölüm, Yer Rengi, Yer No ve Ad Soyad başlıklarını kontrol edin.');
  }

  const dataRows = [];
  for (let index = bestMatch.headerRowIndex + 1; index < bestMatch.rows.length; index += 1) {
    const row = bestMatch.rows[index] || [];
    const rowMap = {};
    Object.entries(bestMatch.headerIndexMap).forEach(([key, columnIndex]) => {
      rowMap[key] = sanitizeCellValue(row[columnIndex]);
    });

    const hasAnyCoreData = [
      rowMap.marketName,
      rowMap.sectionType,
      rowMap.stallColor,
      rowMap.stallNo,
      rowMap.fullName,
      rowMap.identityNumber,
      rowMap.phone,
      rowMap.address,
      rowMap.note,
      rowMap.documentFolderUrl,
      rowMap.documentSummary,
      rowMap.statusText,
    ].some((value) => sanitizeCellValue(value));
    if (!hasAnyCoreData) continue;

    dataRows.push({
      rowNumber: index + 1,
      rawRow: {
        'Pazar Adı': sanitizeCellValue(rowMap.marketName),
        'Bölüm': sanitizeCellValue(rowMap.sectionType),
        'Yer Rengi': sanitizeCellValue(rowMap.stallColor),
        'Yer No': sanitizeCellValue(rowMap.stallNo),
        'Ad Soyad': sanitizeCellValue(rowMap.fullName),
        'T.C. Kimlik No': sanitizeCellValue(rowMap.identityNumber),
        'Telefon': sanitizeCellValue(rowMap.phone),
        'Adres': sanitizeCellValue(rowMap.address),
        'Not': sanitizeCellValue(rowMap.note),
        'Drive Klasörü': sanitizeCellValue(rowMap.documentFolderUrl),
        'Belge Özeti': sanitizeCellValue(rowMap.documentSummary),
        'Kayıt Durumu': sanitizeCellValue(rowMap.statusText),
      },
    });
  }

  if (!dataRows.length) {
    throw new Error('Excel dosyasında başlıklardan sonra okunacak satır bulunamadı.');
  }

  return dataRows;
}

function getDocumentFlagsFromImportRow(sectionType, rawRow) {
  const requiredKeys = getRequiredDocumentKeys(sectionType || '');
  const flags = {
    hasPhoto: false,
    hasIdentityCopy: false,
    hasChamberRecord: false,
    hasPopulationRecord: false,
    hasTaxRecord: false,
    hasCksDocument: false,
  };
  const summaryText = normalizeTextForMatch(pickRowValue(rawRow, ['Belge Özeti', 'Belge Durumu', 'Belge', 'Dokuman', 'Doküman']));
  if (summaryText && ['belge girilmedi', 'yok', 'eksik', '-', 'belgesiz'].includes(summaryText)) {
    return flags;
  }
  Object.keys(flags).forEach((key) => {
    const label = MARKET_DOCUMENT_LABELS[key];
    const value = pickRowValue(rawRow, [label, key]);
    if (value) flags[key] = toBoolean(value);
  });
  const hasAnyExplicitFlag = Object.keys(flags).some((key) => flags[key]);
  if (!hasAnyExplicitFlag && summaryText) {
    if (['tam', 'tamam', 'tamamlandi', 'tamamlandı', 'eksiksiz'].includes(summaryText)) {
      requiredKeys.forEach((key) => { flags[key] = true; });
    }
  }
  return flags;
}

async function buildVendorImportPreview(pool, fileBuffer) {
  const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
  if (!workbook.SheetNames || !workbook.SheetNames.length) {
    throw new Error('Excel dosyasında okunacak sayfa bulunamadı.');
  }
  const rawRows = extractVendorImportSheetData(workbook);

  const marketRows = await pool.query('SELECT id, name FROM market_places');
  const marketMap = new Map();
  marketRows.rows.forEach((row) => {
    const exactKey = normalizeTextForMatch(row.name);
    const shortKey = normalizeMarketNameForMatch(row.name);
    if (exactKey && !marketMap.has(exactKey)) marketMap.set(exactKey, row);
    if (shortKey && !marketMap.has(shortKey)) marketMap.set(shortKey, row);
  });
  const existingVendorRows = await pool.query(`
    SELECT market_id, section_type, COALESCE(stall_color, '') AS stall_color, COALESCE(stall_no, '') AS stall_no
    FROM market_vendors
  `);
  const existingKeySet = new Set(
    existingVendorRows.rows.map((row) => [
      String(row.market_id),
      normalizeTextForMatch(row.section_type),
      normalizeTextForMatch(row.stall_color),
      normalizeTextForMatch(row.stall_no),
    ].join('|'))
  );

  const previewRows = [];
  const fileKeySet = new Set();
  const warnings = [];

  for (let index = 0; index < rawRows.length; index += 1) {
    const rowEntry = rawRows[index] || {};
    const rawRow = rowEntry.rawRow || {};
    const rowNumber = rowEntry.rowNumber || (index + 2);
    const marketName = pickRowValue(rawRow, ['Pazar Adı', 'Pazar', 'Pazar Yeri', 'Market']);
    const sectionType = pickRowValue(rawRow, ['Bölüm', 'Bolum', 'Section']) || 'Esnaf';
    const stallColor = pickRowValue(rawRow, ['Yer Rengi', 'Numara Rengi', 'Renk', 'Stall Color']);
    const stallNo = pickRowValue(rawRow, ['Yer No', 'Yer / Tezgâh No', 'Tezgah No', 'Tezgâh No', 'Stall No']);
    const fullName = pickRowValue(rawRow, ['Ad Soyad', 'Satıcı', 'Satıcı Adı Soyadı', 'Adı Soyadı', 'Full Name']);
    const identityNumber = pickRowValue(rawRow, ['T.C. Kimlik No', 'TC Kimlik No', 'T.C.', 'TC']);
    const phone = pickRowValue(rawRow, ['Telefon', 'Cep Telefonu', 'Phone']);
    const address = pickRowValue(rawRow, ['Adres', 'Address']);
    const note = pickRowValue(rawRow, ['Not', 'Açıklama', 'Aciklama']);
    const documentFolderUrl = pickRowValue(rawRow, ['Drive Klasörü', 'Belge Klasörü', 'Klasör Linki', 'Drive']);
    const statusText = normalizeTextForMatch(pickRowValue(rawRow, ['Kayıt Durumu', 'Durum', 'Aktiflik']));
    const isActive = !statusText || ['aktif', 'active', '1', 'evet', 'var'].includes(statusText);

    const normalizedMarketName = normalizeTextForMatch(marketName);
    const market = marketMap.get(normalizedMarketName) || marketMap.get(normalizeMarketNameForMatch(marketName));
    const normalizedSection = normalizeSectionText(sectionType);
    const sectionTypeResolved = MARKET_SECTION_ORDER.find((item) => normalizeSectionText(item) === normalizedSection) || sectionType;
    const documentFlags = getDocumentFlagsFromImportRow(sectionTypeResolved, rawRow);

    const errors = [];
    if (!marketName) errors.push('Pazar adı boş');
    if (!market) errors.push('Pazar eşleşmedi');
    if (!fullName) errors.push('Ad Soyad boş');
    if (!stallNo) errors.push('Yer No boş');
    if (!sectionTypeResolved) errors.push('Bölüm boş');
    if (identityNumber && !/^\d{11}$/.test(identityNumber)) errors.push('TC kimlik no 11 haneli değil');

    const duplicateKey = market ? [
      String(market.id),
      normalizeTextForMatch(sectionTypeResolved),
      normalizeTextForMatch(stallColor),
      normalizeTextForMatch(stallNo),
    ].join('|') : '';

    if (duplicateKey && fileKeySet.has(duplicateKey)) errors.push('Dosya içinde aynı yer no tekrar ediyor');
    if (duplicateKey && existingKeySet.has(duplicateKey)) errors.push('Aynı pazar / bölüm / renk / yer no zaten kayıtlı');
    if (duplicateKey) fileKeySet.add(duplicateKey);

    const item = {
      rowNumber,
      marketId: market ? market.id : null,
      marketName: market ? market.name : marketName,
      sectionType: sectionTypeResolved,
      stallColor,
      stallNo,
      fullName,
      identityNumber,
      phone,
      address,
      note,
      documentFolderUrl,
      isActive,
      hasPhoto: documentFlags.hasPhoto,
      hasIdentityCopy: documentFlags.hasIdentityCopy,
      hasChamberRecord: documentFlags.hasChamberRecord,
      hasPopulationRecord: documentFlags.hasPopulationRecord,
      hasTaxRecord: documentFlags.hasTaxRecord,
      hasCksDocument: documentFlags.hasCksDocument,
      errors,
    };
    previewRows.push(item);
    if (errors.length) {
      warnings.push('Satır ' + rowNumber + ': ' + errors.join(', '));
    }
  }

  return {
    totalRows: previewRows.length,
    validRows: previewRows.filter((item) => !item.errors.length).length,
    invalidRows: previewRows.filter((item) => item.errors.length).length,
    rows: previewRows,
    warnings,
  };
}

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


function safeFilePart(value) {
  return String(value || 'kayit')
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'kayit';
}

function buildAttendanceDetailFilename(marketName, attendanceDate) {
  return `yoklama-detay-${safeFilePart(marketName || 'pazar')}-${safeFilePart(attendanceDate || 'tarih')}.xlsx`;
}

function buildVendorExportFilename(marketText, sectionText) {
  return `satici-listesi-${safeFilePart(marketText || 'tum-pazarlar')}-${safeFilePart(sectionText || 'tum-bolumler')}.xlsx`;
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

async function getMarketVendorRows(pool, filters = {}) {
  const marketId = String(filters.marketId || 'all');
  const section = String(filters.section || 'all');
  const status = String(filters.status || 'all');
  const docStatus = String(filters.docStatus || 'all');
  const search = String(filters.search || '').trim();

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

  return rows;
}

async function getMarketNameById(pool, marketId) {
  if (!marketId || String(marketId) === 'all') return 'Tüm Pazarlar';
  const result = await pool.query('SELECT name FROM market_places WHERE id = $1 LIMIT 1', [Number(marketId)]);
  return result.rows[0] ? result.rows[0].name : 'Seçili Pazar';
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

  app.get('/markets/mobile-attendance', (req, res) => {
    res.sendFile(path.join(__dirname, 'markets-mobile-attendance.html'));
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
    try {
      const rows = await getMarketVendorRows(pool, req.query || {});
      res.json(rows);
    } catch (error) {
      console.error('Pazar satıcıları alınamadı:', error);
      res.status(500).json({ error: 'Pazar satıcıları alınamadı.' });
    }
  });

  app.get('/api/markets/vendors/export.xlsx', async (req, res) => {
    try {
      const filters = req.query || {};
      const rows = await getMarketVendorRows(pool, filters);
      const marketText = await getMarketNameById(pool, filters.marketId);
      const sectionText = String(filters.section || 'all') === 'all' ? 'Tüm Bölümler' : String(filters.section || 'Tüm Bölümler');
      const statusText = String(filters.status || 'all') === 'active' ? 'Aktif Satıcı' : (String(filters.status || 'all') === 'passive' ? 'Pasif Satıcı' : 'Tüm Durumlar');
      const docStatusText = String(filters.docStatus || 'all') === 'complete' ? 'Belgeleri Tam' : (String(filters.docStatus || 'all') === 'missing' ? 'Belgesi Eksik' : 'Belge Durumu');
      const searchText = String(filters.search || '').trim() || 'Yok';

      const workbook = XLSX.utils.book_new();
      const summaryRows = [
        ['Pazar', marketText],
        ['Bölüm', sectionText],
        ['Durum', statusText],
        ['Belge Durumu', docStatusText],
        ['Arama', searchText],
        ['Toplam Satıcı', rows.length],
        ['Aktif', rows.filter((item) => item.isActive).length],
        ['Pasif', rows.filter((item) => !item.isActive).length],
        ['Belgeleri Tam', rows.filter((item) => item.documents && item.documents.isComplete).length],
        ['Belgesi Eksik', rows.filter((item) => item.documents && !item.documents.isComplete).length],
      ];
      const dataRows = rows.map((item) => ({
        'Satıcı': item.fullName || '',
        'TC Kimlik No': item.identityNumber || '',
        'Telefon': item.phone || '',
        'Pazar': item.marketName || '',
        'Pazar Günü': item.scheduledDayLabel || '',
        'Bölüm': item.sectionType || '',
        'Yer No': item.stallLabel || '',
        'Durum': item.isActive ? 'Aktif' : 'Pasif',
        'Belge Tamamlanma': `${item.documents.completedCount || 0} / ${item.documents.totalRequired || 0}`,
        'Eksik Belgeler': (item.documents && item.documents.missingDocs || []).join(', '),
        'Drive Klasörü': item.documentFolderUrl || '',
        'Adres': item.address || '',
        'Not': item.note || '',
        'Oluşturma': item.createdAt || '',
        'Güncelleme': item.updatedAt || '',
      }));
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(summaryRows), 'Filtre Özeti');
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(dataRows), 'Satıcı Listesi');
      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Disposition', `attachment; filename="${buildVendorExportFilename(marketText, sectionText)}"`);
      res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.send(buffer);
    } catch (error) {
      console.error('Satıcı Excel çıktısı oluşturulamadı:', error);
      res.status(500).json({ error: 'Satıcı Excel çıktısı oluşturulamadı.' });
    }
  });


  app.post('/api/markets/vendors/import/preview', vendorImportUpload.single('file'), async (req, res) => {
    try {
      if (!req.file || !req.file.buffer) {
        return res.status(400).json({ error: 'Excel dosyası yüklenmedi.' });
      }
      const preview = await buildVendorImportPreview(pool, req.file.buffer);
      res.json(preview);
    } catch (error) {
      console.error('Satıcı import önizlemesi oluşturulamadı:', error);
      res.status(400).json({ error: error.message || 'Excel dosyası okunamadı.' });
    }
  });

  app.post('/api/markets/vendors/import/commit', async (req, res) => {
    const rows = Array.isArray(req.body && req.body.rows) ? req.body.rows : [];
    if (!rows.length) {
      return res.status(400).json({ error: 'İçe aktarılacak satır bulunamadı.' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      let insertedCount = 0;
      let skippedCount = 0;
      const skippedRows = [];
      for (const item of rows) {
        const marketId = Number(item.marketId);
        const fullName = String(item.fullName || '').trim();
        const sectionType = String(item.sectionType || '').trim() || 'Esnaf';
        const stallColor = String(item.stallColor || '').trim();
        const stallNo = String(item.stallNo || '').trim();
        const duplicateCheck = await client.query(
          `SELECT id FROM market_vendors WHERE market_id = $1 AND section_type = $2 AND COALESCE(stall_color, '') = $3 AND COALESCE(stall_no, '') = $4 LIMIT 1`,
          [marketId, sectionType, stallColor, stallNo]
        );
        if (!marketId || !fullName || !stallNo || duplicateCheck.rows.length) {
          skippedCount += 1;
          skippedRows.push({
            rowNumber: item.rowNumber || null,
            fullName,
            stallNo,
            reason: duplicateCheck.rows.length ? 'Aynı yer no zaten kayıtlı' : 'Zorunlu alan eksik',
          });
          continue;
        }
        await client.query(
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
          `,
          [
            marketId,
            fullName,
            String(item.identityNumber || '').trim() || null,
            String(item.phone || '').trim() || null,
            String(item.address || '').trim() || null,
            sectionType,
            stallNo,
            stallColor || null,
            String(item.documentFolderUrl || '').trim() || null,
            toBoolean(item.hasPhoto),
            toBoolean(item.hasIdentityCopy),
            toBoolean(item.hasChamberRecord),
            toBoolean(item.hasPopulationRecord),
            toBoolean(item.hasTaxRecord),
            toBoolean(item.hasCksDocument),
            String(item.note || '').trim() || null,
            item.isActive === undefined ? true : toBoolean(item.isActive),
          ]
        );
        insertedCount += 1;
      }
      await client.query('COMMIT');
      res.status(201).json({ success: true, insertedCount, skippedCount, skippedRows });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Satıcı import kaydı yapılamadı:', error);
      res.status(500).json({ error: 'Toplu satıcı aktarımı tamamlanamadı.' });
    } finally {
      client.release();
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


  app.get('/api/markets/attendance-session-detail/export.xlsx', async (req, res) => {
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
        status: row.status || '',
        note: row.note || '',
        updatedAt: formatDateTime(row.updated_at),
        vendorId: row.vendor_id,
        vendorName: row.vendor_name || '',
        marketId: row.market_id,
        marketName: row.market_name || '',
        sectionType: row.section_type || '',
        stallLabel: buildStallLabel(row),
      }));

      const marketName = rows.length ? rows[0].marketName : 'Pazar';
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

      const workbook = XLSX.utils.book_new();
      const summaryRows = [
        { Alan: 'Pazar', Değer: marketName },
        { Alan: 'Yoklama Tarihi', Değer: formatDate(attendanceDate) },
        { Alan: 'Toplam Kayıt', Değer: rows.length },
        { Alan: 'Var', Değer: presentCount },
        { Alan: 'Yok', Değer: absentCount },
        { Alan: 'İzinli', Değer: leaveCount },
        { Alan: 'Raporlu', Değer: reportCount },
      ];
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summaryRows), 'Özet');

      const detailRows = rows.map((row, index) => ({
        Sıra: index + 1,
        'Satıcı Adı Soyadı': row.vendorName,
        'Bölüm': row.sectionType,
        'Yer / Tezgâh': row.stallLabel || '',
        'Durum': row.status || '',
        'Not': row.note || '',
        'Son Güncelleme': row.updatedAt || '',
      }));
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(detailRows.length ? detailRows : [{ Bilgi: 'Bu tarihe ait yoklama kaydı bulunamadı.' }]), 'Yoklama Listesi');

      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${buildAttendanceDetailFilename(marketName, attendanceDate)}"`);
      res.send(buffer);
    } catch (error) {
      console.error('Yoklama detay Excel çıktısı oluşturulamadı:', error);
      res.status(500).json({ error: 'Yoklama detay Excel çıktısı oluşturulamadı.' });
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
