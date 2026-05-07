/**
 * Vercel Serverless Function — Nhận report từ Lark Automation
 *
 * POST /api/report
 * Body (JSON từ Lark Automation):
 *   {
 *     "reporter": "Tên người nộp",
 *     "department": "Sale / Customer / Designer",
 *     "content": "Nội dung report",
 *     "submitted_at": "2026-05-07T10:30:00Z"  (tự động từ Lark)
 *   }
 *
 * Sau khi nhận → lưu vào reports/YYYY-MM-DD.json trong GitHub repo beu-vault
 */

const https = require('https');

const GITHUB_TOKEN  = process.env.GITHUB_TOKEN;
const GITHUB_OWNER  = 'beuisbeu';
const GITHUB_REPO   = 'beu-vault';
const REPORTS_PATH  = 'Projects/Daily Report Dashboard/reports';

// Lấy ngày hôm nay theo giờ VN (YYYY-MM-DD)
function todayVN() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
}

// Gọi GitHub API
function githubRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'api.github.com',
      path,
      method,
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'User-Agent': 'EtsyReportBot',
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, data: raw }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// Đọc file JSON từ GitHub (trả về { content, sha } hoặc null nếu chưa có)
async function readFile(filePath) {
  const res = await githubRequest('GET', `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}`);
  if (res.status === 404) return null;
  if (res.status !== 200) throw new Error(`GitHub đọc file lỗi ${res.status}`);
  const content = Buffer.from(res.data.content, 'base64').toString('utf8');
  return { content: JSON.parse(content), sha: res.data.sha };
}

// Ghi file JSON lên GitHub (tạo mới hoặc update)
async function writeFile(filePath, content, sha, message) {
  const body = {
    message,
    content: Buffer.from(JSON.stringify(content, null, 2)).toString('base64'),
    ...(sha ? { sha } : {}),
  };
  const res = await githubRequest('PUT', `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}`, body);
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`GitHub ghi file lỗi ${res.status}: ${JSON.stringify(res.data)}`);
  }
}

export default async function handler(req, res) {
  // Chỉ nhận POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Validate token đơn giản (Lark gửi kèm secret trong header)
  const secret = req.headers['x-report-secret'];
  if (process.env.REPORT_SECRET && secret !== process.env.REPORT_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const body = req.body;

    // Chuẩn hóa entry
    const entry = {
      reporter:     body.reporter     || body.name || 'Unknown',
      department:   body.department   || body.dept || 'Chưa rõ',
      content:      body.content      || body.report || '',
      fields:       body.fields       || {},          // object các field tuỳ chọn
      submitted_at: body.submitted_at || new Date().toISOString(),
      received_at:  new Date().toISOString(),
    };

    // Đường dẫn file theo ngày
    const dateStr  = todayVN();
    const filePath = `${REPORTS_PATH}/${dateStr}.json`;

    // Đọc file hiện tại (nếu có)
    const existing = await readFile(filePath);
    const reports  = existing ? existing.content : [];
    reports.push(entry);

    // Ghi lại
    await writeFile(
      filePath,
      reports,
      existing?.sha,
      `report: ${entry.reporter} (${entry.department}) ${dateStr}`,
    );

    console.log(`✅ Lưu report: ${entry.reporter} / ${entry.department}`);
    return res.status(200).json({ ok: true, saved: entry.reporter });

  } catch (err) {
    console.error('❌ Lỗi xử lý report:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
