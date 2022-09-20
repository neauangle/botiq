import botiq from '../index.js';




/***********************************/
/*             Binance             */
/***********************************/

const connection = botiq.binance.createConnection({
    apiKey: 'PASTE_API_KEY_HERE',  
    apiSecret: 'PASTE_API_SECRET_HERE'
});
const ethTracker = await connection.createTracker({
    tokenSymbol: 'ETH', 
    comparatorSymbol: 'USDT'
});

await botiq.modules.awaitPriceMovement.awaitPriceFall({
    tracker: ethTracker,
    triggerPriceString: '1500', //specifies price in comparator
    //triggerPriceString: '10%', //specifies percent rise in comparator
    //triggerPriceString: '$1500', //specifies price in fiat - no effect if comparator is fiat
    //triggerPriceString: '$10%, //specifies percent rise in fiat
    pollIntervalSeconds: 10, //optional; defaults to updating price on every swap
});

const binanceBuyResult = await connection.buyTokensWithExact({
    tokenSymbol: ethTracker.token.symbol, 
    comparatorSymbol: ethTracker.comparator.symbol, 
    exactComparatorQuantity: '500', //specifies comparator amount directly
    //exactComparatorQuantity: '50%', //specifies percentage of balance
});
console.log(binanceBuyResult);
/*
{  
    symbol,
    orderId,
    orderListId, //Unless OCO, value will be -1
    clientOrderId,
    transactTime,
    price,
    origQty,
    executedQty,
    cummulativeQuoteQty,
    status,
    timeInForce,
    type,
    side,
    ...tradeDetails (see notes below)
}
*/








/***********************************/
/*             Ethereum            */
/***********************************/
const wallet = botiq.ethers.createWalletFromPrivateKey({
    privateKey: 'PASTE_PRIVATE_KEY_HERE'
}) 

const ethereumEndpoint = await botiq.ethers.createJsonRpcEndpoint({
    accessURL: 'PASTE_ACCESS_URL_HERE',
    rateLimitPerSecond: 2,
});

const tokenTracker = await ethereumEndpoint.createTracker({
    exchange: botiq.ethers.chains.ethereum.exchanges.uniswapV2,
    tokenAddress: 'PASTE_TOKEN_ADDRESS_HERE',
    comparatorAddress: botiq.ethers.chains.ethereum.tokenAddresses.ETH,
});

await botiq.modules.awaitPriceMovement.awaitPriceFall({
    tracker: tokenTracker,
    triggerPriceString: '0.001', //specifies price in comparator
    //triggerPriceString: '10%', //specifies percent rise in comparator
    //triggerPriceString: '$200', //specifies price in fiat
    //triggerPriceString: '$10%, //specifies percent rise in fiat
    pollIntervalSeconds: 10, //optional; defaults to updating price on every swap
});


const buyResult = await botiq.ethers.UniswapV2.buyTokensWithExact({
    tracker: tokenTracker,
    privateKey: wallet.privateKey, 
    exactComparatorQuantity: '0.1', //specifies comparator amount directly
    //exactComparatorQuantity: '50%', //specifies percentage of balance
    //exactComparatorQuantity: '-0.01', //use 100% of balance minus 0.01 (useful for leaving gas)
    slippagePercent: '1%',
    gasPercentModifier: '200%', //optional; defaults to 100% (ie the recommended gas)
});

console.log(buyResult)
/*
{
    blockNumber,
    logIndex,
    transactionHash,
    action: "BUY" or "SELL", 
    gasFeeWeiRational, 
    gasFeeWeiString, 
    gasFeeFiatRational, 
    gasFeeFiatString,
    ...tradeDetails (see notes below)
}
*/






/***********************************/
/*              NOTES              */
/***********************************/
/*

tradeDetails: {
    tokenQuantity: {
        rational,
        string
    },
    comparatorQuantity: {
        rational,
        string
    },
    averageTokenPriceComparator: {
        rational,
        string
    },
    averageTokenPriceFiat: {
        rational,
        string
    },
    fiatQuantity: {
        rational,
        string
    }
}



*/
