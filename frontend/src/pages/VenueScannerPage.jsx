import React, { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";
import { useI18n } from "../contexts/I18nContext";
import { Html5Qrcode } from "html5-qrcode";

export function VenueScannerPage({ venueId, user, onNavigate }) {
  const { t } = useI18n();
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState(null);
  const [checkinDone, setCheckinDone] = useState(false);
  const [scannerError, setScannerError] = useState(null);
  const scannerRef = useRef(null);
  const html5QrRef = useRef(null);

  const handleScan = async (decodedText) => {
    try {
      const url = new URL(decodedText);
      const tokenParam = url.searchParams.get("token");
      if (!tokenParam) { setScanResult({ status: "error", code: "invalid_ticket" }); return; }

      const { data } = await supabase.rpc("verify_queue_ticket", { p_venue_id: venueId, p_qr_token: tokenParam });
      setScanResult(data);
      setCheckinDone(false);
      // Stop scanning after reading
      if (html5QrRef.current) {
        try { await html5QrRef.current.stop(); } catch {}
        html5QrRef.current = null;
      }
      setScanning(false);
    } catch {
      setScanResult({ status: "error", code: "invalid_ticket" });
    }
  };

  const startScanning = async () => {
    if (!scannerRef.current) return;
    setScanResult(null);
    setCheckinDone(false);
    setScannerError(null);
    const html5Qr = new Html5Qrcode(scannerRef.current.id);
    html5QrRef.current = html5Qr;
    try {
      await html5Qr.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => { handleScan(decodedText); },
        () => {}
      );
      setScanning(true);
    } catch (err) {
      console.error("Scanner error:", err);
      html5QrRef.current = null;
      if (err?.toString().includes("NotAllowedError") || err?.toString().includes("Permission")) {
        setScannerError(t("scanner.cameraPermission"));
      } else if (err?.toString().includes("NotFoundError") || err?.toString().includes("no camera")) {
        setScannerError(t("scanner.noCamera"));
      } else {
        setScannerError(t("scanner.cameraError"));
      }
    }
  };

  const stopScanning = async () => {
    if (html5QrRef.current) {
      try { await html5QrRef.current.stop(); } catch {}
      html5QrRef.current = null;
    }
    setScanning(false);
  };

  const handleCheckin = async () => {
    if (!scanResult || !scanResult.booking_id) return;
    const { data } = await supabase.rpc("checkin_queue_ticket", { p_booking_id: scanResult.booking_id });
    if (data && data.status === "success") {
      setCheckinDone(true);
    } else if (data && data.code === "already_checked_in") {
      setCheckinDone(true);
    }
  };

  useEffect(() => {
    return () => {
      if (html5QrRef.current) {
        try { html5QrRef.current.stop(); } catch {}
      }
    };
  }, []);

  return (
    <div className="venue-scanner">
      <button className="back-button" onClick={() => onNavigate("venue-manage", { venueId })}>{t("detail.back")}</button>
      <h1>{t("scanner.title")}</h1>

      <div ref={scannerRef} id="venue-qr-reader" style={{ marginBottom: 16 }} />

      {scannerError && (
        <div className="scan-result-card invalid" style={{ marginBottom: 16 }}>
          <div className="scan-result-status error">{scannerError}</div>
          <p style={{ marginTop: 8, fontSize: 14, opacity: 0.8 }}>{t("scanner.cameraHint")}</p>
        </div>
      )}

      {!scanning ? (
        <button className="btn btn-primary" onClick={startScanning}>{t("scanner.scan")}</button>
      ) : (
        <button className="btn btn-secondary" onClick={stopScanning}>{t("scanner.stop")}</button>
      )}

      {scanResult && scanResult.status === "success" && !checkinDone && (
        <div className="scan-result-card valid">
          <div className="scan-result-status success">✓ {t("scanner.verify")}</div>
          <p><strong>{t("scanner.guestName")}:</strong> {scanResult.user_name}</p>
          <p><strong>{t("scanner.timeslot")}:</strong> {scanResult.date} {scanResult.start_time?.slice(0, 5)}–{scanResult.end_time?.slice(0, 5)}</p>
          <p><strong>{t("scanner.status")}:</strong> {scanResult.booking_status === "checked_in" ? t("scanner.alreadyCheckedIn") : scanResult.booking_status}</p>
          {scanResult.booking_status === "confirmed" && (
            <button className="btn btn-primary" style={{ marginTop: 16, width: "100%" }} onClick={handleCheckin}>
              {t("scanner.confirmCheckin")}
            </button>
          )}
          {scanResult.booking_status === "checked_in" && (
            <div className="scan-result-status warning" style={{ marginTop: 12 }}>⚠️ {t("scanner.alreadyCheckedIn")}</div>
          )}
        </div>
      )}

      {scanResult && scanResult.status === "success" && checkinDone && (
        <div className="scan-result-card valid">
          <div className="scan-result-status success">✓ {t("scanner.success")}</div>
          <p><strong>{scanResult.user_name}</strong></p>
          <button className="btn btn-primary" style={{ marginTop: 16, width: "100%" }} onClick={() => { setScanResult(null); setCheckinDone(false); }}>
            {t("scanner.scan")}
          </button>
        </div>
      )}

      {scanResult && scanResult.status === "error" && (
        <div className="scan-result-card invalid">
          <div className="scan-result-status error">✗ {scanResult.code === "not_staff" ? t("scanner.notStaff") : t("scanner.invalidTicket")}</div>
        </div>
      )}
    </div>
  );
}
