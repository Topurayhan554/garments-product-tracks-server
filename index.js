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

// Middleware
app.use(express.json());
app.use(cors());

const verifyFBToken = (req, res, next) => {
  const token = req.headers.authorization;
  if (!token) return res.status(401).send({ message: "unauthorized access" });
  next();
};

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster5656.l9idbez.mongodb.net/?appName=Cluster5656`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();

    const db = client.db("garments_production_db");
    const productsCollection = db.collection("products");
    const ordersCollection = db.collection("orders");
    const usersCollection = db.collection("users");

    // ==============================================
    // PRODUCTS API
    // ==============================================

    app.get("/products", async (req, res) => {
      try {
        const result = await productsCollection
          .find({}, { sort: { createdAt: -1 } })
          .toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch products" });
      }
    });

    app.post("/products", async (req, res) => {
      try {
        const product = { ...req.body, createdAt: new Date() };
        const result = await productsCollection.insertOne(product);
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Failed to create product" });
      }
    });

    app.get("/products/:id", verifyFBToken, async (req, res) => {
      try {
        const result = await productsCollection.findOne({
          _id: new ObjectId(req.params.id),
        });
        if (!result)
          return res.status(404).send({ message: "Product not found" });
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch product" });
      }
    });

    app.patch("/products/:id", async (req, res) => {
      try {
        const updateData = { ...req.body };
        delete updateData._id;
        delete updateData.createdAt;
        updateData.updatedAt = new Date();

        const result = await productsCollection.updateOne(
          { _id: new ObjectId(req.params.id) },
          { $set: updateData },
        );
        if (result.matchedCount === 0)
          return res.status(404).json({ message: "Product not found" });

        const updated = await productsCollection.findOne({
          _id: new ObjectId(req.params.id),
        });
        res.json({ message: "Product updated successfully", data: updated });
      } catch (error) {
        res.status(500).json({ message: "Failed to update product" });
      }
    });

    app.delete("/products/:id", async (req, res) => {
      try {
        const result = await productsCollection.findOneAndDelete({
          _id: new ObjectId(req.params.id),
        });
        if (!result)
          return res.status(404).send({ message: "Product not found" });
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Failed to delete product" });
      }
    });

    // ==============================================
    // USERS API
    // ⚠️ Static routes BEFORE dynamic /:id routes!
    // ==============================================

    // GET all users (with optional filters)
    app.get("/users", async (req, res) => {
      try {
        const { role, status, search } = req.query;
        const query = {};

        if (role && role !== "all") query.role = role;
        if (status && status !== "all") query.status = status;
        if (search) {
          query.$or = [
            { name: { $regex: search, $options: "i" } },
            { email: { $regex: search, $options: "i" } },
          ];
        }

        const result = await usersCollection
          .find(query, { sort: { createdAt: -1 } })
          .toArray();
        res.send(result);
      } catch (error) {
        console.error("Get users error:", error);
        res.status(500).send({ message: "Failed to fetch users" });
      }
    });

    // POST create user
    app.post("/users", async (req, res) => {
      try {
        const user = req.body;

        // Check if email already exists
        const existing = await usersCollection.findOne({ email: user.email });
        if (existing) {
          return res.status(409).send({
            success: false,
            message: "User with this email already exists",
          });
        }

        user.role = user.role || "buyer";
        user.status = user.status || "pending";
        user.totalOrders = 0;
        user.createdAt = new Date();
        user.updatedAt = new Date();

        const result = await usersCollection.insertOne(user);
        res.status(201).send({
          success: true,
          insertedId: result.insertedId,
          message: "User created successfully!",
        });
      } catch (error) {
        console.error("Create user error:", error);
        res
          .status(500)
          .send({ success: false, message: "Failed to create user" });
      }
    });

    // POST bulk delete users
    // ⚠️ Must be BEFORE /users/:id
    app.post("/users/bulk-delete", async (req, res) => {
      try {
        const { userIds } = req.body;
        if (!userIds?.length) {
          return res
            .status(400)
            .send({ success: false, message: "User IDs required" });
        }

        const objectIds = userIds.map((id) => new ObjectId(id));
        const result = await usersCollection.deleteMany({
          _id: { $in: objectIds },
        });

        res.send({
          success: true,
          message: `${result.deletedCount} users deleted successfully`,
          deletedCount: result.deletedCount,
        });
      } catch (error) {
        console.error("Bulk delete users error:", error);
        res
          .status(500)
          .send({ success: false, message: "Failed to delete users" });
      }
    });

    // GET user stats summary
    // ⚠️ Must be BEFORE /users/:id
    app.get("/users/stats", async (req, res) => {
      try {
        const allUsers = await usersCollection.find({}).toArray();

        const stats = {
          total: allUsers.length,
          admin: allUsers.filter((u) => u.role === "admin").length,
          manager: allUsers.filter((u) => u.role === "manager").length,
          buyer: allUsers.filter((u) => u.role === "buyer").length,
          active: allUsers.filter((u) => u.status === "active").length,
          inactive: allUsers.filter((u) => u.status === "inactive").length,
          pending: allUsers.filter((u) => u.status === "pending").length,
        };

        res.send(stats);
      } catch (error) {
        console.error("User stats error:", error);
        res.status(500).send({ message: "Failed to fetch user stats" });
      }
    });

    // GET single user by ID
    app.get("/users/:id", async (req, res) => {
      try {
        const result = await usersCollection.findOne({
          _id: new ObjectId(req.params.id),
        });
        if (!result) return res.status(404).send({ message: "User not found" });
        res.send(result);
      } catch (error) {
        console.error("Get user error:", error);
        res.status(500).send({ message: "Failed to fetch user" });
      }
    });

    // PATCH update user status only
    app.patch("/users/:id/status", async (req, res) => {
      try {
        const { id } = req.params;
        const { status } = req.body;

        const validStatuses = ["active", "inactive", "pending"];
        if (!validStatuses.includes(status)) {
          return res.status(400).send({ message: "Invalid status" });
        }

        const result = await usersCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status, updatedAt: new Date() } },
        );

        if (result.matchedCount === 0)
          return res.status(404).send({ message: "User not found" });

        res.send({
          success: true,
          message: `User status updated to ${status}`,
        });
      } catch (error) {
        console.error("Update user status error:", error);
        res.status(500).send({ message: "Failed to update user status" });
      }
    });

    // PATCH update user role only
    app.patch("/users/:id/role", async (req, res) => {
      try {
        const { id } = req.params;
        const { role } = req.body;

        const validRoles = ["admin", "manager", "buyer"];
        if (!validRoles.includes(role)) {
          return res.status(400).send({ message: "Invalid role" });
        }

        const result = await usersCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { role, updatedAt: new Date() } },
        );

        if (result.matchedCount === 0)
          return res.status(404).send({ message: "User not found" });

        res.send({ success: true, message: `User role updated to ${role}` });
      } catch (error) {
        console.error("Update user role error:", error);
        res.status(500).send({ message: "Failed to update user role" });
      }
    });

    // PATCH full user update
    app.patch("/users/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const updateData = { ...req.body };
        delete updateData._id;
        updateData.updatedAt = new Date();

        const result = await usersCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updateData },
        );

        if (result.matchedCount === 0)
          return res.status(404).send({ message: "User not found" });

        const updated = await usersCollection.findOne({
          _id: new ObjectId(id),
        });
        res.send({
          success: true,
          message: "User updated successfully",
          data: updated,
        });
      } catch (error) {
        console.error("Update user error:", error);
        res.status(500).send({ message: "Failed to update user" });
      }
    });

    // DELETE single user
    app.delete("/users/:id", async (req, res) => {
      try {
        const result = await usersCollection.findOneAndDelete({
          _id: new ObjectId(req.params.id),
        });
        if (!result) return res.status(404).send({ message: "User not found" });
        res.send({ success: true, message: "User deleted successfully" });
      } catch (error) {
        console.error("Delete user error:", error);
        res.status(500).send({ message: "Failed to delete user" });
      }
    });

    // ==============================================
    // ORDERS API
    // ⚠️ Static routes BEFORE dynamic /:id routes!
    // ==============================================

    // POST create order
    app.post("/orders", async (req, res) => {
      try {
        const order = req.body;
        const orderCount = await ordersCollection.countDocuments();
        order.orderId = `ORD-${String(orderCount + 1).padStart(6, "0")}`;
        order.trackingNumber = `TRK-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        order.status = order.status || "pending";
        order.createdAt = new Date();
        order.updatedAt = new Date();

        const result = await ordersCollection.insertOne(order);

        // Increment user's totalOrders if userEmail exists
        if (order.userEmail) {
          await usersCollection.updateOne(
            { email: order.userEmail },
            { $inc: { totalOrders: 1 } },
          );
        }

        res.status(201).send({
          success: true,
          insertedId: result.insertedId,
          orderId: order.orderId,
          message: "Order placed successfully!",
        });
      } catch (error) {
        console.error("Create order error:", error);
        res
          .status(500)
          .send({ success: false, message: "Failed to place order" });
      }
    });

    // POST bulk approve
    app.post("/orders/bulk-approve", async (req, res) => {
      try {
        const { orderIds } = req.body;
        if (!orderIds?.length)
          return res
            .status(400)
            .send({ success: false, message: "Order IDs required" });

        const result = await ordersCollection.updateMany(
          {
            _id: { $in: orderIds.map((id) => new ObjectId(id)) },
            status: "pending",
          },
          {
            $set: {
              status: "confirmed",
              confirmedAt: new Date(),
              confirmedBy: "admin",
              updatedAt: new Date(),
            },
          },
        );
        res.send({
          success: true,
          message: `${result.modifiedCount} orders approved successfully`,
          approvedCount: result.modifiedCount,
        });
      } catch (error) {
        console.error("Bulk approve error:", error);
        res
          .status(500)
          .send({ success: false, message: "Failed to approve orders" });
      }
    });

    // POST bulk reject
    app.post("/orders/bulk-reject", async (req, res) => {
      try {
        const { orderIds, cancelReason } = req.body;
        if (!orderIds?.length)
          return res
            .status(400)
            .send({ success: false, message: "Order IDs required" });
        if (!cancelReason?.trim())
          return res
            .status(400)
            .send({ success: false, message: "Cancellation reason required" });

        const result = await ordersCollection.updateMany(
          {
            _id: { $in: orderIds.map((id) => new ObjectId(id)) },
            status: "pending",
          },
          {
            $set: {
              status: "cancelled",
              cancelledAt: new Date(),
              cancelReason,
              cancelledBy: "admin",
              updatedAt: new Date(),
            },
          },
        );
        res.send({
          success: true,
          message: `${result.modifiedCount} orders rejected successfully`,
          rejectedCount: result.modifiedCount,
        });
      } catch (error) {
        console.error("Bulk reject error:", error);
        res
          .status(500)
          .send({ success: false, message: "Failed to reject orders" });
      }
    });

    // GET all orders
    app.get("/orders", async (req, res) => {
      try {
        const { email, status, userId } = req.query;
        const query = {};
        if (email) query.userEmail = email;
        if (userId) query.userId = userId;
        if (status) query.status = status;

        const result = await ordersCollection
          .find(query, { sort: { createdAt: -1 } })
          .toArray();
        res.send(result);
      } catch (error) {
        console.error("Get orders error:", error);
        res.status(500).send({ message: "Failed to fetch orders" });
      }
    });

    // GET approved orders
    // ⚠️ Must be BEFORE /orders/:id
    app.get("/orders/approved", async (req, res) => {
      try {
        const approvedStatuses = [
          "confirmed",
          "in-production",
          "quality-check",
          "packed",
          "in-transit",
          "out-for-delivery",
        ];
        const result = await ordersCollection
          .find(
            { status: { $in: approvedStatuses } },
            { sort: { confirmedAt: -1 } },
          )
          .toArray();
        res.send(result);
      } catch (error) {
        console.error("Get approved orders error:", error);
        res.status(500).send({ message: "Failed to fetch approved orders" });
      }
    });

    // GET pending stats
    // ⚠️ Must be BEFORE /orders/:id
    app.get("/orders/pending-stats", async (req, res) => {
      try {
        const pendingOrders = await ordersCollection
          .find({ status: "pending" })
          .toArray();

        const totalPending = pendingOrders.length;
        const totalValue = pendingOrders.reduce(
          (sum, o) => sum + (o.total || 0),
          0,
        );
        const avgValue = totalPending > 0 ? totalValue / totalPending : 0;

        const paymentMethods = {};
        pendingOrders.forEach((order) => {
          const method = order.paymentMethod || "Unknown";
          if (!paymentMethods[method])
            paymentMethods[method] = { count: 0, total: 0 };
          paymentMethods[method].count++;
          paymentMethods[method].total += order.total || 0;
        });

        const sorted = [...pendingOrders].sort(
          (a, b) => new Date(a.createdAt) - new Date(b.createdAt),
        );
        const oldest = sorted[0] || null;

        res.send({
          totalPending,
          totalValue: totalValue.toFixed(2),
          avgValue: avgValue.toFixed(2),
          paymentMethods,
          oldestOrderDate: oldest?.createdAt || null,
          oldestOrderId: oldest?.orderId || null,
        });
      } catch (error) {
        console.error("Pending stats error:", error);
        res.status(500).send({ message: "Failed to fetch pending statistics" });
      }
    });

    // GET production stats
    // ⚠️ Must be BEFORE /orders/:id
    app.get("/orders/production-stats", async (req, res) => {
      try {
        const approvedStatuses = [
          "confirmed",
          "in-production",
          "quality-check",
          "packed",
          "in-transit",
          "out-for-delivery",
        ];
        const approvedOrders = await ordersCollection
          .find({ status: { $in: approvedStatuses } })
          .toArray();

        const stats = {
          total: approvedOrders.length,
          confirmed: approvedOrders.filter((o) => o.status === "confirmed")
            .length,
          inProduction: approvedOrders.filter(
            (o) => o.status === "in-production",
          ).length,
          qualityCheck: approvedOrders.filter(
            (o) => o.status === "quality-check",
          ).length,
          packed: approvedOrders.filter((o) => o.status === "packed").length,
          inTransit: approvedOrders.filter((o) =>
            ["in-transit", "out-for-delivery"].includes(o.status),
          ).length,
          totalValue: approvedOrders.reduce(
            (sum, o) => sum + (o.total || 0),
            0,
          ),
        };

        const completedOrders = approvedOrders.filter(
          (o) => o.status === "packed" && o.confirmedAt,
        );
        if (completedOrders.length > 0) {
          const avgTime =
            completedOrders.reduce((sum, o) => {
              return (
                sum +
                (new Date(o.updatedAt) - new Date(o.confirmedAt)) /
                  (1000 * 60 * 60 * 24)
              );
            }, 0) / completedOrders.length;
          stats.avgProductionDays = avgTime.toFixed(1);
        }

        res.send(stats);
      } catch (error) {
        console.error("Production stats error:", error);
        res
          .status(500)
          .send({ message: "Failed to fetch production statistics" });
      }
    });

    // GET orders by production status
    // ⚠️ Must be BEFORE /orders/:id
    app.get("/orders/production/:status", async (req, res) => {
      try {
        const { status } = req.params;
        const validStatuses = [
          "confirmed",
          "in-production",
          "quality-check",
          "packed",
          "in-transit",
          "out-for-delivery",
        ];
        if (!validStatuses.includes(status))
          return res.status(400).send({ message: "Invalid status" });

        const result = await ordersCollection
          .find({ status }, { sort: { updatedAt: -1 } })
          .toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch orders" });
      }
    });

    // PATCH bulk status update
    // ⚠️ Must be BEFORE /orders/:id
    app.patch("/orders/bulk-status-update", async (req, res) => {
      try {
        const { orderIds, newStatus } = req.body;
        if (!orderIds?.length)
          return res
            .status(400)
            .send({ success: false, message: "Order IDs required" });

        const validStatuses = [
          "confirmed",
          "in-production",
          "quality-check",
          "packed",
          "in-transit",
          "out-for-delivery",
          "delivered",
        ];
        if (!validStatuses.includes(newStatus))
          return res
            .status(400)
            .send({ success: false, message: "Invalid status" });

        const updateDoc = {
          $set: { status: newStatus, updatedAt: new Date() },
        };
        if (newStatus === "in-production")
          updateDoc.$set.productionStartedAt = new Date();
        if (newStatus === "packed") updateDoc.$set.packedAt = new Date();
        if (newStatus === "in-transit") updateDoc.$set.shippedAt = new Date();
        if (newStatus === "delivered")
          updateDoc.$set.deliveredDate = new Date();

        const result = await ordersCollection.updateMany(
          { _id: { $in: orderIds.map((id) => new ObjectId(id)) } },
          updateDoc,
        );
        res.send({
          success: true,
          message: `${result.modifiedCount} orders updated to ${newStatus}`,
          modifiedCount: result.modifiedCount,
        });
      } catch (error) {
        console.error("Bulk status update error:", error);
        res
          .status(500)
          .send({ success: false, message: "Failed to update orders" });
      }
    });

    // GET single order by ID
    app.get("/orders/:id", async (req, res) => {
      try {
        const result = await ordersCollection.findOne({
          _id: new ObjectId(req.params.id),
        });
        if (!result)
          return res.status(404).send({ message: "Order not found" });
        res.send(result);
      } catch (error) {
        console.error("Get order error:", error);
        res.status(500).send({ message: "Failed to fetch order" });
      }
    });

    // PATCH update order status
    app.patch("/orders/:id/status", async (req, res) => {
      try {
        const { id } = req.params;
        const { status, cancelReason, cancelledBy, confirmedAt } = req.body;

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
        if (!validStatuses.includes(status))
          return res.status(400).send({ message: "Invalid status" });

        const updateDoc = { $set: { status, updatedAt: new Date() } };

        if (status === "confirmed") {
          updateDoc.$set.confirmedAt = confirmedAt
            ? new Date(confirmedAt)
            : new Date();
          updateDoc.$set.confirmedBy = "admin";
        }
        if (status === "delivered") updateDoc.$set.deliveredDate = new Date();
        if (status === "cancelled") {
          updateDoc.$set.cancelledAt = new Date();
          if (cancelReason) updateDoc.$set.cancelReason = cancelReason;
          if (cancelledBy) updateDoc.$set.cancelledBy = cancelledBy;

          const order = await ordersCollection.findOne({
            _id: new ObjectId(id),
          });
          if (order?.paymentStatus === "paid") {
            updateDoc.$set.paymentStatus = "refunded";
            updateDoc.$set.refundedAt = new Date();
          }
        }

        const result = await ordersCollection.updateOne(
          { _id: new ObjectId(id) },
          updateDoc,
        );
        if (result.matchedCount === 0)
          return res.status(404).send({ message: "Order not found" });

        res.send({
          success: true,
          message: `Order status updated to ${status}`,
        });
      } catch (error) {
        console.error("Update status error:", error);
        res.status(500).send({ message: "Failed to update order status" });
      }
    });

    // PATCH full order update
    app.patch("/orders/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const updateData = { ...req.body };
        delete updateData._id;
        updateData.updatedAt = new Date();

        const result = await ordersCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updateData },
        );
        if (result.matchedCount === 0)
          return res.status(404).send({ message: "Order not found" });

        const updated = await ordersCollection.findOne({
          _id: new ObjectId(id),
        });
        res.send({
          success: true,
          message: "Order updated successfully",
          data: updated,
        });
      } catch (error) {
        console.error("Update order error:", error);
        res.status(500).send({ message: "Failed to update order" });
      }
    });

    // DELETE order
    app.delete("/orders/:id", async (req, res) => {
      try {
        const result = await ordersCollection.findOneAndDelete({
          _id: new ObjectId(req.params.id),
        });
        if (!result)
          return res.status(404).send({ message: "Order not found" });
        res.send({ success: true, message: "Order deleted successfully" });
      } catch (error) {
        console.error("Delete order error:", error);
        res.status(500).send({ message: "Failed to delete order" });
      }
    });

    // Confirm connection
    await client.db("admin").command({ ping: 1 });
    console.log("✅ Connected to MongoDB successfully!");
  } finally {
    // await client.close();
  }
}

run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("🧵 Garments Production Tracker is running!");
});

app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});
