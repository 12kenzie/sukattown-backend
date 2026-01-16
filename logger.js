// logger.js
const fs = require('fs');
const path = require('path');

// Create or append to a CSV file
const logFile = path.join(__dirname, 'performance_logs.csv');

// Write CSV header if file doesn't exist
if (!fs.existsSync(logFile)) {
  fs.writeFileSync(logFile, 'method,url,duration_ms,timestamp\n');
}

module.exports = function performanceLogger(req, res, next) {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const logLine = `${req.method},${req.originalUrl},${duration},${new Date().toISOString()}\n`;

    // Append to CSV file
    fs.appendFile(logFile, logLine, (err) => {
      if (err) console.error('Error writing to CSV:', err);
    });

    console.log(`${req.method} ${req.originalUrl} took ${duration} ms`);
  });

  next();
};
