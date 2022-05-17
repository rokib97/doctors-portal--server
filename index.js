const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
var nodemailer = require("nodemailer");
var sgTransport = require("nodemailer-sendgrid-transport");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const app = express();
require("dotenv").config();
const port = process.env.PORT || 5000;

// middleware
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.alyaj.mongodb.net/myFirstDatabase?retryWrites=true&w=majority`;
const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverApi: ServerApiVersion.v1,
});

// verify JWT
const verifyJWT = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).send({ message: "UnAuthorized Access" });
  }
  const token = authHeader.split(" ")[1];
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, function (err, decoded) {
    if (err) {
      return res.status(403).send({ message: "Forbidden Access" });
    }
    req.decoded = decoded;
    next();
  });
};

// send mail to booking user
const emailSenderOptions = {
  auth: {
    api_key: process.env.EMAIL_SENDER_NEW_API,
  },
};

console.log(emailSenderOptions.auth.api_key);
var emailClient = nodemailer.createTransport(sgTransport(emailSenderOptions));
const sendAppoinmentEmail = (booking) => {
  const { patient, patientName, date, treatment, slot } = booking;
  const email = {
    from: process.env.EMAIL_SENDER,
    to: patient,
    subject: `Your Appoinment for ${treatment} is on ${date} at ${slot} is confirmed.`,
    text: `Your Appoinment for ${treatment} is on ${date} at ${slot} is confirmed.`,
    html: `
    <div>
      <p>Hello ${patientName},</p>
      <h3>Your Appoinment is Confirmed for ${treatment}</h3>
      <p>Looking forward to see you on ${date} at ${slot}</p>
      <h3>Our Address</h3>
      <p>AndorKilla Bandorbon, Bangladesh</p>
      <a href="https://www.programming-hero.com/">Subscribe</a>
    </div>
    `,
  };
  emailClient.sendMail(email, function (err, info) {
    if (err) {
      console.log(err);
    } else {
      console.log("Message sent: ", info);
    }
  });
};

async function run() {
  try {
    await client.connect();
    const serviceCollection = client
      .db("doctors_portal")
      .collection("services");
    const bookingCollection = client.db("doctors_portal").collection("booking");
    const userCollection = client.db("doctors_portal").collection("users");
    const doctorCollection = client.db("doctors_portal").collection("doctors");

    // verify admin
    const verifyAdmin = async (req, res, next) => {
      const requester = req.decoded.email;
      const requesterAccount = await userCollection.findOne({
        email: requester,
      });
      if (requesterAccount.role === "admin") {
        next();
      } else {
        res.status(403).send({ message: "Forbidden Access" });
      }
    };
    // get services data
    app.get("/service", async (req, res) => {
      const query = {};
      const cursor = serviceCollection.find(query).project({ name: 1 });
      const services = await cursor.toArray();
      res.send(services);
    });

    // get all users
    app.get("/user", verifyJWT, async (req, res) => {
      const users = await userCollection.find().toArray();
      res.send(users);
    });

    // admin or not Api
    app.get("/admin/:email", async (req, res) => {
      const email = req.params.email;
      const user = await userCollection.findOne({ email: email });
      const isAdmin = user.role === "admin";
      res.send({ admin: isAdmin });
    });
    // make user admin api
    app.put("/user/admin/:email", verifyJWT, verifyAdmin, async (req, res) => {
      const email = req.params.email;
      const filter = { email: email };
      const updateDoc = {
        $set: { role: "admin" },
      };
      const result = await userCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    // api for user info data update / create
    app.put("/user/:email", async (req, res) => {
      const email = req.params.email;
      const user = req.body;
      const filter = { email: email };
      const options = { upsert: true };
      const updateDoc = {
        $set: user,
      };
      const result = await userCollection.updateOne(filter, updateDoc, options);
      const token = jwt.sign(
        { email: email },
        process.env.ACCESS_TOKEN_SECRET,
        { expiresIn: "1d" }
      );
      res.send({ result, token });
    });

    // available services api
    app.get("/available", async (req, res) => {
      const date = req.query.date;

      //step 1: get the all services
      const services = await serviceCollection.find().toArray();

      //step 2: get the booking of that day
      const query = { date: date };
      const bookings = await bookingCollection.find(query).toArray();

      // step 3 : for each service
      services.map((service) => {
        //step 4 : find bookings for that service
        const serviceBooking = bookings.filter(
          (book) => book.treatment === service.name
        );
        //step 5 : select slots for the service Booking
        const bookedSlots = serviceBooking.map((book) => book.slot);
        //step 6 : select those slots that are not in bookedSlots
        const available = service.slots.filter(
          (slot) => !bookedSlots.includes(slot)
        );
        service.slots = available;
      });

      res.send(services);
    });

    /**
     * API Naming Convention
     * app.get('/booking') //get all booking in the collection or more than one by filter query
     * app.get("/booking:id") // get a specific booking
     * app.post("/booking:id")  // add a new booking
     * app.patch("/booking:id")  // update a booking
     * app.put('/booking:id) // upsert ==> update (if exists) or insert (if doesn't exists)
     * app.delete("/booking:id")  // delete a booking
     */

    //find booking api
    app.get("/booking", verifyJWT, async (req, res) => {
      const patient = req.query.patient;
      const decodedEmail = req.decoded.email;
      if (patient === decodedEmail) {
        const query = { patient: patient };
        const bookings = await bookingCollection.find(query).toArray();
        return res.send(bookings);
      } else {
        return res.status(403).send({ message: "Forbidden Access" });
      }
    });

    // api using id for single booking for payment
    app.get("/booking/:id", verifyJWT, async (req, res) => {
      const id = req.params.id;
      const query = { _id: ObjectId(id) };
      const booking = await bookingCollection.findOne(query);
      res.send(booking);
    });

    // post single booking api
    app.post("/booking", async (req, res) => {
      const booking = req.body;
      const query = {
        treatment: booking.treatment,
        date: booking.date,
        patient: booking.patient,
      };
      //check if the appoinment already is there or not
      const exists = await bookingCollection.findOne(query);
      if (exists) {
        return res.send({ success: false, booking: exists });
      }
      const result = await bookingCollection.insertOne(booking);
      console.log("Sending Email");
      sendAppoinmentEmail(booking);
      return res.send({ success: true, result });
    });
    // doctor collection api
    app.post("/doctor", verifyJWT, verifyAdmin, async (req, res) => {
      const doctor = req.body;
      const result = await doctorCollection.insertOne(doctor);

      res.send(result);
    });
    // manage doctors api
    app.get("/doctor", verifyJWT, verifyAdmin, async (req, res) => {
      const doctors = await doctorCollection.find().toArray();
      res.send(doctors);
    });

    // delete doctor api
    app.delete("/doctor/:email", verifyJWT, verifyAdmin, async (req, res) => {
      const email = req.params.email;
      const filter = { email: email };
      const doctors = await doctorCollection.deleteOne(filter);
      res.send(doctors);
    });
  } finally {
    // await client.close();
  }
}
run().catch(console.dir);
app.get("/", (req, res) => {
  res.send("Hello From Doctors Portal!");
});

app.listen(port, () => {
  console.log(`Doctors Portal app listening on port ${port}`);
});
