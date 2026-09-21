"""
REST API & Web Server for Predictive Analytics Framework for Cybercrime Hotspots.
Provides REST endpoints and serves the GIS Command Center web UI.
"""

import http.server
import json
import os
import sys
import urllib.parse
from datetime import datetime
from typing import Any, Dict, List, Optional
from risk_engine import engine, parse_iso_or_custom_datetime

# Configure standard output encoding for Windows compatibility
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

PORT = 8000
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
ALERTS_FILE = os.path.join(BASE_DIR, "alerts.json")
CONFIG_FILE = os.path.join(BASE_DIR, "config.json")


def load_config() -> Dict[str, Any]:
    """Load system configuration and map API keys."""
    default_config = {
        "mapbox_access_token": "",
        "maptiler_api_key": "",
        "google_maps_api_key": "",
        "default_map_provider": "carto_dark"
    }
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                default_config.update(data)
                return default_config
        except Exception:
            return default_config
    return default_config


def save_config(config_data: Dict[str, Any]) -> None:
    """Save map API keys and runtime configuration."""
    current = load_config()
    current.update(config_data)
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(current, f, indent=2)


def load_alerts() -> List[Dict[str, Any]]:
    """Load alerts audit trail from disk."""
    if os.path.exists(ALERTS_FILE):
        try:
            with open(ALERTS_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return []
    return []


def save_alert(alert_record: Dict[str, Any]) -> None:
    """Append a new alert record to the persistent audit trail."""
    alerts = load_alerts()
    alerts.insert(0, alert_record)  # Latest first
    with open(ALERTS_FILE, "w", encoding="utf-8") as f:
        json.dump(alerts, f, indent=2)


class HotspotAPIRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=STATIC_DIR, **kwargs)

    def _send_json(self, data: Any, status_code: int = 200):
        """Helper to send JSON response with CORS headers."""
        response_bytes = json.dumps(data, default=str).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(response_bytes)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.end_headers()
        self.wfile.write(response_bytes)

    def do_OPTIONS(self):
        """Handle CORS pre-flight requests."""
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_GET(self):
        """Route GET requests to API endpoints or static web assets."""
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path
        query_params = urllib.parse.parse_qs(parsed_url.query)

        def qp(key: str, default: Optional[str] = None) -> Optional[str]:
            vals = query_params.get(key, [])
            return vals[0].strip() if vals else default

        # Health endpoint
        if path == "/health" or path == "/api/health":
            self._send_json({
                "status": "ok",
                "timestamp": datetime.now().isoformat(),
                "service": "Cybercrime Hotspot Predictive Risk Engine",
                "version": "2.0.0"
            })
            return

        # Map API Keys and Configuration endpoint
        if path == "/api/config":
            self._send_json(load_config())
            return

        # Overall summary statistics
        if path == "/api/stats":
            self._send_json(engine.get_summary_stats())
            return

        # Available cities
        if path == "/api/cities":
            self._send_json(engine.get_city_list())
            return

        # ATMs query
        if path == "/api/atms":
            city = qp("city")
            bank = qp("bank")
            results = engine.atms
            if city:
                results = [a for a in results if a["city"].lower() == city.lower()]
            if bank:
                results = [a for a in results if a["bank"].lower() == bank.lower()]
            self._send_json(results)
            return

        # Complaints query
        if path == "/api/complaints":
            city = qp("city")
            c_type = qp("complaint_type")
            from_date = parse_iso_or_custom_datetime(qp("from", ""))
            to_date = parse_iso_or_custom_datetime(qp("to", ""))
            w_only = qp("withdrawal_only", "false").lower() in ("true", "1", "yes")

            results = engine.complaints
            if city:
                results = [c for c in results if c["city"].lower() == city.lower()]
            if c_type:
                results = [c for c in results if c["complaint_type"].lower() == c_type.lower()]
            if w_only:
                results = [c for c in results if c["withdrawal_flag"]]
            if from_date:
                results = [c for c in results if c["dt"] and c["dt"] >= from_date]
            if to_date:
                results = [c for c in results if c["dt"] and c["dt"] <= to_date]

            sanitized = []
            for c in results:
                sanitized.append({
                    "complaint_id": c["complaint_id"],
                    "timestamp": c["timestamp"],
                    "city": c["city"],
                    "complaint_type": c["complaint_type"],
                    "phone_hash": c["phone_hash"],
                    "bank_ref": c["bank_ref"],
                    "description": c["description"],
                    "lat": c["lat"],
                    "lon": c["lon"],
                    "withdrawal_flag": c["withdrawal_flag"],
                    "withdrawal_atm_id": c["withdrawal_atm_id"],
                    "withdrawal_time": c["withdrawal_time"]
                })
            self._send_json(sanitized)
            return

        # Transactions query endpoint
        if path == "/api/transactions":
            city = qp("city")
            atm_id = qp("atm_id")
            phone_hash = qp("phone_hash")
            bank = qp("bank")
            tx_type = qp("transaction_type")
            channel = qp("channel")
            fraud_only = qp("fraud_only", "false").lower() in ("true", "1", "yes")
            limit = int(qp("limit", "200"))

            results = engine.transactions
            if city:
                results = [t for t in results if t["city"].lower() == city.lower()]
            if atm_id:
                results = [t for t in results if t["atm_id"] and t["atm_id"].lower() == atm_id.lower()]
            if phone_hash:
                results = [t for t in results if t["phone_hash"].lower() == phone_hash.lower()]
            if bank:
                results = [t for t in results if t["bank"].lower() == bank.lower()]
            if tx_type:
                results = [t for t in results if t["transaction_type"].lower() == tx_type.lower()]
            if channel:
                results = [t for t in results if t["channel"].lower() == channel.lower()]
            if fraud_only:
                results = [t for t in results if t["fraud_label"]]

            # Format for frontend response
            out = []
            for t in results[:limit]:
                out.append({
                    "transaction_id": t["transaction_id"],
                    "timestamp": t["timestamp"],
                    "phone_hash": t["phone_hash"],
                    "bank": t["bank"],
                    "account_id": t["account_id"],
                    "transaction_type": t["transaction_type"],
                    "amount": t["amount"],
                    "direction": t["direction"],
                    "beneficiary_merchant": t["beneficiary_merchant"],
                    "atm_id": t["atm_id"],
                    "city": t["city"],
                    "channel": t["channel"],
                    "fraud_label": t["fraud_label"]
                })
            self._send_json(out)
            return

        # Risk scores calculation endpoint
        if path == "/api/risk-scores":
            city = qp("city")
            radius_km = float(qp("radius_km", "3.0"))
            window_str = qp("window_hours")
            window_hours = int(window_str) if window_str and window_str.isdigit() else None
            min_score = float(qp("min_score", "0.0"))
            risk_level = qp("risk_level")
            bank = qp("bank")

            scores = engine.compute_atm_risk_scores(
                city=city,
                radius_km=radius_km,
                window_hours=window_hours
            )

            if min_score > 0.0:
                scores = [s for s in scores if s["risk_score"] >= min_score]
            if risk_level:
                scores = [s for s in scores if s["risk_level"].lower() == risk_level.lower()]
            if bank:
                scores = [s for s in scores if s["bank"].lower() == bank.lower()]

            self._send_json(scores)
            return

        # ATM forensic drilldown details endpoint: /api/atm/{atm_id}/details
        if path.startswith("/api/atm/") and path.endswith("/details"):
            parts = path.split("/")
            if len(parts) >= 4:
                atm_id = parts[3]
                radius_km = float(qp("radius_km", "3.0"))
                details = engine.get_atm_forensic_details(atm_id, radius_km=radius_km)
                if details:
                    self._send_json(details)
                else:
                    self._send_json({"error": f"ATM with id '{atm_id}' not found."}, status_code=404)
                return

        # Alerts audit list endpoint
        if path == "/api/alerts":
            alerts = load_alerts()
            self._send_json(alerts)
            return

        # Serve static assets
        return super().do_GET()

    def do_POST(self):
        """Route POST requests (Alert dispatch and Config updates)."""
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path

        # Map API Keys and Configuration update endpoint
        if path == "/api/config":
            content_length = int(self.headers.get("Content-Length", 0))
            body_bytes = self.rfile.read(content_length)
            try:
                payload = json.loads(body_bytes.decode("utf-8")) if body_bytes else {}
            except Exception:
                self._send_json({"error": "Invalid JSON in request body."}, status_code=400)
                return
            save_config(payload)
            self._send_json({"status": "updated", "config": load_config()})
            return

        if path == "/api/alerts" or path == "/alerts":
            content_length = int(self.headers.get("Content-Length", 0))
            body_bytes = self.rfile.read(content_length)
            try:
                payload = json.loads(body_bytes.decode("utf-8")) if body_bytes else {}
            except Exception:
                self._send_json({"error": "Invalid JSON in request body."}, status_code=400)
                return

            atm_id = payload.get("atm_id", "").strip()
            recipient_type = payload.get("recipient_type", "LEA").strip()
            recipient_id = payload.get("recipient_id", "STATION_CENTRAL").strip()
            channel = payload.get("channel", "SMS & Webhook Dispatch").strip()
            custom_note = payload.get("custom_note", "").strip()

            if not atm_id:
                self._send_json({"error": "Missing required field 'atm_id'."}, status_code=400)
                return

            details = engine.get_atm_forensic_details(atm_id)
            if not details:
                self._send_json({"error": f"ATM '{atm_id}' not found."}, status_code=404)
                return

            atm = details["atm"]
            risk_score = details["risk_score"]
            risk_level = details["risk_level"]
            complaint_count = details["total_complaints_in_radius"]
            direct_tx_count = details["total_direct_transactions"]

            alert_id = f"ALT-{datetime.now().strftime('%Y%m%d')}-{len(load_alerts()) + 1:04d}"
            timestamp = datetime.now().isoformat()
            
            mock_message = (
                f"[{risk_level.upper()} ALERT] Cybercrime Cash-Withdrawal Threat Detected!\n"
                f"Location: {atm['bank']} ATM ({atm['atm_id']}), {atm['city']} (Lat: {atm['lat']}, Lon: {atm['lon']}).\n"
                f"Risk Score: {risk_score} | Cluster: {complaint_count} cybercrime complaints within 3km.\n"
                f"ATM Ledger: {direct_tx_count} recorded ATM transactions.\n"
                f"Recipient: {recipient_type} ({recipient_id}) via {channel}.\n"
                f"Recommended Action: Deploy patrol unit for ATM visual check & alert {atm['bank']} Fraud Desk."
            )
            if custom_note:
                mock_message += f"\nOfficer Note: {custom_note}"

            alert_record = {
                "alert_id": alert_id,
                "timestamp": timestamp,
                "atm_id": atm_id,
                "bank": atm["bank"],
                "city": atm["city"],
                "lat": atm["lat"],
                "lon": atm["lon"],
                "risk_score": risk_score,
                "risk_level": risk_level,
                "recipient_type": recipient_type,
                "recipient_id": recipient_id,
                "channel": channel,
                "custom_note": custom_note,
                "status": "DISPATCHED",
                "mock_message": mock_message
            }

            save_alert(alert_record)

            self._send_json({
                "alert_id": alert_id,
                "status": "sent",
                "timestamp": timestamp,
                "mock_message": mock_message,
                "record": alert_record
            }, status_code=201)
            return

        self._send_json({"error": "Endpoint not found."}, status_code=404)


def run_server(port: int = PORT):
    """Start the HTTP server on specified port."""
    server_address = ("", port)
    httpd = http.server.HTTPServer(server_address, HotspotAPIRequestHandler)
    print(f"[ONLINE] Cybercrime Hotspot Predictive Engine (v2.0) running at http://localhost:{port}")
    print(f"[STATIC] Serving UI from: {STATIC_DIR}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server...")
        httpd.server_close()


if __name__ == "__main__":
    run_server()
