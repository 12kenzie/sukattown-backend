const express = require("express");
const cors = require("cors");
const axios = require("axios");
const bcrypt = require("bcrypt"); // ADD THIS LINE - IMPORTANT!
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

// Helper: Get permissions by user type
function getPermissionsByUserType(userType) {
  switch (userType) {
    case "admin":
      return ["read", "write", "delete", "manage_users", "view_all_schools"];
    case "principal":
      return ["read", "write", "delete", "manage_alerts"];
    case "teacher":
      return ["read"];
    default:
      return ["read"];
  }
}

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
  
  const reading = {
    user_id: userId,
    school_id: data.school_id || null,    // ← ADD THIS
    ...latestPZEMData,
  };
  
  await db.ref("readings").push(reading);

  console.log("✅ Data saved to Firebase");
  res.status(200).json({
    success: true,
    message: "Data received successfully",
    data: reading,    // ← Changed from latestPZEMData to reading
  });
  } catch (err) {
    console.error("❌ Firebase error:", err);
    res.status(500).json({ success: false, message: "Firebase save failed" });
  }
});

// ========== ACCOUNT REGISTRATION AND LOGIN ==========

app.post("/api/auth/register", async (req, res) => {
  const { name, email, user_type, password, telegram_chat_id, account_type, school_id, school_name, invite_code } = req.body;

  const cleanEmail = email.toLowerCase().trim();

  if (!name || !email || !password || !user_type) {
    return res.status(400).json({ success: false, message: "Missing required fields" });
  }

  try {
    // Validate email domain
    const allowedDomains = ['gmail.com', 'deped.gov.ph', 'depedmarikina.ph'];
    const emailDomain = cleanEmail.split('@')[1];
    
    if (!allowedDomains.includes(emailDomain)) {
      return res.status(400).json({ 
        success: false, 
        message: "Invalid email domain. Only @gmail.com, @deped.gov.ph, and @depedmarikina.ph are allowed." 
      });
    }

    // Check if email already exists
    const snapshot = await db.ref("users").orderByChild("email").equalTo(cleanEmail).once("value");
    
    if (snapshot.exists()) {
      return res.status(400).json({ success: false, message: "Email already registered" });
    }

    // Handle school assignment
    let finalSchoolId = school_id;
    let finalSchoolName = school_name;
    let generatedInviteCode = null;

    if (school_id) {
      // ===== JOINING EXISTING SCHOOL - VERIFY INVITE CODE =====
      const schoolSnapshot = await db.ref(`schools/${school_id}`).once("value");
      
      if (!schoolSnapshot.exists()) {
        return res.status(404).json({ success: false, message: "School not found" });
      }

      const school = schoolSnapshot.val();
      finalSchoolName = school.name;

      // SECURITY CHECK: Verify invitation code
      if (!invite_code || invite_code.toUpperCase() !== school.invite_code) {
        return res.status(403).json({ 
          success: false, 
          message: "Invalid invitation code for this school. Please get the correct code from your school administrator." 
        });
      }

      console.log(`✅ Valid invite code provided for ${school.name}`);

    } else if (school_name) {
      // ===== CREATING NEW SCHOOL - GENERATE INVITE CODE =====
      if (!school_name.trim()) {
        return res.status(400).json({ success: false, message: "School name required for new school" });
      }

      const schoolRef = db.ref("schools").push();
      finalSchoolId = schoolRef.key;

      // Generate 6-character alphanumeric invite code
      generatedInviteCode = Math.random().toString(36).substring(2, 8).toUpperCase();

      await schoolRef.set({
        name: school_name.trim(),
        address: "",
        created_at: Date.now(),
        admin_user_id: null,
        members: [],
        invite_code: generatedInviteCode,
        privacy: {
          allowConsumptionView: true,
          allowBillingView: false
        }
      });

      console.log(`✅ New school created: ${school_name} with invite code: ${generatedInviteCode}`);

    } else {
      return res.status(400).json({ 
        success: false, 
        message: "Either school_id with invite_code OR school_name is required" 
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const userRef = db.ref("users").push();
    const userId = userRef.key;

    await userRef.set({
      name,
      email: cleanEmail,
      user_type,
      password: hashedPassword,
      school_id: finalSchoolId,
      telegram_chat_id: telegram_chat_id || null,
      account_type: account_type || "principal",
      permissions: getPermissionsByUserType(user_type),
      created_at: Date.now()
    });

    // Update school members list
    await db.ref(`schools/${finalSchoolId}/members`).transaction((members) => {
      if (!members) members = [];
      members.push(userId);
      return members;
    });

    // Set admin if principal or admin
    if (user_type === 'admin' || user_type === 'principal') {
      const schoolData = await db.ref(`schools/${finalSchoolId}`).once("value");
      if (!schoolData.val().admin_user_id) {
        await db.ref(`schools/${finalSchoolId}`).update({
          admin_user_id: userId
        });
      }
    }

    console.log(`✅ User registered: ${email} (${user_type}) - School: ${finalSchoolId}`);

    // Prepare response
    const response = {
      success: true, 
      message: "User registered successfully",
      userId: userId,
      schoolId: finalSchoolId,
      user: {
        name,
        email: cleanEmail,
        user_type,
        school_id: finalSchoolId,
        school_name: finalSchoolName,
        account_type: account_type || "principal"
      }
    };

    // Include invite code ONLY if creating new school
    if (generatedInviteCode) {
      response.invite_code = generatedInviteCode;
      response.message = "School created successfully! Share the invitation code with your staff.";
    }

    res.json(response);

  } catch (error) {
    console.error("❌ Registration error:", error);
    res.status(500).json({ success: false, message: "Registration failed" });
  }
});

// LOGIN USER
app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;

  const cleanEmail = email.toLowerCase().trim();

  if (!email || !password) {
    return res
      .status(400)
      .json({ success: false, message: "Email and password are required" });
  }

  try {
    // Find user by email
    const snapshot = await db
      .ref("users")
      .orderByChild("email")
      .equalTo(cleanEmail)
      .once("value");

    if (!snapshot.exists()) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid email or password" });
    }

    let user = null;
    let userId = null;

    snapshot.forEach((child) => {
      userId = child.key;
      user = child.val();
    });

    // Verify password
    const passwordMatch = await bcrypt.compare(password, user.password);

    if (!passwordMatch) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid email or password" });
    }

    // Get school info
    let schoolName = "Unknown School";
    if (user.school_id) {
      const schoolSnapshot = await db
        .ref(`schools/${user.school_id}`)
        .once("value");
      if (schoolSnapshot.exists()) {
        schoolName = schoolSnapshot.val().name;
      }
    }

    // Update last login
    await db.ref(`users/${userId}`).update({
      last_login: Date.now(),
    });

    console.log(`✅ User logged in: ${email}`);
    res.json({
      success: true,
      message: "Login successful",
      userId: userId,
      user: {
        name: user.name,
        email: user.email,
        user_type: user.user_type,
        school_id: user.school_id,
        school_name: schoolName,
        account_type: user.account_type,
        telegram_chat_id: user.telegram_chat_id,
        permissions: user.permissions || getPermissionsByUserType(user.user_type)  
      },
    });
  } catch (error) {
    console.error("❌ Login error:", error);
    res.status(500).json({ success: false, message: "Login failed" });
  }
});

