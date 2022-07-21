import binance from './binance.js';
import ethers from './ethers.js';
import * as modules from './modules/index.js';


async function raceToResolve(keytoFunction){
    const promiseArray = [];
    for (const key of Object.keys(keytoFunction)){
        promiseArray.push(new Promise(async (resolve, reject) => {
            await keytoFunction[key];
            resolve(key);
        }));
    }
    return Promise.any(promiseArray);
}


const GENERIC_LOGGING_LISTENER = (swapDetails, tracker) => {
    console.log(
        '    ', swapDetails.action, swapDetails.tokenQuantity.string, tracker.token.symbol, 
        'for', swapDetails.comparatorQuantity.string, tracker.comparator.symbol, 
        swapDetails.fiatQuantity.string? `($${swapDetails.fiatQuantity.string})` : '',
        
        '\n        ', 'Average price:', 
        swapDetails.averageTokenPriceComparator.string, tracker.comparator.symbol,  
        swapDetails.averageTokenPriceFiat.string? `($${swapDetails.averageTokenPriceFiat.string})` : ''
    );
}



export default {
    binance,
    ethers,
    modules,
    GENERIC_LOGGING_LISTENER,
    raceToResolve
}

/*
    TODO
    -----
ethers
    test liquidity
    add cancelTransaction
        get the nonce used and replace it using higher gas: https://info.etherscan.com/how-to-cancel-ethereum-pending-transactions/
binance
    test withdraw -> wait -> ethers transfer
technical analysis
video tutorials

*/
