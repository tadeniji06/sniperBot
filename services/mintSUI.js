const axios = require("axios");

module.exports = async ({ privateKey, collectionId, mintQuantity, mintStage }) => {
  const query = `
    mutation {
      mintNFT(
        input: {
          collectionId: "${collectionId}",
          quantity: ${mintQuantity},
          stage: "${mintStage}",
          signer: {
            type: "KEYPAIR",
            privateKey: "${privateKey}"
          }
        }
      ) {
        transactionBlockDigest
      }
    }
  `;

  const response = await axios.post(
    process.env.INDEXER_ENDPOINT,
    { query },
    {
      headers: {
        "x-api-user": process.env.TRADEPORT_API_USER,
        "x-api-key": process.env.TRADEPORT_API_KEY,
        "Content-Type": "application/json"
      }
    }
  );

  const txDigest = response?.data?.data?.mintNFT?.transactionBlockDigest;
  return { txHash: txDigest };
};
