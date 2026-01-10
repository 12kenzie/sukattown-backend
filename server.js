const express = require("express");
const cors = require("cors");
const app = express();
const PORT = process.env.PORT || 3000;

// Firebase Admin SDK
const admin = require("firebase-admin");

// Initialize Firebase with environment variable or local file
let serviceAccount;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} else {
  serviceAccount = require("./firebase-key.json");
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL:
    "https://sukattown-c9a3b-default-rtdb.asia-southeast1.firebasedatabase.app/",
});

const db = admin.database();

// CORS configuration for GitHub Pages
app.use(
  cors({
    origin: [
      "http://localhost:3000",
      "http://localhost:5173",
      "https://12kenzie.github.io", // Your GitHub Pages domain
    ],
    credentials: true,
  })
);

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
let latestFireAlert = null;

// POWER DATA ENDPOINTS
app.post("/api/power-data", async (req, res) => {
  const data = req.body;
  console.log("📊 Received PZEM data:", data);

  if (!data.voltage || !data.current || !data.power) {
    return res
      .status(400)
      .json({ success: false, message: "Missing required fields" });
  }

  latestPZEMData = {
    voltage: parseFloat(data.voltage),
    current: parseFloat(data.current),
    power: parseFloat(data.power),
    energy: parseFloat(data.energy || 0),
    frequency: parseFloat(data.frequency || 60),
    powerFactor: parseFloat(data.powerFactor || 0.95),
    timestamp: Date.now(),
  };

  try {
    const userId = data.user_id || 1;
    await db.ref("readings").push({
      user_id: userId,
      ...latestPZEMData,
    });

    console.log("✅ Data saved to Firebase");
    res
      .status(200)
      .json({
        success: true,
        message: "Data received successfully",
        data: latestPZEMData,
      });
  } catch (err) {
    console.error("❌ Firebase error:", err);
    res.status(500).json({ success: false, message: "Firebase save failed" });
  }
});

app.get("/api/power-data", (req, res) => {
  console.log("📤 Sending latest PZEM data");
  res.json(latestPZEMData);
});

// CONSUMPTION ALERTS ENDPOINTS
app.post("/api/consumption-alerts", async (req, res) => {
  const alertData = req.body;
  console.log("🚨 Received consumption alert:", alertData);

  if (!alertData.period || !alertData.consumption || !alertData.limit) {
    return res
      .status(400)
      .json({ success: false, message: "Missing required fields" });
  }

  latestConsumptionAlert = {
    period: alertData.period,
    consumption: parseFloat(alertData.consumption),
    limit: parseFloat(alertData.limit),
    percentageOver: parseFloat(alertData.percentageOver || 0),
    timestamp: Date.now(),
  };

  try {
    const userId = alertData.user_id || 1;
    await db.ref("alerts").push({
      user_id: userId,
      period: latestConsumptionAlert.period,
      consumption: latestConsumptionAlert.consumption,
      limit: latestConsumptionAlert.limit,
      percentage_over: latestConsumptionAlert.percentageOver,
      timestamp: latestConsumptionAlert.timestamp,
    });

    console.log("✅ Alert saved to Firebase");
    res
      .status(200)
      .json({
        success: true,
        message: "Alert received successfully",
        data: latestConsumptionAlert,
      });
  } catch (err) {
    console.error("❌ Firebase error:", err);
    res.status(500).json({ success: false, message: "Firebase save failed" });
  }
});

app.get("/api/consumption-alerts", (req, res) => {
  if (!latestConsumptionAlert) {
    return res
      .status(404)
      .json({ success: false, message: "No alerts available" });
  }
  console.log("📤 Sending latest consumption alert");
  res.json(latestConsumptionAlert);
});

app.delete("/api/consumption-alerts", (req, res) => {
  latestConsumptionAlert = null;
  console.log("🗑️ Consumption alert cleared");
  res.json({ success: true, message: "Alert cleared" });
});

