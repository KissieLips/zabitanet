
    var markets = [];
    var attendanceSheet = [];
    var hasUnsavedChanges = false;

    function escapeHtml(value) {
      return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function showLoading(text) {
      document.getElementById('loadingText').textContent = text || 'İşlem yapılıyor...';
      document.getElementById('loadingCover').classList.add('show');
    }

    function hideLoading() {
      document.getElementById('loadingCover').classList.remove('show');
    }

    function showBanner(message, type) {
      var box = document.getElementById('topBanner');
      if (!message) {
        box.textContent = '';
        box.className = 'banner';
        return;
      }
      box.textContent = message;
      box.className = 'banner show' + (type ? ' ' + type : '');
    }

    function toInputDate(value) {
      if (!value) return '';
      if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
      var d = new Date(value);
      if (Number.isNaN(d.getTime())) return '';
      var yyyy = d.getFullYear();
      var mm = String(d.getMonth() + 1).padStart(2, '0');
      var dd = String(d.getDate()).padStart(2, '0');
      return yyyy + '-' + mm + '-' + dd;
    }

    function formatDate(value) {
      if (!value) return '';
      if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
        var parts = value.split('-');
        return parts[2] + '.' + parts[1] + '.' + parts[0];
      }
      var d = new Date(value);
      if (Number.isNaN(d.getTime())) return String(value);
      return new Intl.DateTimeFormat('tr-TR', { timeZone: 'Europe/Istanbul' }).format(d);
    }

    function getMarketById(marketId) {
      return markets.find(function(item) { return String(item.id) === String(marketId); }) || null;
    }

    function getSuggestedDateForMarket(market) {
      var now = new Date();
      var currentDay = now.getDay();
      var targetDay = Number(market && market.scheduledDay);
      if (Number.isNaN(targetDay)) return toInputDate(now);
      var diff = targetDay - currentDay;
      if (diff < 0) diff += 7;
      var suggested = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff);
      return toInputDate(suggested);
    }

    function updateDayInfo() {
      var market = getMarketById(document.getElementById('attendanceMarketFilter').value);
      var date = document.getElementById('attendanceDate').value;
      var info = document.getElementById('attendanceDayInfo');
      if (!market) {
        info.textContent = '';
        return;
      }
      var text = market.name + ' · Kurulum günü: ' + (market.scheduledDayLabel || '-');
      if (date) text += ' · Seçili tarih: ' + formatDate(date);
      info.textContent = text;
    }

    function setSuggestedDateForSelectedMarket(showMessage) {
      var market = getMarketById(document.getElementById('attendanceMarketFilter').value);
      if (!market) return;
      var suggested = getSuggestedDateForMarket(market);
      document.getElementById('attendanceDate').value = suggested;
      updateDayInfo();
      loadAttendanceSheet();
      if (showMessage) showBanner('Seçili pazar için önerilen tarih getirildi: ' + formatDate(suggested), 'success');
    }

    function populateMarketSelect() {
      var select = document.getElementById('attendanceMarketFilter');
      var activeMarkets = markets.filter(function(item) { return item.isActive; });
      var list = activeMarkets.length ? activeMarkets : markets;
      select.innerHTML = list.map(function(item) {
        return '<option value="' + item.id + '">' + escapeHtml(item.name) + '</option>';
      }).join('');
      if (list.length) {
        select.value = String(list[0].id);
        if (!document.getElementById('attendanceDate').value) {
          document.getElementById('attendanceDate').value = getSuggestedDateForMarket(list[0]);
        }
      }
      updateDayInfo();
    }

    function normalizeSortText(value) {
      return String(value || '').trim();
    }

    function extractLeadingNumber(value) {
      var text = String(value || '').trim();
      if (!text) return Number.POSITIVE_INFINITY;
      var match = text.match(/\d+/);
      return match ? Number(match[0]) : Number.POSITIVE_INFINITY;
    }

    function getSectionSortValue(value) {
      var map = { 'Esnaf': 1, 'Üretici': 2, 'Tuhafiye': 3 };
      return map[String(value || '').trim()] || 99;
    }

    function getStallColorSortValue(sectionType, stallColor) {
      var color = String(stallColor || '').trim().toLocaleLowerCase('tr-TR');
      if (String(sectionType || '').trim() === 'Üretici') {
        if (color === 'yeşil') return 1;
        if (color === 'kırmızı') return 2;
      }
      if (color === 'mavi') return 3;
      if (color === 'renksiz') return 4;
      if (!color) return 5;
      return 6;
    }

    function compareAttendanceRowsByStall(a, b) {
      var aSection = getSectionSortValue(a.sectionType);
      var bSection = getSectionSortValue(b.sectionType);
      if (aSection !== bSection) return aSection - bSection;
      var aColor = getStallColorSortValue(a.sectionType, a.stallColor);
      var bColor = getStallColorSortValue(b.sectionType, b.stallColor);
      if (aColor !== bColor) return aColor - bColor;
      var aNo = extractLeadingNumber(a.stallNo || a.stallLabel);
      var bNo = extractLeadingNumber(b.stallNo || b.stallLabel);
      if (aNo !== bNo) return aNo - bNo;
      var aText = normalizeSortText(a.stallNo || a.stallLabel);
      var bText = normalizeSortText(b.stallNo || b.stallLabel);
      if (aText && bText && aText !== bText) return aText.localeCompare(bText, 'tr', { numeric: true, sensitivity: 'base' });
      if (aText && !bText) return -1;
      if (!aText && bText) return 1;
      return normalizeSortText(a.vendorName).localeCompare(normalizeSortText(b.vendorName), 'tr', { sensitivity: 'base' });
    }

    function clearMobileFilters() {
      document.getElementById('attendanceSectionFilter').value = 'all';
      document.getElementById('attendanceColorFilter').value = 'all';
      document.getElementById('attendanceSearchInput').value = '';
      renderAttendanceCards();
    }

    function handleMarketChange() {
      if (!document.getElementById('attendanceDate').value) {
        setSuggestedDateForSelectedMarket(false);
        return;
      }
      updateDayInfo();
      loadAttendanceSheet();
    }

    function getFilteredAttendanceRows() {
      var section = document.getElementById('attendanceSectionFilter').value;
      var color = document.getElementById('attendanceColorFilter').value;
      var search = document.getElementById('attendanceSearchInput').value.trim().toLocaleLowerCase('tr-TR');
      return attendanceSheet.filter(function(item) {
        var matchesSection = section === 'all' || item.sectionType === section;
        var matchesColor = color === 'all' || (item.stallColor || '') === color;
        var text = [item.vendorName, item.marketName, item.sectionType, item.stallColor, item.stallLabel, item.stallNo, item.note].join(' ').toLocaleLowerCase('tr-TR');
        var matchesSearch = !search || text.indexOf(search) !== -1;
        return matchesSection && matchesColor && matchesSearch;
      }).sort(compareAttendanceRowsByStall);
    }

    function renderSummary() {
      var box = document.getElementById('summaryGrid');
      var rows = attendanceSheet;
      var actionableRows = rows.filter(function(item) { return !item.isUnassigned; });
      var selectedCount = actionableRows.filter(function(item) { return !!item.selectedStatus; }).length;
      var varCount = actionableRows.filter(function(item) { return item.selectedStatus === 'Var'; }).length;
      var yokCount = actionableRows.filter(function(item) { return item.selectedStatus === 'Yok'; }).length;
      var izinliCount = actionableRows.filter(function(item) { return item.selectedStatus === 'İzinli'; }).length;
      var raporluCount = actionableRows.filter(function(item) { return item.selectedStatus === 'Raporlu'; }).length;
      box.innerHTML = '' +
        '<div class="summary-card"><div class="summary-label">Toplam</div><div class="summary-value">' + rows.length + '</div></div>' +
        '<div class="summary-card info"><div class="summary-label">İşaretlenen</div><div class="summary-value">' + selectedCount + '</div></div>' +
        '<div class="summary-card ok"><div class="summary-label">Var</div><div class="summary-value">' + varCount + '</div></div>' +
        '<div class="summary-card missing"><div class="summary-label">Yok</div><div class="summary-value">' + yokCount + '</div></div>' +
        '<div class="summary-card info"><div class="summary-label">İzinli</div><div class="summary-value">' + izinliCount + '</div></div>' +
        '<div class="summary-card warn"><div class="summary-label">Raporlu</div><div class="summary-value">' + raporluCount + '</div></div>';
      var info = document.getElementById('attendanceListInfo');
      if (!rows.length) info.textContent = 'Seçili pazar ve tarihte gösterilecek aktif satıcı bulunmuyor.';
      else {
        var assignedCount = rows.filter(function(item) { return !item.isUnassigned; }).length;
        var unassignedCount = rows.filter(function(item) { return item.isUnassigned; }).length;
        info.textContent = 'Toplam ' + assignedCount + ' satıcı ve ' + unassignedCount + ' boş yer var. Filtreye göre ' + getFilteredAttendanceRows().length + ' satır gösteriliyor. Üreticide önce Yeşil, sonra Kırmızı listelenir.';
      }
    }

    function buildBadge(label, className) {
      return '<span class="badge' + (className ? ' ' + className : '') + '">' + escapeHtml(label) + '</span>';
    }

    function renderAttendanceCards() {
      var container = document.getElementById('attendanceCardList');
      renderSummary();
      if (!attendanceSheet.length) {
        container.innerHTML = '<div class="empty-state">Liste boş. Önce pazarı ve tarihi seç, sonra yoklama satırları burada açılsın.</div>';
        return;
      }
      var rows = getFilteredAttendanceRows();
      if (!rows.length) {
        container.innerHTML = '<div class="empty-state">Bu filtreye uygun satıcı bulunmuyor.</div>';
        return;
      }
      var html = '';
      for (var i = 0; i < rows.length; i++) {
        var item = rows[i];
        var selected = item.selectedStatus || '';
        var badges = buildBadge(item.sectionType || '-', 'info') + buildBadge('Yer: ' + (item.stallLabel || '-'));
        if (item.isUnassigned) {
          badges += buildBadge('Yer Tahsisi Yapılmamış', 'neutral');
          badges += buildBadge('İşlem Kapalı', 'neutral');
        } else if (item.isLocked) {
          badges += buildBadge((item.lockedStatus || item.leaveType || 'Kilitli') + ' · Otomatik', item.leaveType === 'Raporlu' ? 'warn' : 'info');
          if (item.leavePeriodText) badges += buildBadge(item.leavePeriodText);
        } else if (item.attendanceStatus) {
          badges += buildBadge('Kayıtlı: ' + item.attendanceStatus, item.attendanceStatus === 'Var' ? 'ok' : (item.attendanceStatus === 'Yok' ? 'missing' : 'info'));
        } else if (item.recommendedStatus) {
          badges += buildBadge('Öneri: ' + item.recommendedStatus, item.recommendedStatus === 'Raporlu' ? 'warn' : 'info');
        }
        html += '<article class="vendor-card">' +
          '<div class="vendor-top"><div><h3 class="vendor-name">' + escapeHtml(item.vendorName) + '</h3><div class="vendor-sub">' + escapeHtml(item.marketName || '-') + ' · ' + escapeHtml(item.sectionType || '-') + '</div></div>' +
          (selected ? buildBadge(selected, selected === 'Var' ? 'ok' : (selected === 'Yok' ? 'missing' : (selected === 'Raporlu' ? 'warn' : 'info'))) : '') +
          '</div>' +
          '<div class="badge-row">' + badges + '</div>' +
          '<div class="status-grid">' +
            buildStatusButton(item.vendorId, 'Var', selected, item.isLocked) +
            buildStatusButton(item.vendorId, 'Yok', selected, item.isLocked) +
            buildStatusButton(item.vendorId, 'İzinli', selected, item.isLocked) +
            buildStatusButton(item.vendorId, 'Raporlu', selected, item.isLocked) +
          '</div>' +
          '<input class="note-input" type="text" value="' + escapeHtml(item.note || '') + '" ' + (item.isLocked ? 'disabled' : '') + ' placeholder="' + (item.isUnassigned ? 'Bu yer için işlem kapalı' : 'Kısa not') + '" oninput="updateAttendanceNote(' + item.vendorId + ', this.value)" />' +
        '</article>';
      }
      container.innerHTML = html;
    }

    function buildStatusButton(vendorId, label, activeLabel, isLocked) {
      var cls = label.toLocaleLowerCase('tr-TR');
      return '<button class="status-btn ' + cls + (label === activeLabel ? ' active' : '') + '" type="button" onclick="pickAttendanceStatus(' + vendorId + ', \'' + label + '\')" ' + (isLocked ? 'disabled' : '') + '>' + escapeHtml(label) + '</button>';
    }

    function pickAttendanceStatus(vendorId, label) {
      var item = attendanceSheet.find(function(row) { return row.vendorId === vendorId; });
      if (!item || item.isLocked) return;
      item.selectedStatus = label;
      hasUnsavedChanges = true;
      renderAttendanceCards();
    }

    function updateAttendanceNote(vendorId, value) {
      var item = attendanceSheet.find(function(row) { return row.vendorId === vendorId; });
      if (!item || item.isLocked) return;
      item.note = value;
      hasUnsavedChanges = true;
    }

    function markAllAttendance(label) {
      if (!attendanceSheet.length) return;
      for (var i = 0; i < attendanceSheet.length; i++) {
        if (!attendanceSheet[i].isLocked) attendanceSheet[i].selectedStatus = label;
      }
      hasUnsavedChanges = true;
      renderAttendanceCards();
      showBanner('Kilitsiz tüm satırlar "' + label + '" olarak işaretlendi.', 'success');
    }

    async function loadMarkets() {
      var response = await fetch('/api/markets');
      var data = await response.json().catch(function() { return []; });
      if (!response.ok) throw new Error(data.error || 'Pazar listesi yüklenemedi.');
      markets = data;
      populateMarketSelect();
    }

    async function loadAttendanceSheet() {
      var marketId = document.getElementById('attendanceMarketFilter').value;
      var date = document.getElementById('attendanceDate').value;
      updateDayInfo();
      if (!marketId || !date) {
        attendanceSheet = [];
        renderAttendanceCards();
        return;
      }
      try {
        showLoading('Yoklama listesi yükleniyor...');
        var response = await fetch('/api/markets/attendance-sheet?marketId=' + encodeURIComponent(marketId) + '&date=' + encodeURIComponent(date));
        var data = await response.json().catch(function() { return []; });
        if (!response.ok) throw new Error(data.error || 'Yoklama listesi yüklenemedi.');
        attendanceSheet = data.map(function(item) {
          item.selectedStatus = item.isLocked ? (item.lockedStatus || item.leaveType || '') : (item.attendanceStatus || item.recommendedStatus || '');
          return item;
        });
        hasUnsavedChanges = false;
        renderAttendanceCards();
        showBanner('', '');
      } catch (error) {
        attendanceSheet = [];
        renderAttendanceCards();
        showBanner(error.message || 'Yoklama listesi yüklenemedi.', 'warn');
      } finally {
        hideLoading();
      }
    }

    async function saveMobileAttendanceSheet(silent) {
      var marketId = document.getElementById('attendanceMarketFilter').value;
      var date = document.getElementById('attendanceDate').value;
      var entries = attendanceSheet.filter(function(item) { return !!item.selectedStatus; }).map(function(item) {
        return { vendorId: item.vendorId, status: item.selectedStatus, note: item.note || '' };
      });
      if (!marketId) {
        if (!silent) showBanner('Önce pazar seçmelisin.', 'warn');
        return false;
      }
      if (!date) {
        if (!silent) showBanner('Yoklama tarihi seçilmelidir.', 'warn');
        return false;
      }
      if (!entries.length) {
        if (!silent) showBanner('Kaydedilecek yoklama satırı bulunmuyor.', 'warn');
        return false;
      }
      try {
        showLoading('Yoklama kaydediliyor...');
        var response = await fetch('/api/markets/attendance/bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date: date, entries: entries })
        });
        var data = await response.json().catch(function() { return {}; });
        if (!response.ok) throw new Error(data.error || 'Yoklama kaydedilemedi.');
        hasUnsavedChanges = false;
        if (!silent) showBanner('Yoklama kaydedildi. İstersen şimdi PDF veya Excel çıktısı alabilirsin.', 'success');
        return true;
      } catch (error) {
        if (!silent) showBanner(error.message || 'Yoklama kaydedilemedi.', 'warn');
        return false;
      } finally {
        hideLoading();
      }
    }

    async function ensureSavedAttendanceSession() {
      if (!attendanceSheet.length) {
        showBanner('Önce yoklama listesi açılmalıdır.', 'warn');
        return null;
      }
      if (hasUnsavedChanges) {
        var saved = await saveMobileAttendanceSheet(true);
        if (!saved) {
          showBanner('Önce kayıt tamamlanmalıdır.', 'warn');
          return null;
        }
      }
      var marketId = document.getElementById('attendanceMarketFilter').value;
      var date = document.getElementById('attendanceDate').value;
      try {
        showLoading('Çıktı hazırlanıyor...');
        var response = await fetch('/api/markets/attendance-session-detail?marketId=' + encodeURIComponent(marketId) + '&date=' + encodeURIComponent(date));
        var data = await response.json().catch(function() { return {}; });
        if (!response.ok) throw new Error(data.error || 'Kaydedilmiş yoklama detayı alınamadı.');
        return data;
      } catch (error) {
        showBanner(error.message || 'Kaydedilmiş yoklama detayı alınamadı.', 'warn');
        return null;
      } finally {
        hideLoading();
      }
    }

    async function downloadCurrentAttendanceExcel() {
      var marketId = document.getElementById('attendanceMarketFilter').value;
      var date = document.getElementById('attendanceDate').value;
      var detail = await ensureSavedAttendanceSession();
      if (!detail) return;
      window.location.href = '/api/markets/attendance-session-detail/export.xlsx?marketId=' + encodeURIComponent(marketId) + '&date=' + encodeURIComponent(date);
      showBanner('Excel indirme başlatıldı.', 'success');
    }

    function getStatusClass(status) {
      if (status === 'Var') return 'ok';
      if (status === 'Yok') return 'missing';
      if (status === 'Raporlu') return 'warn';
      if (status === 'İzinli') return 'info';
      return '';
    }

    function buildAttendanceReportHtml(detail) {
      var rows = (detail.rows || []).map(function(item, index) {
        return '<tr>' +
          '<td>' + (index + 1) + '</td>' +
          '<td><strong>' + escapeHtml(item.vendorName || '-') + '</strong></td>' +
          '<td>' + escapeHtml(item.sectionType || '-') + '</td>' +
          '<td>' + escapeHtml(item.stallLabel || '-') + '</td>' +
          '<td>' + escapeHtml(item.status || '-') + '</td>' +
          '<td>' + escapeHtml(item.note || '-') + '</td>' +
          '<td>' + escapeHtml(item.updatedAt || '-') + '</td>' +
        '</tr>';
      }).join('');
      if (!rows) rows = '<tr><td colspan="7">Kaydedilmiş yoklama satırı bulunmuyor.</td></tr>';
      return '<!DOCTYPE html><html lang="tr"><head><meta charset="UTF-8"><title>Mobil Yoklama Raporu</title><style>' +
        'body{font-family:Inter,Segoe UI,Arial,sans-serif;margin:0;padding:24px;color:#17202f;background:#fff;} .report{max-width:1100px;margin:0 auto;} ' +
        '.top{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;border-bottom:2px solid #e5e7eb;padding-bottom:14px;margin-bottom:18px;} ' +
        '.title{font-size:26px;font-weight:900;letter-spacing:-.03em;margin:0;} .subtitle{margin-top:6px;color:#667085;font-size:13px;line-height:1.6;} .meta{display:grid;gap:6px;font-size:13px;color:#334155;text-align:right;} ' +
        '.summary-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;margin:18px 0 22px;} .summary-card{border:1px solid #dbe3ee;border-radius:14px;padding:14px;background:#f8fafc;} .summary-card.ok{background:#effcf3;border-color:#bbf7d0;color:#166534;} .summary-card.missing{background:#fff1f2;border-color:#fecdd3;color:#b91c1c;} .summary-card.info{background:#eff6ff;border-color:#bfdbfe;color:#1d4ed8;} .summary-card.warn{background:#fffbeb;border-color:#fde68a;color:#92400e;} ' +
        '.summary-label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;opacity:.8;} .summary-value{font-size:28px;font-weight:900;margin-top:8px;} ' +
        'table{width:100%;border-collapse:collapse;table-layout:fixed;} th,td{border:1px solid #dbe3ee;padding:10px 12px;font-size:12px;vertical-align:top;word-break:break-word;} th{background:#f8fafc;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#667085;} ' +
        '.section-title{font-size:17px;font-weight:900;margin:0 0 10px;} @page{size:A4 landscape;margin:12mm;} @media print{body{padding:0;} .report{max-width:none;}}' +
        '</style></head><body><div class="report">' +
        '<div class="top"><div><h1 class="title">Mobil Yoklama Raporu</h1><div class="subtitle">Telefondan alınan yoklama için kaydedilmiş satıcı listesi ve durum özeti.</div></div><div class="meta"><div><strong>Pazar:</strong> ' + escapeHtml(detail.marketName || '-') + '</div><div><strong>Tarih:</strong> ' + escapeHtml(detail.attendanceDateText || '-') + '</div><div><strong>Son Güncelleme:</strong> ' + escapeHtml(detail.updatedAt || '-') + '</div></div></div>' +
        '<div class="summary-grid">' +
          '<div class="summary-card"><div class="summary-label">Toplam</div><div class="summary-value">' + escapeHtml(detail.recordCount || 0) + '</div></div>' +
          '<div class="summary-card ok"><div class="summary-label">Var</div><div class="summary-value">' + escapeHtml(detail.presentCount || 0) + '</div></div>' +
          '<div class="summary-card missing"><div class="summary-label">Yok</div><div class="summary-value">' + escapeHtml(detail.absentCount || 0) + '</div></div>' +
          '<div class="summary-card info"><div class="summary-label">İzinli</div><div class="summary-value">' + escapeHtml(detail.leaveCount || 0) + '</div></div>' +
          '<div class="summary-card warn"><div class="summary-label">Raporlu</div><div class="summary-value">' + escapeHtml(detail.reportCount || 0) + '</div></div>' +
        '</div>' +
        '<h2 class="section-title">Yoklama Listesi</h2>' +
        '<table><thead><tr><th style="width:6%">#</th><th style="width:24%">Satıcı</th><th style="width:12%">Bölüm</th><th style="width:14%">Yer</th><th style="width:12%">Durum</th><th style="width:17%">Not</th><th style="width:15%">Son Güncelleme</th></tr></thead><tbody>' + rows + '</tbody></table>' +
        '</div></body></html>';
    }

    async function printCurrentAttendanceReport() {
      var detail = await ensureSavedAttendanceSession();
      if (!detail) return;
      var reportHtml = buildAttendanceReportHtml(detail);
      var printWindow = window.open('', '_blank', 'width=1200,height=820');
      if (!printWindow) {
        showBanner('Yazdırma penceresi açılamadı. Tarayıcı açılır pencere engelini kontrol et.', 'warn');
        return;
      }
      printWindow.document.open();
      printWindow.document.write(reportHtml);
      printWindow.document.close();
      printWindow.focus();
      printWindow.onload = function() { printWindow.print(); };
      showBanner('PDF / yazdırma görünümü açıldı.', 'success');
    }

    async function reloadAllMobile() {
      try {
        showLoading('Veriler yükleniyor...');
        await loadMarkets();
        await loadAttendanceSheet();
        showBanner('', '');
      } catch (error) {
        showBanner(error.message || 'Mobil yoklama verileri yüklenemedi.', 'warn');
      } finally {
        hideLoading();
      }
    }

    window.addEventListener('beforeunload', function(event) {
      if (!hasUnsavedChanges) return;
      event.preventDefault();
      event.returnValue = '';
    });

    document.addEventListener('DOMContentLoaded', function() {
      reloadAllMobile();
    });
  