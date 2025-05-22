const mintSUI = require("../services/mintSUI");
const mintBSC = require("../services/mintBSC");
const mintBASE = require("../services/mintBASE");
// const mintSOL = require("../services/mintSOL"); // stub

exports.handleMint = async (req, res) => {
  const { chain, ...mintData } = req.body;

  try {
    let result;

    switch (chain.toUpperCase()) {
      case "SUI":
        result = await mintSUI(mintData);
        break;
      case "BSC":
        result = await mintBSC(mintData);
        break;
      case "BASE":
        result = await mintBASE(mintData);
        break;
      case "SOL":
        result = { success: false, msg: "SOL mint not yet implemented" };
        break;
      default:
        return res.status(400).json({ success: false, msg: "Unsupported chain" });
    }

    res.status(200).json({ success: true, ...result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, msg: "Minting error", error: err.message });
  }
};
