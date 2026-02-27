export function layout(title: string, content: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — Uptime Monitor</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      background: #0a0a0a; color: #e5e5e5; line-height: 1.6;
    }
    a { color: #60a5fa; text-decoration: none; }
    a:hover { text-decoration: underline; }

    nav {
      background: #141414; border-bottom: 1px solid #262626;
      padding: 14px 24px; display: flex; align-items: center; gap: 24px;
    }
    nav .brand { font-weight: 700; font-size: 16px; color: #fff; }
    nav .links a { color: #a3a3a3; font-size: 14px; }
    nav .links a:hover { color: #fff; }
    nav .links { display: flex; gap: 16px; }

    .container { max-width: 960px; margin: 0 auto; padding: 24px 16px; }
    h1 { font-size: 22px; font-weight: 600; margin-bottom: 20px; color: #fff; }
    h2 { font-size: 18px; font-weight: 600; margin-bottom: 16px; color: #fff; }

    .card {
      background: #141414; border: 1px solid #262626; border-radius: 10px;
      padding: 16px 20px; margin-bottom: 12px; transition: border-color 0.15s;
    }
    .card:hover { border-color: #404040; }
    .card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    .card-header .name { font-weight: 600; color: #fff; font-size: 15px; }
    .card-header .url { color: #737373; font-size: 13px; margin-left: 8px; }
    .card-meta { display: flex; gap: 20px; font-size: 13px; color: #a3a3a3; margin-top: 8px; }

    .badge {
      display: inline-block; padding: 2px 10px; border-radius: 100px;
      font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;
    }
    .badge-up { background: #052e16; color: #4ade80; }
    .badge-down { background: #450a0a; color: #f87171; }
    .badge-unknown { background: #1c1917; color: #78716c; }
    .badge-auto { background: #172554; color: #60a5fa; }
    .badge-manual { background: #1e1b4b; color: #a78bfa; }

    .uptime-bar { display: flex; gap: 1px; height: 28px; margin: 8px 0; }
    .uptime-bar .seg {
      flex: 1; border-radius: 2px; min-width: 2px;
      transition: opacity 0.15s;
    }
    .uptime-bar .seg:hover { opacity: 0.7; }
    .seg-up { background: #22c55e; }
    .seg-down { background: #ef4444; }
    .seg-none { background: #262626; }

    .uptime-pct { font-size: 28px; font-weight: 700; }
    .uptime-pct.good { color: #4ade80; }
    .uptime-pct.warn { color: #fbbf24; }
    .uptime-pct.bad { color: #f87171; }

    .response-time { color: #a3a3a3; font-size: 14px; }

    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 20px; }

    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th { text-align: left; padding: 8px 12px; color: #737373; font-weight: 500; border-bottom: 1px solid #262626; }
    td { padding: 8px 12px; border-bottom: 1px solid #1a1a1a; }

    button, .btn {
      background: #fff; color: #0a0a0a; border: none; padding: 8px 18px;
      border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: 500;
      transition: background 0.15s;
    }
    button:hover, .btn:hover { background: #e5e5e5; }
    .btn-danger { background: #7f1d1d; color: #fca5a5; }
    .btn-danger:hover { background: #991b1b; }
    .btn-ghost { background: transparent; color: #a3a3a3; border: 1px solid #262626; }
    .btn-ghost:hover { background: #1a1a1a; color: #fff; }

    input, select {
      background: #1a1a1a; color: #e5e5e5; border: 1px solid #262626;
      padding: 10px 14px; border-radius: 8px; width: 100%; font-size: 14px;
      margin-bottom: 12px; outline: none; transition: border-color 0.15s;
    }
    input:focus { border-color: #525252; }

    .form-row { display: flex; gap: 12px; align-items: flex-end; }
    .form-row input { margin-bottom: 0; }

    .empty { text-align: center; padding: 48px 20px; color: #525252; }

    .flex-between { display: flex; justify-content: space-between; align-items: center; }

    @media (max-width: 640px) {
      .grid-2 { grid-template-columns: 1fr; }
      .form-row { flex-direction: column; }
      .card-meta { flex-wrap: wrap; }
    }
  </style>
</head>
<body>
  <nav>
    <a href="/" class="brand">Uptime Monitor</a>
    <div class="links">
      <a href="/">Dashboard</a>
      <a href="/settings">Settings</a>
    </div>
  </nav>
  <div class="container">${content}</div>
</body>
</html>`;
}
