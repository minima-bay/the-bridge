import hardhatToolboxMochaEthersPlugin from "../p4/node_modules/@nomicfoundation/hardhat-toolbox-mocha-ethers/dist/src/index.js";
import { defineConfig } from "../p4/node_modules/hardhat/dist/src/config.js";

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
