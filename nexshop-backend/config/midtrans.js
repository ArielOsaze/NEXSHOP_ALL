require("dotenv").config();

const isProduction = process.env.IPAYMU_MODE === "production";

module.exports = {
  // Virtual Account
  va: process.env.IPAYMU_VA,

  // API Key
  apiKey: process.env.IPAYMU_API_KEY,

  // Mode
  mode: isProduction ? "production" : "sandbox",

  // Base URL
  baseUrl: isProduction
    ? "https://my.ipaymu.com/api/v2"
    : "https://sandbox.ipaymu.com/api/v2",
};