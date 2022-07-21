const { assert, expect } = require("chai");
const { network, getNamedAccounts, deployments, ethers } = require("hardhat");
const { developmentChains, networkConfig } = require("../../helper-hardhat-config");

!developmentChains.includes(network.name)
  ? describe.skip
  : describe("Lottery unit test", async function () {
      let lottery, vrfCoordinatorV2Mock, lotteryEntranceFee, deployer, interval;
      const chainId = network.config.chainId;

      beforeEach(async function () {
        deployer = (await getNamedAccounts()).deployer;
        await deployments.fixture(["all"]);
        lottery = await ethers.getContract("Lottery", deployer);
        vrfCoordinatorV2Mock = await ethers.getContract("VRFCoordinatorV2Mock", deployer);
        lotteryEntranceFee = await lottery.getEntranceFee();
        interval = await lottery.getInterval();
      });

      describe("constructor", async function () {
        it("Initialize Lottery contract correctly", async function () {
          // Ideally we make our test to have just 1 assert per it.
          const lotteryState = await lottery.getLotteryState();
          assert.equal(lotteryState.toString(), "0");
          assert.equal(interval.toString(), networkConfig[chainId]["interval"]);
        });
      });

      describe("enterLottery", async function () {
        it("Reverts when you don't pay enough", async function () {
          await expect(lottery.enterLottery()).to.be.revertedWith("Lottery__NotEnoughETHEntered");
        });

        it("Records players when they enter", async function () {
          await lottery.enterLottery({ value: lotteryEntranceFee });
          const playerFromContract = await lottery.getPlayer(0);
          assert.equal(playerFromContract, deployer);
        });

        it("Emits event on enter", async function () {
          await expect(lottery.enterLottery({ value: lotteryEntranceFee })).to.emit(
            lottery,
            "LotteryEnter"
          );
        });

        it("Doesn't allow entrance when lottery is 'Calculating'", async function () {
          // The only way to get lotteryState in `Calculating` mode is to call `performUpkeep` function.
          await lottery.enterLottery({ value: lotteryEntranceFee });
          // We increase time of our local blockchain in order to be able to call `performUpkeep` without
          // waiting for our interval time. Then we mine 1 block, check HardHat docs for more.
          await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
          await network.provider.send("evm_mine", []);
          // We pretend to be a Chainlink Keeper to activate `performUpkeep` function and change lotteryState.
          await lottery.performUpkeep([]);
          // Now lotteryState has changed to `Calculating` so we can perform our test.
          await expect(lottery.enterLottery({ value: lotteryEntranceFee })).to.be.revertedWith(
            "Lottery__NotOpen"
          );
        });
      });

      describe("checkUpkeep", async function () {
        it("Return false if people haven't sent any ETH", async function () {
          await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
          await network.provider.send("evm_mine", []);
          // callStatic allows us to simulate to send a transaction without sending it but just to get the result back.
          const { upkeepNeeded } = await lottery.callStatic.checkUpkeep([]);
          assert(!upkeepNeeded); // Test pass if upkeepNeeded is false.
        });
      });
    });
