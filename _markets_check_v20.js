
    var markets = [];
    var vendors = [];
    var leaveRecords = [];
    var attendanceSheet = [];
    var attendanceHistory = [];
    var attendancePanelOpen = false;
    var attendancePanelMode = 'new';
    var attendanceDetailSession = null;
    var vendorImportPreviewRows = [];
    var vendorCurrentPage = 1;
    var vendorPageSize = 10;
    var attendanceCurrentPage = 1;
    var attendancePageSize = 10;
    var editingVendorId = null;
    var editingLeaveId = null;
    var editingMarketId = null;

    function escapeHtml(value) {
      return String(value === undefined || value === null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function toggleSidebar(forceOpen) {
      var shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : !document.body.classList.contains('sidebar-open');
      document.body.classList.toggle('sidebar-open', shouldOpen);
    }

    function showBanner(text, variant) {
      var box = document.getElementById('topBanner');
      box.className = 'banner show ' + (variant || 'info');
      box.textContent = text;
      window.clearTimeout(showBanner._timer);
      showBanner._timer = window.setTimeout(function() {
        box.className = 'banner ' + (variant || 'info');
        box.textContent = '';
      }, 4500);
    }

    function openModal(id) { document.getElementById(id).classList.add('show'); }
    function closeModal(id) { document.getElementById(id).classList.remove('show'); }
    function closeModalOnOverlay(event, id) { if (event.target === document.getElementById(id)) closeModal(id); }

    function getMarketById(id) { return markets.find(function(item) { return String(item.id) === String(id); }) || null; }
    function getVendorById(id) { return vendors.find(function(item) { return String(item.id) === String(id); }) || null; }
    function formatBadge(active) { return active ? '<span class="badge success">Aktif</span>' : '<span class="badge gray">Pasif</span>'; }

    function normalizeVendorSortText(value) {
      return String(value || '').trim().toLocaleLowerCase('tr-TR');
    }

    function extractLeadingNumber(value) {
      var text = String(value || '').trim();
      if (!text) return Number.POSITIVE_INFINITY;
      var match = text.match(/\d+/);
      return match ? Number(match[0]) : Number.POSITIVE_INFINITY;
    }

    function compareVendorsByStall(a, b) {
      var aNo = extractLeadingNumber(a.stallNo || a.stallLabel);
      var bNo = extractLeadingNumber(b.stallNo || b.stallLabel);
      if (aNo !== bNo) return aNo - bNo;
      var aText = normalizeVendorSortText(a.stallNo || a.stallLabel);
      var bText = normalizeVendorSortText(b.stallNo || b.stallLabel);
      if (aText && bText && aText !== bText) return aText.localeCompare(bText, 'tr');
      if (aText && !bText) return -1;
      if (!aText && bText) return 1;
      return normalizeVendorSortText(a.fullName).localeCompare(normalizeVendorSortText(b.fullName), 'tr');
    }

    function compareAttendanceRowsByStall(a, b) {
      var aNo = extractLeadingNumber(a.stallNo || a.stallLabel);
      var bNo = extractLeadingNumber(b.stallNo || b.stallLabel);
      if (aNo !== bNo) return aNo - bNo;
      var aText = normalizeVendorSortText(a.stallNo || a.stallLabel);
      var bText = normalizeVendorSortText(b.stallNo || b.stallLabel);
      if (aText && bText && aText !== bText) return aText.localeCompare(bText, 'tr');
      if (aText && !bText) return -1;
      if (!aText && bText) return 1;
      return normalizeVendorSortText(a.vendorName).localeCompare(normalizeVendorSortText(b.vendorName), 'tr');
    }

    function onVendorFilterChange() {
      vendorCurrentPage = 1;
      renderVendorTable();
    }

    function changeVendorPage(page) {
      vendorCurrentPage = page;
      renderVendorTable();
    }

    function onAttendanceFilterChange() {
      attendanceCurrentPage = 1;
      renderAttendanceSheet();
    }

    function changeAttendancePage(page) {
      attendanceCurrentPage = page;
      renderAttendanceSheet();
    }

    function buildPaginationPages(totalPages, currentPage) {
      var pages = [];
      if (totalPages <= 7) {
        for (var i = 1; i <= totalPages; i++) pages.push(i);
        return pages;
      }
      pages.push(1);
      if (currentPage > 4) pages.push('...');
      var start = Math.max(2, currentPage - 1);
      var end = Math.min(totalPages - 1, currentPage + 1);
      for (var j = start; j <= end; j++) pages.push(j);
      if (currentPage < totalPages - 3) pages.push('...');
      pages.push(totalPages);
      return pages;
    }

    function renderVendorPagination(totalItems, totalPages, currentPage, startIndex, endIndex) {
      var info = document.getElementById('vendorPaginationInfo');
      var controls = document.getElementById('vendorPaginationControls');
      if (!info || !controls) return;
      if (!totalItems) {
        info.textContent = 'Toplam 0 kayıt';
        controls.innerHTML = '';
        return;
      }
      info.textContent = 'Toplam ' + totalItems + ' kaydın ' + startIndex + '-' + endIndex + ' arası gösteriliyor';
      var parts = [];
      parts.push('<button class="mini-btn page-btn" type="button" ' + (currentPage === 1 ? 'disabled' : 'onclick="changeVendorPage(' + (currentPage - 1) + ')"') + '>‹</button>');
      var pageList = buildPaginationPages(totalPages, currentPage);
      for (var i = 0; i < pageList.length; i++) {
        if (pageList[i] === '...') {
          parts.push('<span class="page-sep">…</span>');
        } else {
          parts.push('<button class="mini-btn page-btn ' + (pageList[i] === currentPage ? 'active' : '') + '" type="button" onclick="changeVendorPage(' + pageList[i] + ')">' + pageList[i] + '</button>');
        }
      }
      parts.push('<button class="mini-btn page-btn" type="button" ' + (currentPage === totalPages ? 'disabled' : 'onclick="changeVendorPage(' + (currentPage + 1) + ')"') + '>›</button>');
      controls.innerHTML = parts.join('');
    }

    function renderAttendancePagination(totalItems, totalPages, currentPage, startIndex, endIndex) {
      var info = document.getElementById('attendancePaginationInfo');
      var controls = document.getElementById('attendancePaginationControls');
      if (!info || !controls) return;
      if (!totalItems) {
        info.textContent = 'Toplam 0 kayıt';
        controls.innerHTML = '';
        return;
      }
      info.textContent = 'Toplam ' + totalItems + ' kaydın ' + startIndex + '-' + endIndex + ' arası gösteriliyor';
      var parts = [];
      parts.push('<button class="mini-btn page-btn" type="button" ' + (currentPage === 1 ? 'disabled' : 'onclick="changeAttendancePage(' + (currentPage - 1) + ')"') + '>‹</button>');
      var pageList = buildPaginationPages(totalPages, currentPage);
      for (var i = 0; i < pageList.length; i++) {
        if (pageList[i] === '...') {
          parts.push('<span class="page-sep">…</span>');
        } else {
          parts.push('<button class="mini-btn page-btn ' + (pageList[i] === currentPage ? 'active' : '') + '" type="button" onclick="changeAttendancePage(' + pageList[i] + ')">' + pageList[i] + '</button>');
        }
      }
      parts.push('<button class="mini-btn page-btn" type="button" ' + (currentPage === totalPages ? 'disabled' : 'onclick="changeAttendancePage(' + (currentPage + 1) + ')"') + '>›</button>');
      controls.innerHTML = parts.join('');
    }

    function setAttendancePanelState(isOpen, mode) {
      attendancePanelOpen = !!isOpen;
      if (mode) attendancePanelMode = mode;
      var body = document.getElementById('attendancePanelBody');
      var closed = document.getElementById('attendanceClosedState');
      var state = document.getElementById('attendancePanelState');
      var subtitle = document.getElementById('attendancePanelSubtitle');
      if (!body || !closed || !state || !subtitle) return;
      body.classList.toggle('hidden', !attendancePanelOpen);
      closed.classList.toggle('hidden', attendancePanelOpen);
      if (attendancePanelOpen) {
        if (attendancePanelMode === 'history') {
          state.className = 'badge info';
          state.textContent = 'Düzenleme Açık';
          subtitle.textContent = 'Geçmişten seçilen yoklama açıldı. Değişiklik yapıp kaydedebilirsin.';
        } else {
          state.className = 'badge success';
          state.textContent = 'Yeni Yoklama Açık';
          subtitle.textContent = 'Seçilen pazara ve tarihe göre tüm aktif satıcı listesi gelir. İzinli / raporlu kayıtlar otomatik gelir ve kilitli kalır.';
        }
      } else {
        state.className = 'badge gray';
        state.textContent = 'Kapalı';
        subtitle.textContent = 'Panel kapalı. Yeni yoklama başlatabilir veya geçmişten bir yoklamayı düzenleyebilirsin.';
      }
    }

    function openAttendancePanelForNewSession() {
      if (document.getElementById('attendanceMarketFilter').value && !document.getElementById('attendanceDate').value) {
        setSuggestedDateForSelectedMarket(false);
      }
      setAttendancePanelState(true, 'new');
      loadAttendanceSheet();
      scrollToAttendance();
    }

    function closeAttendancePanel() {
      setAttendancePanelState(false);
    }

    function clearAttendanceFilters() {
      document.getElementById('attendanceSectionFilter').value = 'all';
      document.getElementById('attendanceStatusFilter').value = 'all';
      document.getElementById('attendanceSearchInput').value = '';
      attendanceCurrentPage = 1;
      renderAttendanceSheet();
    }

    function getFilteredAttendanceRows() {
      var section = document.getElementById('attendanceSectionFilter').value;
      var statusFilter = document.getElementById('attendanceStatusFilter').value;
      var search = document.getElementById('attendanceSearchInput').value.trim().toLocaleLowerCase('tr-TR');
      return attendanceSheet.filter(function(item) {
        var selected = item.selectedStatus || '';
        var matchesSection = section === 'all' || item.sectionType === section;
        var matchesStatus = statusFilter === 'all' || (statusFilter === 'empty' ? !selected : selected === statusFilter);
        var searchText = [item.vendorName, item.marketName, item.sectionType, item.stallLabel, item.stallNo, item.note].join(' ').toLocaleLowerCase('tr-TR');
        var matchesSearch = !search || searchText.indexOf(search) !== -1;
        return matchesSection && matchesStatus && matchesSearch;
      }).sort(compareAttendanceRowsByStall);
    }

    function renderStats() {
      var activeMarkets = markets.filter(function(item) { return item.isActive; }).length;
      var totalVendors = vendors.length;
      var missingDocs = vendors.filter(function(item) { return !item.documents.isComplete; }).length;
      var onLeave = attendanceSheet.filter(function(item) { return item.recommendedStatus === 'İzinli' || item.recommendedStatus === 'Raporlu'; }).length;
      document.getElementById('statActiveMarkets').textContent = activeMarkets;
      document.getElementById('statTotalVendors').textContent = totalVendors;
      document.getElementById('statMissingDocs').textContent = missingDocs;
      document.getElementById('statOnLeave').textContent = onLeave;
    }

    function renderMarketCards() {
      var grid = document.getElementById('marketGrid');
      if (!markets.length) {
        grid.innerHTML = '<div class="empty-state">Pazar bilgisi bulunamadı.</div>';
        return;
      }
      var html = '';
      for (var i = 0; i < markets.length; i++) {
        var item = markets[i];
        var sectionsHtml = '';
        for (var j = 0; j < item.sections.length; j++) {
          var sec = item.sections[j];
          sectionsHtml += '<div class="section-line">' +
            '<div><div class="section-label">' + escapeHtml(sec.sectionName) + '</div><div class="section-sub">Numara rengi: ' + escapeHtml(sec.numberColor || '-') + '</div></div>' +
            '<div style="text-align:right;"><div class="section-label">' + escapeHtml(sec.activeVendorCount) + ' / ' + escapeHtml(sec.capacity || 0) + '</div><div class="section-sub">Aktif / kapasite</div></div>' +
          '</div>';
        }
        html += '<div class="market-card">' +
          '<div class="market-top">' +
            '<div><div class="market-name">' + escapeHtml(item.name) + '</div><div class="market-sub">Kurulum günü: ' + escapeHtml(item.scheduledDayLabel) + '</div></div>' +
            formatBadge(item.isActive) +
          '</div>' +
          '<div class="stack"><div class="cell-title">Toplam satıcı: ' + escapeHtml(item.vendorCount) + '</div><div class="cell-sub">Aktif satıcı: ' + escapeHtml(item.activeVendorCount) + '</div>' + (item.notes ? '<div class="cell-sub">Not: ' + escapeHtml(item.notes) + '</div>' : '') + '</div>' +
          '<div class="market-sections">' + sectionsHtml + '</div>' +
          '<div class="toolbar"><button class="mini-btn primary" type="button" onclick="openMarketModal(' + item.id + ')">Ayarları Düzenle</button><button class="mini-btn" type="button" onclick="useMarketInAttendance(' + item.id + ')">Yoklamada Aç</button></div>' +
        '</div>';
      }
      grid.innerHTML = html;
    }

    function populateMarketSelects() {
      var options = '<option value="all">Tüm Pazarlar</option>';
      for (var i = 0; i < markets.length; i++) {
        options += '<option value="' + markets[i].id + '">' + escapeHtml(markets[i].name) + '</option>';
      }
      document.getElementById('vendorMarketFilter').innerHTML = options;
      document.getElementById('leaveMarketFilter').innerHTML = options;

      var activeOptions = '';
      var marketModalOptions = '';
      for (var j = 0; j < markets.length; j++) {
        var market = markets[j];
        marketModalOptions += '<option value="' + market.id + '">' + escapeHtml(market.name) + '</option>';
        if (market.isActive) activeOptions += '<option value="' + market.id + '">' + escapeHtml(market.name) + '</option>';
      }
      document.getElementById('vendorMarketId').innerHTML = marketModalOptions;
      document.getElementById('attendanceMarketFilter').innerHTML = activeOptions || marketModalOptions;
      if (!document.getElementById('vendorMarketFilter').value) document.getElementById('vendorMarketFilter').value = 'all';
      if (!document.getElementById('leaveMarketFilter').value) document.getElementById('leaveMarketFilter').value = 'all';
      if (!document.getElementById('attendanceMarketFilter').value && (activeOptions || marketModalOptions)) {
        document.getElementById('attendanceMarketFilter').selectedIndex = 0;
      }
      refreshVendorSelectOptions();
    }

    function refreshVendorSelectOptions() {
      var list = vendors.slice().sort(function(a, b) { return (a.fullName || '').localeCompare(b.fullName || '', 'tr'); });
      var html = '<option value="">Satıcı seçiniz</option>';
      for (var i = 0; i < list.length; i++) {
        html += '<option value="' + list[i].id + '">' + escapeHtml(list[i].fullName + ' · ' + list[i].marketName + (list[i].stallLabel ? ' · ' + list[i].stallLabel : '')) + '</option>';
      }
      document.getElementById('leaveVendorId').innerHTML = html;
    }

    function getFilteredVendors() {
      var marketId = document.getElementById('vendorMarketFilter').value;
      var section = document.getElementById('vendorSectionFilter').value;
      var status = document.getElementById('vendorStatusFilter').value;
      var docStatus = document.getElementById('vendorDocFilter').value;
      var search = document.getElementById('vendorSearchInput').value.trim().toLocaleLowerCase('tr-TR');
      return vendors.filter(function(item) {
        var text = [item.fullName, item.identityNumber, item.phone, item.address, item.stallLabel, item.marketName].join(' ').toLocaleLowerCase('tr-TR');
        var matchesMarket = marketId === 'all' || String(item.marketId) === String(marketId);
        var matchesSection = section === 'all' || item.sectionType === section;
        var matchesStatus = status === 'all' || (status === 'active' ? item.isActive : !item.isActive);
        var matchesDocs = docStatus === 'all' || (docStatus === 'complete' ? item.documents.isComplete : !item.documents.isComplete);
        var matchesSearch = !search || text.indexOf(search) !== -1;
        return matchesMarket && matchesSection && matchesStatus && matchesDocs && matchesSearch;
      }).sort(compareVendorsByStall);
    }

    function renderVendorTable() {
      var body = document.getElementById('vendorTableBody');
      var rows = getFilteredVendors();
      if (!rows.length) {
        body.innerHTML = '<tr><td colspan="6"><div class="empty-state">Bu filtreye uygun satıcı kaydı bulunmuyor.</div></td></tr>';
        renderVendorPagination(0, 0, 1, 0, 0);
        renderStats();
        return;
      }
      var totalPages = Math.max(1, Math.ceil(rows.length / vendorPageSize));
      if (vendorCurrentPage > totalPages) vendorCurrentPage = totalPages;
      if (vendorCurrentPage < 1) vendorCurrentPage = 1;
      var startIndex = (vendorCurrentPage - 1) * vendorPageSize;
      var endIndex = startIndex + vendorPageSize;
      var pagedRows = rows.slice(startIndex, endIndex);
      var html = '';
      for (var i = 0; i < pagedRows.length; i++) {
        var item = pagedRows[i];
        var docChips = item.documents.requiredDocs.map(function(label) {
          var isMissing = item.documents.missingDocs.indexOf(label) !== -1;
          return '<span class="doc-chip ' + (isMissing ? 'missing' : 'ok') + '">' + escapeHtml(label) + '</span>';
        }).join('');
        html += '<tr>' +
          '<td><div class="cell-title">' + escapeHtml(item.fullName) + '</div>' +
          '<div class="cell-sub">TC: ' + escapeHtml(item.identityNumber || 'Girilmeyen') + '</div>' +
          '<div class="cell-sub">Tel: ' + escapeHtml(item.phone || 'Girilmeyen') + '</div>' +
          '<div class="cell-sub">Durum: ' + (item.isActive ? 'Aktif' : 'Pasif') + '</div></td>' +
          '<td><div class="cell-title">' + escapeHtml(item.marketName) + '</div><div class="cell-sub">' + escapeHtml(item.scheduledDayLabel) + '</div></td>' +
          '<td><div class="cell-title">' + escapeHtml(item.sectionType) + '</div><div class="cell-sub">Yer: ' + escapeHtml(item.stallLabel || 'Atanmadı') + '</div></td>' +
          '<td><div class="cell-title">' + escapeHtml(item.documents.completedCount) + ' / ' + escapeHtml(item.documents.totalRequired) + ' tamam</div><div class="doc-list">' + docChips + '</div></td>' +
          '<td><div class="stack">' +
            (item.documentFolderUrl ? '<a class="mini-btn primary" href="' + escapeHtml(item.documentFolderUrl) + '" target="_blank" rel="noopener">Drive Klasörü</a>' : '<span class="muted">Drive linki yok</span>') +
            '<div class="cell-sub">' + escapeHtml(item.note || 'Not girilmedi') + '</div>' +
          '</div></td>' +
          '<td><div class="toolbar">' +
            '<button class="mini-btn primary" type="button" onclick="openVendorModal(' + item.id + ')">Düzenle</button>' +
            '<button class="mini-btn" type="button" onclick="prepareAttendanceForVendor(' + item.id + ')">Yoklamada Aç</button>' +
            '<button class="mini-btn warn" type="button" onclick="openLeaveModal(null, ' + item.id + ')">İzin / Rapor</button>' +
            '<button class="mini-btn" type="button" onclick="deleteVendor(' + item.id + ')">Sil</button>' +
          '</div></td>' +
        '</tr>';
      }
      body.innerHTML = html;
      renderVendorPagination(rows.length, totalPages, vendorCurrentPage, startIndex + 1, Math.min(endIndex, rows.length));
      renderStats();
    }

    function getFilteredLeaves() {
      var marketId = document.getElementById('leaveMarketFilter').value;
      var type = document.getElementById('leaveTypeFilter').value;
      var activeMode = document.getElementById('leaveActiveFilter').value;
      var today = new Date().toISOString().slice(0, 10);
      return leaveRecords.filter(function(item) {
        var matchesMarket = marketId === 'all' || String(item.marketId) === String(marketId);
        var matchesType = type === 'all' || item.leaveType === type;
        var matchesActive = activeMode === 'all' || (item.startDate <= today && item.endDate >= today);
        return matchesMarket && matchesType && matchesActive;
      });
    }

    function renderLeaveTable() {
      var body = document.getElementById('leaveTableBody');
      var rows = getFilteredLeaves();
      if (!rows.length) {
        body.innerHTML = '<tr><td colspan="6"><div class="empty-state">Bu filtreye uygun izin / rapor kaydı bulunmuyor.</div></td></tr>';
        return;
      }
      var html = '';
      for (var i = 0; i < rows.length; i++) {
        var item = rows[i];
        html += '<tr>' +
          '<td><div class="cell-title">' + escapeHtml(item.vendorName) + '</div><div class="cell-sub">Eklenme: ' + escapeHtml(item.createdAt) + '</div></td>' +
          '<td>' + escapeHtml(item.marketName) + '</td>' +
          '<td>' + (item.leaveType === 'Raporlu' ? '<span class="badge warn">Raporlu</span>' : '<span class="badge info">İzinli</span>') + '</td>' +
          '<td><div class="cell-title">' + escapeHtml(item.startDateText) + ' - ' + escapeHtml(item.endDateText) + '</div></td>' +
          '<td>' + escapeHtml(item.note || 'Açıklama girilmedi') + '</td>' +
          '<td><div class="toolbar"><button class="mini-btn primary" type="button" onclick="openLeaveModal(' + item.id + ')">Düzenle</button><button class="mini-btn" type="button" onclick="deleteLeaveRecord(' + item.id + ')">Sil</button></div></td>' +
        '</tr>';
      }
      body.innerHTML = html;
    }

    function renderAttendanceSheet() {
      var body = document.getElementById('attendanceTableBody');
      var infoBox = document.getElementById('attendanceListInfo');
      updateAttendanceWarning();
      if (!attendanceSheet.length) {
        body.innerHTML = '<tr><td colspan="5"><div class="empty-state">Seçilen pazar ve tarihte gösterilecek aktif satıcı bulunmuyor.</div></td></tr>';
        if (infoBox) infoBox.textContent = attendancePanelOpen ? 'Gösterilecek satıcı yok.' : '';
        renderAttendancePagination(0, 0, 1, 0, 0);
        renderStats();
        return;
      }
      var rows = getFilteredAttendanceRows();
      if (infoBox) infoBox.textContent = 'Toplam ' + attendanceSheet.length + ' satıcı var. Filtreye göre ' + rows.length + ' satır gösteriliyor. Liste yer numarasına göre sıralanır ve 10\'arlı sayfalanır.';
      if (!rows.length) {
        body.innerHTML = '<tr><td colspan="5"><div class="empty-state">Bu filtreye uygun yoklama satırı bulunmuyor.</div></td></tr>';
        renderAttendancePagination(0, 0, 1, 0, 0);
        renderStats();
        return;
      }
      var totalPages = Math.max(1, Math.ceil(rows.length / attendancePageSize));
      if (attendanceCurrentPage > totalPages) attendanceCurrentPage = totalPages;
      if (attendanceCurrentPage < 1) attendanceCurrentPage = 1;
      var startIndex = (attendanceCurrentPage - 1) * attendancePageSize;
      var endIndex = startIndex + attendancePageSize;
      var pagedRows = rows.slice(startIndex, endIndex);
      var html = '';
      for (var i = 0; i < pagedRows.length; i++) {
        var item = pagedRows[i];
        var status = item.selectedStatus || '';
        var autoInfo = item.leaveType
          ? '<span class="badge ' + (item.leaveType === 'Raporlu' ? 'warn' : 'info') + '">' + escapeHtml(item.leaveType) + '</span><span class="badge" style="margin-left:6px;">Kilitli</span><div class="cell-sub">' + escapeHtml(item.leavePeriodText) + '</div><div class="cell-sub">' + escapeHtml(item.leaveNote || 'Açıklama yok') + '</div>'
          : (item.attendanceStatus ? '<span class="badge success">Kayıtlı Yoklama</span><div class="cell-sub">Durum: ' + escapeHtml(item.attendanceStatus) + '</div>' : '<span class="muted">Otomatik öneri yok</span>');
        html += '<tr>' +
          '<td><div class="cell-title">' + escapeHtml(item.vendorName) + '</div><div class="cell-sub">' + escapeHtml(item.marketName) + '</div></td>' +
          '<td><div class="cell-title">' + escapeHtml(item.sectionType) + '</div><div class="cell-sub">Yer: ' + escapeHtml(item.stallLabel || 'Atanmadı') + '</div></td>' +
          '<td>' + autoInfo + '</td>' +
          '<td><div class="status-buttons">' +
            buildStatusButton(item.vendorId, 'Var', status, item.isLocked) +
            buildStatusButton(item.vendorId, 'Yok', status, item.isLocked) +
            buildStatusButton(item.vendorId, 'İzinli', status, item.isLocked) +
            buildStatusButton(item.vendorId, 'Raporlu', status, item.isLocked) +
          '</div></td>' +
          '<td><input class="attendance-note" type="text" value="' + escapeHtml(item.note || '') + '" oninput="updateAttendanceNote(' + item.vendorId + ', this.value)" placeholder="Kısa not" /></td>' +
        '</tr>';
      }
      body.innerHTML = html;
      renderAttendancePagination(rows.length, totalPages, attendanceCurrentPage, startIndex + 1, Math.min(endIndex, rows.length));
      renderStats();
    }

    function buildStatusButton(vendorId, label, activeLabel, isLocked) {
      var cls = label.toLocaleLowerCase('tr-TR');
      var disabled = isLocked ? 'disabled' : '';
      var lockedClass = isLocked ? ' locked' : '';
      return "<button class=\"status-btn" + lockedClass + " " + (label === activeLabel ? ('active ' + cls) : '') + "\" " + disabled + " type=\"button\" onclick=\"pickAttendanceStatus(" + vendorId + ", '" + label + "')\">" + escapeHtml(label) + "</button>";
    }

    function renderAttendanceHistory() {
      var body = document.getElementById('historyTableBody');
      if (!attendanceHistory.length) {
        body.innerHTML = '<tr><td colspan="5"><div class="empty-state">Henüz yoklama geçmişi bulunmuyor.</div></td></tr>';
        return;
      }
      var html = '';
      for (var i = 0; i < attendanceHistory.length; i++) {
        var item = attendanceHistory[i];
        html += '<tr>' +
          '<td><div class="cell-title">' + escapeHtml(item.attendanceDateText) + '</div><div class="cell-sub">Kayıt sayısı: ' + escapeHtml(item.recordCount) + '</div></td>' +
          '<td><div class="cell-title">' + escapeHtml(item.marketName) + '</div></td>' +
          '<td><div class="doc-list">' +
            '<span class="doc-chip ok">Var: ' + escapeHtml(item.presentCount) + '</span>' +
            '<span class="doc-chip missing">Yok: ' + escapeHtml(item.absentCount) + '</span>' +
            '<span class="doc-chip">İzinli: ' + escapeHtml(item.leaveCount) + '</span>' +
            '<span class="doc-chip">Raporlu: ' + escapeHtml(item.reportCount) + '</span>' +
          '</div></td>' +
          '<td>' + escapeHtml(item.updatedAt || '-') + '</td>' +
          '<td><div class="toolbar">' +
            '<button class="mini-btn" type="button" data-history-action="detail" data-market-id="' + escapeHtml(item.marketId) + '" data-attendance-date="' + escapeHtml(item.attendanceDate) + '">Yoklama Detayı</button>' +
            '<button class="mini-btn primary" type="button" data-history-action="edit" data-market-id="' + escapeHtml(item.marketId) + '" data-attendance-date="' + escapeHtml(item.attendanceDate) + '">Düzenle</button>' +
            '<button class="mini-btn warn" type="button" data-history-action="delete" data-market-id="' + escapeHtml(item.marketId) + '" data-attendance-date="' + escapeHtml(item.attendanceDate) + '">Sil</button>' +
          '</div></td>' +
        '</tr>';
      }
      body.innerHTML = html;
    }

    function updateAttendanceWarning() {
      var marketId = document.getElementById('attendanceMarketFilter').value;
      var market = getMarketById(marketId);
      var date = document.getElementById('attendanceDate').value;
      var box = document.getElementById('attendanceWarning');
      var info = document.getElementById('attendanceDayInfo');
      if (!market || !date) {
        box.className = 'banner warn';
        box.textContent = '';
        info.textContent = '';
        return;
      }
      var dayNames = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
      var selectedDay = new Date(date + 'T12:00:00').getDay();
      info.textContent = market.name + ' · normal kurulum günü: ' + market.scheduledDayLabel;
      if (selectedDay !== Number(market.scheduledDay)) {
        box.className = 'banner warn show';
        box.textContent = 'Seçilen tarih ' + dayNames[selectedDay] + ' gününe denk geliyor. Bu pazarın normal kurulum günü ' + market.scheduledDayLabel + '.';
      } else {
        box.className = 'banner info show';
        box.textContent = 'Seçilen tarih pazarın normal kurulum gününe uygundur.';
      }
    }

    function clearVendorFilters() {
      document.getElementById('vendorMarketFilter').value = 'all';
      document.getElementById('vendorSectionFilter').value = 'all';
      document.getElementById('vendorStatusFilter').value = 'all';
      document.getElementById('vendorDocFilter').value = 'all';
      document.getElementById('vendorSearchInput').value = '';
      vendorCurrentPage = 1;
      renderVendorTable();
    }

    function buildVendorExportQuery() {
      var query = [];
      var marketId = document.getElementById('vendorMarketFilter').value;
      var section = document.getElementById('vendorSectionFilter').value;
      var status = document.getElementById('vendorStatusFilter').value;
      var docStatus = document.getElementById('vendorDocFilter').value;
      var search = document.getElementById('vendorSearchInput').value.trim();
      if (marketId) query.push('marketId=' + encodeURIComponent(marketId));
      if (section) query.push('section=' + encodeURIComponent(section));
      if (status) query.push('status=' + encodeURIComponent(status));
      if (docStatus) query.push('docStatus=' + encodeURIComponent(docStatus));
      if (search) query.push('search=' + encodeURIComponent(search));
      return query.join('&');
    }

    function downloadVendorExportExcel() {
      var query = buildVendorExportQuery();
      window.location.href = '/api/markets/vendors/export.xlsx' + (query ? ('?' + query) : '');
    }

    function printVendorReport() {
      var rows = getFilteredVendors();
      if (!rows.length) {
        alert('PDF oluşturmak için listede en az bir satıcı kaydı olmalıdır.');
        return;
      }
      var marketText = document.getElementById('vendorMarketFilter').selectedOptions[0] ? document.getElementById('vendorMarketFilter').selectedOptions[0].textContent : 'Tüm Pazarlar';
      var sectionText = document.getElementById('vendorSectionFilter').selectedOptions[0] ? document.getElementById('vendorSectionFilter').selectedOptions[0].textContent : 'Tüm Bölümler';
      var statusText = document.getElementById('vendorStatusFilter').selectedOptions[0] ? document.getElementById('vendorStatusFilter').selectedOptions[0].textContent : 'Tüm Durumlar';
      var docText = document.getElementById('vendorDocFilter').selectedOptions[0] ? document.getElementById('vendorDocFilter').selectedOptions[0].textContent : 'Belge Durumu';
      var searchText = document.getElementById('vendorSearchInput').value.trim() || 'Yok';
      var nowText = new Date().toLocaleString('tr-TR');
      var summaryHtml = [
        '<span class="doc-chip">Toplam: ' + rows.length + '</span>',
        '<span class="doc-chip ok">Aktif: ' + rows.filter(function(item){ return item.isActive; }).length + '</span>',
        '<span class="doc-chip missing">Pasif: ' + rows.filter(function(item){ return !item.isActive; }).length + '</span>',
        '<span class="doc-chip">Belgesi Tam: ' + rows.filter(function(item){ return item.documents && item.documents.isComplete; }).length + '</span>',
        '<span class="doc-chip">Belgesi Eksik: ' + rows.filter(function(item){ return item.documents && !item.documents.isComplete; }).length + '</span>'
      ].join('');
      var tableRows = rows.map(function(item) {
        var docsText = item.documents.requiredDocs.map(function(label) {
          return item.documents.missingDocs.indexOf(label) === -1 ? label + ' ✓' : label + ' ✗';
        }).join(', ');
        return '<tr>' +
          '<td><strong>' + escapeHtml(item.fullName) + '</strong><div class="sub">TC: ' + escapeHtml(item.identityNumber || '-') + '</div><div class="sub">Tel: ' + escapeHtml(item.phone || '-') + '</div></td>' +
          '<td>' + escapeHtml(item.marketName || '-') + '<div class="sub">' + escapeHtml(item.scheduledDayLabel || '') + '</div></td>' +
          '<td>' + escapeHtml(item.sectionType || '-') + '<div class="sub">Yer: ' + escapeHtml(item.stallLabel || '-') + '</div></td>' +
          '<td>' + (item.isActive ? 'Aktif' : 'Pasif') + '</td>' +
          '<td>' + escapeHtml((item.documents.completedCount || 0) + ' / ' + (item.documents.totalRequired || 0) + ' tamam') + '<div class="sub">' + escapeHtml(docsText || '-') + '</div></td>' +
          '<td>' + escapeHtml(item.note || '-') + '</td>' +
        '</tr>';
      }).join('');
      var reportHtml = '' +
        '<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>Satıcı Listesi PDF</title>' +
        '<style>' +
        'body{font-family:Arial,Helvetica,sans-serif;color:#1f2937;padding:20px;background:#fff;} .report{max-width:1200px;margin:0 auto;} h1{font-size:28px;margin:0 0 6px;} .subtitle{font-size:14px;color:#64748b;margin-bottom:16px;} .meta-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 18px;margin:16px 0;} .meta-card{border:1px solid #dbe3ef;border-radius:12px;padding:10px 12px;background:#f8fbff;} .meta-label{font-size:12px;color:#64748b;font-weight:700;margin-bottom:4px;} .meta-value{font-size:14px;font-weight:600;color:#111827;} .summary{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 18px;} .doc-chip{display:inline-block;padding:6px 10px;border-radius:999px;border:1px solid #dbe3ef;background:#f8fbff;font-size:12px;font-weight:700;} .ok{background:#ecfdf3;border-color:#b7ebc6;color:#166534;} .missing{background:#fff1f2;border-color:#fecdd3;color:#be123c;} table{width:100%;border-collapse:collapse;table-layout:fixed;} th,td{border:1px solid #dbe3ef;padding:10px 8px;vertical-align:top;font-size:12px;word-break:break-word;} th{background:#eff4fb;font-size:12px;text-align:left;color:#475569;} .sub{font-size:11px;color:#64748b;margin-top:4px;} @page{size:A4 landscape;margin:12mm;} @media print{body{padding:0;} .report{max-width:none;}}' +
        '</style></head><body><div class="report">' +
        '<h1>Satıcı Kayıt Listesi</h1>' +
        '<div class="subtitle">Filtrelenmiş satıcı listesi · Oluşturma: ' + escapeHtml(nowText) + '</div>' +
        '<div class="meta-grid">' +
          '<div class="meta-card"><div class="meta-label">Pazar</div><div class="meta-value">' + escapeHtml(marketText) + '</div></div>' +
          '<div class="meta-card"><div class="meta-label">Bölüm</div><div class="meta-value">' + escapeHtml(sectionText) + '</div></div>' +
          '<div class="meta-card"><div class="meta-label">Durum</div><div class="meta-value">' + escapeHtml(statusText) + '</div></div>' +
          '<div class="meta-card"><div class="meta-label">Belge Durumu</div><div class="meta-value">' + escapeHtml(docText) + '</div></div>' +
          '<div class="meta-card" style="grid-column:1/-1;"><div class="meta-label">Arama</div><div class="meta-value">' + escapeHtml(searchText) + '</div></div>' +
        '</div>' +
        '<div class="summary">' + summaryHtml + '</div>' +
        '<table><thead><tr><th>Satıcı</th><th>Pazar</th><th>Bölüm / Yer</th><th>Durum</th><th>Belge Özeti</th><th>Not</th></tr></thead><tbody>' + tableRows + '</tbody></table>' +
        '</div></body></html>';
      var printWindow = window.open('', '_blank', 'width=1280,height=900');
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

    function resetVendorImportModal() {
      vendorImportPreviewRows = [];
      var fileInput = document.getElementById('vendorImportFile');
      if (fileInput) fileInput.value = '';
      document.getElementById('vendorImportSummary').innerHTML = '<span class="doc-chip">Henüz dosya seçilmedi.</span>';
      document.getElementById('vendorImportHelp').textContent = 'Sistem aynı pazar + bölüm + renk + yer no kombinasyonunu kontrol eder. Var olan kayıtlar önizlemede uyarı olarak gösterilir ve içe almada atlanır.';
      document.getElementById('vendorImportPreviewBody').innerHTML = '<tr><td colspan="5"><div class="empty-state">Önizleme henüz oluşturulmadı.</div></td></tr>';
      document.getElementById('vendorImportCommitBtn').disabled = true;
    }

    function openVendorImportModal() {
      resetVendorImportModal();
      openModal('vendorImportModal');
    }

    function renderVendorImportPreview() {
      var summary = document.getElementById('vendorImportSummary');
      var body = document.getElementById('vendorImportPreviewBody');
      var help = document.getElementById('vendorImportHelp');
      var validRows = vendorImportPreviewRows.filter(function(item) { return !(item.errors && item.errors.length); });
      var invalidRows = vendorImportPreviewRows.filter(function(item) { return item.errors && item.errors.length; });
      summary.innerHTML = '' +
        '<span class="doc-chip">Toplam Satır: ' + vendorImportPreviewRows.length + '</span>' +
        '<span class="doc-chip ok">Uygun: ' + validRows.length + '</span>' +
        '<span class="doc-chip warn">Uyarılı: ' + invalidRows.length + '</span>';
      if (!vendorImportPreviewRows.length) {
        body.innerHTML = '<tr><td colspan="5"><div class="empty-state">Önizleme bulunamadı.</div></td></tr>';
        help.textContent = 'Önizleme bulunamadı.';
        document.getElementById('vendorImportCommitBtn').disabled = true;
        return;
      }
      help.textContent = invalidRows.length ? 'Uyarılı satırlar içe aktarım sırasında atlanır. Uygun satırlar tek seferde kaydedilir.' : 'Tüm satırlar içe aktarım için uygundur.';
      var html = vendorImportPreviewRows.map(function(item) {
        var statusHtml = item.errors && item.errors.length
          ? '<span class="status-pill err">' + escapeHtml(item.errors.join(', ')) + '</span>'
          : '<span class="status-pill ok">İçe Aktarılacak</span>';
        return '<tr>' +
          '<td>' + escapeHtml(item.rowNumber) + '</td>' +
          '<td>' + escapeHtml(item.marketName || '-') + '</td>' +
          '<td>' + escapeHtml(item.sectionType || '-') + '<div class="cell-sub">' + escapeHtml((item.stallColor || '') + ' ' + (item.stallNo || '')) + '</div></td>' +
          '<td>' + escapeHtml(item.fullName || '-') + '</td>' +
          '<td>' + statusHtml + '</td>' +
        '</tr>';
      }).join('');
      body.innerHTML = html;
      document.getElementById('vendorImportCommitBtn').disabled = validRows.length === 0;
    }

    async function previewVendorImport() {
      var input = document.getElementById('vendorImportFile');
      if (!input.files || !input.files.length) {
        alert('Önce bir Excel dosyası seçmelisin.');
        return;
      }
      var formData = new FormData();
      formData.append('file', input.files[0]);
      document.getElementById('vendorImportSummary').innerHTML = '<span class="doc-chip">Dosya okunuyor...</span>';
      document.getElementById('vendorImportPreviewBody').innerHTML = '<tr><td colspan="5"><div class="empty-state">Önizleme hazırlanıyor...</div></td></tr>';
      document.getElementById('vendorImportCommitBtn').disabled = true;
      try {
        var response = await fetch('/api/markets/vendors/import/preview', { method: 'POST', body: formData });
        var data = await response.json().catch(function() { return {}; });
        if (!response.ok) throw new Error(data.error || 'Excel önizlemesi oluşturulamadı.');
        vendorImportPreviewRows = Array.isArray(data.rows) ? data.rows : [];
        renderVendorImportPreview();
      } catch (error) {
        vendorImportPreviewRows = [];
        renderVendorImportPreview();
        alert(error.message || 'Excel önizlemesi oluşturulamadı.');
      }
    }

    async function commitVendorImport() {
      var validRows = vendorImportPreviewRows.filter(function(item) { return !(item.errors && item.errors.length); });
      if (!validRows.length) {
        alert('İçe aktarılacak uygun satır bulunamadı.');
        return;
      }
      if (!window.confirm(validRows.length + ' satır toplu olarak eklensin mi?')) return;
      var button = document.getElementById('vendorImportCommitBtn');
      button.disabled = true;
      try {
        var response = await fetch('/api/markets/vendors/import/commit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rows: validRows }),
        });
        var data = await response.json().catch(function() { return {}; });
        if (!response.ok) throw new Error(data.error || 'Toplu içe aktarma tamamlanamadı.');
        closeModal('vendorImportModal');
        showBanner((data.insertedCount || 0) + ' satır içeri aktarıldı. Atlanan: ' + (data.skippedCount || 0), 'info');
        await reloadAll();
      } catch (error) {
        button.disabled = false;
        alert(error.message || 'Toplu içe aktarma tamamlanamadı.');
      }
    }

    function clearLeaveFilters() {
      document.getElementById('leaveMarketFilter').value = 'all';
      document.getElementById('leaveTypeFilter').value = 'all';
      document.getElementById('leaveActiveFilter').value = 'all';
      renderLeaveTable();
    }

    function getSuggestedDateForMarket(marketId) {
      var market = getMarketById(marketId);
      var today = new Date();
      var result = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      if (!market) return result.toISOString().slice(0, 10);
      var targetDay = Number(market.scheduledDay);
      var diff = (targetDay - result.getDay() + 7) % 7;
      result.setDate(result.getDate() + diff);
      return result.toISOString().slice(0, 10);
    }

    function setSuggestedDateForSelectedMarket(forceReload) {
      var marketId = document.getElementById('attendanceMarketFilter').value;
      if (!marketId) return;
      document.getElementById('attendanceDate').value = getSuggestedDateForMarket(marketId);
      if (forceReload) loadAttendanceSheet();
    }

    function handleAttendanceMarketChange() {
      setSuggestedDateForSelectedMarket(attendancePanelOpen);
      loadAttendanceHistory();
    }

    function handleAttendanceDateChange() {
      if (attendancePanelOpen) loadAttendanceSheet();
      else updateAttendanceWarning();
    }

    function pickAttendanceStatus(vendorId, status) {
      for (var i = 0; i < attendanceSheet.length; i++) {
        if (String(attendanceSheet[i].vendorId) === String(vendorId)) {
          if (attendanceSheet[i].isLocked) return;
          attendanceSheet[i].selectedStatus = status;
        }
      }
      renderAttendanceSheet();
    }

    function updateAttendanceNote(vendorId, value) {
      for (var i = 0; i < attendanceSheet.length; i++) {
        if (String(attendanceSheet[i].vendorId) === String(vendorId)) attendanceSheet[i].note = value;
      }
    }

    function markAllAttendance(status) {
      for (var i = 0; i < attendanceSheet.length; i++) {
        if (attendanceSheet[i].isLocked) attendanceSheet[i].selectedStatus = attendanceSheet[i].lockedStatus || attendanceSheet[i].recommendedStatus;
        else if (!attendanceSheet[i].recommendedStatus) attendanceSheet[i].selectedStatus = status;
        else attendanceSheet[i].selectedStatus = attendanceSheet[i].recommendedStatus;
      }
      renderAttendanceSheet();
    }

    function updateVendorDocumentHint() {
      var section = document.getElementById('vendorSectionType').value;
      var hint = document.getElementById('vendorDocumentHint');
      if (section === 'Üretici') hint.textContent = 'Üreticiler için beklenen belgeler: Fotoğraf, Kimlik Fotokopisi, Nüfus Kayıt Belgesi ve ÇKS Belgesi.';
      else hint.textContent = 'Esnaf ve Tuhafiye için beklenen belgeler: Fotoğraf, Kimlik Fotokopisi, Oda Kayıt Belgesi, Nüfus Kayıt Belgesi ve Vergi Kayıt Belgesi.';
    }

    function resetVendorForm() {
      editingVendorId = null;
      document.getElementById('vendorModalTitle').textContent = 'Yeni Satıcı Kaydı';
      document.getElementById('vendorFullName').value = '';
      document.getElementById('vendorIdentityNumber').value = '';
      document.getElementById('vendorPhone').value = '';
      document.getElementById('vendorAddress').value = '';
      document.getElementById('vendorSectionType').value = 'Esnaf';
      document.getElementById('vendorStatus').value = 'true';
      document.getElementById('vendorStallColor').value = '';
      document.getElementById('vendorStallNo').value = '';
      document.getElementById('vendorDocumentFolderUrl').value = '';
      document.getElementById('vendorNote').value = '';
      document.getElementById('hasPhoto').checked = false;
      document.getElementById('hasIdentityCopy').checked = false;
      document.getElementById('hasChamberRecord').checked = false;
      document.getElementById('hasPopulationRecord').checked = false;
      document.getElementById('hasTaxRecord').checked = false;
      document.getElementById('hasCksDocument').checked = false;
      if (markets.length) document.getElementById('vendorMarketId').value = String(markets[0].id);
      updateVendorDocumentHint();
    }

    function openVendorModal(vendorId) {
      resetVendorForm();
      if (vendorId) {
        var item = getVendorById(vendorId);
        if (!item) return;
        editingVendorId = vendorId;
        document.getElementById('vendorModalTitle').textContent = 'Satıcı Kaydını Düzenle';
        document.getElementById('vendorMarketId').value = String(item.marketId);
        document.getElementById('vendorFullName').value = item.fullName || '';
        document.getElementById('vendorIdentityNumber').value = item.identityNumber || '';
        document.getElementById('vendorPhone').value = item.phone || '';
        document.getElementById('vendorAddress').value = item.address || '';
        document.getElementById('vendorSectionType').value = item.sectionType || 'Esnaf';
        document.getElementById('vendorStatus').value = item.isActive ? 'true' : 'false';
        document.getElementById('vendorStallColor').value = item.stallColor || '';
        document.getElementById('vendorStallNo').value = item.stallNo || '';
        document.getElementById('vendorDocumentFolderUrl').value = item.documentFolderUrl || '';
        document.getElementById('vendorNote').value = item.note || '';
        document.getElementById('hasPhoto').checked = !!item.hasPhoto;
        document.getElementById('hasIdentityCopy').checked = !!item.hasIdentityCopy;
        document.getElementById('hasChamberRecord').checked = !!item.hasChamberRecord;
        document.getElementById('hasPopulationRecord').checked = !!item.hasPopulationRecord;
        document.getElementById('hasTaxRecord').checked = !!item.hasTaxRecord;
        document.getElementById('hasCksDocument').checked = !!item.hasCksDocument;
        updateVendorDocumentHint();
      }
      openModal('vendorModal');
    }

    async function saveVendor() {
      var payload = {
        marketId: document.getElementById('vendorMarketId').value,
        fullName: document.getElementById('vendorFullName').value.trim(),
        identityNumber: document.getElementById('vendorIdentityNumber').value.trim(),
        phone: document.getElementById('vendorPhone').value.trim(),
        address: document.getElementById('vendorAddress').value.trim(),
        sectionType: document.getElementById('vendorSectionType').value,
        isActive: document.getElementById('vendorStatus').value === 'true',
        stallColor: document.getElementById('vendorStallColor').value,
        stallNo: document.getElementById('vendorStallNo').value.trim(),
        documentFolderUrl: document.getElementById('vendorDocumentFolderUrl').value.trim(),
        note: document.getElementById('vendorNote').value.trim(),
        hasPhoto: document.getElementById('hasPhoto').checked,
        hasIdentityCopy: document.getElementById('hasIdentityCopy').checked,
        hasChamberRecord: document.getElementById('hasChamberRecord').checked,
        hasPopulationRecord: document.getElementById('hasPopulationRecord').checked,
        hasTaxRecord: document.getElementById('hasTaxRecord').checked,
        hasCksDocument: document.getElementById('hasCksDocument').checked,
      };
      try {
        var response = await fetch(editingVendorId ? ('/api/markets/vendors/' + editingVendorId) : '/api/markets/vendors', {
          method: editingVendorId ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        var data = await response.json().catch(function() { return {}; });
        if (!response.ok) throw new Error(data.error || 'Satıcı kaydı kaydedilemedi.');
        closeModal('vendorModal');
        showBanner(editingVendorId ? 'Satıcı kaydı güncellendi.' : 'Yeni satıcı kaydı oluşturuldu.', 'info');
        await reloadAll();
      } catch (error) {
        alert(error.message || 'Satıcı kaydı kaydedilemedi.');
      }
    }

    async function deleteVendor(vendorId) {
      var item = getVendorById(vendorId);
      if (!item) return;
      if (!window.confirm(item.fullName + ' kaydı silinsin mi? Bu satıcıya bağlı izin ve yoklama kayıtları da etkilenir.')) return;
      try {
        var response = await fetch('/api/markets/vendors/' + vendorId, { method: 'DELETE' });
        var data = await response.json().catch(function() { return {}; });
        if (!response.ok) throw new Error(data.error || 'Satıcı kaydı silinemedi.');
        showBanner('Satıcı kaydı silindi.', 'warn');
        await reloadAll();
      } catch (error) {
        alert(error.message || 'Satıcı kaydı silinemedi.');
      }
    }

    function resetLeaveForm() {
      editingLeaveId = null;
      document.getElementById('leaveModalTitle').textContent = 'Yeni İzin / Rapor Kaydı';
      document.getElementById('leaveType').value = 'İzinli';
      document.getElementById('leaveStartDate').value = new Date().toISOString().slice(0, 10);
      document.getElementById('leaveEndDate').value = new Date().toISOString().slice(0, 10);
      document.getElementById('leaveNote').value = '';
      if (vendors.length) document.getElementById('leaveVendorId').value = String(vendors[0].id);
    }

    function openLeaveModal(leaveId, presetVendorId) {
      resetLeaveForm();
      if (leaveId) {
        var item = leaveRecords.find(function(row) { return String(row.id) === String(leaveId); });
        if (!item) return;
        editingLeaveId = leaveId;
        document.getElementById('leaveModalTitle').textContent = 'İzin / Rapor Kaydını Düzenle';
        document.getElementById('leaveVendorId').value = String(item.vendorId);
        document.getElementById('leaveType').value = item.leaveType;
        document.getElementById('leaveStartDate').value = item.startDate;
        document.getElementById('leaveEndDate').value = item.endDate;
        document.getElementById('leaveNote').value = item.note || '';
      } else if (presetVendorId) {
        document.getElementById('leaveVendorId').value = String(presetVendorId);
      }
      openModal('leaveModal');
    }

    async function saveLeaveRecord() {
      var payload = {
        vendorId: document.getElementById('leaveVendorId').value,
        leaveType: document.getElementById('leaveType').value,
        startDate: document.getElementById('leaveStartDate').value,
        endDate: document.getElementById('leaveEndDate').value,
        note: document.getElementById('leaveNote').value.trim(),
      };
      try {
        var response = await fetch(editingLeaveId ? ('/api/markets/leave-records/' + editingLeaveId) : '/api/markets/leave-records', {
          method: editingLeaveId ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        var data = await response.json().catch(function() { return {}; });
        if (!response.ok) throw new Error(data.error || 'İzin / rapor kaydı kaydedilemedi.');
        closeModal('leaveModal');
        showBanner(editingLeaveId ? 'İzin / rapor kaydı güncellendi.' : 'Yeni izin / rapor kaydı eklendi.', 'info');
        await reloadAll();
      } catch (error) {
        alert(error.message || 'İzin / rapor kaydı kaydedilemedi.');
      }
    }

    async function deleteLeaveRecord(id) {
      if (!window.confirm('İzin / rapor kaydı silinsin mi?')) return;
      try {
        var response = await fetch('/api/markets/leave-records/' + id, { method: 'DELETE' });
        var data = await response.json().catch(function() { return {}; });
        if (!response.ok) throw new Error(data.error || 'İzin / rapor kaydı silinemedi.');
        showBanner('İzin / rapor kaydı silindi.', 'warn');
        await reloadAll();
      } catch (error) {
        alert(error.message || 'İzin / rapor kaydı silinemedi.');
      }
    }

    function openMarketModal(id) {
      var market = getMarketById(id);
      if (!market) return;
      editingMarketId = id;
      document.getElementById('marketModalTitle').textContent = market.name + ' Ayarları';
      document.getElementById('marketScheduledDay').value = String(market.scheduledDay);
      document.getElementById('marketIsActive').value = market.isActive ? 'true' : 'false';
      document.getElementById('marketNotes').value = market.notes || '';
      var secMap = {};
      for (var i = 0; i < market.sections.length; i++) secMap[market.sections[i].sectionName] = market.sections[i];
      document.getElementById('capacityEsnaf').value = secMap.Esnaf ? secMap.Esnaf.capacity : 0;
      document.getElementById('capacityUretici').value = secMap['Üretici'] ? secMap['Üretici'].capacity : 0;
      document.getElementById('capacityTuhafiye').value = secMap.Tuhafiye ? secMap.Tuhafiye.capacity : 0;
      openModal('marketModal');
    }

    async function saveMarketConfig() {
      var payload = {
        scheduledDay: Number(document.getElementById('marketScheduledDay').value),
        isActive: document.getElementById('marketIsActive').value === 'true',
        notes: document.getElementById('marketNotes').value.trim(),
        sections: [
          { sectionName: 'Esnaf', capacity: Number(document.getElementById('capacityEsnaf').value || 0) },
          { sectionName: 'Üretici', capacity: Number(document.getElementById('capacityUretici').value || 0) },
          { sectionName: 'Tuhafiye', capacity: Number(document.getElementById('capacityTuhafiye').value || 0) },
        ],
      };
      try {
        var response = await fetch('/api/markets/' + editingMarketId, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        var data = await response.json().catch(function() { return {}; });
        if (!response.ok) throw new Error(data.error || 'Pazar ayarı kaydedilemedi.');
        closeModal('marketModal');
        showBanner('Pazar ayarı güncellendi.', 'info');
        await reloadAll();
      } catch (error) {
        alert(error.message || 'Pazar ayarı kaydedilemedi.');
      }
    }

    function useMarketInAttendance(marketId) {
      document.getElementById('attendanceMarketFilter').value = String(marketId);
      setSuggestedDateForSelectedMarket(false);
      openAttendancePanelForNewSession();
    }

    function prepareAttendanceForVendor(vendorId) {
      var item = getVendorById(vendorId);
      if (!item) return;
      document.getElementById('attendanceMarketFilter').value = String(item.marketId);
      setSuggestedDateForSelectedMarket(false);
      openAttendancePanelForNewSession();
    }

    function scrollToAttendance() {
      document.getElementById('attendancePanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function copySelectedDateInfo() {
      var market = getMarketById(document.getElementById('attendanceMarketFilter').value);
      var date = document.getElementById('attendanceDate').value;
      if (!market || !date) return;
      alert(market.name + ' için seçili yoklama tarihi: ' + date + '\nNormal kurulum günü: ' + market.scheduledDayLabel);
    }

    async function loadMarkets() {
      var response = await fetch('/api/markets');
      var data = await response.json().catch(function() { return []; });
      if (!response.ok) throw new Error(data.error || 'Pazar listesi yüklenemedi.');
      markets = data;
      populateMarketSelects();
      renderMarketCards();
    }

    async function loadVendors() {
      var response = await fetch('/api/markets/vendors');
      var data = await response.json().catch(function() { return []; });
      if (!response.ok) throw new Error(data.error || 'Satıcı listesi yüklenemedi.');
      vendors = data;
      refreshVendorSelectOptions();
      renderVendorTable();
    }

    async function loadLeaves() {
      var response = await fetch('/api/markets/leave-records');
      var data = await response.json().catch(function() { return []; });
      if (!response.ok) throw new Error(data.error || 'İzin / rapor kayıtları yüklenemedi.');
      leaveRecords = data;
      renderLeaveTable();
    }

    async function loadAttendanceSheet() {
      var marketId = document.getElementById('attendanceMarketFilter').value;
      var date = document.getElementById('attendanceDate').value;
      if (!marketId || !date) {
        attendanceSheet = [];
        renderAttendanceSheet();
        return;
      }
      var response = await fetch('/api/markets/attendance-sheet?marketId=' + encodeURIComponent(marketId) + '&date=' + encodeURIComponent(date));
      var data = await response.json().catch(function() { return []; });
      if (!response.ok) throw new Error(data.error || 'Yoklama listesi yüklenemedi.');
      attendanceSheet = data.map(function(item) {
        item.selectedStatus = item.isLocked ? (item.lockedStatus || item.leaveType || '') : (item.attendanceStatus || item.recommendedStatus || '');
        return item;
      });
      attendanceCurrentPage = 1;
      renderAttendanceSheet();
    }

    async function loadAttendanceHistory() {
      var marketId = document.getElementById('attendanceMarketFilter').value || 'all';
      var response = await fetch('/api/markets/attendance-history-summary?marketId=' + encodeURIComponent(marketId));
      var data = await response.json().catch(function() { return []; });
      if (!response.ok) throw new Error(data.error || 'Yoklama geçmişi yüklenemedi.');
      attendanceHistory = data;
      renderAttendanceHistory();
    }


    function getAttendanceStatusChip(status) {
      var label = escapeHtml(status || '-');
      if (status === 'Var') return '<span class="doc-chip ok">' + label + '</span>';
      if (status === 'Yok') return '<span class="doc-chip missing">' + label + '</span>';
      if (status === 'İzinli') return '<span class="doc-chip" style="background:#eff6ff;color:#1d4ed8;border-color:#bfdbfe;">' + label + '</span>';
      if (status === 'Raporlu') return '<span class="doc-chip" style="background:#fffbeb;color:#92400e;border-color:#fde68a;">' + label + '</span>';
      return '<span class="doc-chip">' + label + '</span>';
    }

    function downloadAttendanceDetailExcel() {
      if (!attendanceDetailSession || !attendanceDetailSession.marketId || !attendanceDetailSession.attendanceDate) {
        alert('Önce bir yoklama detayı açılmalıdır.');
        return;
      }
      window.location.href = '/api/markets/attendance-session-detail/export.xlsx?marketId=' + encodeURIComponent(attendanceDetailSession.marketId) + '&date=' + encodeURIComponent(attendanceDetailSession.attendanceDate);
    }

    function printAttendanceDetailReport() {
      if (!attendanceDetailSession) {
        alert('Önce bir yoklama detayı açılmalıdır.');
        return;
      }
      var rows = attendanceDetailSession.rows || [];
      var summaryHtml = '' +
        '<div class="summary-grid">' +
          '<div class="summary-card"><div class="summary-label">Toplam</div><div class="summary-value">' + escapeHtml(attendanceDetailSession.recordCount || 0) + '</div></div>' +
          '<div class="summary-card ok"><div class="summary-label">Var</div><div class="summary-value">' + escapeHtml(attendanceDetailSession.presentCount || 0) + '</div></div>' +
          '<div class="summary-card missing"><div class="summary-label">Yok</div><div class="summary-value">' + escapeHtml(attendanceDetailSession.absentCount || 0) + '</div></div>' +
          '<div class="summary-card info"><div class="summary-label">İzinli</div><div class="summary-value">' + escapeHtml(attendanceDetailSession.leaveCount || 0) + '</div></div>' +
          '<div class="summary-card warn"><div class="summary-label">Raporlu</div><div class="summary-value">' + escapeHtml(attendanceDetailSession.reportCount || 0) + '</div></div>' +
        '</div>';
      var tableRows = rows.map(function(item, index) {
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
      if (!tableRows) {
        tableRows = '<tr><td colspan="7">Bu tarihe ait kaydedilmiş yoklama satırı bulunmuyor.</td></tr>';
      }
      var reportHtml = '<!DOCTYPE html><html lang="tr"><head><meta charset="UTF-8"><title>Yoklama Detayı</title><style>' +
        'body{font-family:Inter,Segoe UI,Arial,sans-serif;margin:0;padding:28px;color:#17202f;background:#fff;} ' +
        '.report{max-width:1100px;margin:0 auto;} .top{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;border-bottom:2px solid #e5e7eb;padding-bottom:14px;margin-bottom:18px;} ' +
        '.title{font-size:28px;font-weight:800;letter-spacing:-0.03em;margin:0;} .subtitle{margin-top:6px;color:#667085;font-size:13px;line-height:1.6;} ' +
        '.meta{display:grid;gap:6px;font-size:13px;color:#334155;text-align:right;} .summary-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;margin:18px 0 22px;} ' +
        '.summary-card{border:1px solid #dbe3ee;border-radius:14px;padding:14px;background:#f8fafc;} .summary-card.ok{background:#effcf3;border-color:#bbf7d0;color:#166534;} .summary-card.missing{background:#fff1f2;border-color:#fecdd3;color:#b91c1c;} .summary-card.info{background:#eff6ff;border-color:#bfdbfe;color:#1d4ed8;} .summary-card.warn{background:#fffbeb;border-color:#fde68a;color:#92400e;} ' +
        '.summary-label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;opacity:.8;} .summary-value{font-size:28px;font-weight:800;margin-top:8px;} ' +
        'table{width:100%;border-collapse:collapse;table-layout:fixed;} th,td{border:1px solid #dbe3ee;padding:10px 12px;font-size:12px;vertical-align:top;word-break:break-word;} th{background:#f8fafc;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#667085;} ' +
        '.section-title{font-size:17px;font-weight:800;margin:0 0 10px;} @page{size:A4 landscape;margin:12mm;} @media print{body{padding:0;} .report{max-width:none;}}' +
        '</style></head><body><div class="report">' +
        '<div class="top"><div><h1 class="title">Yoklama Detay Raporu</h1><div class="subtitle">Yoklama geçmişindeki seçili tarih için kaydedilmiş satıcı listesi ve durum özeti.</div></div><div class="meta"><div><strong>Pazar:</strong> ' + escapeHtml(attendanceDetailSession.marketName || '-') + '</div><div><strong>Tarih:</strong> ' + escapeHtml(attendanceDetailSession.attendanceDateText || '-') + '</div><div><strong>Son Güncelleme:</strong> ' + escapeHtml(attendanceDetailSession.updatedAt || '-') + '</div></div></div>' +
        summaryHtml +
        '<h2 class="section-title">Yoklama Listesi</h2>' +
        '<table><thead><tr><th style="width:6%">#</th><th style="width:25%">Satıcı</th><th style="width:12%">Bölüm</th><th style="width:13%">Yer</th><th style="width:12%">Durum</th><th style="width:17%">Not</th><th style="width:15%">Son Güncelleme</th></tr></thead><tbody>' + tableRows + '</tbody></table>' +
        '</div></body></html>';
      var printWindow = window.open('', '_blank', 'width=1200,height=820');
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

    function renderAttendanceDetailModal() {
      var title = document.getElementById('attendanceDetailTitle');
      var subtitle = document.getElementById('attendanceDetailSubtitle');
      var summary = document.getElementById('attendanceDetailSummary');
      var body = document.getElementById('attendanceDetailBody');
      if (!attendanceDetailSession) {
        title.textContent = 'Yoklama Detayı';
        subtitle.textContent = 'Seçilen tarihe ait kayıt özeti burada görüntülenir.';
        summary.innerHTML = '<span class="doc-chip">Kayıt bulunamadı.</span>';
        body.innerHTML = '<tr><td colspan="5"><div class="empty-state">Kayıt bulunamadı.</div></td></tr>';
        return;
      }
      title.textContent = attendanceDetailSession.marketName + ' · ' + attendanceDetailSession.attendanceDateText;
      subtitle.textContent = 'Bu ekranda sadece kaydedilmiş yoklama satırları gösterilir.';
      summary.innerHTML =
        '<span class="doc-chip">Toplam: ' + escapeHtml(attendanceDetailSession.recordCount) + '</span>' +
        '<span class="doc-chip ok">Var: ' + escapeHtml(attendanceDetailSession.presentCount) + '</span>' +
        '<span class="doc-chip missing">Yok: ' + escapeHtml(attendanceDetailSession.absentCount) + '</span>' +
        '<span class="doc-chip">İzinli: ' + escapeHtml(attendanceDetailSession.leaveCount) + '</span>' +
        '<span class="doc-chip">Raporlu: ' + escapeHtml(attendanceDetailSession.reportCount) + '</span>';
      if (!attendanceDetailSession.rows.length) {
        body.innerHTML = '<tr><td colspan="5"><div class="empty-state">Bu tarihe ait kaydedilmiş yoklama satırı bulunmuyor.</div></td></tr>';
        return;
      }
      var html = '';
      for (var i = 0; i < attendanceDetailSession.rows.length; i++) {
        var item = attendanceDetailSession.rows[i];
        html += '<tr>' +
          '<td><div class="cell-title">' + escapeHtml(item.vendorName) + '</div><div class="cell-sub">Pazar: ' + escapeHtml(item.marketName) + '</div></td>' +
          '<td><div class="cell-title">' + escapeHtml(item.sectionType || '-') + '</div><div class="cell-sub">Yer: ' + escapeHtml(item.stallLabel || '-') + '</div></td>' +
          '<td>' + getAttendanceStatusChip(item.status) + '</td>' +
          '<td>' + escapeHtml(item.note || '-') + '</td>' +
          '<td>' + escapeHtml(item.updatedAt || '-') + '</td>' +
        '</tr>';
      }
      body.innerHTML = html;
    }

    async function openAttendanceDetailModal(marketId, date) {
      try {
        attendanceDetailSession = null;
        document.getElementById('attendanceDetailBody').innerHTML = '<tr><td colspan="5"><div class="empty-state">Detay yükleniyor...</div></td></tr>';
        document.getElementById('attendanceDetailSummary').innerHTML = '<span class="doc-chip">Yükleniyor...</span>';
        openModal('attendanceDetailModal');
        var response = await fetch('/api/markets/attendance-session-detail?marketId=' + encodeURIComponent(marketId) + '&date=' + encodeURIComponent(date));
        var data = await response.json().catch(function() { return {}; });
        if (!response.ok) throw new Error(data.error || 'Yoklama detayı yüklenemedi.');
        attendanceDetailSession = data;
        renderAttendanceDetailModal();
      } catch (error) {
        closeModal('attendanceDetailModal');
        alert(error.message || 'Yoklama detayı yüklenemedi.');
      }
    }

    async function openAttendanceHistoryDate(marketId, date) {
      document.getElementById('attendanceMarketFilter').value = String(marketId);
      document.getElementById('attendanceDate').value = date;
      setAttendancePanelState(true, 'history');
      await loadAttendanceSheet();
      await loadAttendanceHistory();
      scrollToAttendance();
      showBanner('Seçilen tarihin yoklama listesi düzenleme için açıldı.', 'info');
    }

    async function deleteAttendanceHistoryDate(marketId, date) {
      if (!window.confirm('Bu pazara ait ' + date + ' tarihli tüm yoklama kayıtları silinsin mi?')) return;
      try {
        var response = await fetch('/api/markets/attendance-session?marketId=' + encodeURIComponent(marketId) + '&date=' + encodeURIComponent(date), { method: 'DELETE' });
        var data = await response.json().catch(function() { return {}; });
        if (!response.ok) throw new Error(data.error || 'Yoklama geçmişi silinemedi.');
        var currentMarketId = document.getElementById('attendanceMarketFilter').value;
        var currentDate = document.getElementById('attendanceDate').value;
        if (String(currentMarketId) === String(marketId) && currentDate === date) {
          attendanceSheet = [];
          renderAttendanceSheet();
          closeAttendancePanel();
        }
        await loadAttendanceHistory();
        showBanner('Seçilen tarihin yoklama kayıtları silindi.', 'warn');
      } catch (error) {
        alert(error.message || 'Yoklama geçmişi silinemedi.');
      }
    }

    async function saveAttendanceSheet() {
      var date = document.getElementById('attendanceDate').value;
      var entries = attendanceSheet.filter(function(item) { return item.selectedStatus; }).map(function(item) {
        return { vendorId: item.vendorId, status: item.selectedStatus, note: item.note || '' };
      });
      if (!date) { alert('Yoklama tarihi seçilmelidir.'); return; }
      if (!entries.length) { alert('Kaydedilecek yoklama satırı bulunmuyor.'); return; }
      try {
        var response = await fetch('/api/markets/attendance/bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date: date, entries: entries }),
        });
        var data = await response.json().catch(function() { return {}; });
        if (!response.ok) throw new Error(data.error || 'Yoklama kaydedilemedi.');
        await loadAttendanceHistory();
        closeAttendancePanel();
        showBanner('Yoklama başarıyla kaydedildi ve panel kapatıldı.', 'info');
      } catch (error) {
        alert(error.message || 'Yoklama kaydedilemedi.');
      }
    }

    async function reloadAll() {
      try {
        await loadMarkets();
        await loadVendors();
        await loadLeaves();
        if (!document.getElementById('attendanceDate').value && document.getElementById('attendanceMarketFilter').value) {
          setSuggestedDateForSelectedMarket(false);
        }
        await loadAttendanceSheet();
        await loadAttendanceHistory();
        renderStats();
      } catch (error) {
        showBanner(error.message || 'Veriler yüklenemedi.', 'warn');
      }
    }

    document.addEventListener('DOMContentLoaded', async function() {
      document.addEventListener('keydown', function(event) {
        if (event.key === 'Escape') {
          if (document.body.classList.contains('sidebar-open')) toggleSidebar(false);
          closeModal('vendorModal');
          closeModal('vendorImportModal');
          closeModal('leaveModal');
          closeModal('marketModal');
          closeModal('attendanceDetailModal');
        }
      });
      document.getElementById('historyTableBody').addEventListener('click', function(event) {
        var button = event.target.closest('[data-history-action]');
        if (!button) return;
        var action = button.getAttribute('data-history-action');
        var marketId = button.getAttribute('data-market-id');
        var date = button.getAttribute('data-attendance-date');
        if (!marketId || !date) return;
        if (action === 'detail') openAttendanceDetailModal(marketId, date);
        else if (action === 'edit') openAttendanceHistoryDate(marketId, date);
        else if (action === 'delete') deleteAttendanceHistoryDate(marketId, date);
      });
      updateVendorDocumentHint();
      setAttendancePanelState(false, 'new');
      try {
        await loadMarkets();
        if (document.getElementById('attendanceMarketFilter').value) setSuggestedDateForSelectedMarket(false);
        await loadVendors();
        await loadLeaves();
        await loadAttendanceSheet();
        await loadAttendanceHistory();
        renderStats();
      } catch (error) {
        showBanner(error.message || 'Pazar modülü yüklenemedi.', 'warn');
      }
    });
  