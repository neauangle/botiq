import binance from './binance.js';
import ethers from './ethers.js';
import * as modules from './modules/index.js';
import * as util from './util.js';





export default {
    binance,
    ethers,
    modules,
    util,
}

/*
    TODO
    -----
ethers
    figure out how to parse liquidity logs and add that info to add/remove functions
    test liquidity
    add cancelTransaction
        get the nonce used and replace it using higher gas: https://info.etherscan.com/how-to-cancel-ethereum-pending-transactions/
binance
    test withdraw -> wait -> ethers transfer
technical analysis
video tutorials

*/
