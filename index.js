const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const app = express();
require("dotenv").config();
const port = process.env.PORT || 3000;

const admin = require("firebase-admin");
// const serviceAccount = require("./garments-production-tracker-firebase-adminsdk.json");

const decoded = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString(
  "utf8",
);
const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

app.use(express.json());
app.use(cors());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster5656.l9idbez.mongodb.net/?appName=Cluster5656`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// MIDDLEWARE

const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).send({ message: "Unauthorized: No token provided" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.decoded_email = decoded.email;
    next();
  } catch (error) {
    return res.status(401).send({ message: "Unauthorized: Invalid token" });
  }
};

async function run() {
  try {
    await client.connect();

    const db = client.db("garments_production_db");
    const productsCollection = db.collection("products");
    const ordersCollection = db.collection("orders");
    const usersCollection = db.collection("users");

    // Admin middleware
    const verifyAdmin = async (req, res, next) => {
      const user = await usersCollection.findOne({ email: req.decoded_email }); //  await দরকার
      if (!user || user.role !== "admin") {
        return res.status(403).send({ message: "Forbidden: Admins only" });
      }
      next();
    };

    // Manager middleware
    const verifyManager = async (req, res, next) => {
      const user = await usersCollection.findOne({ email: req.decoded_email });
      if (!user || user.role !== "manager") {
        return res.status(403).send({ message: "Forbidden: Managers only" });
      }
      next();
    };

    // Admin || Manager
    const verifyAdminOrManager = async (req, res, next) => {
      const user = await usersCollection.findOne({ email: req.decoded_email });
      if (!user || !["admin", "manager"].includes(user.role)) {
        return res
          .status(403)
          .send({ message: "Forbidden: Admins or Managers only" });
      }
      next();
    };

    // PRODUCTS API
    app.get("/products", async (req, res) => {
      //  Public
      try {
        const result = await productsCollection
          .find({}, { sort: { createdAt: -1 } })
          .toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch products" });
      }
    });

    app.get("/products/:id", async (req, res) => {
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

    app.post("/products", verifyToken, verifyAdmin, async (req, res) => {
      try {
        const product = { ...req.body, createdAt: new Date() };
        const result = await productsCollection.insertOne(product);
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Failed to create product" });
      }
    });

    app.patch("/products/:id", verifyToken, verifyAdmin, async (req, res) => {
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

    app.delete("/products/:id", verifyToken, verifyAdmin, async (req, res) => {
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

    // USERS API
    app.post("/users/login", async (req, res) => {
      try {
        const { email, name, photoURL, uid } = req.body;
        if (!email) {
          return res
            .status(400)
            .send({ success: false, message: "Email is required" });
        }

        const existingUser = await usersCollection.findOne({ email });

        if (existingUser) {
          res.send({
            success: true,
            user: existingUser,
            message: "User logged in successfully",
          });
        } else {
          const newUser = {
            email,
            name: name || email.split("@")[0],
            photoURL: photoURL || null,
            uid: uid || null,
            role: "buyer",
            status: "active",
            totalOrders: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          const result = await usersCollection.insertOne(newUser);
          const createdUser = await usersCollection.findOne({
            _id: result.insertedId,
          });

          res.status(201).send({
            success: true,
            user: createdUser,
            message: "New user created successfully",
          });
        }
      } catch (error) {
        res
          .status(500)
          .send({ success: false, message: "Failed to process user login" });
      }
    });

    app.post("/users", async (req, res) => {
      //  Public
      try {
        const user = req.body;
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
        res
          .status(500)
          .send({ success: false, message: "Failed to create user" });
      }
    });

    app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
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
        res.status(500).send({ message: "Failed to fetch users" });
      }
    });

    app.get("/users/stats", verifyToken, verifyAdmin, async (req, res) => {
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
        res.status(500).send({ message: "Failed to fetch user stats" });
      }
    });

    app.post(
      "/users/bulk-delete",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
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
          res
            .status(500)
            .send({ success: false, message: "Failed to delete users" });
        }
      },
    );

    app.get("/users/email/:email", verifyToken, async (req, res) => {
      try {
        const requestedEmail = req.params.email;
        const requester = await usersCollection.findOne({
          email: req.decoded_email,
        });
        if (
          req.decoded_email !== requestedEmail &&
          requester?.role !== "admin"
        ) {
          return res.status(403).send({ message: "Forbidden: Access denied" });
        }

        const user = await usersCollection.findOne({ email: requestedEmail });
        if (!user) {
          return res
            .status(404)
            .send({ success: false, message: "User not found" });
        }
        res.send({ success: true, user });
      } catch (error) {
        res
          .status(500)
          .send({ success: false, message: "Failed to fetch user" });
      }
    });

    app.get("/users/:id", verifyToken, verifyAdmin, async (req, res) => {
      //  Admin only
      try {
        const result = await usersCollection.findOne({
          _id: new ObjectId(req.params.id),
        });
        if (!result) return res.status(404).send({ message: "User not found" });
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch user" });
      }
    });

    app.patch(
      "/users/:id/status",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
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
          res.status(500).send({ message: "Failed to update user status" });
        }
      },
    );

    app.patch("/users/:id/role", verifyToken, verifyAdmin, async (req, res) => {
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
        res.status(500).send({ message: "Failed to update user role" });
      }
    });

    app.patch("/users/:id", verifyToken, async (req, res) => {
      try {
        const { id } = req.params;
        const requester = await usersCollection.findOne({
          email: req.decoded_email,
        });
        const isSelf = requester?._id.toString() === id;
        const isAdmin = requester?.role === "admin";

        if (!isSelf && !isAdmin) {
          return res.status(403).send({ message: "Forbidden: Access denied" });
        }

        const updateData = { ...req.body };
        delete updateData._id;

        if (!isAdmin) {
          delete updateData.role;
          delete updateData.status;
        }

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
        res.status(500).send({ message: "Failed to update user" });
      }
    });

    app.delete("/users/:id", verifyToken, verifyAdmin, async (req, res) => {
      try {
        const result = await usersCollection.findOneAndDelete({
          _id: new ObjectId(req.params.id),
        });
        if (!result) return res.status(404).send({ message: "User not found" });
        res.send({ success: true, message: "User deleted successfully" });
      } catch (error) {
        res.status(500).send({ message: "Failed to delete user" });
      }
    });

    // ORDERS API

    app.post("/orders", verifyToken, async (req, res) => {
      try {
        const order = req.body;
        const orderCount = await ordersCollection.countDocuments();
        order.orderId = `ORD-${String(orderCount + 1).padStart(6, "0")}`;
        order.trackingNumber = `TRK-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        order.status = order.status || "pending";
        order.createdAt = new Date();
        order.updatedAt = new Date();

        order.statusHistory = [
          {
            status: "pending",
            timestamp: new Date(),
            location: "Online",
            note: "Order placed successfully",
          },
        ];

        const result = await ordersCollection.insertOne(order);

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
          trackingNumber: order.trackingNumber,
          message: "Order placed successfully!",
        });
      } catch (error) {
        res
          .status(500)
          .send({ success: false, message: "Failed to place order" });
      }
    });

    app.get("/orders", verifyToken, async (req, res) => {
      try {
        const { email, status, userId } = req.query;
        const query = {};

        const requester = await usersCollection.findOne({
          email: req.decoded_email,
        });

        if (requester?.role === "buyer") {
          query.userEmail = req.decoded_email;
        } else {
          if (email) query.userEmail = email;
          if (userId) query.userId = userId;
        }

        if (status) query.status = status;

        const result = await ordersCollection
          .find(query, { sort: { createdAt: -1 } })
          .toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch orders" });
      }
    });

    app.get(
      "/orders/approved",
      verifyToken,
      verifyAdminOrManager,
      async (req, res) => {
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
          res.status(500).send({ message: "Failed to fetch approved orders" });
        }
      },
    );

    app.get(
      "/orders/pending-stats",
      verifyToken,
      verifyAdminOrManager,
      async (req, res) => {
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
          res
            .status(500)
            .send({ message: "Failed to fetch pending statistics" });
        }
      },
    );

    app.get(
      "/orders/production-stats",
      verifyToken,
      verifyAdminOrManager,
      async (req, res) => {
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
          res
            .status(500)
            .send({ message: "Failed to fetch production statistics" });
        }
      },
    );

    app.get(
      "/orders/production/:status",
      verifyToken,
      verifyAdminOrManager,
      async (req, res) => {
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
      },
    );

    app.post(
      "/orders/bulk-approve",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const { orderIds } = req.body;
          if (!orderIds?.length)
            return res
              .status(400)
              .send({ success: false, message: "Order IDs required" });

          const historyEntry = {
            status: "confirmed",
            timestamp: new Date(),
            location: "Warehouse",
            note: "Order confirmed by admin",
          };

          const result = await ordersCollection.updateMany(
            {
              _id: { $in: orderIds.map((id) => new ObjectId(id)) },
              status: "pending",
            },
            {
              $set: {
                status: "confirmed",
                confirmedAt: new Date(),
                confirmedBy: req.decoded_email,
                updatedAt: new Date(),
              },
              $push: { statusHistory: historyEntry },
            },
          );
          res.send({
            success: true,
            message: `${result.modifiedCount} orders approved successfully`,
            approvedCount: result.modifiedCount,
          });
        } catch (error) {
          res
            .status(500)
            .send({ success: false, message: "Failed to approve orders" });
        }
      },
    );

    app.post(
      "/orders/bulk-reject",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const { orderIds, cancelReason } = req.body;
          if (!orderIds?.length)
            return res
              .status(400)
              .send({ success: false, message: "Order IDs required" });
          if (!cancelReason?.trim())
            return res.status(400).send({
              success: false,
              message: "Cancellation reason required",
            });

          const historyEntry = {
            status: "cancelled",
            timestamp: new Date(),
            location: "Admin Panel",
            note: cancelReason,
          };

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
                cancelledBy: req.decoded_email,
                updatedAt: new Date(),
              },
              $push: { statusHistory: historyEntry },
            },
          );
          res.send({
            success: true,
            message: `${result.modifiedCount} orders rejected successfully`,
            rejectedCount: result.modifiedCount,
          });
        } catch (error) {
          res
            .status(500)
            .send({ success: false, message: "Failed to reject orders" });
        }
      },
    );

    app.patch(
      "/orders/bulk-status-update",
      verifyToken,
      verifyAdminOrManager,
      async (req, res) => {
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

          const setFields = { status: newStatus, updatedAt: new Date() };
          if (newStatus === "in-production")
            setFields.productionStartedAt = new Date();
          if (newStatus === "packed") setFields.packedAt = new Date();
          if (newStatus === "in-transit") setFields.shippedAt = new Date();
          if (newStatus === "delivered") setFields.deliveredDate = new Date();

          const historyEntry = {
            status: newStatus,
            timestamp: new Date(),
            location: "",
            note: `Bulk status update to ${newStatus}`,
          };

          const result = await ordersCollection.updateMany(
            { _id: { $in: orderIds.map((id) => new ObjectId(id)) } },
            { $set: setFields, $push: { statusHistory: historyEntry } },
          );
          res.send({
            success: true,
            message: `${result.modifiedCount} orders updated to ${newStatus}`,
            modifiedCount: result.modifiedCount,
          });
        } catch (error) {
          res
            .status(500)
            .send({ success: false, message: "Failed to update orders" });
        }
      },
    );

    app.get("/orders/track/:query", async (req, res) => {
      try {
        const { query } = req.params;
        const order = await ordersCollection.findOne({
          $or: [
            { orderId: { $regex: new RegExp(`^${query}$`, "i") } },
            { trackingNumber: { $regex: new RegExp(`^${query}$`, "i") } },
          ],
        });

        if (!order) {
          return res.status(404).json({
            message:
              "Order not found. Please check your Order ID or Tracking Number.",
          });
        }
        res.json(order);
      } catch (error) {
        res.status(500).json({ message: "Internal server error." });
      }
    });

    app.get("/orders/:id", verifyToken, async (req, res) => {
      try {
        const result = await ordersCollection.findOne({
          _id: new ObjectId(req.params.id),
        });
        if (!result)
          return res.status(404).send({ message: "Order not found" });

        const requester = await usersCollection.findOne({
          email: req.decoded_email,
        });
        if (
          requester?.role === "buyer" &&
          result.userEmail !== req.decoded_email
        ) {
          return res.status(403).send({ message: "Forbidden: Not your order" });
        }

        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch order" });
      }
    });

    app.patch("/orders/:id/status", verifyToken, async (req, res) => {
      try {
        const { id } = req.params;
        const {
          status,
          cancelReason,
          cancelledBy,
          cancelledAt,
          confirmedAt,
          location,
          note,
        } = req.body;

        const order = await ordersCollection.findOne({ _id: new ObjectId(id) });
        if (!order) return res.status(404).send({ message: "Order not found" });

        const requester = await usersCollection.findOne({
          email: req.decoded_email,
        });
        if (requester?.role === "buyer") {
          if (order.userEmail !== req.decoded_email) {
            return res
              .status(403)
              .send({ message: "Forbidden: Not your order" });
          }
          if (status !== "cancelled") {
            return res
              .status(403)
              .send({ message: "Forbidden: Buyers can only cancel orders" });
          }
          if (!["pending", "confirmed"].includes(order.status)) {
            return res
              .status(400)
              .send({ message: "Order cannot be cancelled at this stage" });
          }
        }

        const validStatuses = [
          "pending",
          "confirmed",
          "in-production",
          "quality-check",
          "packed",
          "shipped",
          "in-transit",
          "out-for-delivery",
          "delivered",
          "cancelled",
        ];
        if (!validStatuses.includes(status))
          return res.status(400).send({ message: "Invalid status" });

        const setFields = { status, updatedAt: new Date() };

        if (status === "confirmed") {
          setFields.confirmedAt = confirmedAt
            ? new Date(confirmedAt)
            : new Date();
          setFields.confirmedBy = req.decoded_email;
        }
        if (status === "in-production")
          setFields.productionStartedAt = new Date();
        if (status === "packed") setFields.packedAt = new Date();
        if (status === "shipped" || status === "in-transit")
          setFields.shippedAt = new Date();
        if (status === "delivered") {
          setFields.deliveredAt = new Date();
          setFields.deliveredDate = new Date();
        }
        if (status === "cancelled") {
          setFields.cancelledAt = cancelledAt
            ? new Date(cancelledAt)
            : new Date();
          if (cancelReason) setFields.cancelReason = cancelReason;
          if (cancelledBy) setFields.cancelledBy = cancelledBy;

          if (order.paymentStatus === "paid") {
            setFields.paymentStatus = "refunded";
            setFields.refundedAt = new Date();
          }
        }

        const historyEntry = {
          status,
          timestamp: new Date(),
          location: location || "",
          note: note || cancelReason || "",
        };

        await ordersCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: setFields, $push: { statusHistory: historyEntry } },
        );

        res.send({
          success: true,
          message: `Order status updated to ${status}`,
        });
      } catch (error) {
        res.status(500).send({ message: "Failed to update order status" });
      }
    });

    app.patch("/orders/:id", verifyToken, verifyAdmin, async (req, res) => {
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
        res.status(500).send({ message: "Failed to update order" });
      }
    });

    app.delete("/orders/:id", verifyToken, verifyAdmin, async (req, res) => {
      try {
        const result = await ordersCollection.findOneAndDelete({
          _id: new ObjectId(req.params.id),
        });
        if (!result)
          return res.status(404).send({ message: "Order not found" });
        res.send({ success: true, message: "Order deleted successfully" });
      } catch (error) {
        res.status(500).send({ message: "Failed to delete order" });
      }
    });

    // await client.db("admin").command({ ping: 1 });
    // console.log("Connected to MongoDB successfully!");
  } finally {
    // await client.close();
  }
}

run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Garments Production Tracker is running!");
});

if (process.env.NODE_ENV !== "production") {
  app.listen(port, () => console.log(`Running on port ${port}`));
}

module.exports = app;
