const axios = require("axios");

// Enhanced SUI handler with comprehensive error handling
module.exports = async ({ privateKey, collectionId, mintQuantity, mintStage }) => {
  try {
    // Input validation
    if (!privateKey) {
      return { success: false, msg: "Private key is required", code: "MISSING_PRIVATE_KEY" };
    }

    if (!collectionId) {
      return { success: false, msg: "Collection ID is required", code: "MISSING_COLLECTION_ID" };
    }

    if (!mintStage) {
      return { success: false, msg: "Mint stage is required", code: "MISSING_MINT_STAGE" };
    }

    if (!mintQuantity || mintQuantity < 1) {
      return { success: false, msg: "Mint quantity must be at least 1", code: "INVALID_QUANTITY" };
    }

    if (mintQuantity > 100) {
      return { success: false, msg: "Mint quantity cannot exceed 100", code: "QUANTITY_TOO_HIGH" };
    }

    // Validate private key format (basic validation)
    if (privateKey.length < 32) {
      return { success: false, msg: "Private key appears to be too short", code: "INVALID_PRIVATE_KEY_LENGTH" };
    }

    // Validate collection ID format
    if (!collectionId.match(/^[a-fA-F0-9]+$/)) {
      return { success: false, msg: "Invalid collection ID format", code: "INVALID_COLLECTION_ID_FORMAT" };
    }

    // Check environment variables
    if (!process.env.INDEXER_ENDPOINT) {
      return { success: false, msg: "SUI indexer endpoint not configured", code: "MISSING_INDEXER_ENDPOINT" };
    }

    if (!process.env.TRADEPORT_API_USER || !process.env.TRADEPORT_API_KEY) {
      return { success: false, msg: "TradePort API credentials not configured", code: "MISSING_API_CREDENTIALS" };
    }

    // Construct GraphQL mutation with proper escaping
    const query = `
      mutation MintNFT($input: MintNFTInput!) {
        mintNFT(input: $input) {
          transactionBlockDigest
          success
          error {
            message
            code
          }
        }
      }
    `;

    const variables = {
      input: {
        collectionId: collectionId,
        quantity: parseInt(mintQuantity),
        stage: mintStage,
        signer: {
          type: "KEYPAIR",
          privateKey: privateKey
        }
      }
    };

    // Set up request configuration with timeout and retry logic
    const requestConfig = {
      method: 'POST',
      url: process.env.INDEXER_ENDPOINT,
      headers: {
        "x-api-user": process.env.TRADEPORT_API_USER,
        "x-api-key": process.env.TRADEPORT_API_KEY,
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      data: { 
        query, 
        variables 
      },
      timeout: 300000, // 5 minute timeout
      validateStatus: function (status) {
        return status < 500; // Don't throw for 4xx errors
      }
    };

    let response;
    let lastError;
    const maxRetries = 3;

    // Retry logic for network issues
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`SUI mint attempt ${attempt}/${maxRetries}`);
        response = await axios(requestConfig);
        break;
      } catch (networkError) {
        lastError = networkError;
        console.warn(`Network attempt ${attempt} failed:`, networkError.message);
        
        if (attempt === maxRetries) {
          if (networkError.code === 'ECONNABORTED') {
            return { success: false, msg: "Request timed out. SUI network might be congested.", code: "REQUEST_TIMEOUT" };
          } else if (networkError.code === 'ENOTFOUND') {
            return { success: false, msg: "Cannot reach SUI indexer endpoint. Check network connection.", code: "NETWORK_UNREACHABLE" };
          } else if (networkError.code === 'ECONNREFUSED') {
            return { success: false, msg: "SUI indexer endpoint refused connection.", code: "CONNECTION_REFUSED" };
          }
        } else {
          // Wait before retry
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
      }
    }

    if (!response) {
      return { 
        success: false, 
        msg: "Failed to connect to SUI network after multiple attempts", 
        code: "CONNECTION_FAILED",
        details: lastError?.message 
      };
    }

    // Handle HTTP errors
    if (response.status >= 400) {
      if (response.status === 401) {
        return { success: false, msg: "Invalid API credentials", code: "INVALID_CREDENTIALS" };
      } else if (response.status === 403) {
        return { success: false, msg: "Access forbidden. Check API permissions.", code: "ACCESS_FORBIDDEN" };
      } else if (response.status === 404) {
        return { success: false, msg: "SUI indexer endpoint not found", code: "ENDPOINT_NOT_FOUND" };
      } else if (response.status === 429) {
        return { success: false, msg: "Rate limited by SUI API. Please try again later.", code: "RATE_LIMITED" };
      } else {
        return { 
          success: false, 
          msg: `SUI API error: HTTP ${response.status}`,
          code: "HTTP_ERROR",
          details: response.data
        };
      }
    }

    // Check if response has data
    if (!response.data) {
      return { 
        success: false, 
        msg: "Empty response from SUI API", 
        code: "EMPTY_RESPONSE" 
      };
    }

    // Handle GraphQL errors
    if (response.data.errors && response.data.errors.length > 0) {
      const error = response.data.errors[0];
      console.error("GraphQL Error:", error);
      
      // Map common GraphQL errors to user-friendly messages
      if (error.message.includes("insufficient")) {
        return { 
          success: false, 
          msg: "Insufficient balance for minting", 
          code: "INSUFFICIENT_BALANCE",
          details: error.message
        };
      } else if (error.message.includes("not found")) {
        return { 
          success: false, 
          msg: "Collection not found or invalid collection ID", 
          code: "COLLECTION_NOT_FOUND",
          details: error.message
        };
      } else if (error.message.includes("unauthorized")) {
        return { 
          success: false, 
          msg: "Unauthorized to mint from this collection", 
          code: "MINT_UNAUTHORIZED",
          details: error.message
        };
      } else if (error.message.includes("sold out") || error.message.includes("exceeds")) {
        return { 
          success: false, 
          msg: "Mint quantity exceeds available supply", 
          code: "MINT_SOLD_OUT",
          details: error.message
        };
      } else if (error.message.includes("not active")) {
        return { 
          success: false, 
          msg: "Mint stage is not currently active", 
          code: "MINT_STAGE_INACTIVE",
          details: error.message
        };
      } else {
        return { 
          success: false, 
          msg: "GraphQL error occurred", 
          code: "GRAPHQL_ERROR",
          details: error.message
        };
      }
    }

    // Check for successful mint response
    if (!response.data.data || !response.data.data.mintNFT) {
      return { 
        success: false, 
        msg: "Invalid response structure from SUI API", 
        code: "INVALID_RESPONSE_STRUCTURE" 
      };
    }

    const mintResult = response.data.data.mintNFT;

    // Check if mint was successful
    if (!mintResult.success) {
      const errorMsg = mintResult.error?.message || "Unknown mint error";
      const errorCode = mintResult.error?.code || "MINT_FAILED";
      
      return { 
        success: false, 
        msg: `Mint failed: ${errorMsg}`, 
        code: errorCode,
        details: mintResult.error
      };
    }

    // Success case
    if (mintResult.transactionBlockDigest) {
      console.log(`✅ SUI NFT mint successful! Transaction: ${mintResult.transactionBlockDigest}`);
      
      return { 
        success: true, 
        msg: `Successfully minted ${mintQuantity} NFT(s)`, 
        code: "MINT_SUCCESS",
        transactionHash: mintResult.transactionBlockDigest,
        quantity: mintQuantity,
        collectionId: collectionId
      };
    } else {
      return { 
        success: false, 
        msg: "Mint completed but no transaction hash returned", 
        code: "MISSING_TRANSACTION_HASH" 
      };
    }

  } catch (error) {
    console.error("Unexpected error in SUI mint handler:", error);
    
    // Handle specific error types
    if (error.name === 'ValidationError') {
      return { success: false, msg: "Validation error occurred", code: "VALIDATION_ERROR", details: error.message };
    } else if (error.name === 'TypeError') {
      return { success: false, msg: "Type error in request", code: "TYPE_ERROR", details: error.message };
    } else {
      return { 
        success: false, 
        msg: "An unexpected error occurred during minting", 
        code: "UNEXPECTED_ERROR",
        details: error.message
      };
    }
  }
};