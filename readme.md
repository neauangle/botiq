**BOTIQ**

High-level node.js library useful for creating cryptocurrency bots and apps for the Binance CEX and Ethereum-compatible blockchains. Features automatic fiat conversions where available.


**Binance Limit Buy Example**
```
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
    triggerPriceString: '10%'
});

const binanceBuyResult = await connection.buyTokensWithExact({
    tokenSymbol: ethTracker.token.symbol, 
    comparatorSymbol: ethTracker.comparator.symbol, 
    exactComparatorQuantity: '50%', //percentage of balance
});
console.log(binanceBuyResult);
```

**Ethereum Limit Buy Example**
```
const wallet = botiq.ethers.createWalletFromPrivateKey({
    privateKey: 'PASTE_PRIVATE_KEY_HERE'
}) 

const ethereumEndpoint = await botiq.ethers.createJsonRpcEndpoint({
    accessURL: 'PASTE_ACCESS_URL_HERE',
    rateLimitPerSecond: 2,
});

const tokenTracker = await ethereumEndpoint.createTracker({
    exchange: botiq.ethers.ethereum.exchanges.uniswapV2,
    tokenAddress: 'PASTE_TOKEN_ADDRESS_HERE',
});

await botiq.modules.awaitPriceMovement.awaitPriceFall({
    tracker: tokenTracker,
    triggerPriceString: '10%',
});

const buyResult = await botiq.ethers.UniswapV2.buyTokensWithExact({
    tracker: tokenTracker,
    privateKey: wallet.privateKey, 
    exactComparatorQuantity: '-0.01', //use 100% of balance minus 0.01 
    slippagePercent: '1%',
});
console.log(buyResult);
```

See ./examples/ for more. 

**Notes**

* Has NOT undergone extensive testing. 
* The ethers backend will only work for factories and routers that abide by uniswap v2.
* An informal TODO is in index.js. If you want to add to it, please make use of github's issue tracker.


**Basic code structure**

ethers.js and binance.js handle the specifics of their tokens, while common.js is the place to look for the actual tracker API. It should be quite easy to add CEXs if you make judicious use of common.massageCexMarketSwapData.

**Supporting the Project**

I am neither financially comfortable nor hungry. Donations support [my work](https://github.com/neauangle/) and are always greatly appreciated! 

🙏 0xeF6102cf13Bf075BD5A61BBa1ec7E509899f7152 🙏