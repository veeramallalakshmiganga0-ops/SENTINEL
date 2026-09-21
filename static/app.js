/**
 * SENTINEL - Cybercrime Cash-Withdrawal Hotspot Prediction Engine
 * Interactive Frontend Controller (Leaflet GIS + Multi-Provider Map API Support + LEA Action Center)
 */

let map = null;
let currentTileLayer = null;
let atmsLayerGroup = null;
let complaintsLayerGroup = null;
let heatmapLayer = null;
let radiusCircleLayer = null;

let currentMapProvider = "carto_dark";
let mapApiKeys = {
  mapbox_access_token: "",
  maptiler_api_key: "",
  google_maps_api_key: ""
};

let currentCity = "";
let currentRadius = 3.0;
let currentTimeWindow = "all";
let currentRiskLevel = "";
let currentBank = "";

let cachedAtms = [];
let cachedRiskScores = [];
let cachedComplaints = [];
let cachedTransactions = [];
let cachedAlerts = [];
let cachedCities = [];
let cachedStats = {};
let selectedAtmForAction = null;

// INIT ON DOM READY
document.addEventListener("DOMContentLoaded", async () => {
  await loadMapConfig();
  initMap();
  bindEvents();
  await loadInitialData();
});

/* =========================================================================
   1. MAP INITIALIZATION & TILE PROVIDERS
   ========================================================================= */
async function loadMapConfig() {
  try {
    const res = await fetch("/api/config");
    if (res.ok) {
      const cfg = await res.json();
      mapApiKeys.mapbox_access_token = cfg.mapbox_access_token || localStorage.getItem("mapbox_access_token") || "";
      mapApiKeys.maptiler_api_key = cfg.maptiler_api_key || localStorage.getItem("maptiler_api_key") || "";
      mapApiKeys.google_maps_api_key = cfg.google_maps_api_key || localStorage.getItem("google_maps_api_key") || "";
      currentMapProvider = cfg.default_map_provider || localStorage.getItem("default_map_provider") || "carto_dark";
    }
  } catch (err) {
    // Fallback to localStorage
    mapApiKeys.mapbox_access_token = localStorage.getItem("mapbox_access_token") || "";
    mapApiKeys.maptiler_api_key = localStorage.getItem("maptiler_api_key") || "";
    mapApiKeys.google_maps_api_key = localStorage.getItem("google_maps_api_key") || "";
    currentMapProvider = localStorage.getItem("default_map_provider") || "carto_dark";
  }

  // Populate inputs if modal is present
  const mbInput = document.getElementById("inputMapboxToken");
  const mtInput = document.getElementById("inputMapTilerKey");
  const gmInput = document.getElementById("inputGoogleMapsKey");
  const provSelect = document.getElementById("mapProviderSelect");

  if (mbInput) mbInput.value = mapApiKeys.mapbox_access_token;
  if (mtInput) mtInput.value = mapApiKeys.maptiler_api_key;
  if (gmInput) gmInput.value = mapApiKeys.google_maps_api_key;
  if (provSelect) provSelect.value = currentMapProvider;
}

function initMap() {
  map = L.map("gisMap", {
    center: [20.5937, 78.9629],
    zoom: 5,
    minZoom: 4,
    maxZoom: 18
  });

  applyBaseMapTileLayer(currentMapProvider);

  atmsLayerGroup = L.layerGroup().addTo(map);
  complaintsLayerGroup = L.layerGroup().addTo(map);
}

function applyBaseMapTileLayer(provider) {
  if (currentTileLayer) {
    map.removeLayer(currentTileLayer);
    currentTileLayer = null;
  }

  let tileUrl = "";
  let options = { maxZoom: 19, attribution: "" };

  const mbToken = mapApiKeys.mapbox_access_token || localStorage.getItem("mapbox_access_token");
  const mtKey = mapApiKeys.maptiler_api_key || localStorage.getItem("maptiler_api_key");

  if (provider === "mapbox_dark") {
    if (!mbToken) {
      showToast("Mapbox Access Token required. Enter token in Map API Keys modal.", "danger");
      openModal("mapApiModal");
      tileUrl = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
      options.attribution = '&copy; <a href="https://carto.com/">CartoDB</a> (Fallback)';
      options.subdomains = "abcd";
    } else {
      tileUrl = `https://api.mapbox.com/styles/v1/mapbox/dark-v11/tiles/{z}/{x}/{y}?access_token=${mbToken}`;
      options.attribution = '&copy; <a href="https://www.mapbox.com/">Mapbox</a>';
      options.tileSize = 512;
      options.zoomOffset = -1;
    }
  } else if (provider === "mapbox_satellite") {
    if (!mbToken) {
      showToast("Mapbox Access Token required. Enter token in Map API Keys modal.", "danger");
      openModal("mapApiModal");
      tileUrl = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
      options.attribution = "Tiles &copy; Esri (Free Satellite Fallback)";
    } else {
      tileUrl = `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/tiles/{z}/{x}/{y}?access_token=${mbToken}`;
      options.attribution = '&copy; <a href="https://www.mapbox.com/">Mapbox</a>';
      options.tileSize = 512;
      options.zoomOffset = -1;
    }
  } else if (provider === "maptiler_dark") {
    if (!mtKey) {
      showToast("MapTiler API Key required. Enter key in Map API Keys modal.", "danger");
      openModal("mapApiModal");
      tileUrl = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
      options.attribution = '&copy; <a href="https://carto.com/">CartoDB</a> (Fallback)';
      options.subdomains = "abcd";
    } else {
      tileUrl = `https://api.maptiler.com/maps/basic-v2-dark/{z}/{x}/{y}.png?key=${mtKey}`;
      options.attribution = '&copy; <a href="https://www.maptiler.com/">MapTiler</a>';
    }
  } else if (provider === "esri_satellite") {
    tileUrl = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
    options.attribution = "Tiles &copy; Esri &mdash; World Imagery (Free)";
  } else if (provider === "osm_standard") {
    tileUrl = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
    options.attribution = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
  } else if (provider === "carto_light") {
    tileUrl = "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
    options.attribution = '&copy; <a href="https://carto.com/">CartoDB</a>';
    options.subdomains = "abcd";
  } else {
    // Default Carto Dark Matter
    tileUrl = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
    options.attribution = '&copy; <a href="https://carto.com/">CartoDB</a> | SENTINEL Hotspots';
    options.subdomains = "abcd";
  }

  currentTileLayer = L.tileLayer(tileUrl, options).addTo(map);
  currentMapProvider = provider;
}

