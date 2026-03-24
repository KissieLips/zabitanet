const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="tr">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>ZabitaNet</title>
      <style>
        body {
          margin: 0;
          font-family: Arial, sans-serif;
          background: #f3f4f6;
          color: #1f2937;
        }
        .header {
          background: #1e3a5f;
          color: white;
          padding: 20px 30px;
          font-size: 28px;
          font-weight: bold;
        }
        .container {
          padding: 30px;
        }
        .card {
          background: white;
          border-radius: 12px;
          padding: 24px;
          box-shadow: 0 2px 10px rgba(0,0,0,0.08);
        }
        h1 {
          margin-top: 0;
          color: #111827;
        }
        p {
          font-size: 18px;
          line-height: 1.6;
        }
        .badge {
          display: inline-block;
          background: #f59e0b;
          color: white;
          padding: 8px 14px;
          border-radius: 999px;
          font-size: 14px;
          margin-top: 10px;
        }
      </style>
    </head>
    <body>
      <div class="header">ZabitaNet</div>
      <div class="container">
        <div class="card">
          <h1>Şikayet Takip Sistemi</h1>
          <p>Sistem başarıyla çalışıyor.</p>
          <p>Bir sonraki adımda burayı gerçek şikayet modülü ekranına çevireceğiz.</p>
          <div class="badge">İlk kurulum tamamlanıyor</div>
        </div>
      </div>
    </body>
    </html>
  `);
});

app.listen(PORT, () => {
  console.log(\`Sunucu çalışıyor: \${PORT}\`);
});
