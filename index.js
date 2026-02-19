const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const app = express();
require("dotenv").config();
const port = process.env.PORT || 3000;

const admin = require("firebase-admin");

const serviceAccount = require("./garments-production-tracker-firebase-adminsdk.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// middleware
app.use(express.json());
app.use(cors());

const verifyFBToken = (req, res, next) => {
  console.log("headers", req.headers.authorization);

  const token = req.headers.authorization;
  if (!token) {
    return res.status(401).send({ message: "unauthorized access" });
  }
  next();
};

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster5656.l9idbez.mongodb.net/?appName=Cluster5656`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const db = client.db("garments_production_db");

    const productsCollection = db.collection("/products");
    const ordersCollection = db.collection("orders");

    // product api

    app.get("/products", async (req, res) => {
      const query = {};
      const options = { sort: { createdAt: -1 } };

      // if (req.query.email) {
      //   query.email = req.query.email;
      // }

      const cursor = productsCollection.find(query, options);
      const result = await cursor.toArray();

      res.send(result);
    });

    app.post("/products", async (req, res) => {
      const product = req.body;
      const result = await productsCollection.insertOne(product);
      res.send(result);
    });

    app.delete("/products/:id", async (req, res) => {
      const result = await productsCollection.findOneAndDelete({
        _id: new ObjectId(req.params.id),
      });

      res.send(result);
    });

    // Get single product by ID
    app.get("/products/:id", verifyFBToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await productsCollection.findOne(query);
      res.send(result);
    });

    // Update
    app.patch("/products/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const updateData = req.body;

        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ message: "Invalid product ID" });
        }

        delete updateData._id;
        delete updateData.createdAt;
        updateData.updatedAt = new Date();

        const result = await productsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updateData },
        );

        if (result.matchedCount === 0) {
          return res.status(404).json({ message: "Product not found" });
        }

        const updatedProduct = await productsCollection.findOne({
          _id: new ObjectId(id),
        });

        res.status(200).json({
          message: "Product updated successfully",
          data: updatedProduct,
        });
      } catch (error) {
        console.error("Update product error:", error);
        res.status(500).json({ message: "Failed to update product" });
      }
    });

    // 1. CREATE ORDER (POST)
    app.post("/orders", async (req, res) => {
      try {
        const order = req.body;

        // Generate unique order ID
        const orderCount = await ordersCollection.countDocuments();
        const orderId = `ORD-${String(orderCount + 1).padStart(6, "0")}`;

        // Add order ID and tracking number
        order.orderId = orderId;
        order.trackingNumber = `TRK-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        order.createdAt = new Date();
        order.updatedAt = new Date();

        const result = await ordersCollection.insertOne(order);

        res.status(201).send({
          success: true,
          insertedId: result.insertedId,
          orderId: orderId,
          message: "Order placed successfully!",
        });
      } catch (error) {
        console.error("Create order error:", error);
        res.status(500).send({
          success: false,
          message: "Failed to place order",
        });
      }
    });

    // 2. GET ALL ORDERS (with filters)

    app.get("/orders", async (req, res) => {
      try {
        const { email, status, userId } = req.query;
        const query = {};

        // Filter by user email
        if (email) {
          query.userEmail = email;
        }

        // Filter by user ID
        if (userId) {
          query.userId = userId;
        }

        // Filter by status
        if (status) {
          query.status = status;
        }

        const options = { sort: { createdAt: -1 } }; // Latest first
        const cursor = ordersCollection.find(query, options);
        const result = await cursor.toArray();

        res.send(result);
      } catch (error) {
        console.error("Get orders error:", error);
        res.status(500).send({ message: "Failed to fetch orders" });
      }
    });

    // 3. GET SINGLE ORDER by ID

    app.get("/orders/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await ordersCollection.findOne(query);

        if (!result) {
          return res.status(404).send({ message: "Order not found" });
        }

        res.send(result);
      } catch (error) {
        console.error("Get order error:", error);
        res.status(500).send({ message: "Failed to fetch order" });
      }
    });

    // 5. UPDATE ORDER STATUS
    app.patch("/orders/:id/status", async (req, res) => {
      try {
        const id = req.params.id;
        const { status } = req.body;

        const validStatuses = [
          "pending",
          "confirmed",
          "in-production",
          "quality-check",
          "packed",
          "in-transit",
          "out-for-delivery",
          "delivered",
          "cancelled",
        ];

        if (!validStatuses.includes(status)) {
          return res.status(400).send({ message: "Invalid status" });
        }

        const updateDoc = {
          $set: {
            status: status,
            updatedAt: new Date(),
          },
        };

        // Add delivery date if status is delivered
        if (status === "delivered") {
          updateDoc.$set.deliveredDate = new Date();
        }

        const result = await ordersCollection.updateOne(
          { _id: new ObjectId(id) },
          updateDoc,
        );

        if (result.matchedCount === 0) {
          return res.status(404).send({ message: "Order not found" });
        }

        res.send({
          success: true,
          message: `Order status updated to ${status}`,
        });
      } catch (error) {
        console.error("Update status error:", error);
        res.status(500).send({ message: "Failed to update order status" });
      }
    });
    // 6. UPDATE ORDER (Full update)

    app.patch("/orders/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const updateData = req.body;

        delete updateData._id;
        updateData.updatedAt = new Date();

        const result = await ordersCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updateData },
        );

        if (result.matchedCount === 0) {
          return res.status(404).send({ message: "Order not found" });
        }

        const updatedOrder = await ordersCollection.findOne({
          _id: new ObjectId(id),
        });

        res.send({
          success: true,
          message: "Order updated successfully",
          data: updatedOrder,
        });
      } catch (error) {
        console.error("Update order error:", error);
        res.status(500).send({ message: "Failed to update order" });
      }
    });

    // 7. DELETE ORDER

    app.delete("/orders/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const result = await ordersCollection.findOneAndDelete({
          _id: new ObjectId(id),
        });

        if (!result) {
          return res.status(404).send({ message: "Order not found" });
        }

        res.send({
          success: true,
          message: "Order deleted successfully",
        });
      } catch (error) {
        console.error("Delete order error:", error);
        res.status(500).send({ message: "Failed to delete order" });
      }
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!",
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("garments products tracker is running!");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
