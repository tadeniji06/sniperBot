const express = require("express");
const router = express.Router();
const mintController = require("../controllers/mintController");

router.post("/", mintController.handleMint);

module.exports = router;
