
    var markets = [];
    var vendors = [];
    var leaveRecords = [];
    var attendanceSheet = [];
    var attendanceHistory = [];
    var attendancePanelOpen = false;
    var attendancePanelMode = 'new';
    var attendanceDetailSession = null;
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
      });
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
      });
    }

    function renderVendorTable() {
      var body = document.getElementById('vendorTableBody');
      var rows = getFilteredVendors();
      if (!rows.length) {
        body.innerHTML = '<tr><td colspan="6"><div class="empty-state">Bu filtreye uygun satıcı kaydı bulunmuyor.</div></td></tr>';
        renderStats();
        return;
      }
      var html = '';
      for (var i = 0; i < rows.length; i++) {
        var item = rows[i];
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
        renderStats();
        return;
      }
      var rows = getFilteredAttendanceRows();
      if (infoBox) infoBox.textContent = 'Toplam ' + attendanceSheet.length + ' satıcı var. Filtreye göre ' + rows.length + ' satır gösteriliyor. Liste kendi alanında kayar; sayfa gereksiz uzamaz.';
      if (!rows.length) {
        body.innerHTML = '<tr><td colspan="5"><div class="empty-state">Bu filtreye uygun yoklama satırı bulunmuyor.</div></td></tr>';
        renderStats();
        return;
      }
      var html = '';
      for (var i = 0; i < rows.length; i++) {
        var item = rows[i];
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
      renderVendorTable();
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
          '<td><span class="doc-chip">' + escapeHtml(item.status || '-') + '</span></td>' +
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
  