import React, { useState } from "react";
import { supabase } from "../lib/supabase";
import { useI18n } from "../contexts/I18nContext";

const SUPABASE_FUNCTIONS_URL = import.meta.env.VITE_SUPABASE_FUNCTIONS_URL || `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

function VippsLoginButton({ t }) {
  const [loading, setLoading] = useState(false);

  const handleVippsLogin = () => {
    setLoading(true);
    const returnTo = "/discover";
    window.location.href = `${SUPABASE_FUNCTIONS_URL}/vipps-auth?action=init&return_to=${encodeURIComponent(returnTo)}`;
  };

  return (
    <div className="vipps-section">
      <button
        className="vipps-btn"
        onClick={handleVippsLogin}
        disabled={loading}
      >
        {loading ? (
          <><span className="spinner" />{t("auth.submitting")}</>
        ) : (
          <>{t("auth.vippsLogin")}</>
        )}
      </button>
      <p className="vipps-login-hint">{t("auth.vippsHint")}</p>
    </div>
  );
}

function SocialLoginButtons({ t }) {
  const [loading, setLoading] = useState(null);

  const handleSocial = async (provider) => {
    setLoading(provider);
    await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin },
    });
  };

  return (
    <div className="social-login">
      <div className="social-divider"><span>{t("auth.orSocial")}</span></div>
      <div className="social-buttons">
        <button className="social-btn google" onClick={() => handleSocial("google")} disabled={!!loading}>
          <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A11.96 11.96 0 0 0 1 12c0 1.94.46 3.77 1.18 5.07l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
          Google
        </button>
      </div>
      {loading && <div className="social-loading">{t("auth.submitting")}</div>}
    </div>
  );
}

export function LoginPage({ onNavigate }) {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Check for error from Vipps callback
  const urlParams = new URLSearchParams(window.location.search);
  const authError = urlParams.get("error");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    if (err) { setError(err.message); setSubmitting(false); return; }
    onNavigate("discover");
  };

  return (
    <div className="container">
      <div className="form-page">
        <div className="form-card">
          <h2>{t("auth.loginTitle")}</h2>
          {authError && <div className="form-error">{t("auth.vippsError")}</div>}

          <VippsLoginButton t={t} />

          <div className="social-divider"><span>{t("auth.orEmail")}</span></div>

          {error && <div className="form-error">{error}</div>}
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>{t("auth.email")}</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("auth.emailPlaceholder")} />
            </div>
            <div className="form-group">
              <label>{t("auth.password")}</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t("auth.passwordPlaceholder")} />
            </div>
            <button className="btn btn-primary btn-full" type="submit" disabled={submitting}>
              {submitting ? <><span className="spinner" />{t("auth.submitting")}</> : t("auth.loginSubmit")}
            </button>
          </form>
          <SocialLoginButtons t={t} />
          <p style={{ textAlign: "center", marginTop: 16, fontSize: 14, color: "#888" }}>
            {t("auth.noAccount")}{" "}
            <button className="link-button" onClick={() => onNavigate("register")}>{t("nav.register")}</button>
          </p>
        </div>
      </div>
    </div>
  );
}

export function RegisterPage({ onNavigate }) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (!name || !email || !password) { setError(t("auth.fillAll")); return; }
    setSubmitting(true);
    const { error: err } = await supabase.auth.signUp({
      email, password,
      options: { data: { name } },
    });
    if (err) { setError(err.message); setSubmitting(false); return; }
    onNavigate("discover");
  };

  return (
    <div className="container">
      <div className="form-page">
        <div className="form-card">
          <h2>{t("auth.registerTitle")}</h2>

          <VippsLoginButton t={t} />

          <div className="social-divider"><span>{t("auth.orEmail")}</span></div>

          {error && <div className="form-error">{error}</div>}
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>{t("auth.name")}</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("auth.namePlaceholder")} />
            </div>
            <div className="form-group">
              <label>{t("auth.email")}</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("auth.emailPlaceholder")} />
            </div>
            <div className="form-group">
              <label>{t("auth.password")}</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t("auth.passwordPlaceholder")} />
            </div>
            <button className="btn btn-primary btn-full" type="submit" disabled={submitting}>
              {submitting ? <><span className="spinner" />{t("auth.submitting")}</> : t("auth.registerSubmit")}
            </button>
          </form>
          <SocialLoginButtons t={t} />
          <p style={{ textAlign: "center", marginTop: 16, fontSize: 14, color: "#888" }}>
            {t("auth.hasAccount")}{" "}
            <button className="link-button" onClick={() => onNavigate("login")}>{t("nav.login")}</button>
          </p>
        </div>
      </div>
    </div>
  );
}
