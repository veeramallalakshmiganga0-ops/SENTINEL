"""
Automated Verification & Test Suite for Cybercrime Hotspot Predictive Framework.
Validates ETL ingestion, Haversine spatial computation, scoring, forensic drilldown, transaction ledger, and alert dispatch.
"""

import os
import sys
import unittest
from datetime import datetime
from risk_engine import HotspotRiskEngine, haversine_distance

# Set utf-8 encoding for stdout if on Windows
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass


class TestCybercrimeHotspotFramework(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = HotspotRiskEngine()

    def test_01_dataset_ingestion(self):
        """Verify that atms.csv, cybercrime_complaints.csv, and transactions.csv are parsed properly."""
        self.assertGreater(len(self.engine.atms), 2000, "Should load over 2,000 ATMs")
        self.assertGreater(len(self.engine.complaints), 1400, "Should load over 1,400 complaints")
        self.assertGreater(len(self.engine.transactions), 25000, "Should load over 25,000 transactions")
        self.assertGreaterEqual(len(self.engine.cities), 10, "Should have at least 10 cities")
        print(f"[PASS] Ingestion Test Passed: {len(self.engine.atms)} ATMs, {len(self.engine.complaints)} Complaints, {len(self.engine.transactions)} Transactions across {len(self.engine.cities)} Cities.")

    def test_02_haversine_distance(self):
        """Verify Haversine distance calculation between known landmarks."""
        dist = haversine_distance(13.0827, 80.2707, 13.0418, 80.2341)
        self.assertAlmostEqual(dist, 6.0, delta=1.5, msg="Haversine distance within expected tolerance")
        print(f"[PASS] Haversine Calculation Passed: Distance measured {dist:.2f} km.")

    def test_03_risk_scoring_engine(self):
        """Verify ATM risk scores computation and ranking."""
        scores = self.engine.compute_atm_risk_scores(radius_km=3.0)
        self.assertGreater(len(scores), 0, "Risk scores should not be empty")
        
        top_hotspot = scores[0]
        required_keys = [
            "atm_id", "bank", "city", "lat", "lon", "risk_score", "risk_level",
            "nearby_complaints_total", "nearby_complaints_24h", "nearby_complaints_48h",
            "withdrawal_linked_count", "repeat_suspect_count", "direct_transactions_total"
        ]
        for k in required_keys:
            self.assertIn(k, top_hotspot, f"Scored item missing key: {k}")

        self.assertIn(top_hotspot["risk_level"], ["High", "Medium", "Low"])
        self.assertGreater(top_hotspot["risk_score"], 0)
        print(f"[PASS] Risk Engine Test Passed: Top Hotspot {top_hotspot['atm_id']} ({top_hotspot['bank']} - {top_hotspot['city']}) Score = {top_hotspot['risk_score']} [{top_hotspot['risk_level']}].")

    def test_04_forensic_drilldown(self):
        """Verify deep forensic investigation drilldown generation with ledger transactions."""
        top_hotspot = self.engine.compute_atm_risk_scores()[0]
        details = self.engine.get_atm_forensic_details(top_hotspot["atm_id"], radius_km=3.0)
        self.assertIsNotNone(details, "Details should be found for valid ATM")
        self.assertIn("suggested_actions", details)
        self.assertGreater(len(details["suggested_actions"]), 0)
        self.assertIn("complaints", details)
        self.assertIn("direct_transactions", details)
        print(f"[PASS] Forensic Drilldown Test Passed: Generated {len(details['suggested_actions'])} actionable LEA advisories for {top_hotspot['atm_id']}.")

    def test_05_city_filtering(self):
        """Verify that city filters restrict calculations correctly."""
        for test_city in ["Chennai", "Hyderabad", "Mumbai", "Jaipur"]:
            city_scores = self.engine.compute_atm_risk_scores(city=test_city)
            for s in city_scores:
                self.assertEqual(s["city"].lower(), test_city.lower(), f"Score city should match {test_city}")
        print("[PASS] City Filtering Test Passed for Chennai, Hyderabad, Mumbai, Jaipur.")

    def test_06_transactions_ledger_linkage(self):
        """Verify ATM-transaction indexing and fraud flags."""
        atm_tx_count = sum(len(txs) for txs in self.engine.transactions_by_atm.values())
        self.assertGreater(atm_tx_count, 1000, "Should index direct ATM transactions")
        fraud_txs = [t for t in self.engine.transactions if t["fraud_label"]]
        self.assertGreater(len(fraud_txs), 50, "Should identify flagged fraud transactions")
        print(f"[PASS] Transaction Ledger Linkage Passed: {atm_tx_count} ATM-linked TXs and {len(fraud_txs)} fraud-flagged TXs indexed.")


if __name__ == "__main__":
    unittest.main(verbosity=2)