function updateMapLayers(riskScores, complaints) {
  atmsLayerGroup.clearLayers();
  complaintsLayerGroup.clearLayers();
  if (heatmapLayer) {
    map.removeLayer(heatmapLayer);
    heatmapLayer = null;
  }
  if (radiusCircleLayer) {
    map.removeLayer(radiusCircleLayer);
    radiusCircleLayer = null;
  }

  // 1. Plot Heatmap Points (Complaints + High Risk Points)
  const heatPoints = [];
  complaints.forEach(c => {
    if (c.lat && c.lon) {
      heatPoints.push([c.lat, c.lon, c.withdrawal_flag ? 1.0 : 0.6]);
    }
  });

  if (heatPoints.length > 0 && typeof L.heatLayer === "function") {
    heatmapLayer = L.heatLayer(heatPoints, {
      radius: 25,
      blur: 18,
      maxZoom: 15,
      gradient: { 0.2: "#3b82f6", 0.5: "#f59e0b", 0.8: "#ef4444", 1.0: "#dc2626" }
    });
    if (document.getElementById("layerToggleHeatmap").checked) {
      heatmapLayer.addTo(map);
    }
  }

  // 2. Plot ATM Risk Markers
  const bounds = [];
  riskScores.forEach(atm => {
    if (!atm.lat || !atm.lon) return;
    bounds.push([atm.lat, atm.lon]);

    let markerColor = "#10b981";
    let iconSymbol = "🏧";
    if (atm.risk_level === "High") {
      markerColor = "#ef4444";
    } else if (atm.risk_level === "Medium") {
      markerColor = "#f59e0b";
    }

    const customIcon = L.divIcon({
      className: "custom-atm-marker",
      html: `
        <div style="background-color: ${markerColor}; width: 26px; height: 26px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-size: 13px; font-weight: bold; border: 2px solid #fff; box-shadow: 0 0 10px ${markerColor}; cursor: pointer;">
          ${iconSymbol}
        </div>
      `,
      iconSize: [26, 26],
      iconAnchor: [13, 13]
    });

    const marker = L.marker([atm.lat, atm.lon], { icon: customIcon });

    const popupContent = `
      <div style="font-family: 'Inter', sans-serif; min-width: 230px; color: #0f172a;">
        <h4 style="margin: 0 0 4px 0; font-size: 14px; font-weight: 700; color: #0f172a;">
          ${atm.bank} ATM (${atm.atm_id})
        </h4>
        <div style="font-size: 12px; color: #475569; margin-bottom: 6px;">
          📍 ${atm.city} | ${atm.lat.toFixed(4)}, ${atm.lon.toFixed(4)}
        </div>
        <div style="display: flex; gap: 6px; margin-bottom: 8px;">
          <span style="background: ${markerColor}; color: white; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: bold;">
            ${atm.risk_level.toUpperCase()} RISK (Score: ${atm.risk_score})
          </span>
        </div>
        <p style="font-size: 12px; margin: 4px 0; color: #334155;">
          • <strong>${atm.nearby_complaints_total}</strong> complaints in 3km perimeter<br>
          • <strong>${atm.withdrawal_linked_count}</strong> forced cash drains<br>
          • <strong>${atm.direct_transactions_total || 0}</strong> direct ATM transactions<br>
          • <strong>${atm.repeat_suspect_count}</strong> repeat phone linkages
        </p>
        <div style="display: flex; gap: 6px; margin-top: 10px;">
          <button onclick="window.investigateAtm('${atm.atm_id}')" style="flex: 1; background: #2563eb; color: white; border: none; padding: 5px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; cursor: pointer;">
            🔍 Investigate
          </button>
          <button onclick="window.openDispatchAlertModal('${atm.atm_id}')" style="flex: 1; background: #dc2626; color: white; border: none; padding: 5px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; cursor: pointer;">
            🚨 Send Alert
          </button>
        </div>
      </div>
    `;

    marker.bindPopup(popupContent);
    marker.on("click", () => {
      drawPerimeterRadius(atm.lat, atm.lon, currentRadius, markerColor);
    });

    atmsLayerGroup.addLayer(marker);
  });

  // 3. Plot Individual Incident Pins
  complaints.forEach(c => {
    if (!c.lat || !c.lon) return;
    const pinColor = c.withdrawal_flag ? "#ef4444" : "#38bdf8";
    const incidentMarker = L.circleMarker([c.lat, c.lon], {
      radius: 4,
      fillColor: pinColor,
      color: "#ffffff",
      weight: 1,
      opacity: 0.8,
      fillOpacity: 0.7
    });

    incidentMarker.bindPopup(`
      <div style="font-family: 'Inter', sans-serif; font-size: 12px; color: #0f172a;">
        <strong>Complaint ${c.complaint_id}</strong><br>
        <strong>Type:</strong> ${c.complaint_type}<br>
        <strong>Time:</strong> ${c.timestamp}<br>
        <strong>Forced Cash Drain:</strong> ${c.withdrawal_flag ? "⚠️ YES" : "No"}<br>
        <small style="color: #64748b;">${c.description}</small>
      </div>
    `);

    complaintsLayerGroup.addLayer(incidentMarker);
  });

  if (bounds.length > 0) {
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
  }

  const highRiskCount = riskScores.filter(s => s.risk_level === "High").length;
  document.getElementById("mapHotspotSummary").innerHTML = `
    <strong>${riskScores.length}</strong> ATMs active | 
    <span class="text-red"><strong>${highRiskCount}</strong> High-Risk Zones</span> | 
    <strong>${complaints.length}</strong> Incidents plotted in scope
  `;
}

function drawPerimeterRadius(lat, lon, radiusKm, color) {
  if (radiusCircleLayer) {
    map.removeLayer(radiusCircleLayer);
  }
  radiusCircleLayer = L.circle([lat, lon], {
    radius: radiusKm * 1000,
    color: color,
    fillColor: color,
    fillOpacity: 0.12,
    weight: 2,
    dashArray: "4, 6"
  }).addTo(map);
}

/* =========================================================================
   2. DATA FETCHING & STATE MANAGEMENT
   ========================================================================= */
async function loadInitialData() {
  try {
    // 1. Fetch Stats
    const statsRes = await fetch("/api/stats");
    cachedStats = await statsRes.json();
    document.getElementById("kpiTotalAtms").innerText = cachedStats.total_atms.toLocaleString();
    document.getElementById("kpiTotalComplaints").innerText = cachedStats.total_complaints.toLocaleString();
    document.getElementById("kpiForcedWithdrawals").innerText = cachedStats.forced_withdrawals.toLocaleString();
    if (document.getElementById("kpiTotalTransactions")) {
      document.getElementById("kpiTotalTransactions").innerText = (cachedStats.total_transactions || 0).toLocaleString();
    }

    const typeSelect = document.getElementById("complaintTypeFilter");
    typeSelect.innerHTML = `<option value="">All Fraud Types</option>`;
    Object.keys(cachedStats.fraud_types || {}).forEach(ft => {
      typeSelect.innerHTML += `<option value="${ft}">${ft} (${cachedStats.fraud_types[ft]})</option>`;
    });

    // 2. Fetch Cities
    const citiesRes = await fetch("/api/cities");
    cachedCities = await citiesRes.json();
    const globalCity = document.getElementById("globalCitySelector");
    const filterCity = document.getElementById("filterCity");
    
    globalCity.innerHTML = `<option value="">All Cities (Nationwide)</option>`;
    filterCity.innerHTML = `<option value="">All Cities</option>`;

    cachedCities.forEach(c => {
      const optHtml = `<option value="${c.city}">${c.city} (${c.complaint_count} incidents, ${c.atm_count} ATMs)</option>`;
      globalCity.innerHTML += optHtml;
      filterCity.innerHTML += optHtml;
    });

    // Populate Banks
    const bankSelect = document.getElementById("filterBank");
    bankSelect.innerHTML = `<option value="">All Banks</option>`;
    Object.keys(cachedStats.bank_distribution || {}).forEach(b => {
      bankSelect.innerHTML += `<option value="${b}">${b} (${cachedStats.bank_distribution[b]})</option>`;
    });

    // 3. Load Alerts
    await loadAlerts();

    // 4. Fetch Risk Scores, Complaints, and Transactions
    await refreshData();

  } catch (err) {
    console.error("Failed to load initial data:", err);
    showToast("Failed to connect to backend server.", "danger");
  }
}