// ========== END AUTH ENDPOINTS ==========

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
      school_id: alertData.school_id || null,
      period: latestConsumptionAlert.period,
      consumption: latestConsumptionAlert.consumption,
      limit: latestConsumptionAlert.limit,
      percentage_over: latestConsumptionAlert.percentageOver,
      timestamp: latestConsumptionAlert.timestamp,
    });

    console.log("✅ Alert saved to Firebase");
    res.status(200).json({
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
      school_id: alertData.school_id || null,
      type: latestFireAlert.type,
      flame_detected: latestFireAlert.flameDetected,
      smoke_level: latestFireAlert.smokeLevel,
      smoke_threshold: latestFireAlert.smokeThreshold,
      timestamp: latestFireAlert.timestamp,
    });

    console.log("✅ Fire alert saved to Firebase");
    res.status(200).json({
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
          userId: alert.user_id,
        });
      }
    });

    fireAlerts.reverse(); // Show most recent first
    console.log(`📤 Sending ${fireAlerts.length} fire alerts from history`);
    res.json({ success: true, count: fireAlerts.length, data: fireAlerts });
  } catch (err) {
    console.error("❌ Firebase query error:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch fire alerts history" });
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
    res
      .status(500)
      .json({ success: false, message: "Failed to delete fire alert" });
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
    res
      .status(500)
      .json({ success: false, message: "Failed to clear fire alerts" });
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
    const schoolId = req.query.school_id || null;

    const snapshot = await db
      .ref("readings")
      .orderByChild("timestamp")
      .limitToLast(limit)
      .once("value");
    let readings = [];

    snapshot.forEach((child) => {
      const reading = child.val();
      if (!schoolId || reading.school_id === schoolId) {
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
    await axios.post(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        chat_id: process.env.TELEGRAM_CHAT_ID,
        text: `🚨 SUKATTOWN ALERT 🚨\n\n${message}`,
        parse_mode: "HTML",
      }
    );

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false });
  }
});

