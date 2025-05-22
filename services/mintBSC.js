const { ethers } = require("ethers");

module.exports = async ({ privateKey, contractAddress, mintQuantity }) => {
  const provider = new ethers.JsonRpcProvider(
    "https://bsc-dataseed.binance.org/" // or BASE if needed
  );
  const wallet = new ethers.Wallet(privateKey, provider);

  const abi = [
    "function mint(uint256 _amount) public payable"
    // or adjust based on actual contract
  ];

  const contract = new ethers.Contract(contractAddress, abi, wallet);
  const tx = await contract.mint(mintQuantity); // you may need to attach value for paid mints

  await tx.wait();
  return { txHash: tx.hash };
};
