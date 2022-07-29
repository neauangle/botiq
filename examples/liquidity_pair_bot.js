import botiq from '../index.js';

const ethereumEndpoint = await botiq.ethers.createJsonRpcEndpoint({
    accessURL: 'PASTE_ACCESS_URL_HERE',
    rateLimitPerSecond: 2,
});

const pairCreationListener = async ({log, token0, token1, pair}) => {
    try {
        //We need to figure out which is the comparator- and we are only interested in ETH or USDC comparators
        //use isHexEqual any time you need to compare blockchain addresses
        const pairAddress = pair;
        let tokenAddress, comparatorAddress;
        if (botiq.util.isHexEqual(token0, botiq.ethers.chains.ethereum.tokenAddresses.ETH)
        || botiq.util.isHexEqual(token0, botiq.ethers.chains.ethereum.tokenAddresses.USDC)){
            tokenAddress = token1;
            comparatorAddress = token0;
        } else if (botiq.util.isHexEqual(token1, botiq.ethers.chains.ethereum.tokenAddresses.ETH)
        || botiq.util.isHexEqual(token1, botiq.ethers.chains.ethereum.tokenAddresses.USDC)){
            tokenAddress = token0;
            comparatorAddress = token1;
        }
        if (!tokenAddress){
            return;
        } 
        const comparatorIsFiat =  botiq.util.isHexEqual(comparatorAddress, botiq.ethers.chains.ethereum.tokenAddresses.USDC);

        let [tracker, liquidity]  = await Promise.all([
            ethereumEndpoint.createTracker({tokenAddress, comparatorAddress, comparatorIsFiat}),
            ethereumEndpoint.getBalance({walletAddress: pairAddress, tokenAddress: comparatorAddress})
        ]);
        while (liquidity.string === '0'){
            await botiq.util.awaitMs(2000);
            liquidity = await ethereumEndpoint.getBalance({walletAddress: pairAddress, tokenAddress: comparatorAddress});
        }
        let liquidityString = `${comparatorIsFiat ? '$' : ''}${liquidity.string} ${tracker.comparator.symbol}`;
        if (!comparatorIsFiat){
            //9 decimal points should do for fiat
            liquidityString += ' ($' + botiq.util.formatRational(
                ethereumEndpoint.nativeToFiatTracker.mostRecentPrices.comparator.rational.multiply(liquidity.rational), 9
            ) + ')';
            
        }
        console.log(`${tracker.token.name} (${tracker.token.symbol}) liquidity: ${liquidityString}`);
        console.log('    ', `https://etherscan.io/address/${tracker.token.address}#code`);
        console.log('    ', `https://twitter.com/search?q=%24${tracker.token.symbol}&src=typed_query`);
        console.log('    ', `https://www.dextools.io/app/ether/pair-explorer/${pairAddress}`);
    } catch (error) {
        console.log(error);
    }
}


ethereumEndpoint.addContractEventListener({
    contractAddress: botiq.ethers.chains.ethereum.exchanges.uniswapV2.factoryAddress,
    abiFragment: ' event PairCreated(address indexed token0, address indexed token1, address pair, uint)',
    listener: pairCreationListener
})
