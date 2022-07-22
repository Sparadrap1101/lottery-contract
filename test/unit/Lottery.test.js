const { assert, expect } = require("chai");
const { network, getNamedAccounts, deployments, ethers } = require("hardhat");
const { developmentChains, networkConfig } = require("../../helper-hardhat-config");

!developmentChains.includes(network.name)
  ? describe.skip
  : describe("Lottery unit test", function () {
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

      describe("constructor", function () {
        it("Initialize Lottery contract correctly", async function () {
          // Ideally we make our test to have just 1 assert per it.
          const lotteryState = await lottery.getLotteryState();
          assert.equal(lotteryState.toString(), "0");
          assert.equal(interval.toString(), networkConfig[chainId]["interval"]);
        });
      });

      describe("enterLottery", function () {
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

      describe("checkUpkeep", function () {
        it("Returns false if people haven't sent any ETH", async function () {
          await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
          await network.provider.send("evm_mine", []);
          // callStatic allows us to simulate to send a transaction without sending it but just to get the result back.
          const { upkeepNeeded } = await lottery.callStatic.checkUpkeep([]);
          assert(!upkeepNeeded); // Test pass if upkeepNeeded is false.
        });

        it("Returns false if lottery isn't open", async function () {
          await lottery.enterLottery({ value: lotteryEntranceFee });
          await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
          await network.provider.send("evm_mine", []);
          await lottery.performUpkeep([]);
          // Now lotteryState is in `Calculating` mode
          const lotteryState = await lottery.getLotteryState();
          const { upkeepNeeded } = await lottery.callStatic.checkUpkeep([]);
          assert.equal(lotteryState.toString(), "1");
          assert.equal(upkeepNeeded, false);
        });

        it("Returns false if enough time hasn't passed", async () => {
          await lottery.enterLottery({ value: lotteryEntranceFee });
          await network.provider.send("evm_increaseTime", [interval.toNumber() - 1]);
          await network.provider.request({ method: "evm_mine", params: [] });
          const { upkeepNeeded } = await lottery.callStatic.checkUpkeep("0x"); // upkeepNeeded = (timePassed && isOpen && hasBalance && hasPlayers)
          assert(!upkeepNeeded);
        });

        it("Returns true if enough time has passed, has players, eth, and is open", async () => {
          await lottery.enterLottery({ value: lotteryEntranceFee });
          await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
          await network.provider.request({ method: "evm_mine", params: [] });
          const { upkeepNeeded } = await lottery.callStatic.checkUpkeep("0x"); // upkeepNeeded = (timePassed && isOpen && hasBalance && hasPlayers)
          assert(upkeepNeeded);
        });
      });

      describe("performUpkeep", function () {
        it("It can only run if checkUpkeep is true", async function () {
          await lottery.enterLottery({ value: lotteryEntranceFee });
          await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
          await network.provider.request({ method: "evm_mine", params: [] });
          const tx = await lottery.performUpkeep([]);
          assert(tx);
        });

        it("Reverts when checkUpkeep is false", async function () {
          await expect(lottery.performUpkeep([])).to.be.revertedWith("Lottery__UpkeepNotNeeded");
        });

        it("Updates the lotteryState, emits & events, and calls the vrf coordinator", async function () {
          await lottery.enterLottery({ value: lotteryEntranceFee });
          await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
          await network.provider.request({ method: "evm_mine", params: [] });
          const txResponse = await lottery.performUpkeep([]);
          const txReceipt = await txResponse.wait(1);
          const requestId = await txReceipt.events[1].args.requestId;
          const lotteryState = await lottery.getLotteryState();
          assert(requestId.toNumber() > 0);
          assert(lotteryState.toString() == "1");
        });
      });

      describe("fulfillRandomWords", function () {
        beforeEach(async function () {
          await lottery.enterLottery({ value: lotteryEntranceFee });
          await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
          await network.provider.request({ method: "evm_mine", params: [] });
        });

        it("Can only be call after performUpkeep", async function () {
          await expect(
            vrfCoordinatorV2Mock.fulfillRandomWords(0, lottery.address)
          ).to.be.revertedWith("nonexistent request");
          await expect(
            vrfCoordinatorV2Mock.fulfillRandomWords(1, lottery.address)
          ).to.be.revertedWith("nonexistent request");
        });

        // This test is too big...
        it("Picks a winner, resets, and sends money", async () => {
          const additionalEntrances = 3; // to test
          const startingIndex = 2;
          const accounts = await ethers.getSigners();
          for (let i = startingIndex; i < startingIndex + additionalEntrances; i++) {
            const lottery1 = lottery.connect(accounts[i]); // Returns a new instance of the Lottery contract connected to player
            await lottery1.enterLottery({ value: lotteryEntranceFee });
          }
          const startingTimeStamp = await lottery.getLatestTimestamp(); // stores starting timestamp (before we fire our event)

          // This will be more important for our staging tests...
          await new Promise(async (resolve, reject) => {
            lottery.once("WinnerPicked", async () => {
              // event listener for WinnerPicked
              console.log("WinnerPicked event fired!");
              // assert throws an error if it fails, so we need to wrap
              // it in a try/catch so that the promise returns event
              // if it fails.
              try {
                // Now lets get the ending values...
                const recentWinner = await lottery.getWinner();
                const lotteryState = await lottery.getLotteryState();
                const winnerBalance = await accounts[2].getBalance();
                const endingTimeStamp = await lottery.getLatestTimestamp();
                await expect(lottery.getPlayer(0)).to.be.reverted;
                // Comparisons to check if our ending values are correct:
                assert.equal(recentWinner.toString(), accounts[2].address);
                assert.equal(lotteryState, 0);
                assert.equal(
                  winnerBalance.toString(),
                  startingBalance // startingBalance + ( (lotteryEntranceFee * additionalEntrances) + lotteryEntranceFee )
                    .add(lotteryEntranceFee.mul(additionalEntrances).add(lotteryEntranceFee))
                    .toString()
                );
                assert(endingTimeStamp > startingTimeStamp);
                resolve(); // if try passes, resolves the promise
              } catch (e) {
                reject(e); // if try fails, rejects the promise
              }
            });

            const tx = await lottery.performUpkeep("0x");
            const txReceipt = await tx.wait(1);
            const startingBalance = await accounts[2].getBalance();
            await vrfCoordinatorV2Mock.fulfillRandomWords(
              txReceipt.events[1].args.requestId,
              lottery.address
            );
          });
        });
      });
    });
