const mysql = require('mysql2');

const db = mysql.createConnection({
  host: 'sql105.infinityfree.com',
  user: 'if0_40358009',
  password: 'Mackenzie122807', 
  database: 'if0_40358009_sukattown_db', 
});

db.connect((err) => {
  if (err) {
    console.error('DB connection failed:', err);
  } else {
    console.log('Connected to InfinityFree MySQL');
  }
});

module.exports = db;
