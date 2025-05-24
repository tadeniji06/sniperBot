const { 
  Connection, 
  Keypair, 
  PublicKey, 
  Transaction, 
  SystemProgram,
  LAMPORTS_PER_SOL 
} = require("@solana/web3.js");
const { 
  getAssociatedTokenAddress, 
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID
} = require("@solana/spl-token");

// Enhanced Solana handler with comprehensive error handling
module.exports = async ({ privateKey, contractAddress, mintQuantity }) => {
  let connection, keypair, mintPublicKey;

  try {
    // Input validation
    if (!privateKey) {
      return { success: false, msg: "Private key is required", code: "MISSING_PRIVATE_KEY" };
    }

    if (!contractAddress) {
      return { success: false, msg: "Contract address (Mint Address) is required", code: "MISSING_CONTRACT_ADDRESS" };
    }

    if (!mintQuantity || mintQuantity < 1) {
      return { success: false, msg: "Mint quantity must be at least 1", code: "INVALID_QUANTITY" };
    }

    // Initialize connection with multiple RPC endpoints
    const rpcUrls = [
      "https://api.mainnet-beta.solana.com",
      "https://solana-api.projectserum.com",
      "https://rpc.ankr.com/solana",
      "https://solana.drpc.org"
    ];

    let connectionEstablished = false;
    for (const rpcUrl of rpcUrls) {
      try {
        connection = new Connection(rpcUrl, 'confirmed');
        await connection.getVersion(); // Test connection
        connectionEstablished = true;
        console.log(`Connected to Solana RPC: ${rpcUrl}`);
        break;
      } catch (rpcError) {
        console.warn(`Failed to connect to ${rpcUrl}:`, rpcError.message);
        continue;
      }
    }

    if (!connectionEstablished) {
      return { success: false, msg: "Unable to connect to Solana network. All RPC endpoints are down.", code: "RPC_CONNECTION_FAILED" };
    }

    // Validate and create keypair from private key
    try {
      // Handle different private key formats
      let secretKey;
      if (privateKey.startsWith('[') && privateKey.endsWith(']')) {
        // Array format: [1,2,3,...]
        secretKey = new Uint8Array(JSON.parse(privateKey));
      } else if (privateKey.length === 128) {
        // Hex format
        secretKey = new Uint8Array(Buffer.from(privateKey, 'hex'));
      } else if (privateKey.length === 88) {
        // Base58 format
        const bs58 = require('bs58');
        secretKey = bs58.decode(privateKey);
      } else {
        return { success: false, msg: "Invalid private key format. Use base58, hex, or array format.", code: "INVALID_PRIVATE_KEY_FORMAT" };
      }

      if (secretKey.length !== 64) {
        return { success: false, msg: "Private key must be 64 bytes long", code: "INVALID_PRIVATE_KEY_LENGTH" };
      }

      keypair = Keypair.fromSecretKey(secretKey);
    } catch (keyError) {
      return { success: false, msg: "Invalid private key format or corrupted key", code: "INVALID_PRIVATE_KEY" };
    }

    // Validate contract address (mint address)
    try {
      mintPublicKey = new PublicKey(contractAddress);
    } catch (addressError) {
      return { success: false, msg: "Invalid Solana contract address format", code: "INVALID_ADDRESS_FORMAT" };
    }

    // Check wallet balance
    try {
      const balance = await connection.getBalance(keypair.publicKey);
      const balanceInSol = balance / LAMPORTS_PER_SOL;
      
      if (balanceInSol < 0.01) { // Minimum balance check
        return { 
          success: false, 
          msg: `Insufficient SOL balance. Current: ${balanceInSol.toFixed(4)} SOL. Minimum required: 0.01 SOL`, 
          code: "INSUFFICIENT_BALANCE" 
        };
      }
    } catch (balanceError) {
      return { success: false, msg: "Failed to check wallet balance", code: "BALANCE_CHECK_FAILED" };
    }

    // Verify mint account exists
    try {
      const mintInfo = await connection.getAccountInfo(mintPublicKey);
      if (!mintInfo) {
        return { success: false, msg: "Mint account not found. Invalid contract address.", code: "MINT_NOT_FOUND" };
      }
      
      // Verify it's actually a mint account
      if (mintInfo.owner.toString() !== TOKEN_PROGRAM_ID.toString()) {
        return { success: false, msg: "Provided address is not a valid SPL token mint", code: "INVALID_MINT_ACCOUNT" };
      }
    } catch (mintError) {
      return { success: false, msg: "Failed to verify mint account", code: "MINT_VERIFICATION_FAILED" };
    }

    // Get or create associated token account
    let associatedTokenAccount;
    try {
      associatedTokenAccount = await getAssociatedTokenAddress(
        mintPublicKey,
        keypair.publicKey,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );

      const accountInfo = await connection.getAccountInfo(associatedTokenAccount);
      const needsToCreateAccount = !accountInfo;

      // Create transaction
      const transaction = new Transaction();

      // Add create account instruction if needed
      if (needsToCreateAccount) {
        const createAccountInstruction = createAssociatedTokenAccountInstruction(
          keypair.publicKey, // payer
          associatedTokenAccount, // associatedToken
          keypair.publicKey, // owner
          mintPublicKey, // mint
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        );
        transaction.add(createAccountInstruction);
      }

      // Add mint instruction
      const mintInstruction = createMintToInstruction(
        mintPublicKey, // mint
        associatedTokenAccount, // destination
        keypair.publicKey, // authority
        mintQuantity, // amount
        [], // multiSigners
        TOKEN_PROGRAM_ID
      );
      transaction.add(mintInstruction);

      // Get recent blockhash
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = keypair.publicKey;

      // Sign and send transaction
      transaction.sign(keypair);

      const signature = await connection.sendRawTransaction(transaction.serialize(), {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
        maxRetries: 3
      });

      console.log("Transaction sent:", signature);

      // Confirm transaction with timeout
      const confirmation = await Promise.race([
        connection.confirmTransaction({
          signature,
          blockhash,
          lastValidBlockHeight
        }, 'confirmed'),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error("Transaction confirmation timeout")), 300000)
        )
      ]);

      if (confirmation.value.err) {
        return { 
          success: false, 
          msg: `Transaction failed: ${JSON.stringify(confirmation.value.err)}`, 
          code: "TRANSACTION_FAILED",
          signature 
        };
      }

      console.log("Transaction confirmed:", signature);
      return { 
        success: true, 
        txHash: signature,
        associatedTokenAccount: associatedTokenAccount.toString()
      };

    } catch (transactionError) {
      console.error("Transaction Error:", transactionError);
      
      const errorMsg = transactionError.message || "";
      
      if (errorMsg.includes("insufficient funds")) {
        return { success: false, msg: "Insufficient SOL for transaction fees", code: "INSUFFICIENT_FUNDS" };
      } else if (errorMsg.includes("custom program error: 0x1")) {
        return { success: false, msg: "Insufficient funds in mint account", code: "MINT_INSUFFICIENT_FUNDS" };
      } else if (errorMsg.includes("custom program error: 0x0")) {
        return { success: false, msg: "Mint authority error - you don't have permission to mint", code: "MINT_AUTHORITY_ERROR" };
      } else if (errorMsg.includes("InvalidAccountData")) {
        return { success: false, msg: "Invalid account data - contract address may be incorrect", code: "INVALID_ACCOUNT_DATA" };
      } else if (errorMsg.includes("AccountNotFound")) {
        return { success: false, msg: "Account not found - invalid contract address", code: "ACCOUNT_NOT_FOUND" };
      } else if (errorMsg.includes("timeout")) {
        return { success: false, msg: "Transaction timed out. It may still be processing.", code: "TRANSACTION_TIMEOUT" };
      } else if (errorMsg.includes("blockhash not found")) {
        return { success: false, msg: "Transaction expired. Please try again.", code: "BLOCKHASH_EXPIRED" };
      } else {
        return { 
          success: false, 
          msg: "Solana transaction failed. Please verify contract address and try again.", 
          code: "TRANSACTION_ERROR",
          details: errorMsg
        };
      }
    }

  } catch (err) {
    console.error("Solana Mint Error:", err);

    // Network-specific error handling
    if (err.code === "ENOTFOUND" || err.code === "ECONNREFUSED") {
      return { success: false, msg: "Network connection error. Please check your internet.", code: "NETWORK_ERROR" };
    }

    if (err.code === "TIMEOUT") {
      return { success: false, msg: "Solana network request timed out. Please try again.", code: "TIMEOUT" };
    }

    // Rate limiting
    if (err.message.includes("429") || err.message.includes("rate limit")) {
      return { success: false, msg: "Rate limited by Solana RPC. Please try again in a moment.", code: "RATE_LIMITED" };
    }

    // Default fallback error
    return { 
      success: false, 
      msg: "Solana minting failed. Please verify your inputs and try again.", 
      code: "UNKNOWN_ERROR",
      details: err.message
    };
  }
};