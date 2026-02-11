import React, { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";
import { useI18n } from "../contexts/I18nContext";
import { QRCodeSVG } from "qrcode.react";

const SUPABASE_FUNCTIONS_URL = import.meta.env.VITE_SUPABASE_FUNCTIONS_URL || `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

export function PaymentCallbackPage({ user, onNavigate }) {
  const { t } = useI18n();
  const [status, setStatus] = useState("polling"); // polling, success, failed, timeout
  const [bookingData, setBookingData] = useState(null);
  const pollCount = useRef(0);
  const maxPolls = 30; // 30 * 2s = 60s

  const urlParams = new URLSearchParams(window.location.search);
  const ref = urlParams.get("ref");

  useEffect(() => {
    if (!ref || !user) return;

    const pollStatus = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;

        const res = await fetch(
          `${SUPABASE_FUNCTIONS_URL}/vipps-payment?action=status&ref=${encodeURIComponent(ref)}`,
          {
            headers: {
              "Authorization": `Bearer ${session.access_token}`,
              "Content-Type": "application/json",
            },
          }
        );

        if (!res.ok) {
          setStatus("failed");
          return;
        }

        const data = await res.json();

        if (data.status === "completed" && data.booking_status === "confirmed") {
          setStatus("success");
          setBookingData(data);
          return;
        }

        if (data.status === "cancelled" || data.booking_status === "cancelled") {
          setStatus("failed");
          return;
        }

        // Still pending — poll again
        pollCount.current += 1;
        if (pollCount.current >= maxPolls) {
          setStatus("timeout");
          return;
        }
      } catch {
        pollCount.current += 1;
        if (pollCount.current >= maxPolls) {
          setStatus("timeout");
        }
      }
    };

    pollStatus();
    const interval = setInterval(pollStatus, 2000);
    return () => clearInterval(interval);
  }, [ref, user]);

  if (!user) {
    onNavigate("login");
    return null;
  }

  if (!ref) {
    return (
      <div className="container">
        <div className="payment-status payment-error">
          <p>{t("booking.paymentError")}</p>
          <button className="btn btn-primary" onClick={() => onNavigate("venues")}>
            {t("nav.venues")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="payment-status">
        {status === "polling" && (
          <div className="payment-status-polling">
            <div className="spinner-large" />
            <h2>{t("booking.waitingPayment")}</h2>
            <p>{t("booking.waitingPaymentDesc")}</p>
          </div>
        )}

        {status === "success" && bookingData && (
          <div className="payment-status-success">
            <div className="payment-success-icon">&#10003;</div>
            <h2>{t("booking.success")}</h2>
            <p>{t("booking.yourTicket")}</p>
            {bookingData.qr_token && (
              <div className="booking-ticket-qr" style={{ marginTop: 20 }}>
                <QRCodeSVG
                  value={`${window.location.origin}/venue/0/scan?token=${bookingData.qr_token}`}
                  size={200}
                />
              </div>
            )}
            <button
              className="btn btn-primary"
              style={{ marginTop: 20 }}
              onClick={() => onNavigate("my-tickets")}
            >
              {t("nav.myTickets")}
            </button>
          </div>
        )}

        {status === "failed" && (
          <div className="payment-status-failed">
            <div className="payment-failed-icon">&#10007;</div>
            <h2>{t("booking.paymentFailed")}</h2>
            <p>{t("booking.paymentFailedDesc")}</p>
            <button className="btn btn-primary" style={{ marginTop: 20 }} onClick={() => onNavigate("venues")}>
              {t("nav.venues")}
            </button>
          </div>
        )}

        {status === "timeout" && (
          <div className="payment-status-failed">
            <h2>{t("booking.paymentTimeout")}</h2>
            <p>{t("booking.paymentTimeoutDesc")}</p>
            <button className="btn btn-primary" style={{ marginTop: 20 }} onClick={() => onNavigate("my-tickets")}>
              {t("nav.myTickets")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
