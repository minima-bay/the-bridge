import hardhatToolboxMochaEthersPlugin from "@nomicfoundation/hardhat-toolbox-mocha-ethers";
import { defineConfig } from "hardhat/config";

export default defineConfig({
  plugins: [hardhatToolboxMochaEthersPlugin],
  paths: {
    sources: "./contracts",
    tests: {
      mocha: "./test"
    }
  },
  solidity: {
    profiles: {
      default: {
        version: "0.8.24"
      },
      production: {
        version: "0.8.24",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200
          },
          metadata: {
            bytecodeHash: "ipfs"
          }
        }
      }
    }
  },
  test: {
    mocha: {
      timeout: 20000
    }
  }
});
