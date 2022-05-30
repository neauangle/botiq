import botiq from '../index.js';

/*
Demonstrates awaitFallThenRise pattern
*/

const ethereumEndpoint = await botiq.ethers.createJsonRpcEndpoint({
    accessURL: 'PASTE_ACCESS_URL_WITH_EMBEDDED_TOKEN_HERE',
    rateLimitPerSecond: 2,
    nativeTokenAddress: botiq.ethers.ethereum.tokenAddresses.ETH,
}); 

const ethTracker = await ethereumEndpoint.createTracker({
    exchange: botiq.ethers.ethereum.exchanges.uniswapV2,
    tokenAddress: botiq.ethers.ethereum.tokenAddresses.ETH,
    comparatorAddress: botiq.ethers.ethereum.tokenAddresses.USDC,
    comparatorIsFiat: true,
});

const weaponTracker = await ethereumEndpoint.createTracker({
    exchange: botiq.ethers.ethereum.exchanges.uniswapV2,
    tokenAddress: '0x0b8057c3cc676c329c25c1d0cd27776efa73762d',
    comparatorAddress: botiq.ethers.ethereum.tokenAddresses.ETH,
});

//will wait until WEAPON falls AT LEAST 30% and then rises 5% from lowest point
//NOTE: you could prepend '$' to trigger strings to await fait price movement rather than eth (ie '$30%' for firstTriggerString)
await botiq.modules.awaitPriceMovement.awaitFallThenRise({
    tracker: weaponTracker, 
    firstTriggerString: '30%', 
    thenTriggerString: '5%', 
});
//buy as many eth tokens as you can using 50% of USDT balance
const result = await ethTracker.buyTokensWithExact({
    privateKey: 'PASTE_PRIVATE_KEY_HERE', 
    exactComparatorQuantity: '50%', 
    slippagePercent: '13%', 
});
console.log(result);
