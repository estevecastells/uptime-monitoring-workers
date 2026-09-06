export type Env = {
  DB: D1Database;
  CLOUDFLARE_API_KEY?: string;
  CLOUDFLARE_EMAIL?: string;
  TELEGRAM: string;
  RESEND: string;
  ALERT_EMAIL: string;
  UPTIME_TOKEN?: string;
  // Cloudflare Access (Zero Trust). Both are required for the dashboard to
  // serve anything — see src/auth/access.ts.
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
};

export type CfAuthType = 'global_key' | 'token';

export interface CfAccount {
  id: number;
  name: string;
  email: string;
  auth_type: CfAuthType;
  api_key: string;
  is_active: number;
  created_at: string;
}

export interface Monitor {
  id: number;
  url: string;
  name: string;
  source: 'auto' | 'manual';
  is_active: number;
  created_at: string;
  updated_at: string;
  notify_email: number;
  notify_telegram: number;
  current_status: number | null;
  last_response_ms: number | null;
  last_status_code: number | null;
  last_error: string | null;
  last_checked_at: string | null;
  last_logged_at: string | null;
  last_status_change_at: string | null;
  consecutive_downs: number;
}

export interface CheckOutcome {
  stateChanged: boolean;
  consecutiveDowns: number;
  previousStatus: number | null;
}

export interface Check {
  id: number;
  monitor_id: number;
  status_code: number | null;
  response_ms: number | null;
  is_up: number;
  error: string | null;
  checked_at: string;
}

export interface Incident {
  id: number;
  monitor_id: number;
  started_at: string;
  resolved_at: string | null;
  notified_down: number;
  notified_up: number;
}

export interface MonitorStats {
  id: number;
  url: string;
  name: string;
  is_active: number;
  source: string;
  up_24h: number;
  total_24h: number;
  last_response_ms: number | null;
  current_status: number | null;
}