// FIRE ALERT ENDPOINTS
// Receive fire alert from ESP32
app.post("/api/fire-alerts", async (req, res) => {
  const alertData = req.body;
  console.log("🔥 Received fire alert:", alertData);

  if (!alertData.type) {
    return res
      .status(400)
      .json({ success: false, message: "Missing required field: type" });
  }

  latestFireAlert = {
    type: alertData.type,
    flameDetected: alertData.flameDetected || false,
    smokeLevel: parseInt(alertData.smokeLevel) || 0,
    smokeThreshold: parseInt(alertData.smokeThreshold) || 400,
    timestamp: Date.now(),
  };

  try {
    const userId = alertData.user_id || 1;
    await db.ref("fire_alerts").push({
      user_id: userId,
      type: latestFireAlert.type,
      flame_detected: latestFireAlert.flameDetected,
      smoke_level: latestFireAlert.smokeLevel,
      smoke_threshold: latestFireAlert.smokeThreshold,
      timestamp: latestFireAlert.timestamp,
    });

    console.log("✅ Fire alert saved to Firebase");
    res
      .status(200)
      .json({
        success: true,
        message: "Fire alert received successfully",
        data: latestFireAlert,
      });
  } catch (err) {
    console.error("❌ Firebase error:", err);
    res.status(500).json({ success: false, message: "Firebase save failed" });
  }
});

// Get latest fire alert
app.get("/api/fire-alerts", (req, res) => {
  if (!latestFireAlert) {
    return res
      .status(404)
      .json({ success: false, message: "No fire alerts available" });
  }
  console.log("📤 Sending latest fire alert");
  res.json(latestFireAlert);
});

// Get all fire alerts history
app.get("/api/fire-alerts/history", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const userId = parseInt(req.query.user_id) || null;

    const snapshot = await db
      .ref("fire_alerts")
      .orderByChild("timestamp")
      .limitToLast(limit)
      .once("value");
    
    let fireAlerts = [];

    snapshot.forEach((child) => {
      const alert = child.val();
      if (!userId || alert.user_id === userId) {
        fireAlerts.push({ 
          id: child.key, 
          type: alert.type,
          flameDetected: alert.flame_detected,
          smokeLevel: alert.smoke_level,
          smokeThreshold: alert.smoke_threshold,
          timestamp: alert.timestamp,
          userId: alert.user_id
        });
      }
    });

    fireAlerts.reverse(); // Show most recent first
    console.log(`📤 Sending ${fireAlerts.length} fire alerts from history`);
    res.json({ success: true, count: fireAlerts.length, data: fireAlerts });
  } catch (err) {
    console.error("❌ Firebase query error:", err);
    res.status(500).json({ success: false, message: "Failed to fetch fire alerts history" });
  }
});

// Delete a specific fire alert from history
app.delete("/api/fire-alerts/:id", async (req, res) => {
  try {
    const alertId = req.params.id;
    await db.ref(`fire_alerts/${alertId}`).remove();
    
    console.log(`🗑️ Fire alert ${alertId} deleted from history`);
    res.json({ success: true, message: "Fire alert deleted successfully" });
  } catch (err) {
    console.error("❌ Firebase delete error:", err);
    res.status(500).json({ success: false, message: "Failed to delete fire alert" });
  }
});

// Clear all fire alerts history
app.delete("/api/fire-alerts/history/clear", async (req, res) => {
  try {
    const userId = parseInt(req.query.user_id) || null;
    
    if (userId) {
      // Delete only for specific user
      const snapshot = await db
        .ref("fire_alerts")
        .orderByChild("user_id")
        .equalTo(userId)
        .once("value");
      
      const updates = {};
      snapshot.forEach((child) => {
        updates[`fire_alerts/${child.key}`] = null;
      });
      
      await db.ref().update(updates);
      console.log(`🗑️ Cleared all fire alerts for user ${userId}`);
    } else {
      // Clear all fire alerts
      await db.ref("fire_alerts").remove();
      console.log("🗑️ Cleared all fire alerts");
    }
    
    res.json({ success: true, message: "Fire alerts history cleared" });
  } catch (err) {
    console.error("❌ Firebase clear error:", err);
    res.status(500).json({ success: false, message: "Failed to clear fire alerts" });
  }
});

