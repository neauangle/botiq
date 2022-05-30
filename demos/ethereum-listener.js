import botiq from '../index.js';

/*
Demonstrates botiq automatically showing fiat value of WEAPON trades/polls if it can find a conversion chain
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
    tokenAddress: '0x0b8057c3cc676c329c25c1d0cd27776efa73762d', //WEAPON token address
    comparatorAddress: botiq.ethers.ethereum.tokenAddresses.ETH,
});


const listener = (swapDetails, tracker) => {
    console.log('    ', swapDetails.action, swapDetails.tokenQuantity.string, tracker.token.symbol, 
                'for', swapDetails.comparatorQuantity.string, tracker.comparator.symbol, 
                swapDetails.fiatQuantity.string? `($${swapDetails.fiatQuantity.string})` : ''
    );
}

weaponTracker.addSwapListener({listener});
weaponTracker.addPollingListener({listener, pollIntervalSeconds: 10});



