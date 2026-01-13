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

// TELEGRAM HELPER FUNCTIONS
async function sendTelegramMessage(chatId, text) {
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    console.log('⚠️ TELEGRAM_BOT_TOKEN not configured');
    return;
  }

  try {
    const now = new Date();
    
    // ISO 8601 format for precise logging
    const isoTimestamp = now.toISOString();
    
    // Manual formatting for Telegram to ensure milliseconds display
    const year = now.getFullYear();
    const month = now.toLocaleString('en-PH', { month: 'short', timeZone: 'Asia/Manila' });
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const milliseconds = String(now.getMilliseconds()).padStart(3, '0');
    
    const readableTime = `${year} ${month} ${day}, ${hours}:${minutes}:${seconds}.${milliseconds}`;
    
    // Add timestamp footer with both human-readable and ISO format for latency comparison
    const messageWithTimestamp = `${text}\n\n⏰ <b>Server Time:</b> ${readableTime}\n🔖 <code>${isoTimestamp}</code>`;

    await axios.post(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        chat_id: chatId,
        text: messageWithTimestamp,
        parse_mode: "HTML",
      }
    );
    
    // Log with ISO timestamp for research data collection
    console.log(`✅ [${isoTimestamp}] Telegram message sent to ${chatId}`);
    
  } catch (error) {
    console.error('❌ Failed to send Telegram message:', error.message);
  }
}

