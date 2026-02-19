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

    const productsCollection = db.collection("products");
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

    // Get Approved Orders
    app.get("/orders/approved", async (req, res) => {
      try {
        // Fetch all approved orders (not pending or cancelled)
        const approvedStatuses = [
          "confirmed",
          "in-production",
          "quality-check",
          "packed",
          "in-transit",
          "out-for-delivery",
          "delivered", // Optional: include delivered or make separate endpoint
        ];

        const query = {
          status: { $in: approvedStatuses },
        };

        const options = { sort: { confirmedAt: -1 } }; // Latest first
        const cursor = ordersCollection.find(query, options);
        const result = await cursor.toArray();

        res.send(result);
      } catch (error) {
        console.error("Get approved orders error:", error);
        res.status(500).send({ message: "Failed to fetch approved orders" });
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

    // order approval
    // app.patch("/orders/:id/status", async (req, res) => {
    //   try {
    //     const id = req.params.id;
    //     const { status, cancelReason, cancelledBy, confirmedAt } = req.body;

    //     const validStatuses = [
    //       "pending",
    //       "confirmed",
    //       "in-production",
    //       "quality-check",
    //       "packed",
    //       "in-transit",
    //       "out-for-delivery",
    //       "delivered",
    //       "cancelled",
    //     ];

    //     if (!validStatuses.includes(status)) {
    //       return res.status(400).send({
    //         success: false,
    //         message: "Invalid status",
    //       });
    //     }

    //     // Build update document
    //     const updateDoc = {
    //       $set: {
    //         status: status,
    //         updatedAt: new Date(),
    //       },
    //     };

    //     // Handle confirmation (approved)
    //     if (status === "confirmed" && confirmedAt) {
    //       updateDoc.$set.confirmedAt = confirmedAt;
    //       updateDoc.$set.confirmedBy = "admin";
    //     }

    //     // Handle delivery
    //     if (status === "delivered") {
    //       updateDoc.$set.deliveredDate = new Date();
    //     }

    //     // Handle cancellation/rejection
    //     if (status === "cancelled") {
    //       updateDoc.$set.cancelledAt = new Date();

    //       if (cancelReason) {
    //         updateDoc.$set.cancelReason = cancelReason;
    //       }

    //       if (cancelledBy) {
    //         updateDoc.$set.cancelledBy = cancelledBy;
    //       }

    //       // Auto-refund if paid
    //       const order = await ordersCollection.findOne({
    //         _id: new ObjectId(id),
    //       });
    //       if (order && order.paymentStatus === "paid") {
    //         updateDoc.$set.paymentStatus = "refunded";
    //         updateDoc.$set.refundedAt = new Date();
    //       }
    //     }

    //     // Update order
    //     const result = await ordersCollection.updateOne(
    //       { _id: new ObjectId(id) },
    //       updateDoc,
    //     );

    //     if (result.matchedCount === 0) {
    //       return res.status(404).send({
    //         success: false,
    //         message: "Order not found",
    //       });
    //     }

    //     // Get updated order
    //     const updatedOrder = await ordersCollection.findOne({
    //       _id: new ObjectId(id),
    //     });

    //     res.send({
    //       success: true,
    //       message:
    //         status === "confirmed"
    //           ? "Order approved successfully"
    //           : status === "cancelled"
    //             ? "Order rejected successfully"
    //             : `Order status updated to ${status}`,
    //       order: updatedOrder,
    //     });
    //   } catch (error) {
    //     console.error("Update status error:", error);
    //     res.status(500).send({
    //       success: false,
    //       message: "Failed to update order status",
    //     });
    //   }
    // });

    // Bulk Approve Orders
    app.post("/orders/bulk-approve", async (req, res) => {
      try {
        const { orderIds } = req.body;

        if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
          return res.status(400).send({
            success: false,
            message: "Order IDs are required",
          });
        }

        const objectIds = orderIds.map((id) => new ObjectId(id));

        const updateDoc = {
          $set: {
            status: "confirmed",
            confirmedAt: new Date(),
            confirmedBy: "admin",
            updatedAt: new Date(),
          },
        };

        // Update all pending orders to confirmed
        const result = await ordersCollection.updateMany(
          {
            _id: { $in: objectIds },
            status: "pending", // Only approve pending orders
          },
          updateDoc,
        );

        res.send({
          success: true,
          message: `${result.modifiedCount} orders approved successfully`,
          approvedCount: result.modifiedCount,
        });
      } catch (error) {
        console.error("Bulk approve error:", error);
        res.status(500).send({
          success: false,
          message: "Failed to approve orders",
        });
      }
    });

    // Bulk Reject Orders

    app.post("/orders/bulk-reject", async (req, res) => {
      try {
        const { orderIds, cancelReason } = req.body;

        if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
          return res.status(400).send({
            success: false,
            message: "Order IDs are required",
          });
        }

        if (!cancelReason || !cancelReason.trim()) {
          return res.status(400).send({
            success: false,
            message: "Cancellation reason is required",
          });
        }

        const objectIds = orderIds.map((id) => new ObjectId(id));

        const updateDoc = {
          $set: {
            status: "cancelled",
            cancelledAt: new Date(),
            cancelReason: cancelReason,
            cancelledBy: "admin",
            updatedAt: new Date(),
          },
        };

        // Update all pending orders to cancelled
        const result = await ordersCollection.updateMany(
          {
            _id: { $in: objectIds },
            status: "pending", // Only reject pending orders
          },
          updateDoc,
        );

        res.send({
          success: true,
          message: `${result.modifiedCount} orders rejected successfully`,
          rejectedCount: result.modifiedCount,
        });
      } catch (error) {
        console.error("Bulk reject error:", error);
        res.status(500).send({
          success: false,
          message: "Failed to reject orders",
        });
      }
    });

    // Get Pending Orders Statistics

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

        // Group by payment method
        const paymentMethods = {};
        pendingOrders.forEach((order) => {
          const method = order.paymentMethod || "Unknown";
          if (!paymentMethods[method]) {
            paymentMethods[method] = { count: 0, total: 0 };
          }
          paymentMethods[method].count++;
          paymentMethods[method].total += order.total || 0;
        });

        // Get oldest pending order
        const oldestOrder =
          pendingOrders.length > 0
            ? pendingOrders.sort(
                (a, b) => new Date(a.createdAt) - new Date(b.createdAt),
              )[0]
            : null;

        res.send({
          totalPending,
          totalValue: totalValue.toFixed(2),
          avgValue: avgValue.toFixed(2),
          paymentMethods,
          oldestOrderDate: oldestOrder ? oldestOrder.createdAt : null,
          oldestOrderId: oldestOrder ? oldestOrder.orderId : null,
        });
      } catch (error) {
        console.error("Pending stats error:", error);
        res.status(500).send({ message: "Failed to fetch pending statistics" });
      }
    });

    // --- Approved Orders ----

    //Get Orders by Specific Status
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

        if (!validStatuses.includes(status)) {
          return res.status(400).send({ message: "Invalid status" });
        }

        const query = { status: status };
        const options = { sort: { updatedAt: -1 } };
        const cursor = ordersCollection.find(query, options);
        const result = await cursor.toArray();

        res.send(result);
      } catch (error) {
        console.error("Get orders by status error:", error);
        res.status(500).send({ message: "Failed to fetch orders" });
      }
    });

    // Production Stats (for dashboard)
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

        // Average production time (if confirmed date exists)
        const completedOrders = approvedOrders.filter(
          (o) => o.status === "packed" && o.confirmedAt,
        );

        if (completedOrders.length > 0) {
          const avgTime =
            completedOrders.reduce((sum, o) => {
              const start = new Date(o.confirmedAt);
              const end = new Date(o.updatedAt);
              return sum + (end - start) / (1000 * 60 * 60 * 24); // days
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

    //Bulk Status Update (for production line)
    app.patch("/orders/bulk-status-update", async (req, res) => {
      try {
        const { orderIds, newStatus } = req.body;

        if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
          return res.status(400).send({
            success: false,
            message: "Order IDs are required",
          });
        }

        const validStatuses = [
          "confirmed",
          "in-production",
          "quality-check",
          "packed",
          "in-transit",
          "out-for-delivery",
          "delivered",
        ];

        if (!validStatuses.includes(newStatus)) {
          return res.status(400).send({
            success: false,
            message: "Invalid status",
          });
        }

        const objectIds = orderIds.map((id) => new ObjectId(id));

        const updateDoc = {
          $set: {
            status: newStatus,
            updatedAt: new Date(),
          },
        };

        // Add specific timestamps
        if (newStatus === "in-production") {
          updateDoc.$set.productionStartedAt = new Date();
        } else if (newStatus === "packed") {
          updateDoc.$set.packedAt = new Date();
        } else if (newStatus === "in-transit") {
          updateDoc.$set.shippedAt = new Date();
        } else if (newStatus === "delivered") {
          updateDoc.$set.deliveredDate = new Date();
        }

        const result = await ordersCollection.updateMany(
          { _id: { $in: objectIds } },
          updateDoc,
        );

        res.send({
          success: true,
          message: `${result.modifiedCount} orders updated to ${newStatus}`,
          modifiedCount: result.modifiedCount,
        });
      } catch (error) {
        console.error("Bulk status update error:", error);
        res.status(500).send({
          success: false,
          message: "Failed to update orders",
        });
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
