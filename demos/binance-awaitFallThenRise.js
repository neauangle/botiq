import botiq from '../index.js';

/*
Demonstrates awaitFallThenRise pattern

NOTE: You don't actually need an API_KEY or API_SECRET for this demo- just run it!
*/

const connection = botiq.binance.createConnection({ apiKey: 'PASTE_API_KEY_HERE',  apiSecret: 'PASTE_API_SECRET_HERE'});
const ethTracker = await  connection.createTracker({tokenSymbol: 'ETH', comparatorSymbol: 'USDT', comparatorIsFiat: true});

//will wait until eth falls AT LEAST 2% and then rises 0.3% from lowest point
await botiq.modules.awaitPriceMovement.awaitFallThenRise({
    tracker: ethTracker, 
    firstTriggerString: '2%', 
    thenTriggerString: '0.3%', 
});
//buy as many eth tokens as you can using 50% of USDT balance
const result = await ethTracker.buyTokensWithExact({exactComparatorQuantity: '50%'});
console.log(result);
