const express = require("express");
const cors = require("cors");
const app = express();
const PORT = process.env.PORT || 3000;


const mysql = require("mysql2");

const db = mysql.createConnection({
  host: "sql105.infinityfree.com",
  user: "if0_40358009",
  password: "Mackenzie122807",
  database: "if0_40358009_sukattown_db",
  port: 3306,
});

db.connect((err) => {
  if (err) {
    console.error("MySQL connection failed:", err);
  } else {
    console.log("Connected to InfinityFree MySQL");
  }
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

// Receive data from ESP32
app.post("/api/power-data", (req, res) => {
  const data = req.body;

  console.log("Received PZEM data from ESP32:", data);

  // Update latest data
  latestPZEMData = {
    ...data,
    timestamp: Date.now(),
  };

  // Save to MySQL
  const { voltage, current, power, energy, frequency, powerFactor } = req.body;

  db.query(
    "INSERT INTO readings (voltage, current, power, energy, frequency, powerFactor) VALUES (?, ?, ?, ?, ?, ?)",
    [voltage, current, power, energy, frequency, powerFactor],
    (err) => {
      if (err) {
        console.error("Insert error:", err);
      } else {
        console.log("Reading saved");
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
  res.json(latestPZEMData);
});

// Makes SukatTown accessible
app.use(express.static("public"));

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`POST /api/power-data - Receive ESP32 data`);
  console.log(`GET /api/power-data - Get latest data`);
});