// ========== SCHOOLS ==========

// Get all schools (admin only)
app.get("/api/schools", async (req, res) => {
  try {
    const snapshot = await db.ref("schools").once("value");
    const schools = [];

    snapshot.forEach((child) => {
      schools.push({ id: child.key, ...child.val() });
    });

    res.json({ success: true, count: schools.length, data: schools });
  } catch (err) {
    console.error("❌ Query error:", err);
    res.status(500).json({ success: false });
  }
});

// Get school by ID
app.get("/api/schools/:id", async (req, res) => {
  try {
    const snapshot = await db.ref(`schools/${req.params.id}`).once("value");
    
    if (!snapshot.exists()) {
      return res.status(404).json({ success: false, message: "School not found" });
    }

    res.json({ success: true, data: { id: req.params.id, ...snapshot.val() } });
  } catch (err) {
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

// TEMPORARY: Hash password endpoint
app.post("/api/auth/hash-password", async (req, res) => {
  const { password } = req.body;

  if (!password) {
    return res
      .status(400)
      .json({ success: false, message: "Password required" });
  }

  try {
    const hash = await bcrypt.hash(password, 10);
    res.json({ success: true, hash });
  } catch (error) {
    res.status(500).json({ success: false, message: "Hash generation failed" });
  }
});

// Add this temporary endpoint to server.js to check what's in Firebase

app.get("/api/auth/debug-users", async (req, res) => {
  try {
    const snapshot = await db.ref("users").once("value");

    if (!snapshot.exists()) {
      return res.json({
        success: true,
        message: "No users found in database",
        users: [],
      });
    }

    const users = [];
    snapshot.forEach((child) => {
      const user = child.val();
      users.push({
        id: child.key,
        email: user.email,
        name: user.name,
        user_type: user.user_type,
        account_type: user.account_type,
        has_password: !!user.password,
        password_is_hashed: user.password
          ? user.password.startsWith("$2")
          : false,
        password_length: user.password ? user.password.length : 0,
        created_at: user.created_at,
        last_login: user.last_login,
      });
    });

    console.log(`📊 Found ${users.length} users in database`);
    res.json({
      success: true,
      count: users.length,
      users: users,
    });
  } catch (error) {
    console.error("❌ Debug error:", error);
    res.status(500).json({ success: false, message: "Debug failed" });
  }
});

// Test login with detailed logging
app.post("/api/auth/login-debug", async (req, res) => {
  const { email, password } = req.body;

  console.log("\n=== LOGIN DEBUG START ===");
  console.log("📧 Email received:", email);
  console.log(
    "🔐 Password received:",
    password ? `${password.substring(0, 3)}***` : "NONE"
  );

  if (!email || !password) {
    console.log("❌ Missing email or password");
    return res
      .status(400)
      .json({ success: false, message: "Email and password are required" });
  }

  try {
    const searchEmail = cleanEmail;
    console.log("🔍 Searching for email:", searchEmail);

    const snapshot = await db
      .ref("users")
      .orderByChild("email")
      .equalTo(searchEmail)
      .once("value");

    console.log("📊 Query executed, snapshot exists:", snapshot.exists());

    if (!snapshot.exists()) {
      console.log("❌ No user found with email:", searchEmail);

      // Let's check ALL users to see what emails exist
      const allUsers = await db.ref("users").once("value");
      const emailList = [];
      allUsers.forEach((child) => {
        emailList.push(child.val().email);
      });
      console.log("📋 All emails in database:", emailList);

      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
        debug: {
          searchedFor: searchEmail,
          availableEmails: emailList,
        },
      });
    }

    let user = null;
    let userId = null;

    snapshot.forEach((child) => {
      userId = child.key;
      user = child.val();
      console.log("👤 Found user:", {
        id: userId,
        email: user.email,
        name: user.name,
        hasPassword: !!user.password,
        passwordStartsWith: user.password
          ? user.password.substring(0, 10)
          : "NONE",
      });
    });

    console.log("🔐 Attempting password comparison...");
    console.log("   Plain password:", password);
    console.log("   Hashed password:", user.password.substring(0, 20) + "...");

    const passwordMatch = await bcrypt.compare(password, user.password);
    console.log("✅ Password match result:", passwordMatch);

    if (!passwordMatch) {
      console.log("❌ Password does not match");
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
        debug: {
          passwordProvided: password.substring(0, 3) + "***",
          hashExists: !!user.password,
          hashStartsWith: user.password.substring(0, 10),
        },
      });
    }

    console.log("✅ Login successful!");
    console.log("=== LOGIN DEBUG END ===\n");

    res.json({
      success: true,
      message: "Login successful",
      userId: userId,
      user: {
        name: user.name,
        email: user.email,
        user_type: user.user_type,
        account_type: user.account_type,
        telegram_chat_id: user.telegram_chat_id,
      },
    });
  } catch (error) {
    console.error("❌ Login error:", error);
    console.log("=== LOGIN DEBUG END (ERROR) ===\n");
    res.status(500).json({
      success: false,
      message: "Login failed",
      error: error.message,
    });
  }
});

