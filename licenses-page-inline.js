var licenses = [];
    var businesses = [];
    var businessMap = {};
    var queryParams = new URLSearchParams(window.location.search);
    var ADDRESS_CATALOG = {
      "Alaattin": { aliases: ["Alaaddin"], streets: { "6. Sokak": [] } },
      "Atilla": { aliases: [], streets: {} },
      "Barbaros": { aliases: ["Barboros"], streets: { "2029 Sokak": [], "2139 Sokak": [], "2154 Sokak": [], "2240 Sokak": [], "İncirhan Caddesi": [] } },
      "Cami": { aliases: ["Camii"], streets: { "319 Sokak": [], "327 Sokak": [], "338 Sokak": [], "Kabak Caddesi": [], "Ramazan Selen Bulvarı": ["90"] } },
      "Çamlıca": { aliases: [], streets: { "1727 Sokak": [], "1728 Sokak": [], "1730 Sokak": [], "Gazi Caddesi": [], "Kazım Karabekir Caddesi": [] } },
      "Çavuşlar": { aliases: [], streets: { "2727 Sokak": [], "3014 Sokak": [], "3015 Sokak": [], "3016 Sokak": [], "3035 Sokak": [], "3049 Sokak": [], "Gündoğdu Caddesi": [], "Tepecik Caddesi": [] } },
      "Çukur": { aliases: [], streets: { "Kabak Caddesi": [] } },
      "Fatih": { aliases: [], streets: { "1526 Sokak": [], "1529 Sokak": [], "1641 Sokak": ["13"], "1664 Sokak": [], "1731 Sokak": [], "9 Eylül Caddesi": [], "Cemal Aktaş Caddesi": [], "Fatih Caddesi": [], "Gazi Caddesi": [] } },
      "Karayvatlar": { aliases: [], streets: { "932 Sokak": [], "947 Sokak": [], "Cumhuriyet Caddesi": [], "Gazi Caddesi": ["24"], "Sümer Ezgü Caddesi": [] } },
      "Konak": { aliases: [], streets: { "Genç Osman Caddesi": [], "Hökez Caddesi": [], "2712 Sokak": [], "2716 Sokak": [] } },
      "Mehmet Akif": { aliases: [], streets: { "2406 Sokak": [], "2447 Sokak": [], "2522 Sokak": [] } },
      "Mimar Sinan": { aliases: [], streets: { "1586 Sokak": [], "1834 Sokak": [], "1835 Sokak": [], "1839 Sokak": [], "1842 Sokak": [], "1856 Sokak": [], "1861 Sokak": [] } },
      "Oğuzhan": { aliases: [], streets: { "Atatürk Caddesi": ["1"] } },
      "Onaç": { aliases: [], streets: { "2308 Sokak": [], "2364 Sokak": [], "Kemal Kaplan Sokağı": [] } },
      "Pazar": { aliases: [], streets: { "Barutlu Caddesi": [], "İnönü Caddesi": [] } },
      "Sanayi": { aliases: [], streets: { "2461 Sokak": [], "2462 Sokak": [], "2467 Sokak": [], "2477 Sokak": ["9"], "2484 Sokak": ["4"], "2775 Sokak": [], "2888 Sokak": [], "2889 Sokak": [], "2902 Sokak": [], "2904 Sokak": [], "2905 Sokak": [], "2907 Sokak": [], "2910 Sokak": [], "2928 Sokak": [], "Gündoğdu Caddesi": [] } },
      "Yeni": { aliases: [], streets: { "1257 Sokak": [], "1641 Sokak": [], "Gazi Caddesi": [], "Milli Egemenlik Caddesi": [], "Süleyman Demirel Bulvarı": [], "Yahya Kemal Caddesi": [] } },
      "Yetmiş Evler": { aliases: ["70 Evler", "Yetmis Evler"], streets: {} },
      "Yörükler": { aliases: [], streets: { "3002 Sokak": [], "3003 Sokak": [], "Tepecik Caddesi": [] } },
      "Yunus Emre": { aliases: [], streets: { "808 Sokak": [], "817 Sokak": [], "828 Sokak": [], "830 Sokak": [], "836 Sokak": [], "855 Sokak": [], "909 Sokak": [], "Sultan Hamit Caddesi": [], "Yıldırım Caddesi": [] } }
    };
    var ADDRESS_NEIGHBORHOOD_ORDER = ["Alaattin", "Atilla", "Barbaros", "Cami", "Çamlıca", "Çavuşlar", "Çukur", "Fatih", "Karayvatlar", "Konak", "Mehmet Akif", "Mimar Sinan", "Oğuzhan", "Onaç", "Pazar", "Sanayi", "Yeni", "Yetmiş Evler", "Yörükler", "Yunus Emre"];

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

    function uniqueSorted(values) {
      var map = {};
      var list = [];
      for (var i = 0; i < values.length; i++) {
        var value = String(values[i] == null ? '' : values[i]).trim();
        if (!value) continue;
        var key = normalizeTurkishKey(value);
        if (!key || map[key]) continue;
        map[key] = true;
        list.push(value);
      }
      return list.sort(function(a, b) {
        return a.localeCompare(b, 'tr-TR', { sensitivity: 'base', numeric: true });
      });
    }

    function getCanonicalNeighborhoodName(value) {
      var raw = String(value || '').trim();
      if (!raw) return '';
      var normalized = normalizeTurkishKey(raw);
      for (var i = 0; i < ADDRESS_NEIGHBORHOOD_ORDER.length; i++) {
        var officialName = ADDRESS_NEIGHBORHOOD_ORDER[i];
        var entry = ADDRESS_CATALOG[officialName] || {};
        var aliases = [officialName].concat(entry.aliases || []);
        for (var j = 0; j < aliases.length; j++) {
          if (normalizeTurkishKey(aliases[j]) === normalized) return officialName;
        }
      }
      return raw;
    }

    function setSelectOptions(selectId, placeholder, values, selectedValue) {
      var select = document.getElementById(selectId);
      if (!select) return;
      var html = '<option value="">' + escapeHtml(placeholder) + '</option>';
      for (var i = 0; i < values.length; i++) {
        html += '<option value="' + escapeHtml(values[i]) + '">' + escapeHtml(values[i]) + '</option>';
      }
      select.innerHTML = html;
      select.value = selectedValue || '';
      if (selectedValue && select.value !== selectedValue) {
        html += '<option value="' + escapeHtml(selectedValue) + '">' + escapeHtml(selectedValue) + '</option>';
        select.innerHTML = html;
        select.value = selectedValue;
      }
    }

    function collectLicenseNeighborhoods() {
      var values = ADDRESS_NEIGHBORHOOD_ORDER.slice();
      for (var i = 0; i < businesses.length; i++) values.push(getCanonicalNeighborhoodName(businesses[i].neighborhood || ''));
      for (var j = 0; j < licenses.length; j++) values.push(getCanonicalNeighborhoodName(licenses[j].neighborhood || ''));
      return uniqueSorted(values);
    }

    function initLicenseAddressSelectors() {
      setSelectOptions('neighborhood', 'Mahalle seçiniz', collectLicenseNeighborhoods(), '');
    }

    function setLicenseAddressSelection(neighborhood, street, doorNo) {
      var canonical = getCanonicalNeighborhoodName(neighborhood || '');
      setSelectOptions('neighborhood', 'Mahalle seçiniz', collectLicenseNeighborhoods(), canonical || neighborhood || '');
      document.getElementById('street').value = street || '';
      document.getElementById('doorNo').value = doorNo || '';
    }


    function escapeHtml(value) {
      return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function setTodayText() {
      document.getElementById('todayText').textContent = new Intl.DateTimeFormat('tr-TR', {
        day: '2-digit', month: '2-digit', year: 'numeric', weekday: 'long'
      }).format(new Date());
    }

    function showToast(message) {
      var toast = document.getElementById('toast');
      toast.textContent = message;
      toast.classList.add('show');
      clearTimeout(showToast._timer);
      showToast._timer = setTimeout(function() { toast.classList.remove('show'); }, 2600);
    }

    function setMessage(text, type) {
      var el = document.getElementById('formMessage');
      if (!text) {
        el.textContent = '';
        el.className = 'message';
        return;
      }
      el.textContent = text;
      el.className = 'message show ' + (type || 'error');
    }

    function recordBadge(status) {
      if (status === 'Aktif') return '<span class="badge active">Aktif</span>';
      if (status === 'Pasif') return '<span class="badge passive">Pasif</span>';
      if (status === 'İptal') return '<span class="badge cancelled">İptal</span>';
      return '<span class="badge gray">' + escapeHtml(status || '-') + '</span>';
    }

    function processBadge(status) {
      if (status === 'Ruhsat Verildi') return '<span class="badge active">Ruhsat Verildi</span>';
      if (status === 'Reddedildi') return '<span class="badge cancelled">Reddedildi</span>';
      if (status) return '<span class="badge application">' + escapeHtml(status) + '</span>';
      return '<span class="badge gray">Belirtilmedi</span>';
    }

    function fillBusinessOptions() {
      var filter = document.getElementById('filterBusiness');
      var filterHtml = '<option value="all">Tüm Firmalar</option>';
      filterHtml += '<option value="unlinked">Bağlı Firması Olmayanlar</option>';
      for (var i = 0; i < businesses.length; i++) {
        var item = businesses[i];
        filterHtml += '<option value="' + item.id + '">' + escapeHtml(item.tradeName || ('Firma #' + item.id)) + '</option>';
      }
      filter.innerHTML = filterHtml;

      var preselectedBusinessId = queryParams.get('businessId');
      if (preselectedBusinessId) {
        filter.value = preselectedBusinessId;
      }
      initLicenseAddressSelectors();
    }

    function setLinkedBusinessInfo(item) {
      var box = document.getElementById('linkedBusinessInfo');
      if (!item || !item.businessId) {
        box.textContent = 'Bu ruhsat kaydı firmadan bağımsız tutulur. Uygun firma daha sonra otomatik eşleşir.';
        return;
      }
      box.innerHTML = 'Bağlı firma: <strong>' + escapeHtml(item.businessName || ('Firma #' + item.businessId)) + '</strong>';
    }

    function detailValue(value, emptyText) {
      var normalized = value === undefined || value === null ? '' : String(value).trim();
      return normalized ? escapeHtml(normalized) : '<span class="muted">' + escapeHtml(emptyText || 'Belirtilmedi') + '</span>' ;
    }

    function renderLicenseDetail(item) {
      var businessHtml = item.businessId
        ? '<a class="mini-btn" style="width:auto; display:inline-flex;" href="/businesses/' + item.businessId + '">Firma Detayına Git</a>'
        : '<span class="muted">Bağlı firma kaydı yok</span>' ;

      var html = '' +
        '<div class="detail-card">' +
          '<div class="detail-title">Durum ve bağlantı</div>' +
          '<div class="detail-list">' +
            '<div class="detail-item"><div class="detail-label">Kayıt Durumu</div><div class="detail-value">' + recordBadge(item.recordStatus) + '</div></div>' +
            '<div class="detail-item"><div class="detail-label">Süreç Durumu</div><div class="detail-value">' + processBadge(item.processStatus) + '</div></div>' +
            '<div class="detail-item"><div class="detail-label">Bağlı Firma</div><div class="detail-value">' + (item.businessName ? escapeHtml(item.businessName) : '<span class="muted">Bağlı firma yok</span>') + '</div></div>' +
            '<div class="detail-item"><div class="detail-label">Firma Ekranı</div><div class="detail-value">' + businessHtml + '</div></div>' +
          '</div>' +
        '</div>' +
        '<div class="detail-card">' +
          '<div class="detail-title">Ruhsat ana bilgileri</div>' +
          '<div class="detail-list">' +
            '<div class="detail-item"><div class="detail-label">Ruhsat Sıra No</div><div class="detail-value">' + detailValue(item.licenseSerialNo, 'Ruhsat numarası girilmedi') + '</div></div>' +
            '<div class="detail-item"><div class="detail-label">Veriliş Tarihi</div><div class="detail-value">' + detailValue(item.issueDateText, 'Veriliş tarihi girilmedi') + '</div></div>' +
            '<div class="detail-item"><div class="detail-label">İşyeri Ünvanı</div><div class="detail-value">' + detailValue(item.tradeName, 'İşyeri ünvanı girilmedi') + '</div></div>' +
            '<div class="detail-item"><div class="detail-label">İşyeri Sahibi</div><div class="detail-value">' + detailValue(item.ownerName, 'Sahip bilgisi girilmedi') + '</div></div>' +
            '<div class="detail-item"><div class="detail-label">Faaliyet Konusu</div><div class="detail-value">' + detailValue(item.activitySubject, 'Faaliyet konusu girilmedi') + '</div></div>' +
            '<div class="detail-item"><div class="detail-label">İşyeri Sınıfı</div><div class="detail-value">' + detailValue(item.workplaceClass, 'Sınıf girilmedi') + '</div></div>' +
          '</div>' +
        '</div>' +
        '<div class="detail-card">' +
          '<div class="detail-title">Adres ve fiziksel bilgiler</div>' +
          '<div class="detail-list">' +
            '<div class="detail-item"><div class="detail-label">Mahalle</div><div class="detail-value">' + detailValue(item.neighborhood, 'Mahalle girilmedi') + '</div></div>' +
            '<div class="detail-item"><div class="detail-label">Cadde / Sokak</div><div class="detail-value">' + detailValue(item.street, 'Cadde / sokak girilmedi') + '</div></div>' +
            '<div class="detail-item"><div class="detail-label">Kapı No</div><div class="detail-value">' + detailValue(item.doorNo, 'Kapı no girilmedi') + '</div></div>' +
            '<div class="detail-item"><div class="detail-label">Ada / Parsel</div><div class="detail-value">' + detailValue(((item.ada || '-') + ' / ' + (item.parcel || '-')).replace('- / -', ''), 'Ada / parsel girilmedi') + '</div></div>' +
            '<div class="detail-item"><div class="detail-label">Kullanım Alanı</div><div class="detail-value">' + detailValue(item.usageArea, 'Kullanım alanı girilmedi') + '</div></div>' +
            '<div class="detail-item"><div class="detail-label">Toplam Motor Gücü</div><div class="detail-value">' + detailValue(item.totalMotorPower, 'Motor gücü girilmedi') + '</div></div>' +
          '</div>' +
        '</div>' +
        '<div class="detail-card">' +
          '<div class="detail-title">Başvuru ve iptal bilgileri</div>' +
          '<div class="detail-list">' +
            '<div class="detail-item"><div class="detail-label">Başvuru Tarihi</div><div class="detail-value">' + detailValue(item.applicationDateText, 'Başvuru tarihi yok') + '</div></div>' +
            '<div class="detail-item"><div class="detail-label">Başvuru No</div><div class="detail-value">' + detailValue(item.applicationNo, 'Başvuru numarası yok') + '</div></div>' +
            '<div class="detail-item"><div class="detail-label">Başvuru Aşaması</div><div class="detail-value">' + detailValue(item.applicationStage, 'Başvuru aşaması yok') + '</div></div>' +
            '<div class="detail-item"><div class="detail-label">Takip Tarihi</div><div class="detail-value">' + detailValue(item.followupDateText, 'Takip tarihi yok') + '</div></div>' +
            '<div class="detail-item"><div class="detail-label">İptal Tarihi</div><div class="detail-value">' + detailValue(item.cancelDateText, 'İptal tarihi yok') + '</div></div>' +
            '<div class="detail-item"><div class="detail-label">İptal Nedeni</div><div class="detail-value">' + detailValue(item.cancelReason, 'İptal nedeni yok') + '</div></div>' +
          '</div>' +
        '</div>' +
        '<div class="detail-card full">' +
          '<div class="detail-title">Saat, kimlik ve notlar</div>' +
          '<div class="detail-grid">' +
            '<div class="detail-list">' +
              '<div class="detail-item"><div class="detail-label">Kış Saatleri</div><div class="detail-value">' + detailValue((item.winterOpeningTime || item.winterClosingTime) ? ((item.winterOpeningTime || '-') + ' / ' + (item.winterClosingTime || '-')) : '', 'Kış saatleri girilmedi') + '</div></div>' +
              '<div class="detail-item"><div class="detail-label">Yaz Saatleri</div><div class="detail-value">' + detailValue((item.summerOpeningTime || item.summerClosingTime) ? ((item.summerOpeningTime || '-') + ' / ' + (item.summerClosingTime || '-')) : '', 'Yaz saatleri girilmedi') + '</div></div>' +
              '<div class="detail-item"><div class="detail-label">T.C. / Vergi No</div><div class="detail-value">' + detailValue((item.identityNumber || item.taxNumber) ? ((item.identityNumber || '-') + ' / ' + (item.taxNumber || '-')) : '', 'Kimlik / vergi bilgisi girilmedi') + '</div></div>' +
            '</div>' +
            '<div class="detail-list">' +
              '<div class="detail-item"><div class="detail-label">Zabıta Müdürü</div><div class="detail-value">' + detailValue(item.policeChiefName, 'Zabıta müdürü girilmedi') + '</div></div>' +
              '<div class="detail-item"><div class="detail-label">Belediye Başkanı</div><div class="detail-value">' + detailValue(item.mayorName, 'Belediye başkanı girilmedi') + '</div></div>' +
              '<div class="detail-item"><div class="detail-label">Diğer Faaliyet / Not</div><div class="detail-value">' + detailValue(item.otherActivityAreas || item.notes, 'Ek not girilmedi') + '</div></div>' +
            '</div>' +
          '</div>' +
        '</div>';

      document.getElementById('licenseDetailContent').innerHTML = html;
      document.getElementById('licenseDetailModal').classList.add('show');
    }

    function openLicenseDetail(id) {
      var item = null;
      for (var i = 0; i < licenses.length; i++) {
        if (String(licenses[i].id) === String(id)) { item = licenses[i]; break; }
      }
      if (!item) return;
      renderLicenseDetail(item);
    }

    function closeDetailModal() {
      document.getElementById('licenseDetailModal').classList.remove('show');
    }

    function resetForm() {
      document.getElementById('editingLicenseId').value = '';
      document.getElementById('licenseModalTitle').textContent = 'Yeni Ruhsat Kaydı';
      document.getElementById('licenseForm').reset();
      document.getElementById('recordStatus').value = 'Aktif';
      document.getElementById('processStatus').value = 'Ruhsat Verildi';
      setMessage('', '');
      initLicenseAddressSelectors();
      setLinkedBusinessInfo(null);
      toggleConditionalFields();
    }

    function openLicenseModal(id) {
      resetForm();
      if (id) {
        var item = null;
        for (var i = 0; i < licenses.length; i++) {
          if (String(licenses[i].id) === String(id)) { item = licenses[i]; break; }
        }
        if (!item) return;
        document.getElementById('editingLicenseId').value = item.id;
        document.getElementById('licenseModalTitle').textContent = 'Ruhsat Kaydını Düzenle';
        setLinkedBusinessInfo(item);
        document.getElementById('recordStatus').value = item.recordStatus || 'Aktif';
        document.getElementById('processStatus').value = item.processStatus || 'Ruhsat Verildi';
        document.getElementById('applicationDate').value = item.applicationDate || '';
        document.getElementById('applicationNo').value = item.applicationNo || '';
        document.getElementById('applicationStage').value = item.applicationStage || '';
        document.getElementById('followupDate').value = item.followupDate || '';
        document.getElementById('issueDate').value = item.issueDate || '';
        document.getElementById('licenseSerialNo').value = item.licenseSerialNo || '';
        document.getElementById('ownerName').value = item.ownerName || '';
        document.getElementById('tradeName').value = item.tradeName || '';
        document.getElementById('activitySubject').value = item.activitySubject || '';
        document.getElementById('workplaceClass').value = item.workplaceClass || '';
        setLicenseAddressSelection(item.neighborhood || '', item.street || '', item.doorNo || '');
        document.getElementById('ada').value = item.ada || '';
        document.getElementById('parcel').value = item.parcel || '';
        document.getElementById('usageArea').value = item.usageArea || '';
        document.getElementById('otherUsageArea').value = item.otherUsageArea || '';
        document.getElementById('totalMotorPower').value = item.totalMotorPower || '';
        document.getElementById('winterOpeningTime').value = item.winterOpeningTime || '';
        document.getElementById('winterClosingTime').value = item.winterClosingTime || '';
        document.getElementById('summerOpeningTime').value = item.summerOpeningTime || '';
        document.getElementById('summerClosingTime').value = item.summerClosingTime || '';
        document.getElementById('otherActivityAreas').value = item.otherActivityAreas || '';
        document.getElementById('identityNumber').value = item.identityNumber || '';
        document.getElementById('taxNumber').value = item.taxNumber || '';
        document.getElementById('policeChiefName').value = item.policeChiefName || '';
        document.getElementById('mayorName').value = item.mayorName || '';
        document.getElementById('cancelDate').value = item.cancelDate || '';
        document.getElementById('cancelReason').value = item.cancelReason || '';
        document.getElementById('notes').value = item.notes || '';
      }
      toggleConditionalFields();
      document.getElementById('licenseModal').classList.add('show');
    }

    function closeModal() {
      document.getElementById('licenseModal').classList.remove('show');
      setMessage('', '');
    }

    function toggleConditionalFields() {
      var recordStatus = document.getElementById('recordStatus').value;
      var processStatus = document.getElementById('processStatus').value;
      var isApplication = processStatus !== 'Ruhsat Verildi';
      document.getElementById('applicationSection').classList.toggle('hidden', !isApplication);
      document.getElementById('cancelSection').classList.toggle('hidden', recordStatus !== 'İptal');
      if (recordStatus !== 'İptal') {
        document.getElementById('cancelDate').value = '';
        document.getElementById('cancelReason').value = '';
      }
      if (!isApplication) {
        document.getElementById('applicationDate').value = '';
        document.getElementById('applicationNo').value = '';
        document.getElementById('applicationStage').value = '';
        document.getElementById('followupDate').value = '';
      }
    }

    function currentFilters() {
      return {
        businessId: document.getElementById('filterBusiness').value,
        recordStatus: document.getElementById('filterRecordStatus').value,
        processStatus: document.getElementById('filterProcessStatus').value,
        search: document.getElementById('searchInput').value.trim().toLocaleLowerCase('tr-TR')
      };
    }

    function filteredLicenses() {
      var filters = currentFilters();
      return licenses.filter(function(item) {
        var matchesBusiness = filters.businessId === 'all' || (filters.businessId === 'unlinked' ? !item.businessId : String(item.businessId) === String(filters.businessId));
        var matchesRecord = filters.recordStatus === 'all' || item.recordStatus === filters.recordStatus;
        var matchesProcess = filters.processStatus === 'all' || item.processStatus === filters.processStatus;
        var haystack = [
          item.tradeName,
          item.ownerName,
          item.licenseSerialNo,
          item.applicationNo,
          item.applicationStage,
          item.activitySubject,
          item.neighborhood,
          item.street,
          item.doorNo,
          item.notes
        ].join(' ').toLocaleLowerCase('tr-TR');
        var matchesSearch = !filters.search || haystack.indexOf(filters.search) !== -1;
        return matchesBusiness && matchesRecord && matchesProcess && matchesSearch;
      });
    }

    function renderStats() {
      var rows = filteredLicenses();
      var active = 0, application = 0, passive = 0, cancelled = 0;
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].recordStatus === 'Aktif' && rows[i].processStatus === 'Ruhsat Verildi') active += 1;
        else if (rows[i].recordStatus === 'İptal') cancelled += 1;
        else if (rows[i].processStatus !== 'Ruhsat Verildi') application += 1;
        else passive += 1;
      }
      document.getElementById('statTotal').textContent = rows.length;
      document.getElementById('statActive').textContent = active;
      document.getElementById('statApplication').textContent = application;
      document.getElementById('statPassive').textContent = passive;
      document.getElementById('statCancelled').textContent = cancelled;
    }

    function renderLicenseTable() {
      var rows = filteredLicenses();
      renderStats();
      updatePrintMeta(rows);
      var body = document.getElementById('licenseTableBody');
      if (!rows.length) {
        body.innerHTML = '<tr><td colspan="6"><div class="empty-state">Bu filtreye uygun ruhsat kaydı bulunmuyor.</div></td></tr>';
        return;
      }

      var html = '';
      for (var i = 0; i < rows.length; i++) {
        var item = rows[i];
        var addressParts = [];
        if (item.neighborhood) addressParts.push(escapeHtml(item.neighborhood + ' Mah.'));
        if (item.street) addressParts.push(escapeHtml(item.street));
        if (item.doorNo) addressParts.push('No: ' + escapeHtml(item.doorNo));

        var businessLink = item.businessId
          ? ''
          : '<div class="cell-sub">Firma bağlantısı yok</div>';

        var applicationBits = [];
        applicationBits.push('<div class="cell-sub">Veriliş: ' + escapeHtml(item.issueDateText || '-') + '</div>');
        if (item.applicationNo) applicationBits.push('<div class="cell-sub">Başvuru No: ' + escapeHtml(item.applicationNo) + '</div>');
        if (item.applicationStage) applicationBits.push('<div class="cell-sub">Aşama: ' + escapeHtml(item.applicationStage) + '</div>');
        if (item.recordStatus === 'İptal' && item.cancelDateText) applicationBits.push('<div class="cell-sub">İptal Tarihi: ' + escapeHtml(item.cancelDateText) + '</div>');

        var actionButtons = '<button class="mini-btn" type="button" onclick="openLicenseDetail(' + item.id + ')">Ruhsat Detay</button>';
        actionButtons += '<button class="mini-btn primary" type="button" onclick="openLicenseModal(' + item.id + ')">Düzenle</button>';
        if (item.businessId) {
          actionButtons += '<a class="mini-btn" href="/businesses/' + item.businessId + '">Firma Detayı</a>';
        }
        actionButtons += '<button class="mini-btn danger" type="button" onclick="deleteLicense(' + item.id + ')">Sil</button>';

        html += '<tr>' +
          '<td><div class="stack"><div class="cell-title">' + escapeHtml(item.tradeName || '-') + '</div><div class="cell-sub">' + escapeHtml(item.ownerName || 'Sahip bilgisi yok') + '</div>' + businessLink + '</div></td>' +
          '<td><div class="stack"><div class="cell-title">Ruhsat No: ' + escapeHtml(item.licenseSerialNo || '-') + '</div>' + applicationBits.join('') + '</div></td>' +
          '<td><div class="stack">' + recordBadge(item.recordStatus) + processBadge(item.processStatus) + '</div></td>' +
          '<td><div class="stack"><div class="cell-title">' + escapeHtml(item.activitySubject || 'Faaliyet konusu girilmedi') + '</div><div class="cell-sub">' + escapeHtml(item.workplaceClass || 'Sınıf girilmedi') + '</div></div></td>' +
          '<td><div class="stack"><div class="cell-title">' + (addressParts.join(', ') || '<span class="muted">Adres yok</span>') + '</div><div class="cell-sub">Ada: ' + escapeHtml(item.ada || '-') + ' · Parsel: ' + escapeHtml(item.parcel || '-') + '</div></div></td>' +
          '<td><div class="action-row">' + actionButtons + '</div></td>' +
        '</tr>';
      }

      body.innerHTML = html;
    }

    function buildFilterQueryString() {
      var params = new URLSearchParams();
      var filters = currentFilters();
      var businessSelect = document.getElementById('filterBusiness');
      var businessText = businessSelect && businessSelect.selectedOptions[0] ? businessSelect.selectedOptions[0].textContent : 'Tüm Firmalar';
      if (filters.businessId && filters.businessId !== 'all') {
        params.set('businessId', filters.businessId);
        params.set('businessName', businessText);
      }
      if (filters.recordStatus && filters.recordStatus !== 'all') params.set('recordStatus', filters.recordStatus);
      if (filters.processStatus && filters.processStatus !== 'all') params.set('processStatus', filters.processStatus);
      if (filters.search) params.set('search', document.getElementById('searchInput').value.trim());
      return params.toString();
    }

    function updatePrintMeta(rows) {
      var businessText = document.getElementById('filterBusiness').selectedOptions[0] ? document.getElementById('filterBusiness').selectedOptions[0].textContent : 'Tüm Firmalar';
      var recordText = document.getElementById('filterRecordStatus').selectedOptions[0].textContent;
      var processText = document.getElementById('filterProcessStatus').selectedOptions[0].textContent;
      var search = document.getElementById('searchInput').value.trim();
      var parts = [];
      parts.push('Firma: ' + businessText);
      parts.push('Kayıt Durumu: ' + recordText);
      parts.push('Süreç Durumu: ' + processText);
      if (search) parts.push('Arama: ' + search);
      parts.push('Toplam kayıt: ' + rows.length);
      document.getElementById('printMeta').innerHTML = '<strong>Ruhsat Listesi Çıktısı</strong><br>' + escapeHtml(parts.join(' • '));
    }

    function exportExcel() {
      var rows = filteredLicenses();
      if (!rows.length) {
        alert('Bu filtreye uygun Excel çıktısı oluşturulacak ruhsat kaydı bulunmuyor.');
        return;
      }
      var query = buildFilterQueryString();
      window.location.href = '/api/licenses/export.xlsx' + (query ? ('?' + query) : '');
    }

    function printFilteredView() {
      var rows = filteredLicenses();
      if (!rows.length) {
        alert('Bu filtreye uygun yazdırılacak ruhsat kaydı bulunmuyor.');
        return;
      }
      updatePrintMeta(rows);
      window.print();
    }

    function clearFilters() {
      document.getElementById('filterBusiness').value = queryParams.get('businessId') || 'all';
      document.getElementById('filterRecordStatus').value = 'all';
      document.getElementById('filterProcessStatus').value = 'all';
      document.getElementById('searchInput').value = '';
      renderLicenseTable();
    }

    async function loadBusinesses() {
      var response = await fetch('/api/businesses');
      var data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Firmalar alınamadı.');
      businesses = data;
      businessMap = {};
      for (var i = 0; i < businesses.length; i++) businessMap[String(businesses[i].id)] = businesses[i];
      fillBusinessOptions();
    }

    async function loadLicenses() {
      var response = await fetch('/api/licenses');
      var data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Ruhsat kayıtları alınamadı.');
      licenses = data;
      renderLicenseTable();
    }

    async function saveLicense(event) {
      event.preventDefault();
      setMessage('', '');
      var saveButton = document.getElementById('saveButton');
      saveButton.disabled = true;
      saveButton.textContent = 'Kaydediliyor...';
      try {
        var payload = {
          recordStatus: document.getElementById('recordStatus').value,
          processStatus: document.getElementById('processStatus').value,
          applicationDate: document.getElementById('applicationDate').value,
          applicationNo: document.getElementById('applicationNo').value.trim(),
          applicationStage: document.getElementById('applicationStage').value.trim(),
          followupDate: document.getElementById('followupDate').value,
          issueDate: document.getElementById('issueDate').value,
          licenseSerialNo: document.getElementById('licenseSerialNo').value.trim(),
          ownerName: document.getElementById('ownerName').value.trim(),
          tradeName: document.getElementById('tradeName').value.trim(),
          activitySubject: document.getElementById('activitySubject').value.trim(),
          workplaceClass: document.getElementById('workplaceClass').value,
          neighborhood: document.getElementById('neighborhood').value.trim(),
          street: document.getElementById('street').value.trim(),
          doorNo: document.getElementById('doorNo').value.trim(),
          ada: document.getElementById('ada').value.trim(),
          parcel: document.getElementById('parcel').value.trim(),
          usageArea: document.getElementById('usageArea').value.trim(),
          otherUsageArea: document.getElementById('otherUsageArea').value.trim(),
          totalMotorPower: document.getElementById('totalMotorPower').value.trim(),
          winterOpeningTime: document.getElementById('winterOpeningTime').value,
          winterClosingTime: document.getElementById('winterClosingTime').value,
          summerOpeningTime: document.getElementById('summerOpeningTime').value,
          summerClosingTime: document.getElementById('summerClosingTime').value,
          otherActivityAreas: document.getElementById('otherActivityAreas').value.trim(),
          identityNumber: document.getElementById('identityNumber').value.trim(),
          taxNumber: document.getElementById('taxNumber').value.trim(),
          policeChiefName: document.getElementById('policeChiefName').value.trim(),
          mayorName: document.getElementById('mayorName').value.trim(),
          cancelDate: document.getElementById('cancelDate').value,
          cancelReason: document.getElementById('cancelReason').value.trim(),
          notes: document.getElementById('notes').value.trim()
        };
        var editingId = document.getElementById('editingLicenseId').value;
        var response = await fetch(editingId ? ('/api/licenses/' + editingId) : '/api/licenses', {
          method: editingId ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        var data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Kayıt kaydedilemedi.');
        await loadBusinesses();
        await loadLicenses();
        closeModal();
        showToast(editingId ? 'Ruhsat kaydı güncellendi.' : 'Yeni ruhsat kaydı eklendi.');
      } catch (error) {
        setMessage(error.message || 'Kayıt kaydedilemedi.', 'error');
      } finally {
        saveButton.disabled = false;
        saveButton.textContent = 'Kaydet';
      }
    }

    async function deleteLicense(id) {
      if (!confirm('Bu ruhsat kaydı silinsin mi?')) return;
      try {
        var response = await fetch('/api/licenses/' + id, { method: 'DELETE' });
        var data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Ruhsat kaydı silinemedi.');
        await loadBusinesses();
        await loadLicenses();
        showToast('Ruhsat kaydı silindi.');
      } catch (error) {
        alert(error.message || 'Ruhsat kaydı silinemedi.');
      }
    }

    function toggleSidebar(forceOpen) {
      var shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : !document.body.classList.contains('sidebar-open');
      document.body.classList.toggle('sidebar-open', shouldOpen);
    }

    document.getElementById('licenseForm').addEventListener('submit', saveLicense);
    document.getElementById('licenseModal').addEventListener('click', function(event) {
      if (event.target === this) closeModal();
    });
    document.getElementById('licenseDetailModal').addEventListener('click', function(event) {
      if (event.target === this) closeDetailModal();
    });
    document.addEventListener('keydown', function(event) {
      if (event.key !== 'Escape') return;
      var detailModal = document.getElementById('licenseDetailModal');
      if (detailModal && detailModal.classList.contains('show')) { closeDetailModal(); return; }
      var modal = document.getElementById('licenseModal');
      if (modal && modal.classList.contains('show')) { closeModal(); return; }
      if (document.body.classList.contains('sidebar-open')) toggleSidebar(false);
    });

    async function init() {
      setTodayText();
      try {
        await loadBusinesses();
        await loadLicenses();
      } catch (error) {
        document.getElementById('licenseTableBody').innerHTML = '<tr><td colspan="6"><div class="empty-state">' + escapeHtml(error.message || 'Veriler yüklenemedi.') + '</div></td></tr>';
      }
    }

    init();
