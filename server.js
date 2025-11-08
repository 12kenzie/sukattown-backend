// server.js - Updated to match your actual database structure
const express = require("express");
const cors = require("cors");
const app = express();
const PORT = process.env.PORT || 3000;

const mysql = require("mysql2");

const db = mysql.createPool({
  host: "sql105.infinityfree.com",
  user: "if0_40358009",
  password: "Mackenzie122807",
  database: "if0_40358009_sukattown_db",
  port: 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

app.use(cors());
app.use(express.json());

// Store latest sensor data
let latestPZEMData = {
  voltage: 230.0,
  current: 5.0,
  power: 1150,
  energy: 0.0,
  frequency: 60.0,
  powerFactor: 0.95,
  timestamp: Date.now(),
};

// Store latest consumption alert
let latestConsumptionAlert = null;

// ========== POWER DATA ENDPOINTS ==========

// Receive data from ESP32
app.post("/api/power-data", (req, res) => {
  const data = req.body;

  console.log("📊 Received PZEM data:", data);

  // Validate required fields
  if (!data.voltage || !data.current || !data.power) {
    return res.status(400).json({
      success: false,
      message: "Missing required fields (voltage, current, power)"
    });
  }

  // Update latest data
  latestPZEMData = {
    voltage: parseFloat(data.voltage),
    current: parseFloat(data.current),
    power: parseFloat(data.power),
    energy: parseFloat(data.energy || 0),
    frequency: parseFloat(data.frequency || 60),
    powerFactor: parseFloat(data.powerFactor || 0.95),
    timestamp: Date.now(),
  };

  // Save to MySQL - Updated column names to match your database
  const { voltage, current, power, energy, frequency, powerFactor } = latestPZEMData;

  // Note: user_id is set to 1 by default. You can change this based on your needs
  const userId = 1;

  db.query(
    "INSERT INTO readings (user_id, voltage, current, power, energy, frequency, powerFactor) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [userId, voltage, current, power, energy, frequency, powerFactor],
    (err, result) => {
      if (err) {
        console.error("❌ Insert error:", err);
        // Still return success to ESP32 even if DB insert fails
      } else {
        console.log("✅ Reading saved to database with ID:", result.insertId);
      }
    }
  );

  res.status(200).json({
    success: true,
    message: "Data received successfully",
    data: latestPZEMData,
  });
});

// Get latest sensor data
app.get("/api/power-data", (req, res) => {
  console.log("📤 Sending latest PZEM data");
  res.json(latestPZEMData);
});

// ========== CONSUMPTION ALERTS ENDPOINTS ==========

// Receive consumption alert from ESP32
app.post("/api/consumption-alerts", (req, res) => {
  const alertData = req.body;

  console.log("🚨 Received consumption alert:", alertData);

  // Validate required fields
  if (!alertData.period || !alertData.consumption || !alertData.limit) {
    return res.status(400).json({
      success: false,
      message: "Missing required fields (period, consumption, limit)"
    });
  }

  // Update latest alert
  latestConsumptionAlert = {
    period: alertData.period,
    consumption: parseFloat(alertData.consumption),
    limit: parseFloat(alertData.limit),
    percentageOver: parseFloat(alertData.percentageOver || 0),
    timestamp: Date.now(),
  };

  // Save to MySQL alerts table 
  // Uncomment this after creating the alerts table
  /*
  const userId = 1;
  db.query(
    "INSERT INTO alerts (user_id, period, consumption, `limit`, percentage_over) VALUES (?, ?, ?, ?, ?)",
    [
      userId,
      latestConsumptionAlert.period,
      latestConsumptionAlert.consumption,
      latestConsumptionAlert.limit,
      latestConsumptionAlert.percentageOver
    ],
    (err, result) => {
      if (err) {
        console.error("❌ Alert insert error:", err);
      } else {
        console.log("✅ Alert saved to database with ID:", result.insertId);
      }
    }
  );
  */

  res.status(200).json({
    success: true,
    message: "Alert received successfully",
    data: latestConsumptionAlert,
  });
});

// Get latest consumption alert
app.get("/api/consumption-alerts", (req, res) => {
  if (!latestConsumptionAlert) {
    return res.status(404).json({
      success: false,
      message: "No alerts available"
    });
  }

  console.log("📤 Sending latest consumption alert");
  res.json(latestConsumptionAlert);
});

// Clear consumption alert (for testing)
app.delete("/api/consumption-alerts", (req, res) => {
  latestConsumptionAlert = null;
  console.log("🗑️ Consumption alert cleared");
  res.json({
    success: true,
    message: "Alert cleared"
  });
});

// ========== DATABASE QUERY ENDPOINTS ==========

// Get all readings from database
app.get("/api/readings", (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const userId = parseInt(req.query.user_id) || null;
  
  let query = "SELECT * FROM readings";
  let params = [];
  
  if (userId) {
    query += " WHERE user_id = ?";
    params.push(userId);
  }
  
  query += " ORDER BY timestamp DESC LIMIT ?";
  params.push(limit);
  
  db.query(query, params, (err, results) => {
    if (err) {
      console.error("❌ Query error:", err);
      return res.status(500).json({
        success: false,
        message: "Database query failed",
        error: err.message
      });
    }
    res.json({
      success: true,
      count: results.length,
      data: results
    });
  });
});

// Get readings by user_id
app.get("/api/readings/user/:userId", (req, res) => {
  const userId = parseInt(req.params.userId);
  const limit = parseInt(req.query.limit) || 50;
  
  db.query(
    "SELECT * FROM readings WHERE user_id = ? ORDER BY timestamp DESC LIMIT ?",
    [userId, limit],
    (err, results) => {
      if (err) {
        console.error("❌ Query error:", err);
        return res.status(500).json({
          success: false,
          message: "Database query failed"
        });
      }
      res.json({
        success: true,
        userId: userId,
        count: results.length,
        data: results
      });
    }
  );
});

// Get latest reading from database
app.get("/api/readings/latest", (req, res) => {
  const userId = parseInt(req.query.user_id) || null;
  
  let query = "SELECT * FROM readings";
  let params = [];
  
  if (userId) {
    query += " WHERE user_id = ?";
    params.push(userId);
  }
  
  query += " ORDER BY timestamp DESC LIMIT 1";
  
  db.query(query, params, (err, results) => {
    if (err) {
      console.error("❌ Query error:", err);
      return res.status(500).json({
        success: false,
        message: "Database query failed"
      });
    }
    
    if (results.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No readings found"
      });
    }
    
    res.json({
      success: true,
      data: results[0]
    });
  });
});

