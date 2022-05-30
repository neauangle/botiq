import binance from './binance.js';
import ethers from './ethers.js';
import * as modules from './modules/index.js';

export default {
    binance,
    ethers,
    modules
}

/*
    TODO
    -----
make awaits test the current price on entry- it could already be satisfied
add dollar signs where fiat in awaits
ethers
    test liquidity
    add cancelTransaction
        get the nonce used and replace it using higher gas: https://info.etherscan.com/how-to-cancel-ethereum-pending-transactions/
binance
    test withdraw -> wait -> ethers transfer

technical analysis
video tutorials

*/
