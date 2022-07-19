// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

contract Lottery {
    uint256 private immutable i_entranceFee;

    constructor(uint256 _entranceFee) {
        i_entranceFee = _entranceFee;
    }

    function enterLottery() {}

    function getEntranceFee() public view returns (uint256) {
        return i_entranceFee;
    }
}
