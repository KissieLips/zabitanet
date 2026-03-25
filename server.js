const express = require("express");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

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

  return new Intl.DateTimeFormat("tr-TR").format(d);
}

function formatDateTime(value) {
  if (!value) return "";

  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);

  return new Intl.DateTimeFormat("tr-TR", {
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
    await pool.query("DELETE FROM complaints WHERE id = $1", [id]);
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Kayıt silinemedi." });
  }
});

app.get("/", (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Zabıta Yönetim Sistemi - Şikayet Takip Sistemi</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Arial, Helvetica, sans-serif; background: #f3f4f6; color: #1f2937; }
    .app { display: flex; min-height: 100vh; }
    .sidebar { width: 320px; background: #183b68; color: #ffffff; padding: 0; flex-shrink: 0; }
    .sidebar-top { padding: 28px 22px 18px 22px; border-bottom: 1px solid rgba(255,255,255,0.12); }
    .brand { font-size: 20px; font-weight: 700; margin-bottom: 8px; line-height: 1.35; }
    .brand-sub { font-size: 14px; color: rgba(255,255,255,0.82); }
    .menu { padding: 18px 0; }
    .menu-item { padding: 16px 22px; font-size: 16px; display: flex; align-items: center; gap: 12px; color: #ffffff; text-decoration: none; border-left: 4px solid transparent; }
    .menu-item:hover { background: rgba(255,255,255,0.08); }
    .menu-item.active { background: #f5b301; color: #ffffff; font-weight: 700; }
    .main { flex: 1; padding: 28px; }
    .topbar { background: #ffffff; border-radius: 16px; padding: 20px 24px; box-shadow: 0 2px 12px rgba(0,0,0,0.06); display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; gap: 16px; flex-wrap: wrap; }
    .topbar-title { font-size: 20px; font-weight: 700; }
    .date-pill { background: #2563eb; color: #ffffff; border-radius: 8px; padding: 10px 14px; font-weight: 700; font-size: 14px; }
    .section-actions { display: flex; gap: 12px; flex-wrap: wrap; }
    .btn { border: none; border-radius: 10px; padding: 12px 18px; font-size: 15px; font-weight: 700; cursor: pointer; transition: 0.2s ease; }
    .btn:hover { opacity: 0.92; }
    .btn-primary { background: #2563eb; color: #ffffff; }
    .btn-info { background: #06b6d4; color: #ffffff; }
    .btn-warning { background: #f5b301; color: #1f2937; }
    .btn-secondary { background: #6b7280; color: #ffffff; }
    .btn-danger { background: #ef4444; color: #ffffff; }
    .cards {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
  margin-bottom: 24px;
}

.card {
  background: #ffffff;
  border-radius: 14px;
  padding: 18px;
  box-shadow: 0 2px 12px rgba(0,0,0,0.06);
  min-height: 120px;
}
    .card-icon {
  width: 46px;
  height: 46px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  margin-bottom: 14px;
}
    .icon-yellow { background: #fef3c7; }
    .icon-blue { background: #dbeafe; }
    .icon-green { background: #dcfce7; }
    .icon-gray { background: #e5e7eb; }
    .card-number {
  font-size: 28px;
  font-weight: 700;
  margin-bottom: 6px;
}
    ..card-label {
  font-size: 14px;
  color: #6b7280;
}
    .panel { background: #ffffff; border-radius: 16px; padding: 22px; box-shadow: 0 2px 12px rgba(0,0,0,0.06); margin-bottom: 24px; }
    .filters { display: grid; grid-template-columns: 200px 1fr 1fr 1.2fr 180px; gap: 16px; align-items: center; }
    input, select, textarea { width: 100%; border: 1px solid #d1d5db; border-radius: 10px; padding: 13px 14px; font-size: 15px; outline: none; background: #ffffff; }
    textarea { resize: vertical; min-height: 96px; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; padding: 16px 12px; font-size: 15px; color: #111827; border-bottom: 1px solid #e5e7eb; }
    td { padding: 16px 12px; border-bottom: 1px solid #e5e7eb; font-size: 15px; vertical-align: middle; }
    .complaint-no { font-weight: 700; }
    .badge { display: inline-flex; align-items: center; gap: 8px; padding: 7px 12px; border-radius: 999px; font-size: 13px; font-weight: 700; white-space: nowrap; }
    .badge-source { background: #6b7280; color: #ffffff; }
    .badge-open { background: #fef3c7; color: #92400e; }
    .badge-review { background: #dbeafe; color: #1d4ed8; }
    .badge-deadline { background: #fde68a; color: #92400e; }
    .badge-closed { background: #dcfce7; color: #166534; }
    .badge-due-today { background: #fef3c7; color: #92400e; }
    .badge-overdue { background: #fee2e2; color: #b91c1c; }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .icon-btn { border: none; width: 38px; height: 38px; border-radius: 8px; font-size: 16px; font-weight: 700; cursor: pointer; color: #ffffff; }
    .view-btn { background: #06b6d4; }
    .edit-btn { background: #f5b301; color: #1f2937; }
    .delete-btn { background: #ef4444; }
    .empty-note { padding: 24px 8px 8px 8px; color: #6b7280; font-size: 15px; }
    .modal-overlay { position: fixed; inset: 0; background: rgba(17, 24, 39, 0.45); display: none; align-items: center; justify-content: center; padding: 20px; z-index: 999; }
    .modal-overlay.show { display: flex; }
    .modal { width: 100%; max-width: 900px; background: #ffffff; border-radius: 18px; overflow: hidden; box-shadow: 0 20px 45px rgba(0,0,0,0.18); }
    .modal-header { background: #f5b301; padding: 18px 22px; display: flex; align-items: center; justify-content: space-between; font-size: 18px; font-weight: 700; color: #1f2937; }
    .modal-header.white { background: #ffffff; border-bottom: 1px solid #e5e7eb; }
    .close-btn { border: none; background: transparent; font-size: 34px; line-height: 1; cursor: pointer; color: #4b5563; }
    .modal-body { padding: 22px; max-height: 75vh; overflow: auto; }
    .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px 22px; }
    .full { grid-column: 1 / -1; }
    .form-group label { display: block; margin-bottom: 8px; font-weight: 700; font-size: 15px; color: #374151; }
    .hidden { display: none !important; }
    .modal-footer { padding: 16px 22px; display: flex; justify-content: flex-end; gap: 10px; border-top: 1px solid #e5e7eb; background: #ffffff; }
    .detail-title { text-align: center; font-size: 22px; font-weight: 800; margin-bottom: 24px; letter-spacing: 0.5px; }
    .detail-table td, .detail-table th { border: 1px solid #d1d5db; padding: 14px 12px; }
    .detail-table th { width: 230px; background: #f9fafb; font-weight: 700; }
    @media (max-width: 1200px) {
      .cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .filters { grid-template-columns: 1fr 1fr; }
    }
    @media (max-width: 900px) {
      .app { flex-direction: column; }
      .sidebar { width: 100%; }
      .form-grid { grid-template-columns: 1fr; }
      .filters { grid-template-columns: 1fr; }
      .cards { grid-template-columns: 1fr; }
      .main { padding: 16px; }
      .panel { overflow-x: auto; }
      table { min-width: 780px; }
    }
  </style>
</head>
<body>
  <div class="app">
    <aside class="sidebar">
      <div class="sidebar-top">
        <div class="brand">🛡️ Zabıta Yönetim Sistemi</div>
        <div class="brand-sub">Zabıta Yönetim Paneli</div>
      </div>
      <nav class="menu">
        <a href="#" class="menu-item">🏠 Ana Sayfa</a>
        <a href="#" class="menu-item active">💬 Şikayet Takip Sistemi</a>
      </nav>
    </aside>

    <main class="main">
      <div class="topbar">
        <div style="display:flex; align-items:center; gap:14px; flex-wrap:wrap;">
          <div class="topbar-title">Şikayet Yönetim Ekranı</div>
          <div class="date-pill" id="todayText"></div>
        </div>

        <div class="section-actions">
          <button class="btn btn-info">📊 İstatistikler</button>
          <button class="btn btn-primary" onclick="openNewModal()">＋ Yeni Şikayet</button>
        </div>
      </div>

     <section class="cards">
  <div class="card">
    <div class="card-icon icon-yellow">📁</div>
    <div class="card-number" id="openCount">0</div>
    <div class="card-label">Açık Şikayetler</div>
  </div>

  <div class="card">
    <div class="card-icon icon-blue">🕒</div>
    <div class="card-number" id="reviewCount">0</div>
    <div class="card-label">İnceleniyor / Süreli</div>
  </div>

  <div class="card">
    <div class="card-icon icon-green">✔</div>
    <div class="card-number" id="closedCount">0</div>
    <div class="card-label">Kapanan</div>
  </div>

  <div class="card">
    <div class="card-icon icon-gray">📋</div>
    <div class="card-number" id="totalCount">0</div>
    <div class="card-label">Toplam Şikayet</div>
  </div>

  <div class="card">
    <div class="card-icon icon-blue">📆</div>
    <div class="card-number" id="dueTodayCount">0</div>
    <div class="card-label">Bugün Kontrol</div>
  </div>

  <div class="card">
    <div class="card-icon icon-yellow">⚠</div>
    <div class="card-number" id="overdueCount">0</div>
    <div class="card-label">Geciken</div>
  </div>
</section>

      <section class="panel">
      <section class="panel" id="controlAlertsPanel" style="display:none;">
  <div style="font-size:18px; font-weight:700; margin-bottom:16px;">
    Bugün Kontrol Edilecek Şikayetler
  </div>

  <div id="controlAlertsList"></div>
</section>
        <div class="filters">
          <input type="date" id="filterDate" />
          <select id="filterSource">
            <option value="">Tüm Kaynaklar</option>
            <option value="CİMER">CİMER</option>
            <option value="Şeffaf Masa">Şeffaf Masa</option>
            <option value="Büro Telefonu">Büro Telefonu</option>
            <option value="Vatandaş Talebi">Vatandaş Talebi</option>
          </select>
          <select id="filterStatus">
            <option value="">Tüm Durumlar</option>
            <option value="Açık">Açık</option>
            <option value="İnceleniyor">İnceleniyor</option>
            <option value="Süre Verildi">Süre Verildi</option>
            <option value="Kapatıldı">Kapatıldı</option>
          </select>
          <input type="text" id="searchInput" placeholder="Şikayet No veya Konu ara..." />
          <button class="btn btn-secondary" onclick="renderTable()">🔎 Filtrele</button>
        </div>
      </section>

      <section class="panel">
        <table>
          <thead>
            <tr>
              <th>Şikayet No</th>
              <th>Tarih</th>
              <th>Konu</th>
              <th>Kaynak</th>
              <th>Durum</th>
              <th>Yapılan İşlem</th>
              <th>İşlemler</th>
            </tr>
          </thead>
          <tbody id="complaintTableBody"></tbody>
        </table>
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

    function escapeHtml(value) {
      if (value === null || value === undefined) return "";
      return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
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

  if (dueToday.length === 0 && overdue.length === 0) {
    panel.style.display = "none";
    list.innerHTML = "";
    return;
  }

  panel.style.display = "block";

  var html = "";

  if (overdue.length > 0) {
    html += '<div style="margin-bottom:16px;">';
    html += '<div style="font-weight:700; color:#b91c1c; margin-bottom:10px;">Geciken Kontroller</div>';

    for (var j = 0; j < overdue.length; j++) {
      html += '<div style="background:#fee2e2; border:1px solid #fecaca; border-radius:12px; padding:12px 14px; margin-bottom:10px;">';
      html += '<div style="display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap;">';
      html += '<div>';
      html += '<div style="font-weight:700;">' + escapeHtml(overdue[j].no) + ' - ' + escapeHtml(overdue[j].subject) + '</div>';
      html += '<div style="margin-top:4px; color:#7f1d1d;">Kontrol Tarihi: ' + escapeHtml(overdue[j].controlDateText || "-") + '</div>';
      html += '</div>';
      html += '<button class="btn btn-danger" onclick="openDetail(' + overdue[j].id + ')">İlgili Kayda Git</button>';
      html += '</div>';
      html += "</div>";
    }

    html += "</div>";
  }

  if (dueToday.length > 0) {
    html += '<div>';
    html += '<div style="font-weight:700; color:#92400e; margin-bottom:10px;">Bugün Kontrol Edilecekler</div>';

    for (var k = 0; k < dueToday.length; k++) {
      html += '<div style="background:#fef3c7; border:1px solid #fde68a; border-radius:12px; padding:12px 14px; margin-bottom:10px;">';
      html += '<div style="display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap;">';
      html += '<div>';
      html += '<div style="font-weight:700;">' + escapeHtml(dueToday[k].no) + ' - ' + escapeHtml(dueToday[k].subject) + '</div>';
      html += '<div style="margin-top:4px; color:#92400e;">Kontrol Tarihi: ' + escapeHtml(dueToday[k].controlDateText || "-") + '</div>';
      html += '</div>';
      html += '<button class="btn btn-warning" onclick="openDetail(' + dueToday[k].id + ')">İlgili Kayda Git</button>';
      html += '</div>';
      html += "</div>";
    }

    html += "</div>";
  }

  list.innerHTML = html;
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

      updateCards(filtered);
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

    function openDetail(id) {
      var item = getComplaintById(id);
      if (!item) return;

      var html = "";
      html += "<tr><th>Şikayet No</th><td>" + escapeHtml(item.no) + "</td></tr>";
      html += "<tr><th>Tarih</th><td>" + escapeHtml(item.displayDate) + "</td></tr>";
      html += "<tr><th>Konu</th><td><strong>" + escapeHtml(item.subject) + "</strong></td></tr>";
      html += "<tr><th>Kaynak</th><td>" + escapeHtml(item.source) + "</td></tr>";
      html += "<tr><th>Adres</th><td>" + escapeHtml(item.address) + "</td></tr>";
      html += "<tr><th>Durum</th><td>" + getStatusBadge(item) + "</td></tr>";
      html += "<tr><th>Detay</th><td>" + escapeHtml(item.detail) + "</td></tr>";
      html += "<tr><th>Yapılan İşlem</th><td>" + escapeHtml(item.action) + "</td></tr>";
      html += "<tr><th>İşlem Açıklaması</th><td>" + escapeHtml(item.note || "-") + "</td></tr>";
      html += "<tr><th>İşlem Tarihi</th><td>" + escapeHtml(item.processDateText || "-") + "</td></tr>";
      html += "<tr><th>Kontrol Tarihi</th><td>" + escapeHtml(item.controlDateText || "-") + "</td></tr>";
      html += "<tr><th>Kapatma Tarihi</th><td>" + escapeHtml(item.closedDateText || "-") + "</td></tr>";
      html += "<tr><th>Kayıt Tarihi</th><td>" + escapeHtml(item.createdAt) + "</td></tr>";
      document.getElementById("detailTableBody").innerHTML = html;
      document.getElementById("detailModal").classList.add("show");
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
