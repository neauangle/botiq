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
make a config set in addtracker or addendpoint to get rid of this magic number
if (uplinkTracker.mostRecentPrices.comparator.rational === null
            || Date.now() - uplinkTracker.mostRecentPrices.timestamp > 30000){
                await updatePrice(uplinkTracker);


add -ve amount support for binance
add percentage -ve support for ethers and binance (leave a percentage of current balance)
ethers
    test liquidity
    add cancelTransaction
        get the nonce used and replace it using higher gas: https://info.etherscan.com/how-to-cancel-ethereum-pending-transactions/
binance
    test withdraw -> wait -> ethers transfer
technical analysis
video tutorials

*/