// Clear current fire alert notification
app.delete("/api/fire-alerts", (req, res) => {
  latestFireAlert = null;
  console.log("🗑️ Fire alert notification cleared");
  res.json({ success: true, message: "Fire alert cleared" });
});

// DATABASE QUERY ENDPOINTS
app.get("/api/readings", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const userId = parseInt(req.query.user_id) || null;

    const snapshot = await db
      .ref("readings")
      .orderByChild("timestamp")
      .limitToLast(limit)
      .once("value");
    let readings = [];

    snapshot.forEach((child) => {
      const reading = child.val();
      if (!userId || reading.user_id === userId) {
        readings.push({ id: child.key, ...reading });
      }
    });

    readings.reverse();
    res.json({ success: true, count: readings.length, data: readings });
  } catch (err) {
    console.error("❌ Firebase query error:", err);
    res.status(500).json({ success: false, message: "Firebase query failed" });
  }
});

app.get("/api/readings/user/:userId", async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    const limit = parseInt(req.query.limit) || 50;

    const snapshot = await db
      .ref("readings")
      .orderByChild("user_id")
      .equalTo(userId)
      .limitToLast(limit)
      .once("value");
    let readings = [];

    snapshot.forEach((child) => {
      readings.push({ id: child.key, ...child.val() });
    });

    readings.reverse();
    res.json({
      success: true,
      userId: userId,
      count: readings.length,
      data: readings,
    });
  } catch (err) {
    console.error("❌ Firebase query error:", err);
    res.status(500).json({ success: false, message: "Firebase query failed" });
  }
});

app.get("/api/readings/latest", async (req, res) => {
  try {
    const userId = parseInt(req.query.user_id) || null;
    const snapshot = await db
      .ref("readings")
      .orderByChild("timestamp")
      .limitToLast(1)
      .once("value");

    let latest = null;
    snapshot.forEach((child) => {
      const reading = child.val();
      if (!userId || reading.user_id === userId) {
        latest = { id: child.key, ...reading };
      }
    });

    if (!latest) {
      return res
        .status(404)
        .json({ success: false, message: "No readings found" });
    }

    res.json({ success: true, data: latest });
  } catch (err) {
    console.error("❌ Firebase query error:", err);
    res.status(500).json({ success: false, message: "Firebase query failed" });
  }
});

// STATISTICS ENDPOINTS
app.get("/api/stats/energy", async (req, res) => {
  try {
    const userId = parseInt(req.query.user_id) || null;
    const snapshot = await db.ref("readings").once("value");

    let readings = [];
    snapshot.forEach((child) => {
      const reading = child.val();
      if (!userId || reading.user_id === userId) {
        readings.push(reading);
      }
    });

    if (readings.length === 0) {
      return res.json({
        success: true,
        data: {
          total_readings: 0,
          avg_voltage: 0,
          avg_current: 0,
          avg_power: 0,
          max_energy: 0,
          min_energy: 0,
          avg_frequency: 0,
          avg_powerFactor: 0,
        },
      });
    }

    const stats = {
      total_readings: readings.length,
      avg_voltage:
        readings.reduce((sum, r) => sum + r.voltage, 0) / readings.length,
      avg_current:
        readings.reduce((sum, r) => sum + r.current, 0) / readings.length,
      avg_power:
        readings.reduce((sum, r) => sum + r.power, 0) / readings.length,
      max_energy: Math.max(...readings.map((r) => r.energy)),
      min_energy: Math.min(...readings.map((r) => r.energy)),
      avg_frequency:
        readings.reduce((sum, r) => sum + r.frequency, 0) / readings.length,
      avg_powerFactor:
        readings.reduce((sum, r) => sum + r.powerFactor, 0) / readings.length,
    };

    res.json({ success: true, data: stats });
  } catch (err) {
    console.error("❌ Firebase stats error:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to calculate statistics" });
  }
});

