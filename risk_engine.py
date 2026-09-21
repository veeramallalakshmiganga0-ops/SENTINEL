"""
Spatiotemporal Feature & Risk Scoring Engine for Cybercrime Cash-Withdrawal Hotspots.
Processes atms.csv, cybercrime_complaints.csv, and transactions.csv to predict ATM risk levels.
"""

import csv
import json
import math
import os
import sys
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple, Any

# Configure standard output encoding for Windows
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

# Earth radius in kilometers for Haversine distance
EARTH_RADIUS_KM = 6371.0

def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Calculate the great circle distance in kilometers between two points
    on the earth (specified in decimal degrees).
    """
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = (math.sin(delta_phi / 2.0) ** 2 +
         math.cos(phi1) * math.cos(phi2) * (math.sin(delta_lambda / 2.0) ** 2))
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))

    return EARTH_RADIUS_KM * c


def parse_iso_or_custom_datetime(dt_str: str) -> Optional[datetime]:
    """Parse various timestamp formats gracefully."""
    if not dt_str or not dt_str.strip():
        return None
    dt_str = dt_str.strip()
    formats = [
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%dT%H:%M:%S%z",
        "%Y-%m-%d %H:%M",
        "%Y-%m-%d",
    ]
    for fmt in formats:
        try:
            return datetime.strptime(dt_str.split("+")[0].split(".")[0], fmt)
        except ValueError:
            continue
    return None


class HotspotRiskEngine:
    def __init__(
        self,
        atms_file: str = "atms.csv",
        complaints_file: str = "cybercrime_complaints.csv",
        transactions_file: str = "transactions.csv"
    ):
        base_dir = os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else os.getcwd()
        self.atms_file = os.path.join(base_dir, atms_file) if not os.path.isabs(atms_file) else atms_file
        self.complaints_file = os.path.join(base_dir, complaints_file) if not os.path.isabs(complaints_file) else complaints_file
        self.transactions_file = os.path.join(base_dir, transactions_file) if not os.path.isabs(transactions_file) else transactions_file

        self.atms: List[Dict[str, Any]] = []
        self.complaints: List[Dict[str, Any]] = []
        self.transactions: List[Dict[str, Any]] = []
        
        # Fast lookup indexes
        self.transactions_by_atm: Dict[str, List[Dict[str, Any]]] = {}
        self.transactions_by_phone: Dict[str, List[Dict[str, Any]]] = {}
        
        self.cities: List[str] = []
        self.latest_complaint_time: Optional[datetime] = None
        self.earliest_complaint_time: Optional[datetime] = None
        
        self.load_data()

    def load_data(self) -> None:
        """Load and validate ATMs, Cybercrime Complaints, and Banking Transactions CSVs."""
        # 1. Load ATMs
        self.atms = []
        if os.path.exists(self.atms_file):
            with open(self.atms_file, mode="r", encoding="utf-8-sig") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    try:
                        atm_id = row.get("atm_id", "").strip()
                        bank = row.get("bank", "").strip()
                        city = row.get("city", "").strip()
                        lat = float(row.get("lat", 0.0))
                        lon = float(row.get("lon", 0.0))
                        if atm_id and lat != 0.0 and lon != 0.0:
                            self.atms.append({
                                "atm_id": atm_id,
                                "bank": bank,
                                "city": city,
                                "lat": lat,
                                "lon": lon
                            })
                    except (ValueError, KeyError):
                        continue

        # 2. Load Complaints
        self.complaints = []
        if os.path.exists(self.complaints_file):
            with open(self.complaints_file, mode="r", encoding="utf-8-sig") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    try:
                        cid = row.get("complaint_id", "").strip()
                        ts_raw = row.get("timestamp", "").strip()
                        dt = parse_iso_or_custom_datetime(ts_raw)
                        city = row.get("city", "").strip()
                        ctype = row.get("complaint_type", "").strip()
                        phash = row.get("phone_hash", "").strip()
                        bref = row.get("bank_ref", "").strip()
                        desc = row.get("description", "").strip()
                        lat = float(row.get("lat", 0.0))
                        lon = float(row.get("lon", 0.0))
                        w_flag = str(row.get("withdrawal_flag", "")).strip().lower() in ("yes", "true", "1")
                        w_atm = row.get("withdrawal_atm_id", "").strip() or None
                        w_time_raw = row.get("withdrawal_time", "").strip()
                        w_time = parse_iso_or_custom_datetime(w_time_raw)

                        if cid and lat != 0.0 and lon != 0.0:
                            self.complaints.append({
                                "complaint_id": cid,
                                "timestamp": ts_raw,
                                "dt": dt,
                                "city": city,
                                "complaint_type": ctype,
                                "phone_hash": phash,
                                "bank_ref": bref,
                                "description": desc,
                                "lat": lat,
                                "lon": lon,
                                "withdrawal_flag": w_flag,
                                "withdrawal_atm_id": w_atm,
                                "withdrawal_time": w_time_raw,
                                "withdrawal_dt": w_time
                            })
                            if dt:
                                if self.latest_complaint_time is None or dt > self.latest_complaint_time:
                                    self.latest_complaint_time = dt
                                if self.earliest_complaint_time is None or dt < self.earliest_complaint_time:
                                    self.earliest_complaint_time = dt
                    except (ValueError, KeyError):
                        continue

        # 3. Load Transactions
        self.transactions = []
        self.transactions_by_atm = {}
        self.transactions_by_phone = {}
        if os.path.exists(self.transactions_file):
            with open(self.transactions_file, mode="r", encoding="utf-8-sig") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    try:
                        tx_id = row.get("transaction_id", "").strip()
                        ts_raw = row.get("timestamp", "").strip()
                        dt = parse_iso_or_custom_datetime(ts_raw)
                        phash = row.get("phone_hash", "").strip()
                        bank = row.get("bank", "").strip()
                        acc_id = row.get("account_id", "").strip()
                        ttype = row.get("transaction_type", "").strip()
                        amt = float(row.get("amount", 0.0))
                        direction = row.get("direction", "").strip()
                        beneficiary = row.get("beneficiary_merchant", "").strip()
                        atm_id = row.get("atm_id", "").strip()
                        city = row.get("city", "").strip()
                        channel = row.get("channel", "").strip()
                        fraud_label = str(row.get("fraud_label", "")).strip().lower() in ("yes", "true", "1")

                        if tx_id:
                            tx_obj = {
                                "transaction_id": tx_id,
                                "timestamp": ts_raw,
                                "dt": dt,
                                "phone_hash": phash,
                                "bank": bank,
                                "account_id": acc_id,
                                "transaction_type": ttype,
                                "amount": amt,
                                "direction": direction,
                                "beneficiary_merchant": beneficiary,
                                "atm_id": atm_id if atm_id else None,
                                "city": city,
                                "channel": channel,
                                "fraud_label": fraud_label
                            }
                            self.transactions.append(tx_obj)
                            
                            # Fast index by ATM
                            if atm_id:
                                self.transactions_by_atm.setdefault(atm_id.lower(), []).append(tx_obj)
                            
                            # Fast index by phone hash
                            if phash:
                                self.transactions_by_phone.setdefault(phash.lower(), []).append(tx_obj)
                    except (ValueError, KeyError):
                        continue

        # Extract unique cities across all sets
        city_set = (
            set(a["city"] for a in self.atms if a["city"]) |
            set(c["city"] for c in self.complaints if c["city"]) |
            set(t["city"] for t in self.transactions if t["city"])
        )
        self.cities = sorted(list(city_set))

    def get_city_list(self) -> List[Dict[str, Any]]:
        """Return available cities with item counts."""
        result = []
        for city in self.cities:
            atm_count = sum(1 for a in self.atms if a["city"].lower() == city.lower())
            complaint_count = sum(1 for c in self.complaints if c["city"].lower() == city.lower())
            tx_count = sum(1 for t in self.transactions if t["city"].lower() == city.lower())
            result.append({
                "city": city,
                "atm_count": atm_count,
                "complaint_count": complaint_count,
                "transaction_count": tx_count
            })
        return sorted(result, key=lambda x: x["complaint_count"], reverse=True)

    def get_summary_stats(self) -> Dict[str, Any]:
        """Return overall dataset, complaint, and banking transaction statistics."""
        total_atms = len(self.atms)
        total_complaints = len(self.complaints)
        total_transactions = len(self.transactions)
        forced_withdrawals = sum(1 for c in self.complaints if c["withdrawal_flag"])
        fraud_transactions = sum(1 for t in self.transactions if t["fraud_label"])
        atm_withdrawals_tx = sum(1 for t in self.transactions if t["transaction_type"] == "ATM_WITHDRAWAL")
        cities_count = len(self.cities)
        
        # Fraud types breakdown
        types_count: Dict[str, int] = {}
        for c in self.complaints:
            t = c["complaint_type"] or "Unknown"
            types_count[t] = types_count.get(t, 0) + 1

        # Banks breakdown
        banks_count: Dict[str, int] = {}
        for a in self.atms:
            b = a["bank"] or "Other"
            banks_count[b] = banks_count.get(b, 0) + 1

        # Transaction types breakdown
        tx_types_count: Dict[str, int] = {}
        for t in self.transactions:
            tt = t["transaction_type"] or "Other"
            tx_types_count[tt] = tx_types_count.get(tt, 0) + 1

        return {
            "total_atms": total_atms,
            "total_complaints": total_complaints,
            "total_transactions": total_transactions,
            "forced_withdrawals": forced_withdrawals,
            "fraud_transactions": fraud_transactions,
            "atm_withdrawals_tx": atm_withdrawals_tx,
            "cities_count": cities_count,
            "earliest_date": self.earliest_complaint_time.isoformat() if self.earliest_complaint_time else None,
            "latest_date": self.latest_complaint_time.isoformat() if self.latest_complaint_time else None,
            "fraud_types": types_count,
            "bank_distribution": banks_count,
            "transaction_types": tx_types_count
        }

    def compute_atm_risk_scores(
        self,
        city: Optional[str] = None,
        radius_km: float = 3.0,
        reference_time: Optional[datetime] = None,
        window_hours: Optional[int] = None,
        use_all_time_if_no_recent: bool = True
    ) -> List[Dict[str, Any]]:
        """
        Compute spatiotemporal risk scores for ATMs incorporating complaint density,
        repeat suspect linkages, forced withdrawal history, and direct ATM transaction volume.
        """
        target_atms = [a for a in self.atms if not city or a["city"].lower() == city.lower()]
        target_complaints = [c for c in self.complaints if not city or c["city"].lower() == city.lower()]

        if not reference_time:
            city_complaints = [c for c in target_complaints if c["dt"] is not None]
            if city_complaints:
                reference_time = max(c["dt"] for c in city_complaints)
            else:
                reference_time = self.latest_complaint_time or datetime.now()

        w24_cutoff = reference_time - timedelta(hours=24)
        w48_cutoff = reference_time - timedelta(hours=48)
        w72_cutoff = reference_time - timedelta(hours=72)
        custom_cutoff = reference_time - timedelta(hours=window_hours) if window_hours else None

        scored_atms = []

        for atm in target_atms:
            lat_a, lon_a = atm["lat"], atm["lon"]
            atm_id_clean = atm["atm_id"].lower()
            
            # 1. Nearby complaints via Haversine
            nearby_complaints = []
            for c in target_complaints:
                dist = haversine_distance(lat_a, lon_a, c["lat"], c["lon"])
                if dist <= radius_km:
                    nearby_complaints.append((dist, c))

            nearby_complaints.sort(key=lambda x: x[0])

            c_total = len(nearby_complaints)
            c24 = 0
            c48 = 0
            c72 = 0
            c_custom = 0
            c_withdrawal = 0
            phone_hashes: Dict[str, int] = {}
            fraud_types: Dict[str, int] = {}
            related_ids = []

            for dist, c in nearby_complaints:
                dt = c["dt"]
                cid = c["complaint_id"]
                related_ids.append({
                    "complaint_id": cid,
                    "distance_km": round(dist, 2),
                    "complaint_type": c["complaint_type"],
                    "timestamp": c["timestamp"],
                    "phone_hash": c["phone_hash"],
                    "bank_ref": c["bank_ref"],
                    "withdrawal_flag": c["withdrawal_flag"],
                    "description": c["description"]
                })

                ft = c["complaint_type"] or "Unknown"
                fraud_types[ft] = fraud_types.get(ft, 0) + 1

                if c["phone_hash"]:
                    phone_hashes[c["phone_hash"]] = phone_hashes.get(c["phone_hash"], 0) + 1

                if c["withdrawal_flag"] or (c["withdrawal_atm_id"] and c["withdrawal_atm_id"].lower() == atm_id_clean):
                    c_withdrawal += 1

                if dt:
                    if dt >= w24_cutoff:
                        c24 += 1
                    elif dt >= w48_cutoff:
                        c48 += 1
                    elif dt >= w72_cutoff:
                        c72 += 1

                    if custom_cutoff and dt >= custom_cutoff:
                        c_custom += 1

            # 2. Check Direct ATM Banking Transactions & Fraud Flags
            direct_txs = self.transactions_by_atm.get(atm_id_clean, [])
            tx_total = len(direct_txs)
            tx_fraud_count = sum(1 for t in direct_txs if t["fraud_label"])
            tx_atm_withdrawal_count = sum(1 for t in direct_txs if t["transaction_type"] == "ATM_WITHDRAWAL")

            # 3. Check if any suspect phone hash from complaints transacted at this ATM
            linked_phone_txs = 0
            for ph in phone_hashes.keys():
                phone_txs = self.transactions_by_phone.get(ph.lower(), [])
                for ptx in phone_txs:
                    if ptx["atm_id"] and ptx["atm_id"].lower() == atm_id_clean:
                        linked_phone_txs += 1

            # Repeat suspect bonus: if multiple complaints have same phone hash
            repeat_suspect_bonus = sum(count - 1 for count in phone_hashes.values() if count > 1)

            # Compute raw score
            if window_hours:
                time_score = 1.0 * c_custom
            else:
                time_score = (1.0 * c24) + (0.6 * c48) + (0.3 * c72)

            baseline_spatial_weight = 0.5 * min(c_total, 20) if use_all_time_if_no_recent and time_score == 0 else 0

            # Direct banking ledger corroboration bonus
            banking_corroboration_score = (2.0 * tx_fraud_count) + (1.5 * linked_phone_txs) + (0.5 * min(tx_atm_withdrawal_count, 5))

            raw_score = time_score + (1.5 * c_withdrawal) + (1.0 * repeat_suspect_bonus) + baseline_spatial_weight + banking_corroboration_score

            # Risk level categorization
            if raw_score >= 7.0 or c24 >= 4 or (c_total >= 8 and c_withdrawal >= 2) or tx_fraud_count >= 2:
                risk_level = "High"
            elif raw_score >= 3.0 or c_total >= 3 or c_withdrawal >= 1 or tx_total >= 2:
                risk_level = "Medium"
            else:
                risk_level = "Low"

            top_suspects = [ph for ph, count in phone_hashes.items() if count > 1]

            scored_atms.append({
                "atm_id": atm["atm_id"],
                "bank": atm["bank"],
                "city": atm["city"],
                "lat": atm["lat"],
                "lon": atm["lon"],
                "risk_score": round(raw_score, 2),
                "risk_level": risk_level,
                "nearby_complaints_total": c_total,
                "nearby_complaints_24h": c24,
                "nearby_complaints_48h": c48,
                "nearby_complaints_72h": c72,
                "withdrawal_linked_count": c_withdrawal,
                "repeat_suspect_count": repeat_suspect_bonus,
                "direct_transactions_total": tx_total,
                "direct_fraud_transactions": tx_fraud_count,
                "linked_suspect_hashes": top_suspects,
                "dominant_fraud_types": sorted(fraud_types.items(), key=lambda x: x[1], reverse=True)[:3],
                "top_related_complaints": related_ids[:5],
                "all_related_complaints_count": len(related_ids),
                "reference_time": reference_time.isoformat() if reference_time else None
            })

        scored_atms.sort(key=lambda x: (x["risk_score"], x["nearby_complaints_total"]), reverse=True)
        return scored_atms

    def get_atm_forensic_details(self, atm_id: str, radius_km: float = 3.0) -> Optional[Dict[str, Any]]:
        """Get deep investigative drilldown for an ATM combining complaints + transaction ledger."""
        atm = next((a for a in self.atms if a["atm_id"].lower() == atm_id.lower()), None)
        if not atm:
            return None

        lat_a, lon_a = atm["lat"], atm["lon"]
        atm_id_clean = atm["atm_id"].lower()
        city = atm["city"]
        target_complaints = [c for c in self.complaints if c["city"].lower() == city.lower()]

        nearby = []
        phone_network: Dict[str, List[str]] = {}
        bank_victim_dist: Dict[str, int] = {}
        fraud_type_breakdown: Dict[str, int] = {}

        for c in target_complaints:
            dist = haversine_distance(lat_a, lon_a, c["lat"], c["lon"])
            if dist <= radius_km:
                c_item = {
                    "complaint_id": c["complaint_id"],
                    "timestamp": c["timestamp"],
                    "distance_km": round(dist, 2),
                    "complaint_type": c["complaint_type"],
                    "phone_hash": c["phone_hash"],
                    "bank_ref": c["bank_ref"],
                    "withdrawal_flag": c["withdrawal_flag"],
                    "withdrawal_atm_id": c["withdrawal_atm_id"],
                    "withdrawal_time": c["withdrawal_time"],
                    "description": c["description"]
                }
                nearby.append(c_item)

                if c["phone_hash"]:
                    phone_network.setdefault(c["phone_hash"], []).append(c["complaint_id"])

                b_prefix = c["bank_ref"][:4] if c["bank_ref"] else "OTHER"
                bank_victim_dist[b_prefix] = bank_victim_dist.get(b_prefix, 0) + 1

                ft = c["complaint_type"] or "Unknown"
                fraud_type_breakdown[ft] = fraud_type_breakdown.get(ft, 0) + 1

        nearby.sort(key=lambda x: x["distance_km"])

        # Fetch ATM ledger transactions
        direct_txs = self.transactions_by_atm.get(atm_id_clean, [])
        
        # Also fetch transactions for any suspect phone hash found in surrounding complaints
        mule_phone_txs = []
        for ph in phone_network.keys():
            pts = self.transactions_by_phone.get(ph.lower(), [])
            for pt in pts:
                mule_phone_txs.append(pt)

        # Dynamic score
        scores = self.compute_atm_risk_scores(city=city, radius_km=radius_km)
        scored_atm = next((s for s in scores if s["atm_id"].lower() == atm_id_clean), None)
        risk_score = scored_atm["risk_score"] if scored_atm else 0.0
        risk_level = scored_atm["risk_level"] if scored_atm else "Low"

        # Actionable intelligence advisory
        suggested_actions = [
            f"Dispatch LEA patrol unit to monitor {atm['bank']} ATM ({atm['atm_id']}) vicinity during peak withdrawal hours.",
            f"Notify {atm['bank']} Fraud & Vigilance Nodal Officer to monitor high-frequency cash withdrawal attempts.",
            f"Cross-reference {len(phone_network)} suspect phone hash cluster(s) with active telecom CDR / IMEI tracking."
        ]
        if any(t["fraud_label"] for t in direct_txs) or any(c["withdrawal_flag"] for c in nearby):
            suggested_actions.append("Critical: Review ATM CCTV footage matching known mule withdrawal timestamps.")
        if len(mule_phone_txs) > 0:
            suggested_actions.append(f"Freeze {len(set(t['account_id'] for t in mule_phone_txs))} beneficiary mule account(s) associated with suspect phone rings.")

        return {
            "atm": atm,
            "risk_score": risk_score,
            "risk_level": risk_level,
            "radius_km": radius_km,
            "total_complaints_in_radius": len(nearby),
            "total_direct_transactions": len(direct_txs),
            "direct_fraud_transactions": sum(1 for t in direct_txs if t["fraud_label"]),
            "fraud_type_breakdown": fraud_type_breakdown,
            "victim_bank_distribution": bank_victim_dist,
            "suspect_phone_clusters": {k: v for k, v in phone_network.items() if len(v) > 1},
            "suggested_actions": suggested_actions,
            "complaints": nearby,
            "direct_transactions": direct_txs[:20],
            "linked_mule_transactions": mule_phone_txs[:20]
        }


engine = HotspotRiskEngine()

if __name__ == "__main__":
    print("=" * 60)
    print("CYBERCRIME CASH-WITHDRAWAL HOTSPOT RISK SCORING ENGINE (v2.0)")
    print("=" * 60)
    stats = engine.get_summary_stats()
    print(f"Loaded {stats['total_atms']} ATMs across {stats['cities_count']} cities.")
    print(f"Loaded {stats['total_complaints']} Complaints (Forced withdrawals: {stats['forced_withdrawals']}).")
    print(f"Loaded {stats['total_transactions']} Transactions (ATM withdrawals: {stats['atm_withdrawals_tx']}, Flagged fraud: {stats['fraud_transactions']}).")
    print("-" * 60)
    print("Top 5 Risky ATMs overall:")
    scores = engine.compute_atm_risk_scores()
    for s in scores[:5]:
        print(f"[{s['risk_level']}] {s['atm_id']} ({s['bank']} - {s['city']}): Score {s['risk_score']} | Complaints (24h/48h/Total): {s['nearby_complaints_24h']}/{s['nearby_complaints_48h']}/{s['nearby_complaints_total']} | Direct TXs: {s['direct_transactions_total']}")
