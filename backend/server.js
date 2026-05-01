  require("dotenv").config();
  // require("dotenv").config({ path: "./backend/.env" });
  // require("dotenv").config({ path: __dirname + "/.env" });

  const express = require("express");
  const cors = require("cors");
  const QRCode = require("qrcode");
  const nodemailer = require("nodemailer");

  const app = express();

  app.use(cors());
  app.use(express.json());
  app.use(express.static("public"));

  const admin = require("firebase-admin");

  // const serviceAccount = require("./wedding-system-e3097-firebase-adminsdk-fbsvc-68061e3b7c.json");
  // console.log("Project:", serviceAccount.project_id);
  console.log("Project:", process.env.FIREBASE_PROJECT_ID);
  console.log("PRIVATE KEY LENGTH:", process.env.FIREBASE_PRIVATE_KEY?.length);

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,

      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    }),
  });
  // admin.initializeApp({
  //   credential: admin.credential.cert(serviceAccount),
  //   projectId: "wedding-system-e3097",
  // });

  console.log("EMAIL:", process.env.GMAIL_USER);
  console.log("PASS:", process.env.GMAIL_PASS);

  // ✅ FIXED: Explicit projectId + error handling
  // admin.initializeApp({
  //   credential: admin.credential.cert(serviceAccount),
  //   projectId: "wedding-system-e3097",
  // });

  const db = admin.firestore();

  // ✅ Test Firestore connection
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

  const PORT = process.env.PORT || 3000;

  const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS,
  },
});

  async function sendDeclinedEmail(guest) {
    let transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_PASS,
      },
    });

    await transporter.sendMail({
      from: `Wedding RSVP <${process.env.GMAIL_USER}>`, // ✅ ADD THIS
      to: guest.email,
      subject: "Wedding Invitation Update",
      html: `
        <h2>Hi ${guest.firstName},</h2>
        <p>We’re sorry to inform you that your request has not been approved for the wedding invitation.</p>
        <p>Thank you for understanding.</p>
        <br/>
        <p>— Wedding Team 💔</p>
      `,
    });
  }

  // =========================
  // EMAIL FUNCTION
  // =========================
  async function sendQRCodeEmail(guest, guestId) {
    let transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_PASS,
      },
    });

    // 👉 IMPORTANT: palitan mo ito kapag deployed na
    const baseUrl = process.env.BASE_URL || "http://localhost:3000";
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
        <p><b>OR click below to view your invitation:</b></p>
        <a href="${guestLink}" style="display:inline-block;padding:10px 20px;background:#ff4d6d;color:white;text-decoration:none;border-radius:5px;">
          View Your Invitation
        </a>
        <p>See you at the wedding! 💍</p>
      `,
    });
  }

  const guestsCollection = db.collection("guests");

  // =========================
  // ROUTES
  // =========================

  // test route
  app.get("/", (req, res) => {
    res.send("Server is running!");
  });

  // get all guests
  app.get("/guests", async (req, res) => {
    try {
      const snapshot = await guestsCollection.get();
      const guests = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      res.json(guests);
    } catch (err) {
      console.error("Error fetching guests:", err);
      res.status(500).json({ message: "Failed to fetch guests" });
    }
  });

  // get single guest
  app.get("/guest/:id", async (req, res) => {
    const doc = await guestsCollection.doc(req.params.id).get();

    if (!doc.exists) {
      return res.status(404).json({ message: "Not found" });
    }

    res.json({
      id: doc.id,
      ...doc.data(),
    });
  });

  // register guest
  app.post("/register", async (req, res) => {
    const { firstName, middleName, lastName, age, address, email } = req.body;

    if (!firstName || !lastName || !email) {
      return res.status(400).json({
        message: "First, Last name and Email required",
      });
    }

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

    try {
      const docRef = await guestsCollection.add(guest);

      guest.id = docRef.id;

      res.json({
        message: "Registration successful!",
        guest,
      });

      console.log("Guest added:", guest);
    } catch (err) {
      console.error("Error adding guest:", err);
      res.status(500).json({ message: "Failed to register guest" });
    }
  });

  // update status
  app.put("/guests/:id/status", async (req, res) => {
    console.log("REQ BODY:", req.body);
    console.log("STATUS RAW:", req.body.status);

    const { id } = req.params;
    let { status } = req.body;

    console.log("RAW STATUS:", req.body.status);
  console.log("FINAL STATUS:", status);
  console.log("TYPE:", typeof status);

    const allowedStatus = ["PENDING", "APPROVED", "DECLINED"];
    status = status.toUpperCase();

    if (!allowedStatus.includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    try {
      const guestRef = guestsCollection.doc(id);
      const doc = await guestRef.get();

      if (!doc.exists) {
        return res.status(404).json({ message: "Guest not found" });
      }

      const guest = doc.data();

      await guestRef.update({ status });

      // Only generate QR if approved
      console.log("🔥 APPROVED BLOCK TRIGGERED");
      console.log("📧 SENDING EMAIL NOW...");
      if (status === "APPROVED") {
  console.log("🔥 APPROVED BLOCK TRIGGERED");
  console.log("📧 SENDING EMAIL NOW...");

  const qrData = `guest-${id}`;
  const qrImage = await QRCode.toDataURL(qrData);

  await guestRef.update({ qrCode: qrImage });

  guest.qrCode = qrImage;

  try {
    await sendQRCodeEmail(
      {
        ...guest,
        email: guest.email,
        firstName: guest.firstName,
        qrCode: qrImage,
      },
      id
    );

    console.log(`📩 QR EMAIL SENT TO: ${guest.email}`);
  } catch (err) {
    console.error("❌ EMAIL FAILED:", err);
  }
}else if (status === "DECLINED") {
        try {
          const updatedDoc = await guestRef.get();
          const updatedGuest = updatedDoc.data();

          console.log("DECLINED email:", updatedGuest.email);

          await sendDeclinedEmail({
            email: guest.email,
            firstName: guest.firstName,
          });

          console.log("Declined email sent");
        } catch (err) {
          console.error("DECLINED EMAIL ERROR:", err);
        }
      }

      res.json({
        message: "Status updated",
        guest: { id, ...guest, status },
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to update status" });
    }
  });

  // scan QR
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
        return res.status(400).json({ message: "QR Code already used" });
      }

      if (guest.status !== "APPROVED") {
        return res.status(403).json({ message: "Guest not approved" });
      }

      await doc.ref.update({ isUsed: true });

      res.json({
        message: "Check-in successful",
        guest: {
          id: doc.id,
          ...guest,
          isUsed: true,
        },
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to scan QR" });
    }
  });

  // =========================
  // START SERVER
  // =========================
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
