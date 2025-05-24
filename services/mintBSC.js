const { ethers } = require("ethers");

// Enhanced BSC handler with comprehensive error handling
module.exports = async ({ privateKey, contractAddress, mintQuantity }) => {
  let provider, wallet, contract;

  try {
    // Input validation
    if (!privateKey) {
      return { success: false, msg: "Private key is required", code: "MISSING_PRIVATE_KEY" };
    }

    if (!contractAddress) {
      return { success: false, msg: "Contract address is required", code: "MISSING_CONTRACT_ADDRESS" };
    }

    if (!mintQuantity || mintQuantity < 1) {
      return { success: false, msg: "Mint quantity must be at least 1", code: "INVALID_QUANTITY" };
    }

    // Validate Ethereum address format
    if (!ethers.isAddress(contractAddress)) {
      return { success: false, msg: "Invalid contract address format", code: "INVALID_ADDRESS_FORMAT" };
    }

    // Initialize provider with multiple fallback RPCs
    const rpcUrls = [
      "https://bsc-dataseed.binance.org/",
      "https://bsc-dataseed1.defibit.io/",
      "https://bsc-dataseed1.ninicoin.io/",
      "https://bsc.drpc.org/"
    ];

    let providerConnected = false;
    for (const rpcUrl of rpcUrls) {
      try {
        provider = new ethers.JsonRpcProvider(rpcUrl);
        await provider.getNetwork(); // Test connection
        providerConnected = true;
        break;
      } catch (rpcError) {
        console.warn(`Failed to connect to ${rpcUrl}:`, rpcError.message);
        continue;
      }
    }

    if (!providerConnected) {
      return { success: false, msg: "Unable to connect to BSC network. All RPC endpoints are down.", code: "RPC_CONNECTION_FAILED" };
    }

    // Validate and create wallet
    try {
      wallet = new ethers.Wallet(privateKey, provider);
    } catch (keyError) {
      return { success: false, msg: "Invalid private key format", code: "INVALID_PRIVATE_KEY" };
    }

    // Check wallet balance
    try {
      const balance = await wallet.provider.getBalance(wallet.address);
      const balanceInBnb = ethers.formatEther(balance);
      
      if (parseFloat(balanceInBnb) < 0.005) { // Minimum balance check for BSC
        return { 
          success: false, 
          msg: `Insufficient BNB balance. Current: ${parseFloat(balanceInBnb).toFixed(4)} BNB. Minimum required: 0.005 BNB`, 
          code: "INSUFFICIENT_BALANCE" 
        };
      }
    } catch (balanceError) {
      return { success: false, msg: "Failed to check wallet balance", code: "BALANCE_CHECK_FAILED" };
    }

    // Enhanced ABI with multiple mint function signatures
    const abi = [
      "function mint(uint256 _amount) public payable",
      "function mint(address to, uint256 amount) public payable",
      "function publicMint(uint256 quantity) public payable",
      "function mintTo(address recipient, uint256 quantity) public payable",
      "function safeMint(address to, uint256 tokenId) public payable",
      "function batchMint(uint256 quantity) public payable"
    ];

    // Create contract instance
    try {
      contract = new ethers.Contract(contractAddress, abi, wallet);
    } catch (contractError) {
      return { success: false, msg: "Failed to create contract instance", code: "CONTRACT_INSTANCE_FAILED" };
    }

    // Check if contract exists
    try {
      const code = await provider.getCode(contractAddress);
      if (code === "0x") {
        return { success: false, msg: "Contract not found at the provided address", code: "CONTRACT_NOT_FOUND" };
      }
    } catch (codeError) {
      return { success: false, msg: "Failed to verify contract existence", code: "CONTRACT_VERIFICATION_FAILED" };
    }

    // Get current gas price for BSC
    let gasPrice;
    try {
      const feeData = await provider.getFeeData();
      gasPrice = feeData.gasPrice || ethers.parseUnits("5", "gwei"); // BSC typically uses 5 gwei
    } catch (gasPriceError) {
      gasPrice = ethers.parseUnits("5", "gwei"); // Fallback gas price
    }

    // Try different mint function signatures
    const mintFunctions = [
      { name: "mint", args: [mintQuantity] },
      { name: "publicMint", args: [mintQuantity] },
      { name: "batchMint", args: [mintQuantity] },
      { name: "mint", args: [wallet.address, mintQuantity] },
      { name: "mintTo", args: [wallet.address, mintQuantity] }
    ];

    let tx;
    let lastError;

    for (const func of mintFunctions) {
      try {
        // Check if function exists
        if (contract[func.name]) {
          // Estimate gas first
          try {
            const gasEstimate = await contract[func.name].estimateGas(...func.args);
            console.log(`Gas estimate for ${func.name}: ${gasEstimate.toString()}`);
            
            // Execute transaction with estimated gas + buffer
            tx = await contract[func.name](...func.args, {
              gasLimit: gasEstimate + BigInt(50000), // Add 50k gas buffer
              gasPrice: gasPrice
            });
            
            console.log(`Transaction sent with ${func.name}:`, tx.hash);
            break;
          } catch (gasError) {
            console.warn(`Gas estimation failed for ${func.name}:`, gasError.message);
            
            // Try with fixed gas limit if estimation fails
            try {
              tx = await contract[func.name](...func.args, {
                gasLimit: 300000, // Fixed gas limit for BSC
                gasPrice: gasPrice
              });
              console.log(`Transaction sent with fixed gas for ${func.name}:`, tx.hash);
              break;
            } catch (fixedGasError) {
              lastError = fixedGasError;
              continue;
            }
          }
        }
      } catch (funcError) {
        lastError = funcError;
        console.warn(`Failed with ${func.name}:`, funcError.message);
        continue;
      }
    }

    if (!tx) {
      // Analyze the last error for specific messages
      const errorMsg = lastError?.message || "";
      
      if (errorMsg.includes("insufficient funds")) {
        return { success: false, msg: "Insufficient BNB for transaction + gas fees", code: "INSUFFICIENT_FUNDS" };
      } else if (errorMsg.includes("execution reverted")) {
        const revertReason = errorMsg.match(/reason string '(.+?)'/)?.[1] || "Unknown reason";
        return { success: false, msg: `Transaction reverted: ${revertReason}`, code: "TRANSACTION_REVERTED" };
      } else if (errorMsg.includes("nonce too low")) {
        return { success: false, msg: "Transaction nonce error. Please try again.", code: "NONCE_ERROR" };
      } else if (errorMsg.includes("replacement transaction underpriced")) {
        return { success: false, msg: "Gas price too low. Please try again.", code: "GAS_PRICE_LOW" };
      } else if (errorMsg.includes("intrinsic gas too low")) {
        return { success: false, msg: "Gas limit too low for this transaction", code: "GAS_LIMIT_LOW" };
      } else if (errorMsg.includes("max fee per gas less than block base fee")) {
        return { success: false, msg: "Gas fee too low for current network conditions", code: "GAS_FEE_TOO_LOW" };
      } else {
        return { success: false, msg: "No compatible mint function found or all mint attempts failed", code: "MINT_FUNCTION_FAILED" };
      }
    }

    // Wait for transaction confirmation with timeout
    console.log("Waiting for transaction confirmation...");
    
    try {
      const receipt = await Promise.race([
        tx.wait(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error("Transaction confirmation timeout")), 300000) // 5 minute timeout
        )
      ]);

      if (receipt.status === 0) {
        return { success: false, msg: "Transaction failed during execution", code: "TRANSACTION_FAILED" };
      }

      console.log("Transaction confirmed:", receipt.transactionHash);
      return { 
        success: true, 
        txHash: receipt.transactionHash,
        gasUsed: receipt.gasUsed.toString(),
        blockNumber: receipt.blockNumber
      };

    } catch (confirmError) {
      if (confirmError.message.includes("timeout")) {
        return { 
          success: false, 
          msg: "Transaction sent but confirmation timed out. Check transaction status manually.", 
          code: "CONFIRMATION_TIMEOUT",
          txHash: tx.hash
        };
      }
      throw confirmError;
    }

  } catch (err) {
    console.error("BSC Mint Error:", err);

    // Network-specific error handling
    if (err.code === "NETWORK_ERROR") {
      return { success: false, msg: "BSC network connection error. Please try again.", code: "NETWORK_ERROR" };
    }

    if (err.code === "TIMEOUT") {
      return { success: false, msg: "Request timed out. BSC network might be congested.", code: "TIMEOUT" };
    }

    // Generic error messages based on common patterns
    const errorMsg = err.message || "";
    
    if (errorMsg.includes("insufficient funds")) {
      return { success: false, msg: "Insufficient BNB to cover transaction and gas fees", code: "INSUFFICIENT_FUNDS" };
    }
    
    if (errorMsg.includes("invalid address") || errorMsg.includes("invalid contract")) {
      return { success: false, msg: "Invalid or non-existent contract address", code: "INVALID_CONTRACT" };
    }
    
    if (errorMsg.includes("gas required exceeds allowance")) {
      return { success: false, msg: "Transaction requires more gas than available", code: "GAS_LIMIT_EXCEEDED" };
    }
    
    if (errorMsg.includes("nonce")) {
      return { success: false, msg: "Transaction nonce error. Please try again.", code: "NONCE_ERROR" };
    }

    if (errorMsg.includes("429") || errorMsg.includes("rate limit")) {
      return { success: false, msg: "Rate limited by BSC RPC provider. Please try again in a moment.", code: "RATE_LIMITED" };
    }

    // Default fallback error
    return { 
      success: false, 
      msg: "BSC transaction failed. Please verify your inputs and try again.", 
      code: "UNKNOWN_ERROR",
      details: err.message
    };
  }
};