// Get all consumption alerts with delete capability
app.get("/api/alerts", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const userId = parseInt(req.query.user_id) || null;

    const snapshot = await db
      .ref("alerts")
      .orderByChild("timestamp")
      .limitToLast(limit)
      .once("value");
    let alerts = [];

    snapshot.forEach((child) => {
      const alert = child.val();
      if (!userId || alert.user_id === userId) {
        alerts.push({ id: child.key, ...alert });
      }
    });

    alerts.reverse();
    res.json({ success: true, count: alerts.length, data: alerts });
  } catch (err) {
    console.error("❌ Firebase alerts query error:", err);
    res.status(500).json({ success: false, message: "Failed to fetch alerts" });
  }
});

// Delete a specific consumption alert
app.delete("/api/alerts/:id", async (req, res) => {
  try {
    const alertId = req.params.id;
    await db.ref(`alerts/${alertId}`).remove();
    
    console.log(`🗑️ Alert ${alertId} deleted`);
    res.json({ success: true, message: "Alert deleted successfully" });
  } catch (err) {
    console.error("❌ Firebase delete error:", err);
    res.status(500).json({ success: false, message: "Failed to delete alert" });
  }
});

app.post("/api/send-telegram", async (req, res) => {
  const { message } = req.body;
  
  try {
    await axios.post(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: process.env.TELEGRAM_CHAT_ID,
      text: `🚨 SUKATTOWN ALERT 🚨\n\n${message}`,
      parse_mode: 'HTML'
    });
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false });
  }
});

// HEALTH CHECK
app.get("/api/health", async (req, res) => {
  try {
    await db.ref(".info/connected").once("value");
    res.json({
      success: true,
      message: "SukatTown API is running",
      timestamp: Date.now(),
      database: "connected",
      firebase: "connected",
    });
  } catch (err) {
    res.json({
      success: true,
      message: "SukatTown API is running",
      timestamp: Date.now(),
      database: "error",
      firebase: "disconnected",
    });
  }
});

// STATIC FILES
app.use(express.static("public"));

// START SERVER
app.listen(PORT, () => {
  console.log(`\n🚀 SukatTown Server running on port ${PORT}`);
  console.log(`📡 Backend: https://sukattown-backend.onrender.com`);
  console.log(`🌐 Frontend: https://yourusername.github.io/sukattown`);
  console.log(`🔥 Firebase: Connected`);
  console.log(`\n📋 Available Endpoints:`);
  console.log(`  POST   /api/power-data - Receive ESP32 data`);
  console.log(`  GET    /api/power-data - Get latest data`);
  console.log(`  POST   /api/consumption-alerts - Receive alerts`);
  console.log(`  GET    /api/consumption-alerts - Get latest alert`);
  console.log(`  DELETE /api/consumption-alerts - Clear alert`);
  console.log(`  GET    /api/readings?limit=50&user_id=1 - Get readings`);
  console.log(`  GET    /api/readings/user/1?limit=50 - Get user readings`);
  console.log(`  GET    /api/readings/latest?user_id=1 - Get latest reading`);
  console.log(`  GET    /api/stats/energy?user_id=1 - Get statistics`);
  console.log(`  GET    /api/alerts?limit=50&user_id=1 - Get all alerts`);
  console.log(`  DELETE /api/alerts/:id - Delete specific alert`);
  console.log(`  POST   /api/fire-alerts - Receive fire alerts`);
  console.log(`  GET    /api/fire-alerts - Get latest fire alert`);
  console.log(`  GET    /api/fire-alerts/history?limit=50 - Get fire alerts history`);
  console.log(`  DELETE /api/fire-alerts/:id - Delete specific fire alert`);
  console.log(`  DELETE /api/fire-alerts/history/clear - Clear all fire alerts`);
  console.log(`  DELETE /api/fire-alerts - Clear fire alert notification`);
  console.log(`  GET    /api/health - Health check\n`);
});
