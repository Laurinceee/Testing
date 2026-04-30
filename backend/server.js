require("dotenv").config();

const express = require("express");
const cors = require("cors");
const QRCode = require("qrcode");
const nodemailer = require("nodemailer");

const admin = require("firebase-admin");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

/* =========================
   FIREBASE INIT (FIXED)
========================= */
const serviceAccount = require("./wedding-system-e3097-firebase-adminsdk-fbsvc-68061e3b7c.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: process.env.FIREBASE_PRIVATE_KEY
    ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
    : undefined,
});

const db = admin.firestore();

/* =========================
   ENV CHECK (optional safety)
========================= */
console.log("EMAIL:", process.env.GMAIL_USER);

/* =========================
   FIRESTORE TEST
========================= */
async function testFirestoreConnection() {
  try {
    await db.listCollections();
    console.log("✅ Firestore connected successfully!");
  } catch (error) {
    console.error("❌ Firestore connection failed:", error);
    process.exit(1);
  }
}
testFirestoreConnection();

/* =========================
   MAIL TRANSPORT
========================= */
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS,
  },
});

/* =========================
   EMAIL: APPROVED QR
========================= */
async function sendQRCodeEmail(guest, guestId) {
  const baseUrl = process.env.BASE_URL;

  const guestLink = `${baseUrl}/guest.html?id=${guestId}`;

  await transporter.sendMail({
    from: `Wedding RSVP <${process.env.GMAIL_USER}>`,
    to: guest.email,
    subject: "Your Wedding Invitation 💍",
    html: `
      <h2>Hi ${guest.firstName} 💖</h2>
      <p>You are invited to our wedding!</p>

      <p><b>Your QR Code:</b></p>
      <img src="${guest.qrCode}" width="200"/>

      <p><b>Or view your invitation:</b></p>
      <a href="${guestLink}" style="padding:10px 20px;background:#ff4d6d;color:#fff;text-decoration:none;border-radius:5px;">
        Open Invitation
      </a>

      <p>See you! 💍</p>
    `,
  });
}

/* =========================
   EMAIL: DECLINED
========================= */
async function sendDeclinedEmail(guest) {
  await transporter.sendMail({
    from: `Wedding RSVP <${process.env.GMAIL_USER}>`,
    to: guest.email,
    subject: "Wedding Invitation Update",
    html: `
      <h2>Hi ${guest.firstName}</h2>
      <p>Sorry, your invitation request was not approved.</p>
      <p>Thank you for understanding.</p>
      <br/>
      <p>— Wedding Team</p>
    `,
  });
}

/* =========================
   COLLECTION
========================= */
const guestsCollection = db.collection("guests");

/* =========================
   ROUTES
========================= */

// Health check
app.get("/", (req, res) => {
  res.send("Server is running!");
});

// GET all guests
app.get("/guests", async (req, res) => {
  try {
    const snapshot = await guestsCollection.get();
    const guests = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    res.json(guests);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch guests" });
  }
});

// GET single guest
app.get("/guest/:id", async (req, res) => {
  try {
    const doc = await guestsCollection.doc(req.params.id).get();

    if (!doc.exists) {
      return res.status(404).json({ message: "Not found" });
    }

    res.json({ id: doc.id, ...doc.data() });
  } catch (err) {
    res.status(500).json({ message: "Error fetching guest" });
  }
});

// REGISTER guest
app.post("/register", async (req, res) => {
  const { firstName, middleName, lastName, age, address, email } = req.body;

  if (!firstName || !lastName || !email) {
    return res.status(400).json({
      message: "First name, last name, and email are required",
    });
  }

  try {
    const guest = {
      firstName,
      middleName,
      lastName,
      age,
      address,
      email,
      status: "PENDING",
      qrCode: null,
      isUsed: false,
      createdAt: new Date(),
    };

    const docRef = await guestsCollection.add(guest);

    res.json({
      message: "Registration successful",
      id: docRef.id,
      ...guest,
    });
  } catch (err) {
    res.status(500).json({ message: "Failed to register guest" });
  }
});

// UPDATE STATUS
app.put("/guests/:id/status", async (req, res) => {
  const { id } = req.params;
  let { status } = req.body;

  const allowed = ["PENDING", "APPROVED", "DECLINED"];
  status = status.toUpperCase();

  if (!allowed.includes(status)) {
    return res.status(400).json({ message: "Invalid status" });
  }

  try {
    const ref = guestsCollection.doc(id);
    const doc = await ref.get();

    if (!doc.exists) {
      return res.status(404).json({ message: "Guest not found" });
    }

    const guest = doc.data();

    await ref.update({ status });

    // APPROVED
    if (status === "APPROVED") {
      const qrData = `guest-${id}`;
      const qrImage = await QRCode.toDataURL(qrData);

      await ref.update({ qrCode: qrImage });

      await sendQRCodeEmail({ ...guest, qrCode: qrImage }, id);
    }

    // DECLINED
    if (status === "DECLINED") {
      await sendDeclinedEmail(guest);
    }

    res.json({
      message: "Status updated",
      id,
      status,
    });
  } catch (err) {
    res.status(500).json({ message: "Failed to update status" });
  }
});

// QR SCAN
app.post("/scan", async (req, res) => {
  const { qrData } = req.body;

  try {
    const id = qrData.replace("guest-", "");
    const doc = await guestsCollection.doc(id).get();

    if (!doc.exists) {
      return res.status(404).json({ message: "Invalid QR Code" });
    }

    const guest = doc.data();

    if (guest.isUsed) {
      return res.status(400).json({ message: "Already used" });
    }

    if (guest.status !== "APPROVED") {
      return res.status(403).json({ message: "Not approved" });
    }

    await doc.ref.update({ isUsed: true });

    res.json({
      message: "Check-in successful",
      guest: { id, ...guest, isUsed: true },
    });
  } catch (err) {
    res.status(500).json({ message: "Scan failed" });
  }
});

/* =========================
   START SERVER
========================= */
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