// ========== STATISTICS ENDPOINTS ==========

// Get energy statistics
app.get("/api/stats/energy", (req, res) => {
  const userId = parseInt(req.query.user_id) || null;
  
  let query = `
    SELECT 
      COUNT(*) as total_readings,
      AVG(voltage) as avg_voltage,
      AVG(current) as avg_current,
      AVG(power) as avg_power,
      MAX(energy) as max_energy,
      MIN(energy) as min_energy,
      AVG(frequency) as avg_frequency,
      AVG(powerFactor) as avg_powerFactor
    FROM readings
  `;
  
  let params = [];
  
  if (userId) {
    query += " WHERE user_id = ?";
    params.push(userId);
  }
  
  db.query(query, params, (err, results) => {
    if (err) {
      console.error("❌ Query error:", err);
      return res.status(500).json({
        success: false,
        message: "Database query failed"
      });
    }
    res.json({
      success: true,
      data: results[0]
    });
  });
});

// ========== HEALTH CHECK ==========

app.get("/api/health", (req, res) => {
  db.query("SELECT 1", (err) => {
    const dbStatus = err ? "disconnected" : "connected";
    if (err) {
      console.error("❌ Health check DB error:", err.message);
    } else {
      console.log("✅ Health check DB connected");
    }

    res.json({
      success: true,
      message: "SukatTown API is running",
      timestamp: Date.now(),
      database: dbStatus,
    });
  });
});


// ========== STATIC FILES ==========

app.use(express.static("public"));

// ========== START SERVER ==========

app.listen(PORT, () => {
  console.log(`\n🚀 SukatTown Server running on port ${PORT}`);
  console.log(`📡 Backend: https://sukattown-backend.onrender.com`);
  console.log(`🌐 Frontend: http://sukattown.wuaze.com`);
  console.log(`\n📋 Available Endpoints:`);
  console.log(`   POST   /api/power-data - Receive ESP32 data`);
  console.log(`   GET    /api/power-data - Get latest data`);
  console.log(`   POST   /api/consumption-alerts - Receive alerts`);
  console.log(`   GET    /api/consumption-alerts - Get latest alert`);
  console.log(`   DELETE /api/consumption-alerts - Clear alert`);
  console.log(`   GET    /api/readings?limit=50&user_id=1 - Get DB readings`);
  console.log(`   GET    /api/readings/user/1?limit=50 - Get user readings`);
  console.log(`   GET    /api/readings/latest?user_id=1 - Get latest reading`);
  console.log(`   GET    /api/stats/energy?user_id=1 - Get statistics`);
  console.log(`   GET    /api/health - Health check\n`);
});