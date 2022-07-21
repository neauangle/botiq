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
ethers
    test liquidity
    add cancelTransaction
        get the nonce used and replace it using higher gas: https://info.etherscan.com/how-to-cancel-ethereum-pending-transactions/
binance
    test withdraw -> wait -> ethers transfer
we will need to refactor swap and addRemoveLiquidity under the uniswap v2 eventually and add uniswap v3
technical analysis
video tutorials

*/