async function refreshData() {
  try {
    const params = new URLSearchParams();
    if (currentCity) params.append("city", currentCity);
    if (currentRadius) params.append("radius_km", currentRadius);
    if (currentTimeWindow && currentTimeWindow !== "all") params.append("window_hours", currentTimeWindow);
    if (currentRiskLevel) params.append("risk_level", currentRiskLevel);
    if (currentBank) params.append("bank", currentBank);

    // Fetch Risk Scores
    const scoresRes = await fetch(`/api/risk-scores?${params.toString()}`);
    cachedRiskScores = await scoresRes.json();

    // Fetch Complaints
    const complaintsParams = new URLSearchParams();
    if (currentCity) complaintsParams.append("city", currentCity);
    const complaintsRes = await fetch(`/api/complaints?${complaintsParams.toString()}`);
    cachedComplaints = await complaintsRes.json();

    // Fetch Transactions
    const txParams = new URLSearchParams();
    if (currentCity) txParams.append("city", currentCity);
    txParams.append("limit", "250");
    const txRes = await fetch(`/api/transactions?${txParams.toString()}`);
    cachedTransactions = await txRes.json();

    // Update KPI for High Risk
    const highRiskCount = cachedRiskScores.filter(s => s.risk_level === "High").length;
    document.getElementById("kpiHighRiskHotspots").innerText = highRiskCount.toLocaleString();

    // Update Analytics Strip
    updateAnalyticsStrip(cachedRiskScores, cachedComplaints);

    // Update GIS Map
    updateMapLayers(cachedRiskScores, cachedComplaints);

    // Render Tables
    renderHotspotsTable(cachedRiskScores);
    renderComplaintsTable(cachedComplaints);
    renderTransactionsTable(cachedTransactions);

  } catch (err) {
    console.error("Data refresh failed:", err);
    showToast("Error recalculating risk scores.", "danger");
  }
}

function updateAnalyticsStrip(scores, complaints) {
  const total = scores.length || 1;
  const high = scores.filter(s => s.risk_level === "High").length;
  const med = scores.filter(s => s.risk_level === "Medium").length;
  const low = scores.filter(s => s.risk_level === "Low").length;

  const pHigh = Math.round((high / total) * 100);
  const pMed = Math.round((med / total) * 100);
  const pLow = 100 - pHigh - pMed;

  const barHigh = document.getElementById("barHighRisk");
  const barMed = document.getElementById("barMedRisk");
  const barLow = document.getElementById("barLowRisk");

  if (barHigh && barMed && barLow) {
    barHigh.style.width = `${pHigh}%`;
    barHigh.innerText = pHigh > 8 ? `High ${pHigh}%` : `${pHigh}%`;
    barMed.style.width = `${pMed}%`;
    barMed.innerText = pMed > 8 ? `Med ${pMed}%` : `${pMed}%`;
    barLow.style.width = `${Math.max(0, pLow)}%`;
    barLow.innerText = pLow > 8 ? `Low ${pLow}%` : `${pLow}%`;
  }

  // Count fraud typologies
  const fCounts = {};
  complaints.forEach(c => {
    fCounts[c.complaint_type] = (fCounts[c.complaint_type] || 0) + 1;
  });
  const sortedTypes = Object.entries(fCounts).sort((a, b) => b[1] - a[1]);
  const container = document.getElementById("typologyBadgesContainer");
  if (container) {
    if (sortedTypes.length > 0) {
      container.innerHTML = sortedTypes.map(([type, cnt]) => {
        const pct = Math.round((cnt / (complaints.length || 1)) * 100);
        return `<span class="code-pill">${type}: <strong>${cnt}</strong> (${pct}%)</span>`;
      }).join(" ");
    } else {
      container.innerHTML = `<span class="code-pill">No incidents logged</span>`;
    }
  }
}

async function loadAlerts() {
  try {
    const res = await fetch("/api/alerts");
    cachedAlerts = await res.json();
    document.getElementById("kpiAlertsSent").innerText = cachedAlerts.length;
    document.getElementById("alertsCountBadge").innerText = cachedAlerts.length;
    renderAlertsTable(cachedAlerts);
  } catch (err) {
    console.error("Failed to load alerts:", err);
  }
}

/* =========================================================================
   3. TABLE RENDERERS
   ========================================================================= */
function renderHotspotsTable(scores) {
  const tbody = document.getElementById("hotspotsTableBody");
  if (!scores || scores.length === 0) {
    tbody.innerHTML = `<tr><td colspan="12" class="text-center py-4">No ATMs matched the current search criteria.</td></tr>`;
    return;
  }

  let html = "";
  scores.slice(0, 100).forEach((s, idx) => {
    let tierBadgeClass = "badge-risk-low";
    if (s.risk_level === "High") tierBadgeClass = "badge-risk-high";
    else if (s.risk_level === "Medium") tierBadgeClass = "badge-risk-med";

    const fraudVectors = (s.dominant_fraud_types || [])
      .map(fv => `<span class="code-pill">${fv[0]} (${fv[1]})</span>`)
      .join(" ");

    html += `
      <tr>
        <td><strong>#${idx + 1}</strong></td>
        <td><span class="badge ${tierBadgeClass}">${s.risk_level}</span></td>
        <td><strong style="font-size: 1.1rem; color: #38bdf8;">${s.risk_score}</strong></td>
        <td><span class="code-pill">${s.atm_id}</span></td>
        <td><strong>${s.bank}</strong></td>
        <td>${s.city} <small style="color: #64748b;">(${s.lat.toFixed(3)}, ${s.lon.toFixed(3)})</small></td>
        <td><strong>${s.nearby_complaints_total}</strong> <small style="color: #64748b;">(24h: ${s.nearby_complaints_24h})</small></td>
        <td>${s.withdrawal_linked_count > 0 ? `<span class="text-red"><strong>${s.withdrawal_linked_count}</strong></span>` : "0"}</td>
        <td>${(s.direct_transactions_total || 0) > 0 ? `<span class="text-amber"><strong>${s.direct_transactions_total}</strong></span>` : "0"}</td>
        <td>${s.repeat_suspect_count > 0 ? `<span class="text-purple"><strong>${s.repeat_suspect_count} rings</strong></span>` : "None"}</td>
        <td>${fraudVectors || "—"}</td>
        <td>
          <div style="display: flex; gap: 6px;">
            <button class="btn btn-secondary btn-sm" onclick="window.investigateAtm('${s.atm_id}')">
              <i class="ph-bold ph-crosshair"></i> Details
            </button>
            <button class="btn btn-danger btn-sm" onclick="window.openDispatchAlertModal('${s.atm_id}')">
              <i class="ph-bold ph-broadcast"></i> Alert
            </button>
          </div>
        </td>
      </tr>
    `;
  });

  tbody.innerHTML = html;
}

