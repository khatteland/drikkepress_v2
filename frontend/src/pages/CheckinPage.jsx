import React, { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../lib/supabase";
import { useI18n } from "../contexts/I18nContext";
import { Avatar } from "../components/shared";
import { Html5Qrcode } from "html5-qrcode";

export function CheckinPage({ eventId, user, onNavigate }) {
  const { t } = useI18n();
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState(null);
  const [checkinData, setCheckinData] = useState(null);
  const [eventTitle, setEventTitle] = useState("");
  const scannerRef = useRef(null);
  const html5QrRef = useRef(null);

  const loadCheckinList = useCallback(async () => {
    const { data } = await supabase.rpc("get_checkin_list", { p_event_id: eventId });
    if (data && data.status === "success") setCheckinData(data);
  }, [eventId]);

  useEffect(() => {
    supabase.rpc("get_event_detail", { p_event_id: eventId }).then(({ data }) => {
      if (data) setEventTitle(data.title);
      if (data && !data.is_admin) onNavigate("event-detail", { eventId });
    });
    loadCheckinList();
  }, [eventId, user, onNavigate, loadCheckinList]);

  // Auto-refresh checkin list every 5 seconds
  useEffect(() => {
    const interval = setInterval(loadCheckinList, 5000);
    return () => clearInterval(interval);
  }, [loadCheckinList]);

  const handleScan = async (decodedText) => {
    try {
      const url = new URL(decodedText);
      const tokenParam = url.searchParams.get("token");
      if (!tokenParam) { setResult({ status: "error", code: "invalid_token" }); return; }

      const { data } = await supabase.rpc("checkin_by_qr_token", { p_event_id: eventId, p_qr_token: tokenParam });
      setResult(data);
      loadCheckinList();
    } catch {
      setResult({ status: "error", code: "invalid_token" });
    }
  };

  const startScanning = async () => {
    if (!scannerRef.current) return;
    setResult(null);
    const html5Qr = new Html5Qrcode(scannerRef.current.id);
    html5QrRef.current = html5Qr;
    try {
      await html5Qr.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
          handleScan(decodedText);
        },
        () => {}
      );
      setScanning(true);
    } catch (err) {
      console.error("Scanner error:", err);
    }
  };

  const stopScanning = async () => {
    if (html5QrRef.current) {
      try { await html5QrRef.current.stop(); } catch {}
      html5QrRef.current = null;
    }
    setScanning(false);
  };

  // Cleanup on unmount
  useEffect(() => { return () => { if (html5QrRef.current) { try { html5QrRef.current.stop(); } catch {} } }; }, []);

  const getResultMessage = () => {
    if (!result) return null;
    if (result.status === "success") return { className: "success", icon: "\u2705", text: t("qr.scanSuccess"), name: result.user_name };
    if (result.status === "already") return { className: "already", icon: "\u26a0\ufe0f", text: t("qr.scanAlready"), name: result.user_name };
    if (result.code === "kicked") return { className: "error", icon: "\u274c", text: t("qr.scanKicked") };
    return { className: "error", icon: "\u274c", text: t("qr.scanInvalid") };
  };

  const resultMsg = getResultMessage();

  return (
    <div className="container">
      <div className="checkin-page">
        <button className="back-button" onClick={() => onNavigate("event-detail", { eventId })}>
          ← {eventTitle}
        </button>
        <h1>{t("qr.scanTitle")}</h1>

        <div className="checkin-scanner">
          <div id="checkin-reader" ref={scannerRef} className="checkin-scanner-reader" />
          <div style={{ display: "flex", gap: 8 }}>
            {!scanning ? (
              <button className="btn btn-primary" onClick={startScanning}>{t("qr.openScanner")}</button>
            ) : (
              <button className="btn btn-danger" onClick={stopScanning}>{t("qr.stopScanning")}</button>
            )}
          </div>
        </div>

        {resultMsg && (
          <div className={`checkin-result ${resultMsg.className}`}>
            <span className="checkin-result-icon">{resultMsg.icon}</span>
            <div className="checkin-result-info">
              <strong>{resultMsg.text}</strong>
              {resultMsg.name && <span>{resultMsg.name}</span>}
            </div>
          </div>
        )}

        {checkinData && (
          <div className="checkin-list">
            <h3>{t("qr.checkinList")}</h3>
            <div className="checkin-list-stats">
              <strong>{checkinData.total_checked_in}</strong> {t("qr.checkedInCount")} {t("qr.of")} <strong>{checkinData.total_going}</strong>
            </div>
            {checkinData.total_going > 0 && (
              <div className="checkin-progress-bar">
                <div className="checkin-progress-fill" style={{ width: `${(checkinData.total_checked_in / checkinData.total_going) * 100}%` }} />
              </div>
            )}
            {(checkinData.attendees || []).map((a) => (
              <div key={a.user_id} className="checkin-attendee">
                <Avatar name={a.name} avatarUrl={a.avatar_url} size={32} />
                <div className="checkin-attendee-info">{a.name}</div>
                <span className={`checkin-attendee-status ${a.checked_in_at ? "checked-in" : "not-checked-in"}`}>
                  {a.checked_in_at ? t("qr.checkedIn") : t("qr.notCheckedIn")}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
