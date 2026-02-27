export type Env = {
  DB: D1Database;
  CLOUDFLARE_API_KEY: string;
  CLOUDFLARE_EMAIL: string;
  TELEGRAM: string;
  RESEND: string;
  DASHBOARD_PASSWORD: string;
  ALERT_EMAIL: string;
};

export interface Monitor {
  id: number;
  url: string;
  name: string;
  source: 'auto' | 'manual';
  is_active: number;
  created_at: string;
  updated_at: string;
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