function renderTransactionsTable(transactions) {
  const tbody = document.getElementById("transactionsTableBody");
  if (!transactions || transactions.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" class="text-center py-4">No banking transactions match the current filters.</td></tr>`;
    return;
  }

  let html = "";
  transactions.slice(0, 100).forEach(t => {
    const isFraud = t.fraud_label;
    html += `
      <tr style="${isFraud ? 'background: rgba(239, 68, 68, 0.08);' : ''}">
        <td><span class="code-pill">${t.transaction_id}</span></td>
        <td>${t.timestamp}</td>
        <td><strong>${t.bank}</strong> (${t.city})</td>
        <td><span class="code-pill">${t.account_id}</span></td>
        <td><span class="badge" style="background: rgba(56, 189, 248, 0.15); color: #38bdf8;">${t.transaction_type}</span></td>
        <td><strong>₹${Number(t.amount).toLocaleString()}</strong></td>
        <td><span class="badge" style="background: ${t.direction === 'debit' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.15)'}; color: ${t.direction === 'debit' ? '#f87171' : '#34d399'};">${t.direction.toUpperCase()}</span></td>
        <td>${t.atm_id ? `<span class="code-pill text-amber">${t.atm_id}</span>` : '—'}</td>
        <td><span class="code-pill">${t.phone_hash ? t.phone_hash.substring(0, 10) + '…' : '—'}</span></td>
        <td>${isFraud ? '<span class="badge badge-risk-high">⚠️ FRAUD</span>' : '<span style="color: #64748b; font-size: 0.8rem;">Normal</span>'}</td>
      </tr>
    `;
  });

  tbody.innerHTML = html;
}

function renderComplaintsTable(complaints) {
  const tbody = document.getElementById("complaintsTableBody");
  if (!complaints || complaints.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-center py-4">No cybercrime complaints found for this selection.</td></tr>`;
    return;
  }

  let html = "";
  complaints.slice(0, 100).forEach(c => {
    html += `
      <tr>
        <td><span class="code-pill">${c.complaint_id}</span></td>
        <td>${c.timestamp}</td>
        <td>${c.city}</td>
        <td><span class="badge" style="background: rgba(168, 85, 247, 0.15); color: #c084fc;">${c.complaint_type}</span></td>
        <td>${c.bank_ref || "—"}</td>
        <td><span class="code-pill">${c.phone_hash ? c.phone_hash.substring(0, 10) + "…" : "—"}</span></td>
        <td>${c.withdrawal_flag ? `<span class="text-red"><strong>⚠️ YES</strong></span>` : "No"}</td>
        <td>${c.withdrawal_atm_id ? `<span class="code-pill">${c.withdrawal_atm_id}</span>` : "—"}</td>
        <td style="max-width: 320px; font-size: 0.8rem; color: #94a3b8;">${c.description}</td>
      </tr>
    `;
  });

  tbody.innerHTML = html;
}

function renderAlertsTable(alerts) {
  const tbody = document.getElementById("alertsTableBody");
  if (!alerts || alerts.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-center py-4">No alerts dispatched yet.</td></tr>`;
    return;
  }

  let html = "";
  alerts.forEach(a => {
    let tierBadgeClass = "badge-risk-low";
    if (a.risk_level === "High") tierBadgeClass = "badge-risk-high";
    else if (a.risk_level === "Medium") tierBadgeClass = "badge-risk-med";

    html += `
      <tr>
        <td><span class="code-pill">${a.alert_id}</span></td>
        <td>${new Date(a.timestamp).toLocaleString()}</td>
        <td><span class="code-pill">${a.atm_id}</span></td>
        <td><strong>${a.bank}</strong> (${a.city})</td>
        <td><span class="badge ${tierBadgeClass}">${a.risk_level}</span></td>
        <td>${a.recipient_type} <small style="color: #64748b;">(${a.recipient_id})</small></td>
        <td>${a.channel}</td>
        <td><span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #34d399;">${a.status}</span></td>
        <td style="max-width: 360px; font-family: 'JetBrains Mono', monospace; font-size: 0.75rem; color: #cbd5e1; white-space: pre-wrap;">${a.mock_message}</td>
      </tr>
    `;
  });

  tbody.innerHTML = html;
}

/* =========================================================================
   4. EXECUTIVE REPORTING & DOSSIER GENERATION
   ========================================================================= */
