// Issues an access code and registers it in the database so the participant
// app's /api/validate-code can enforce one-time use. Same table, same env
// var as the participant project — see the schema in its api/validate-code.js.
const postgres = require('postgres');

const connectionString =
  process.env.AIVA_ASSESSMENT_DB_DATABASE_URL ||
  process.env.AIVA_ASSESSMENT_DB_POSTGRES_URL;

let sql = null;
function getSql() {
  if (!sql) {
    if (!connectionString) throw new Error('No database connection string found in environment');
    sql = postgres(connectionString, { ssl: 'require' });
  }
  return sql;
}

// Must stay byte-for-byte identical to codeInitials()/codeChecksum() in the
// participant app (index.html + api/validate-code.js) and this app's index.html.
function codeInitials(first, last) {
  const a = (first||'').trim().charAt(0).toUpperCase();
  const b = (last||'').trim().charAt(0).toUpperCase();
  return (a + b) || 'XX';
}
function codeChecksum(first, last, dateStr) {
  const s = (first||'').trim().toUpperCase() + '|' + (last||'').trim().toUpperCase() + '|' + dateStr;
  let h = 5381;
  for (let i = 0; i < s.length; i++) { h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; }
  let b36 = h.toString(36).toUpperCase();
  if (b36.length < 4) b36 = ('0000' + b36).slice(-4);
  return b36.slice(-4);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  try {
    const { firstName, lastName } = req.body || {};
    const fn = String(firstName || '').trim();
    const ln = String(lastName || '').trim();
    if (!fn || !ln) {
      res.status(400).json({ error: 'missing_fields' });
      return;
    }
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const code = codeInitials(fn, ln) + '-' + dateStr + '-' + codeChecksum(fn, ln, dateStr);

    // Same name on the same day yields the same code, so re-issuing is a
    // no-op — and deliberately does NOT reset a code that's already been used.
    await getSql()`
      INSERT INTO assessment_access_codes (code, first_name, last_name, date_generated)
      VALUES (${code}, ${fn}, ${ln}, ${dateStr})
      ON CONFLICT (code) DO NOTHING
    `;
    res.status(200).json({ code });
  } catch (err) {
    console.error('generate-code error:', err);
    res.status(500).json({ error: 'server_error' });
  }
};