async function sendTelegramInviteCode(chatId, schoolName, inviteCode, principalName) {
  if (!chatId || !process.env.TELEGRAM_BOT_TOKEN) {
    console.log('⚠️ Telegram not configured');
    return;
  }

  const message = `
🏫 <b>School Created Successfully!</b>

👤 Principal: ${principalName}
🏫 School: ${schoolName}

🔑 <b>INVITATION CODE:</b>
<code>${inviteCode}</code>

📋 Share this code with your staff members so they can join your school on SukatTown.

⚠️ <b>Keep this code secure!</b>

💡 Tip: Send /school_invcode anytime to retrieve this code.
  `;

  await sendTelegramMessage(chatId, message);
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
  const { name, email, user_type, password, telegram_chat_id, account_type, school_id, school_name, invite_code, admin_invite_code } = req.body;

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

    // ===== ADMIN REGISTRATION - VERIFY ADMIN INVITE CODE =====
    if (user_type === 'admin') {
      const ADMIN_CODE = process.env.ADMIN_INVITE_CODE || 'ADMIN2025';

      // SECURITY CHECK: Verify admin invitation code
      if (!admin_invite_code || admin_invite_code.toUpperCase() !== ADMIN_CODE) {
        return res.status(403).json({ 
          success: false, 
          message: "Invalid admin invitation code. Please contact the capstone team for the correct code." 
        });
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      const userRef = db.ref("users").push();
      const userId = userRef.key;

      await userRef.set({
        name: name.trim(),
        email: cleanEmail,
        user_type: 'admin',
        password: hashedPassword,
        school_id: null,  // Admins don't belong to a specific school
        telegram_chat_id: telegram_chat_id || null,
        account_type: 'admin',
        permissions: getPermissionsByUserType('admin'),
        created_at: Date.now()
      });

      console.log(`✅ Admin registered: ${email} with invite code: ${admin_invite_code}`);

      return res.json({
        success: true, 
        message: "Admin account created successfully",
        userId: userId,
        schoolId: null,
        user: {
          name,
          email: cleanEmail,
          user_type: 'admin',
          school_id: null,
          school_name: 'System Administrator',
          account_type: 'admin'
        }
      });
    }

    // ===== TEACHER/PRINCIPAL REGISTRATION - SCHOOL REQUIRED =====
    let finalSchoolId = school_id;
    let finalSchoolName = school_name;
    let generatedInviteCode = null;

    if (school_id) {
      // JOINING EXISTING SCHOOL - VERIFY INVITE CODE
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
      // CREATING NEW SCHOOL
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
        message: "Teachers and Principals must either join an existing school or create a new one" 
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const userRef = db.ref("users").push();
    const userId = userRef.key;

    await userRef.set({
      name: name.trim(),
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

    // Set admin if principal
    if (user_type === 'principal') {
      const schoolData = await db.ref(`schools/${finalSchoolId}`).once("value");
      if (!schoolData.val().admin_user_id) {
        await db.ref(`schools/${finalSchoolId}`).update({
          admin_user_id: userId
        });
      }
    }

    console.log(`✅ User registered: ${email} (${user_type}) - School: ${finalSchoolId}`);

    if (generatedInviteCode && telegram_chat_id) {
      await sendTelegramInviteCode(
        telegram_chat_id, 
        school_name.trim(), 
        generatedInviteCode, 
        name.trim()
      );
    }

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
      response.message = telegram_chat_id 
        ? "School created successfully! Check your Telegram for the invitation code."
        : "School created successfully! Save your invitation code.";
      response.telegram_sent = !!telegram_chat_id;
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

// UPDATE USER'S TELEGRAM CHAT ID
app.put("/api/users/:userId/telegram", async (req, res) => {
  try {
    const userId = req.params.userId;
    const { telegram_chat_id } = req.body;

    if (!telegram_chat_id) {
      return res.status(400).json({ 
        success: false, 
        message: "Telegram Chat ID is required" 
      });
    }

    await db.ref(`users/${userId}`).update({
      telegram_chat_id: telegram_chat_id.trim(),
      telegram_updated_at: Date.now()
    });

    console.log(`✅ Updated Telegram Chat ID for user ${userId}`);

    res.json({ 
      success: true, 
      message: "Telegram Chat ID updated successfully" 
    });

  } catch (error) {
    console.error("❌ Error updating Telegram:", error);
    res.status(500).json({ 
      success: false, 
      message: "Failed to update Telegram Chat ID" 
    });
  }
});

// TELEGRAM BOT WEBHOOK HANDLER
app.post("/api/telegram/webhook", async (req, res) => {
  try {
    const { message } = req.body;

    if (!message || !message.text) {
      return res.sendStatus(200);
    }

    const chatId = message.chat.id;
    const text = message.text.trim();

    console.log(`📱 Telegram command: ${text} from ${chatId}`);

    // /start command
    if (text === '/start') {
      await sendTelegramMessage(chatId, 
        `🏫 <b>Welcome to SukatTown Bot!</b>\n\n` +
        `Available commands:\n` +
        `/school_invcode - Get your school's invitation code\n` +
        `/help - Show all commands\n` +
        `/myid - Get your Chat ID\n\n` +
        `Your Chat ID: <code>${chatId}</code>`
      );
      return res.sendStatus(200);
    }

    // /help command
    if (text === '/help') {
      await sendTelegramMessage(chatId,
        `📚 <b>SukatTown Bot Commands</b>\n\n` +
        `🔑 /school_invcode - Get your school's invitation code\n` +
        `ℹ️ /help - Show this help message\n` +
        `🆔 /myid - Get your Telegram Chat ID`
      );
      return res.sendStatus(200);
    }

    // /myid command
    if (text === '/myid') {
      await sendTelegramMessage(chatId,
        `🆔 <b>Your Telegram Chat ID:</b>\n\n` +
        `<code>${chatId}</code>\n\n` +
        `Copy this and paste in SukatTown Settings.`
      );
      return res.sendStatus(200);
    }

    // /school_invcode command
    if (text === '/school_invcode') {
      const snapshot = await db.ref("users")
        .orderByChild("telegram_chat_id")
        .equalTo(chatId.toString())
        .once("value");

      if (!snapshot.exists()) {
        await sendTelegramMessage(chatId,
          `❌ <b>Not Found</b>\n\n` +
          `Your Telegram is not connected.\n\n` +
          `Steps:\n` +
          `1. Login to SukatTown\n` +
          `2. Go to Settings\n` +
          `3. Add Chat ID: <code>${chatId}</code>`
        );
        return res.sendStatus(200);
      }

      let user = null;
      snapshot.forEach(child => {
        user = child.val();
      });

      if (user.user_type !== 'principal' && user.user_type !== 'admin') {
        await sendTelegramMessage(chatId,
          `⚠️ <b>Access Denied</b>\n\n` +
          `Only principals/admins can view the invitation code.\n\n` +
          `Your role: ${user.user_type}`
        );
        return res.sendStatus(200);
      }

      const schoolSnapshot = await db.ref(`schools/${user.school_id}`).once("value");
      
      if (!schoolSnapshot.exists()) {
        await sendTelegramMessage(chatId, `❌ School not found.`);
        return res.sendStatus(200);
      }

      const school = schoolSnapshot.val();

      await sendTelegramMessage(chatId,
        `🏫 <b>${school.name}</b>\n\n` +
        `🔑 <b>Invitation Code:</b>\n` +
        `<code>${school.invite_code}</code>\n\n` +
        `📋 Share with staff to join your school.\n\n` +
        `⚠️ Keep confidential!`
      );

      return res.sendStatus(200);
    }

    // Unknown command
    await sendTelegramMessage(chatId, `❓ Unknown command. Type /help`);
    res.sendStatus(200);

  } catch (error) {
    console.error("❌ Telegram webhook error:", error);
    res.sendStatus(200);
  }
});

// SETUP TELEGRAM WEBHOOK
app.post("/api/telegram/setup-webhook", async (req, res) => {
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    return res.json({ success: false, message: "Bot token not configured" });
  }

  const webhookUrl = `https://sukattown-backend.onrender.com/api/telegram/webhook`;

  try {
    const response = await axios.post(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/setWebhook`,
      { url: webhookUrl, allowed_updates: ["message"] }
    );

    if (response.data.ok) {
      console.log(`✅ Telegram webhook set to: ${webhookUrl}`);
      res.json({ success: true, message: "Webhook setup successful" });
    } else {
      console.error('❌ Webhook setup failed:', response.data);
      res.json({ success: false, message: "Webhook setup failed" });
    }
  } catch (error) {
    console.error('❌ Webhook error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Update school privacy settings (principal/admin only)
app.put("/api/schools/:id/privacy", async (req, res) => {
  try {
    const schoolId = req.params.id;
    const userId = req.query.user_id;
    const userType = req.query.user_type;
    const { allowConsumptionView, allowBillingView } = req.body;

    // Get school data
    const schoolSnapshot = await db.ref(`schools/${schoolId}`).once("value");
    
    if (!schoolSnapshot.exists()) {
      return res.status(404).json({ success: false, message: "School not found" });
    }

    const school = schoolSnapshot.val();

    // Security: Only school admin/principal or system admin can update privacy
    if (userType !== 'admin' && school.admin_user_id !== userId) {
      return res.status(403).json({ 
        success: false, 
        message: "Only school administrators can update privacy settings" 
      });
    }

    await db.ref(`schools/${schoolId}/privacy`).update({
      allowConsumptionView: allowConsumptionView !== undefined ? allowConsumptionView : true,
      allowBillingView: allowBillingView !== undefined ? allowBillingView : false,
      updated_at: Date.now()
    });

    console.log(`✅ Privacy settings updated for school ${schoolId}`);
    res.json({ success: true, message: "Privacy settings updated" });

  } catch (err) {
    console.error("❌ Error updating privacy:", err);
    res.status(500).json({ success: false });
  }
});

// Get school members (principal/admin only)
app.get("/api/schools/:id/members", async (req, res) => {
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

    // Security: Only school admin/principal or system admin can view members
    if (userType !== 'admin' && userType !== 'principal') {
      return res.status(403).json({ 
        success: false, 
        message: "Only administrators can view school members" 
      });
    }

    // If not system admin, verify they belong to this school
    if (userType === 'principal' && school.admin_user_id !== userId) {
      return res.status(403).json({ 
        success: false, 
        message: "You can only view members from your own school" 
      });
    }

    // Get all users for this school
    const usersSnapshot = await db.ref("users")
      .orderByChild("school_id")
      .equalTo(schoolId)
      .once("value");

    const members = [];
    usersSnapshot.forEach((child) => {
      const user = child.val();
      members.push({
        id: child.key,
        name: user.name,
        email: user.email,
        user_type: user.user_type,
        account_type: user.account_type,
        created_at: user.created_at,
        last_login: user.last_login,
        telegram_connected: !!user.telegram_chat_id
      });
    });

    res.json({ 
      success: true, 
      school_name: school.name,
      count: members.length,
      members 
    });

  } catch (err) {
    console.error("❌ Error fetching members:", err);
    res.status(500).json({ success: false });
  }
});

// Get all schools with detailed info (admin only)
app.get("/api/admin/schools-overview", async (req, res) => {
  try {
    const userId = req.query.user_id;
    const userType = req.query.user_type;

    // Security: Only system admins can access this
    if (userType !== 'admin') {
      return res.status(403).json({ 
        success: false, 
        message: "Only system administrators can access this overview" 
      });
    }

    const schoolsSnapshot = await db.ref("schools").once("value");
    const schools = [];

    for (const schoolKey of Object.keys(schoolsSnapshot.val() || {})) {
      const school = schoolsSnapshot.val()[schoolKey];
      
      // Count members
      const memberCount = school.members ? school.members.length : 0;

      // Get principal info
      let principalName = 'N/A';
      if (school.admin_user_id) {
        const principalSnapshot = await db.ref(`users/${school.admin_user_id}`).once("value");
        if (principalSnapshot.exists()) {
          principalName = principalSnapshot.val().name;
        }
      }

      schools.push({
        id: schoolKey,
        name: school.name,
        address: school.address || 'Not specified',
        created_at: school.created_at,
        member_count: memberCount,
        principal_name: principalName,
        principal_id: school.admin_user_id,
        privacy: {
          allowConsumptionView: school.privacy?.allowConsumptionView !== false,
          allowBillingView: school.privacy?.allowBillingView === true
        }
      });
    }

    res.json({ 
      success: true, 
      count: schools.length,
      schools 
    });

  } catch (err) {
    console.error("❌ Error fetching schools overview:", err);
    res.status(500).json({ success: false, message: "Failed to fetch schools" });
  }
});

// Get school members with privacy check (admin only)
app.get("/api/admin/schools/:id/members", async (req, res) => {
  try {
    const schoolId = req.params.id;
    const userId = req.query.user_id;
    const userType = req.query.user_type;

    // Security: Only system admins can access this
    if (userType !== 'admin') {
      return res.status(403).json({ 
        success: false, 
        message: "Only system administrators can access this" 
      });
    }

    // Get school data
    const schoolSnapshot = await db.ref(`schools/${schoolId}`).once("value");
    
    if (!schoolSnapshot.exists()) {
      return res.status(404).json({ success: false, message: "School not found" });
    }

    const school = schoolSnapshot.val();

    // Check privacy settings - we'll return the status but let frontend handle display
    const privacyAllowed = true; // Admins can always attempt, but we return privacy status

    // Get all users for this school
    const usersSnapshot = await db.ref("users")
      .orderByChild("school_id")
      .equalTo(schoolId)
      .once("value");

    const members = [];
    usersSnapshot.forEach((child) => {
      const user = child.val();
      members.push({
        id: child.key,
        name: user.name,
        email: user.email,
        user_type: user.user_type,
        account_type: user.account_type,
        created_at: user.created_at,
        last_login: user.last_login,
        telegram_connected: !!user.telegram_chat_id
      });
    });

    res.json({ 
      success: true, 
      school_name: school.name,
      count: members.length,
      members,
      privacy: {
        allowConsumptionView: school.privacy?.allowConsumptionView !== false,
        allowBillingView: school.privacy?.allowBillingView === true
      }
    });

  } catch (err) {
    console.error("❌ Error fetching members:", err);
    res.status(500).json({ success: false });
  }
});

// Get school consumption data with privacy check (admin only)
app.get("/api/admin/schools/:id/consumption", async (req, res) => {
  try {
    const schoolId = req.params.id;
    const userType = req.query.user_type;
    const limit = parseInt(req.query.limit) || 50;

    // Security: Only system admins
    if (userType !== 'admin') {
      return res.status(403).json({ success: false, message: "Admin access only" });
    }

    // Check privacy settings
    const schoolSnapshot = await db.ref(`schools/${schoolId}`).once("value");
    if (!schoolSnapshot.exists()) {
      return res.status(404).json({ success: false, message: "School not found" });
    }

    const school = schoolSnapshot.val();
    const allowConsumptionView = school.privacy?.allowConsumptionView !== false;

    if (!allowConsumptionView) {
      return res.status(403).json({ 
        success: false, 
        message: "This school's principal has restricted consumption data access",
        privacy_restricted: true
      });
    }

    // Get consumption data
    const snapshot = await db.ref("readings")
      .orderByChild("school_id")
      .equalTo(schoolId)
      .limitToLast(limit)
      .once("value");

    const readings = [];
    snapshot.forEach((child) => {
      readings.push({ id: child.key, ...child.val() });
    });

    readings.reverse();

    res.json({ 
      success: true, 
      school_name: school.name,
      count: readings.length,
      data: readings 
    });

  } catch (err) {
    console.error("❌ Error fetching consumption:", err);
    res.status(500).json({ success: false });
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

// Get latest fire alert (for real-time monitoring)
app.get("/api/fire-alerts", async (req, res) => {
  try {
    const schoolId = req.query.school_id;
    
    if (!schoolId) {
      return res.status(400).json({ 
        success: false, 
        message: "school_id required" 
      });
    }
    
    console.log(`🔍 Fetching fire alerts for school: ${schoolId}`);
    
    // First try to get alerts WITH school_id
    let snapshot = await db
      .ref("fire_alerts")
      .orderByChild("school_id")
      .equalTo(schoolId)
      .limitToLast(1)
      .once("value");

    let latestAlert = null;
    snapshot.forEach((child) => {
      latestAlert = child.val();
      console.log(`✅ Found alert WITH school_id: ${JSON.stringify(latestAlert)}`);
    });

    // If no alert found WITH school_id, get the latest alert WITHOUT school_id filter
    // (for backwards compatibility with ESP32 that might not send school_id)
    if (!latestAlert) {
      console.log(`⚠️ No alert found for school ${schoolId}, checking all alerts...`);
      
      snapshot = await db
        .ref("fire_alerts")
        .orderByChild("timestamp")
        .limitToLast(1)
        .once("value");
      
      snapshot.forEach((child) => {
        const alert = child.val();
        // Only use this alert if it has no school_id OR matches our school_id
        if (!alert.school_id || alert.school_id === schoolId) {
          latestAlert = alert;
          console.log(`✅ Found alert WITHOUT school_id filter: ${JSON.stringify(latestAlert)}`);
        }
      });
    }

    if (!latestAlert) {
      console.log(`❌ No fire alerts found at all`);
      return res.status(404).json({ 
        success: false, 
        message: "No fire alerts available" 
      });
    }
    
    console.log(`📤 Returning fire alert: ${latestAlert.type}`);
    
    // Return the alert data directly (not wrapped in success object)
    res.json({
      type: latestAlert.type,
      flameDetected: latestAlert.flame_detected,
      smokeLevel: latestAlert.smoke_level,
      smokeThreshold: latestAlert.smoke_threshold,
      timestamp: latestAlert.timestamp
    });
  } catch (err) {
    console.error("❌ Firebase error:", err);
    res.status(500).json({ success: false, message: "Query failed" });
  }
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
    const schoolId = req.query.school_id;

    let query = db.ref("readings").orderByChild("timestamp").limitToLast(limit);
    
    const snapshot = await query.once("value");
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
    const schoolId = req.query.school_id;

    const snapshot = await db
      .ref("alerts")
      .orderByChild("timestamp")
      .limitToLast(limit)
      .once("value");
    let alerts = [];

    snapshot.forEach((child) => {
      const alert = child.val();
      if (!schoolId || alert.school_id === schoolId) {
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

  const cleanEmail = email.toLowerCase().trim();

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
  console.log(`📱 Telegram Bot: ${process.env.TELEGRAM_BOT_TOKEN ? 'Configured ✅' : 'Not configured ⚠️'}\n`);
});