window.generateExecutiveReport = function() {
  const jurisdiction = currentCity || "National Jurisdiction (All Cities)";
  document.getElementById("reportJurisdictionBadge").innerText = `${jurisdiction.toUpperCase()} DIRECTIVE`;

  const totalAtms = cachedRiskScores.length;
  const highRiskHotspots = cachedRiskScores.filter(s => s.risk_level === "High");
  const totalComplaints = cachedComplaints.length;
  const forcedDrains = cachedComplaints.filter(c => c.withdrawal_flag).length;

  const topTargets = cachedRiskScores.slice(0, 8);

  const phoneRings = {};
  cachedComplaints.forEach(c => {
    if (c.phone_hash) {
      phoneRings[c.phone_hash] = (phoneRings[c.phone_hash] || 0) + 1;
    }
  });
  const topPhoneRings = Object.entries(phoneRings)
    .filter(([_, count]) => count > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  let targetRowsHtml = "";
  topTargets.forEach((t, i) => {
    targetRowsHtml += `
      <tr>
        <td><strong>#${i + 1}</strong></td>
        <td><strong style="color: #ef4444;">${t.atm_id}</strong></td>
        <td><strong>${t.bank}</strong></td>
        <td>${t.city} (${t.lat.toFixed(4)}, ${t.lon.toFixed(4)})</td>
        <td><span class="badge ${t.risk_level === 'High' ? 'badge-risk-high' : 'badge-risk-med'}">${t.risk_level} (${t.risk_score})</span></td>
        <td>${t.nearby_complaints_total} in 3km</td>
        <td>${t.withdrawal_linked_count}</td>
        <td>${t.repeat_suspect_count > 0 ? `${t.repeat_suspect_count} ring(s)` : 'None'}</td>
      </tr>
    `;
  });

  let ringsHtml = "";
  if (topPhoneRings.length > 0) {
    ringsHtml = topPhoneRings.map(([hash, count]) => `
      <div style="background: #0f172a; padding: 6px 10px; border-radius: 4px; border-left: 3px solid #a855f7; font-size: 0.8rem; margin-bottom: 6px;">
        Hash: <code>${hash}</code> &rarr; Active across <strong>${count} multi-victim incidents</strong>
      </div>
    `).join("");
  } else {
    ringsHtml = `<p style="font-size: 0.8rem; color: #64748b;">No multi-incident repeat phone rings detected in current scope.</p>`;
  }

  const reportContainer = document.getElementById("executiveReportContent");
  reportContainer.innerHTML = `
    <div class="dossier-wrap">
      <div class="dossier-header-box">
        <div>
          <div class="dossier-agency">LAW ENFORCEMENT CYBER INTELLIGENCE UNIT & BANK VIGILANCE NETWORK</div>
          <div class="dossier-title">Cybercrime Cash-Withdrawal Hotspot Threat Directive</div>
          <div class="dossier-meta">
            Scope: <strong>${jurisdiction}</strong> | Date: <strong>${new Date().toLocaleString()}</strong> | Document Ref: <strong>INTEL-DIR-${Date.now().toString().slice(-6)}</strong>
          </div>
        </div>
        <div class="dossier-stamp">
          OFFICIAL USE ONLY<br>ACTIONABLE LEA BRIEF
        </div>
      </div>

      <!-- STATS SUMMARY -->
      <div class="dossier-stat-grid">
        <div class="dossier-stat-card">
          <div class="val">${totalAtms.toLocaleString()}</div>
          <div class="lbl">Monitored Terminals</div>
        </div>
        <div class="dossier-stat-card">
          <div class="val" style="color: #ef4444;">${highRiskHotspots.length}</div>
          <div class="lbl">Critical High Risk ATMs</div>
        </div>
        <div class="dossier-stat-card">
          <div class="val" style="color: #a855f7;">${totalComplaints.toLocaleString()}</div>
          <div class="lbl">Surrounding Complaints</div>
        </div>
        <div class="dossier-stat-card">
          <div class="val" style="color: #f59e0b;">${forcedDrains}</div>
          <div class="lbl">Forced Cash Drains</div>
        </div>
      </div>

      <!-- TACTICAL ADVISORY -->
      <div class="dossier-section">
        <div class="dossier-section-title"><i class="ph-bold ph-siren"></i> Tactical Law Enforcement Directives</div>
        <div class="dossier-directive-box">
          <strong>Mandatory Field Orders:</strong>
          <ul>
            <li>Deploy designated mobile patrol units to High-Risk ATM locations during peak withdrawal windows (17:00 - 23:00 hrs).</li>
            <li>Direct Bank ATM Custodians & Vigilance Officers to review CCTV feeds for multi-card sequential cash extraction.</li>
            <li>Coordinate with telecom nodal contacts for swift SIM-block actions on identified cross-victim phone rings.</li>
          </ul>
        </div>
      </div>

      <!-- TARGET HOTSPOTS TABLE -->
      <div class="dossier-section">
        <div class="dossier-section-title"><i class="ph-bold ph-crosshair"></i> Priority Threat Targets (Ranked Hotspot Register)</div>
        <table class="dossier-hotspot-table">
          <thead>
            <tr>
              <th>Rank</th>
              <th>ATM ID</th>
              <th>Bank</th>
              <th>City & Location</th>
              <th>Threat Level</th>
              <th>3km Incidents</th>
              <th>Forced Drains</th>
              <th>Syndicate Links</th>
            </tr>
          </thead>
          <tbody>
            ${targetRowsHtml}
          </tbody>
        </table>
      </div>

      <!-- SUSPECT RINGS -->
      <div class="dossier-section">
        <div class="dossier-section-title"><i class="ph-bold ph-graph"></i> Active Mule Telecom & Syndicate Fingerprints</div>
        ${ringsHtml}
      </div>

      <div style="margin-top: 24px; border-top: 1px solid #334155; padding-top: 10px; font-size: 0.72rem; color: #64748b; display: flex; justify-content: space-between;">
        <span>System: SENTINEL Hotspot Prediction Engine v2.0</span>
        <span>Generated for Law Enforcement Agencies & Participating Banks</span>
      </div>
    </div>
  `;

  openModal("executiveReportModal");
};

window.printReport = function() {
  window.print();
};

window.downloadReportHTML = function() {
  const content = document.getElementById("executiveReportContent").innerHTML;
  const fullHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>SENTINEL Intelligence Dossier - ${currentCity || 'Nationwide'}</title>
      <style>
        body { font-family: 'Segoe UI', Arial, sans-serif; margin: 30px; color: #0f172a; background: #fff; line-height: 1.5; }
        .dossier-header-box { border: 2px solid #0f172a; padding: 16px; margin-bottom: 20px; display: flex; justify-content: space-between; }
        .dossier-agency { font-size: 11px; font-weight: bold; color: #2563eb; }
        .dossier-title { font-size: 20px; font-weight: bold; margin: 4px 0; }
        .dossier-stamp { border: 2px solid #dc2626; color: #dc2626; padding: 6px; font-weight: bold; font-size: 11px; }
        .dossier-stat-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 20px; }
        .dossier-stat-card { border: 1px solid #cbd5e1; padding: 10px; text-align: center; background: #f8fafc; }
        .dossier-stat-card .val { font-size: 22px; font-weight: bold; color: #0f172a; }
        .dossier-stat-card .lbl { font-size: 11px; color: #64748b; text-transform: uppercase; }
        .dossier-section-title { font-size: 14px; font-weight: bold; border-bottom: 2px solid #0f172a; padding-bottom: 4px; margin: 16px 0 8px 0; }
        .dossier-hotspot-table { width: 100%; border-collapse: collapse; font-size: 12px; }
        .dossier-hotspot-table th, .dossier-hotspot-table td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; }
        .dossier-hotspot-table th { background: #f1f5f9; }
        .dossier-directive-box { border: 2px solid #ef4444; background: #fee2e2; padding: 10px 14px; margin-bottom: 15px; font-size: 12px; }
      </style>
    </head>
    <body>
      ${content}
    </body>
    </html>
  `;
  const blob = new Blob([fullHtml], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `executive_dossier_${currentCity || 'national'}_${Date.now()}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  showToast("Executive HTML dossier downloaded.", "success");
};

/* =========================================================================
   5. SINGLE ATM PATROL CARD EXPORT
   ========================================================================= */
window.exportSingleAtmDossier = function() {
  if (!selectedAtmForAction) {
    showToast("No ATM currently selected.", "danger");
    return;
  }
  const atm = selectedAtmForAction;
  const printWindow = window.open("", "_blank");
  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Field Patrol Card - ${atm.bank} ATM (${atm.atm_id})</title>
      <style>
        body { font-family: 'Segoe UI', Arial, sans-serif; padding: 25px; color: #000; }
        .header { border: 2px solid #000; padding: 12px; margin-bottom: 16px; display: flex; justify-content: space-between; }
        .stamp { border: 2px solid #ef4444; color: #ef4444; padding: 6px 12px; font-weight: bold; text-align: center; }
        .title { font-size: 18px; font-weight: bold; margin-bottom: 4px; }
        .box { border: 1px solid #94a3b8; padding: 10px; margin-bottom: 12px; }
        table { width: 100%; border-collapse: collapse; font-size: 12px; }
        th, td { border: 1px solid #cbd5e1; padding: 6px; text-align: left; }
        th { background: #f1f5f9; }
      </style>
    </head>
    <body>
      <div class="header">
        <div>
          <div style="font-size: 11px; font-weight: bold; color: #2563eb;">POLICE PATROL ACTION CARD</div>
          <div class="title">TARGET ATM: ${atm.bank} (${atm.atm_id}) - ${atm.city}</div>
          <div>Coordinates: Lat ${atm.lat.toFixed(5)}, Lon ${atm.lon.toFixed(5)}</div>
        </div>
        <div class="stamp">PRIORITY SURVEILLANCE</div>
      </div>
      <div class="box">
        <strong>Field Officer Instructions:</strong>
        <ol>
          <li>Perform physical visual inspection of ATM lobby and card reader slot for skimming overlays.</li>
          <li>Observe suspicious individuals conducting multiple sequential card withdrawals.</li>
          <li>Log contact with ATM security guard and verify functioning of CCTV cameras.</li>
        </ol>
      </div>
      <div style="font-size: 11px; color: #64748b; margin-top: 20px;">
        Generated by SENTINEL Cybercrime Hotspot Predictive Framework | Timestamp: ${new Date().toLocaleString()}
      </div>
    </body>
    </html>
  `);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => printWindow.print(), 500);
};

/* =========================================================================
   6. MODALS & INVESTIGATIVE DRILLDOWN
   ========================================================================= */
window.investigateAtm = async function(atmId) {
  openModal("drilldownModal");
  const modalBody = document.getElementById("modalDrilldownBody");
  modalBody.innerHTML = `<div class="loading-spinner">Fetching forensic drilldown for ${atmId}...</div>`;

  try {
    const res = await fetch(`/api/atm/${atmId}/details?radius_km=${currentRadius}`);
    if (!res.ok) throw new Error("Failed to load details");
    const data = await res.json();
    selectedAtmForAction = data.atm;

    document.getElementById("modalAtmTitle").innerText = `${data.atm.bank} ATM (${data.atm.atm_id})`;
    const riskBadge = document.getElementById("modalRiskBadge");
    riskBadge.innerText = `${data.risk_level} RISK (Score: ${data.risk_score})`;
    riskBadge.className = `badge ${data.risk_level === 'High' ? 'badge-risk-high' : (data.risk_level === 'Medium' ? 'badge-risk-med' : 'badge-risk-low')}`;

    // Suspect phone cluster breakdown
    const clusterEntries = Object.entries(data.suspect_phone_clusters || {});
    let clusterHtml = "";
    if (clusterEntries.length > 0) {
      clusterHtml = clusterEntries.map(([hash, cids]) => `
        <div style="background: #0b0f19; padding: 8px 12px; border-radius: 4px; margin-bottom: 6px; border-left: 3px solid #a855f7;">
          <span class="code-pill">${hash}</span> &rarr; linked to <strong>${cids.length} complaints</strong>: <small>${cids.join(", ")}</small>
        </div>
      `).join("");
    } else {
      clusterHtml = `<p style="color: #64748b; font-size: 0.85rem;">No multi-victim repeat phone hash rings detected within ${data.radius_km}km.</p>`;
    }

    // Suggested actions list
    const actionsHtml = (data.suggested_actions || []).map(act => `
      <li style="margin-bottom: 6px;">${act}</li>
    `).join("");

    // Direct ATM Ledger Transactions
    let directTxHtml = "";
    if (data.direct_transactions && data.direct_transactions.length > 0) {
      data.direct_transactions.forEach(t => {
        directTxHtml += `
          <tr>
            <td><span class="code-pill">${t.transaction_id}</span></td>
            <td>${t.timestamp}</td>
            <td><span class="code-pill">${t.account_id}</span></td>
            <td>${t.transaction_type}</td>
            <td>₹${Number(t.amount).toLocaleString()}</td>
            <td>${t.fraud_label ? '<span class="badge badge-risk-high">FRAUD</span>' : 'Normal'}</td>
          </tr>
        `;
      });
    } else {
      directTxHtml = `<tr><td colspan="6" class="text-center py-2" style="color: #64748b;">No direct ledger transactions recorded for this terminal.</td></tr>`;
    }

    // Contributing complaints table
    let compTableHtml = "";
    (data.complaints || []).slice(0, 10).forEach(c => {
      compTableHtml += `
        <tr>
          <td><span class="code-pill">${c.complaint_id}</span></td>
          <td>${c.distance_km} km</td>
          <td>${c.complaint_type}</td>
          <td>${c.timestamp}</td>
          <td>${c.withdrawal_flag ? '<span class="text-red">⚠️ YES</span>' : 'No'}</td>
          <td style="max-width: 250px; font-size: 0.78rem;">${c.description}</td>
        </tr>
      `;
    });

    modalBody.innerHTML = `
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px;">
        <div class="info-box">
          <h4><i class="ph-bold ph-map-pin text-blue"></i> ATM Location Profile</h4>
          <p style="font-size: 0.85rem; color: #cbd5e1; margin-top: 6px;">
            <strong>Bank:</strong> ${data.atm.bank}<br>
            <strong>City:</strong> ${data.atm.city}<br>
            <strong>Coordinates:</strong> ${data.atm.lat.toFixed(5)}, ${data.atm.lon.toFixed(5)}<br>
            <strong>Search Radius:</strong> ${data.radius_km} km
          </p>
        </div>

        <div class="info-box">
          <h4><i class="ph-bold ph-chart-bar text-amber"></i> Threat Metrics Summary</h4>
          <p style="font-size: 0.85rem; color: #cbd5e1; margin-top: 6px;">
            <strong>Surrounding Complaints:</strong> ${data.total_complaints_in_radius}<br>
            <strong>Direct Terminal Transactions:</strong> ${data.total_direct_transactions || 0}<br>
            <strong>Direct Flagged Frauds:</strong> ${data.direct_fraud_transactions || 0}<br>
            <strong>Repeat Suspect Links:</strong> ${clusterEntries.length} syndicate ring(s)
          </p>
        </div>
      </div>

      <div class="info-box" style="margin-bottom: 20px; border-left: 4px solid #ef4444;">
        <h4><i class="ph-bold ph-shield-check text-red"></i> Proactive LEA & Bank Intervention Advisory</h4>
        <ul style="padding-left: 20px; font-size: 0.85rem; color: #f8fafc; margin-top: 6px;">
          ${actionsHtml}
        </ul>
      </div>

      <h4 style="margin-bottom: 8px; font-size: 0.95rem;"><i class="ph-bold ph-receipt text-amber"></i> Direct ATM Terminal Transactions Ledger</h4>
      <div class="table-container" style="max-height: 180px; margin-bottom: 20px;">
        <table class="data-table">
          <thead>
            <tr>
              <th>TX ID</th>
              <th>Date</th>
              <th>Account</th>
              <th>Type</th>
              <th>Amount</th>
              <th>Flag</th>
            </tr>
          </thead>
          <tbody>
            ${directTxHtml}
          </tbody>
        </table>
      </div>

      <div class="info-box" style="margin-bottom: 20px;">
        <h4><i class="ph-bold ph-graph text-purple"></i> Linked Suspect Phone Rings (Cross-Complaint Pattern)</h4>
        <div style="margin-top: 8px;">${clusterHtml}</div>
      </div>

      <h4 style="margin-bottom: 8px; font-size: 0.95rem;"><i class="ph-bold ph-list-bullets"></i> Contributing Incident Records (Top ${Math.min(10, data.complaints.length)} of ${data.total_complaints_in_radius})</h4>
      <div class="table-container" style="max-height: 200px;">
        <table class="data-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Distance</th>
              <th>Type</th>
              <th>Date</th>
              <th>Withdrawal?</th>
              <th>Narrative</th>
            </tr>
          </thead>
          <tbody>
            ${compTableHtml}
          </tbody>
        </table>
      </div>
    `;

  } catch (err) {
    modalBody.innerHTML = `<div class="text-red text-center py-4">Error loading forensic data for ATM.</div>`;
  }
};

window.openDispatchAlertModal = function(atmId) {
  const atm = cachedRiskScores.find(s => s.atm_id === atmId) || cachedAtms.find(a => a.atm_id === atmId) || selectedAtmForAction;
  if (!atm) return;
  selectedAtmForAction = atm;

  document.getElementById("alertAtmId").value = atm.atm_id;
  document.getElementById("alertAtmInfo").value = `${atm.bank} ATM (${atm.atm_id}) - ${atm.city} [Risk: ${atm.risk_level || 'High'}]`;
  
  updateAlertPreview();
  openModal("dispatchAlertModal");
};

function updateAlertPreview() {
  if (!selectedAtmForAction) return;
  const rType = document.getElementById("alertRecipientType").value;
  const rId = document.getElementById("alertRecipientId").value;
  const channel = document.getElementById("alertChannel").value;
  const note = document.getElementById("alertOfficerNote").value;
  const atm = selectedAtmForAction;

  let msg = `🚨 [${(atm.risk_level || "HIGH").toUpperCase()} ALERT] Cybercrime Cash-Withdrawal Threat!\n` +
            `Location: ${atm.bank} ATM (${atm.atm_id}), ${atm.city} (Lat: ${atm.lat}, Lon: ${atm.lon})\n` +
            `Risk Score: ${atm.risk_score || '7.5'} | Cluster: ${atm.nearby_complaints_total || '5'} complaints within 3km\n` +
            `Direct ATM Transactions: ${atm.direct_transactions_total || 0}\n` +
            `Target: ${rType} (${rId}) via ${channel}\n` +
            `Action: Deploy patrol unit for ATM visual check & alert ${atm.bank} Fraud Desk.`;
  if (note.trim()) {
    msg += `\nOfficer Note: ${note.trim()}`;
  }
  document.getElementById("alertMessagePreview").innerText = msg;
}

window.openModal = function(modalId) {
  document.getElementById(modalId).classList.add("active");
};

window.closeModal = function(modalId) {
  document.getElementById(modalId).classList.remove("active");
};

/* =========================================================================
   7. EVENT HANDLERS & EXPORTS
   ========================================================================= */
function bindEvents() {
  // Tab Switching
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-pane").forEach(p => p.classList.remove("active"));

      btn.classList.add("active");
      const targetPane = document.getElementById(btn.getAttribute("data-target"));
      if (targetPane) targetPane.classList.add("active");

      if (btn.getAttribute("data-target") === "tabMap" && map) {
        setTimeout(() => map.invalidateSize(), 200);
      }
    });
  });

  // Global City Selector
  document.getElementById("globalCitySelector").addEventListener("change", (e) => {
    currentCity = e.target.value;
    document.getElementById("filterCity").value = currentCity;
    refreshData();
  });

  // Map Provider Selector
  const provSelect = document.getElementById("mapProviderSelect");
  if (provSelect) {
    provSelect.addEventListener("change", (e) => {
      applyBaseMapTileLayer(e.target.value);
      localStorage.setItem("default_map_provider", e.target.value);
      showToast(`Map style switched to ${e.target.options[e.target.selectedIndex].text}`, "success");
    });
  }

  // Open Map API Modal Triggers
  const btnMapNav = document.getElementById("btnOpenMapApiModalNav");
  const btnMapSide = document.getElementById("btnOpenMapApiModalSidebar");
  if (btnMapNav) btnMapNav.addEventListener("click", () => openModal("mapApiModal"));
  if (btnMapSide) btnMapSide.addEventListener("click", () => openModal("mapApiModal"));

  // Save Map API Keys
  const btnSaveMapKeys = document.getElementById("btnSaveMapApiKeys");
  if (btnSaveMapKeys) {
    btnSaveMapKeys.addEventListener("click", async () => {
      const mbToken = document.getElementById("inputMapboxToken").value.trim();
      const mtKey = document.getElementById("inputMapTilerKey").value.trim();
      const gmKey = document.getElementById("inputGoogleMapsKey").value.trim();

      mapApiKeys.mapbox_access_token = mbToken;
      mapApiKeys.maptiler_api_key = mtKey;
      mapApiKeys.google_maps_api_key = gmKey;

      localStorage.setItem("mapbox_access_token", mbToken);
      localStorage.setItem("maptiler_api_key", mtKey);
      localStorage.setItem("google_maps_api_key", gmKey);

      try {
        await fetch("/api/config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mapbox_access_token: mbToken,
            maptiler_api_key: mtKey,
            google_maps_api_key: gmKey,
            default_map_provider: currentMapProvider
          })
        });
      } catch (e) {
        console.warn("Could not persist to server config, saved to localStorage.");
      }

      closeModal("mapApiModal");
      applyBaseMapTileLayer(currentMapProvider);
      showToast("Map API Keys saved and applied successfully!", "success");
    });
  }

  // Map Filter Form Controls
  document.getElementById("filterCity").addEventListener("change", (e) => {
    currentCity = e.target.value;
    document.getElementById("globalCitySelector").value = currentCity;
  });

  document.getElementById("filterTimeWindow").addEventListener("change", (e) => {
    currentTimeWindow = e.target.value;
  });

  document.getElementById("filterRiskLevel").addEventListener("change", (e) => {
    currentRiskLevel = e.target.value;
  });

  document.getElementById("filterBank").addEventListener("change", (e) => {
    currentBank = e.target.value;
  });

  document.getElementById("filterRadius").addEventListener("input", (e) => {
    currentRadius = parseFloat(e.target.value);
    document.getElementById("radiusVal").innerText = `${currentRadius.toFixed(1)} km`;
  });

  document.getElementById("btnApplyFilters").addEventListener("click", () => {
    refreshData();
    showToast("Filters applied and risk scores updated.", "success");
  });

  // Layer Toggles
  document.getElementById("layerToggleAtms").addEventListener("change", (e) => {
    if (e.target.checked) map.addLayer(atmsLayerGroup);
    else map.removeLayer(atmsLayerGroup);
  });

  document.getElementById("layerToggleHeatmap").addEventListener("change", (e) => {
    if (heatmapLayer) {
      if (e.target.checked) map.addLayer(heatmapLayer);
      else map.removeLayer(heatmapLayer);
    }
  });

  document.getElementById("layerToggleComplaints").addEventListener("change", (e) => {
    if (e.target.checked) map.addLayer(complaintsLayerGroup);
    else map.removeLayer(complaintsLayerGroup);
  });

  // Quick Preset Filters
  document.querySelectorAll(".preset-pill").forEach(pill => {
    pill.addEventListener("click", () => {
      const preset = pill.getAttribute("data-preset");
      if (!preset) return;

      document.querySelectorAll(".preset-pill").forEach(p => p.classList.remove("active"));
      pill.classList.add("active");

      if (preset === "all") {
        currentRiskLevel = "";
        currentTimeWindow = "all";
        document.getElementById("filterRiskLevel").value = "";
        document.getElementById("filterTimeWindow").value = "all";
        refreshData();
      } else if (preset === "top10") {
        currentRiskLevel = "High";
        document.getElementById("filterRiskLevel").value = "High";
        refreshData();
      } else if (preset === "forcedCash") {
        document.getElementById("filterWithdrawalOnly").checked = true;
        filterComplaintsTable();
        refreshData();
      } else if (preset === "highRisk") {
        currentRiskLevel = "High";
        document.getElementById("filterRiskLevel").value = "High";
        refreshData();
      } else if (preset === "window24") {
        currentTimeWindow = "24";
        document.getElementById("filterTimeWindow").value = "24";
        refreshData();
      }
    });
  });

  // Executive Report Triggers
  document.getElementById("btnOpenExecutiveReportNav").addEventListener("click", window.generateExecutiveReport);
  document.getElementById("btnPresetReport").addEventListener("click", window.generateExecutiveReport);
  document.getElementById("btnGenReportInvestigator").addEventListener("click", window.generateExecutiveReport);

  // Investigator Search Filter
  document.getElementById("investigatorSearch").addEventListener("input", (e) => {
    const q = e.target.value.toLowerCase().trim();
    if (!q) {
      renderHotspotsTable(cachedRiskScores);
      return;
    }
    const filtered = cachedRiskScores.filter(s =>
      s.atm_id.toLowerCase().includes(q) ||
      s.bank.toLowerCase().includes(q) ||
      s.city.toLowerCase().includes(q) ||
      s.risk_level.toLowerCase().includes(q)
    );
    renderHotspotsTable(filtered);
  });

  // Transactions Filter & Export
  document.getElementById("txTypeFilter").addEventListener("change", filterTransactionsTable);
  document.getElementById("filterTxFraudOnly").addEventListener("change", filterTransactionsTable);
  document.getElementById("txSearchInput").addEventListener("input", filterTransactionsTable);
  document.getElementById("btnExportTransactions").addEventListener("click", exportTransactionsCSV);

  function filterTransactionsTable() {
    const type = document.getElementById("txTypeFilter").value;
    const fraudOnly = document.getElementById("filterTxFraudOnly").checked;
    const q = document.getElementById("txSearchInput").value.toLowerCase().trim();

    let filtered = cachedTransactions;
    if (type) filtered = filtered.filter(t => t.transaction_type.toLowerCase() === type.toLowerCase());
    if (fraudOnly) filtered = filtered.filter(t => t.fraud_label);
    if (q) {
      filtered = filtered.filter(t =>
        t.transaction_id.toLowerCase().includes(q) ||
        t.account_id.toLowerCase().includes(q) ||
        t.phone_hash.toLowerCase().includes(q) ||
        (t.atm_id && t.atm_id.toLowerCase().includes(q)) ||
        t.bank.toLowerCase().includes(q)
      );
    }
    renderTransactionsTable(filtered);
  }

  // Complaints Table Filters & Export
  document.getElementById("complaintTypeFilter").addEventListener("change", filterComplaintsTable);
  document.getElementById("filterWithdrawalOnly").addEventListener("change", filterComplaintsTable);
  document.getElementById("btnExportComplaints").addEventListener("click", exportComplaintsCSV);

  function filterComplaintsTable() {
    const type = document.getElementById("complaintTypeFilter").value;
    const wOnly = document.getElementById("filterWithdrawalOnly").checked;
    let filtered = cachedComplaints;
    if (type) filtered = filtered.filter(c => c.complaint_type.toLowerCase() === type.toLowerCase());
    if (wOnly) filtered = filtered.filter(c => c.withdrawal_flag);
    renderComplaintsTable(filtered);
  }

  // Alerts Export
  document.getElementById("btnExportAlerts").addEventListener("click", exportAlertsCSV);

  // Export Hotspots CSV
  document.getElementById("btnExportHotspots").addEventListener("click", () => {
    if (!cachedRiskScores || cachedRiskScores.length === 0) {
      showToast("No hotspots to export.", "danger");
      return;
    }
    let csv = "Rank,Risk_Tier,Risk_Score,ATM_ID,Bank,City,Latitude,Longitude,Total_3km_Complaints,Direct_ATM_Transactions,Withdrawal_Count,Repeat_Suspect_Rings\n";
    cachedRiskScores.forEach((s, idx) => {
      csv += `${idx + 1},${s.risk_level},${s.risk_score},${s.atm_id},${s.bank},${s.city},${s.lat},${s.lon},${s.nearby_complaints_total},${s.direct_transactions_total || 0},${s.withdrawal_linked_count},${s.repeat_suspect_count}\n`;
    });
    downloadCSV(csv, `hotspots_intelligence_${currentCity || "national"}.csv`);
  });

  // Drilldown Modal Alert Button
  document.getElementById("btnOpenDispatchFromModal").addEventListener("click", () => {
    closeModal("drilldownModal");
    if (selectedAtmForAction) {
      window.openDispatchAlertModal(selectedAtmForAction.atm_id);
    }
  });

  // Alert Form Input Sync
  ["alertRecipientType", "alertRecipientId", "alertChannel", "alertOfficerNote"].forEach(id => {
    document.getElementById(id).addEventListener("input", updateAlertPreview);
    document.getElementById(id).addEventListener("change", updateAlertPreview);
  });

  // Confirm Dispatch Alert
  document.getElementById("btnConfirmDispatch").addEventListener("click", async () => {
    const atmId = document.getElementById("alertAtmId").value;
    const recipientType = document.getElementById("alertRecipientType").value;
    const recipientId = document.getElementById("alertRecipientId").value;
    const channel = document.getElementById("alertChannel").value;
    const note = document.getElementById("alertOfficerNote").value;

    try {
      const res = await fetch("/api/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          atm_id: atmId,
          recipient_type: recipientType,
          recipient_id: recipientId,
          channel: channel,
          custom_note: note
        })
      });

      if (!res.ok) throw new Error("Failed to dispatch alert");
      const result = await res.json();
      closeModal("dispatchAlertModal");
      showToast(`Alert ${result.alert_id} successfully dispatched to ${recipientType}!`, "success");
      await loadAlerts();

    } catch (err) {
      console.error("Alert dispatch failed:", err);
      showToast("Error sending alert dispatch.", "danger");
    }
  });
}

function exportTransactionsCSV() {
  if (!cachedTransactions || cachedTransactions.length === 0) {
    showToast("No transactions to export.", "danger");
    return;
  }
  let csv = "Transaction_ID,Timestamp,Bank,City,Account_ID,Transaction_Type,Amount,Direction,ATM_ID,Phone_Hash,Fraud_Label\n";
  cachedTransactions.forEach(t => {
    csv += `${t.transaction_id},${t.timestamp},${t.bank},${t.city},${t.account_id},${t.transaction_type},${t.amount},${t.direction},${t.atm_id || ''},${t.phone_hash},${t.fraud_label ? 'yes' : 'no'}\n`;
  });
  downloadCSV(csv, `transactions_ledger_${currentCity || 'all'}.csv`);
}

function exportComplaintsCSV() {
  if (!cachedComplaints || cachedComplaints.length === 0) {
    showToast("No complaints to export.", "danger");
    return;
  }
  let csv = "Complaint_ID,Timestamp,City,Complaint_Type,Bank_Ref,Phone_Hash,Forced_Cash_Drain,Withdrawal_ATM_ID,Description\n";
  cachedComplaints.forEach(c => {
    const desc = (c.description || '').replace(/"/g, '""');
    csv += `${c.complaint_id},${c.timestamp},${c.city},${c.complaint_type},${c.bank_ref || ''},${c.phone_hash},${c.withdrawal_flag ? 'yes' : 'no'},${c.withdrawal_atm_id || ''},"${desc}"\n`;
  });
  downloadCSV(csv, `complaints_repository_${currentCity || 'all'}.csv`);
}

function exportAlertsCSV() {
  if (!cachedAlerts || cachedAlerts.length === 0) {
    showToast("No alerts to export.", "danger");
    return;
  }
  let csv = "Alert_ID,Timestamp,ATM_ID,Bank,City,Risk_Level,Recipient_Type,Recipient_ID,Channel,Status,Message\n";
  cachedAlerts.forEach(a => {
    const msg = (a.mock_message || '').replace(/"/g, '""');
    csv += `${a.alert_id},${a.timestamp},${a.atm_id},${a.bank},${a.city},${a.risk_level},${a.recipient_type},${a.recipient_id},${a.channel},${a.status},"${msg}"\n`;
  });
  downloadCSV(csv, `alerts_audit_trail.csv`);
}

function downloadCSV(csvText, filename) {
  const blob = new Blob([csvText], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast(`Exported ${filename}`, "success");
}

/* =========================================================================
   8. TOAST NOTIFICATIONS HELPER
   ========================================================================= */
function showToast(message, type = "success") {
  const container = document.getElementById("toastContainer");
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <i class="ph-bold ${type === 'success' ? 'ph-check-circle' : 'ph-warning-circle'}"></i>
    <span>${message}</span>
  `;
  container.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 4000);
}
