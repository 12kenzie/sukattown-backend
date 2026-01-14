// telegramBot.js - Telegram Bot Commands Handler

const axios = require('axios');

/**
 * Send a formatted Telegram message with timestamp
 */
async function sendTelegramMessage(chatId, text, botToken) {
  if (!botToken) {
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
    
    // Add timestamp footer with both human-readable and ISO format
    const messageWithTimestamp = `${text}\n\n⏰ <b>Server Time:</b> ${readableTime}\n🔖 <code>${isoTimestamp}</code>`;
    
    // Send directly to the specified chatId
    await axios.post(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
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

/**
 * Send invitation code to new principal
 */
async function sendInviteCode(chatId, schoolName, inviteCode, principalName, botToken) {
  if (!chatId || !botToken) {
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

  await sendTelegramMessage(chatId, message, botToken);
}

/**
 * Handle /start command
 */
async function handleStartCommand(chatId, botToken) {
  const message = 
    `🏫 <b>Welcome to SukatTown Bot!</b>\n\n` +
    `Available commands:\n` +
    `/school_invcode - Get your school's invitation code\n` +
    `/help - Show all commands\n` +
    `/myid - Get your Chat ID\n\n` +
    `Your Chat ID: <code>${chatId}</code>`;
  
  await sendTelegramMessage(chatId, message, botToken);
}

/**
 * Handle /help command
 */
async function handleHelpCommand(chatId, botToken) {
  const message =
    `📚 <b>SukatTown Bot Commands</b>\n\n` +
    `🔑 /school_invcode - Get your school's invitation code\n` +
    `ℹ️ /help - Show this help message\n` +
    `🆔 /myid - Get your Telegram Chat ID`;
  
  await sendTelegramMessage(chatId, message, botToken);
}

/**
 * Handle /myid command
 */
async function handleMyIdCommand(chatId, botToken) {
  const message =
    `🆔 <b>Your Telegram Chat ID:</b>\n\n` +
    `<code>${chatId}</code>\n\n` +
    `Copy this and paste in SukatTown Settings.`;
  
  await sendTelegramMessage(chatId, message, botToken);
}

/**
 * Handle /school_invcode command
 */
async function handleSchoolInvcodeCommand(chatId, db, botToken) {
  const snapshot = await db.ref("users")
    .orderByChild("telegram_chat_id")
    .equalTo(chatId.toString())
    .once("value");

  if (!snapshot.exists()) {
    const message =
      `❌ <b>Not Found</b>\n\n` +
      `Your Telegram is not connected.\n\n` +
      `Steps:\n` +
      `1. Login to SukatTown\n` +
      `2. Go to Settings\n` +
      `3. Add Chat ID: <code>${chatId}</code>`;
    
    await sendTelegramMessage(chatId, message, botToken);
    return;
  }

  let user = null;
  snapshot.forEach(child => {
    user = child.val();
  });

  if (user.user_type !== 'principal' && user.user_type !== 'admin') {
    const message =
      `⚠️ <b>Access Denied</b>\n\n` +
      `Only principals/admins can view the invitation code.\n\n` +
      `Your role: ${user.user_type}`;
    
    await sendTelegramMessage(chatId, message, botToken);
    return;
  }

  const schoolSnapshot = await db.ref(`schools/${user.school_id}`).once("value");
  
  if (!schoolSnapshot.exists()) {
    await sendTelegramMessage(chatId, `❌ School not found.`, botToken);
    return;
  }

  const school = schoolSnapshot.val();

  const message =
    `🏫 <b>${school.name}</b>\n\n` +
    `🔑 <b>Invitation Code:</b>\n` +
    `<code>${school.invite_code}</code>\n\n` +
    `📋 Share with staff to join your school.\n\n` +
    `⚠️ Keep confidential!`;

  await sendTelegramMessage(chatId, message, botToken);
}

/**
 * Handle unknown command
 */
async function handleUnknownCommand(chatId, botToken) {
  await sendTelegramMessage(chatId, `❓ Unknown command. Type /help`, botToken);
}

/**
 * Main webhook handler - processes incoming Telegram messages
 */
async function handleWebhook(req, db, botToken) {
  try {
    const { message } = req.body;

    if (!message || !message.text) {
      return { success: true };
    }

    const chatId = message.chat.id;
    const text = message.text.trim();

    console.log(`📱 Telegram command: ${text} from ${chatId}`);

    // Route commands to appropriate handlers
    switch (text) {
      case '/start':
        await handleStartCommand(chatId, botToken);
        break;
      
      case '/help':
        await handleHelpCommand(chatId, botToken);
        break;
      
      case '/myid':
        await handleMyIdCommand(chatId, botToken);
        break;
      
      case '/school_invcode':
        await handleSchoolInvcodeCommand(chatId, db, botToken);
        break;
      
      default:
        await handleUnknownCommand(chatId, botToken);
        break;
    }

    return { success: true };

  } catch (error) {
    console.error("❌ Telegram webhook error:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Setup Telegram webhook
 */
async function setupWebhook(webhookUrl, botToken) {
  if (!botToken) {
    return { success: false, message: "Bot token not configured" };
  }

  try {
    const response = await axios.post(
      `https://api.telegram.org/bot${botToken}/setWebhook`,
      { url: webhookUrl, allowed_updates: ["message"] }
    );

    if (response.data.ok) {
      console.log(`✅ Telegram webhook set to: ${webhookUrl}`);
      return { success: true, message: "Webhook setup successful" };
    } else {
      console.error('❌ Webhook setup failed:', response.data);
      return { success: false, message: "Webhook setup failed" };
    }
  } catch (error) {
    console.error('❌ Webhook error:', error.message);
    return { success: false, message: error.message };
  }
}

module.exports = {
  sendTelegramMessage,
  sendInviteCode,
  handleWebhook,
  setupWebhook,
  // Export individual handlers if needed
  handleStartCommand,
  handleHelpCommand,
  handleMyIdCommand,
  handleSchoolInvcodeCommand,
  handleUnknownCommand
};