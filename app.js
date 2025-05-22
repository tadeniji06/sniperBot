require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mintRoute = require("./routes/mintRoute");

const app = express();
app.use(cors());
app.use(express.json());

app.use("/mint", mintRoute);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🧠 Bot running on port ${PORT}`);
});
