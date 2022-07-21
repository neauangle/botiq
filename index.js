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



export default {
    binance,
    ethers,
    modules,
    raceToResolve
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