// Get school invite code - only for school admins/principals
app.get("/api/schools/:id/invite-code", async (req, res) => {
  try {
    const schoolId = req.params.id;
    const userId = req.query.user_id;
    const userType = req.query.user_type;

    // Get school data
    const schoolSnapshot = await db.ref(`schools/${schoolId}`).once("value");
    
    if (!schoolSnapshot.exists()) {
      return res.status(404).json({ success: false, message: "School not found" });
    }

    const school = schoolSnapshot.val();

    // Security: Only school admin/principal or system admin can view invite code
    if (userType !== 'admin' && school.admin_user_id !== userId) {
      return res.status(403).json({ 
        success: false, 
        message: "Only school administrators can view the invitation code" 
      });
    }

    res.json({ 
      success: true, 
      invite_code: school.invite_code,
      school_name: school.name
    });

  } catch (err) {
    console.error("❌ Error fetching invite code:", err);
    res.status(500).json({ success: false });
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
  console.log(`  POST   /api/auth/register - Register new user`);
  console.log(`  POST   /api/auth/login - Login user`);
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
  console.log(
    `  GET    /api/fire-alerts/history?limit=50 - Get fire alerts history`
  );
  console.log(`  DELETE /api/fire-alerts/:id - Delete specific fire alert`);
  console.log(
    `  DELETE /api/fire-alerts/history/clear - Clear all fire alerts`
  );
  console.log(`  DELETE /api/fire-alerts - Clear fire alert notification`);
  console.log(`  GET    /api/schools - Get all schools`);
  console.log(`  GET    /api/schools/:id - Get school by ID`);
  console.log(`  GET    /api/health - Health check\n`);
});
