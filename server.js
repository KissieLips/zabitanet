const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>ZabitaNet - Şikayet Takip Sistemi</title>
  <style>
    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      font-family: Arial, Helvetica, sans-serif;
      background: #f3f4f6;
      color: #1f2937;
    }

    .app {
      display: flex;
      min-height: 100vh;
    }

    .sidebar {
      width: 280px;
      background: #183b68;
      color: #ffffff;
      padding: 0;
      flex-shrink: 0;
    }

    .sidebar-top {
      padding: 28px 22px 18px 22px;
      border-bottom: 1px solid rgba(255,255,255,0.12);
    }

    .brand {
      font-size: 20px;
      font-weight: 700;
      margin-bottom: 8px;
    }

    .brand-sub {
      font-size: 14px;
      color: rgba(255,255,255,0.82);
    }

    .menu {
      padding: 18px 0;
    }

    .menu-item {
      padding: 16px 22px;
      font-size: 16px;
      display: flex;
      align-items: center;
      gap: 12px;
      color: #ffffff;
      text-decoration: none;
      border-left: 4px solid transparent;
    }

    .menu-item:hover {
      background: rgba(255,255,255,0.08);
    }

    .menu-item.active {
      background: #f5b301;
      color: #ffffff;
      font-weight: 700;
    }

    .main {
      flex: 1;
      padding: 28px;
    }

    .topbar {
      background: #ffffff;
      border-radius: 16px;
      padding: 20px 24px;
      box-shadow: 0 2px 12px rgba(0,0,0,0.06);
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
      gap: 16px;
    }

    .topbar-title {
      font-size: 20px;
      font-weight: 700;
    }

    .topbar-actions {
      display: flex;
      gap: 10px;
      align-items: center;
      flex-wrap: wrap;
    }

    .date-pill {
      background: #2563eb;
      color: #ffffff;
      border-radius: 8px;
      padding: 10px 14px;
      font-weight: 700;
      font-size: 14px;
    }

    .section-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 18px;
      gap: 16px;
      flex-wrap: wrap;
    }

    .section-title {
      font-size: 20px;
      font-weight: 700;
    }

    .section-actions {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
    }

    .btn {
      border: none;
      border-radius: 10px;
      padding: 12px 18px;
      font-size: 15px;
      font-weight: 700;
      cursor: pointer;
      transition: 0.2s ease;
    }

    .btn:hover {
      opacity: 0.92;
    }

    .btn-primary {
      background: #2563eb;
      color: #ffffff;
    }

    .btn-info {
      background: #06b6d4;
      color: #ffffff;
    }

    .btn-warning {
      background: #f5b301;
      color: #1f2937;
    }

    .btn-secondary {
      background: #6b7280;
      color: #ffffff;
    }

    .btn-danger {
      background: #ef4444;
      color: #ffffff;
    }

    .cards {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 20px;
      margin-bottom: 24px;
    }

    .card {
      background: #ffffff;
      border-radius: 16px;
      padding: 24px;
      box-shadow: 0 2px 12px rgba(0,0,0,0.06);
      min-height: 150px;
    }

    .card-icon {
      width: 56px;
      height: 56px;
      border-radius: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 26px;
      margin-bottom: 20px;
    }

    .icon-yellow {
      background: #fef3c7;
    }

    .icon-blue {
      background: #dbeafe;
    }

    .icon-green {
      background: #dcfce7;
    }

    .icon-gray {
      background: #e5e7eb;
    }

    .card-number {
      font-size: 40px;
      font-weight: 700;
      margin-bottom: 8px;
    }

    .card-label {
      font-size: 16px;
      color: #6b7280;
    }

    .panel {
      background: #ffffff;
      border-radius: 16px;
      padding: 22px;
      box-shadow: 0 2px 12px rgba(0,0,0,0.06);
      margin-bottom: 24px;
    }

    .filters {
      display: grid;
      grid-template-columns: 200px 1fr 1fr 1.2fr 180px;
      gap: 16px;
      align-items: center;
    }

    input, select, textarea {
      width: 100%;
      border: 1px solid #d1d5db;
      border-radius: 10px;
      padding: 13px 14px;
      font-size: 15px;
      outline: none;
      background: #ffffff;
    }

    textarea {
      resize: vertical;
      min-height: 96px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
    }

    th {
      text-align: left;
      padding: 16px 12px;
      font-size: 15px;
      color: #111827;
      border-bottom: 1px solid #e5e7eb;
    }

    td {
      padding: 16px 12px;
      border-bottom: 1px solid #e5e7eb;
      font-size: 15px;
      vertical-align: middle;
    }

    .complaint-no {
      font-weight: 700;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 7px 12px;
      border-radius: 999px;
      font-size: 13px;
      font-weight: 700;
      white-space: nowrap;
    }

    .badge-source {
      background: #6b7280;
      color: #ffffff;
    }

    .badge-open {
      background: #fef3c7;
      color: #92400e;
    }

    .badge-review {
      background: #dbeafe;
      color: #1d4ed8;
    }

    .badge-deadline {
      background: #fde68a;
      color: #92400e;
    }

    .badge-closed {
      background: #dcfce7;
      color: #166534;
    }

    .actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .icon-btn {
      border: none;
      width: 38px;
      height: 38px;
      border-radius: 8px;
      font-size: 16px;
      font-weight: 700;
      cursor: pointer;
      color: #ffffff;
    }

    .view-btn {
      background: #06b6d4;
    }

    .edit-btn {
      background: #f5b301;
      color: #1f2937;
    }

    .delete-btn {
      background: #ef4444;
    }

    .empty-note {
      padding: 24px 8px 8px 8px;
      color: #6b7280;
      font-size: 15px;
    }

    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(17, 24, 39, 0.45);
      display: none;
      align-items: center;
      justify-content: center;
      padding: 20px;
      z-index: 999;
    }

    .modal-overlay.show {
      display: flex;
    }

    .modal {
      width: 100%;
      max-width: 900px;
      background: #ffffff;
      border-radius: 18px;
      overflow: hidden;
      box-shadow: 0 20px 45px rgba(0,0,0,0.18);
    }

    .modal-header {
      background: #f5b301;
      padding: 18px 22px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 18px;
      font-weight: 700;
      color: #1f2937;
    }

    .modal-header.white {
      background: #ffffff;
      border-bottom: 1px solid #e5e7eb;
    }

    .close-btn {
      border: none;
      background: transparent;
      font-size: 34px;
      line-height: 1;
      cursor: pointer;
      color: #4b5563;
    }

    .modal-body {
      padding: 22px;
      max-height: 75vh;
      overflow: auto;
    }

    .form-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 18px 22px;
    }

    .full {
      grid-column: 1 / -1;
    }

    .form-group label {
      display: block;
      margin-bottom: 8px;
      font-weight: 700;
      font-size: 15px;
      color: #374151;
    }

    .modal-footer {
      padding: 16px 22px;
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      border-top: 1px solid #e5e7eb;
      background: #ffffff;
    }

    .detail-title {
      text-align: center;
      font-size: 22px;
      font-weight: 800;
      margin-bottom: 24px;
      letter-spacing: 0.5px;
    }

    .detail-table td,
    .detail-table th {
      border: 1px solid #d1d5db;
      padding: 14px 12px;
    }

    .detail-table th {
      width: 230px;
      background: #f9fafb;
      font-weight: 700;
    }

    @media (max-width: 1200px) {
      .cards {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .filters {
        grid-template-columns: 1fr 1fr;
      }
    }

    @media (max-width: 900px) {
      .app {
        flex-direction: column;
      }

      .sidebar {
        width: 100%;
      }

      .form-grid {
        grid-template-columns: 1fr;
      }

      .filters {
        grid-template-columns: 1fr;
      }

      .cards {
        grid-template-columns: 1fr;
      }

      .main {
        padding: 16px;
      }

      .panel {
        overflow-x: auto;
      }

      table {
        min-width: 780px;
      }
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
    <a href="#" class="menu-item">👥 Esnaf & Üretici Kayıt</a>
    <a href="#" class="menu-item">📅 İzin & Rapor Yönetimi</a>
    <a href="#" class="menu-item">✅ Yoklama Sistemi</a>
    <a href="#" class="menu-item">📄 Tutanak & İhlal</a>
    <a href="#" class="menu-item">📘 Pazar Kuralları</a>
    <a href="#" class="menu-item">📊 Raporlar</a>
    <a href="#" class="menu-item">⚙️ Ayarlar</a>
  </nav>
</aside>

    <main class="main">
      <div class="topbar">
        <div class="topbar-title">💬 Şikayet Takip Sistemi</div>
        <div class="topbar-actions">
          <button class="btn btn-secondary">☾</button>
          <button class="btn btn-primary">⤓ Yedekle</button>
          <div class="date-pill">25 Mart 2026 Çarşamba</div>
        </div>
      </div>

      <div class="section-head">
        <div class="section-title">💬 Şikayet Takip Sistemi</div>
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
      </section>

      <section class="panel">
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
    var complaints = [
      {
        no: "ŞKY-2026-0001",
        date: "2026-03-24",
        displayDate: "24.03.2026",
        subject: "Gürültü",
        source: "CİMER",
        address: "Sanayi mahallesi",
        detail: "X kişi evinde horoz besliyor, sesten rahatsızlık oluşuyor.",
        action: "İhtar Verildi",
        status: "Kapatıldı",
        note: "-",
        createdAt: "24.03.2026 20:29:10"
      },
      {
        no: "ŞKY-2026-0002",
        date: "2026-03-25",
        displayDate: "25.03.2026",
        subject: "Çöp",
        source: "Şeffaf Masa",
        address: "Yeni mahalle pazar arkası",
        detail: "Boş alana gelişigüzel atık bırakıldığı bildirildi.",
        action: "Henüz İşlem Yapılmadı",
        status: "Açık",
        note: "",
        createdAt: "25.03.2026 09:12:00"
      },
      {
        no: "ŞKY-2026-0003",
        date: "2026-03-25",
        displayDate: "25.03.2026",
        subject: "İşgal",
        source: "Vatandaş Talebi",
        address: "Cumhuriyet caddesi",
        detail: "Kaldırım üzerine malzeme bırakıldığı bildirildi.",
        action: "Süre Verildi",
        status: "Süre Verildi",
        note: "Esnafa 2 gün süre verildi.",
        createdAt: "25.03.2026 10:40:00"
      }
    ];

    var editingIndex = -1;

    function getStatusBadge(status) {
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
      return '<span class="badge badge-source">' + source + '</span>';
    }

    function updateCards(data) {
      var openCount = 0;
      var reviewCount = 0;
      var closedCount = 0;

      for (var i = 0; i < data.length; i++) {
        if (data[i].status === "Açık") {
          openCount++;
        } else if (data[i].status === "İnceleniyor" || data[i].status === "Süre Verildi") {
          reviewCount++;
        } else if (data[i].status === "Kapatıldı") {
          closedCount++;
        }
      }

      document.getElementById("openCount").textContent = openCount;
      document.getElementById("reviewCount").textContent = reviewCount;
      document.getElementById("closedCount").textContent = closedCount;
      document.getElementById("totalCount").textContent = data.length;
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

      if (filtered.length === 0) {
        tbody.innerHTML = "";
        emptyNote.style.display = "block";
        return;
      }

      emptyNote.style.display = "none";

      var rows = "";
      for (var i = 0; i < filtered.length; i++) {
        var item = filtered[i];
        var realIndex = complaints.findIndex(function(c) { return c.no === item.no; });

        rows += '<tr>';
        rows += '<td class="complaint-no">' + item.no + '</td>';
        rows += '<td>' + item.displayDate + '</td>';
        rows += '<td>' + item.subject + '</td>';
        rows += '<td>' + sourceBadge(item.source) + '</td>';
        rows += '<td>' + getStatusBadge(item.status) + '</td>';
        rows += '<td>' + item.action + '</td>';
        rows += '<td><div class="actions">';
        rows += '<button class="icon-btn view-btn" onclick="openDetail(' + realIndex + ')">👁</button>';
        rows += '<button class="icon-btn edit-btn" onclick="openEdit(' + realIndex + ')">✎</button>';
        rows += '<button class="icon-btn delete-btn" onclick="deleteComplaint(' + realIndex + ')">🗑</button>';
        rows += '</div></td>';
        rows += '</tr>';
      }

      tbody.innerHTML = rows;
    }

    function openNewModal() {
      document.getElementById("newNo").value = "Otomatik oluşturulacak";
      document.getElementById("newDate").value = new Date().toISOString().slice(0, 10);
      document.getElementById("newSubject").value = "";
      document.getElementById("newSource").value = "";
      document.getElementById("newAddress").value = "";
      document.getElementById("newDetail").value = "";
      document.getElementById("newAction").value = "Henüz İşlem Yapılmadı";
      document.getElementById("newStatus").value = "Açık";
      document.getElementById("newNote").value = "";
      document.getElementById("newModal").classList.add("show");
    }

    function closeModal(id) {
      document.getElementById(id).classList.remove("show");
    }

    function formatDisplayDate(dateStr) {
      if (!dateStr) return "";
      var parts = dateStr.split("-");
      return parts[2] + "." + parts[1] + "." + parts[0];
    }

    function nextComplaintNo() {
      var next = complaints.length + 1;
      return "ŞKY-2026-" + String(next).padStart(4, "0");
    }

    function nowText() {
      var d = new Date();
      var gun = String(d.getDate()).padStart(2, "0");
      var ay = String(d.getMonth() + 1).padStart(2, "0");
      var yil = d.getFullYear();
      var saat = String(d.getHours()).padStart(2, "0");
      var dakika = String(d.getMinutes()).padStart(2, "0");
      var saniye = String(d.getSeconds()).padStart(2, "0");
      return gun + "." + ay + "." + yil + " " + saat + ":" + dakika + ":" + saniye;
    }

    function saveNewComplaint() {
      var date = document.getElementById("newDate").value;
      var subject = document.getElementById("newSubject").value.trim();
      var source = document.getElementById("newSource").value;
      var address = document.getElementById("newAddress").value.trim();
      var detail = document.getElementById("newDetail").value.trim();
      var action = document.getElementById("newAction").value;
      var status = document.getElementById("newStatus").value;
      var note = document.getElementById("newNote").value.trim();

      if (!date || !subject || !source) {
        alert("Lütfen zorunlu alanları doldurun.");
        return;
      }

      complaints.unshift({
        no: nextComplaintNo(),
        date: date,
        displayDate: formatDisplayDate(date),
        subject: subject,
        source: source,
        address: address,
        detail: detail,
        action: action,
        status: status,
        note: note,
        createdAt: nowText()
      });

      closeModal("newModal");
      renderTable();
    }

    function openDetail(index) {
      var item = complaints[index];
      var html = "";
      html += "<tr><th>Şikayet No</th><td>" + item.no + "</td></tr>";
      html += "<tr><th>Tarih</th><td>" + item.displayDate + "</td></tr>";
      html += "<tr><th>Konu</th><td><strong>" + item.subject + "</strong></td></tr>";
      html += "<tr><th>Kaynak</th><td>" + item.source + "</td></tr>";
      html += "<tr><th>Adres</th><td>" + item.address + "</td></tr>";
      html += "<tr><th>Durum</th><td>" + getStatusBadge(item.status) + "</td></tr>";
      html += "<tr><th>Detay</th><td>" + item.detail + "</td></tr>";
      html += "<tr><th>Yapılan İşlem</th><td>" + item.action + "</td></tr>";
      html += "<tr><th>İşlem Açıklaması</th><td>" + (item.note || "-") + "</td></tr>";
      html += "<tr><th>Kayıt Tarihi</th><td>" + item.createdAt + "</td></tr>";
      document.getElementById("detailTableBody").innerHTML = html;
      document.getElementById("detailModal").classList.add("show");
    }

    function openEdit(index) {
      editingIndex = index;
      var item = complaints[index];

      document.getElementById("editNo").value = item.no;
      document.getElementById("editDate").value = item.date;
      document.getElementById("editSubject").value = item.subject;
      document.getElementById("editSource").value = item.source;
      document.getElementById("editAddress").value = item.address;
      document.getElementById("editDetail").value = item.detail;
      document.getElementById("editAction").value = item.action;
      document.getElementById("editStatus").value = item.status;
      document.getElementById("editNote").value = item.note;

      document.getElementById("editModal").classList.add("show");
    }

    function saveEditComplaint() {
      if (editingIndex < 0) return;

      var item = complaints[editingIndex];
      item.date = document.getElementById("editDate").value;
      item.displayDate = formatDisplayDate(item.date);
      item.subject = document.getElementById("editSubject").value.trim();
      item.source = document.getElementById("editSource").value;
      item.address = document.getElementById("editAddress").value.trim();
      item.detail = document.getElementById("editDetail").value.trim();
      item.action = document.getElementById("editAction").value;
      item.status = document.getElementById("editStatus").value;
      item.note = document.getElementById("editNote").value.trim();

      closeModal("editModal");
      renderTable();
    }

    function deleteComplaint(index) {
      var item = complaints[index];
      var ok = confirm(item.no + " numaralı kaydı silmek istiyor musunuz?");
      if (!ok) return;
      complaints.splice(index, 1);
      renderTable();
    }

    renderTable();
  </script>
</body>
</html>`);
});

app.listen(PORT, () => {
  console.log("Sunucu çalışıyor: " + PORT);
});
